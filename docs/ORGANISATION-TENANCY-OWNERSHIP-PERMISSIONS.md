# Hamlet Organisations — Tenancy, Ownership and Permissions Contract

**Status:** Architecture baseline for implementation and review  
**Branch:** `feat/organisation-tenancy-ownership-contract`  
**Depends on:** Hamlet Organisations implementation in PR #82  
**Scope:** Data ownership, tenant boundaries, membership authority, roles, teams, resource sharing and lifecycle rules.

This document defines the canonical contract that future organisation features must follow. It is not a production deployment instruction and does not authorise changes to Firebase, Cloudflare, DNS, authentication domains or production data.

## 1. Non-negotiable design principles

1. A Hamlet user identity is independent of any organisation. A person retains the same Firebase Auth UID and personal workspace when joining, leaving or changing organisations.
2. An organisation is a tenant boundary, not a user-profile attribute. A user may hold active memberships in multiple organisations.
3. Membership is an explicit, revocable relationship between one Auth UID and one organisation.
4. The organisation ID is the tenant key for every organisation-owned record. It must be validated against active organisation membership on every protected operation.
5. A slug or hostname is a routing identifier only. It is never evidence of identity, membership, ownership or permission.
6. Client-side UI visibility is never an authorisation control. Firestore Rules, Storage Rules and trusted backend operations enforce access.
7. Personal records remain personally owned unless the owner explicitly shares or transfers them through an audited workflow.
8. No migration may silently convert personal records into organisation-owned records.
9. Organisation lifecycle and membership lifecycle are independent. Suspending an organisation and suspending a member are separate actions with separate audit events.
10. Production changes require separate review and explicit approval.

## 2. Canonical identity and ownership model

### 2.1 Individual identity

- Canonical user identifier: Firebase Authentication `uid`.
- The UID is stable across all organisations and is the principal used for authorisation.
- Email is an attribute, not a primary key.
- Email verification is required for organisation administration and invitation acceptance, but does not itself grant organisation access.

### 2.2 Organisation record

Canonical path: `organisations/{organisationId}`.

Key fields:
- `id`: organisation document ID.
- `name`, `slug`.
- `ownerUid`: authoritative current owner UID.
- `createdByUid`: immutable creator attribution.
- `status`: `active`, `suspended`, or `closed` (pending may be used by an onboarding workflow).
- `visibility`: `public` or `private`.
- `createdAt`, `updatedAt`.

**Ownership invariant:** `ownerUid` and the active `owner` membership must identify the same person. There must be exactly one active owner membership per active organisation. The owner cannot be removed, suspended or demoted through ordinary member-management operations.

An ownership transfer must be a dedicated trusted, audited operation. It must atomically change `ownerUid` and both affected membership roles, verify the recipient's active membership, and record the actor, previous owner and new owner. No such transfer should be simulated through a generic role-change request.

### 2.3 Membership record

Canonical path: `organisationMembers/{organisationId}_{uid}`.

The deployed implementation uses `uid` as the canonical member identifier field. It does not use `userId`. The canonical fields are:

- `id`: membership document ID.
- `organisationId`: immutable tenant ID.
- `uid`: Firebase Auth UID.
- `email`: verified email snapshot for administration and invitation context.
- `role`: `owner`, `admin`, `manager`, `member`, or `viewer`.
- `status`: `active`, `invited`, `suspended`, `left`, or `removed`.
- `invitedByUid`, `joinedAt`, `createdAt`, `updatedAt` as applicable.

Document IDs are deterministic: `{organisationId}_{uid}`. This prevents duplicate membership documents for the same user and tenant.

**Schema alignment note:** Older planning text refers to `userId` and `emailLowercase`; the current callable and rules implementation uses `uid` and `email`. New code and tests must use the deployed `uid` contract unless a separately reviewed migration changes it.

### 2.4 Invitation record

Canonical path: `organisationInvitations/{invitationId}`.

- Store only a cryptographic token hash, never the raw token.
- Bind the invitation to an organisation, verified email address and permitted role.
- Require expiry, single use and revocation checks.
- The accepting authenticated user's verified email must match the invitation email.
- The requested role is set by trusted code; acceptance must not accept a client-supplied role.
- Raw invitation tokens are returned once and must not be written to URLs, browser storage or logs.

The current implementation uses `email` and `tokenHash`; older planning references to `emailLowercase` are descriptive, not the deployed field names.

## 3. Tenant-owned resources and personal resources

Every resource must have an explicit ownership classification.

| Resource class | Ownership authority | Access model |
|---|---|---|
| Personal profile | Individual UID | Existing personal profile rules |
| Personal property or deal | Existing personal owner field, typically `ownerUid` | Existing personal rules |
| Organisation property | `organisationId` tenant + `createdByUid` attribution | Active membership and resource sharing policy |
| Organisation deal | `organisationId` tenant + `createdByUid` attribution | Active membership and resource sharing policy |
| Organisation document | Parent organisation resource | Inherits parent resource access |
| Team assignment | Organisation + team + member UID | Active organisation membership and team permission |

Organisation-owned property and deal records use separate collections from legacy personal records. The tenant resource contract includes:

- `organisationId`: immutable tenant identifier.
- `createdByUid`: immutable creator attribution.
- `visibility`: `organisation` or `restricted`.
- `sharedWithUids`: explicit member allow-list for restricted resources.
- `teamId`: optional team scope where supported.

Changing a user's current organisation membership must never rewrite the ownership of their existing records. Sharing, unsharing and transfer are explicit actions with a clear actor and audit event.

## 4. Role and permission contract

Roles are organisation-scoped. A role does not grant access to another organisation and does not override resource-level restrictions except where explicitly stated below.

| Capability | Owner | Admin | Manager | Member | Viewer |
|---|---:|---:|---:|---:|---:|
| Read active organisation workspace | Yes | Yes | Yes | Yes | Yes |
| Manage organisation settings and lifecycle | Yes | Limited | No | No | No |
| Invite ordinary members | Yes | Yes | No | No | No |
| Invite or appoint administrators | Yes | No | No | No | No |
| Change member roles / remove members | Yes | Limited | No | No | No |
| Create and administer teams | Yes | Yes | No | No | No |
| Assign members to teams | Yes | Yes | No | No | No |
| Read organisation-wide resources | Yes | Yes | Yes | Yes | Yes |
| Read restricted resources | Yes | Yes | Yes | Creator / explicit share / team grant | Creator / explicit share / team grant |
| Create and manage organisation resources | Yes | Yes | Yes | Own created resources | No |
| Change sharing policy | Yes | Yes | Yes | No | No |
| Read organisation audit history | Yes | Yes | No | No | No |
| Transfer organisation ownership | Dedicated trusted operation only | No | No | No | No |

**Implementation note:** Existing code and Firestore Rules grant managers broad access to restricted organisation resources and allow them to manage resource sharing. Team creation and team assignment are currently limited to owners and admins. The table records this intended baseline; any future narrowing or expansion must update backend checks, Firestore Rules, Storage Rules, tests and UI together.

“Limited” means the precise operation must be checked in the trusted callable; it is not permission to change the owner's identity or transfer ownership.

## 5. Team permissions

Teams are subordinate to one organisation and cannot span tenants.

Canonical team membership document ID: `{teamId}_{uid}`.

A team assignment must include the same `organisationId` as its parent team and an active member UID. A team grant cannot outlive active organisation membership. Removing or suspending a member must immediately deny access even if a stale team assignment remains.

Current team permissions are explicitly enumerated:
- `deals.read`
- `deals.write`
- `properties.read`
- `properties.write`

Do not interpret team permissions as organisation-administration permissions. Team permissions cannot grant invitation, billing, role-management, ownership or organisation-lifecycle authority.

## 6. Lifecycle and revocation rules

### Organisation lifecycle

- `active`: normal access, subject to membership and resource policy.
- `suspended`: deny tenant workspace and tenant resource access; preserve records and audit history pending resolution.
- `closed`: deny normal access; apply the approved retention, export and deletion policy.

### Membership lifecycle

- `active`: eligible for access according to role and resource policy.
- `invited`: no tenant workspace access.
- `suspended`, `left`, `removed`: no tenant workspace or resource access.

Revocation must be enforced at the data-access boundary, not by deleting the user's account or relying on the frontend to hide controls. Membership removal must not delete the user's personal Hamlet account or personal records.

## 7. Public directory boundary

The public organisation directory is a separate, server-maintained projection. Only explicitly approved public fields may be present. It must not expose:

- member email addresses or private profile data;
- invitations or membership requests;
- private property, deal or document metadata;
- internal audit events;
- billing or subscription details;
- private company identifiers unless explicitly approved for publication.

Private organisation documents remain readable only by active members. Public slug resolution is an exact lookup and must not permit collection enumeration.

## 8. Security invariants for every protected operation

Every Firestore, Storage or callable operation must establish, as applicable:

1. Authenticated principal exists and is the expected UID.
2. Target organisation exists and is active.
3. Membership document ID is derived from the target organisation and authenticated UID.
4. Membership `organisationId`, `uid` and `status` match the request context.
5. The role permits the requested operation.
6. The target resource's `organisationId` matches the same tenant.
7. Resource visibility, creator attribution, explicit share and team grant are checked.
8. Tenant ID and creator attribution cannot be changed by client updates.
9. Revoked membership or team assignment cannot retain access.
10. Sensitive administrative actions are written to append-only trusted audit records.

Custom token claims, hostname, organisation slug, browser session state and UI state are not substitutes for these checks.

## 9. Required acceptance tests

Before production approval, the emulator and staging suites must cover:

- User A belongs to Organisations A and B; switching tenants does not leak state or records.
- User A cannot read, query, update, delete or upload against Organisation B without membership.
- A member of Organisation A cannot use an Organisation B slug, ID, team ID or resource ID to cross tenant boundaries.
- Each role is tested for each administrative and resource operation.
- A viewer cannot create or modify tenant resources.
- A member cannot change visibility, shared-member lists, team assignment, tenant ID or creator attribution where prohibited.
- A manager's restricted-resource access matches the approved role matrix.
- Team permissions cannot grant access outside the parent organisation or beyond the declared permission.
- Removing or suspending a member revokes direct and team-derived access.
- Suspending an organisation denies all tenant access without deleting data.
- The organisation owner cannot be removed or demoted through ordinary member administration.
- Ownership transfer is atomic, recipient-validated and audited before it is enabled.
- Public directory projections contain only approved fields.
- Personal accounts and personal resources continue to work unchanged.
- Handoff codes fail for non-members, wrong tenants, expired codes, replay and membership revoked before exchange.

## 10. Gaps to close before production

The existing organisation foundation provides trusted creation, invitation and membership operations, role changes, removal, teams, tenant resources, audit events and the initial authentication handoff. The following items remain explicit acceptance or implementation gaps until independently demonstrated:

- End-to-end tenant staging and cross-tenant isolation acceptance.
- Ownership transfer callable and corresponding tests.
- Organisation suspension/closure callable and lifecycle tests.
- Full Storage Rules acceptance for organisation documents.
- Complete resource-level audit and document metadata lifecycle.
- Query/index review for membership and tenant resource access patterns.
- Explicit role matrix tests across Firestore, Storage and callable operations.
- Review of manager access to restricted resources against product policy.
- Reconciliation of the older architecture schema descriptions with the canonical `uid` / `email` implementation fields.

Do not infer that a gap is complete because a related UI control, callable, deployment or CI workflow exists.

## 11. Change control

This contract is the design baseline for future organisation changes. Any change to identity fields, membership IDs, ownership authority, role semantics, tenant resource schemas or lifecycle states must:

1. update this contract and the architecture overview;
2. include a migration and backwards-compatibility plan where data is affected;
3. update trusted Functions, Firestore Rules, Storage Rules and client queries consistently;
4. add positive and negative emulator tests;
5. pass staging acceptance;
6. be reviewed before production deployment.

This document creates no authorisation to merge PR #82, deploy production rules or Functions, change DNS, add production Worker routes, alter Firebase Auth domains or migrate existing personal records.
