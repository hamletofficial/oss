"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const slack = fs.readFileSync(path.join(root, "functions", "hamlet-slack.js"), "utf8");
const index = fs.readFileSync(path.join(root, "functions", "index.js"), "utf8");
const deals = fs.readFileSync(path.join(root, "app", "hamlet", "organisation-deals.html"), "utf8");
const integrations = fs.readFileSync(path.join(root, "app", "hamlet", "organisation-integrations.html"), "utf8");
const linkPage = fs.readFileSync(path.join(root, "app", "hamlet", "slack-link.html"), "utf8");
const rules = fs.readFileSync(path.join(root, "firestore.rules"), "utf8");

test("Slack Firebase module and function registry parse as JavaScript", () => {
  assert.doesNotThrow(() => new vm.Script(slack, {filename: "functions/hamlet-slack.js"}));
  assert.doesNotThrow(() => new vm.Script(index, {filename: "functions/index.js"}));
});

test("Slack endpoints verify signatures and use one-time OAuth state", () => {
  assert.match(slack, /x-slack-request-timestamp/);
  assert.match(slack, /timingSafeEqual/);
  assert.match(slack, /hamletSlackOAuthStates/);
  assert.match(slack, /expiresAt: Timestamp\.fromMillis\(Date\.now\(\) \+ 600000\)/);
  assert.match(slack, /oauth\.v2\.access/);
});

test("Slack bot tokens are encrypted and never written in plaintext", () => {
  assert.match(slack, /aes-256-gcm/);
  assert.match(slack, /SLACK_TOKEN_ENCRYPTION_KEY/);
  assert.match(slack, /tokenCiphertext/);
  assert.doesNotMatch(slack, /botToken\s*:\s*payload\.access_token/);
});

test("Slack account linking binds a Slack workspace identity to an active Hamlet member", () => {
  assert.match(slack, /completeHamletSlackAccountLink/);
  assert.match(slack, /hamletSlackUserLinks/);
  assert.match(slack, /hamletSlackUidLinks/);
  assert.match(slack, /userLink\.status !== "active"/);
  assert.match(slack, /membershipSnap\.data\(\)\.status !== "active"/);
});

test("critical-path scheduler uses organisation deals and tenant access checks", () => {
  assert.match(slack, /sendHamletSlackCriticalPathReminders/);
  assert.match(slack, /collection\("organisationDeals"\)/);
  assert.match(slack, /nextActionDueAt/);
  assert.match(slack, /nextActionOwnerUid/);
  assert.match(slack, /userCanReadDeal/);
  assert.match(slack, /hamletSlackReminderDeliveries/);
  assert.match(slack, /every 15 minutes/);
  assert.match(slack, /europe-west2/);
});

test("organisation deal editor exposes an action owner and due date for reminders", () => {
  assert.match(deals, /id="nextActionTitle"/);
  assert.match(deals, /id="nextActionOwnerUid"/);
  assert.match(deals, /id="nextActionDueAt"/);
  assert.match(deals, /data\.nextActionDueAt=firebase\.firestore\.Timestamp\.fromDate\(new Date\(actionDue\)\)/);
});

test("organisation integration and account-link pages invoke trusted callables", () => {
  assert.match(integrations, /beginHamletSlackInstallation/);
  assert.match(integrations, /getHamletSlackIntegrationStatus/);
  assert.match(integrations, /updateHamletSlackReminderSettings/);
  assert.match(linkPage, /completeHamletSlackAccountLink/);
});

test("Firebase function registry exports Hamlet Connect", () => {
  assert.match(index, /require\("\.\/hamlet-slack"\)/);
});

test("Slack private collections are excluded from the super-administrator client read-through", () => {
  assert.match(rules, /serverOnly/);
  assert.match(slack, /serverOnly: true/);
  assert.match(rules, /resource\.data\.serverOnly != true/);
});

test("Slack slash commands are acknowledged before Firestore processing", () => {
  const handler = slack.slice(slack.indexOf("exports.hamletSlackEvents"), slack.indexOf("function isQuietHours"));
  assert.ok(handler.indexOf('response.status(200).send("")') < handler.indexOf("claimSlackRequestNonce(database"));
  assert.match(handler, /sendSlackCommandResponse/);
  assert.match(slack, /hooks\.slack\.com/);
});

test("critical-path delivery decrypts the selected tenant installation token", () => {
  assert.match(slack, /decryptToken\(currentInstallation\)/);
  assert.doesNotMatch(slack, /decryptToken\(installationSnap\.data\(\)\)/);
});

test("reminder dispatch revalidates the live deal, installation, entitlement, membership and role", () => {
  const dispatcher = slack.slice(slack.indexOf("async function dispatchCriticalPathReminder"), slack.indexOf("exports.sendHamletSlackCriticalPathReminders"));
  assert.match(dispatcher, /dealDoc\.ref\.get\(\)/);
  assert.match(dispatcher, /currentDeal\.nextActionOwnerUid !== recipientUid/);
  assert.match(dispatcher, /\["owner", "admin", "manager"\]\.includes\(membership && membership\.role\)/);
  assert.match(dispatcher, /currentInstallation\.status !== "active"/);
  assert.match(dispatcher, /billingSnap\.data\(\)\.status/);
  assert.match(dispatcher, /isQuietHours\(new Date\(\), currentSettings\)/);
});

test("manager escalation is an explicit organisation administrator opt-in", () => {
  assert.match(integrations, /id="managerEscalation"/);
  assert.match(integrations, /managerEscalationEnabled:\$\('managerEscalation'\)\.checked/);
  assert.match(slack, /managerEscalationEnabled: settings\.managerEscalationEnabled === true/);
  assert.match(slack, /stage === "overdue_day_2" && settings\.managerEscalationEnabled === true/);
});
