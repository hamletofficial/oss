const test = require("node:test");
const assert = require("node:assert/strict");
const { isTrustedAppUrl, isTrustedAuthUrl } = require("./security.cjs");

test("accepts the canonical Hamlet HTTPS hosts", () => {
  assert.equal(isTrustedAppUrl("https://www.hamlet-ai.co.uk/"), true);
  assert.equal(isTrustedAppUrl("https://hamlet-ai.co.uk/login.html"), true);
});

test("rejects lookalike hosts, HTTP and non-web schemes", () => {
  assert.equal(isTrustedAppUrl("https://hamlet-ai.co.uk.example.org/"), false);
  assert.equal(isTrustedAppUrl("https://evil.hamlet-ai.co.uk/"), false);
  assert.equal(isTrustedAppUrl("http://www.hamlet-ai.co.uk/"), false);
  assert.equal(isTrustedAppUrl("javascript:alert(1)"), false);
});

test("allows only explicitly approved HTTPS authentication hosts", () => {
  assert.equal(isTrustedAuthUrl("https://wale-491805.firebaseapp.com/__/auth/handler"), true);
  assert.equal(isTrustedAuthUrl("https://accounts.google.com/"), true);
  assert.equal(isTrustedAuthUrl("https://attacker.google.com/"), false);
  assert.equal(isTrustedAuthUrl("https://another-project.firebaseapp.com/"), false);
});

test("notification permission is scoped to an allowed Hamlet HTTPS origin", () => {
  const requestingOrigin = "https://www.hamlet-ai.co.uk/settings.html";
  assert.equal(isTrustedAppUrl(requestingOrigin), true);
  assert.equal(isTrustedAppUrl("https://accounts.google.com/"), false);
  assert.equal(isTrustedAppUrl("https://hamlet-ai.co.uk.attacker.example/"), false);
});
