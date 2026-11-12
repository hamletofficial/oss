# hamlet — connected property intelligence

**hamlet** is a property-focused CRM and broker-community platform developed by Impact in Business Recruitment Group Limited (IBR). It brings property listings, deal progression, broker profiles, rankings and communications into a more connected workspace.

**Live website:** https://hamlet-ai.co.uk  
**Repository:** https://github.com/hamletofficial/oss  
**Hosting:** GitHub Pages and Firebase services, depending on the feature  
**Core principle:** *Less fragmentation, more connected deals.*

## What this repository contains

This repository contains the public website and much of the client-side Hamlet application, alongside Firebase configuration, security rules, backend functions, worker code, supporting documentation and desktop-app resources.

| Area | Main paths | What they are for |
|---|---|---|
| Public website | Root-level `*.html` pages, `index.css`, `index.js` | Homepage, company information, sectors, fees, pricing, policies and contact |
| Member community | `members.html`, `directory.html`, `profile.html`, `editprofile.html`, `posts.html`, `messages.html`, `settings.html` | Member profiles, directory, social updates, messaging and account settings |
| Property and portfolio | `app/public/live.html`, `portfolio.html`, `app/public/` | Property listings and portfolio-related experiences |
| Deal workspace | `app/hamlet/`, `hamlet-workspace.css`, `hamlet-workspace.js` | Deal pipeline, deal information and workspace interface |
| Broker intelligence | `rankings.html`, `insights.html`, `hamlet-ai-assistants.js` | Broker rankings, insights and AI-assistant integration points |
| Shared visual system | `theme.css`, `theme.js`, `mobile-compat.css`, `mobile-compat.js` | Shared dark theme and responsive compatibility |
| Firebase configuration | `firebase-config.js`, `firebase.json`, `firestore.rules`, `firestore.indexes.json`, `storage.rules`, `database.rules.json` | Client configuration and backend service/rule definitions |
| Backend functions | `functions/`, `sagat/`, `ryu/`, `ken/` | Firebase Cloud Functions codebases and their supporting files |
| AI gateway and workers | `hamlet-ai-gateway/`, `worker/` | Worker-side integration code; check each directory's own configuration before deploying |
| Desktop and supporting code | `desktop/`, `scripts/`, `src/`, `dataconnect/` | Desktop-related files, scripts and supporting application/data code |
| Administration | `superuser/` | Super-user administration pages |
| Documentation and tests | `docs/`, `tests/`, `SECURITY.md`, `PAGE-STANDARDS.md`, `PROFILE-SERVICE.md`, `UX-UI-ROADMAP.md` | Project guidance, security notes, standards, service documentation, roadmap and tests |

The repository evolves frequently. Treat these paths as a navigational overview rather than a complete specification; verify the current files and their imports before making changes.

## Main product areas

- **Property listings and portfolios** — commercial property records and sustainability-related listing information, with residential functionality in the relevant pages and services.
- **Deal pipeline** — track deal stages, associated records and key deadlines.
- **Broker directory and profiles** — help members find and understand other brokers in the community.
- **Broker rankings and insights** — present broker-level performance information where data is available.
- **Community and messaging** — member posts, replies and direct communications.
- **AI assistance** — AI-related entry points and gateway code are present; availability depends on the relevant service configuration.
- **Account and administration tools** — sign-in, account settings and restricted administration experiences.

Feature availability may depend on authentication, verification state, Firebase configuration, deployed functions and external service credentials.

## Hamlet Organisations and `hamlet. / workspace`

Hamlet Organisations extends the individual broker platform with **organisation-scoped workspaces** for property firms and professional teams. Each user retains an independently usable Hamlet account and may belong to multiple organisations. Organisation membership is explicit; joining a firm does not silently transfer personal deals, properties or files into its workspace.

The organisation experience is presented as **hamlet. / workspace**. The Members Area is the organisation subscription and membership entry point, while the authenticated workspace provides the operational tools. Access requires a signed-in, email-verified Hamlet account and an active membership in the selected organisation. Privileged operations are enforced by trusted Cloud Functions and Firebase Security Rules, not by client-side navigation or hidden controls.

### Entry points and user journey

| Route | Purpose |
|---|---|
| `/organisation.html` | Members Area administration: view memberships, create an organisation after subscription entitlement, invite colleagues, accept invitations and manage member roles. |
| `/invoice.html?organisation=1` | Organisation subscription checkout entry point. Checkout entitlement is confirmed by trusted backend state before organisation creation is enabled. |
| `/app/hamlet/organisation.html` | Authenticated organisation workspace overview, organisation selector, profile and verification, membership requests, and links to operational modules. |
| `/app/hamlet/organisation-deals.html` | Organisation-owned deals and shared deal pipeline. |
| `/app/hamlet/organisation-properties.html` | Organisation-owned commercial and residential property portfolio. |
| `/app/hamlet/organisation-files.html` | Organisation-scoped files and assets for permitted resources. |
| `/app/hamlet/organisation-teams.html` | Team administration and assignment of supported deal/property permissions. |
| `/app/hamlet/organisation-activity.html` | Read-only organisation audit history for owners and administrators. |
| `/app/hamlet/organisation-analytics.html` | Aggregate organisation membership, team, deal and property metrics for owners and administrators. |
| `/app/hamlet/organisation-association.html` | Explicitly copy an eligible personal deal or property into an organisation as a separate, restricted snapshot. |
| `/app/hamlet/tenant.html` | Tenant-side authentication handoff page used by the dedicated organisation hostname flow. |

The route list describes source pages in this repository. Hosting rewrites, worker routing and production configuration determine which hostname serves a given route.

### Subscription and organisation lifecycle

Organisation creation is subscription-gated. The checkout integration is implemented in `functions/hamlet-organisation-billing.js` and uses Stripe-hosted subscription checkout. Stripe credentials, webhook verification and the organisation price identifier are configured as Firebase secrets; do not add those values to source control. The backend records subscription state and applies entitlement/suspension changes to the associated organisation. A successful browser redirect alone is not proof of payment: the application checks trusted checkout state before enabling creation.

Organisation registration reserves a unique slug and establishes the creator as the initial owner. The slug identifies the organisation for routing; it is not an access credential. An organisation may be active, suspended or closed, and billing or governance operations can affect its lifecycle and directory visibility.

### Tenant hostname and secure sign-in handoff

The intended tenant hostname pattern is:

```text
{slug}.orgs.hamlet-ai.co.uk
```

The main Hamlet origin opens the selected organisation hostname in a separate browser tab. Firebase authentication is origin-scoped, so the main-origin session is not assumed to carry over to the tenant hostname. The current source implementation uses a short-lived, single-use handoff:

1. The tenant page announces readiness to the main Hamlet origin.
2. The main-origin page validates both the tenant message origin and window source, then requests a handoff code for the selected organisation.
3. The trusted `createOrganisationHandoffCode` callable verifies the user's email verification, active organisation lifecycle, matching slug and active membership.
4. A cryptographically random code is generated. Only its SHA-256 hash is stored in `organisationHandoffCodes`; the raw code is sent to the exact tenant origin using origin-restricted `postMessage`, not a URL or browser storage.
5. The tenant exchanges the code through `exchangeOrganisationHandoffCode`. The backend validates and consumes it transactionally, rechecks the organisation and membership, and returns a Firebase custom token.
6. The tenant signs in with that token and independently checks its authenticated organisation context before displaying tenant data.

Handoff codes have a short expiry and are single-use. The slug is only a routing identifier; every protected data operation must still enforce active membership, role and resource permissions. A wildcard DNS record or TLS certificate alone does not prove that tenant routing, Firebase authorised domains, Worker configuration, authentication handoff or production access controls are correctly deployed. Verify each environment separately.

### Firebase callable operations

The organisation backend is exported through the default Firebase Functions codebase. The organisation-related callable APIs currently implemented in source include:

| Callable | Responsibility |
|---|---|
| `createOrganisation` | Create an organisation, reserve its slug and establish its initial owner membership. |
| `requestOrganisationMembership` | Submit a request to join an organisation. |
| `reviewOrganisationMembershipRequest` | Approve or decline a membership request. |
| `createOrganisationInvitation` | Issue a role-based invitation to a specified email address. |
| `acceptOrganisationInvitation` | Accept a valid invitation for the invited, verified account. |
| `revokeOrganisationInvitation` | Revoke a pending invitation. |
| `changeOrganisationMemberRole` | Change a member's role subject to governance safeguards. |
| `removeOrganisationMember` | Remove a member and deactivate related assignments. |
| `leaveOrganisation` | Allow a member to leave, subject to ownership safeguards. |
| `updateOrganisationProfile` | Update organisation details and the approved public profile projection. |
| `submitOrganisationVerification` | Submit UK company registration details for review. |
| `getOrganisationVerificationStatus` | Retrieve authorised organisation verification status. |
| `listOrganisationVerificationRequests` | Retrieve the platform verification queue for authorised reviewers. |
| `reviewOrganisationVerification` | Approve or reject a verification submission. |
| `copyPersonalResourceToOrganisation` | Create a restricted organisation snapshot of an eligible personal resource. |
| `deleteOrganisationDocument` | Delete an organisation document and its stored file subject to access checks. |
| `getOrganisationAnalytics` | Return aggregate organisation and pipeline metrics for authorised managers. |
| `createOrganisationHandoffCode` | Issue a short-lived, single-use cross-origin tenant sign-in handoff code. |
| `exchangeOrganisationHandoffCode` | Validate and consume a handoff code and return a tenant-scoped Firebase custom token. |
| `createOrganisationCheckoutSession` | Create Stripe-hosted organisation subscription checkout. |
| `getOrganisationCheckoutStatus` | Confirm the authenticated user's checkout entitlement using trusted backend records. |
| `transferOrganisationOwnership` | Transfer ownership to another active organisation member. |
| `setOrganisationLifecycleStatus` | Apply an authorised organisation lifecycle transition. |
| `createOrganisationTeam` | Create a team and configure its supported permissions. |
| `updateOrganisationTeam` | Update an organisation team and its supported permissions. |
| `setOrganisationTeamMember` | Assign or remove an active organisation member from a team. |
| `archiveOrganisationTeam` | Archive an organisation team. |

Organisation audit trigger exports include `recordOrganisationDealActivity`, `recordOrganisationPropertyActivity`, `recordOrganisationDocumentActivity` and `recordOrganisationResourceShareActivity`. These are event-triggered backend functions, not client-callable HTTPS endpoints. The callable and trigger names above are source-code exports; verify the live deployed inventory and region in the target Firebase project before relying on them in production. Organisation and tenant handoff/billing functions are configured for `europe-west2` (London) in their source modules.

### Data model and access boundaries

The implementation uses dedicated collections for tenant data and governance, including:

| Collection | Purpose |
|---|---|
| `organisations` | Private organisation records and lifecycle state. |
| `organisationSlugs` | Unique slug reservations and routing status. |
| `organisationDirectory` | Whitelisted public organisation profile projection. |
| `organisationMembers` | Organisation membership, role and active status. |
| `organisationInvitations` | Invitation records and lifecycle state. |
| `organisationMembershipRequests` | Requests to join an organisation. |
| `organisationVerificationRequests` | Private registration evidence and verification review records. |
| `organisationBilling`, `organisationStripeSubscriptions`, `organisationCheckoutSessions` | Trusted subscription, entitlement and checkout state. |
| `organisationHandoffCodes` | Hashed, expiring tenant sign-in handoff codes. |
| `organisationDeals` | Organisation-owned deal and pipeline records. |
| `organisationProperties` | Organisation-owned commercial and residential property records. |
| `organisationDocuments` | Metadata for files attached to organisation resources. |
| `organisationTeams`, `organisationTeamMembers` | Team configuration and member assignments. |
| `organisationResourceShares` | Explicit user/team access grants for restricted resources. |
| `organisationDealEvents` | Deal events associated with organisation resources. |
| `organisationActivity` | Trusted, read-only organisation audit history. |

Organisation resources may be organisation-wide or restricted to explicitly authorised members and teams. The current team permission model supports assigned deal and property read/write access; it does not imply general access to every organisation record. Owners and administrators manage organisation governance. Audit history is read-only to clients and limited to authorised owners and administrators.

Tenant documents use the organisation-scoped Storage path:

```text
organisationDocuments/{organisationId}/{resourceType}/{resourceId}/{documentId}/{fileName}
```

### Personal records remain separate

- Personal deals and properties stay in their personal collections unless the user explicitly chooses to copy an eligible record into an organisation.
- Copying creates a distinct organisation snapshot; it does not move, delete, mutate or automatically synchronise the personal source record.
- The copy workflow warns that images, documents and personal record links are not copied. The snapshot begins with restricted access and is governed by tenant resource permissions.
- Organisation-owned records are stored separately from personal CRM collections and public listing projections.
- Organisation files and images do not become public listing media merely because they are uploaded.

### Verification

Organisation verification uses company registration details and a Companies House record lookup as evidence for review. A successful registry match is not automatic verification or a substitute for an authorised review decision. Verification submissions and their supporting data are private; never expose registration evidence or internal review details through the public directory projection.

### Testing and deployment

The Functions package defines the organisation-focused test command:

```bash
cd functions
npm run test:organisations
```

This runs the organisation, secure handoff and team tests. Review the package scripts and required Firebase Emulator configuration before running broader backend suites. For any change involving tenant access, test both Firestore and Storage rules, callable authorization, handoff replay/expiry, role revocation, cross-tenant reads/writes and signed-out/verified/unverified states.

The presence of source files and a region declaration does not prove that a function has been deployed or that production DNS, Cloudflare routes, Firebase Authentication domains, Stripe secrets or webhook configuration are correct. Confirm the target project, deployed Functions inventory, custom hostname routing and post-deployment user journey independently.

## Technology and services

The repository includes a largely static HTML/CSS/JavaScript website and uses Firebase services for features such as authentication, Firestore data and file storage. It also contains Firebase Cloud Functions, worker/gateway code, and desktop-related assets. Inspect the relevant subdirectory configuration to confirm the runtime, environment variables and deployment process for a specific component.

The presence of configuration files does not by itself confirm that every service or integration is deployed or enabled.

## Run a local preview

For a quick preview of static website pages, use Python's built-in HTTP server from the repository root:

```bash
git clone https://github.com/hamletofficial/oss.git
cd oss
python -m http.server 8080
```

Open http://localhost:8080/ in your browser.

A static preview does **not** deploy backend services, and authenticated or data-driven workflows may not work locally without the correct Firebase project configuration, allowed domains, credentials and deployed backend services. Follow any component-specific README or configuration for functions, workers and desktop tooling.

## Deployment boundaries

Do not assume one Git push deploys every part of Hamlet.

- **GitHub Pages:** publishes website content according to the repository's Pages settings and configured publishing source.
- **Firebase:** the repository includes Firebase configuration for Hosting, Firestore, Storage, Realtime Database, Remote Config, Data Connect and multiple Functions codebases. Deploy only the service(s) intended for a change, using the Firebase project and CLI configuration verified for that environment.
- **Workers / AI gateway:** inspect the relevant worker directory and deployment configuration. Keep API keys and other secrets in the provider's secret store or environment configuration, never in client-side files or committed source.
- **Desktop application:** inspect `desktop/` and its release/build configuration before packaging or publishing a desktop release.

Before deploying, confirm the target environment, inspect the proposed diff, and run the relevant checks. After deployment, verify the affected user journey in a browser and check logs or service status for any dependent backend.

## Theme and page conventions

Hamlet's shared visual system uses dark mode by default. New or materially revised pages should use the shared styles and initializer where appropriate:

```html
<link rel="stylesheet" href="/theme.css">
<script src="/theme.js"></script>
```

Check the page's existing script-loading pattern before inserting or changing scripts. Preserve accessible focus states, readable contrast, mobile layouts and reduced-motion behaviour. Some pages also require page-specific styles or compatibility scripts; the shared theme is not a substitute for checking those dependencies.

## Security and maintenance

- **Treat client-side checks as user experience, not authorization.** Enforce access through Firebase Security Rules and trusted server-side code.
- **Keep user data owner-scoped.** When changing property, profile, deal, document or mailbox features, review both the data model and the associated Firestore/Storage rules.
- **Do not expose secrets.** Never commit API keys, service-account credentials, private tokens or deployment secrets. Public Firebase client configuration is not a replacement for security rules.
- **Protect privileged operations.** Verify administrator identity and permissions in trusted rules or server-side code, not solely by hiding a page or button.
- **Keep projections deliberate.** Public listing/profile data should contain only fields intended to be public; do not copy private account metadata into public records.
- **Review related components together.** A feature can span an HTML page, shared JavaScript/CSS, Firestore rules, Storage paths, Cloud Functions and worker configuration.

Read [SECURITY.md](SECURITY.md), [PAGE-STANDARDS.md](PAGE-STANDARDS.md) and [PROFILE-SERVICE.md](PROFILE-SERVICE.md) before making changes in their respective areas.

## Contribution workflow

1. Identify the page or service involved and trace the scripts, styles and data paths it uses.
2. Make the smallest coherent change; avoid unrelated formatting or broad replacements.
3. Review the diff and check for broken paths, duplicated event handlers, exposed secrets and inconsistent rules.
4. Run the relevant available tests or validation commands.
5. Test the affected flow on desktop and mobile, including signed-out and signed-in states where applicable.
6. Deploy the relevant hosting/backend component and verify it in the target environment.

Use concise commit messages that describe the user-visible change or technical fix. If the homepage's GitHub update announcement is enabled, its text is driven by the latest commit message on `main`, so the commit subject may be visible to site visitors.

## Useful links

- [Live website](https://hamlet-ai.co.uk)
- [Source repository](https://github.com/hamletofficial/oss)
- [Security guidance](SECURITY.md)
- [Page standards](PAGE-STANDARDS.md)
- [Profile service documentation](PROFILE-SERVICE.md)
- [UX/UI roadmap](UX-UI-ROADMAP.md)
