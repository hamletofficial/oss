const PERSISTENT_SESSION_PARTITION = "persist:hamlet";

function createHamletPersistentSession(electronSession, isTrustedAppUrl) {
  if (!electronSession || typeof electronSession.fromPartition !== "function") {
    throw new TypeError("An Electron session module is required.");
  }
  if (typeof isTrustedAppUrl !== "function") {
    throw new TypeError("A trusted-origin validator is required.");
  }

  const persistentSession = electronSession.fromPartition(PERSISTENT_SESSION_PARTITION);
  persistentSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const requestingUrl = details && details.requestingUrl;
    // Grant only notification permission, and only to Hamlet HTTPS origins.
    callback(permission === "notifications" && isTrustedAppUrl(requestingUrl));
  });
  return persistentSession;
}

module.exports = { PERSISTENT_SESSION_PARTITION, createHamletPersistentSession };
