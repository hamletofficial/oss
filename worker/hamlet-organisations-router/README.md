# Hamlet Organisations Router

This Worker routes the organisation directory and tenant requests to the Hamlet application origin.

## Canonical hostname

| Purpose | Hostname | Environment |
|---|---|---|
| Organisation directory | `organisations.hamlet-ai.co.uk` | Staging first; promote the tested release to production on the same hostname |
| Tenant workspace | `{slug}.organisations.hamlet-ai.co.uk` | Follows the Worker deployment environment |
| Staging simulation | Worker `workers.dev` root and `/tenant/{slug}` | Staging only |

There is no separate `organisations-staging` hostname. Staging and production use the same canonical hostname at different points in the release lifecycle. The staging deployment is the active candidate until acceptance checks pass; production promotion changes the deployed environment configuration, not the public URL.

## Request behaviour

- Canonical directory host root maps to `/organisations.html`.
- Tenant host root maps to `/app/hamlet/tenant.html?tenantSlug={slug}`.
- Tenant hostnames use the same `{slug}.organisations.hamlet-ai.co.uk` pattern in both environments.
- `HAMLET_ORGANISATIONS_ENV` controls whether tenant routes are treated as staging or production. The default is staging; only an explicit `production` value enables production behaviour.
- Worker `workers.dev/tenant/{slug}` simulates a tenant hostname for staging.
- A short-lived cookie preserves the simulated tenant route for subsequent workspace paths.
- Reserved or malformed tenant slugs are rejected.
- Only GET and HEAD requests are proxied.
- Responses are marked no-store and receive security headers identifying the route and environment.

The Worker does not itself authorise a member or determine whether an organisation is active. Those checks remain in the Firebase handoff and tenant application logic.

## Local tests

Run:

```sh
npm test
```

## Deployment boundary

The current Wrangler configuration uses the Worker `workers.dev` subdomain for staging simulation and does not attach custom domains, DNS records, or production routes. The canonical custom hostname must only be attached to the staging Worker when the staging frontend target and end-to-end checks are ready. Do not attach production routing as part of this PR.

The Worker currently proxies to `https://www.hamlet-ai.co.uk`. This is not an isolated staging frontend. Do not describe the custom hostname or tenant routing as operational until the correct staging frontend, DNS/Worker attachment, Firebase authentication handoff, and tenant-isolation checks have been provisioned and tested.

After staging acceptance, promote the tested release to production on the same canonical hostname by deploying with `HAMLET_ORGANISATIONS_ENV=production`. No hostname migration is required.
