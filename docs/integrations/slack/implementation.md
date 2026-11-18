# Hamlet Connect — implementation and deployment checklist

## Repository implementation status

The current branch contains the first implementation increment:

- functions/hamlet-slack.js: Slack OAuth installation, request verification, account linking, connection status/disconnection, reminder settings and scheduled reminder delivery.
- functions/index.js: exports the Slack functions.
- app/hamlet/organisation-integrations.html: owner/admin integration configuration page.
- app/hamlet/slack-link.html: authenticated, single-use account-linking page.
- app/hamlet/organisation-deals.html: next critical-path action title, assigned member, due date and status fields.
- tests/hamlet-slack-static.test.cjs: static checks for source syntax and core security/integration requirements.

This is repository code, not a live deployment. No Slack app credentials have been supplied, no Firebase secrets have been set, and no Cloud Functions have been deployed by this change.

## Firebase project and region

Firebase project ID: wale-491805

All new Slack functions are configured for europe-west3.

### HTTPS endpoints

OAuth redirect URL:

https://europe-west3-wale-491805.cloudfunctions.net/hamletSlackOAuthCallback

Slack slash-command and Events API request URL:

https://europe-west3-wale-491805.cloudfunctions.net/hamletSlackEvents

These URLs become usable only after the corresponding functions are successfully deployed.

## Slack app configuration

Create one centrally owned Slack app for Hamlet Connect.

### OAuth & Permissions

Add this exact redirect URL to the Slack app's Redirect URLs:

https://europe-west3-wale-491805.cloudfunctions.net/hamletSlackOAuthCallback

Configure bot token scopes:

- commands
- chat:write
- im:write

The implementation does not request channel history, file access or broad user-data scopes.

### Slash command

Create /hamlet and set its Request URL to:

https://europe-west3-wale-491805.cloudfunctions.net/hamletSlackEvents

Supported commands:

- /hamlet link — creates a short-lived, single-use link for the signed-in Hamlet account.
- /hamlet status — checks whether the Slack identity is linked.

### Event subscriptions

Enable Events API and set its Request URL to the same hamletSlackEvents endpoint. Subscribe to the app_uninstalled event so the integration can revoke stored identity links when the app is removed.

The endpoint verifies Slack's request signature, rejects timestamps outside the five-minute window and records a short-lived request nonce so a captured signed request cannot be replayed. Keep Slack token rotation disabled for this first release; the implementation encrypts the installed bot token and supports revocation on administrator disconnect or app uninstall, but does not yet implement refresh-token rotation. It handles both form-encoded slash commands and JSON Events API payloads. Account-link URL issuance is rate-limited per Slack user and workspace.

## Firebase secrets

Set these four Firebase Functions secrets. Do not commit their values to GitHub or place them in firebase-config.js.

- SLACK_CLIENT_ID — Slack app client ID.
- SLACK_CLIENT_SECRET — Slack app client secret.
- SLACK_SIGNING_SECRET — Slack app signing secret.
- SLACK_TOKEN_ENCRYPTION_KEY — 32-byte key used for AES-256-GCM encryption of per-workspace bot tokens.

Generate the encryption key locally with:

openssl rand -base64 32

Copy the generated value into the Firebase secret prompt for SLACK_TOKEN_ENCRYPTION_KEY. Do not send it in chat or commit it to the repository.

Enable Firestore TTL on the expiresAt field for hamletSlackRequestNonces, hamletSlackLinkRateLimits, hamletSlackOAuthStates and hamletSlackLinkChallenges so expired replay, throttle, OAuth-state and account-link records are removed automatically. All Slack integration metadata collections are server-only; Firestore Rules exclude records marked serverOnly from the platform Super Administrator client read-through. Trusted Admin SDK Functions retain access.

Set each secret using Firebase CLI:

firebase functions:secrets:set SLACK_CLIENT_ID

firebase functions:secrets:set SLACK_CLIENT_SECRET

firebase functions:secrets:set SLACK_SIGNING_SECRET

firebase functions:secrets:set SLACK_TOKEN_ENCRYPTION_KEY

## Functions introduced

- beginHamletSlackInstallation — callable; owner/admin authorisation, active billing check and OAuth state creation.
- hamletSlackOAuthCallback — HTTPS; validates one-time state, exchanges Slack OAuth code and encrypts the workspace bot token.
- hamletSlackEvents — HTTPS; verifies Slack signatures, handles /hamlet commands and app-uninstall events.
- completeHamletSlackAccountLink — callable; binds the Slack user to an authenticated, verified, active Hamlet member.
- getHamletSlackIntegrationStatus — callable; returns safe installation metadata and reminder settings to organisation administrators.
- updateHamletSlackReminderSettings — callable; validates timezone, reminder lead time and quiet hours.
- disconnectHamletSlackInstallation — callable; disconnects a workspace and revokes its user-link mappings.
- sendHamletSlackCriticalPathReminders — scheduled function; runs every 15 minutes.

## Critical Path Reminder record fields

The first increment supports one current next action per organisation deal:

- nextActionTitle — short action description.
- nextActionOwnerUid — UID of an active organisation member.
- nextActionDueAt — Firestore Timestamp, not a date string.
- nextActionStatus — open, completed or cancelled.

The organisation deal editor writes these fields. The scheduled function scans organisationDeals for actions due within the configured lead window or up to three days overdue. Default lead time is 24 hours; maximum configurable lead time is 168 hours. Quiet hours default to 21:00–08:00 in Europe/London.

Reminders are private Slack direct messages. Manager escalation is disabled by default. An organisation owner or administrator may opt in to second-overdue-day escalation; only managers currently authorised to read the deal and linked to the Slack workspace are eligible. The delivery record uses a tenant-, deal-, due-date-, recipient- and stage-specific idempotency key. Acknowledgement is not treated as task completion.

## Deployment sequence

1. Merge the implementation after review and passing tests.
2. Set the four secrets in the correct Firebase project.
3. Deploy the named Slack functions to europe-west3.
4. Configure the Slack OAuth redirect URL, /hamlet command endpoint and app_uninstalled event subscription.
5. In a test Slack workspace, connect an active test Hamlet organisation from Organisation workspace → Integrations.
6. Run /hamlet link and complete account linking for two test members.
7. Create a test organisation deal with an action owner, due timestamp and open status.
8. Verify upcoming reminders, overdue reminders, quiet hours, escalation eligibility, duplicate suppression, member removal, resource-access revocation and app uninstall.
9. Only then enable the integration for production organisations.

Do not deploy until secrets are configured and the test workspace is available. Do not enable Slack channel broadcasts or broad read-history scopes for this first release.
