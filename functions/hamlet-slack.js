"use strict";
const crypto = require("crypto");
const admin = require("firebase-admin");
const {getFirestore, FieldValue, Timestamp} = require("firebase-admin/firestore");
const {defineSecret} = require("firebase-functions/params");
const {HttpsError, onCall, onRequest} = require("firebase-functions/v2/https");
const {onSchedule} = require("firebase-functions/v2/scheduler");

const REGION = "europe-west2";
const SITE_ORIGIN = "https://hamlet-ai.co.uk";
const SLACK_CLIENT_ID = defineSecret("SLACK_CLIENT_ID");
const SLACK_CLIENT_SECRET = defineSecret("SLACK_CLIENT_SECRET");
const SLACK_SIGNING_SECRET = defineSecret("SLACK_SIGNING_SECRET");
const SLACK_TOKEN_ENCRYPTION_KEY = defineSecret("SLACK_TOKEN_ENCRYPTION_KEY");

function db() {
  try { admin.app(); } catch (_) { admin.initializeApp(); }
  return getFirestore(admin.app());
}
function sha256(value) { return crypto.createHash("sha256").update(String(value)).digest("hex"); }
function randomToken(bytes) { return crypto.randomBytes(bytes || 32).toString("base64url"); }
function clean(value, max) { return String(value == null ? "" : value).replace(/[\r\n]+/g, " ").trim().slice(0, max || 200); }
function requireVerifiedUser(request) {
  if (!request.auth || !request.auth.uid) throw new HttpsError("unauthenticated", "Sign in to continue.");
  if (request.auth.token.email_verified !== true) throw new HttpsError("failed-precondition", "Verify your email address first.");
  return {uid: request.auth.uid, email: clean(request.auth.token.email, 254).toLowerCase()};
}
function membershipDocumentId(organisationId, uid) { return organisationId + "_" + uid; }

async function requireOrganisationAdmin(database, organisationId, uid, requireEntitlement) {
  const [organisationSnap, membershipSnap, billingSnap] = await Promise.all([
    database.collection("organisations").doc(organisationId).get(),
    database.collection("organisationMembers").doc(membershipDocumentId(organisationId, uid)).get(),
    database.collection("organisationBilling").doc(organisationId).get(),
  ]);
  if (!organisationSnap.exists || organisationSnap.data().status !== "active") throw new HttpsError("failed-precondition", "The organisation is not active.");
  const membership = membershipSnap.exists ? membershipSnap.data() : null;
  if (!membership || membership.status !== "active" || !["owner", "admin"].includes(membership.role)) {
    throw new HttpsError("permission-denied", "Only an active organisation owner or administrator can manage Slack integration.");
  }
  if (requireEntitlement !== false && (!billingSnap.exists || !["active", "trialing"].includes(billingSnap.data().status))) throw new HttpsError("failed-precondition", "An active organisation subscription is required for Hamlet Connect.");
  return {organisation: organisationSnap.data(), membership};
}

async function revokeWorkspaceLinks(database, teamId) {
  for (const collectionName of ["hamletSlackUserLinks", "hamletSlackUidLinks"]) {
    let last = null;
    while (true) {
      let query = database.collection(collectionName).where("teamId", "==", teamId).limit(400);
      if (last) query = query.startAfter(last);
      const snapshot = await query.get();
      if (snapshot.empty) break;
      const batch = database.batch();
      snapshot.docs.forEach(doc => batch.set(doc.ref, {status: "revoked", revokedAt: FieldValue.serverTimestamp()}, {merge: true}));
      await batch.commit();
      last = snapshot.docs[snapshot.docs.length - 1];
      if (snapshot.size < 400) break;
    }
  }
}

function redirectUri() {
  const projectId = admin.app().options.projectId || process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
  if (!projectId) throw new Error("Firebase project ID is unavailable.");
  return "https://" + REGION + "-" + projectId + ".cloudfunctions.net/hamletSlackOAuthCallback";
}
function encryptionKey() {
  const value = String(SLACK_TOKEN_ENCRYPTION_KEY.value() || "").trim();
  let key;
  if (/^[a-f0-9]{64}$/i.test(value)) key = Buffer.from(value, "hex");
  else {
    const decoded = Buffer.from(value, "base64");
    key = decoded.length === 32 ? decoded : Buffer.from(value, "utf8");
  }
  if (key.length !== 32) throw new Error("SLACK_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes.");
  return key;
}
function encryptToken(token) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(token), "utf8"), cipher.final()]);
  return {tokenCiphertext: ciphertext.toString("base64"), tokenIv: iv.toString("base64"), tokenTag: cipher.getAuthTag().toString("base64")};
}
function decryptToken(record) {
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(record.tokenIv, "base64"));
  decipher.setAuthTag(Buffer.from(record.tokenTag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(record.tokenCiphertext, "base64")), decipher.final()]).toString("utf8");
}
function verifySlackRequest(request) {
  const raw = request.rawBody;
  const timestamp = String(request.get("x-slack-request-timestamp") || "");
  const signature = String(request.get("x-slack-signature") || "");
  if (!Buffer.isBuffer(raw) || !/^\d{10}$/.test(timestamp) || !/^v0=[a-f0-9]{64}$/i.test(signature)) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const base = "v0:" + timestamp + ":" + raw.toString("utf8");
  const expected = "v0=" + crypto.createHmac("sha256", SLACK_SIGNING_SECRET.value()).update(base).digest("hex");
  const left = Buffer.from(expected, "utf8"), right = Buffer.from(signature, "utf8");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
async function claimSlackRequestNonce(database, timestamp, signature) {
  const nonceId = sha256(String(timestamp) + "|" + String(signature));
  const ref = database.collection("hamletSlackRequestNonces").doc(nonceId);
  return database.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    if (snapshot.exists) return false;
    transaction.create(ref, {
      serverOnly: true,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000),
    });
    return true;
  });
}

async function slackApi(method, token, body) {
  const response = await fetch("https://slack.com/api/" + method, {
    method: "POST",
    headers: {Authorization: "Bearer " + token, "Content-Type": "application/json; charset=utf-8"},
    body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error("Slack API " + method + " failed: " + clean(result.error || response.statusText, 160));
  return result;
}

async function slackInstallCallback(request, response) {
  response.set("Cache-Control", "no-store");
  if (request.method !== "GET") return response.status(405).send("Method not allowed.");
  const code = clean(request.query.code, 2048), state = clean(request.query.state, 256);
  if (!code || !state) return response.status(400).send("The Slack authorisation response is incomplete.");
  const database = db();
  const stateRef = database.collection("hamletSlackOAuthStates").doc(sha256(state));
  let stateData;
  try {
    await database.runTransaction(async transaction => {
      const snapshot = await transaction.get(stateRef);
      if (!snapshot.exists) throw new Error("The Slack authorisation state is invalid or has expired.");
      const data = snapshot.data() || {};
      if (data.consumedAt || !data.expiresAt || data.expiresAt.toMillis() <= Date.now()) throw new Error("The Slack authorisation state is invalid or has expired.");
      stateData = data;
      transaction.update(stateRef, {consumedAt: FieldValue.serverTimestamp(), status: "exchanging"});
    });
  } catch (error) {
    return response.status(400).send(clean(error.message, 200) || "The Slack authorisation state could not be validated.");
  }
  try {
    const form = new URLSearchParams({code, client_id: SLACK_CLIENT_ID.value(), client_secret: SLACK_CLIENT_SECRET.value(), redirect_uri: redirectUri()});
    const exchange = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST", headers: {"Content-Type": "application/x-www-form-urlencoded"}, body: form, signal: AbortSignal.timeout(15000),
    });
    const payload = await exchange.json();
    if (!exchange.ok || !payload.ok || !payload.team || !payload.team.id || !payload.access_token) {
      throw new Error("Slack did not approve the installation. " + clean(payload.error || exchange.statusText, 120));
    }
    if (payload.is_enterprise_install === true) throw new Error("Enterprise-wide Slack installations are not enabled in this first release.");
    const teamId = clean(payload.team.id, 80);
    const installationRef = database.collection("hamletSlackInstallations").doc(teamId);
    const previousInstallation = await installationRef.get();
    if (previousInstallation.exists && previousInstallation.data().status !== "active") {
      await revokeWorkspaceLinks(database, teamId);
    }
    const encrypted = encryptToken(payload.access_token);
    const [organisationSnap, membershipSnap, billingSnap] = await Promise.all([
      database.collection("organisations").doc(stateData.organisationId).get(),
      database.collection("organisationMembers").doc(membershipDocumentId(stateData.organisationId, stateData.installedByUid)).get(),
      database.collection("organisationBilling").doc(stateData.organisationId).get(),
    ]);
    if (!organisationSnap.exists || organisationSnap.data().status !== "active" ||
        !membershipSnap.exists || membershipSnap.data().status !== "active" ||
        !["owner", "admin"].includes(membershipSnap.data().role) ||
        !billingSnap.exists || !["active", "trialing"].includes(billingSnap.data().status)) {
      throw new Error("The Hamlet organisation or installing administrator is no longer authorised.");
    }
    await database.runTransaction(async transaction => {
      const existing = await transaction.get(installationRef);
      const previous = existing.exists ? existing.data() || {} : {};
      if (previous.status === "active" && previous.organisationId !== stateData.organisationId) {
        throw new Error("This Slack workspace is already connected to another Hamlet organisation. Disconnect it there before reconnecting.");
      }
      transaction.set(installationRef, {
        serverOnly: true,
        teamId, teamName: clean(payload.team.name, 120), organisationId: stateData.organisationId,
        status: "active", botUserId: clean(payload.bot_user_id, 80),
        scopes: clean(payload.scope, 1000).split(",").filter(Boolean),
        ...encrypted, installedByUid: stateData.installedByUid,
        installedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
        disconnectedAt: FieldValue.delete(),
      }, {merge: true});
      transaction.create(database.collection("organisationActivity").doc(), {
        organisationId: stateData.organisationId, actorUid: stateData.installedByUid,
        action: "organisation.slack_connected", slackTeamId: teamId,
        slackTeamName: clean(payload.team.name, 120), createdAt: FieldValue.serverTimestamp(),
      });
    });
    await stateRef.set({status: "completed", completedAt: FieldValue.serverTimestamp()}, {merge: true});
    return response.status(200).send("<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Slack connected | Hamlet</title><body style=\"font:16px Arial,sans-serif;background:#0b1120;color:#f3f6fb;padding:40px;max-width:680px;margin:auto\"><h1>Slack connected</h1><p>Your Slack workspace is now connected to the selected Hamlet organisation.</p><p>You can close this window and return to Hamlet.</p></body></html>");
  } catch (error) {
    console.error("Hamlet Slack OAuth callback failed:", clean(error.message, 240));
    await stateRef.set({status: "failed", failureReason: clean(error.message, 180), failedAt: FieldValue.serverTimestamp()}, {merge: true}).catch(() => {});
    return response.status(400).send("Hamlet could not complete the Slack installation. Return to Hamlet and try again or contact support.");
  }
}

exports.beginHamletSlackInstallation = onCall({region: REGION, timeoutSeconds: 20, memory: "256MiB", secrets: [SLACK_CLIENT_ID]}, async request => {
  const user = requireVerifiedUser(request);
  const organisationId = clean(request.data && request.data.organisationId, 128);
  if (!organisationId || organisationId.includes("/")) throw new HttpsError("invalid-argument", "A valid organisation is required.");
  await requireOrganisationAdmin(db(), organisationId, user.uid);
  const clientId = String(SLACK_CLIENT_ID.value() || "").trim();
  if (!clientId) throw new HttpsError("failed-precondition", "Slack app credentials have not been configured.");
  const state = randomToken(32);
  await db().collection("hamletSlackOAuthStates").doc(sha256(state)).create({
    serverOnly: true,
    organisationId, installedByUid: user.uid, status: "pending",
    createdAt: FieldValue.serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + 600000),
  });
  const url = new URL("https://slack.com/oauth/v2/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("scope", "commands,chat:write,im:write");
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("state", state);
  return {url: url.toString(), redirectUri: redirectUri(), expiresInSeconds: 600};
});

exports.hamletSlackOAuthCallback = onRequest({
  region: REGION, timeoutSeconds: 30, memory: "256MiB",
  secrets: [SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, SLACK_TOKEN_ENCRYPTION_KEY],
}, slackInstallCallback);


exports.getHamletSlackIntegrationStatus = onCall({region: REGION, timeoutSeconds: 20, memory: "256MiB"}, async request => {
  const user = requireVerifiedUser(request);
  const organisationId = clean(request.data && request.data.organisationId, 128);
  if (!organisationId || organisationId.includes("/")) throw new HttpsError("invalid-argument", "A valid organisation is required.");
  await requireOrganisationAdmin(db(), organisationId, user.uid, false);
  const [snapshot, settingsSnap] = await Promise.all([
    db().collection("hamletSlackInstallations").where("organisationId", "==", organisationId).get(),
    db().collection("hamletSlackSettings").doc(organisationId).get(),
  ]);
  const settings = settingsSnap.exists ? settingsSnap.data() : {};
  return {
    settings: {
      timeZone: clean(settings.timeZone || "Europe/London", 80),
      reminderLeadHours: Number.isInteger(settings.reminderLeadHours) ? settings.reminderLeadHours : 24,
      quietHours: settings.quietHours || {startHour: 21, endHour: 8},
      managerEscalationEnabled: settings.managerEscalationEnabled === true,
    },
    installations: snapshot.docs.map(doc => {
      const data = doc.data() || {};
      return {teamId: doc.id, teamName: clean(data.teamName, 120), status: clean(data.status, 40), scopes: Array.isArray(data.scopes) ? data.scopes : []};
    }).filter(item => item.status === "active"),
  };
});

exports.updateHamletSlackReminderSettings = onCall({region: REGION, timeoutSeconds: 20, memory: "256MiB"}, async request => {
  const user = requireVerifiedUser(request);
  const organisationId = clean(request.data && request.data.organisationId, 128);
  if (!organisationId || organisationId.includes("/")) throw new HttpsError("invalid-argument", "A valid organisation is required.");
  await requireOrganisationAdmin(db(), organisationId, user.uid);
  const input = request.data || {};
  const timeZone = clean(input.timeZone || "Europe/London", 80);
  try { new Intl.DateTimeFormat("en-GB", {timeZone}).format(new Date()); }
  catch (_) { throw new HttpsError("invalid-argument", "Choose a valid IANA timezone."); }
  const leadHours = Number(input.reminderLeadHours);
  const startHour = Number(input.quietHours && input.quietHours.startHour);
  const endHour = Number(input.quietHours && input.quietHours.endHour);
  const managerEscalationEnabled = input.managerEscalationEnabled === true;
  if (!Number.isInteger(leadHours) || leadHours < 1 || leadHours > 168 ||
      !Number.isInteger(startHour) || startHour < 0 || startHour > 23 ||
      !Number.isInteger(endHour) || endHour < 0 || endHour > 23) {
    throw new HttpsError("invalid-argument", "Reminder lead time and quiet-hour settings are invalid.");
  }
  await db().collection("hamletSlackSettings").doc(organisationId).set({
    serverOnly: true,
    organisationId, timeZone, reminderLeadHours: leadHours,
    quietHours: {startHour, endHour}, managerEscalationEnabled,
    updatedByUid: user.uid, updatedAt: FieldValue.serverTimestamp(),
  }, {merge: true});
  await db().collection("organisationActivity").add({
    organisationId, actorUid: user.uid, action: "organisation.slack_reminder_settings_updated",
    createdAt: FieldValue.serverTimestamp(),
  });
  return {ok: true, timeZone, reminderLeadHours: leadHours, quietHours: {startHour, endHour}, managerEscalationEnabled};
});

exports.disconnectHamletSlackInstallation = onCall({region: REGION, timeoutSeconds: 30, memory: "256MiB", secrets: [SLACK_TOKEN_ENCRYPTION_KEY]}, async request => {
  const user = requireVerifiedUser(request);
  const organisationId = clean(request.data && request.data.organisationId, 128);
  const teamId = clean(request.data && request.data.teamId, 80);
  if (!organisationId || !teamId) throw new HttpsError("invalid-argument", "Organisation and Slack workspace are required.");
  const database = db();
  await requireOrganisationAdmin(database, organisationId, user.uid, false);
  const ref = database.collection("hamletSlackInstallations").doc(teamId);
  const currentSnap = await ref.get();
  if (!currentSnap.exists || currentSnap.data().organisationId !== organisationId || currentSnap.data().status !== "active") {
    throw new HttpsError("not-found", "The active Slack connection was not found.");
  }
  let accessToken = "";
  try { accessToken = decryptToken(currentSnap.data()); }
  catch (error) { console.warn("Unable to decrypt Slack token during disconnect; local access will still be revoked:", clean(error.message, 160)); }
  await database.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists || snapshot.data().organisationId !== organisationId || snapshot.data().status !== "active") throw new HttpsError("not-found", "The active Slack connection was not found.");
    transaction.update(ref, {
      status: "disconnected", tokenCiphertext: FieldValue.delete(), tokenIv: FieldValue.delete(), tokenTag: FieldValue.delete(),
      disconnectedAt: FieldValue.serverTimestamp(), disconnectedByUid: user.uid, updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(database.collection("organisationActivity").doc(), {
      organisationId, actorUid: user.uid, action: "organisation.slack_disconnected",
      slackTeamId: teamId, createdAt: FieldValue.serverTimestamp(),
    });
  });
  await revokeWorkspaceLinks(database, teamId);
  let tokenRevoked = false;
  if (accessToken) {
    try {
      await slackApi("auth.revoke", accessToken, {});
      tokenRevoked = true;
    } catch (error) {
      console.warn("Slack token revocation failed after local disconnect; workspace access remains disabled in Hamlet:", clean(error.message, 180));
    }
  }
  return {ok: true, tokenRevoked};
});

exports.completeHamletSlackAccountLink = onCall({region: REGION, timeoutSeconds: 20, memory: "256MiB"}, async request => {
  const user = requireVerifiedUser(request);
  const code = clean(request.data && request.data.code, 128);
  if (!code) throw new HttpsError("invalid-argument", "The one-time Slack link code is required.");
  const database = db(), challengeRef = database.collection("hamletSlackLinkChallenges").doc(sha256(code));
  let linked = null;
  await database.runTransaction(async transaction => {
    const challengeSnap = await transaction.get(challengeRef);
    if (!challengeSnap.exists) throw new HttpsError("not-found", "This Slack link has expired or is invalid.");
    const challenge = challengeSnap.data() || {};
    if (challenge.consumedAt || !challenge.expiresAt || challenge.expiresAt.toMillis() <= Date.now()) throw new HttpsError("failed-precondition", "This Slack link has expired or has already been used.");
    const installationRef = database.collection("hamletSlackInstallations").doc(challenge.teamId);
    const organisationRef = database.collection("organisations").doc(challenge.organisationId);
    const membershipRef = database.collection("organisationMembers").doc(membershipDocumentId(challenge.organisationId, user.uid));
    const billingRef = database.collection("organisationBilling").doc(challenge.organisationId);
    const linkRef = database.collection("hamletSlackUserLinks").doc(sha256(challenge.teamId + "_" + challenge.slackUserId));
    const reverseRef = database.collection("hamletSlackUidLinks").doc(sha256(challenge.teamId + "_" + user.uid));
    const [installationSnap, organisationSnap, membershipSnap, billingSnap, existingLink, existingReverse] = await Promise.all([
      transaction.get(installationRef), transaction.get(organisationRef), transaction.get(membershipRef), transaction.get(billingRef), transaction.get(linkRef), transaction.get(reverseRef),
    ]);
    if (!installationSnap.exists || installationSnap.data().status !== "active" ||
        installationSnap.data().organisationId !== challenge.organisationId ||
        !organisationSnap.exists || organisationSnap.data().status !== "active" ||
        !billingSnap.exists || !["active", "trialing"].includes(billingSnap.data().status) ||
        !membershipSnap.exists || membershipSnap.data().status !== "active") {
      throw new HttpsError("permission-denied", "Your Hamlet account does not have active access to this organisation.");
    }
    if (existingLink.exists && existingLink.data().status === "active" && existingLink.data().uid !== user.uid) throw new HttpsError("already-exists", "This Slack account is already linked to another Hamlet account. Ask an organisation administrator for assistance.");
    if (existingReverse.exists && existingReverse.data().status === "active" && existingReverse.data().slackUserId !== challenge.slackUserId) throw new HttpsError("already-exists", "Your Hamlet account is already linked to another Slack user in this workspace.");
    transaction.set(linkRef, {
      serverOnly: true,
      teamId: challenge.teamId, slackUserId: challenge.slackUserId,
      organisationId: challenge.organisationId, uid: user.uid,
      linkedAt: FieldValue.serverTimestamp(), status: "active",
    });
    transaction.set(reverseRef, {
      serverOnly: true,
      teamId: challenge.teamId, organisationId: challenge.organisationId,
      uid: user.uid, slackUserId: challenge.slackUserId,
      linkedAt: FieldValue.serverTimestamp(), status: "active",
    });
    transaction.update(challengeRef, {consumedAt: FieldValue.serverTimestamp(), consumedByUid: user.uid, status: "consumed"});
    transaction.create(database.collection("organisationActivity").doc(), {
      organisationId: challenge.organisationId, actorUid: user.uid,
      action: "organisation.slack_account_linked", slackTeamId: challenge.teamId,
      createdAt: FieldValue.serverTimestamp(),
    });
    linked = {teamId: challenge.teamId, organisationId: challenge.organisationId};
  });
  return {ok: true, ...linked};
});

async function sendSlackCommandResponse(responseUrl, message) {
  let parsed;
  try { parsed = new URL(String(responseUrl || "")); } catch (_) { return false; }
  if (parsed.protocol !== "https:" || !["hooks.slack.com", "hooks.slack-gov.com"].includes(parsed.hostname)) return false;
  const result = await fetch(parsed.toString(), {
    method: "POST",
    headers: {"Content-Type": "application/json; charset=utf-8"},
    body: JSON.stringify({response_type: "ephemeral", text: clean(message, 2500)}),
    signal: AbortSignal.timeout(10000),
  });
  return result.ok;
}

exports.hamletSlackEvents = onRequest({
  region: REGION, timeoutSeconds: 30, memory: "256MiB", secrets: [SLACK_SIGNING_SECRET],
}, async (request, response) => {
  response.set("Cache-Control", "no-store");
  if (request.method !== "POST") return response.set("Allow", "POST").status(405).send("Method not allowed.");
  if (!verifySlackRequest(request)) return response.status(401).send("Invalid Slack signature.");
  const body = request.body || {};
  if (body.type === "url_verification") return response.status(200).json({challenge: body.challenge});

  // Slack requires a prompt acknowledgement. Return it before Firestore work,
  // then use Slack's signed response_url for the private command result.
  const isCommand = clean(body.command, 40) === "/hamlet";
  const isUninstall = body.type === "event_callback" && body.event && body.event.type === "app_uninstalled";
  if (isCommand || isUninstall) response.status(200).send("");
  else return response.status(200).send("");

  const database = db();
  const timestamp = String(request.get("x-slack-request-timestamp") || "");
  const signature = String(request.get("x-slack-signature") || "");
  try {
    if (!await claimSlackRequestNonce(database, timestamp, signature)) return;
    if (isUninstall) {
      const teamId = clean(body.team_id, 80);
      if (teamId) {
        const installationRef = database.collection("hamletSlackInstallations").doc(teamId);
        const installationSnap = await installationRef.get();
        const organisationId = installationSnap.exists ? clean(installationSnap.data().organisationId, 128) : "";
        await installationRef.set({
          serverOnly: true,
          status: "disconnected", tokenCiphertext: FieldValue.delete(), tokenIv: FieldValue.delete(), tokenTag: FieldValue.delete(),
          disconnectedAt: FieldValue.serverTimestamp(), disconnectReason: "slack_app_uninstalled",
        }, {merge: true});
        await revokeWorkspaceLinks(database, teamId);
        if (organisationId) {
          await database.collection("organisationActivity").add({
            organisationId, actorUid: "slack-app-uninstalled", actorType: "system",
            action: "organisation.slack_disconnected", slackTeamId: teamId,
            createdAt: FieldValue.serverTimestamp(),
          });
        }
      }
      return;
    }

    const teamId = clean(body.team_id, 80);
    const slackUserId = clean(body.user_id, 80);
    const textValue = clean(body.text, 300).toLowerCase();
    const responseUrl = body.response_url;
    const installationSnap = await database.collection("hamletSlackInstallations").doc(teamId).get();
    if (!installationSnap.exists || installationSnap.data().status !== "active") {
      await sendSlackCommandResponse(responseUrl, "This Slack workspace is not connected to an active Hamlet organisation.");
      return;
    }
    const installation = installationSnap.data();
    if (textValue === "link" || textValue.startsWith("link ")) {
      const token = randomToken(32);
      const challengeRef = database.collection("hamletSlackLinkChallenges").doc(sha256(token));
      const rateRef = database.collection("hamletSlackLinkRateLimits").doc(sha256(teamId + "_" + slackUserId));
      try {
        await database.runTransaction(async transaction => {
          const rateSnap = await transaction.get(rateRef);
          const lastIssuedAt = rateSnap.exists ? rateSnap.data().lastIssuedAt : null;
          if (lastIssuedAt && typeof lastIssuedAt.toMillis === "function" && Date.now() - lastIssuedAt.toMillis() < 60000) {
            throw new Error("Please wait one minute before requesting another account-linking URL.");
          }
          transaction.create(challengeRef, {
            serverOnly: true,
            teamId, slackUserId, organisationId: installation.organisationId,
            createdAt: FieldValue.serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + 600000), status: "pending",
          });
          transaction.set(rateRef, {
            serverOnly: true,
            teamId, slackUserId, lastIssuedAt: FieldValue.serverTimestamp(),
            expiresAt: Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000),
          });
        });
      } catch (error) {
        await sendSlackCommandResponse(responseUrl, clean(error.message, 180));
        return;
      }
      const linkUrl = SITE_ORIGIN + "/app/hamlet/slack-link.html?code=" + encodeURIComponent(token);
      await sendSlackCommandResponse(responseUrl, "Link your Slack account to your verified Hamlet account using this one-time link (valid for 10 minutes): " + linkUrl);
      return;
    }
    if (textValue === "status") {
      const linkRef = database.collection("hamletSlackUserLinks").doc(sha256(teamId + "_" + slackUserId));
      const linkSnap = await linkRef.get();
      let active = false;
      if (linkSnap.exists && linkSnap.data().status === "active") {
        const link = linkSnap.data();
        const reverseRef = database.collection("hamletSlackUidLinks").doc(sha256(teamId + "_" + link.uid));
        const [organisationSnap, membershipSnap, billingSnap, reverseSnap] = await Promise.all([
          database.collection("organisations").doc(link.organisationId).get(),
          database.collection("organisationMembers").doc(membershipDocumentId(link.organisationId, link.uid)).get(),
          database.collection("organisationBilling").doc(link.organisationId).get(),
          reverseRef.get(),
        ]);
        active = organisationSnap.exists && organisationSnap.data().status === "active" &&
          membershipSnap.exists && membershipSnap.data().status === "active" &&
          billingSnap.exists && ["active", "trialing"].includes(billingSnap.data().status) &&
          reverseSnap.exists && reverseSnap.data().status === "active" &&
          reverseSnap.data().slackUserId === slackUserId;
      }
      await sendSlackCommandResponse(responseUrl, active ?
        "Your Slack identity is linked and your Hamlet organisation access is active." :
        "Your Slack identity is not currently linked to an active Hamlet organisation. Run /hamlet link to connect or relink it.");
      return;
    }
    await sendSlackCommandResponse(responseUrl, "Hamlet Connect commands: /hamlet link links your verified Hamlet account; /hamlet status checks your link.");
  } catch (error) {
    console.error("Hamlet Slack request processing failed:", clean(error.message, 220));
    if (isCommand) await sendSlackCommandResponse(body.response_url, "Hamlet could not complete that request. Please try again shortly.");
  }
});
function isQuietHours(now, settings) {
  const quiet = settings && settings.quietHours || {};
  const start = Number.isInteger(quiet.startHour) ? quiet.startHour : 21;
  const end = Number.isInteger(quiet.endHour) ? quiet.endHour : 8;
  const timeZone = clean(settings && settings.timeZone, 80) || "Europe/London";
  const hour = Number(new Intl.DateTimeFormat("en-GB", {hour: "2-digit", hourCycle: "h23", timeZone}).format(now));
  if (start === end) return false;
  return start > end ? hour >= start || hour < end : hour >= start && hour < end;
}
function dueStage(dueDate, now, leadHours) {
  const deltaHours = (dueDate.getTime() - now.getTime()) / 3600000;
  if (deltaHours > 0 && deltaHours <= leadHours) return "upcoming_" + leadHours + "h";
  if (deltaHours <= 0) {
    const overdueDay = Math.floor(Math.abs(deltaHours) / 24) + 1;
    if (overdueDay <= 3) return "overdue_day_" + overdueDay;
  }
  return "";
}
async function userCanReadDeal(database, organisationId, dealId, deal, uid, membership) {
  if (!membership || membership.status !== "active") return false;
  if (deal.visibility === "organisation") return true;
  if (deal.visibility !== "restricted") return false;
  if (deal.createdByUid === uid || (Array.isArray(deal.sharedWithUids) && deal.sharedWithUids.includes(uid))) return true;
  if (deal.teamId) {
    const [teamSnap, assignmentSnap] = await Promise.all([
      database.collection("organisationTeams").doc(deal.teamId).get(),
      database.collection("organisationTeamMembers").doc(deal.teamId + "_" + uid).get(),
    ]);
    const team = teamSnap.exists ? teamSnap.data() : {};
    const assignment = assignmentSnap.exists ? assignmentSnap.data() : {};
    if (team.organisationId === organisationId && team.status === "active" &&
        (team.permissions || []).includes("deals.read") && assignment.status === "active" &&
        assignment.organisationId === organisationId) return true;
  }
  const shareId = organisationId + "_deal_" + dealId + "_" + uid;
  const shareSnap = await database.collection("organisationResourceShares").doc(shareId).get();
  return shareSnap.exists && shareSnap.data().organisationId === organisationId &&
    shareSnap.data().resourceType === "deal" && shareSnap.data().resourceId === dealId &&
    shareSnap.data().sharedWithUid === uid;
}
async function sendSlackDm(token, slackUserId, text, clientMsgId) {
  const opened = await slackApi("conversations.open", token, {users: slackUserId});
  if (!opened.channel || !opened.channel.id) throw new Error("Slack did not return a direct-message channel.");
  await slackApi("chat.postMessage", token, {channel: opened.channel.id, text, client_msg_id: clientMsgId, unfurl_links: false, unfurl_media: false});
}
async function dispatchCriticalPathReminder(database, installation, teamId, dealDoc, deal, recipientUid, stage, dueDate, settings, escalation) {
  const organisationId = installation.organisationId;
  // Re-read mutable authorisation and resource state immediately before dispatch.
  // The scheduler's original query is only a candidate list, never an authority.
  const [dealSnap, installationSnap, organisationSnap, billingSnap, settingsSnap, membershipSnap, reverseLinkSnap] = await Promise.all([
    dealDoc.ref.get(),
    database.collection("hamletSlackInstallations").doc(teamId).get(),
    database.collection("organisations").doc(organisationId).get(),
    database.collection("organisationBilling").doc(organisationId).get(),
    database.collection("hamletSlackSettings").doc(organisationId).get(),
    database.collection("organisationMembers").doc(membershipDocumentId(organisationId, recipientUid)).get(),
    database.collection("hamletSlackUidLinks").doc(sha256(teamId + "_" + recipientUid)).get(),
  ]);
  if (!dealSnap.exists || !installationSnap.exists || !organisationSnap.exists || !billingSnap.exists) return "suppressed";
  const currentDeal = dealSnap.data() || {};
  const currentInstallation = installationSnap.data() || {};
  const membership = membershipSnap.exists ? membershipSnap.data() : null;
  const currentSettings = settingsSnap.exists ? settingsSnap.data() : {};
  const userLink = reverseLinkSnap.exists ? reverseLinkSnap.data() : null;
  if (currentDeal.organisationId !== organisationId ||
      String(currentDeal.nextActionStatus || "open").toLowerCase() !== "open" ||
      currentDeal.nextActionCompletedAt ||
      !currentDeal.nextActionDueAt || typeof currentDeal.nextActionDueAt.toMillis !== "function" ||
      currentDeal.nextActionDueAt.toMillis() !== dueDate.getTime()) return "suppressed";
  if (!escalation && currentDeal.nextActionOwnerUid !== recipientUid) return "suppressed";
  if (escalation && (!["owner", "admin", "manager"].includes(membership && membership.role) ||
      currentSettings.managerEscalationEnabled !== true)) return "suppressed";
  if (currentInstallation.status !== "active" || currentInstallation.organisationId !== organisationId ||
      organisationSnap.data().status !== "active" ||
      !["active", "trialing"].includes(billingSnap.data().status)) return "suppressed";
  if (!membership || membership.status !== "active") return "suppressed";
  if (isQuietHours(new Date(), currentSettings)) return "suppressed";
  if (!await userCanReadDeal(database, organisationId, dealDoc.id, currentDeal, recipientUid, membership)) return "suppressed";
  if (!userLink || userLink.status !== "active" || userLink.uid !== recipientUid ||
      userLink.teamId !== teamId || userLink.organisationId !== organisationId) return "unlinked";

  const currentLeadHours = Number.isFinite(Number(currentSettings.reminderLeadHours)) ?
    Math.max(1, Math.min(168, Math.floor(Number(currentSettings.reminderLeadHours)))) : 24;
  if (!escalation && dueStage(dueDate, new Date(), currentLeadHours) !== stage) return "suppressed";

  const deliveryKey = sha256([organisationId, teamId, dealDoc.id, dueDate.getTime(), recipientUid, stage].join("|"));
  const deliveryRef = database.collection("hamletSlackReminderDeliveries").doc(deliveryKey);
  const claimed = await database.runTransaction(async transaction => {
    const snapshot = await transaction.get(deliveryRef), existing = snapshot.exists ? snapshot.data() : {};
    if (existing.status === "sent" || existing.status === "suppressed") return false;
    if (existing.status === "processing" && existing.processingAt &&
        existing.processingAt.toMillis() > Date.now() - 600000) return false;
    transaction.set(deliveryRef, {
      serverOnly: true,
      organisationId, teamId, dealId: dealDoc.id, recipientUid, stage,
      dueAt: Timestamp.fromDate(dueDate), status: "processing",
      processingAt: FieldValue.serverTimestamp(), attempts: FieldValue.increment(1),
      escalation: !!escalation, updatedAt: FieldValue.serverTimestamp(),
    }, {merge: true});
    return true;
  });
  if (!claimed) return "already-processed";
  try {
    const token = decryptToken(currentInstallation);
    const timeZone = clean(currentSettings.timeZone, 80) || "Europe/London";
    const dueText = new Intl.DateTimeFormat("en-GB", {dateStyle: "medium", timeStyle: "short", timeZone}).format(dueDate);
    const message = [
      "*Hamlet Critical Path Reminder*",
      (escalation ? "Manager escalation" : stage.startsWith("upcoming") ? "Due soon" : "Overdue") + ": " + clean(currentDeal.nextActionTitle || "Critical-path action", 160),
      "Deal: " + clean(currentDeal.name || "Organisation deal", 120),
      "Due: " + dueText,
      "Open the authorised deal workspace: " + SITE_ORIGIN + "/app/hamlet/organisation-deals.html",
    ].join("\n");
    const uuidHash = deliveryKey.slice(0, 32);
    const clientMsgId = uuidHash.slice(0, 8) + "-" + uuidHash.slice(8, 12) + "-4" + uuidHash.slice(13, 16) + "-a" + uuidHash.slice(17, 20) + "-" + uuidHash.slice(20, 32);
    await sendSlackDm(token, userLink.slackUserId, message, clientMsgId);
    await deliveryRef.set({status: "sent", sentAt: FieldValue.serverTimestamp(), error: FieldValue.delete()}, {merge: true});
    try {
      await database.collection("organisationActivity").add({
        organisationId, actorUid: "hamlet-slack-scheduler", actorType: "system",
        action: escalation ? "organisation.slack_reminder_escalated" : "organisation.slack_reminder_sent",
        resourceType: "deal", resourceId: dealDoc.id, targetUid: recipientUid,
        reminderStage: stage, createdAt: FieldValue.serverTimestamp(),
      });
    } catch (auditError) {
      console.warn("Slack reminder was delivered but its activity record could not be written:", deliveryKey, clean(auditError.message, 160));
    }
    return "sent";
  } catch (error) {
    await deliveryRef.set({status: "failed", failedAt: FieldValue.serverTimestamp(), error: clean(error.message, 400)}, {merge: true});
    console.error("Hamlet Slack reminder delivery failed:", deliveryKey, clean(error.message, 200));
    return "failed";
  }
}

exports.sendHamletSlackCriticalPathReminders = onSchedule({
  schedule: "every 15 minutes", timeZone: "Europe/London", region: REGION,
  timeoutSeconds: 540, memory: "512MiB", secrets: [SLACK_TOKEN_ENCRYPTION_KEY],
}, async () => {
  const database = db(), now = new Date();
  const upperBound = Timestamp.fromDate(new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000));
  const lowerBound = Timestamp.fromDate(new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000));
  const snapshot = await database.collection("organisationDeals")
    .where("nextActionDueAt", ">=", lowerBound).where("nextActionDueAt", "<=", upperBound).orderBy("nextActionDueAt", "asc").limit(300).get();
  let sent = 0, suppressed = 0, failed = 0;
  for (const dealDoc of snapshot.docs) {
    const deal = dealDoc.data() || {};
    if (!deal.organisationId || !deal.nextActionDueAt || typeof deal.nextActionDueAt.toDate !== "function") continue;
    if (String(deal.nextActionStatus || "open").toLowerCase() !== "open" || deal.nextActionCompletedAt) continue;
    if (typeof deal.nextActionOwnerUid !== "string" || !deal.nextActionOwnerUid) continue;
    const dueDate = deal.nextActionDueAt.toDate();
    const installations = await database.collection("hamletSlackInstallations")
      .where("organisationId", "==", deal.organisationId).where("status", "==", "active").limit(20).get();
    if (installations.empty) continue;
    const [organisationSnap, billingSnap, settingsSnap] = await Promise.all([
      database.collection("organisations").doc(deal.organisationId).get(),
      database.collection("organisationBilling").doc(deal.organisationId).get(),
      database.collection("hamletSlackSettings").doc(deal.organisationId).get(),
    ]);
    if (!organisationSnap.exists || organisationSnap.data().status !== "active" ||
        !billingSnap.exists || !["active", "trialing"].includes(billingSnap.data().status)) continue;
    const settings = settingsSnap.exists ? settingsSnap.data() : {};
    if (isQuietHours(now, settings)) continue;
    const leadHours = Number.isFinite(Number(settings.reminderLeadHours)) ? Math.max(1, Math.min(168, Math.floor(Number(settings.reminderLeadHours)))) : 24;
    const stage = dueStage(dueDate, now, leadHours);
    if (!stage) continue;
    for (const installationDoc of installations.docs) {
      const installation = installationDoc.data() || {};
      const ownerResult = await dispatchCriticalPathReminder(database, installation, installationDoc.id, dealDoc, deal, deal.nextActionOwnerUid, stage, dueDate, settings, false);
      if (ownerResult === "sent") sent++; else if (ownerResult === "failed") failed++; else suppressed++;
      if (stage === "overdue_day_2" && settings.managerEscalationEnabled === true) {
        const managers = await database.collection("organisationMembers")
          .where("organisationId", "==", deal.organisationId).where("status", "==", "active")
          .where("role", "in", ["owner", "admin", "manager"]).limit(50).get();
        for (const managerDoc of managers.docs) {
          const manager = managerDoc.data() || {};
          if (!manager.uid || manager.uid === deal.nextActionOwnerUid) continue;
          const result = await dispatchCriticalPathReminder(database, installation, installationDoc.id, dealDoc, deal, manager.uid, "escalation_day_2", dueDate, settings, true);
          if (result === "sent") sent++; else if (result === "failed") failed++; else suppressed++;
        }
      }
    }
  }
  console.log("Hamlet Slack critical-path reminder run:", {scanned: snapshot.size, sent, suppressed, failed});
});
