const admin = require("firebase-admin");
const {FieldValue} = require("firebase-admin/firestore");
const {HttpsError, onCall} = require("firebase-functions/v2/https");

const TEAM_PERMISSIONS = [
  "deals.read", "deals.write",
  "properties.read", "properties.write",
];
const TEAM_NAME_MAX = 80;

function db() {
  try { admin.app(); } catch (err) { admin.initializeApp(); }
  return admin.firestore();
}
function userFrom(request) {
  if (!request.auth || !request.auth.uid) throw new HttpsError("unauthenticated", "Sign in to continue.");
  if (request.auth.token.email_verified !== true) throw new HttpsError("failed-precondition", "Verify your email address first.");
  return {uid: request.auth.uid, email: String(request.auth.token.email || "").toLowerCase()};
}
function text(value, field, max) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw new HttpsError("invalid-argument", field + " is invalid.");
  return value.trim();
}
function memberId(orgId, uid) { return orgId + "_" + uid; }
function requireManager(member) {
  if (!member || member.status !== "active" || !["owner", "admin"].includes(member.role)) {
    throw new HttpsError("permission-denied", "Only organisation owners and administrators can manage teams and team permissions.");
  }
}
function cleanPermissions(value) {
  if (!Array.isArray(value) || value.length > TEAM_PERMISSIONS.length) throw new HttpsError("invalid-argument", "Choose valid team permissions.");
  const unique = [...new Set(value)];
  if (unique.some(permission => !TEAM_PERMISSIONS.includes(permission))) throw new HttpsError("invalid-argument", "One or more team permissions are not supported.");
  return unique;
}
async function loadManager(transaction, dbRef, orgId, uid) {
  // Read the actor's tenant and membership inside the same transaction as the
  // protected write, preventing a role-revocation time-of-check/time-of-use gap.
  const [org, member] = await Promise.all([
    transaction.get(dbRef.collection("organisations").doc(orgId)),
    transaction.get(dbRef.collection("organisationMembers").doc(memberId(orgId, uid))),
  ]);
  if (!org.exists || org.data().status !== "active") throw new HttpsError("not-found", "The active organisation was not found.");
  const data = member.exists ? member.data() : null;
  requireManager(data);
  return data;
}
function writeActivity(dbRef, orgId, actorUid, action, details) {
  return dbRef.collection("organisationActivity").doc().create({
    organisationId: orgId, actorUid, action, ...details,
    createdAt: FieldValue.serverTimestamp(),
  });
}

exports.createOrganisationTeam = onCall({region:"europe-west2", timeoutSeconds:30, memory:"256MiB"}, async request => {
  const user = userFrom(request);
  const orgId = text(request.data && request.data.organisationId, "organisationId", 128);
  const name = text(request.data && request.data.name, "Team name", TEAM_NAME_MAX);
  const permissions = cleanPermissions(request.data && request.data.permissions || []);
  const dbRef = db();
  const teamRef = dbRef.collection("organisationTeams").doc();
  await dbRef.runTransaction(async tx => {
    await loadManager(tx, dbRef, orgId, user.uid);
    tx.create(teamRef, {id:teamRef.id, organisationId:orgId, name, status:"active", permissions, createdByUid:user.uid, createdAt:FieldValue.serverTimestamp(), updatedAt:FieldValue.serverTimestamp()});
    tx.create(dbRef.collection("organisationActivity").doc(), {organisationId:orgId, actorUid:user.uid, action:"organisation.team_created", teamId:teamRef.id, teamName:name, createdAt:FieldValue.serverTimestamp()});
  });
  return {teamId:teamRef.id, organisationId:orgId, name, permissions};
});

exports.updateOrganisationTeam = onCall({region:"europe-west2", timeoutSeconds:30, memory:"256MiB"}, async request => {
  const user = userFrom(request);
  const orgId = text(request.data && request.data.organisationId, "organisationId", 128);
  const teamId = text(request.data && request.data.teamId, "teamId", 128);
  const name = text(request.data && request.data.name, "Team name", TEAM_NAME_MAX);
  const permissions = cleanPermissions(request.data && request.data.permissions || []);
  const dbRef = db();
  const ref = dbRef.collection("organisationTeams").doc(teamId);
  await dbRef.runTransaction(async tx => {
    await loadManager(tx, dbRef, orgId, user.uid);
    const snap = await tx.get(ref);
    if (!snap.exists || snap.data().organisationId !== orgId || snap.data().status !== "active") throw new HttpsError("not-found", "The active team was not found.");
    tx.update(ref, {name, permissions, updatedAt:FieldValue.serverTimestamp()});
    tx.create(dbRef.collection("organisationActivity").doc(), {organisationId:orgId, actorUid:user.uid, action:"organisation.team_updated", teamId, teamName:name, permissions, createdAt:FieldValue.serverTimestamp()});
  });
  return {teamId, name, permissions};
});

exports.setOrganisationTeamMember = onCall({region:"europe-west2", timeoutSeconds:30, memory:"256MiB"}, async request => {
  const user = userFrom(request);
  const orgId = text(request.data && request.data.organisationId, "organisationId", 128);
  const teamId = text(request.data && request.data.teamId, "teamId", 128);
  const targetUid = text(request.data && request.data.memberUid, "memberUid", 128);
  const active = request.data && request.data.active;
  if (typeof active !== "boolean") throw new HttpsError("invalid-argument", "active must be true or false.");
  const dbRef = db();
  const teamRef = dbRef.collection("organisationTeams").doc(teamId);
  const memberRef = dbRef.collection("organisationMembers").doc(memberId(orgId, targetUid));
  const assignmentRef = dbRef.collection("organisationTeamMembers").doc(teamId + "_" + targetUid);
  await dbRef.runTransaction(async tx => {
    await loadManager(tx, dbRef, orgId, user.uid);
    const [team, member, existing] = await Promise.all([tx.get(teamRef), tx.get(memberRef), tx.get(assignmentRef)]);
    if (!team.exists || team.data().organisationId !== orgId || team.data().status !== "active") throw new HttpsError("not-found", "The active team was not found.");
    if (!member.exists || member.data().status !== "active" || member.data().organisationId !== orgId || member.data().uid !== targetUid) throw new HttpsError("failed-precondition", "Only active members of this organisation can be assigned to a team.");
    if (active) {
      tx.set(assignmentRef, {id:assignmentRef.id, teamId, organisationId:orgId, uid:targetUid, status:"active", assignedByUid:user.uid, assignedAt:FieldValue.serverTimestamp(), updatedAt:FieldValue.serverTimestamp()});
    } else if (existing.exists) {
      tx.update(assignmentRef, {status:"removed", removedByUid:user.uid, removedAt:FieldValue.serverTimestamp(), updatedAt:FieldValue.serverTimestamp()});
    }
    tx.create(dbRef.collection("organisationActivity").doc(), {organisationId:orgId, actorUid:user.uid, action:active?"organisation.team_member_assigned":"organisation.team_member_removed", teamId, targetUid, createdAt:FieldValue.serverTimestamp()});
  });
  return {teamId, memberUid:targetUid, active};
});

exports.archiveOrganisationTeam = onCall({region:"europe-west2", timeoutSeconds:30, memory:"256MiB"}, async request => {
  const user = userFrom(request);
  const orgId = text(request.data && request.data.organisationId, "organisationId", 128);
  const teamId = text(request.data && request.data.teamId, "teamId", 128);
  const dbRef = db();
  const ref = dbRef.collection("organisationTeams").doc(teamId);
  await dbRef.runTransaction(async tx => {
    await loadManager(tx, dbRef, orgId, user.uid);
    const snap = await tx.get(ref);
    if (!snap.exists || snap.data().organisationId !== orgId || snap.data().status !== "active") throw new HttpsError("not-found", "The active team was not found.");
    tx.update(ref, {status:"archived", archivedByUid:user.uid, archivedAt:FieldValue.serverTimestamp(), updatedAt:FieldValue.serverTimestamp()});
    tx.create(dbRef.collection("organisationActivity").doc(), {organisationId:orgId, actorUid:user.uid, action:"organisation.team_archived", teamId, createdAt:FieldValue.serverTimestamp()});
  });
  return {teamId, status:"archived"};
});

