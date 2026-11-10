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

## Hamlet Organisations

**Hamlet Organisations** adds organisation-scoped workspaces for property firms, broker teams and other professional groups. It separates a firm's shared operational records and membership governance from each broker's personal Hamlet account.

### User-facing routes

| Route | Purpose |
|---|---|
| `/organisations.html` | Organisation administration: create an organisation, view memberships, manage invitations and roles, and accept an invitation. |
| `/app/hamlet/organisations.html` | Authenticated organisation workspace and organisation switcher. |
| `/app/hamlet/organisation-deals.html` | Organisation-owned deal records and shared pipeline. |
| `/app/hamlet/organisation-properties.html` | Organisation-owned commercial and residential property portfolio. |
| `/app/hamlet/organisation-files.html` | Documents and assets attached to organisation deals and properties. |
| `/app/hamlet/organisation-teams.html` | Team creation, assignments and restricted deal/property permissions. |
| `/app/hamlet/organisation-activity.html` | Administrative audit history for organisation owners and administrators. |
| `/app/hamlet/organisation-analytics.html` | Aggregate membership, team, deal and property counts and pipeline breakdowns. |
| `/app/hamlet/organisation-association.html` | Explicitly copy an eligible personal deal or property into an organisation as a restricted snapshot. |
| `/app/hamlet/tenant.html` | Secure organisation sign-in handoff used by the tenant authentication flow. |

These routes require a valid signed-in Hamlet account and active organisation membership where applicable. Email verification is required for organisation access. Privileged actions are enforced by trusted backend operations and Firebase Security Rules, not by hiding interface controls.

### Firebase callable operations

The organisation backend is implemented in `functions/hamlet-organisations.js` and exports the following Firebase callable functions in the `us-central1` region. They are invoked through Firebase Functions' callable HTTPS transport (the client SDK's `httpsCallable` interface); they are **not** independent REST URL routes.

| Callable function | Purpose |
|---|---|
| `createOrganisation` | Create an organisation, reserve its unique slug and establish the creator as owner. |
| `requestOrganisationMembership` | Submit a request to join an organisation. |
| `reviewOrganisationMembershipRequest` | Approve or decline a pending membership request. |
| `createOrganisationInvitation` | Issue an invitation for a specified email address and organisation role. |
| `acceptOrganisationInvitation` | Accept a valid invitation for the invited account. |
| `revokeOrganisationInvitation` | Revoke a pending invitation. |
| `changeOrganisationMemberRole` | Change an active member's organisation role, subject to role and ownership safeguards. |
| `removeOrganisationMember` | Remove a member and deactivate their active team assignments. |
| `leaveOrganisation` | Allow a member to leave an organisation, subject to ownership safeguards. |
| `updateOrganisationProfile` | Update organisation profile fields and its approved public directory projection. |
| `submitOrganisationVerification` | Submit organisation registration details for review. |
| `getOrganisationVerificationStatus` | Retrieve the caller's organisation verification status and report where authorised. |
| `listOrganisationVerificationRequests` | Retrieve the platform verification review queue for authorised platform administrators. |
| `reviewOrganisationVerification` | Approve or reject an organisation verification submission. |
| `copyPersonalResourceToOrganisation` | Copy an eligible personal deal or property into the organisation as a restricted snapshot. |
| `deleteOrganisationDocument` | Delete an organisation document and its associated stored file, subject to resource access checks. |
| `getOrganisationAnalytics` | Return aggregate organisation membership, team, deal and property metrics for authorised managers. |

The callable functions are the backend operations currently exported by the organisation service. Team administration also uses the callable operations `createOrganisationTeam`, `updateOrganisationTeam`, `setOrganisationTeamMember` and `archiveOrganisationTeam`; those are implemented by the team service in the Functions codebase. Confirm the deployed Functions inventory and target Firebase project before relying on any callable in a live environment.

### Data model and access boundaries

The organisation feature uses dedicated Firestore collections rather than reusing personal CRM records:

| Collection | Purpose |
|---|---|
| `organisations` | Private organisation records and lifecycle state. |
| `organisationSlugs` | Unique organisation URL-name reservations. |
| `organisationDirectory` | Whitelisted public organisation profile projection. |
| `organisationMembers` | Organisation membership, role and active status. |
| `organisationInvitations` | Invitation records and lifecycle state. |
| `organisationMembershipRequests` | Requests to join an organisation. |
| `organisationVerificationRequests` | Private business-registration verification submissions and review data. |
| `organisationDeals` | Organisation-owned deal and pipeline records. |
| `organisationProperties` | Organisation-owned commercial and residential property records. |
| `organisationDocuments` | Metadata for files linked to organisation resources. |
| `organisationTeams` | Organisation teams and their permitted capabilities. |
| `organisationTeamMembers` | Team membership assignments. |
| `organisationResourceShares` | Explicit user-level access grants for restricted organisation resources. |
| `organisationDealEvents` | Deal-related events associated with organisation resources. |
| `organisationActivity` | Trusted organisation administrative audit events. |

Organisation resource visibility supports organisation-wide and restricted access. Restricted deals and properties can be shared with named members or authorised teams, subject to the applicable resource permissions. Team permissions currently cover assigned deal and property read/write access; document and roster permissions are not enabled as team capabilities.

Documents are stored under the tenant-scoped Storage path:

```text
organisationDocuments/{organisationId}/{resourceType}/{resourceId}/{documentId}/{fileName}
```

The organisation slug is reserved for identity and future addressing. A reserved slug does **not** mean that a tenant subdomain has been provisioned or activated.

### Roles and governance

Organisation membership roles include owner, administrator, manager and member-level roles (including viewer access). Owners and administrators manage organisation settings, membership and invitations. Manager/member capabilities are constrained by the resource's sharing policy and Firebase Security Rules. The owner role is protected by lifecycle safeguards; for example, an owner cannot simply leave while the organisation would be left without its required ownership.

The organisation activity history is read-only to clients and restricted to owners and administrators. Trusted backend operations write administrative events. The current audit scope covers organisation creation, invitations, membership administration and verification-related actions; resource-level deal/property change history is a later increment.

### Personal data and organisation separation

- Personal deals and properties remain in their personal collections unless a user explicitly copies an eligible record into an organisation.
- The copy operation creates a distinct, restricted organisation snapshot; it does not move, mutate or automatically share the source record.
- Organisation-owned deals and properties are stored in `organisationDeals` and `organisationProperties`, not the personal CRM collections or public listing projections.
- Organisation files and images are tenant-scoped and do not become public listing media by virtue of upload.
- The currently implemented slug reservation does not provision a dedicated tenant hostname or subdomain.

### Development and validation

The Functions package defines an organisation test suite:

```bash
cd functions
npm run test:organisations
```

This runs the organisation service and secure handoff tests. Review the package scripts and local Firebase Emulator requirements before running the wider backend test suite. For changes to access control or data structures, inspect and test the corresponding rules in `firestore.rules` and `storage.rules` as well as the client pages and callable functions.

Before deploying, verify the intended Firebase project and Functions codebase. A source file or callable present in this repository does not by itself prove that the corresponding function has been deployed to the target project.

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
