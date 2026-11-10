const MAIN_ORIGIN = "https://www.hamlet-ai.co.uk";
const PLATFORM_HOST = "platform.hamlet-ai.co.uk";
const RESERVED = new Set(["admin","api","app","auth","billing","blog","cdn","dashboard","docs","help","login","mail","members","organisations","orgs","press","public","root","settings","signin","signup","support","www"]);
const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/;

function readTenantCookie(request) {
  const value = (request.headers.get("Cookie") || "")
    .split(";")
    .map(item => item.trim())
    .find(item => item.startsWith("hamlet_tenant_slug="));
  if (!value) return "";
  try {
    return decodeURIComponent(value.slice("hamlet_tenant_slug=".length));
  } catch {
    return "";
  }
}

function tenantFromRequest(request, environment) {
  const url = new URL(request.url);
  const host = url.hostname.toLowerCase();
  const production = environment === "production";

  if (host === PLATFORM_HOST) {
    return {kind: "directory"};
  }

  const tenant = host.match(/^([a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?)\.orgs\.hamlet-ai\.co\.uk$/);
  if (tenant) {
    return {kind: "tenant", slug: tenant[1], production, initial: url.pathname === "/"};
  }

  if (host.endsWith(".workers.dev")) {
    const match = url.pathname.match(/^\/tenant\/([a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?)\/?$/);
    if (match) return {kind: "tenant", slug: match[1], production: false, initial: true};

    const cookieSlug = readTenantCookie(request);
    if (SLUG.test(cookieSlug) && !RESERVED.has(cookieSlug)) {
      return {kind: "tenant", slug: cookieSlug, production: false, initial: false};
    }

    return {kind: "directory"};
  }

  return null;
}

function tenantCookie(slug) {
  return "hamlet_tenant_slug=" + encodeURIComponent(slug) +
    "; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=28800";
}

export default {
  async fetch(request, env = {}) {
    const url = new URL(request.url);
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", {status: 405, headers: {"Allow": "GET, HEAD"}});
    }

    const environment = env.HAMLET_ORGANISATIONS_ENV === "production" ? "production" : "staging";
    const route = tenantFromRequest(request, environment);
    if (!route) return new Response("Not found", {status: 404});

    if (route.kind === "directory") {
      const directoryPath = url.pathname === "/" ? "/organisation-directory.html" : url.pathname;
      const target = new URL(directoryPath + url.search, MAIN_ORIGIN);
      const upstream = await fetch(new Request(target.toString(), {
        method: request.method,
        headers: {"Accept": request.headers.get("Accept") || "*/*"},
        redirect: "manual",
      }));
      const headers = new Headers(upstream.headers);
      headers.set("Cache-Control", "no-store, max-age=0");
      headers.set("X-Content-Type-Options", "nosniff");
      headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
      headers.set("X-Hamlet-Organisation-Route", "directory");
      headers.set("X-Hamlet-Organisation-Environment", environment);
      return new Response(upstream.body, {status: upstream.status, statusText: upstream.statusText, headers});
    }

    if (!SLUG.test(route.slug) || RESERVED.has(route.slug)) {
      return new Response("Invalid organisation address", {status: 404});
    }

    if (url.pathname === "/login.html") {
      return Response.redirect(MAIN_ORIGIN + "/login.html?next=" +
        encodeURIComponent("/app/hamlet/organisations.html"), 302);
    }

    let originPath = url.pathname;
    let originQuery = url.search;
    if (route.initial) {
      originPath = "/app/hamlet/tenant.html";
      originQuery = "?tenantSlug=" + encodeURIComponent(route.slug);
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
    headers.set("X-Hamlet-Tenant-Route", route.slug);
    headers.set("X-Hamlet-Organisation-Environment", environment);
    if (route.initial && !route.production) headers.append("Set-Cookie", tenantCookie(route.slug));

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  },
};
