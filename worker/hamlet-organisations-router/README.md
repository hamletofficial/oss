# Hamlet Organisations Router

This Worker routes the organisation directory and tenant requests to the Hamlet application origin.

## Hostnames

| Purpose | Hostname | Runtime |
|---|---|---|
| Organisation directory | `platform.hamlet-ai.co.uk` | Production |
| Tenant workspace | `platform.hamlet-ai.co.uk/tenant/{slug}` | Production |
| Worker simulation | Worker `workers.dev` root and `/tenant/{slug}` | Routing simulation |

The public hostnames stay the same across releases. Production promotion is controlled by the Worker environment binding.

## Request behaviour

- The platform host root maps to the public `/organisation-directory.html` page.
- A tenant path maps to `/app/hamlet/tenant.html?tenantSlug={slug}`.
- The platform host sets a short-lived tenant cookie so the handoff and later workspace requests stay tenant-scoped.
- Tenant subdomains under `*.orgs.hamlet-ai.co.uk` are not used for the sign-in flow because the zone has no certificate covering that wildcard depth.
- `HAMLET_ORGANISATIONS_ENV` controls whether tenant routes use production behavior. The default is staging; production requires the explicit value `production`.
- Worker `workers.dev/tenant/{slug}` exercises tenant routing without changing the public hostname.
- A short-lived cookie preserves the simulated tenant route for subsequent workspace paths.
- Reserved or malformed tenant slugs are rejected.
- Only GET and HEAD requests are proxied.
- Responses are marked no-store and receive security headers identifying the route and environment.

The Worker does not authorize a member or determine whether an organisation is active. Those checks remain in the Firebase handoff and tenant application logic.

## Cloudflare production state

The production zone routes `platform.hamlet-ai.co.uk/*` and `*.orgs.hamlet-ai.co.uk/*` to the script `hamlet-organisations-router-staging`. Its deployed binding is `HAMLET_ORGANISATIONS_ENV=production`. The script proxies to `https://www.hamlet-ai.co.uk`; no isolated staging Firebase project or hosting target is configured. The active zone certificates cover `*.hamlet-ai.co.uk`, but not `*.orgs.hamlet-ai.co.uk`, so tenant entry uses the certified platform hostname and a path.

Cloudflare for SaaS has an active fallback origin at `orgs.hamlet-ai.co.uk`. The hostname `app.hamlet-ai.co.uk` has an active certificate, but it has no organisation metadata or application mapping. Custom customer domains are not operational until the application has a domain-to-organisation mapping and the router supports it.

## Deployment

The checked-in Wrangler config keeps staging as the safe default and does not manage production DNS, Worker routes, or Cloudflare custom hostnames. For a production deployment, explicitly set `HAMLET_ORGANISATIONS_ENV=production` and verify the target script and route attachments before rollout.

## Local validation

Run:

```sh
npm test
```
