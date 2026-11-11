const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const admin = require("firebase-admin");

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("Organisation team tests must run against the Firestore Emulator.");
}
if (!admin.apps.length) admin.initializeApp({projectId: process.env.GCLOUD_PROJECT || "demo-hamlet-functions"});

const db = admin.firestore();
const organisations = require("../hamlet-organisations");
const teams = require("../hamlet-organisation-teams");
const suffix = () => crypto.randomBytes(5).toString("hex");
const identity = (uid, email, verified = true) => ({uid, token: {email, email_verified: verified}});
const invoke = (name, data, auth) => teams[name].run({data: data || {}, auth: auth || null});
const expectCode = async (promise, code) => assert.rejects(promise, error => {
  assert.equal(error.code, code);
  return true;
});

test("team administration requires a current active owner or administrator in the same tenant", async () => {
  const tag = suffix();
  const ownerUid = "team-owner-" + tag;
  const memberUid = "team-member-" + tag;
  const removedAdminUid = "team-removed-admin-" + tag;
  const first = await organisations.createOrganisation.run({
    data: {name: "Team Tenant One", slug: "team-one-" + tag},
    auth: identity(ownerUid, "owner@example.com"),
  });
  const second = await organisations.createOrganisation.run({
    data: {name: "Team Tenant Two", slug: "team-two-" + tag},
    auth: identity("other-owner-" + tag, "other-owner@example.com"),
  });

  await db.collection("organisationMembers").doc(first.organisationId + "_" + memberUid).set({
    organisationId: first.organisationId, uid: memberUid, role: "member", status: "active",
  });
  await db.collection("organisationMembers").doc(first.organisationId + "_" + removedAdminUid).set({
    organisationId: first.organisationId, uid: removedAdminUid, role: "admin", status: "removed",
  });

  await expectCode(invoke("createOrganisationTeam", {
    organisationId: first.organisationId, name: "Unauthorised", permissions: ["deals.read"],
  }, identity(memberUid, "member@example.com")), "permission-denied");

  const created = await invoke("createOrganisationTeam", {
    organisationId: first.organisationId, name: "Acquisitions", permissions: ["deals.read", "deals.write"],
  }, identity(ownerUid, "owner@example.com"));
  assert.equal(created.organisationId, first.organisationId);

  await expectCode(invoke("updateOrganisationTeam", {
    organisationId: second.organisationId, teamId: created.teamId, name: "Cross-tenant", permissions: [],
  }, identity("other-owner-" + tag, "other-owner@example.com")), "not-found");

  await expectCode(invoke("updateOrganisationTeam", {
    organisationId: first.organisationId, teamId: created.teamId, name: "Stale admin", permissions: [],
  }, identity(removedAdminUid, "removed-admin@example.com")), "permission-denied");

  await invoke("setOrganisationTeamMember", {
    organisationId: first.organisationId, teamId: created.teamId, memberUid, active: true,
  }, identity(ownerUid, "owner@example.com"));
  const assignment = await db.collection("organisationTeamMembers").doc(created.teamId + "_" + memberUid).get();
  assert.equal(assignment.data().status, "active");

  await invoke("archiveOrganisationTeam", {
    organisationId: first.organisationId, teamId: created.teamId,
  }, identity(ownerUid, "owner@example.com"));
  const archived = await db.collection("organisationTeams").doc(created.teamId).get();
  assert.equal(archived.data().status, "archived");
});
