# Hamlet Connect architecture

## Logical flow

```text
Slack workspace
  -> centrally managed Hamlet Connect Slack app
  -> Cloudflare Worker gateway
  -> Slack request signature and timestamp verification
  -> installation and linked-user resolution
  -> Hamlet account authentication and entitlement checks
  -> organisation membership and resource-level authorisation
  -> approved Hamlet service / callable operations
  -> AI orchestration over authorised context
  -> Slack response or confirmation interaction
```

## Components

### Slack application

Use Slack OAuth installation, slash commands, shortcuts, event subscriptions, interactive components and bot responses as appropriate. Request the minimum scopes necessary for each feature. Do not request broad message-history or file scopes merely because they may be useful later.

### Cloudflare Worker gateway

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

### Data and write operations

Read from existing Hamlet services and collections through trusted server-side interfaces. Do not create a parallel property, deal or organisation database in Slack.

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

Use bounded retries, dead-letter handling and idempotent processing for Slack event delivery. Avoid logging message bodies, access tokens, file contents or personal data by default. Use correlation IDs and minimal operational metadata. Provide safe degradation when Firebase, AI providers or Slack APIs are unavailable.