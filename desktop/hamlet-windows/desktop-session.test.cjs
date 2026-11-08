const test = require("node:test");
const assert = require("node:assert/strict");
const { isTrustedAppUrl } = require("./security.cjs");
const { PERSISTENT_SESSION_PARTITION, createHamletPersistentSession } = require("./desktop-session.cjs");

test("creates the named persistent Electron session partition", () => {
  let requestedPartition = "";
  let permissionHandler;
  const fakeSession = {
    setPermissionRequestHandler(handler) { permissionHandler = handler; }
  };
  const electronSession = {
    fromPartition(partition) {
      requestedPartition = partition;
      return fakeSession;
    }
  };

  const result = createHamletPersistentSession(electronSession, isTrustedAppUrl);
  assert.equal(requestedPartition, "persist:hamlet");
  assert.equal(PERSISTENT_SESSION_PARTITION, "persist:hamlet");
  assert.equal(result, fakeSession);
  assert.equal(typeof permissionHandler, "function");
});

test("grants only notification permission from a trusted Hamlet HTTPS origin", () => {
  let permissionHandler;
  const fakeSession = {
    setPermissionRequestHandler(handler) { permissionHandler = handler; }
  };
  createHamletPersistentSession({ fromPartition: () => fakeSession }, isTrustedAppUrl);

  const request = (permission, requestingUrl) => {
    let granted = null;
    permissionHandler(null, permission, value => { granted = value; }, { requestingUrl });
    return granted;
  };

  assert.equal(request("notifications", "https://www.hamlet-ai.co.uk/"), true);
  assert.equal(request("geolocation", "https://www.hamlet-ai.co.uk/"), false);
  assert.equal(request("notifications", "https://accounts.google.com/"), false);
  assert.equal(request("notifications", "https://hamlet-ai.co.uk.attacker.example/"), false);
});

test("rejects invalid Electron session configuration", () => {
  assert.throws(() => createHamletPersistentSession(null, isTrustedAppUrl), TypeError);
  assert.throws(() => createHamletPersistentSession({ fromPartition() {} }, isTrustedAppUrl), TypeError);
  assert.throws(() => createHamletPersistentSession({ fromPartition() { return { setPermissionRequestHandler() {} }; } }, null), TypeError);
});
