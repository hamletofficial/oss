# Hamlet Organisations Router

This Worker routes organisation directory and tenant requests to the Hamlet application origin.

## Hostname contract

| Purpose | Hostname | Status |
|---|---|---|
| Staging directory | `organisations-staging.hamlet-ai.co.uk` | Supported by code; DNS/route not attached |
| Staging tenant | `{slug}.organisations-staging.hamlet-ai.co.uk` | Supported by code; wildcard DNS/route not attached |
| Production directory | `organisations.hamlet-ai.co.uk` | Supported by code; production activation not authorised |
| Production tenant | `{slug}.organisations.hamlet-ai.co.uk` | Supported by code; production activation not authorised |
| Staging simulation | Worker `workers.dev` root and `/tenant/{slug}` | Existing staging Worker subdomain enabled |

## Request behaviour

- Directory host root maps to `/organisations.html`.
- Tenant host root maps to `/app/hamlet/tenant.html?tenantSlug={slug}`.
- Worker `workers.dev/tenant/{slug}` simulates a tenant hostname for staging.
- A short-lived host-scoped cookie preserves the simulated tenant route for subsequent workspace paths.
- Reserved or malformed tenant slugs are rejected.
- Only GET and HEAD requests are proxied.
- Responses are marked no-store and receive basic security headers.

The Worker does not itself authorise a member or determine whether an organisation is active. Those checks remain in the Firebase handoff and tenant application logic.

## Local tests

Run:

```sh
npm test
```

## Deployment boundary

The current Wrangler configuration intentionally has `workers_dev = true` and no production routes. Do not add production routes or DNS records as part of a staging deployment.

The custom staging hostnames require:
1. A dedicated staging frontend/hosting target.
2. Proxied DNS records for the exact directory hostname and tenant wildcard.
3. Worker routes scoped only to those staging hostnames.
4. End-to-end verification of the Firebase authentication handoff and tenant isolation.

The repository currently proxies to `https://www.hamlet-ai.co.uk`; this is a temporary staging limitation, not an isolated frontend. Do not describe the custom staging hostnames as operational until the dedicated frontend and DNS/Worker routes have been provisioned and tested.
