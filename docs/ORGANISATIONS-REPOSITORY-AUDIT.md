# Hamlet Organisations — Phase 0 Repository and Service Audit

**Status:** Initial static repository audit completed  
**Branch:** `feat/hamlet-organisations-foundation`  
**Scope:** Read-only inspection of repository configuration and application code  
**Production changes:** None. No DNS, Worker, Firebase configuration, rules, secrets, or live data were changed.

## Executive summary

The repository contains enough existing infrastructure to support an additive organisation layer, but implementation should not begin until several deployment and authorization assumptions are resolved. The most important design constraint is that Hamlet's current deal and property records are predominantly user-owned, not organisation-owned. Organisation collaboration therefore needs explicit resource-sharing semantics and new tenant-aware authorization; it must not be implemented by broadening existing owner checks.

The codebase has a single configured Firebase project in `.firebaserc` (`wale-491805`). The root Firebase configuration targets Firestore database `(default)` in `nam5`; `app/firebase.json` also names `(default)` but specifies `nam7`. The latter file appears to be an application/emulator configuration, and its presence alone does not establish a second production database. The deployed database location and which CLI configuration is used by each workflow must be verified before changing rules or indexes.

Two separate Worker projects are present in the repository: `worker/hamlet-ai` (named `hamlet-ai-gateway-staging`) and `hamlet-ai-gateway` (named `hamlet-ai-gateway`). Neither checked-in Wrangler configuration currently declares organisation hostname routes. Cloudflare zone DNS, route bindings, custom domains, and deployed Worker state are external to this repository and remain unverified.

## 1. Firebase project and deployment configuration

### Observed

- `.firebaserc` maps the default Firebase project to `wale-491805`.
- Root `firebase.json` configures:
  - Firestore database `(default)`, location `nam5`, rules `firestore.rules`, indexes `firestore.indexes.json`.
  - Storage rules in `storage.rules`.
  - Hosting from `public`, with a catch-all rewrite to `/index.html`.
  - Four Functions codebases: `default`, `sagat`, `ryu`, and `ken`.
  - Additional App Hosting backends, Realtime Database rules, Remote Config, and Data Connect.
- `app/firebase.json` separately configures Firestore database `(default)` in `nam7`, plus emulator ports and a single Functions codebase.
- Root `firebase-config.js` points browser clients at project `wale-491805` and the Firebase default auth domain.
- The root Functions package metadata and `functions/package.json` differ in their Node engine declarations (Node 22 vs Node 24) and scripts. The actual deployment source selected by Firebase CLI is the `functions` directory in root `firebase.json`.

### Implications and actions

1. Confirm the production Firestore database ID/location in Firebase Console or a read-only CLI inspection, and determine whether `app/firebase.json` is only for local/emulator use.
2. Establish the exact CLI working directory and config file used by each deployment workflow/script.
3. Confirm which Functions codebases are deployed and which codebase owns future organisation callables.
4. Do not copy the `nam7` location into production instructions or deploy rules from the app directory until its purpose is confirmed.

**Risk:** Deploying rules or indexes from the wrong Firebase configuration could target an unintended database or create deployment drift.

## 2. Authentication and identity

### Observed

- The shared browser configuration uses Firebase Authentication with the Firebase project auth domain.
- `login.html` supports Firebase popup and redirect flows for Google, Facebook, Microsoft, X/Twitter, Apple and a LinkedIn custom exchange flow.
- The login flow uses `sessionStorage` for redirect state and a `next` destination.
- The deal workspace initializes Firebase on the current page origin and checks `onAuthStateChanged`.
- The organisation architecture document correctly notes that Firebase client authentication state must not be assumed to carry across subdomain origins.

### Implications and actions

- Do not assume a user authenticated on `hamlet-ai.co.uk` is automatically authenticated on `{slug}.orgs.hamlet-ai.co.uk`.
- Prototype a central sign-in handoff using a short-lived, one-time code exchanged server-side for a tenant-origin session, or evaluate a backend session-cookie design.
- Never place Firebase ID tokens, custom tokens, session cookies, or invitation secrets in query strings, browser history, referrers, or logs.
- Test every configured identity provider against the intended custom auth domain and callback/redirect URIs before DNS rollout.
- Re-check the authenticated user's UID, organisation status, active membership and role on every protected operation. A hostname or slug is never authorization.

**Decision required:** Choose and threat-model the cross-subdomain session architecture before creating production organisation hostnames.

## 3. Existing data ownership and collaboration boundaries

### Observed

- `publicProfiles/{uid}` is the canonical member profile model, documented in `PROFILE-SERVICE.md`.
- Commercial property source records in `commercialProperties` are owner-scoped by `ownerUid`; public listing projections live separately in `publicProperties`.
- Residential source records in `residentialProperties` are owner-scoped; public projections live in `publicResidentialProperties`.
- `hamletDeals/{dealId}` is explicitly private to the owning broker UID in Firestore Rules. The client loads deals with `.where('uid', '==', user.uid)`.
- `hamletReminders`, `hamletDealEvents`, `hamletDocuments`, and `hamletSavedSearches` are also user-scoped.
- Deal document metadata and transaction files are tied to the individual owner and deal in Firestore and Storage rules.
- Broker rankings aggregate deals by `uid`, so organisation collaboration must preserve individual broker attribution and avoid corrupting ranking semantics.

### Implications and actions

- Preserve `ownerUid` / `uid` as personal ownership and creator attribution.
- Add explicit organisation association and resource-level sharing fields only where collaboration is intended.
- Define whether an organisation is a co-owner, a workspace container, or a permissioned collaborator. The recommended first iteration is **personal ownership plus explicit organisation sharing**, not automatic transfer of ownership.
- Define revocation behaviour when a member leaves, is suspended, or loses a role.
- Keep public listing projections independent of private organisation membership and private source metadata.
- Update ranking calculations only if a separately specified organisation-level metric is introduced; do not replace broker-level metrics.

## 4. Firestore and Storage security

### Observed

- Existing Firestore rules are deny-by-default for unmatched paths and contain detailed UID ownership checks for profiles, deals, reminders, documents and listings.
- The deal rules restrict `hamletDeals` create/update to the authenticated UID and validate the record shape.
- Storage rules deny unmatched access and currently scope transaction documents to `hamletDocuments/{userId}/{dealId}/...`, checking that the authenticated UID owns the corresponding deal.
- Property image paths are currently user-scoped, including `commercialPropertyImages/{userId}/...` and `residentialPropertyImages/{userId}/...`.
- Existing rule tests are in `tests/hamlet-rules.test.cjs` and use `@firebase/rules-unit-testing` with Firestore and Storage emulators. The root package's `test` script is currently a placeholder rather than a test runner.

### Implications and actions

- Add explicit rules for each organisation collection and tenant-aware resource operation; do not add broad wildcard access.
- Verify membership state and organisation ID in the same tenant for every read/write. Prevent cross-tenant access even where a user belongs to multiple organisations.
- Use trusted server code for organisation creation, slug reservation, invitations, invitation acceptance, role changes, ownership transfer, suspension and audit events.
- Store only a hash of a high-entropy, single-use invitation token; enforce expiry, revocation, verified-email matching and replay prevention.
- Review Storage tenancy independently. A Firestore membership check does not automatically protect files in an organisation path.
- Add emulator tests for unauthenticated users, non-members, wrong-tenant members, each role, suspended/removed members, public/private directory projections, role escalation, invitation replay/expiry, and organisation file access.
- Add an explicit, reproducible test command and ensure CI runs the Firestore and Storage emulator suites before merge.

**Blocker:** No organisation-specific Firestore/Storage rules or emulator tests exist yet. This is expected at the planning stage, but must be addressed before enabling organisation writes.

## 5. Cloud Functions and trusted operations

### Observed

- Root Firebase configuration declares four Functions codebases.
- `functions/index.js` already uses Firebase Admin SDK and callable/triggered functions for messaging, LinkedIn auth exchange, deal/property history, reminders and super-admin operations.
- `functions/hamlet-rankings.js` derives broker ranking aggregates from individual deal records.
- The existing codebase provides a natural home for trusted organisation operations, but the deployed codebase mapping and runtime need to be confirmed first.

### Implications and actions

Implement organisation operations server-side, using Admin SDK transactions and verified Firebase Auth identity. Suggested initial callable operations:

- `createOrganisation`: validate identity, normalise/reserve slug transactionally, create organisation and initial owner membership.
- `createOrganisationInvitation`: enforce inviter's active role and permitted invite scope; create token hash and expiry.
- `acceptOrganisationInvitation`: verify authenticated UID and verified email; consume token once and create membership transactionally.
- `changeOrganisationMemberRole`: prevent self-escalation and protect the owner invariant.
- `revokeOrganisationInvitation` / `removeOrganisationMember`: enforce role and lifecycle constraints.
- `transferOrganisationOwnership`: explicit confirmation and transactionally preserve exactly one owner.
- Append audit events from trusted code only.

Avoid a generic callable that accepts arbitrary collection names, document paths, role strings or tenant IDs from the browser.

## 6. Cloudflare and hostname routing

### Observed

- `worker/hamlet-ai/wrangler.toml` names a staging AI gateway Worker and sets project/model/email environment variables.
- `hamlet-ai-gateway/wrangler.jsonc` names a separate Worker and serves assets from its own `public` directory.
- The checked-in configurations do not declare routes or custom domains for `organisations.hamlet-ai.co.uk` or `*.orgs.hamlet-ai.co.uk`.
- No organisation hostname routing implementation was identified in the reviewed application paths.
- Cloudflare zone DNS records, proxy status, route assignments, certificate coverage and deployed Worker configuration cannot be confirmed from the repository files alone.

### Read-only Cloudflare account inspection

The connected Cloudflare account was inspected using read-only API operations:

- The `hamlet-ai.co.uk` zone is present, active and not paused.
- The DNS inventory returned 33 records. No record was present for `orgs.hamlet-ai.co.uk`, `organisations.hamlet-ai.co.uk`, or a wildcard `*.orgs.hamlet-ai.co.uk` hostname.
- The zone currently has two Worker routes, both on `www.hamlet-ai.co.uk`: `/v1/login-notification*` and `/v1/assist*`. Both route to `hamlet-ai-gateway-staging`.
- The account lists two Workers: `hamlet-ai-gateway` and `hamlet-ai-gateway-staging`.
- No organisation hostname route is currently configured in the inspected zone.

This confirms that the proposed organisation hostnames have not yet been provisioned in the inspected Cloudflare zone. Certificate coverage and detailed TLS settings were not inspected in this pass.

### Implications and actions

- Keep existing AI gateway Workers separate from the organisation workspace router unless a deliberate consolidation decision is made.
- Select a dedicated Worker or hosting route for tenant resolution, with strict host parsing, slug allow-list/normalisation, reserved-name handling and safe fallback behaviour.
- Resolve a slug to an organisation record; never infer membership from the host.
- Confirm TLS/certificate coverage for both the directory hostname and wildcard tenant hostnames.
- Confirm the Cloudflare zone and current records through a read-only account inspection before preparing a DNS change.
- Use a staging hostname and test route first. Do not create production DNS records until the authentication and tenant authorization tests pass.

**No Cloudflare changes were made during this audit.**

## 7. Test and CI readiness

### Observed

- `tests/hamlet-rules.test.cjs` contains existing Firestore and Storage rules tests.
- The tests initialize Firebase rules test environments and exercise owner-only deal/document access and Storage restrictions.
- The root package script currently returns an error stating no test is specified.
- A separate `hamlet-ai-gateway` package has its own Vitest setup, unrelated to organisation tenancy.
- A Firebase Hosting PR workflow is present and uses a Firebase service-account secret for preview deployment; it does not establish that Firestore rules, Functions or Cloudflare Workers are deployed.

### Actions

- Identify or add the canonical test runner and dependency installation path for the rules suite.
- Add organisation rules tests and a CI job that runs them against emulators.
- Keep Hosting preview, Firestore rules/indexes, Functions, Storage and Worker deployment as separate deployment concerns.
- Verify all relevant workflows and branch protections before implementation.

## 8. Recommended implementation sequence

1. **Resolve configuration authority:** confirm production Firestore database location, CLI config, Functions codebase and deployment workflows.
2. **Choose auth handoff:** prototype and test a secure subdomain session flow before any production wildcard routing.
3. **Implement data model and trusted operations:** organisation, slug registry, membership, invitations and audit.
4. **Implement security first:** Firestore/Storage rules and emulator tests; prove cross-tenant denial before adding UI.
5. **Build organisation UI:** create/manage organisation, invitations, membership roles, and organisation switcher.
6. **Add tenant-aware resources:** start with one resource type, preferably a deliberately shared deal or property record, preserving personal ownership and audit attribution.
7. **Stage hostname routing:** deploy to a non-production hostname, validate TLS, auth and authorization, then prepare production DNS changes for explicit review.

## 9. Open decisions and external verification

The following cannot be established from the repository alone and require read-only inspection of the relevant service consoles/accounts:

- Which Firestore database location is actually serving production and whether any named database exists in addition to `(default)`.
- Which root/app Firebase configuration is used by each deployed environment.
- Which Functions codebases are currently deployed and their runtime versions.
- Firebase Authentication authorised domains, OAuth provider redirect configuration, and any custom auth domain already configured.
- Cloudflare zone ownership, DNS records and Worker routes were checked read-only. Wildcard certificate coverage, detailed TLS settings and account-level routing configuration remain to be verified.
- Whether any external backend or service outside this repository already owns tenant routing or session exchange.

## Audit conclusion

**Proceed with the organisation foundation only after the configuration and authentication questions above are resolved.** The safest model is an additive, single-project tenant layer with explicit memberships, trusted lifecycle operations, personal record ownership retained, and resource-level sharing. The current repository is not ready for wildcard organisation DNS or shared access to existing deals and documents.

No production infrastructure or user data has been modified by this audit.
