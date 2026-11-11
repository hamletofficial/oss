const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

process.env.FUNCTIONS_EMULATOR ||= "true";
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

test("organisation profile updates keep public projection whitelisted and admin controlled", async () => {
  const tag = suffix();
  const ownerUid = "profile-owner-" + tag;
  const organisation = await invoke(
    "createOrganisation",
    {name: "Private Starting Name", slug: "profile-" + tag},
    identity(ownerUid, "profile-owner@example.com")
  );
  const profile = {
    organisationId: organisation.organisationId,
    name: "Public Hamlet Group",
    description: "A short public introduction.",
    website: "https://example.com",
    industry: "Commercial property",
    publicLocation: "London, UK",
    visibility: "public",
  };
  const result = await invoke("updateOrganisationProfile", profile, identity(ownerUid, "profile-owner@example.com"));
  assert.equal(result.visibility, "public");

  const org = await db.collection("organisations").doc(organisation.organisationId).get();
  const directory = await db.collection("organisationDirectory").doc(organisation.organisationId).get();
  assert.equal(org.data().name, profile.name);
  assert.equal(org.data().visibility, "public");
  assert.equal(directory.data().isPublic, true);
  assert.equal(directory.data().website, profile.website);
  assert.equal(directory.data().description, profile.description);
  assert.equal(directory.data().ownerUid, undefined);
  assert.equal(directory.data().email, undefined);

  await db.collection("organisationMembers").doc(organisation.organisationId + "_profile-member-" + tag).set({
    organisationId: organisation.organisationId, uid: "profile-member-" + tag, role: "member", status: "active",
  });
  await expectCode(
    invoke("updateOrganisationProfile", {...profile, name: "Member edit"}, identity("profile-member-" + tag, "member@example.com")),
    "permission-denied"
  );
  await expectCode(
    invoke("updateOrganisationProfile", {...profile, website: "javascript:alert(1)"}, identity(ownerUid, "profile-owner@example.com")),
    "invalid-argument"
  );

  await invoke("updateOrganisationProfile", {...profile, visibility: "private"}, identity(ownerUid, "profile-owner@example.com"));
  const hidden = await db.collection("organisationDirectory").doc(organisation.organisationId).get();
  assert.equal(hidden.data().isPublic, false);
});

test("public organisation membership requests are verified and require owner or admin approval", async () => {
  const tag = suffix();
  const ownerUid = "request-owner-" + tag;
  const applicantUid = "applicant-" + tag;
  const organisation = await invoke("createOrganisation", {
    name: "Membership Requests", slug: "request-" + tag,
  }, identity(ownerUid, "request-owner@example.com"));
  await invoke("updateOrganisationProfile", {
    organisationId: organisation.organisationId, name: "Membership Requests",
    description: "Public group", website: "", industry: "", publicLocation: "", visibility: "public",
  }, identity(ownerUid, "request-owner@example.com"));
  await expectCode(
    invoke("requestOrganisationMembership", {organisationId: organisation.organisationId}, identity("unverified-" + tag, "unverified@example.com", false)),
    "failed-precondition"
  );
  const requestResult = await invoke(
    "requestOrganisationMembership", {organisationId: organisation.organisationId}, identity(applicantUid, "applicant@example.com")
  );
  assert.equal(requestResult.status, "pending");
  const repeated = await invoke(
    "requestOrganisationMembership", {organisationId: organisation.organisationId}, identity(applicantUid, "applicant@example.com")
  );
  assert.equal(repeated.status, "pending");
  const requestId = crypto.createHash("sha256").update(organisation.organisationId + "_" + applicantUid).digest("hex");
  const storedRequest = await db.collection("organisationMembershipRequests").doc(requestId).get();
  assert.equal(storedRequest.data().status, "pending");
  await expectCode(
    invoke("reviewOrganisationMembershipRequest", {requestId, approve: true}, identity(applicantUid, "applicant@example.com")),
    "permission-denied"
  );
  const reviewed = await invoke(
    "reviewOrganisationMembershipRequest", {requestId, approve: true}, identity(ownerUid, "request-owner@example.com")
  );
  assert.equal(reviewed.status, "approved");
  const member = await db.collection("organisationMembers").doc(organisation.organisationId + "_" + applicantUid).get();
  assert.equal(member.data().status, "active");
  assert.equal(member.data().role, "member");
});

test("organisation verification is owner-submitted and platform-reviewed with a visible report", async () => {
  const tag = suffix();
  const ownerUid = "verify-owner-" + tag;
  const organisation = await invoke("createOrganisation", {
    name: "Verification Review", slug: "verify-" + tag,
  }, identity(ownerUid, "verify-owner@example.com"));
  await expectCode(invoke("submitOrganisationVerification", {
    organisationId: organisation.organisationId, legalName: "Verified Legal Ltd",
    registrationNumber: "01234567", evidenceUrl: "javascript:alert(1)", attested:true,
  }, identity(ownerUid, "verify-owner@example.com")), "invalid-argument");
  await invoke("submitOrganisationVerification", {
    organisationId: organisation.organisationId, legalName: "Verified Legal Ltd",
    registrationNumber: "01234567", evidenceUrl: "https://find-and-update.company-information.service.gov.uk/company/01234567", attested:true,
  }, identity(ownerUid, "verify-owner@example.com"));
  const pending = await db.collection("organisations").doc(organisation.organisationId).get();
  assert.equal(pending.data().verificationStatus, "pending");
  await expectCode(invoke("listOrganisationVerificationRequests", {}, identity(ownerUid, "verify-owner@example.com")), "permission-denied");
  const platformAdmin = identity("6epDJRISlBbRPWKosDZZWuiGQzK2", "admin@example.com");
  const queue = await invoke("listOrganisationVerificationRequests", {}, platformAdmin);
  assert.ok(queue.requests.some(item => item.organisationId === organisation.organisationId));
  const reviewed = await invoke("reviewOrganisationVerification", {
    organisationId: organisation.organisationId, approved: true, report: "Official registry record matched the legal name and registration number.",
  }, platformAdmin);
  assert.equal(reviewed.status, "verified");
  const [org, directory, verification] = await Promise.all([
    db.collection("organisations").doc(organisation.organisationId).get(),
    db.collection("organisationDirectory").doc(organisation.organisationId).get(),
    db.collection("organisationVerificationRequests").doc(organisation.organisationId).get(),
  ]);
  assert.equal(org.data().verificationStatus, "verified");
  assert.equal(org.data().verificationReport, undefined);
  assert.equal(directory.data().verificationStatus, "verified");
  assert.equal(verification.data().reviewedByUid, platformAdmin.uid);
  assert.match(verification.data().reviewReport, /Official registry record matched/);
  assert.equal((await invoke("getOrganisationVerificationStatus", {organisationId:organisation.organisationId}, identity(ownerUid, "verify-owner@example.com"))).report, verification.data().reviewReport);
});

test("non-owner members can leave and their active team assignments are revoked atomically", async () => {
  const tag = suffix();
  const ownerUid = "leave-owner-" + tag;
  const memberUid = "leave-member-" + tag;
  const organisation = await invoke("createOrganisation", {
    name: "Member Exit", slug: "member-exit-" + tag,
  }, identity(ownerUid, "leave-owner@example.com"));
  await db.collection("organisationMembers").doc(organisation.organisationId + "_" + memberUid).set({
    organisationId: organisation.organisationId, uid: memberUid, role: "member", status: "active",
  });
  await db.collection("organisationTeamMembers").doc("team-" + tag + "_" + memberUid).set({
    organisationId: organisation.organisationId, teamId: "team-" + tag, uid: memberUid, status: "active",
  });
  await expectCode(invoke("leaveOrganisation", {organisationId: organisation.organisationId}, identity(ownerUid, "leave-owner@example.com")), "failed-precondition");
  const result = await invoke("leaveOrganisation", {organisationId: organisation.organisationId}, identity(memberUid, "leave-member@example.com"));
  assert.equal(result.status, "left");
  assert.equal(result.revokedTeamAssignments, 1);
  const member = await db.collection("organisationMembers").doc(organisation.organisationId + "_" + memberUid).get();
  const assignment = await db.collection("organisationTeamMembers").doc("team-" + tag + "_" + memberUid).get();
  assert.equal(member.data().status, "left");
  assert.equal(assignment.data().status, "removed");
});

test("personal resource copies are owner-authorised, restricted snapshots and idempotent", async () => {
  const tag = suffix();
  const ownerUid = "copy-owner-" + tag;
  const organisation = await invoke("createOrganisation", {
    name: "Opt-in Copy", slug: "opt-in-copy-" + tag,
  }, identity(ownerUid, "copy-owner@example.com"));
  const sourceId = "personal-deal-" + tag;
  await db.collection("hamletDeals").doc(sourceId).set({
    id: sourceId, uid: ownerUid, name: "Personal transaction", property: "12 High Street",
    type: "Acquisition", stage: "Due Diligence", value: 250000, owner: "Broker",
    client: "Private client", notes: "Personal notes", createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
  });
  const copied = await invoke("copyPersonalResourceToOrganisation", {
    organisationId: organisation.organisationId, sourceType: "deal", sourceId,
  }, identity(ownerUid, "copy-owner@example.com"));
  const target = await db.collection("organisationDeals").doc(copied.targetResourceId).get();
  const source = await db.collection("hamletDeals").doc(sourceId).get();
  assert.equal(target.data().createdByUid, ownerUid);
  assert.equal(target.data().visibility, "restricted");
  assert.deepEqual(target.data().sharedWithUids, []);
  assert.equal(target.data().notes, "Personal notes");
  assert.equal(source.data().uid, ownerUid);
  assert.equal(source.data().notes, "Personal notes");
  const repeated = await invoke("copyPersonalResourceToOrganisation", {
    organisationId: organisation.organisationId, sourceType: "deal", sourceId,
  }, identity(ownerUid, "copy-owner@example.com"));
  assert.equal(repeated.alreadyImported, true);
  assert.equal(repeated.targetResourceId, copied.targetResourceId);
  await db.collection("hamletDeals").doc("foreign-" + tag).set({uid: "different-owner"});
  await expectCode(invoke("copyPersonalResourceToOrganisation", {
    organisationId: organisation.organisationId, sourceType: "deal", sourceId: "foreign-" + tag,
  }, identity(ownerUid, "copy-owner@example.com")), "permission-denied");
});

test("organisation file deletion callable refuses members without parent-resource write authority", async () => {
  const tag = suffix();
  const ownerUid = "file-owner-" + tag;
  const viewerUid = "file-viewer-" + tag;
  const organisation = await invoke(
    "createOrganisation",
    {name: "File Lifecycle Test", slug: "file-life-" + tag},
    identity(ownerUid, "file-owner@example.com")
  );
  const dealId = "deal-" + tag;
  const documentId = "document-" + tag;
  await db.collection("organisationDeals").doc(dealId).set({
    id: dealId, organisationId: organisation.organisationId, createdByUid: ownerUid,
    visibility: "restricted", sharedWithUids: [], name: "Private deal",
  });
  await db.collection("organisationMembers").doc(organisation.organisationId + "_" + viewerUid).set({
    organisationId: organisation.organisationId, uid: viewerUid, role: "viewer", status: "active",
  });
  await db.collection("organisationDocuments").doc(documentId).set({
    id: documentId, organisationId: organisation.organisationId, resourceType: "deal", resourceId: dealId,
    createdByUid: ownerUid, title: "Private document", fileName: "private.pdf",
    storagePath: "organisationDocuments/" + organisation.organisationId + "/deal/" + dealId + "/" + documentId + "/private.pdf",
    size: 10, contentType: "application/pdf",
  });

  await expectCode(
    invoke("deleteOrganisationDocument", {documentId}, identity(viewerUid, "viewer@example.com")),
    "permission-denied"
  );
  const stored = await db.collection("organisationDocuments").doc(documentId).get();
  assert.equal(stored.exists, true);
  assert.equal(stored.data().deletionStatus, undefined);
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
      data: {organisationId: orgId, newOwnerUid: nextUid},
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
