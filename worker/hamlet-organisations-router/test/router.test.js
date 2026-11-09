import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

async function route(url, options = {}, env = {}) {
  let upstreamUrl = "";
  globalThis.fetch = async request => {
    upstreamUrl = request.url;
    return new Response("upstream", {
      status: 200,
      headers: {"Content-Type": "text/plain"}
    });
  };
  const response = await worker.fetch(new Request(url, options), env);
  return {response, upstreamUrl};
}

test("workers.dev root serves the organisation directory in staging", async () => {
  const {response, upstreamUrl} = await route("https://hamlet-organisations-router-staging.alfred-mayaki.workers.dev/");
  assert.equal(response.status, 200);
  assert.equal(upstreamUrl, "https://www.hamlet-ai.co.uk/organisation-directory.html");
  assert.equal(response.headers.get("X-Hamlet-Organisation-Route"), "directory");
  assert.equal(response.headers.get("X-Hamlet-Organisation-Environment"), "staging");
});

test("workers.dev tenant path opens the tenant handoff page and sets a tenant cookie", async () => {
  const {response, upstreamUrl} = await route("https://hamlet-organisations-router-staging.alfred-mayaki.workers.dev/tenant/acme-group");
  assert.equal(response.status, 200);
  assert.equal(upstreamUrl, "https://www.hamlet-ai.co.uk/app/hamlet/tenant.html?tenantSlug=acme-group");
  assert.match(response.headers.get("Set-Cookie"), /hamlet_tenant_slug=acme-group/);
});

test("workers.dev tenant cookie keeps subsequent workspace paths tenant-scoped", async () => {
  const {response, upstreamUrl} = await route(
    "https://hamlet-organisations-router-staging.alfred-mayaki.workers.dev/app/hamlet/organisations.html",
    {headers: {Cookie: "hamlet_tenant_slug=acme-group"}}
  );
  assert.equal(response.status, 200);
  assert.equal(upstreamUrl, "https://www.hamlet-ai.co.uk/app/hamlet/organisations.html");
  assert.equal(response.headers.get("X-Hamlet-Tenant-Route"), "acme-group");
});

test("canonical platform hostname serves the public organisation directory in staging", async () => {
  const {response, upstreamUrl} = await route("https://platform.hamlet-ai.co.uk/");
  assert.equal(response.status, 200);
  assert.equal(upstreamUrl, "https://www.hamlet-ai.co.uk/organisation-directory.html");
  assert.equal(response.headers.get("X-Hamlet-Organisation-Environment"), "staging");
});

test("canonical orgs tenant hostname opens tenant handoff in staging by default", async () => {
  const {response, upstreamUrl} = await route("https://acme-group.orgs.hamlet-ai.co.uk/");
  assert.equal(response.status, 200);
  assert.equal(upstreamUrl, "https://www.hamlet-ai.co.uk/app/hamlet/tenant.html?tenantSlug=acme-group");
  assert.equal(response.headers.get("X-Hamlet-Organisation-Environment"), "staging");
  assert.match(response.headers.get("Set-Cookie"), /hamlet_tenant_slug=acme-group/);
});

test("canonical tenant hostname switches to production only with explicit environment", async () => {
  const {response} = await route(
    "https://acme-group.orgs.hamlet-ai.co.uk/",
    {},
    {HAMLET_ORGANISATIONS_ENV: "production"}
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("X-Hamlet-Organisation-Environment"), "production");
  assert.equal(response.headers.get("Set-Cookie"), null);
});

test("reserved tenant slugs are rejected", async () => {
  const {response} = await route("https://admin.orgs.hamlet-ai.co.uk/");
  assert.equal(response.status, 404);
});

test("unsupported methods are rejected before proxying", async () => {
  const {response} = await route("https://platform.hamlet-ai.co.uk/", {method: "POST"});
  assert.equal(response.status, 405);
});

test("legacy staging hostname is not accepted", async () => {
  const {response} = await route("https://organisations-staging.hamlet-ai.co.uk/");
  assert.equal(response.status, 404);
});
