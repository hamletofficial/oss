const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const admin = require("firebase-admin");
const {getFirestore, Timestamp} = require("firebase-admin/firestore");

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("Organisation callable tests must run against the Firestore Emulator.");
}
if (!admin.apps.length) {
  admin.initializeApp({projectId: process.env.GCLOUD_PROJECT || "demo-hamlet-functions"});
}

const db = getFirestore();
const callables = require("../hamlet-organisations");
const governance = require("../hamlet-organisation-governance");
const suffix = () => crypto.randomBytes(5).toString("hex");
const identity = (uid, email, verified = true) => ({
  uid,
  token: {email, email_verified: verified},
});
const invoke = (name, data, auth) => callables[name].run({data: data || {}, auth: auth || null});
const expectCode = async (promise, code) => {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code);
    return true;
  });
};

test("organisation creation requires a verified authenticated identity", async () => {
  await expectCode(invoke("createOrganisation", {name: "Example Org", slug: "example-org"}, null), "unauthenticated");
  await expectCode(
    invoke("createOrganisation", {name: "Example Org", slug: "example-org"}, identity("unverified", "user@example.com", false)),
    "failed-precondition"
  );
});

test("organisation creation atomically reserves a slug and creates the initial owner", async () => {
  const tag = suffix();
  const uid = "owner-" + tag;
  const slug = "org-" + tag;
  const result = await invoke("createOrganisation", {name: "Example Organisation", slug}, identity(uid, "owner@example.com"));
  const organisation = await db.collection("organisations").doc(result.organisationId).get();
  const membership = await db.collection("organisationMembers").doc(result.organisationId + "_" + uid).get();
  const slugRecord = await db.collection("organisationSlugs").doc(slug).get();
  const directory = await db.collection("organisationDirectory").doc(result.organisationId).get();

  assert.equal(result.slug, slug);
  assert.equal(result.role, "owner");
  assert.equal(organisation.data().ownerUid, uid);
  assert.equal(organisation.data().status, "active");
  assert.equal(membership.data().role, "owner");
  assert.equal(membership.data().status, "active");
  assert.equal(slugRecord.data().organisationId, result.organisationId);
  assert.equal(directory.data().isPublic, false);

  await expectCode(
    invoke("createOrganisation", {name: "Collision", slug}, identity("other-" + tag, "other@example.com")),
    "already-exists"
  );
});

test("invitations persist only a token hash and are single-use and email-bound", async () => {
  const tag = suffix();
  const ownerUid = "owner-" + tag;
  const organisation = await invoke(
    "createOrganisation",
    {name: "Invitation Test", slug: "invite-" + tag},
    identity(ownerUid, "owner@example.com")
  );
  const invitation = await invoke(
    "createOrganisationInvitation",
    {organisationId: organisation.organisationId, email: "joiner@example.com", role: "member"},
    identity(ownerUid, "owner@example.com")
  );
  const stored = await db.collection("organisationInvitations").doc(invitation.invitationId).get();

  assert.equal(stored.exists, true);
  assert.equal(stored.data().tokenHash, invitation.invitationId);
  assert.equal(stored.data().email, "joiner@example.com");
  assert.equal(stored.data().status, "pending");
  assert.equal(stored.data().token, undefined);
  await expectCode(
    invoke("acceptOrganisationInvitation", {token: invitation.token}, identity("wrong-" + tag, "other@example.com")),
    "permission-denied"
  );

  const accepted = await invoke(
    "acceptOrganisationInvitation",
    {token: invitation.token},
    identity("joiner-" + tag, "joiner@example.com")
  );
  assert.equal(accepted.organisationId, organisation.organisationId);
  assert.equal(accepted.role, "member");
  const member = await db.collection("organisationMembers")
    .doc(organisation.organisationId + "_joiner-" + tag).get();
  assert.equal(member.data().status, "active");

  await expectCode(
    invoke("acceptOrganisationInvitation", {token: invitation.token}, identity("joiner-" + tag, "joiner@example.com")),
    "failed-precondition"
  );
});

test("expired and revoked invitations cannot be accepted", async () => {
  const tag = suffix();
  const ownerUid = "owner-" + tag;
  const organisation = await invoke(
    "createOrganisation",
    {name: "Expiry Test", slug: "expiry-" + tag},
    identity(ownerUid, "owner@example.com")
  );
  const expiredToken = crypto.randomBytes(32).toString("base64url");
  const expiredHash = crypto.createHash("sha256").update(expiredToken).digest("hex");
  await db.collection("organisationInvitations").doc(expiredHash).set({
    organisationId: organisation.organisationId,
    email: "invitee@example.com",
    role: "member",
    status: "pending",
    tokenHash: expiredHash,
    expiresAt: Timestamp.fromMillis(Date.now() - 1000),
  });
  await expectCode(
    invoke("acceptOrganisationInvitation", {token: expiredToken}, identity("invitee-" + tag, "invitee@example.com")),
    "failed-precondition"
  );

  const pending = await invoke(
    "createOrganisationInvitation",
    {organisationId: organisation.organisationId, email: "revoke@example.com", role: "viewer"},
    identity(ownerUid, "owner@example.com")
  );
  await invoke(
    "revokeOrganisationInvitation",
    {invitationId: pending.invitationId},
    identity(ownerUid, "owner@example.com")
  );
  await expectCode(
    invoke("acceptOrganisationInvitation", {token: pending.token}, identity("revoke-" + tag, "revoke@example.com")),
    "failed-precondition"
  );
});

test("role changes and member removal preserve administrator and owner boundaries", async () => {
  const tag = suffix();
  const ownerUid = "owner-" + tag;
  const adminUid = "admin-" + tag;
  const memberUid = "member-" + tag;
  const organisation = await invoke(
    "createOrganisation",
    {name: "Role Test", slug: "roles-" + tag},
    identity(ownerUid, "owner@example.com")
  );
  const orgId = organisation.organisationId;
  await db.collection("organisationMembers").doc(orgId + "_" + adminUid).set({
    organisationId: orgId, uid: adminUid, role: "admin", status: "active",
  });
  await db.collection("organisationMembers").doc(orgId + "_" + memberUid).set({
    organisationId: orgId, uid: memberUid, role: "member", status: "active",
  });

  await expectCode(
    invoke("changeOrganisationMemberRole", {organisationId: orgId, memberUid, role: "admin"}, identity(adminUid, "admin@example.com")),
    "permission-denied"
  );
  await invoke(
    "changeOrganisationMemberRole",
    {organisationId: orgId, memberUid, role: "manager"},
    identity(adminUid, "admin@example.com")
  );
  const changed = await db.collection("organisationMembers").doc(orgId + "_" + memberUid).get();
  assert.equal(changed.data().role, "manager");

  await expectCode(
    invoke("removeOrganisationMember", {organisationId: orgId, memberUid: ownerUid}, identity(adminUid, "admin@example.com")),
    "permission-denied"
  );
  await invoke(
    "removeOrganisationMember",
    {organisationId: orgId, memberUid},
    identity(ownerUid, "owner@example.com")
  );
  const removed = await db.collection("organisationMembers").doc(orgId + "_" + memberUid).get();
  assert.equal(removed.data().status, "removed");
});


test("trusted organisation deal and property triggers append immutable tenant-scoped audit events", async () => {
  const tag = suffix();
  const ownerUid = "audit-owner-" + tag;
  const organisation = await invoke(
    "createOrganisation",
    {name: "Operational Audit Test", slug: "operational-audit-" + tag},
    identity(ownerUid, "audit-owner@example.com")
  );
  const orgId = organisation.organisationId;
  const dealId = "deal-" + tag;
  const propertyId = "property-" + tag;
  const audit = require("../hamlet-organisation-audit");

  const dealRef = db.collection("organisationDeals").doc(dealId);
  const dealBeforeCreate = await dealRef.get();
  await dealRef.set({
    id: dealId, organisationId: orgId, createdByUid: ownerUid,
    visibility: "organisation", sharedWithUids: [],
    name: "Audit Deal", stage: "LOI Issued", value: 100000,
  });
  const dealAfterCreate = await dealRef.get();
  await audit.recordOrganisationDealActivity.run({
    id: "deal-create-" + tag, authId: ownerUid, authType: "USER",
    params: {dealId}, data: {before: dealBeforeCreate, after: dealAfterCreate},
  });
  const dealCreated = await db.collection("organisationActivity")
    .where("resourceId", "==", dealId).get();
  assert.equal(dealCreated.size, 1);
  assert.equal(dealCreated.docs[0].data().action, "organisation.deal_created");
  assert.equal(dealCreated.docs[0].data().organisationId, orgId);
  assert.equal(dealCreated.docs[0].data().actorUid, ownerUid);

  const dealBeforeUpdate = await dealRef.get();
  await dealRef.update({stage: "Due Diligence"});
  const dealAfterUpdate = await dealRef.get();
  await audit.recordOrganisationDealActivity.run({
    id: "deal-update-" + tag, authId: ownerUid, authType: "USER",
    params: {dealId}, data: {before: dealBeforeUpdate, after: dealAfterUpdate},
  });
  const stageEvent = await db.collection("organisationActivity")
    .where("resourceId", "==", dealId)
    .where("action", "==", "organisation.deal_stage_changed").get();
  assert.equal(stageEvent.size, 1);
  assert.deepEqual(stageEvent.docs[0].data().changedFields, ["stage"]);

  const propertyRef = db.collection("organisationProperties").doc(propertyId);
  const propertyBefore = await propertyRef.get();
  await propertyRef.set({
    id: propertyId, organisationId: orgId, createdByUid: ownerUid,
    visibility: "organisation", sharedWithUids: [],
    propertyName: "Audit Property", propertyType: "Commercial",
    status: "Available", sustainabilityStandard: "Passivhaus",
  });
  const propertyAfter = await propertyRef.get();
  await audit.recordOrganisationPropertyActivity.run({
    id: "property-create-" + tag, authId: ownerUid, authType: "USER",
    params: {propertyId}, data: {before: propertyBefore, after: propertyAfter},
  });
  const propertyEvent = await db.collection("organisationActivity")
    .where("resourceId", "==", propertyId).get();
  assert.equal(propertyEvent.size, 1);
  assert.equal(propertyEvent.docs[0].data().action, "organisation.property_created");
  assert.equal(propertyEvent.docs[0].data().resourceType, "property");
});

test.after(async () => {
  await db.terminate();
});


test("ownership transfer is atomic, audited and protects the former owner", async () => {
  const governance = require("../hamlet-organisation-governance");
  const tag = suffix();
  const ownerUid = "transfer-owner-" + tag;
  const nextUid = "transfer-next-" + tag;
  const org = await invoke("createOrganisation",
    {name: "Ownership Transfer", slug: "transfer-" + tag},
    identity(ownerUid, "owner-" + tag + "@example.com"));
  const orgId = org.organisationId;
  const nextRef = db.collection("organisationMembers").doc(orgId + "_" + nextUid);
  await nextRef.set({
    organisationId: orgId, uid: nextUid, email: "next@example.com",
    role: "manager", status: "active",
  });

  await expectCode(
    governance.transferOrganisationOwnership.run({
      data: {organisationId: orgId, newOwnerUid: nextUid},
      auth: identity("outsider-" + tag, "outsider@example.com"),
    }),
    "permission-denied"
  );
  const result = await governance.transferOrganisationOwnership.run({
    data: {organisationId: orgId, newOwnerUid: nextUid},
    auth: identity(ownerUid, "owner-" + tag + "@example.com"),
  });
  assert.equal(result.newOwnerUid, nextUid);

  const [organisation, former, next] = await Promise.all([
    db.collection("organisations").doc(orgId).get(),
    db.collection("organisationMembers").doc(orgId + "_" + ownerUid).get(),
    nextRef.get(),
  ]);
  assert.equal(organisation.data().ownerUid, nextUid);
  assert.equal(former.data().role, "admin");
  assert.equal(next.data().role, "owner");
  const events = await db.collection("organisationActivity")
    .where("organisationId", "==", orgId)
    .where("action", "==", "organisation.ownership_transferred").get();
  assert.equal(events.size, 1);
  assert.equal(events.docs[0].data().previousOwnerUid, ownerUid);
  assert.equal(events.docs[0].data().newOwnerUid, nextUid);

  await expectCode(
    invoke("removeOrganisationMember", {organisationId: orgId, memberUid: nextUid},
      identity(ownerUid, "owner-" + tag + "@example.com")),
    "permission-denied"
  );
  await expectCode(
    governance.transferOrganisationOwnership.run({
      data: {organisationId: orgId, newOwnerUid: ownerUid},
      auth: identity(ownerUid, "owner-" + tag + "@example.com"),
    }),
    "permission-denied"
  );
});

test("organisation lifecycle transitions are owner-only, audited and irreversible after closure", async () => {
  const governance = require("../hamlet-organisation-governance");
  const tag = suffix();
  const ownerUid = "lifecycle-owner-" + tag;
  const org = await invoke("createOrganisation",
    {name: "Lifecycle Test", slug: "lifecycle-" + tag},
    identity(ownerUid, "lifecycle-" + tag + "@example.com"));
  const orgId = org.organisationId;
  const slugRef = db.collection("organisationSlugs").doc(org.slug);
  const directoryRef = db.collection("organisationDirectory").doc(orgId);
  await directoryRef.update({isPublic: true});

  await expectCode(
    governance.setOrganisationLifecycleStatus.run({
      data: {organisationId: orgId, status: "suspended"},
      auth: identity("not-owner-" + tag, "not-owner@example.com"),
    }),
    "permission-denied"
  );
  await governance.setOrganisationLifecycleStatus.run({
    data: {organisationId: orgId, status: "suspended"},
    auth: identity(ownerUid, "lifecycle-" + tag + "@example.com"),
  });
  let [organisation, slug, directory] = await Promise.all([
    db.collection("organisations").doc(orgId).get(), slugRef.get(), directoryRef.get(),
  ]);
  assert.equal(organisation.data().status, "suspended");
  assert.equal(slug.data().status, "suspended");
  assert.equal(directory.data().status, "suspended");
  assert.equal(directory.data().isPublic, true);

  await expectCode(
    invoke("createOrganisationInvitation",
      {organisationId: orgId, email: "invitee@example.com", role: "member"},
      identity(ownerUid, "lifecycle-" + tag + "@example.com")),
    "failed-precondition"
  );

  await governance.setOrganisationLifecycleStatus.run({
    data: {organisationId: orgId, status: "active"},
    auth: identity(ownerUid, "lifecycle-" + tag + "@example.com"),
  });
  directory = await directoryRef.get();
  assert.equal(directory.data().status, "active");
  assert.equal(directory.data().isPublic, true);
  await governance.setOrganisationLifecycleStatus.run({
    data: {organisationId: orgId, status: "closed"},
    auth: identity(ownerUid, "lifecycle-" + tag + "@example.com"),
  });
  [organisation, slug, directory] = await Promise.all([
    db.collection("organisations").doc(orgId).get(), slugRef.get(), directoryRef.get(),
  ]);
  assert.equal(organisation.data().status, "closed");
  assert.equal(slug.data().status, "closed");
  assert.equal(directory.data().status, "closed");

  await expectCode(
    governance.setOrganisationLifecycleStatus.run({
      data: {organisationId: orgId, status: "active"},
      auth: identity(ownerUid, "lifecycle-" + tag + "@example.com"),
    }),
    "failed-precondition"
  );
  const events = await db.collection("organisationActivity")
    .where("organisationId", "==", orgId)
    .where("action", "==", "organisation.lifecycle_status_changed").get();
  assert.equal(events.size, 3);
});
