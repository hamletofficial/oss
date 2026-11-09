const crypto = require("crypto");
const admin = require("firebase-admin");
const {Timestamp, FieldValue} = require("firebase-admin/firestore");
const {HttpsError, onCall} = require("firebase-functions/v2/https");

const REGION = "us-central1";
const CODE_TTL_MS = 90 * 1000;
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/;

function db() {
  if (!admin.apps.length) admin.initializeApp();
  return admin.firestore();
}
function verifiedUser(request) {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "Sign in to continue.");
  }
  if (request.auth.token.email_verified !== true) {
    throw new HttpsError("failed-precondition", "Verify your email address first.");
  }
  return {uid: request.auth.uid};
}
function clean(value, field, max) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
    throw new HttpsError("invalid-argument", field + " is invalid.");
  }
  return value.trim();
}
function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

exports.createOrganisationHandoffCode = onCall({
  region: REGION,
  timeoutSeconds: 15,
  memory: "256MiB",
}, async (request) => {
  const user = verifiedUser(request);
  const organisationId = clean(request.data && request.data.organisationId, "organisationId", 128);
  const slug = clean(request.data && request.data.slug, "slug", 63).toLowerCase();
  if (!SLUG_PATTERN.test(slug)) throw new HttpsError("invalid-argument", "The organisation address is invalid.");

  const database = db();
  const organisationRef = database.collection("organisations").doc(organisationId);
  const memberRef = database.collection("organisationMembers").doc(organisationId + "_" + user.uid);
  const [organisation, member] = await Promise.all([organisationRef.get(), memberRef.get()]);
  if (!organisation.exists || organisation.data().status !== "active" ||
      organisation.data().slug !== slug) {
    throw new HttpsError("not-found", "The active organisation could not be found.");
  }
  if (!member.exists || member.data().status !== "active" ||
      member.data().organisationId !== organisationId || member.data().uid !== user.uid) {
    throw new HttpsError("permission-denied", "You are not an active member of this organisation.");
  }

  const rawCode = crypto.randomBytes(32).toString("base64url");
  const codeHash = hash(rawCode);
  const expiresAt = Timestamp.fromMillis(Date.now() + CODE_TTL_MS);
  await database.collection("organisationHandoffCodes").doc(codeHash).create({
    uid: user.uid,
    organisationId,
    slug,
    status: "pending",
    createdAt: FieldValue.serverTimestamp(),
    expiresAt,
  });
  return {code: rawCode, slug, expiresAt: expiresAt.toDate().toISOString()};
});

exports.exchangeOrganisationHandoffCode = onCall({
  region: REGION,
  timeoutSeconds: 15,
  memory: "256MiB",
  cors: true,
}, async (request) => {
  const rawCode = clean(request.data && request.data.code, "code", 128);
  const slug = clean(request.data && request.data.slug, "slug", 63).toLowerCase();
  if (!SLUG_PATTERN.test(slug)) throw new HttpsError("invalid-argument", "The organisation address is invalid.");

  const database = db();
  const codeRef = database.collection("organisationHandoffCodes").doc(hash(rawCode));
  const now = Timestamp.now();
  const result = await database.runTransaction(async (transaction) => {
    const codeSnap = await transaction.get(codeRef);
    if (!codeSnap.exists) throw new HttpsError("not-found", "The sign-in handoff is invalid or has already been used.");
    const code = codeSnap.data();
    if (code.status !== "pending" || !code.expiresAt || code.expiresAt.toMillis() <= now.toMillis()) {
      throw new HttpsError("failed-precondition", "The sign-in handoff has expired or has already been used.");
    }
    if (code.slug !== slug) throw new HttpsError("permission-denied", "This sign-in handoff is for a different organisation.");
    const organisationRef = database.collection("organisations").doc(code.organisationId);
    const memberRef = database.collection("organisationMembers").doc(code.organisationId + "_" + code.uid);
    const [organisation, member] = await Promise.all([
      transaction.get(organisationRef),
      transaction.get(memberRef),
    ]);
    if (!organisation.exists || organisation.data().status !== "active" ||
        organisation.data().slug !== slug) {
      throw new HttpsError("failed-precondition", "The organisation is no longer active.");
    }
    if (!member.exists || member.data().status !== "active" ||
        member.data().organisationId !== code.organisationId || member.data().uid !== code.uid) {
      throw new HttpsError("permission-denied", "Active organisation membership is required.");
    }
    transaction.update(codeRef, {
      status: "exchanged",
      exchangedAt: FieldValue.serverTimestamp(),
    });
    return {uid: code.uid, organisationId: code.organisationId, slug};
  });

  // The custom token is returned only in this HTTPS response, never in a URL or persisted record.
  const customToken = await admin.auth().createCustomToken(result.uid, {
    hamletOrganisationId: result.organisationId,
    hamletOrganisationSlug: result.slug,
  });
  return {customToken, organisationId: result.organisationId, slug: result.slug};
});
