const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const admin = require("firebase-admin");
const {getFirestore, Timestamp} = require("firebase-admin/firestore");

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("Organisation handoff tests must run against the Firestore Emulator.");
}
if (!admin.apps.length) admin.initializeApp({projectId: process.env.GCLOUD_PROJECT || "demo-hamlet-functions"});
const db = getFirestore();
const organisations = require("../hamlet-organisations");
const handoff = require("../hamlet-organisation-handoff");
const suffix = () => crypto.randomBytes(6).toString("hex");
const identity = (uid, email, verified = true) => ({uid, token: {email, email_verified: verified}});
const invoke = (name, data, auth) => handoff[name].run({data: data || {}, auth: auth || null});
const expectCode = async (promise, code) => assert.rejects(promise, error => {
  assert.equal(error.code, code);
  return true;
});

test("handoff code creation requires verified active organisation membership", async () => {
  const tag = suffix(), uid = "handoff-owner-" + tag, slug = "handoff-" + tag;
  const org = await organisations.createOrganisation.run({data: {name: "Handoff Test", slug}, auth: identity(uid, "owner@example.com")});
  await expectCode(invoke("createOrganisationHandoffCode", {organisationId: org.organisationId, slug}, null), "unauthenticated");
  await expectCode(invoke("createOrganisationHandoffCode", {organisationId: org.organisationId, slug}, identity("stranger-" + tag, "stranger@example.com")), "permission-denied");
  const issued = await invoke("createOrganisationHandoffCode", {organisationId: org.organisationId, slug}, identity(uid, "owner@example.com"));
  assert.equal(issued.slug, slug);
  assert.equal(typeof issued.code, "string");
  assert.ok(issued.code.length >= 40);
  const codeHash = crypto.createHash("sha256").update(issued.code).digest("hex");
  const stored = await db.collection("organisationHandoffCodes").doc(codeHash).get();
  assert.equal(stored.exists, true);
  assert.equal(stored.data().uid, uid);
  assert.equal(stored.data().organisationId, org.organisationId);
  assert.equal(stored.data().status, "pending");
  assert.equal(stored.data().code, undefined);
});

test("handoff exchange binds the slug and consumes a code exactly once", async () => {
  const tag = suffix(), uid = "handoff-owner-" + tag, slug = "tenant-" + tag;
  const org = await organisations.createOrganisation.run({data: {name: "Tenant Handoff", slug}, auth: identity(uid, "owner@example.com")});
  const issued = await invoke("createOrganisationHandoffCode", {organisationId: org.organisationId, slug}, identity(uid, "owner@example.com"));
  await expectCode(invoke("exchangeOrganisationHandoffCode", {code: issued.code, slug: "other-" + tag}, null), "permission-denied");
  const codeHash = crypto.createHash("sha256").update(issued.code).digest("hex");
  assert.equal((await db.collection("organisationHandoffCodes").doc(codeHash).get()).data().status, "pending");

  const authClient = admin.auth();
  const originalGetUser = authClient.getUser;
  const originalCreateCustomToken = authClient.createCustomToken;
  authClient.getUser = async targetUid => {
    assert.equal(targetUid, uid);
    return {uid, disabled: false, emailVerified: true};
  };
  authClient.createCustomToken = async (targetUid, claims) => {
    assert.equal(targetUid, uid);
    assert.equal(claims.hamletOrganisationId, org.organisationId);
    assert.equal(claims.hamletOrganisationSlug, slug);
    return "test-custom-token";
  };
  try {
    const exchanged = await invoke("exchangeOrganisationHandoffCode", {code: issued.code, slug}, null);
    assert.equal(exchanged.customToken, "test-custom-token");
    assert.equal(exchanged.organisationId, org.organisationId);
    assert.equal((await db.collection("organisationHandoffCodes").doc(codeHash).get()).data().status, "exchanged");
    await expectCode(invoke("exchangeOrganisationHandoffCode", {code: issued.code, slug}, null), "failed-precondition");
  } finally {
    authClient.getUser = originalGetUser;
    authClient.createCustomToken = originalCreateCustomToken;
  }
});

test("expired handoff codes cannot be exchanged", async () => {
  const tag = suffix(), raw = crypto.randomBytes(32).toString("base64url");
  const codeHash = crypto.createHash("sha256").update(raw).digest("hex");
  await db.collection("organisationHandoffCodes").doc(codeHash).set({
    uid: "expired-user-" + tag,
    organisationId: "expired-org-" + tag,
    slug: "expired-" + tag,
    status: "pending",
    expiresAt: Timestamp.fromMillis(Date.now() - 1000),
  });
  await expectCode(invoke("exchangeOrganisationHandoffCode", {code: raw, slug: "expired-" + tag}, null), "failed-precondition");
});
