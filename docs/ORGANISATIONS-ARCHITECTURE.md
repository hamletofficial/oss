# Hamlet Organisations — Architecture and Delivery Plan

**Status:** Approved product direction; implementation plan  
**Repository:** `hamletofficial/oss`  
**Product:** Hamlet by Impact in Business Recruitment Group Limited

## Product objective

Introduce **Hamlet Organisations** as a first-class multi-tenant capability alongside existing individual member accounts. An organisation has its own profile, membership, roles, workspace, property and deal collaboration, activity history, and optional branded address. Individual users retain their own Hamlet identity and may belong to multiple organisations.

This document establishes the safe delivery sequence. It does not claim that DNS, Firebase, Cloudflare, or production configuration has already been changed.

**Canonical implementation contract:** See [Organisation Tenancy, Ownership and Permissions](./ORGANISATION-TENANCY-OWNERSHIP-PERMISSIONS.md) for the authoritative UID, membership, ownership, role, team, resource-sharing and lifecycle rules. Where older illustrative schema examples below differ from the deployed implementation, the canonical contract records the implementation field names and the reconciliation required.

## Core product principles

1. Individual accounts remain independently owned and usable outside any organisation.
2. Membership is an explicit relationship between a user and an organisation; it is not an organisation field on a user profile.
3. Organisation access is deny-by-default and enforced by Firestore Rules and trusted server-side operations, never by UI visibility alone.
4. Every tenant-owned record carries an immutable `organisationId`; access checks validate active membership and the required role.
5. Existing individual-owned listings, deals, profiles, and workspaces remain unchanged unless an explicit, audited transfer or sharing action is performed.
6. Public organisation profiles are separate projections containing only approved public fields.
7. Shared infrastructure is preferred over per-organisation Firebase projects or duplicated application deployments.
8. Do not deploy new Firestore rules, DNS records, Worker routes, or authentication changes until emulator tests and environment configuration have been reviewed.

## Product surface

### Public organisation directory

- Search and discover public organisation profiles.
- Display name, logo, description, website, industry, public location, public membership count, and verification state.
- Respect public/private directory visibility.
- Never expose member email addresses, invitations, private portfolio data, or internal activity.

### Organisation workspace

- Overview and organisation profile.
- Members, invitations, membership requests, roles, and teams.
- Commercial and residential portfolio views.
- Deal pipeline and collaboration.
- Organisation activity and audit history.
- Settings, branding, access controls, and lifecycle state.

The workspace should reuse existing Hamlet modules where their data model and permissions support tenant-scoped access. It must not silently convert individually owned records into organisation-owned records.

#

### Property address search and Google Places

The connected commercial and residential portfolio experience must retain a consistent, structured address lookup across both property types. Use the existing Google Places integration as the address discovery/autocomplete provider, subject to production API enablement and key restrictions.

Required search and capture fields:
- UK postcode (including partial postcode input);
- street name;
- first line of address / building number and street.

The address workflow should:
- support address autocomplete and selection rather than treating free-text search as a verified address;
- populate structured address components (first line, street, locality/town, postcode, and country) from the selected Place result where available;
- allow the user to review and correct the returned address before saving;
- preserve the existing property record schema and individual ownership rules;
- work consistently in both commercial and residential property search/submission journeys, including organisation-connected portfolio views;
- avoid exposing the Google API key in source control or server logs.

Before release, enable the appropriate Google Places API service(s) in the correct Google Cloud project, restrict the browser key to the required Hamlet production origins and only the required APIs, and verify billing/quota controls. If server-side Places requests are introduced, use a separate server key stored in managed secrets and restrict it by API and server egress/IP where supported. Do not broaden key restrictions or commit credentials to the repository. Test postcode, street, and first-line searches on desktop and mobile.

This integration provides address discovery; it does not itself grant access to, share, or transfer a property record between personal and organisation portfolios. Those permissions remain governed by the tenant/resource-sharing model above.

## Membership roles

Initial roles:

- **owner** — organisation ownership, administrator management, organisation lifecycle.
- **admin** — organisation settings, invitations, membership and role administration.
- **manager** — team and permitted shared-workspace management.
- **member** — access to records explicitly shared with the organisation or member.
- **viewer** — read-only access to records explicitly shared with the organisation or member.

Role names alone do not grant access to every record. Resource-level permissions remain necessary for private deals, documents, and other sensitive records. The organisation owner should be protected from accidental removal or demotion; ownership transfer must be an explicit trusted operation.

## Firestore data model

Use separate top-level collections to support multiple organisations per user and independently managed membership state.

### `organisations/{organisationId}`

Suggested fields:

- `name`, `slug`, `description`, `website`, `industry`
- `logoPath`, `publicLocation`, `companyNumber` (optional; private unless explicitly approved)
- `visibility` (`public` or `private`)
- `status` (`pending`, `active`, `suspended`, `closed`)
- `verificationStatus` (`unverified`, `pending`, `verified`, `rejected`)
- `createdByUid`, `createdAt`, `updatedAt`
- `ownerUid` (initial owner; ownership changes only through trusted code)

### `organisationSlugs/{slug}`

A reservation registry for unique, normalised slugs. Creation and release should be transactional and trusted; clients must not be able to overwrite an existing reservation or claim a reserved system name. Exact document gets may be public for hostname resolution; collection listing and client writes remain denied.

### `organisationDirectory/{organisationId}`

A server-maintained, whitelisted public projection. Public reads are allowed only when `isPublic == true` and `status == active`; private organisation fields and member data stay outside this projection.

### `organisationMembers/{membershipId}`

Suggested fields:

- `organisationId`, `userId`, `role`
- `status` (`invited`, `active`, `suspended`, `left`, `removed`)
- `invitedByUid`, `joinedAt`, `createdAt`, `updatedAt`

A deterministic membership document ID based on organisation and user IDs should prevent duplicate active memberships. Do not rely on client-supplied role values during acceptance.

### `organisationInvitations/{invitationId}`

Suggested fields:

- `organisationId`, `emailLowercase`, `role`
- `tokenHash` (never store a raw invitation token)
- `invitedByUid`, `status`, `expiresAt`, `createdAt`, `acceptedAt`

Generate high-entropy single-use invitation tokens in trusted code, store only a hash, enforce expiry and revocation, and bind acceptance to the authenticated account whose verified email matches the invitation.

### `organisationMembershipRequests/{requestId}`

Suggested fields: `organisationId`, `userId`, `status`, `createdAt`, `reviewedAt`, `reviewedByUid`.

### `organisationTeams/{teamId}`

Suggested fields: `organisationId`, `name`, `createdByUid`, `createdAt`, `updatedAt`. Team membership should be modelled separately if required by the first release.

### `organisationActivity/{activityId}`

Append-only audit events written by trusted code for sensitive actions. Include actor, organisation, action, target type/ID, timestamp, and minimal safe metadata. Do not copy secrets, invitation tokens, or unnecessary personal data into logs.

## Tenant-aware resource model

For each resource type (commercial property, residential property, deal, document, task), explicitly distinguish:

- personal ownership (`ownerUid`);
- organisation association (`organisationId`);
- record visibility and sharing policy;
- creator/editor attribution.

Do not infer organisational ownership from a user's current membership. A user leaving an organisation must not erase or silently transfer records. A resource shared with an organisation must have a clear access policy and revocation behaviour.

Before adapting existing collections, map their current fields, queries, Storage paths, Cloud Functions, and security rules. Prefer additive fields and backwards-compatible queries. Migrate records only with an explicit owner-authorised workflow and an audit trail.

## Authentication and subdomain architecture

Preferred organisational address pattern:

`{slug}.orgs.hamlet-ai.co.uk`

Examples:

- `abccommercial.orgs.hamlet-ai.co.uk`
- `xyzproperty.orgs.hamlet-ai.co.uk`

The directory remains at `organisations.hamlet-ai.co.uk`; the main site and existing app routes remain intact.

Use Cloudflare wildcard DNS and a Worker/hosting routing layer to resolve a validated slug to an organisation ID. The slug is a routing key only, never proof of membership or authority.

**Authentication caveat:** Firebase client authentication state is origin-scoped; a user signed in on one subdomain should not be assumed to be signed in on another. Before production rollout, choose and test one supported approach:

1. a secure central sign-in/redirect flow that establishes a per-origin Firebase session using a short-lived custom token; or
2. a trusted backend session-cookie architecture with server-side authorisation for protected data access.

Do not put Firebase ID tokens, custom tokens, session secrets, or invitation tokens in URLs, local storage shared across tenants, or logs. If using Firebase custom tokens, mint them only in trusted server-side code after verifying the central identity and intended tenant. Verify the resulting user and active membership again in Firestore Rules for every client data operation.

The Firebase project's authorised domains, OAuth redirect domains, cookie scope, CORS policy, and Cloudflare route configuration must be tested explicitly. A wildcard DNS record alone does not configure Firebase Authentication or guarantee session sharing.

Custom organisation domains (for example `workspace.company.com`) are a later enterprise capability, requiring domain ownership verification, certificate issuance, tenant mapping, and protection against domain takeover.

## Security requirements

- Default deny for all new organisation collections.
- Active membership must be checked on every protected operation.
- Role checks must be scoped to the same organisation as the target record.
- Clients cannot self-assign owner/admin roles, alter verification status, or change organisation status.
- Invitation issuance, acceptance, revocation, ownership transfer, and suspension must use trusted code or narrowly constrained transactions.
- Public directory reads must use a safe public projection; private organisation documents must not be publicly readable.
- Audit sensitive administrative actions.
- Add Firestore Emulator tests for unauthenticated access, non-members, members of another tenant, each role, suspended members, removed members, cross-tenant reads/writes, public projections, invitation replay/expiry, and ownership protection.
- Review Storage Rules and Storage path tenancy before enabling organisation file uploads.
- Apply rate limits and abuse controls to registration, slug reservation, invitations, and membership requests.

## Delivery phases

### Phase 0 — Repository and service audit

- Map existing member, property, deal, Storage, authentication, Functions, Firestore Rules, indexes, and deployment configurations.
- Confirm which Firebase project/database and Cloudflare Worker/zone serve production.
- Record compatibility constraints and test coverage.
- Do not alter live infrastructure.

### Phase 1 — Organisation foundation

- [x] Add trusted organisation creation with atomic slug reservation and initial owner membership.
- [x] Add trusted invitation creation with single-use token hashing and verified-email acceptance.
- [x] Add trusted invitation revocation using a separate invitation reference.
- [x] Add trusted role changes and member removal with owner/admin constraints.
- [x] Add deny-by-default Firestore rules for organisation, membership, invitation, directory, team and activity collections.
- [x] Add Firestore Emulator coverage for member isolation, cross-tenant denial, suspended-member denial, roster visibility, public/private directory projection and client-write denial.
- [x] Run the static, browser and Firestore/Storage Emulator CI suites successfully on functional-code commit `36fd3c1e6809efe51d64792fdd60a95cfbfe9271`.
- [x] Confirm the production Firebase CLI configuration: the user has confirmed root `firebase.json` is authoritative. It targets project `wale-491805`, Firestore `(default)` in `nam5`, and root `firestore.rules` / `firestore.indexes.json`.
- [x] Build the authenticated organisation registration, invitation and membership management page at `/organisations.html`, linked from the Members Area and excluded from public search.
- [ ] Add organisation profile editing and public/private visibility controls through trusted operations.

The initial backend foundation is implemented on the feature branch. No production Functions or Firestore Rules have been deployed.

### Phase 2 — Membership lifecycle

- Invitations, verified-email acceptance, expiry and revocation.
- Membership requests and approval.
- Multiple organisations per user.
- Role management, suspension, removal, exit and ownership transfer.
- Append-only activity audit.

### Phase 3 — Workspace and subdomain routing

- Organisation switcher in the authenticated application.
- Dedicated workspace shell and tenant resolution.
- Cloudflare wildcard routing for `*.orgs.hamlet-ai.co.uk`.
- Resolve authentication/session design and validate Firebase/OAuth domains.
- Launch subdomains only after tenant isolation tests pass.

### Phase 4 — Shared property and deal collaboration

- [x] Add separate tenant-scoped collections for organisation properties and deals; legacy individual collections remain unchanged.
- [x] Add explicit `organisation` and `restricted` visibility, with an allow-list of member UIDs for restricted resources.
- [x] Enforce immutable `organisationId` and `createdByUid`; owners/admins/managers manage resources, members manage their own resources, and viewers are read-only.
- [x] Add server-authored, client-immutable organisation deal activity events.
- [x] Add organisation document metadata and separate tenant-aware Storage paths for deal and property files.
- [x] Add emulator tests for active membership, cross-tenant denial, restricted sharing, creator attribution, role boundaries and file-upload isolation.
- [ ] Complete the emulator run and review all rule evaluation results before treating this phase as validated.
- [ ] Build the organisation workspace UI against the new collections; do not expose legacy personal records as shared resources.
- [ ] Implement explicit opt-in association/migration for existing individual records; never silently transfer ownership.
- [ ] Add server-side audit event generation, file metadata lifecycle, query indexes and revocation/deletion tests before production.

### Phase 5 — Directory, analytics and enterprise

- Public organisation discovery and safe public profiles.
- Verification workflow and reporting.
- Team/organisation analytics.
- Custom domains, advanced administration, enterprise integrations and licensing.

## Acceptance criteria for the first release

1. An authenticated user can create an organisation without changing their individual profile.
2. The creator becomes the initial owner through a trusted, non-client-controlled operation.
3. A unique slug is reserved atomically; duplicate and reserved slugs are rejected.
4. An organisation can be public or private without exposing private data.
5. An organisation can have multiple members, and a user can belong to multiple organisations.
6. A non-member cannot read or write private organisation data, even if they know the organisation ID.
7. A member cannot read or write another tenant's records.
8. A member cannot elevate their own role or alter verification/lifecycle state.
9. Existing individual member, listing, deal and sign-in journeys continue to work.
10. Firestore Emulator tests cover positive and negative access cases before any production rules deployment.

## Deployment and change control

This plan is a product/architecture baseline, not a production deployment instruction. Implement in a feature branch, review the diff, run automated and emulator tests, and open a pull request. Deploy frontend, Firestore rules/indexes, Functions, DNS, and Worker routing as separate, explicitly verified changes. Do not change production DNS, Firebase Auth settings, secrets, or live security rules as part of an unreviewed code commit.


## User-facing foundation — 8 November 2026

- [x] Add authenticated `/app/hamlet/organisations.html` workspace page on the feature branch.
- [x] Connect organisation creation, invitation creation/acceptance backend contract, role changes, member removal and invitation revocation callables.
- [x] Display the signed-in user's active organisation memberships and organisation administration panel.
- [x] Add the Organisations destination to the authenticated Hamlet workspace navigation.
- [x] Keep invitation tokens one-time display only; do not persist them in browser storage or place them in URL parameters.
- [x] Keep organisation property/deal sharing, team workspaces and tenant subdomain routing disabled pending the separate authorization and authentication-handoff design.
- [ ] Complete end-to-end callable tests and confirm callable deployment environment.
- [x] Confirm canonical production Firebase CLI configuration: root `firebase.json` is authoritative (project `wale-491805`; default Firestore configured in `nam5`). Production deployment itself remains separately gated by review and explicit approval.


## Firebase configuration confirmation — 8 November 2026

The product owner has confirmed that the **root `firebase.json` is the authoritative production Firebase configuration**. Accordingly:

- Project alias `default` resolves to `wale-491805` via root `.firebaserc`.
- The root config targets Firestore database `(default)` in `nam5`, using root `firestore.rules` and `firestore.indexes.json`.
- The organisation callable functions belong in the root `functions` source under the `default` Functions codebase.
- `app/firebase.json` is not the production deployment target and must not be used to deploy organisation rules or Functions.
- This confirmation resolves the repository's configuration-selection question. It does not independently prove the deployed database's physical location or authorize a production deployment.

Next deployment preparation must use the root configuration and verify the live default database, Functions region/runtime, and deployed codebase inventory before applying any production rules or Functions changes. Keep the app-specific rules untouched; do not copy or synchronize rule files without a separate compatibility review.


## Tenant resource contract — 8 November 2026

The first tenant-resource rules are additive and deliberately use new collections rather than changing the semantics of existing individual records:

- `organisationProperties/{propertyId}`
- `organisationDeals/{dealId}`
- `organisationDealEvents/{eventId}` (server-authored)
- `organisationDocuments/{documentId}`

Each property/deal resource must include `organisationId`, immutable `createdByUid`, `visibility` (`organisation` or `restricted`), and `sharedWithUids` (maximum 100 member UIDs). Organisation-wide resources are readable by active members. Restricted resources are readable by the creator, explicitly listed members, and organisation owner/admin/manager roles. All access additionally requires active membership and an active organisation.

Owners, admins and managers can manage tenant resources. A member can create and maintain their own resources but cannot alter the sharing policy after creation. Viewers are read-only. Tenant identifiers and creator attribution cannot be changed by clients. Deal history is client-immutable. Tenant documents use `organisationDocuments/{organisationId}/{deal|property}/{resourceId}/{documentId}/{fileName}` and inherit the parent resource's membership/sharing access.

These collections are a new data contract only. Existing `hamletDeals`, `commercialProperties`, `residentialProperties`, public listing projections, and owner-scoped document paths remain unchanged. No existing personal record is automatically shared or migrated. No UI is yet wired to these collections, and no production rules or Storage rules have been deployed. Before production use, add the trusted audit writer, end-to-end document metadata lifecycle, revocation/deletion handling, query indexes, and migration consent workflow.


### Storage upload rollout gate — 8 November 2026

Organisation document Storage Rules are deliberately deferred from this branch until the emulator accepts a separately validated ruleset. The feature branch currently retains the clean `main` Storage Rules baseline; organisation document metadata and tenant access remain governed by the Firestore rules. No organisation document upload path is enabled by this change. Do not enable client uploads or deploy organisation Storage permissions until dedicated Storage Emulator tests pass for both deal and property documents, including cross-tenant denial, restricted sharing, inactive membership, MIME/size limits, and delete/update behaviour.


## Authentication handoff and tenant routing implementation — 9 November 2026

The feature branch `feat/organisations-auth-handoff-routing` adds the first implementation of the cross-origin session bridge and tenant router.

### Handoff protocol

- The signed-in main-origin page opens the selected tenant hostname in a separate tab.
- The tenant page sends a readiness message to the exact main Hamlet origin. The main page checks both `event.origin` and `event.source`.
- A verified main-origin user requests a 256-bit random, single-use handoff code from `createOrganisationHandoffCode`. The callable verifies the organisation is active, the requested slug matches the organisation record, and the caller has active membership.
- Only a SHA-256 hash of the code is stored in `organisationHandoffCodes`; the raw code is sent to the tenant tab using origin-restricted `postMessage`, never in a URL, cookie, browser storage, or log.
- `exchangeOrganisationHandoffCode` validates the code, slug, organisation lifecycle and active membership in a Firestore transaction, then consumes the code before returning a Firebase custom token to the tenant tab.
- The tenant tab signs in using the custom token and independently reloads and verifies the active membership and organisation before continuing.
- The code expires after 90 seconds. Replays and slug substitution are rejected. Tenant Firestore and Storage rules remain the final access-control boundary; custom claims and the hostname are not sufficient authority.
- If a tenant session expires, the Worker redirects the user to central Hamlet sign-in. The user then selects the organisation and repeats the handoff.

### Routing implementation

- `worker/hamlet-organisations-router` is an isolated Worker and Wrangler configuration.
- Production host resolution recognises only `{slug}.orgs.hamlet-ai.co.uk`. Reserved and malformed slugs are rejected.
- Staging can be exercised on the Worker `workers.dev` hostname using `/tenant/{slug}`; a short-lived, HttpOnly, Secure, SameSite=Lax cookie retains the staging tenant route while navigating within the workspace.
- The Worker proxies tenant-origin paths to the existing Hamlet Pages origin, preserving the tenant browser origin so Firebase's tenant session remains available to tenant workspace pages.
- The Worker adds no production route declaration and makes no DNS changes. Production wildcard DNS and Worker route binding remain a separately gated release action.
- The directory hostname `organisations.hamlet-ai.co.uk` remains separate from tenant hostnames.

### Test and release gates

Automated callable tests are added for verified membership, code hashing, slug binding, expiry, consumption and replay. CI must pass the organisation callable suite, Firestore/Storage rules suites, browser smoke tests and static checks.

Before enabling a production route, perform staging acceptance tests with at least two verified test accounts and two organisations:

1. Main-origin sign-in followed by handoff to the correct tenant; verify the same Firebase UID on both origins.
2. Member and owner/admin roles; confirm the correct role is displayed and permitted operations match the role.
3. Wrong-tenant slug substitution, unknown slug, reserved slug, expired code, replayed code and non-member handoff all fail closed.
4. Remove or suspend a member after issuing a code but before exchange; exchange must fail.
5. Navigate from tenant root to deals, properties, files, teams and administration; verify the session remains on the tenant origin.
6. Sign out or expire the session; protected pages must deny access and return the user to central sign-in.
7. Attempt cross-tenant Firestore reads/writes and Storage reads/writes using the second test account; all must be denied.
8. Confirm ordinary main-site sign-in, individual deals, personal property records and public listing journeys remain unchanged.

Do not treat a successful Worker preview or a successful custom-token exchange as proof of full tenant isolation. Production launch requires successful staging acceptance, Firebase Auth domain review, live callable deployment verification, and explicit approval for the production DNS/Worker route change.
