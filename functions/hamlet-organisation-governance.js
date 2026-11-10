const admin = require("firebase-admin");
const {FieldValue} = require("firebase-admin/firestore");
const {HttpsError, onCall} = require("firebase-functions/v2/https");

function database() {
  try { admin.app(); } catch (err) { admin.initializeApp(); }
  return admin.firestore();
}
function verifiedActor(request) {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "Sign in to continue.");
  }
  if (request.auth.token.email_verified !== true ||
      typeof request.auth.token.email !== "string" ||
      !request.auth.token.email.trim()) {
    throw new HttpsError("failed-precondition", "Verify your email address first.");
  }
  return {uid: request.auth.uid};
}
function documentId(value, field) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 128 ||
      value.includes("/") || value.includes("\\")) {
    throw new HttpsError("invalid-argument", field + " is invalid.");
  }
  return value.trim();
}
function membershipId(orgId, uid) {
  return orgId + "_" + uid;
}
function requireOwner(org, member, uid) {
  if (!org || org.status !== "active" && org.status !== "suspended") {
    throw new HttpsError("failed-precondition", "The organisation is not eligible for this operation.");
  }
  if (!member || member.status !== "active" || member.role !== "owner" ||
      member.uid !== uid || org.ownerUid !== uid) {
    throw new HttpsError("permission-denied", "Only the current organisation owner may perform this operation.");
  }
}
function auditRef(db, orgId) {
  return db.collection("organisationActivity").doc();
}

exports.transferOrganisationOwnership = onCall({
  region: "europe-west2",
  timeoutSeconds: 30,
  memory: "256MiB",
}, async (request) => {
  const actor = verifiedActor(request);
  const orgId = documentId(request.data && request.data.organisationId, "organisationId");
  const targetUid = documentId(request.data && request.data.newOwnerUid, "newOwnerUid");
  if (targetUid === actor.uid) {
    throw new HttpsError("invalid-argument", "The new owner must be another active organisation member.");
  }

  const db = database();
  const orgRef = db.collection("organisations").doc(orgId);
  const previousRef = db.collection("organisationMembers").doc(membershipId(orgId, actor.uid));
  const nextRef = db.collection("organisationMembers").doc(membershipId(orgId, targetUid));

  await db.runTransaction(async (tx) => {
    const [orgSnap, previousSnap, nextSnap] = await Promise.all([
      tx.get(orgRef), tx.get(previousRef), tx.get(nextRef),
    ]);
    const org = orgSnap.exists ? orgSnap.data() : null;
    const previous = previousSnap.exists ? previousSnap.data() : null;
    const next = nextSnap.exists ? nextSnap.data() : null;
    requireOwner(org, previous, actor.uid);
    if (!next || next.status !== "active" || next.organisationId !== orgId ||
        next.uid !== targetUid || next.role === "owner") {
      throw new HttpsError("failed-precondition", "The proposed owner must be an active, non-owner member of this organisation.");
    }

    const now = FieldValue.serverTimestamp();
    tx.update(orgRef, {ownerUid: targetUid, updatedAt: now});
    tx.update(previousRef, {
      role: "admin",
      ownershipTransferredAt: now,
      updatedAt: now,
    });
    tx.update(nextRef, {
      role: "owner",
      ownershipReceivedAt: now,
      updatedAt: now,
    });
    tx.create(auditRef(db, orgId), {
      organisationId: orgId,
      actorUid: actor.uid,
      action: "organisation.ownership_transferred",
      previousOwnerUid: actor.uid,
      newOwnerUid: targetUid,
      createdAt: now,
    });
  });

  return {organisationId: orgId, previousOwnerUid: actor.uid, newOwnerUid: targetUid};
});

exports.setOrganisationLifecycleStatus = onCall({
  region: "europe-west2",
  timeoutSeconds: 30,
  memory: "256MiB",
}, async (request) => {
  const actor = verifiedActor(request);
  const orgId = documentId(request.data && request.data.organisationId, "organisationId");
  const requestedStatus = request.data && request.data.status;
  if (!["active", "suspended", "closed"].includes(requestedStatus)) {
    throw new HttpsError("invalid-argument", "Choose active, suspended or closed.");
  }

  const db = database();
  const orgRef = db.collection("organisations").doc(orgId);
  const ownerRef = db.collection("organisationMembers").doc(membershipId(orgId, actor.uid));
  const slugRef = db.collection("organisationSlugs");
  const directoryRef = db.collection("organisationDirectory").doc(orgId);

  await db.runTransaction(async (tx) => {
    const [orgSnap, ownerSnap] = await Promise.all([tx.get(orgRef), tx.get(ownerRef)]);
    const org = orgSnap.exists ? orgSnap.data() : null;
    const owner = ownerSnap.exists ? ownerSnap.data() : null;
    requireOwner(org, owner, actor.uid);

    const current = org.status;
    const allowed = (current === "active" && ["suspended", "closed"].includes(requestedStatus)) ||
      (current === "suspended" && ["active", "closed"].includes(requestedStatus));
    if (!allowed) {
      throw new HttpsError("failed-precondition", current === "closed"
        ? "A closed organisation cannot be reactivated or changed."
        : "The requested organisation status transition is not permitted.");
    }

    const slug = typeof org.slug === "string" ? org.slug : "";
    if (!slug) throw new HttpsError("failed-precondition", "The organisation has no valid reserved slug.");
    const slugDocument = slugRef.doc(slug);
    const [slugSnap, directorySnap] = await Promise.all([tx.get(slugDocument), tx.get(directoryRef)]);
    if (!slugSnap.exists || !directorySnap.exists) {
      throw new HttpsError("failed-precondition", "The organisation routing or directory records are incomplete.");
    }

    const now = FieldValue.serverTimestamp();
    tx.update(orgRef, {status: requestedStatus, updatedAt: now});
    tx.update(slugDocument, {status: requestedStatus === "active" ? "active" : requestedStatus, updatedAt: now});
    tx.update(directoryRef, {status: requestedStatus, updatedAt: now});
    tx.create(auditRef(db, orgId), {
      organisationId: orgId,
      actorUid: actor.uid,
      action: "organisation.lifecycle_status_changed",
      previousStatus: current,
      status: requestedStatus,
      createdAt: now,
    });
  });

  return {organisationId: orgId, status: requestedStatus};
});
