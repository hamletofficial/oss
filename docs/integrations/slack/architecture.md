# Hamlet Connect architecture

## Logical flow

```text
Slack workspace
  -> centrally managed Hamlet Connect Slack app
  -> Firebase HTTPS Functions gateway (europe-west2)
  -> Slack request signature and timestamp verification
  -> installation and linked-user resolution
  -> Hamlet account authentication and entitlement checks
  -> organisation membership and resource-level authorisation
  -> approved Hamlet service / callable operations
  -> AI orchestration over authorised context
  -> Slack response or confirmation interaction

Hamlet deal and critical-path records
  -> trusted scheduled reminder evaluator
  -> due/overdue candidate selection
  -> fresh tenant, membership and resource permission checks
  -> idempotent notification dispatch
  -> Slack DM to assigned member / authorised escalation recipient
  -> delivery and acknowledgement audit in Hamlet
```

## Components

### Slack application

Use Slack OAuth installation, slash commands, shortcuts, event subscriptions, interactive components and bot responses as appropriate. Request the minimum scopes necessary for each feature. Do not request broad message-history or file scopes merely because they may be useful later.

### Firebase HTTPS Functions gateway

The first implementation uses Firebase HTTPS Functions in `europe-west2` for the OAuth callback and Slack request endpoint. A Cloudflare Worker edge layer is not part of this code increment.

Responsibilities:
- Verify Slack request signatures against the raw request body and signing secret.
- Reject stale timestamps and invalid signatures; implement replay protection and idempotency.
- Acknowledge Slack requests within Slack's response deadline and process longer work asynchronously.
- Resolve the installation using Slack workspace/team and enterprise identifiers where present.
- Resolve the linked Hamlet account and active organisation context.
- Apply rate limits, payload limits and safe error handling.
- Never trust organisation IDs, user IDs, roles or resource IDs supplied by an untrusted Slack payload without server-side resolution and authorisation.

### Identity and installation mapping

Maintain server-side mappings for Slack installation, Slack user and Hamlet identity. Link accounts through an authenticated, verified Hamlet session and a short-lived, single-use linking challenge. Do not rely on matching email addresses as proof of identity. Support token rotation, revocation and uninstall events.

### Authorisation

For each request, verify:
1. Slack installation is active and belongs to the expected workspace.
2. Slack user has a valid linked Hamlet identity.
3. Hamlet account is active and satisfies required verification conditions.
4. Organisation is active and subscription entitlement permits the capability.
5. User is an active member of that organisation.
6. User has the required role, team assignment and resource-level permission.
7. The requested operation is permitted for the record's ownership and visibility.

Slack channel membership is not an authorisation input for Hamlet records. A private channel does not create or imply a Hamlet access grant.

### AI orchestration

The AI layer receives only the minimum authorised context required for the current request. Treat Slack messages, files and retrieved documents as untrusted data, not instructions. Defend against prompt injection and tool-output instruction attacks. The model may return structured recommendations, but it must not decide access rights or call privileged data operations directly.

### Critical Path Reminders

Critical Path Reminders are a planned v1 capability. Hamlet remains authoritative for deal milestones, task owners, due dates, completion state and escalation policy.

- Read milestone and action data from existing, authorised Hamlet deal records; do not maintain a separate Slack copy of task state.
- Evaluate due and overdue items in a trusted scheduled backend process (for example, a scheduled Firebase Cloud Function). The scheduler is server-side and must not depend on a user's Slack session being active.
- Support organisation-configured reminder lead times and a bounded cadence for overdue reminders. Use the organisation's configured timezone when calculating local due windows.
- Notify the assigned, linked Hamlet member by direct message. Send an escalation only to managers who are authorised for that deal and only under an organisation-approved escalation rule.
- Keep channel notifications off by default. Do not disclose deal names, counterparties, financial terms or sensitive property details in a channel; a minimal private prompt with a link to Hamlet is preferred.
- Before dispatch, re-check installation status, subscription entitlement, current membership, assignment and resource-level access. Re-check again when a recipient opens the linked record or attempts an acknowledgement.
- Use a deterministic idempotency key based on tenant, deal/action, due-date version, recipient and reminder stage so retries do not create duplicate alerts. A changed due date or reassignment must invalidate stale pending notifications.
- Record notification attempts, delivery outcomes and any acknowledgement in Hamlet's trusted audit/notification records. Slack delivery status is not proof that an action has been completed.
- A Slack acknowledgement may update only a narrowly defined reminder acknowledgement state through a trusted backend operation; it must never silently mark the underlying deal action complete.
- Respect user notification preferences and organisation quiet hours, with a clear route to view or manage reminders in Hamlet.

### Data and write operations

Read from existing Hamlet services and collections through trusted server-side interfaces. The first reminder implementation reads `organisationDeals` and uses the existing organisation membership, team and resource-share collections. Do not create a parallel property, deal or organisation database in Slack.

For write operations:
- Generate a typed proposal with target resource, intended changes and provenance.
- Show the proposal to the user in Slack.
- Require an explicit confirmation action bound to the initiating user, installation, organisation, payload hash and short expiry.
- Recheck all permissions and current resource state at confirmation time.
- Execute through a trusted callable/backend service.
- Record the actor, organisation, operation, target, timestamp, result and correlation ID in the appropriate audit record.
- Reject stale, replayed, modified or cross-user confirmations.

## Tenant isolation

Partition installation and identity mappings by immutable Slack workspace identifiers and Hamlet organisation identifiers. Every cache key, queued job, idempotency key and audit event must include tenant context. Never use a user-supplied organisation slug as proof of tenant identity.

Default v1 relationship: one Slack installation linked to one Hamlet organisation. If multi-organisation installations are introduced later, require an explicit organisation selector and repeat authorisation on every operation.

## Availability and operations

Use bounded retries, dead-letter handling and idempotent processing for Slack event delivery and scheduled reminder dispatch. Avoid logging message bodies, access tokens, file contents or personal data by default. Use correlation IDs and minimal operational metadata. Provide safe degradation when Firebase, AI providers or Slack APIs are unavailable.
