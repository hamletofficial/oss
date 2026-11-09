import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

async function route(url, options = {}) {
  let upstreamUrl = "";
  globalThis.fetch = async request => {
    upstreamUrl = request.url;
    return new Response("upstream", {
      status: 200,
      headers: {"Content-Type": "text/plain"}
    });
  };
  const response = await worker.fetch(new Request(url, options));
  return {response, upstreamUrl};
}

test("workers.dev root serves the organisation directory", async () => {
  const {response, upstreamUrl} = await route("https://hamlet-organisations-router-staging.alfred-mayaki.workers.dev/");
  assert.equal(response.status, 200);
  assert.equal(upstreamUrl, "https://www.hamlet-ai.co.uk/organisations.html");
  assert.equal(response.headers.get("X-Hamlet-Organisation-Route"), "directory");
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

test("staging tenant hostname opens the tenant handoff page", async () => {
  const {response, upstreamUrl} = await route("https://acme-group.organisations-staging.hamlet-ai.co.uk/");
  assert.equal(response.status, 200);
  assert.equal(upstreamUrl, "https://www.hamlet-ai.co.uk/app/hamlet/tenant.html?tenantSlug=acme-group");
  assert.match(response.headers.get("Set-Cookie"), /hamlet_tenant_slug=acme-group/);
});

test("staging directory hostname serves organisation administration", async () => {
  const {response, upstreamUrl} = await route("https://organisations-staging.hamlet-ai.co.uk/");
  assert.equal(response.status, 200);
  assert.equal(upstreamUrl, "https://www.hamlet-ai.co.uk/organisations.html");
});

test("reserved tenant slugs are rejected", async () => {
  const {response} = await route("https://admin.organisations-staging.hamlet-ai.co.uk/");
  assert.equal(response.status, 404);
});

test("unsupported methods are rejected before proxying", async () => {
  const {response} = await route("https://organisations-staging.hamlet-ai.co.uk/", {method: "POST"});
  assert.equal(response.status, 405);
});
