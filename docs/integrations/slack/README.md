# Hamlet Connect — Slack integration

## Product definition

Hamlet Connect is a centrally managed Slack application that provides authorised Slack workspaces with conversational access to Hamlet IWMS capabilities. One Slack application serves multiple subscribing Hamlet organisations. Each installation is independently linked to one or more explicitly authorised Hamlet organisation contexts.

**Architecture decision:** platform-first (Option B): one centrally maintained Slack application, multi-workspace installation, strict tenant isolation.

## Product principles

- Hamlet remains the system of record; Slack is an interaction and collaboration surface.
- The AI layer may interpret requests and propose actions, but trusted backend services make authorisation decisions and perform writes.
- Slack workspace membership never grants Hamlet data access.
- Personal and organisation-owned records remain separate.
- Organisation and resource permissions are re-evaluated on every request and notification delivery.
- Consequential writes require explicit confirmation and are recorded in the appropriate audit history.
- No cross-tenant retrieval, caching, logging or disclosure.
- Notifications are concise prompts to return to Hamlet, not a second source of truth for deal dates or task status.

## Initial capabilities

1. Deal Copilot: summaries of deals the linked user may access.
2. Property Intelligence: search and contextual answers over permitted property records.
3. Critical Path Reminders: scheduled alerts for assigned deal actions and milestones approaching or passing their due dates, with controlled escalation to authorised managers.
4. Action Extractor: propose tasks, owners and dates from user-submitted or explicitly selected Slack content.
5. Organisation Assistant: answer questions using permitted organisation resources.
6. Executive Briefing: aggregate operational summaries for authorised managers.

Critical Path Reminders are part of the planned v1 product scope. They are not implemented or deployed by this documentation-only pull request.

The first release should be read-only apart from explicitly confirmed, narrowly scoped action creation or acknowledgement. Do not implement autonomous deal-stage changes, membership changes, permission changes, document sharing or financial/billing operations.

## Tenant model

- A single Slack app registration and codebase is maintained by Hamlet.
- Each Slack installation is identified by Slack's workspace/team identifier and installation metadata.
- Each installation is linked to an organisation only through an authenticated, explicit administrator-led linking flow.
- A Slack workspace may be linked to multiple Hamlet organisations only if the product deliberately supports that configuration and the active organisation context is explicit. The initial release should default to one organisation per installation to reduce ambiguity.
- Multiple Slack workspaces may be linked to the same Hamlet organisation only where an organisation administrator explicitly authorises each installation.
- Slack user identity is mapped to a verified Hamlet account through an OAuth-backed account-linking flow. Email matching alone is not sufficient.
- Organisation subscription entitlement is checked server-side.

## Proposed repository layout

```text
slack/
  manifest.json
  README.md
  commands/
  events/
  interactions/
  blocks/
worker/
  hamlet-slack-gateway/
functions/
  hamlet-slack-integration.js
docs/integrations/slack/
  README.md
  architecture.md
  security.md
  installation.md
  critical-path-reminders.md
```

These are the current implementation paths for the first increment. No Slack credentials, secrets, deployed endpoints or production installation are implied; see implementation.md for the configuration and deployment checklist.

## Delivery sequence

1. Configure the centrally owned Slack app, scopes, slash command and OAuth callback.
2. Configure Firebase secrets and deploy the europe-west2 Slack HTTPS/callable functions.
3. Complete OAuth installation from the organisation Integrations page and verify tenant isolation.
4. Link individual Slack identities using /hamlet link.
5. Pilot scheduled Critical Path Reminders using synthetic organisation deals and assigned members.
6. Implement Deal Copilot and Property Intelligence as separately permissioned capabilities.
7. Add interactive confirmation and narrowly scoped action creation or acknowledgement.
8. Assess Slack Marketplace readiness only after multi-workspace behaviour, privacy disclosures and support processes are production-ready.

## Release gate

Do not deploy or publish until tenant isolation, OAuth lifecycle, token storage, request verification, permission rechecks, audit behaviour, reminder idempotency, data retention and failure handling have been independently tested.
