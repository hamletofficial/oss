const MAIN_ORIGIN = "https://wale-491805--pr82-feat-organisations-h-gon23gzd.web.app";
const RESERVED = new Set(["admin","api","app","auth","billing","blog","cdn","dashboard","docs","help","login","mail","members","organisations","orgs","press","public","root","settings","signin","signup","support","www"]);
const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/;

function tenantFromRequest(request) {
  const url = new URL(request.url);
  const host = url.hostname.toLowerCase();
  const production = host.match(/^([a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?)\.orgs\.hamlet-ai\.co\.uk$/);
  if (production) return {slug: production[1], production: true, initial: false};
  if (host.endsWith(".workers.dev")) {
    const match = url.pathname.match(/^\/tenant\/([a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?)\/?$/);
    if (match) return {slug: match[1], production: false, initial: true};
    const cookie = (request.headers.get("Cookie") || "").split(";").map(value => value.trim()).find(value => value.startsWith("hamlet_tenant_slug="));
    const slug = cookie ? decodeURIComponent(cookie.slice("hamlet_tenant_slug=".length)) : "";
    if (SLUG.test(slug) && !RESERVED.has(slug)) return {slug, production: false, initial: false};
  }
  return null;
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", {status: 405, headers: {"Allow": "GET, HEAD"}});
    }
    const tenant = tenantFromRequest(request);
    if (!tenant) return new Response("Not found", {status: 404});
    if (!SLUG.test(tenant.slug) || RESERVED.has(tenant.slug)) return new Response("Invalid organisation address", {status: 404});
    if (url.pathname === "/login.html") {
      return Response.redirect(MAIN_ORIGIN + "/login.html?next=" + encodeURIComponent("/app/hamlet/organisations.html"), 302);
    }

    let originPath = url.pathname;
    let originQuery = url.search;
    if (tenant.production && (originPath === "/" || originPath === "")) {
      originPath = "/app/hamlet/tenant.html";
      originQuery = "?tenantSlug=" + encodeURIComponent(tenant.slug);
    } else if (!tenant.production && tenant.initial) {
      originPath = "/app/hamlet/tenant.html";
      originQuery = "?tenantSlug=" + encodeURIComponent(tenant.slug);
    }
    const target = new URL(originPath + originQuery, MAIN_ORIGIN);
    const upstream = await fetch(new Request(target.toString(), {
      method: request.method,
      headers: {"Accept": request.headers.get("Accept") || "*/*"},
      redirect: "manual",
    }));
    const headers = new Headers(upstream.headers);
    headers.set("Cache-Control", "no-store, max-age=0");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    headers.set("X-Hamlet-Tenant-Route", tenant.slug);
    if (!tenant.production && tenant.initial) {
      headers.append("Set-Cookie", "hamlet_tenant_slug=" + encodeURIComponent(tenant.slug) + "; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=28800");
    }
    return new Response(upstream.body, {status: upstream.status, statusText: upstream.statusText, headers});
  },
};
