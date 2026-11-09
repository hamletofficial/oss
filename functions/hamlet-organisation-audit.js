const crypto = require("crypto");
const admin = require("firebase-admin");
const {getFirestore} = require("firebase-admin/firestore");
const {onDocumentWrittenWithAuthContext} = require("firebase-functions/v2/firestore");

function getDb() {
  try { admin.app(); } catch (err) { admin.initializeApp(); }
  return getFirestore(admin.app());
}

function clean(value, max) {
  return String(value == null ? "" : value).replace(/[\r\n]+/g, " ").trim().slice(0, max);
}

async function resolveActor(event, fallbackUid) {
  const actorUid = clean(event.authId || fallbackUid, 128);
  let actorName = "";
  let actorEmail = "";
  if (actorUid) {
    try {
      const profileSnap = await getDb().collection("publicProfiles").doc(actorUid).get();
      const profile = profileSnap.exists ? profileSnap.data() || {} : {};
      actorName = clean([profile.firstName, profile.lastName].filter(Boolean).join(" ") || profile.displayName || profile.name, 160);
      actorEmail = clean(profile.email || profile.emailAddress, 254);
    } catch (err) {
      console.warn("Unable to resolve organisation audit actor profile:", actorUid, err && err.message);
    }
  }
  return {
    actorUid,
    actorName,
    actorEmail,
    actorType: clean(event.authType || "unknown", 40),
  };
}

function eventDocumentId(resourceType, resourceId, event) {
  const sourceId = clean(event.id || "", 200);
  const digest = crypto.createHash("sha256")
    .update(sourceId || resourceType + ":" + resourceId + ":" + Date.now())
    .digest("hex").slice(0, 32);
  return "org_" + resourceType + "_" + clean(resourceId, 60).replace(/[^a-zA-Z0-9_-]/g, "_") + "_" + digest;
}

function changedFields(before, after, tracked) {
  return tracked.filter((field) =>
    JSON.stringify(before[field] == null ? null : before[field]) !==
    JSON.stringify(after[field] == null ? null : after[field])
  );
}

async function recordOperationalChange(event, resourceType, tracked, titleField) {
  const change = event.data;
  if (!change || (!change.before.exists && !change.after.exists)) return;
  const before = change.before.exists ? change.before.data() || {} : {};
  const after = change.after.exists ? change.after.data() || {} : {};
  const current = change.after.exists ? after : before;
  const organisationId = clean(current.organisationId, 128);
  const resourceId = clean(event.params[resourceType === "deal" ? "dealId" : "propertyId"], 128);
  if (!organisationId || !resourceId) {
    console.warn("Skipping organisation operational audit event without tenant/resource identity:", resourceType, resourceId);
    return;
  }

  const fields = change.before.exists && change.after.exists ?
    changedFields(before, after, tracked) :
    tracked.filter((field) => current[field] !== undefined);
  if (change.before.exists && change.after.exists && !fields.length) return;

  const action = !change.before.exists ? "created" :
    !change.after.exists ? "deleted" :
      resourceType === "deal" && before.stage !== after.stage ? "stage_changed" : "updated";
  const noun = resourceType === "deal" ? "Deal" : "Property";
  const title = clean(current[titleField] || resourceId, 160);
  const summary = action === "created" ? noun + " created" :
    action === "deleted" ? noun + " deleted" :
      action === "stage_changed" ? "Pipeline stage changed from " + clean(before.stage || "unspecified", 80) + " to " + clean(after.stage || "unspecified", 80) :
        noun + " updated: " + fields.join(", ");

  const actor = await resolveActor(event, current.createdByUid);
  const id = eventDocumentId(resourceType, resourceId, event);
  const record = {
    id,
    organisationId,
    actorUid: actor.actorUid,
    actorName: actor.actorName,
    actorEmail: actor.actorEmail,
    actorType: actor.actorType,
    action: "organisation." + resourceType + "_" + action,
    resourceType,
    resourceId,
    title,
    summary: clean(summary, 240),
    changedFields: fields.slice(0, 25),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (resourceType === "deal") {
    record.stageFrom = clean(before.stage, 80);
    record.stageTo = clean(after.stage, 80);
  }
  try {
    await getDb().collection("organisationActivity").doc(id).create(record);
  } catch (err) {
    if (err && (err.code === 6 || err.code === "already-exists")) {
      console.log("Organisation operational audit event already recorded:", id);
      return;
    }
    console.error("Unable to record organisation operational audit event:", id, err);
    throw err;
  }
}

exports.recordOrganisationDealActivity = onDocumentWrittenWithAuthContext({
  document: "organisationDeals/{dealId}",
  region: "us-central1",
  timeoutSeconds: 60,
  memory: "256MiB",
  retry: true,
}, async (event) => {
  await recordOperationalChange(event, "deal",
    ["name", "type", "stage", "value", "client", "property", "owner", "notes", "visibility", "sharedWithUids"],
    "name");
});

exports.recordOrganisationPropertyActivity = onDocumentWrittenWithAuthContext({
  document: "organisationProperties/{propertyId}",
  region: "us-central1",
  timeoutSeconds: 60,
  memory: "256MiB",
  retry: true,
}, async (event) => {
  await recordOperationalChange(event, "property",
    ["propertyName", "propertyType", "status", "address", "city", "postcode", "size", "sizeUnit", "askingPrice", "askingRent", "sustainabilityStandard", "description", "visibility", "sharedWithUids"],
    "propertyName");
});

/** Immutable server-authored file lifecycle history; filenames and file contents stay out of audit events. */
exports.recordOrganisationDocumentActivity = onDocumentWrittenWithAuthContext({
  document: "organisationDocuments/{documentId}",
  region: "us-central1",
  timeoutSeconds: 60,
  memory: "256MiB",
  retry: true,
}, async (event) => {
  const change = event.data;
  if (!change || (!change.before.exists && !change.after.exists)) return;
  const before = change.before.exists ? change.before.data() || {} : {};
  const after = change.after.exists ? change.after.data() || {} : {};
  if (change.before.exists && change.after.exists) return;
  const file = change.after.exists ? after : before;
  const organisationId = clean(file.organisationId, 128);
  const resourceId = clean(file.resourceId, 128);
  const resourceType = clean(file.resourceType, 20);
  if (!organisationId || !resourceId || !["deal", "property"].includes(resourceType)) return;
  const action = change.after.exists ? "uploaded" : "deleted";
  const actor = await resolveActor(event, file.deletionRequestedByUid || file.createdByUid);
  const id = eventDocumentId("document", event.params.documentId || resourceId, event);
  const record = {
    id,
    organisationId,
    actorUid: actor.actorUid,
    actorName: actor.actorName,
    actorEmail: actor.actorEmail,
    actorType: actor.actorType,
    action: "organisation.document_" + action,
    resourceType: "document",
    resourceId,
    parentResourceType: resourceType,
    documentId: clean(event.params.documentId, 128),
    title: "Organisation file",
    summary: action === "uploaded" ? "A document or asset was uploaded" : "A document or asset was deleted",
    changedFields: ["file_metadata"],
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  try {
    await getDb().collection("organisationActivity").doc(id).create(record);
  } catch (err) {
    if (err && (err.code === 6 || err.code === "already-exists")) return;
    console.error("Unable to record organisation document activity:", id, err);
    throw err;
  }
});


/** Immutable server-authored history for explicit per-member sharing grants. */
exports.recordOrganisationResourceShareActivity = onDocumentWrittenWithAuthContext({
  document: "organisationResourceShares/{shareId}",
  region: "us-central1",
  timeoutSeconds: 60,
  memory: "256MiB",
  retry: true,
}, async (event) => {
  const change = event.data;
  if (!change || (!change.before.exists && !change.after.exists)) return;
  const grant = change.after.exists ? (change.after.data() || {}) : (change.before.data() || {});
  const organisationId = clean(grant.organisationId, 128);
  const resourceId = clean(grant.resourceId, 128);
  const resourceType = clean(grant.resourceType, 20);
  const recipientUid = clean(grant.sharedWithUid, 128);
  if (!organisationId || !resourceId || !recipientUid ||
      !["deal", "property"].includes(resourceType)) {
    console.warn("Skipping organisation share audit event with invalid grant identity:", event.params.shareId);
    return;
  }
  const action = change.after.exists ? "shared" : "share_revoked";
  const actor = await resolveActor(event, grant.createdByUid);
  const id = eventDocumentId("share", event.params.shareId || resourceId, event);
  const record = {
    id,
    organisationId,
    actorUid: actor.actorUid,
    actorName: actor.actorName,
    actorEmail: actor.actorEmail,
    actorType: actor.actorType,
    action: "organisation.resource_" + action,
    resourceType,
    resourceId,
    targetUid: recipientUid,
    title: "deal" === resourceType ? "Deal access changed" : "Property access changed",
    summary: action === "shared" ? "Resource shared with an organisation member" : "Resource sharing access revoked",
    changedFields: ["sharedWithUid"],
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  try {
    await getDb().collection("organisationActivity").doc(id).create(record);
  } catch (err) {
    if (err && (err.code === 6 || err.code === "already-exists")) return;
    console.error("Unable to record organisation share audit event:", id, err);
    throw err;
  }
});
