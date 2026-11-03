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

Hamlet's shared visual system is in darkmode by default. New or materially revised pages should use the shared styles and initializer where appropriate:

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
