const crypto = require("crypto");
const admin = require("firebase-admin");
const {getFirestore, Timestamp, FieldValue} = require("firebase-admin/firestore");
const {HttpsError, onCall} = require("firebase-functions/v2/https");

const ALLOWED_MEMBER_ROLES = ["admin", "manager", "member", "viewer"];
const INVITABLE_ROLES = ["admin", "manager", "member", "viewer"];
const RESERVED_SLUGS = new Set([
  "admin", "api", "app", "auth", "billing", "blog", "cdn", "dashboard",
  "docs", "help", "login", "mail", "members", "organisations", "orgs",
  "press", "public", "root", "settings", "signin", "signup", "support",
  "www",
]);

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
    if (!orgSnap.exists || orgSnap.data().status !== "active") {
      throw new HttpsError("not-found", "The organisation is unavailable.");
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
  return {token, expiresAt: expiresAt.toDate().toISOString(), email, role};
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
  const orgId = readString(request.data && request.data.organisationId, "organisationId", 1, 128);
  const targetUid = readDocumentId(request.data && request.data.memberUid, "memberUid");
  const role = readString(request.data && request.data.role, "role", 4, 12);
  if (!ALLOWED_MEMBER_ROLES.includes(role)) {
    throw new HttpsError("invalid-argument", "The requested membership role is not permitted.");
  }
  if (targetUid === user.uid) {
    throw new HttpsError("failed-precondition", "You cannot change your own organisation role.");
  }
  const db = getDb();
  const actorRef = db.collection("organisationMembers").doc(membershipId(orgId, user.uid));
  const targetRef = db.collection("organisationMembers").doc(membershipId(orgId, targetUid));

  await db.runTransaction(async (transaction) => {
    const [actorSnap, targetSnap] = await Promise.all([
      transaction.get(actorRef),
      transaction.get(targetRef),
    ]);
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
  const orgId = readString(request.data && request.data.organisationId, "organisationId", 1, 128);
  const targetUid = readString(request.data && request.data.memberUid, "memberUid", 1, 128);
  if (targetUid === user.uid) {
    throw new HttpsError("failed-precondition", "Use an explicit ownership transfer before leaving an organisation you own.");
  }
  const db = getDb();
  const actorRef = db.collection("organisationMembers").doc(membershipId(orgId, user.uid));
  const targetRef = db.collection("organisationMembers").doc(membershipId(orgId, targetUid));

  await db.runTransaction(async (transaction) => {
    const [actorSnap, targetSnap] = await Promise.all([
      transaction.get(actorRef),
      transaction.get(targetRef),
    ]);
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
    transaction.create(activityRef(db, orgId), {
      organisationId: orgId,
      actorUid: user.uid,
      action: "organisation.member_removed",
      targetUid,
      createdAt: FieldValue.serverTimestamp(),
    });
  });

  return {organisationId: orgId, memberUid: targetUid, status: "removed"};
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
    const actorRef = db.collection("organisationMembers").doc(membershipId(orgId, user.uid));
    const actorSnap = await transaction.get(actorRef);
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
