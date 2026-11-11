# Hamlet Organisations Router

This Worker routes the organisation directory and tenant requests to the Hamlet application origin.

## Hostnames

| Purpose | Hostname | Runtime |
|---|---|---|
| Organisation directory | `platform.hamlet-ai.co.uk` | Production |
| Tenant workspace | `{slug}.orgs.hamlet-ai.co.uk` | Production |
| Worker simulation | Worker `workers.dev` root and `/tenant/{slug}` | Routing simulation |

The public hostnames stay the same across releases. Production promotion is controlled by the Worker environment binding.

## Request behaviour

- The platform host root maps to the public `/organisation-directory.html` page. The platform host is allow-listed to that directory, sign-in handoff, and shared static assets; unrelated main-site pages return 404.
- A tenant host root maps to `/app/hamlet/tenant.html?tenantSlug={slug}`. After the single-use Firebase sign-in handoff succeeds and active membership is verified, the handoff redirects to `/app/hamlet/organisation-dashboard.html`.
- Tenant hostnames use `{slug}.orgs.hamlet-ai.co.uk`. Tenant hosts proxy only the tenant handoff, organisation workspace HTML pages, sign-in handoff, and shared static assets. Unrelated main-site paths (for example `/about.html`, `/members.html` or `/pricing.html`) return 404 rather than mirroring the main website.
- `HAMLET_ORGANISATIONS_ENV` controls whether tenant routes use production behavior. The default is staging; production requires the explicit value `production`.
- Worker `workers.dev/tenant/{slug}` exercises tenant routing without changing the public hostname.
- A short-lived cookie preserves the simulated tenant route for subsequent workspace paths.
- Reserved or malformed tenant slugs are rejected.
- Only GET and HEAD requests are proxied.
- Responses are marked no-store and receive security headers identifying the route and environment.

The Worker serves `robots.txt` directly on every `{slug}.orgs.hamlet-ai.co.uk` hostname with `Disallow: /` and an `X-Robots-Tag: noindex, nofollow, noarchive` header. This prevents compliant crawlers from indexing tenant workspaces; it is not an access-control mechanism. The main website's `robots.txt` cannot control tenant hostnames, so the tenant policy must be served on each tenant host.

The Worker does not authorize a member or determine whether an organisation is active. The route allow-list limits which application pages are exposed on these hostnames; Firebase authentication, tenant membership checks and backend authorization remain authoritative. Those checks remain in the Firebase handoff and tenant application logic.

## Cloudflare production state

The production zone currently routes `platform.hamlet-ai.co.uk/*` and `*.orgs.hamlet-ai.co.uk/*` to the script `hamlet-organisations-router-staging`. Its deployed binding is `HAMLET_ORGANISATIONS_ENV=production`. The script proxies to `https://www.hamlet-ai.co.uk`; no isolated staging Firebase project or hosting target is configured.

Cloudflare for SaaS has an active fallback origin at `orgs.hamlet-ai.co.uk`. The hostname `app.hamlet-ai.co.uk` has an active certificate, but it has no organisation metadata or application mapping. The router currently recognizes only the platform host and `{slug}.orgs.hamlet-ai.co.uk`; custom customer domains are not operational until the application has a domain-to-organisation mapping and the router supports it.

## Deployment

The checked-in Wrangler config keeps staging as the safe default and does not manage production DNS, Worker routes, or Cloudflare custom hostnames. For a production deployment, explicitly set `HAMLET_ORGANISATIONS_ENV=production` and verify the target script and route attachments before rollout.

## Local validation

Run:

```sh
npm test
```
