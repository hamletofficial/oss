# Hamlet Connect security and privacy requirements

This document defines release requirements, not evidence that controls have already been implemented.

## Authentication and secrets

- Use Slack OAuth installation and the least-privilege scope set.
- Store bot and user tokens in an approved secret store; encrypt at rest and restrict access.
- Store Slack signing secrets and OAuth client credentials as managed secrets, never in source control, client-side code, logs or documentation examples.
- Verify Slack signatures using the raw request body and reject stale timestamps.
- Use short-lived, single-use challenges for Hamlet account linking.
- Support token rotation, revocation, uninstall and organisation disconnection.
- Do not treat Slack email addresses, display names or channel membership as proof of Hamlet identity or access.

## Authorisation and tenant boundaries

- Resolve the installation and tenant from trusted server-side records.
- Recheck active Hamlet membership, organisation lifecycle, subscription entitlement, team assignment and resource-level permissions on every request and notification delivery.
- Preserve separation between personal and organisation-owned records.
- Never expose a record merely because it appears in a Slack conversation or file.
- Prevent cross-tenant cache, queue, search-index, file and logging access.
- Treat organisation slugs and resource identifiers as references, not credentials.
- Apply the same authorisation rules to AI retrieval, previews, buttons, modals, exports, notifications and background jobs.
- A reminder recipient must be currently authorised for the specific deal/action at dispatch time; stale assignments or removed memberships must suppress delivery.

## AI safety

- Treat Slack content, uploaded files, retrieved documents and model output as untrusted.
- Defend against prompt injection in messages and documents.
- Do not let model-generated text select its own permissions or bypass backend checks.
- Restrict tools to explicit, typed operations with server-side schemas and validation.
- Minimise context sent to model providers and document subprocessors, retention and transfer arrangements.
- Do not use customer content for model training unless separately and explicitly agreed under a lawful, transparent arrangement.
- Label generated summaries and recommendations as AI-generated; preserve links to source records where permitted.
- Do not present inferred risk, sustainability or compliance conclusions as verified facts.

## Confirmation and audit

- Read operations must be authorised at retrieval time.
- Consequential writes require a clear preview and affirmative user confirmation.
- Bind confirmations to user, installation, organisation, operation, resource, payload hash and expiry.
- Re-authorise at execution time and reject replay or stale state.
- Record consequential operations in trusted audit history.
- Never allow the AI to change membership, roles, ownership, billing, verification status, tenant lifecycle or security configuration in v1.
- Reminder delivery, suppression, escalation and acknowledgement must be auditable. A Slack acknowledgement must not be interpreted as completion of the underlying deal action.

## Privacy and retention

- Collect only data required for the enabled feature.
- Avoid retaining full Slack message bodies or file contents unless essential and explicitly documented.
- Define retention and deletion handling for installation metadata, identity mappings, event payloads, generated summaries and operational logs.
- Reminder messages should disclose the minimum information needed and normally direct the recipient to the authorised Hamlet record.
- Define retention for reminder delivery and acknowledgement metadata in line with Hamlet's organisation retention policy.
- Honour Slack uninstall and Hamlet disconnection by revoking credentials and disabling the integration.
- Provide an organisation administrator with a clear view of connected workspaces and the ability to disconnect them.
- Complete a data protection assessment before production rollout.

## Minimum adversarial test matrix

- Invalid signature and stale timestamp.
- Replayed event and duplicate delivery.
- Forged workspace, user, organisation and resource identifiers.
- User linked to one organisation attempting to query another.
- Removed member, suspended organisation or expired subscription.
- Team member attempting to access an unassigned deal/property.
- Private Slack channel containing a link to an unauthorised Hamlet record.
- Prompt injection embedded in a Slack message or uploaded document.
- Confirmation replayed by another user or after expiry.
- Resource permission revoked between proposal and confirmation.
- Reminder due-date change, reassignment or completion immediately before dispatch.
- Duplicate scheduler invocation and retry after partial Slack API failure.
- Escalation to a manager without current access to the underlying deal.
- Quiet-hours and timezone boundary calculations.
- Slack app uninstall, token revocation and account unlinking.
- AI provider timeout, malformed output and unsafe tool arguments.

All tests must fail closed: no data disclosure and no unauthorised mutation.
