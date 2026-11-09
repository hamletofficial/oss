# Hamlet Organisations Router

This Worker routes the organisation directory and tenant requests to the Hamlet application origin.

## Canonical hostname contract

| Purpose | Hostname | Use |
|---|---|---|
| Organisation directory | `platform.hamlet-ai.co.uk` | Single public platform entry point |
| Tenant workspace | `{slug}.orgs.hamlet-ai.co.uk` | Organisation-specific workspace |
| Pull request testing | GitHub PR checks and preview deployments | Development and acceptance testing; no separate staging domain |
| Router simulation | Worker `workers.dev` root and `/tenant/{slug}` | Isolated routing smoke tests |

There is no separate staging hostname or staging environment switch in the public hostname contract. Feature branches and pull requests are the staging/review mechanism. The production hostname is activated only through an explicitly reviewed deployment after the PR checks pass.

## Request behaviour

- `platform.hamlet-ai.co.uk/` maps to `/organisations.html`.
- `{slug}.orgs.hamlet-ai.co.uk/` maps to `/app/hamlet/tenant.html?tenantSlug={slug}`.
- The hostname and slug are routing inputs only; they never prove membership or authority.
- Worker `workers.dev/tenant/{slug}` simulates a tenant hostname for router tests.
- A short-lived HttpOnly, Secure, SameSite=Lax cookie preserves the simulated tenant route on the `workers.dev` origin only.
- Reserved or malformed tenant slugs are rejected. The reserved `platform` slug prevents a tenant hostname from colliding with the directory namespace.
- Only GET and HEAD requests are proxied.
- Responses are marked no-store and receive security headers.

The Worker does not itself authorise a member or determine whether an organisation is active. Those checks remain in the Firebase handoff and tenant application logic.

## Local tests

Run:

```sh
npm test
```

## Deployment boundary

The Wrangler configuration keeps the Worker `workers.dev` endpoint available for router smoke tests. This PR does not create DNS records, attach custom domains or Worker routes, provision Firebase Hosting, or deploy infrastructure.

The Worker currently proxies to `https://www.hamlet-ai.co.uk`. Do not describe the custom hostname or tenant routing as operational until the frontend origin, DNS/Worker attachment, Firebase authentication handoff, and tenant-isolation checks have been provisioned and tested.

Deploy the canonical directory and wildcard tenant routing only after the relevant pull request has passed review and the production route has been explicitly approved. Do not introduce a separate staging hostname.
