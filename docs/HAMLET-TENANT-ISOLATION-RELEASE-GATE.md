# Hamlet tenant-isolation release gate

**Status:** Mandatory release requirement  
**Applies to:** Hamlet Organisations, tenant-aware resources, organisation authentication handoff, Firestore Rules, Storage Rules, and related Cloud Functions.

This standard is a production release gate. Tenant isolation is not an optional hardening task and must not be waived as a routine delivery trade-off.

## 1. Authorisation invariants

Every protected operation MUST establish all applicable conditions on the server:

1. The caller has an authenticated Firebase identity.
2. The caller's email is verified where the operation requires a verified account.
3. The organisation exists and is in the `active` lifecycle state.
4. The caller has an active membership record for that exact organisation, with the expected UID and organisation ID.
5. The caller's role permits the requested operation.
6. The target resource belongs to the same organisation as the membership being checked.
7. Any resource-level sharing or team grant is current, valid, and scoped to that same organisation and resource.

A slug, hostname, client-side role, custom claim, hidden UI control, or knowledge of a document ID is not proof of authorisation.

## 2. Cloud Functions and Admin SDK

Firestore Security Rules do not protect operations performed through the Firebase Admin SDK. Every callable or trusted server operation that reads or mutates tenant data MUST perform its own server-side authorisation.

For mutations, the actor membership, organisation lifecycle, target resource, and role checks MUST be read within the same Firestore transaction as the protected write wherever the operation is transactional. Do not validate a manager or administrator outside the transaction and then rely on that earlier result for a later write.

Callable handlers MUST validate input types, document IDs, allowed roles, and tenant/resource relationships. Invitation and handoff tokens MUST be high entropy, single-use, short-lived, stored only as hashes, and bound to the intended verified identity and organisation.

## 3. Firestore Rules

The root `firestore.rules` is authoritative when selected by the root `firebase.json`.

Rules MUST:

- deny by default;
- require active membership in the same organisation for every private tenant read/write;
- enforce immutable tenant identity and creator attribution;
- prevent clients from creating or changing membership, invitation, ownership, verification, lifecycle, and audit records;
- check the parent resource exists and belongs to the same organisation for resource metadata, shares, events, and documents;
- enforce role and resource-level permissions independently;
- ensure stale shares, removed members, suspended organisations, and deleted parents do not retain access.

Public organisation discovery MUST use a server-maintained, whitelisted projection. Private organisation records and member information MUST NOT be exposed through that projection.

## 4. Firebase Storage

Every tenant Storage path MUST bind the tenant identifier in the path to the `organisationId` on the referenced parent resource. Checking only that a parent document exists is insufficient.

Storage Rules MUST independently verify:

- active membership in the path tenant;
- active organisation lifecycle;
- parent resource existence and matching `organisationId`;
- resource-level visibility, sharing, and team permissions;
- uploader identity, allowed content type, filename, and size limits;
- deletion authority against the same tenant and parent.

Adversarial tests MUST attempt both reads and writes using a tenant-A path combined with a known tenant-B resource ID.

## 5. Authentication handoff

Cross-origin tenant sign-in MUST:

- use a cryptographically random, short-lived, single-use handoff code;
- store only a hash of the code;
- bind the code to one organisation and slug;
- transfer it only through origin-restricted messaging, never through a URL, local/session storage, or logs;
- validate both `event.origin` and `event.source` at the receiving boundary;
- atomically consume the code and recheck active organisation and membership at exchange;
- verify the Firebase account remains enabled and email-verified before minting a custom token;
- independently reload the tenant session and verify membership before showing the workspace.

The tenant Firestore and Storage Rules remain the final access-control boundary after sign-in. A successful token exchange is not proof of tenant access.

## 6. Mandatory adversarial test matrix

Before release, the Firestore and Storage Emulator suites MUST demonstrate:

- unauthenticated, outsider, wrong-tenant, and multi-tenant user behaviour;
- owner, admin, manager, member, and viewer permissions;
- suspended, removed, and departed membership behaviour;
- suspended and closed organisation behaviour;
- cross-tenant reads and writes with known resource IDs;
- cross-tenant Storage path substitution for both reads and writes;
- restricted resources, explicit shares, revoked shares, and removed recipients;
- team grants, archived teams, and removed team assignments;
- parent deletion, parent/metadata tenant mismatch, and stale metadata;
- invitation expiry, revocation, wrong-email acceptance, and replay;
- handoff expiry, wrong-slug exchange, replay, disabled account, and membership removal after code issuance;
- ownership transfer and lifecycle transition boundaries.

Tests MUST exercise the actual rules and callable handlers, not merely frontend button visibility or mocked permission helpers.

## 7. CI and release evidence

A production release MUST NOT proceed unless:

1. the organisation callable tests pass against the Firebase Emulator;
2. Firestore and Storage Rules tests pass against the emulators;
3. the relevant static/browser security checks pass;
4. no unresolved critical or high-severity tenant-isolation finding remains;
5. secret-scanner findings are either remediated or formally dispositioned as false positives with evidence;
6. the final PR diff has been reviewed and all required checks correspond to the final commit;
7. the deployment plan identifies the exact Firebase project, database, Functions region, rules files, and release commit;
8. the production deployment is separately authorised and verified.

A Firebase Hosting preview is not required for a backend-only rules/functions change, but that exemption MUST NOT skip the Emulator or security workflows.

## 8. Release decision

Any demonstrated or suspected cross-tenant read/write, missing server-side authorisation, unvalidated Admin SDK mutation, or authentication-handoff bypass is a release blocker. Fixes require regression tests before merge.

The release record should link the pull request, final commit SHA, passing workflow runs, reviewed findings, and explicit deployment approval. No security rule or function change is considered released merely because it exists on a branch or has passed a preview deployment.
