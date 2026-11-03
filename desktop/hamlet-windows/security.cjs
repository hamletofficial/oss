const APP_HOSTS = new Set(["www.hamlet-ai.co.uk", "hamlet-ai.co.uk"]);
const AUTH_HOSTS = new Set([
  "wale-491805.firebaseapp.com",
  "wale-491805.web.app",
  "accounts.google.com",
  "www.facebook.com",
  "m.facebook.com",
  "www.linkedin.com",
  "linkedin.com",
  "appleid.apple.com",
  "appleid.cdn-apple.com",
  "x.com",
  "twitter.com"
]);

function parseHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function isTrustedAppUrl(value) {
  const url = parseHttpsUrl(value);
  return Boolean(url && APP_HOSTS.has(url.hostname));
}

function isTrustedAuthUrl(value) {
  const url = parseHttpsUrl(value);
  return Boolean(url && (APP_HOSTS.has(url.hostname) || AUTH_HOSTS.has(url.hostname)));
}

module.exports = { isTrustedAppUrl, isTrustedAuthUrl };
