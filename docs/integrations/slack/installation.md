# Hamlet Connect installation and rollout

## Status

Planning document only. No Slack application, OAuth credentials, callback URL, production gateway or customer installation is created by this document.

## Slack app setup

Create one centrally owned Slack app for Hamlet Connect. Keep development, staging and production installations and credentials separate.

Before enabling a feature, define:
- OAuth redirect URL for the chosen environment.
- Minimum bot and user scopes.
- Slash commands and request URLs.
- Event subscriptions.
- Interactive component request URL.
- Uninstall and token-revocation handling.
- Privacy policy, terms, support contact and AI processing disclosures.

Do not publish placeholder callback URLs or configure production OAuth until the gateway endpoint exists and is tested.

## Organisation administrator journey

1. An authorised Hamlet organisation owner or administrator opens Integrations in the Hamlet organisation workspace.
2. Hamlet checks organisation lifecycle and subscription entitlement.
3. The administrator starts Slack OAuth and reviews the requested permissions.
4. Slack redirects to the environment-specific callback.
5. The gateway validates OAuth state and exchanges the code server-side.
6. Hamlet records the Slack installation and links it to the selected organisation.
7. The administrator completes a test connection and selects enabled capabilities, including reminder lead times, quiet hours and escalation rules where applicable.
8. Members link their own Slack identities to verified Hamlet accounts before using protected features.

## Member account-linking journey

1. A member invokes the Hamlet Connect link-account command.
2. The gateway returns a short-lived, single-use linking URL or challenge.
3. The member authenticates directly with Hamlet and completes the link.
4. Hamlet verifies the member and organisation access.
5. The mapping is stored server-side and the member receives a success response.
6. Unlinking or membership removal revokes the mapping's ability to access organisation data.

## Critical Path Reminders

The planned reminder capability uses due dates, ownership and completion state already held in Hamlet. Organisation administrators should be able to configure reminder lead times, quiet hours and escalation recipients. The assigned member receives a private Slack reminder; authorised managers receive escalations only when the configured policy requires them. Each alert links back to the relevant Hamlet record.

The pilot must verify timezone handling, duplicate suppression, due-date changes, reassignment, completed actions, removed members, revoked permissions, delivery failures and escalation access. Slack messages are notifications only; the underlying milestone and task status remain authoritative in Hamlet.

## Pilot

Start with a non-production Slack workspace and test Hamlet organisation. Use synthetic records and test accounts. Begin with read-only Deal Copilot and Property Intelligence, then enable Critical Path Reminders against test milestones after the scheduler and permission tests pass. Expand only after the security test matrix passes.

## Production release gates

- Separate staging and production Slack credentials.
- OAuth state validation, signature verification, replay protection and idempotency.
- Tenant isolation and resource-level authorisation tests.
- Scheduled reminder processing, timezone and duplicate-delivery tests.
- Audit coverage for all writes and reminder outcomes.
- Data protection and AI provider review.
- Rate limiting, monitoring, incident response and support runbook.
- Clear organisation disconnect and Slack uninstall behaviour.
- Tested rollback and credential rotation procedures.

## Marketplace readiness

Marketplace submission is a separate release decision. First demonstrate stable multi-workspace operation, clear customer value, support readiness, privacy disclosures, complete installation/uninstallation behaviour and compliance with current Slack Marketplace requirements.
