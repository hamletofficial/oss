const crypto = require("crypto");
const admin = require("firebase-admin");
const {getFirestore, Timestamp, FieldValue} = require("firebase-admin/firestore");
const {getStorage} = require("firebase-admin/storage");
const {HttpsError, onCall} = require("firebase-functions/v2/https");

const ALLOWED_MEMBER_ROLES = ["admin", "manager", "member", "viewer"];
const INVITABLE_ROLES = ["admin", "manager", "member", "viewer"];
const RESERVED_SLUGS = new Set([
  "admin", "api", "app", "auth", "billing", "blog", "cdn", "dashboard",
  "docs", "help", "login", "mail", "members", "organisations", "orgs",
  "press", "public", "root", "settings", "signin", "signup", "support",
  "www",
]);
const HAMLET_SUPER_ADMIN_UID = "6epDJRISlBbRPWKosDZZWuiGQzK2";

function getDb() {
  if (!admin.apps.length) admin.initializeApp();
  return getFirestore(admin.app());
}

function requireVerifiedUser(request) {
  const auth = request.auth;
  if (!auth || !auth.uid) {
    throw new HttpsError("unauthenticated", "Sign in to continue.");
  }
  const email = String(auth.token && auth.token.email || "").trim().toLowerCase();
  if (auth.token.email_verified !== true || !email) {
    throw new HttpsError("failed-precondition", "Verify your email address before managing an organisation.");
  }
  return {uid: auth.uid, email};
}

function readString(value, field, min, max) {
  if (typeof value !== "string") {
    throw new HttpsError("invalid-argument", field + " must be text.");
  }
  const clean = value.trim();
  if (clean.length < min || clean.length > max) {
    throw new HttpsError("invalid-argument", field + " must contain between " + min + " and " + max + " characters.");
  }
  return clean;
}

function readOptionalString(value, field, max) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") {
    throw new HttpsError("invalid-argument", field + " must be text.");
  }
  const clean = value.trim();
  if (clean.length > max) {
    throw new HttpsError("invalid-argument", field + " must be no more than " + max + " characters.");
  }
  return clean;
}

function readDocumentId(value, field) {
  const id = readString(value, field, 1, 128);
  if (id.includes("/") || id.includes("\\")) {
    throw new HttpsError("invalid-argument", field + " is invalid.");
  }
  return id;
}

function normaliseSlug(value) {
  const slug = readString(value, "slug", 3, 48).toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug) ||
      slug.includes("--") || RESERVED_SLUGS.has(slug)) {
    throw new HttpsError("invalid-argument", "Choose an available organisation URL name using letters, numbers and single hyphens.");
  }
  return slug;
}

function membershipId(orgId, uid) {
  return orgId + "_" + uid;
}

function membershipRequestId(orgId, uid) {
  return crypto.createHash("sha256").update(orgId + "_" + uid).digest("hex");
}

function requireRole(membership, roles) {
  if (!membership || membership.status !== "active" || !roles.includes(membership.role)) {
    throw new HttpsError("permission-denied", "Your active organisation role does not permit this action.");
  }
}

function activityRef(db, orgId) {
  return db.collection("organisationActivity").doc();
}

exports.createOrganisation = onCall({
  region: "us-central1",
  timeoutSeconds: 30,
  memory: "256MiB",
}, async (request) => {
  const user = requireVerifiedUser(request);
  const name = readString(request.data && request.data.name, "name", 2, 120);
  const slug = normaliseSlug(request.data && request.data.slug);
  const db = getDb();
  const orgRef = db.collection("organisations").doc();
  const slugRef = db.collection("organisationSlugs").doc(slug);
  const memberRef = db.collection("organisationMembers").doc(membershipId(orgRef.id, user.uid));
  const directoryRef = db.collection("organisationDirectory").doc(orgRef.id);
  const now = FieldValue.serverTimestamp();

  await db.runTransaction(async (transaction) => {
    const slugSnap = await transaction.get(slugRef);
    if (slugSnap.exists) {
      throw new HttpsError("already-exists", "That organisation URL name is already in use.");
    }
    transaction.create(orgRef, {
      id: orgRef.id,
      name,
      slug,
      status: "active",
      visibility: "private",
      verificationStatus: "unverified",
      ownerUid: user.uid,
      createdByUid: user.uid,
      createdAt: now,
      updatedAt: now,
    });
    transaction.create(slugRef, {
      organisationId: orgRef.id,
      status: "active",
      createdAt: now,
    });
    transaction.create(memberRef, {
      id: memberRef.id,
      organisationId: orgRef.id,
      uid: user.uid,
      email: user.email,
      role: "owner",
      status: "active",
      joinedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    transaction.create(directoryRef, {
      organisationId: orgRef.id,
      name,
      slug,
      isPublic: false,
      status: "active",
      verificationStatus: "unverified",
      updatedAt: now,
    });
    transaction.create(activityRef(db, orgRef.id), {
      organisationId: orgRef.id,
      actorUid: user.uid,
      action: "organisation.created",
      targetUid: user.uid,
      createdAt: now,
    });
  });

  return {organisationId: orgRef.id, slug, role: "owner"};
});

exports.requestOrganisationMembership = onCall({
  region: "us-central1",
  timeoutSeconds: 30,
  memory: "256MiB",
}, async (request) => {
  const user = requireVerifiedUser(request);
  const orgId = readDocumentId(request.data && request.data.organisationId, "organisationId");
  const db = getDb();
  const orgRef = db.collection("organisations").doc(orgId);
  const memberRef = db.collection("organisationMembers").doc(membershipId(orgId, user.uid));
  const requestRef = db.collection("organisationMembershipRequests").doc(membershipRequestId(orgId, user.uid));
  let response;
  await db.runTransaction(async (transaction) => {
    const [orgSnap, memberSnap, requestSnap] = await Promise.all([
      transaction.get(orgRef), transaction.get(memberRef), transaction.get(requestRef),
    ]);
    const org = orgSnap.exists ? orgSnap.data() : null;
    if (!org || org.status !== "active" || org.visibility !== "public") {
      throw new HttpsError("not-found", "This public organisation is not accepting membership requests.");
    }
    const member = memberSnap.exists ? memberSnap.data() : null;
    if (member && member.status === "active") {
      response = {organisationId: orgId, status: "active"};
      return;
    }
    const existing = requestSnap.exists ? requestSnap.data() : null;
    if (existing && existing.status === "pending") {
      response = {organisationId: orgId, status: "pending"};
      return;
    }
    const now = FieldValue.serverTimestamp();
    transaction.set(requestRef, {
      id: requestRef.id,
      organisationId: orgId,
      requesterUid: user.uid,
      email: user.email,
      status: "pending",
      createdAt: existing && existing.createdAt || now,
      updatedAt: now,
      reviewedAt: FieldValue.delete(),
      reviewedByUid: FieldValue.delete(),
      decision: FieldValue.delete(),
    }, {merge: true});
    transaction.create(activityRef(db, orgId), {
      organisationId: orgId, actorUid: user.uid,
      action: "organisation.membership_requested", targetUid: user.uid,
      createdAt: now,
    });
    response = {organisationId: orgId, status: "pending"};
  });
  return response;
});

exports.reviewOrganisationMembershipRequest = onCall({
  region: "us-central1",
  timeoutSeconds: 30,
  memory: "256MiB",
}, async (request) => {
  const user = requireVerifiedUser(request);
  const requestId = readDocumentId(request.data && request.data.requestId, "requestId");
  const approve = request.data && request.data.approve;
  if (typeof approve !== "boolean") throw new HttpsError("invalid-argument", "approve must be true or false.");
  const db = getDb();
  const requestRef = db.collection("organisationMembershipRequests").doc(requestId);
  let result;
  await db.runTransaction(async (transaction) => {
    const requestSnap = await transaction.get(requestRef);
    if (!requestSnap.exists) throw new HttpsError("not-found", "The membership request was not found.");
    const pending = requestSnap.data();
    const orgId = readDocumentId(pending.organisationId, "organisationId");
    const orgRef = db.collection("organisations").doc(orgId);
    const actorRef = db.collection("organisationMembers").doc(membershipId(orgId, user.uid));
    const targetRef = db.collection("organisationMembers").doc(membershipId(orgId, pending.requesterUid));
    const [orgSnap, actorSnap, targetSnap] = await Promise.all([
      transaction.get(orgRef), transaction.get(actorRef), transaction.get(targetRef),
    ]);
    if (!orgSnap.exists || orgSnap.data().status !== "active") throw new HttpsError("failed-precondition", "The organisation is not currently active.");
    requireRole(actorSnap.exists ? actorSnap.data() : null, ["owner", "admin"]);
    if (pending.status !== "pending") throw new HttpsError("failed-precondition", "This membership request has already been reviewed.");
    if (!pending.requesterUid || !pending.email) throw new HttpsError("failed-precondition", "The membership request is incomplete.");
    const target = targetSnap.exists ? targetSnap.data() : null;
    if (approve && target && target.status === "active") throw new HttpsError("already-exists", "The requester is already an active organisation member.");
    const now = FieldValue.serverTimestamp();
    if (approve) {
      transaction.set(targetRef, {
        id: targetRef.id, organisationId: orgId, uid: pending.requesterUid, email: pending.email,
        role: "member", status: "active", joinedAt: now,
        createdAt: target && target.createdAt || now, updatedAt: now,
        removedAt: FieldValue.delete(), removedByUid: FieldValue.delete(),
      }, {merge: true});
    }
    transaction.update(requestRef, {status: approve ? "approved" : "declined", decision: approve ? "approved" : "declined", reviewedByUid: user.uid, reviewedAt: now, updatedAt: now});
    transaction.create(activityRef(db, orgId), {
      organisationId: orgId, actorUid: user.uid,
      action: approve ? "organisation.membership_request_approved" : "organisation.membership_request_declined",
      targetUid: pending.requesterUid, createdAt: now,
    });
    result = {organisationId: orgId, requesterUid: pending.requesterUid, status: approve ? "approved" : "declined"};
  });
  return result;
});

exports.updateOrganisationProfile = onCall({
  region: "us-central1",
  timeoutSeconds: 30,
  memory: "256MiB",
}, async (request) => {
  const user = requireVerifiedUser(request);
  const orgId = readDocumentId(request.data && request.data.organisationId, "organisationId");
  const name = readString(request.data && request.data.name, "name", 2, 120);
  const description = readOptionalString(request.data && request.data.description, "description", 500);
  const industry = readOptionalString(request.data && request.data.industry, "industry", 80);
  const publicLocation = readOptionalString(request.data && request.data.publicLocation, "publicLocation", 120);
  const visibility = request.data && request.data.visibility;
  if (!["public", "private"].includes(visibility)) {
    throw new HttpsError("invalid-argument", "Choose public or private organisation visibility.");
  }
  const website = readOptionalString(request.data && request.data.website, "website", 254);
  if (website) {
    let parsed;
    try { parsed = new URL(website); } catch (error) {
      throw new HttpsError("invalid-argument", "Enter a valid HTTPS website address.");
    }
    if (parsed.protocol !== "https:" || !parsed.hostname || parsed.username || parsed.password) {
      throw new HttpsError("invalid-argument", "Enter a valid HTTPS website address.");
    }
  }

  const db = getDb();
  const orgRef = db.collection("organisations").doc(orgId);
  const memberRef = db.collection("organisationMembers").doc(membershipId(orgId, user.uid));
  const directoryRef = db.collection("organisationDirectory").doc(orgId);
  const fields = {name, description, website, industry, publicLocation, visibility};
  await db.runTransaction(async (transaction) => {
    const [orgSnap, memberSnap, directorySnap] = await Promise.all([
      transaction.get(orgRef), transaction.get(memberRef), transaction.get(directoryRef),
    ]);
    if (!orgSnap.exists || orgSnap.data().status !== "active") {
      throw new HttpsError("failed-precondition", "The organisation is not currently active.");
    }
    const member = memberSnap.exists ? memberSnap.data() : null;
    requireRole(member, ["owner", "admin"]);
    if (!directorySnap.exists || directorySnap.data().organisationId !== orgId) {
      throw new HttpsError("failed-precondition", "The public organisation profile is unavailable.");
    }
    const now = FieldValue.serverTimestamp();
    transaction.update(orgRef, {...fields, updatedAt: now});
    transaction.update(directoryRef, {
      organisationId: orgId,
      name,
      slug: orgSnap.data().slug,
      description,
      website,
      industry,
      publicLocation,
      isPublic: visibility === "public",
      status: orgSnap.data().status,
      verificationStatus: directorySnap.data().verificationStatus || orgSnap.data().verificationStatus || "unverified",
      updatedAt: now,
    });
    transaction.create(activityRef(db, orgId), {
      organisationId: orgId,
      actorUid: user.uid,
      action: "organisation.profile_updated",
      changedFields: ["name", "description", "website", "industry", "publicLocation", "visibility"],
      createdAt: now,
    });
  });
  return {organisationId: orgId, ...fields};
});

exports.submitOrganisationVerification = onCall({region:"us-central1", timeoutSeconds:30, memory:"256MiB"}, async (request) => {
  const user = requireVerifiedUser(request);
  const orgId = readDocumentId(request.data && request.data.organisationId, "organisationId");
  const legalName = readString(request.data && request.data.legalName, "registered legal name", 2, 160);
  const registrationNumber = readString(request.data && request.data.registrationNumber, "registration number", 2, 80);
  if (!request.data || request.data.attested !== true) throw new HttpsError("failed-precondition", "Confirm you are authorised and the submitted details are accurate.");
  const evidenceUrl = readString(request.data && request.data.evidenceUrl, "official registry or evidence URL", 8, 500);
  let parsed;
  try { parsed = new URL(evidenceUrl); } catch (error) {
    throw new HttpsError("invalid-argument", "Enter a valid HTTPS official registry or evidence URL.");
  }
  if (parsed.protocol !== "https:" || !parsed.hostname || parsed.username || parsed.password) {
    throw new HttpsError("invalid-argument", "Enter a valid HTTPS official registry or evidence URL.");
  }
  const db = getDb();
  const orgRef = db.collection("organisations").doc(orgId);
  const memberRef = db.collection("organisationMembers").doc(membershipId(orgId, user.uid));
  const directoryRef = db.collection("organisationDirectory").doc(orgId);
  const verificationRef = db.collection("organisationVerificationRequests").doc(orgId);
  let result;
  await db.runTransaction(async (tx) => {
    const [orgSnap, memberSnap, verificationSnap, directorySnap] = await Promise.all([
      tx.get(orgRef), tx.get(memberRef), tx.get(verificationRef), tx.get(directoryRef),
    ]);
    if (!orgSnap.exists || orgSnap.data().status !== "active") throw new HttpsError("not-found", "Active organisation not found.");
    requireRole(memberSnap.exists ? memberSnap.data() : null, ["owner", "admin"]);
    if (orgSnap.data().verificationStatus === "verified") throw new HttpsError("failed-precondition", "This organisation is already verified.");
    if (verificationSnap.exists && verificationSnap.data().status === "pending") {
      throw new HttpsError("already-exists", "A verification request is already awaiting review.");
    }
    if (!directorySnap.exists) throw new HttpsError("failed-precondition", "The organisation directory projection is unavailable.");
    const now = FieldValue.serverTimestamp();
    tx.set(verificationRef, {
      organisationId: orgId, organisationName: orgSnap.data().name,
      legalName, registrationNumber, evidenceUrl, submittedByUid: user.uid,
      attested: true, status: "pending", submittedAt: now, updatedAt: now,
    });
    tx.update(orgRef, {verificationStatus:"pending", updatedAt:now});
    tx.update(directoryRef, {verificationStatus:"pending", updatedAt:now});
    tx.create(activityRef(db, orgId), {organisationId:orgId, actorUid:user.uid, action:"organisation.verification_requested", createdAt:now});
    result = {organisationId:orgId, status:"pending"};
  });
  return result;
});

exports.getOrganisationVerificationStatus = onCall({region:"us-central1", timeoutSeconds:30, memory:"256MiB"}, async (request) => {
  const user = requireVerifiedUser(request);
  const orgId = readDocumentId(request.data && request.data.organisationId, "organisationId");
  const db = getDb();
  const memberSnap = await db.collection("organisationMembers").doc(membershipId(orgId, user.uid)).get();
  requireRole(memberSnap.exists ? memberSnap.data() : null, ["owner", "admin"]);
  const verificationSnap = await db.collection("organisationVerificationRequests").doc(orgId).get();
  if (!verificationSnap.exists) return {status:"unverified", report:""};
  const verification = verificationSnap.data();
  return {status:verification.status, report:verification.reviewReport || "", legalName:verification.legalName || "", registrationNumber:verification.registrationNumber || ""};
});

exports.listOrganisationVerificationRequests = onCall({region:"us-central1", timeoutSeconds:30, memory:"256MiB"}, async (request) => {
  const user = requireVerifiedUser(request);
  if (user.uid !== HAMLET_SUPER_ADMIN_UID) throw new HttpsError("permission-denied", "Platform administrator access is required.");
  const snapshot = await getDb().collection("organisationVerificationRequests").where("status", "==", "pending").orderBy("submittedAt", "asc").limit(100).get();
  return {requests:snapshot.docs.map(doc => ({id:doc.id, ...doc.data(), submittedAt:doc.data().submittedAt && doc.data().submittedAt.toDate().toISOString()}))};
});

exports.reviewOrganisationVerification = onCall({region:"us-central1", timeoutSeconds:30, memory:"256MiB"}, async (request) => {
  const user = requireVerifiedUser(request);
  if (user.uid !== HAMLET_SUPER_ADMIN_UID) throw new HttpsError("permission-denied", "Platform administrator access is required.");
  const orgId = readDocumentId(request.data && request.data.organisationId, "organisationId");
  const approved = request.data && request.data.approved;
  if (typeof approved !== "boolean") throw new HttpsError("invalid-argument", "Choose whether to approve this verification request.");
  const report = readOptionalString(request.data && request.data.report, "review report", 500);
  if (!report) throw new HttpsError("invalid-argument", "Add a short review report for the organisation.");
  const db = getDb();
  const orgRef = db.collection("organisations").doc(orgId);
  const directoryRef = db.collection("organisationDirectory").doc(orgId);
  const requestRef = db.collection("organisationVerificationRequests").doc(orgId);
  await db.runTransaction(async (tx) => {
    const [orgSnap, directorySnap, verificationSnap] = await Promise.all([tx.get(orgRef), tx.get(directoryRef), tx.get(requestRef)]);
    if (!orgSnap.exists || orgSnap.data().status !== "active" || !directorySnap.exists) throw new HttpsError("not-found", "Active organisation not found.");
    if (!verificationSnap.exists || verificationSnap.data().status !== "pending") throw new HttpsError("failed-precondition", "This verification request is no longer pending.");
    const status = approved ? "verified" : "rejected";
    const now = FieldValue.serverTimestamp();
    tx.update(requestRef, {status, reviewReport:report, reviewedByUid:user.uid, reviewedAt:now, updatedAt:now});
    tx.update(orgRef, {verificationStatus:status, updatedAt:now});
    tx.update(directoryRef, {verificationStatus:status, updatedAt:now});
    tx.create(activityRef(db, orgId), {organisationId:orgId, actorUid:user.uid, action:"organisation.verification_reviewed", verificationStatus:status, createdAt:now});
  });
  return {organisationId:orgId, status:approved?"verified":"rejected"};
});

exports.deleteOrganisationDocument = onCall({
  region: "us-central1",
  timeoutSeconds: 60,
  memory: "256MiB",
}, async (request) => {
  const user = requireVerifiedUser(request);
  const documentId = readDocumentId(request.data && request.data.documentId, "documentId");
  const db = getDb();
  const fileRef = db.collection("organisationDocuments").doc(documentId);
  let path = "";

  await db.runTransaction(async (transaction) => {
    const fileSnap = await transaction.get(fileRef);
    if (!fileSnap.exists) throw new HttpsError("not-found", "The organisation file was not found.");
    const file = fileSnap.data();
    const orgId = readDocumentId(file.organisationId, "organisationId");
    const resourceType = file.resourceType;
    if (!['deal', 'property'].includes(resourceType)) throw new HttpsError("failed-precondition", "The file is not linked to a supported organisation resource.");
    const resourceId = readDocumentId(file.resourceId, "resourceId");
    const expectedPrefix = "organisationDocuments/" + orgId + "/" + resourceType + "/" + resourceId + "/" + documentId + "/";
    if (typeof file.storagePath !== "string" || !file.storagePath.startsWith(expectedPrefix) || file.storagePath.slice(expectedPrefix.length).includes("/")) {
      throw new HttpsError("failed-precondition", "The file storage reference is invalid.");
    }
    const orgRef = db.collection("organisations").doc(orgId);
    const memberRef = db.collection("organisationMembers").doc(membershipId(orgId, user.uid));
    const parentCollection = resourceType === "deal" ? "organisationDeals" : "organisationProperties";
    const parentRef = db.collection(parentCollection).doc(resourceId);
    const [orgSnap, memberSnap, parentSnap] = await Promise.all([
      transaction.get(orgRef), transaction.get(memberRef), transaction.get(parentRef),
    ]);
    const member = memberSnap.exists ? memberSnap.data() : null;
    const parent = parentSnap.exists ? parentSnap.data() : null;
    if (!orgSnap.exists || orgSnap.data().status !== "active" || !member || member.status !== "active" ||
        member.organisationId !== orgId || !parent || parent.organisationId !== orgId) {
      throw new HttpsError("permission-denied", "Active organisation and resource access is required.");
    }
    let allowed = ["owner", "admin"].includes(member.role) ||
      (member.role === "member" && parent.createdByUid === user.uid);
    if (!allowed && member.role === "manager" &&
        (parent.visibility === "organisation" || parent.createdByUid === user.uid)) allowed = true;
    if (!allowed && typeof parent.teamId === "string" && member.role === "manager") {
      const teamRef = db.collection("organisationTeams").doc(parent.teamId);
      const assignmentRef = db.collection("organisationTeamMembers").doc(parent.teamId + "_" + user.uid);
      const [teamSnap, assignmentSnap] = await Promise.all([transaction.get(teamRef), transaction.get(assignmentRef)]);
      const capability = resourceType === "deal" ? "deals" : "properties";
      const team = teamSnap.exists ? teamSnap.data() : null;
      const assignment = assignmentSnap.exists ? assignmentSnap.data() : null;
      allowed = !!team && team.organisationId === orgId && team.status === "active" &&
        Array.isArray(team.permissions) && team.permissions.includes(capability + ".read") &&
        team.permissions.includes(capability + ".write") && assignment &&
        assignment.organisationId === orgId && assignment.status === "active";
    }
    if (!allowed) throw new HttpsError("permission-denied", "Your organisation role does not permit deleting this file.");
    path = file.storagePath;
    transaction.update(fileRef, {deletionStatus: "deleting", deletionRequestedByUid: user.uid, deletionRequestedAt: FieldValue.serverTimestamp()});
  });

  try {
    const bucket = getStorage(admin.app()).bucket();
    await bucket.file(path).delete({ignoreNotFound: true});
  } catch (error) {
    await fileRef.update({deletionStatus: "active", deletionRequestedByUid: FieldValue.delete(), deletionRequestedAt: FieldValue.delete()});
    console.error("Organisation document object deletion failed:", documentId, error);
    throw new HttpsError("unavailable", "The file could not be deleted. Try again later.");
  }
  try {
    await db.runTransaction(async (transaction) => {
      const fileSnap = await transaction.get(fileRef);
      if (fileSnap.exists && fileSnap.data().deletionStatus === "deleting") transaction.delete(fileRef);
    });
  } catch (error) {
    try { await fileRef.update({deletionStatus: "missing"}); } catch (ignored) {}
    console.error("Organisation document metadata deletion failed:", documentId, error);
    throw new HttpsError("unavailable", "The stored file was removed but its record needs cleanup. Retry deletion to finish.");
  }
  return {documentId, deleted: true};
});

exports.createOrganisationInvitation = onCall({
  region: "us-central1",
  timeoutSeconds: 30,
  memory: "256MiB",
}, async (request) => {
  const user = requireVerifiedUser(request);
  const orgId = readDocumentId(request.data && request.data.organisationId, "organisationId");
  const email = readString(request.data && request.data.email, "email", 5, 254).toLowerCase();
  const role = readString(request.data && request.data.role, "role", 4, 12);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpsError("invalid-argument", "Enter a valid invitation email address.");
  }
  if (!INVITABLE_ROLES.includes(role)) {
    throw new HttpsError("invalid-argument", "The requested invitation role is not permitted.");
  }
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const db = getDb();
  const orgRef = db.collection("organisations").doc(orgId);
  const actorRef = db.collection("organisationMembers").doc(membershipId(orgId, user.uid));
  const inviteRef = db.collection("organisationInvitations").doc(tokenHash);
  const now = Timestamp.now();
  const expiresAt = Timestamp.fromMillis(now.toMillis() + 7 * 24 * 60 * 60 * 1000);

  await db.runTransaction(async (transaction) => {
    const [orgSnap, actorSnap] = await Promise.all([
      transaction.get(orgRef),
      transaction.get(actorRef),
    ]);
    if (!orgSnap.exists) {
      throw new HttpsError("not-found", "The organisation was not found.");
    }
    if (orgSnap.data().status !== "active") {
      throw new HttpsError("failed-precondition", "The organisation is not currently active.");
    }
    const actor = actorSnap.exists ? actorSnap.data() : null;
    requireRole(actor, ["owner", "admin"]);
    if (role === "admin" && actor.role !== "owner") {
      throw new HttpsError("permission-denied", "Only the organisation owner can invite an administrator.");
    }
    transaction.create(inviteRef, {
      organisationId: orgId,
      email,
      role,
      invitedByUid: user.uid,
      status: "pending",
      tokenHash,
      createdAt: now,
      expiresAt,
    });
    transaction.create(activityRef(db, orgId), {
      organisationId: orgId,
      actorUid: user.uid,
      action: "organisation.invitation_created",
      invitationEmail: email,
      role,
      createdAt: now,
    });
  });

  // The raw token is returned once. Only its SHA-256 hash is persisted.
  return {invitationId: tokenHash, token, expiresAt: expiresAt.toDate().toISOString(), email, role};
});

exports.acceptOrganisationInvitation = onCall({
  region: "us-central1",
  timeoutSeconds: 30,
  memory: "256MiB",
}, async (request) => {
  const user = requireVerifiedUser(request);
  const token = readString(request.data && request.data.token, "token", 32, 128);
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const db = getDb();
  const inviteRef = db.collection("organisationInvitations").doc(tokenHash);
  const now = Timestamp.now();

  const result = await db.runTransaction(async (transaction) => {
    const inviteSnap = await transaction.get(inviteRef);
    if (!inviteSnap.exists) {
      throw new HttpsError("not-found", "This invitation is invalid or has already been used.");
    }
    const invite = inviteSnap.data();
    if (invite.status !== "pending" || !invite.expiresAt ||
        invite.expiresAt.toMillis() <= now.toMillis()) {
      throw new HttpsError("failed-precondition", "This invitation has expired or is no longer active.");
    }
    if (invite.email !== user.email) {
      throw new HttpsError("permission-denied", "Sign in with the verified email address to which this invitation was sent.");
    }
    const orgRef = db.collection("organisations").doc(invite.organisationId);
    const memberRef = db.collection("organisationMembers").doc(membershipId(invite.organisationId, user.uid));
    const [orgSnap, memberSnap] = await Promise.all([
      transaction.get(orgRef),
      transaction.get(memberRef),
    ]);
    if (!orgSnap.exists || orgSnap.data().status !== "active") {
      throw new HttpsError("failed-precondition", "This organisation is not currently active.");
    }
    if (memberSnap.exists && memberSnap.data().status === "active") {
      throw new HttpsError("already-exists", "You are already an active member of this organisation.");
    }
    transaction.set(memberRef, {
      id: memberRef.id,
      organisationId: invite.organisationId,
      uid: user.uid,
      email: user.email,
      role: invite.role,
      status: "active",
      joinedAt: now,
      createdAt: memberSnap.exists ? (memberSnap.data().createdAt || now) : now,
      updatedAt: now,
      removedAt: FieldValue.delete(),
      removedByUid: FieldValue.delete(),
    }, {merge: true});
    transaction.update(inviteRef, {
      status: "accepted",
      acceptedByUid: user.uid,
      acceptedAt: now,
    });
    transaction.create(activityRef(db, invite.organisationId), {
      organisationId: invite.organisationId,
      actorUid: user.uid,
      action: "organisation.invitation_accepted",
      targetUid: user.uid,
      createdAt: now,
    });
    return {organisationId: invite.organisationId, role: invite.role};
  });

  return result;
});

exports.changeOrganisationMemberRole = onCall({
  region: "us-central1",
  timeoutSeconds: 30,
  memory: "256MiB",
}, async (request) => {
  const user = requireVerifiedUser(request);
  const orgId = readDocumentId(request.data && request.data.organisationId, "organisationId");
  const targetUid = readDocumentId(request.data && request.data.memberUid, "memberUid");
  const role = readString(request.data && request.data.role, "role", 4, 12);
  if (!ALLOWED_MEMBER_ROLES.includes(role)) {
    throw new HttpsError("invalid-argument", "The requested membership role is not permitted.");
  }
  if (targetUid === user.uid) {
    throw new HttpsError("failed-precondition", "You cannot change your own organisation role.");
  }
  const db = getDb();
  const orgRef = db.collection("organisations").doc(orgId);
  const actorRef = db.collection("organisationMembers").doc(membershipId(orgId, user.uid));
  const targetRef = db.collection("organisationMembers").doc(membershipId(orgId, targetUid));
  await db.runTransaction(async (transaction) => {
    const [orgSnap, actorSnap, targetSnap] = await Promise.all([
      transaction.get(orgRef),
      transaction.get(actorRef),
      transaction.get(targetRef),
    ]);
    if (!orgSnap.exists || orgSnap.data().status !== "active") {
      throw new HttpsError("failed-precondition", "The organisation is not currently active.");
    }
    const actor = actorSnap.exists ? actorSnap.data() : null;
    const target = targetSnap.exists ? targetSnap.data() : null;
    requireRole(actor, ["owner", "admin"]);
    if (!target || target.status !== "active" || target.organisationId !== orgId) {
      throw new HttpsError("not-found", "The active organisation member was not found.");
    }
    if (target.role === "owner") {
      throw new HttpsError("failed-precondition", "The owner role can only be changed through an explicit ownership transfer.");
    }
    if (actor.role !== "owner" && (target.role === "admin" || role === "admin")) {
      throw new HttpsError("permission-denied", "Only the organisation owner can manage administrator roles.");
    }
    transaction.update(targetRef, {role, updatedAt: FieldValue.serverTimestamp()});
    transaction.create(activityRef(db, orgId), {
      organisationId: orgId,
      actorUid: user.uid,
      action: "organisation.member_role_changed",
      targetUid,
      role,
      createdAt: FieldValue.serverTimestamp(),
    });
  });

  return {organisationId: orgId, memberUid: targetUid, role};
});

exports.removeOrganisationMember = onCall({
  region: "us-central1",
  timeoutSeconds: 30,
  memory: "256MiB",
}, async (request) => {
  const user = requireVerifiedUser(request);
  const orgId = readDocumentId(request.data && request.data.organisationId, "organisationId");
  const targetUid = readDocumentId(request.data && request.data.memberUid, "memberUid");
  if (targetUid === user.uid) {
    throw new HttpsError("failed-precondition", "Use an explicit ownership transfer before leaving an organisation you own.");
  }
  const db = getDb();
  const orgRef = db.collection("organisations").doc(orgId);
  const actorRef = db.collection("organisationMembers").doc(membershipId(orgId, user.uid));
  const targetRef = db.collection("organisationMembers").doc(membershipId(orgId, targetUid));
  const teamAssignments = db.collection("organisationTeamMembers")
    .where("organisationId", "==", orgId).where("uid", "==", targetUid).where("status", "==", "active");

  await db.runTransaction(async (transaction) => {
    const [orgSnap, actorSnap, targetSnap, assignmentSnap] = await Promise.all([
      transaction.get(orgRef),
      transaction.get(actorRef),
      transaction.get(targetRef),
      transaction.get(teamAssignments),
    ]);
    if (!orgSnap.exists || orgSnap.data().status !== "active") {
      throw new HttpsError("failed-precondition", "The organisation is not currently active.");
    }
    const actor = actorSnap.exists ? actorSnap.data() : null;
    const target = targetSnap.exists ? targetSnap.data() : null;
    requireRole(actor, ["owner", "admin"]);
    if (!target || target.status !== "active" || target.organisationId !== orgId) {
      throw new HttpsError("not-found", "The active organisation member was not found.");
    }
    if (target.role === "owner" ||
        (actor.role !== "owner" && target.role === "admin")) {
      throw new HttpsError("permission-denied", "You cannot remove this organisation member.");
    }
    transaction.update(targetRef, {
      status: "removed",
      removedAt: FieldValue.serverTimestamp(),
      removedByUid: user.uid,
      updatedAt: FieldValue.serverTimestamp(),
    });
    assignmentSnap.docs.forEach((assignment) => transaction.update(assignment.ref, {
      status: "removed",
      removedAt: FieldValue.serverTimestamp(),
      removedByUid: user.uid,
      updatedAt: FieldValue.serverTimestamp(),
    }));
    transaction.create(activityRef(db, orgId), {
      organisationId: orgId,
      actorUid: user.uid,
      action: "organisation.member_removed",
      targetUid,
      revokedTeamAssignments: assignmentSnap.size,
      createdAt: FieldValue.serverTimestamp(),
    });
  });

  return {organisationId: orgId, memberUid: targetUid, status: "removed"};
});

exports.leaveOrganisation = onCall({
  region: "us-central1",
  timeoutSeconds: 30,
  memory: "256MiB",
}, async (request) => {
  const user = requireVerifiedUser(request);
  const orgId = readDocumentId(request.data && request.data.organisationId, "organisationId");
  const db = getDb();
  const orgRef = db.collection("organisations").doc(orgId);
  const memberRef = db.collection("organisationMembers").doc(membershipId(orgId, user.uid));
  const teamAssignments = db.collection("organisationTeamMembers")
    .where("organisationId", "==", orgId).where("uid", "==", user.uid).where("status", "==", "active");
  let revokedAssignments = 0;
  await db.runTransaction(async (transaction) => {
    const [orgSnap, memberSnap, assignmentSnap] = await Promise.all([
      transaction.get(orgRef), transaction.get(memberRef), transaction.get(teamAssignments),
    ]);
    const org = orgSnap.exists ? orgSnap.data() : null;
    const member = memberSnap.exists ? memberSnap.data() : null;
    if (!org || !["active", "suspended"].includes(org.status)) throw new HttpsError("failed-precondition", "The organisation is not available for membership changes.");
    if (!member || member.status !== "active" || member.organisationId !== orgId || member.uid !== user.uid) {
      throw new HttpsError("not-found", "You are not an active member of this organisation.");
    }
    if (member.role === "owner" || org.ownerUid === user.uid) {
      throw new HttpsError("failed-precondition", "Transfer organisation ownership before leaving.");
    }
    const now = FieldValue.serverTimestamp();
    transaction.update(memberRef, {status: "left", leftAt: now, leftByUid: user.uid, updatedAt: now});
    assignmentSnap.docs.forEach((assignment) => {
      transaction.update(assignment.ref, {status: "removed", removedAt: now, removedByUid: user.uid, updatedAt: now});
    });
    revokedAssignments = assignmentSnap.size;
    transaction.create(activityRef(db, orgId), {
      organisationId: orgId, actorUid: user.uid, targetUid: user.uid,
      action: "organisation.member_left", revokedTeamAssignments: revokedAssignments, createdAt: now,
    });
  });
  return {organisationId: orgId, status: "left", revokedTeamAssignments: revokedAssignments};
});

exports.getOrganisationAnalytics = onCall({
  region: "us-central1",
  timeoutSeconds: 30,
  memory: "256MiB",
}, async (request) => {
  const user = requireVerifiedUser(request);
  const orgId = readDocumentId(request.data && request.data.organisationId, "organisationId");
  const db = getDb();
  const memberRef = db.collection("organisationMembers").doc(membershipId(orgId, user.uid));
  const [orgSnap, memberSnap] = await Promise.all([db.collection("organisations").doc(orgId).get(), memberRef.get()]);
  if (!orgSnap.exists || orgSnap.data().status !== "active") throw new HttpsError("not-found", "Active organisation not found.");
  requireRole(memberSnap.exists ? memberSnap.data() : null, ["owner", "admin"]);
  const count = async (collection, filters = []) => {
    let query = db.collection(collection).where("organisationId", "==", orgId);
    filters.forEach(([field, value]) => { query = query.where(field, "==", value); });
    const snapshot = await query.count().get();
    return snapshot.data().count;
  };
  const stages = ["Initial Inspection", "LOI Issued", "Due Diligence", "Under Contract", "Lease Execution", "Closing", "Commission Payout", "Closed"];
  const [members, teams, deals, properties, dealsByStage, propertiesByType] = await Promise.all([
    count("organisationMembers", [["status", "==", "active"]]),
    count("organisationTeams", [["status", "==", "active"]]),
    count("organisationDeals"),
    count("organisationProperties"),
    Promise.all(stages.map(async (stage) => [stage, await count("organisationDeals", [["stage", "==", stage]])])),
    Promise.all(["Commercial", "Residential"].map(async (type) => [type, await count("organisationProperties", [["propertyType", "==", type]])])),
  ]);
  return {organisationId: orgId, members, teams, deals, properties, dealsByStage: Object.fromEntries(dealsByStage), propertiesByType: Object.fromEntries(propertiesByType)};
});

exports.copyPersonalResourceToOrganisation = onCall({
  region: "us-central1",
  timeoutSeconds: 30,
  memory: "256MiB",
}, async (request) => {
  const user = requireVerifiedUser(request);
  const orgId = readDocumentId(request.data && request.data.organisationId, "organisationId");
  const sourceType = request.data && request.data.sourceType;
  const sourceId = readDocumentId(request.data && request.data.sourceId, "sourceId");
  const sourceConfig = {
    deal: {collection: "hamletDeals", target: "organisationDeals"},
    commercialProperty: {collection: "commercialProperties", target: "organisationProperties"},
    residentialProperty: {collection: "residentialProperties", target: "organisationProperties"},
  }[sourceType];
  if (!sourceConfig) throw new HttpsError("invalid-argument", "Choose a supported personal deal or property record.");
  const db = getDb();
  const orgRef = db.collection("organisations").doc(orgId);
  const memberRef = db.collection("organisationMembers").doc(membershipId(orgId, user.uid));
  const sourceRef = db.collection(sourceConfig.collection).doc(sourceId);
  const importId = crypto.createHash("sha256").update(orgId + "_" + sourceType + "_" + sourceId).digest("hex");
  const importRef = db.collection("organisationResourceImports").doc(importId);
  const targetRef = db.collection(sourceConfig.target).doc();
  let alreadyImported = false;

  await db.runTransaction(async (transaction) => {
    const [orgSnap, memberSnap, sourceSnap, importSnap] = await Promise.all([
      transaction.get(orgRef), transaction.get(memberRef), transaction.get(sourceRef), transaction.get(importRef),
    ]);
    const org = orgSnap.exists ? orgSnap.data() : null;
    const member = memberSnap.exists ? memberSnap.data() : null;
    if (!org || org.status !== "active") throw new HttpsError("failed-precondition", "The organisation is not currently active.");
    requireRole(member, ["owner", "admin", "manager", "member"]);
    if (!sourceSnap.exists) throw new HttpsError("not-found", "The personal source record was not found.");
    const source = sourceSnap.data() || {};
    const sourceOwner = sourceType === "deal" ? source.uid : source.ownerUid;
    if (sourceOwner !== user.uid) throw new HttpsError("permission-denied", "Only the personal record owner can copy this record into an organisation.");
    if (importSnap.exists) {
      alreadyImported = true;
      return;
    }
    const now = FieldValue.serverTimestamp();
    let target;
    if (sourceType === "deal") {
      const dealTypes = ["Acquisition", "Disposal", "Leasing", "Investment", "Development"];
      const stages = ["Initial Inspection", "LOI Issued", "Due Diligence", "Under Contract", "Lease Execution", "Closing", "Commission Payout", "Closed"];
      target = {
        id: targetRef.id, organisationId: orgId, createdByUid: user.uid,
        visibility: "restricted", sharedWithUids: [],
        name: readOptionalString(source.name, "deal name", 120) || "Imported personal deal",
        type: dealTypes.includes(source.type) ? source.type : "Acquisition",
        stage: stages.includes(source.stage) ? source.stage : "Initial Inspection",
        value: typeof source.value === "number" && Number.isFinite(source.value) && source.value >= 0 ? source.value : null,
        client: readOptionalString(source.client, "client", 120),
        property: readOptionalString(source.property, "property", 180),
        owner: readOptionalString(source.owner, "owner", 120),
        notes: readOptionalString(source.notes, "notes", 4000),
        createdAt: now, updatedAt: now,
      };
    } else {
      const allowedStatuses = ["Available", "Draft", "Under Offer", "Let", "Sold", "Withdrawn"];
      const numeric = (value, max) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max ? value : null;
      const rawName = source.propertyName || source.name || source.address || source.addressLine1;
      const propertyName = readString(typeof rawName === "string" ? rawName : "", "property name", 1, 180);
      const propertyType = sourceType === "residentialProperty" ? "Residential" : "Commercial";
      const rawSizeUnit = source.sizeUnit || source.unit;
      target = {
        id: targetRef.id, organisationId: orgId, createdByUid: user.uid,
        visibility: "restricted", sharedWithUids: [],
        propertyName, propertyType,
        status: allowedStatuses.includes(source.status) ? source.status : "Draft",
        address: readOptionalString(source.address || source.addressLine1, "address", 300),
        city: readOptionalString(source.city || source.town, "city", 100),
        postcode: readOptionalString(source.postcode, "postcode", 20),
        size: numeric(source.size || source.floorArea, 100000000),
        ...( ["sq ft", "sq m", "acres"].includes(rawSizeUnit) ? {sizeUnit: rawSizeUnit} : {} ),
        askingPrice: numeric(source.askingPrice || source.price, 1000000000000),
        askingRent: numeric(source.askingRent || source.rent, 1000000000000),
        sustainabilityStandard: readOptionalString(source.sustainabilityStandard, "sustainabilityStandard", 80),
        description: readOptionalString(source.description, "description", 4000),
        createdAt: now, updatedAt: now,
      };
    }
    transaction.create(targetRef, target);
    transaction.create(importRef, {
      id: importId, organisationId: orgId, actorUid: user.uid,
      sourceCollection: sourceConfig.collection, sourceDocumentId: sourceId,
      targetCollection: sourceConfig.target, targetResourceId: targetRef.id,
      createdAt: now,
    });
    transaction.create(activityRef(db, orgId), {
      organisationId: orgId, actorUid: user.uid,
      action: "organisation.personal_resource_copied",
      sourceType, targetResourceType: sourceType === "deal" ? "deal" : "property",
      targetResourceId: targetRef.id, createdAt: now,
    });
  });
  if (alreadyImported) {
    const existing = await importRef.get();
    return {organisationId: orgId, targetResourceId: existing.data().targetResourceId, alreadyImported: true};
  }
  return {organisationId: orgId, targetResourceId: targetRef.id, alreadyImported: false};
});


exports.revokeOrganisationInvitation = onCall({
  region: "us-central1",
  timeoutSeconds: 30,
  memory: "256MiB",
}, async (request) => {
  const user = requireVerifiedUser(request);
  const invitationId = readDocumentId(request.data && request.data.invitationId, "invitationId");
  const db = getDb();
  const inviteRef = db.collection("organisationInvitations").doc(invitationId);

  await db.runTransaction(async (transaction) => {
    const inviteSnap = await transaction.get(inviteRef);
    if (!inviteSnap.exists) {
      throw new HttpsError("not-found", "The organisation invitation was not found.");
    }
    const invite = inviteSnap.data();
    const orgId = invite.organisationId;
    const orgRef = db.collection("organisations").doc(orgId);
    const actorRef = db.collection("organisationMembers").doc(membershipId(orgId, user.uid));
    const [orgSnap, actorSnap] = await Promise.all([
      transaction.get(orgRef),
      transaction.get(actorRef),
    ]);
    if (!orgSnap.exists || orgSnap.data().status !== "active") {
      throw new HttpsError("failed-precondition", "The organisation is not currently active.");
    }
    const actor = actorSnap.exists ? actorSnap.data() : null;
    requireRole(actor, ["owner", "admin"]);
    if (invite.status !== "pending") {
      throw new HttpsError("failed-precondition", "Only pending invitations can be revoked.");
    }
    transaction.update(inviteRef, {
      status: "revoked",
      revokedAt: FieldValue.serverTimestamp(),
      revokedByUid: user.uid,
    });
    transaction.create(activityRef(db, orgId), {
      organisationId: orgId,
      actorUid: user.uid,
      action: "organisation.invitation_revoked",
      invitationEmail: invite.email,
      createdAt: FieldValue.serverTimestamp(),
    });
  });

  return {invitationId, status: "revoked"};
});
