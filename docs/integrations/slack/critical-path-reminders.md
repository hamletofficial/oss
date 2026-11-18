# Critical Path Reminders — product and technical specification

## Status and scope

This document defines the planned Hamlet Connect v1 capability and its acceptance criteria. A first scheduler and deal-editor implementation exists in the current branch, but it is not deployed and no live Slack notification service is configured.

Critical Path Reminders surface upcoming and overdue actions from Hamlet deal workflows in Slack. The first increment supports one current next-action record per organisation deal using `nextActionTitle`, `nextActionOwnerUid`, `nextActionDueAt` (Firestore Timestamp) and `nextActionStatus` (`open`, `completed` or `cancelled`). Hamlet remains the system of record for the milestone, assigned owner, due date, completion state and audit history.

## User outcomes

- Assigned brokers receive timely, private reminders for upcoming actions.
- Overdue actions remain visible until completed, rescheduled or otherwise resolved in Hamlet.
- Authorised managers receive controlled escalations for material or persistently overdue milestones.
- Users can return directly to the relevant Hamlet deal or task.
- Duplicate, stale or unauthorised notifications are suppressed.

## Functional requirements

1. Evaluate existing deal actions and critical-path milestones with a valid due date and current status.
2. Support organisation-configured reminder lead times and overdue cadence.
3. Use the organisation timezone for local date and quiet-hours calculations.
4. Deliver reminders by Slack direct message to the currently assigned, linked Hamlet member.
5. Escalate only under an explicit organisation policy and only to managers who have current access to the specific deal.
6. Include a deep link to the authorised Hamlet record. Do not include sensitive deal detail in channel messages.
7. Suppress reminders for completed, cancelled, archived or superseded actions.
8. Recalculate pending reminders after a due-date change, reassignment, permission change or organisation suspension.
9. Record notification attempts, delivery outcomes, suppression reasons and acknowledgements in Hamlet.
10. Keep Slack acknowledgement separate from the action's completion state.

## Processing design

A trusted scheduled backend process periodically queries a bounded set of due and overdue candidates from Hamlet. It must:

- Resolve the organisation and Slack installation from trusted server-side mappings.
- Check subscription entitlement, active membership, current assignment and record-level permissions at dispatch time.
- Resolve the recipient's linked Slack identity from the tenant-scoped mapping.
- Apply organisation timezone, quiet hours and reminder policy.
- Generate a deterministic idempotency key including tenant, action, due-date revision, recipient and reminder stage.
- Persist a pending dispatch record before sending, then record the Slack API result.
- Use bounded retries and dead-letter handling; retries must reuse the same idempotency key.
- Re-check permissions when a user opens the deep link or invokes an acknowledgement action.

The scheduler must not rely on Slack message history, channel membership or an active browser session. Slack is the delivery surface, not the source of dates or workflow state.

## Notification policy

- Default delivery: direct message to the assigned member.
- Default channel delivery: disabled.
- Escalation: disabled by default; an organisation owner or administrator must explicitly enable the fixed second-overdue-day rule. Recipients are limited to managers who independently pass the current deal-access check and have linked Slack identities.
- Quiet hours: respected using the organisation timezone; urgent exceptions, if ever supported, require an explicit policy.
- Content: minimum necessary context, action label, due/overdue status and a secure Hamlet link.
- Preferences: provide a clear way to manage or mute non-essential reminders without changing Hamlet task ownership or due dates.

## Security and failure handling

- Fail closed if tenant mapping, user linking, entitlement or resource authorisation cannot be verified.
- Never disclose a deal or task to an unlinked Slack user or a manager without current deal access.
- Suppress and audit notifications when an assignee is removed, reassigned or loses access.
- Protect dispatch from duplicate scheduler runs, Slack retries and partial failures.
- Do not let AI determine recipients, access rights, due dates or escalation eligibility.
- Do not mark a task complete based on a Slack reaction or acknowledgement.
- Revoke integration delivery when the Slack installation is disconnected or uninstalled.

## Acceptance criteria

- An assigned, authorised member receives one reminder for a configured lead-time window.
- A retry or duplicate scheduler invocation does not create a second logical reminder.
- A due-date revision invalidates the old pending reminder and produces the correct new schedule.
- A reassigned task is not delivered to the former assignee.
- A removed member, suspended organisation or expired entitlement receives no reminder.
- An escalation is delivered only to an authorised manager under the configured policy.
- Quiet hours and daylight-saving transitions are handled using the organisation timezone.
- A completed or cancelled action is not reminded.
- A delivery failure is visible to operators and safely retried without duplicate logical dispatch.
- Acknowledging a Slack reminder does not mark the underlying Hamlet action complete.
- Notification and acknowledgement outcomes are auditable in Hamlet.

## Out of scope for the first release

- Autonomous deal-stage changes.
- AI-generated changes to due dates or task ownership.
- Broad channel broadcasts containing deal details.
- Slack as a replacement task manager or system of record.
- Automatic escalation based solely on AI-inferred deal risk.
