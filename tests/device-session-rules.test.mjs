import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds
} from "@firebase/rules-unit-testing";
import { doc, setDoc, getDoc, Timestamp } from "firebase/firestore";
import { ref, uploadBytes } from "firebase/storage";

const projectId = "demo-hamlet-device-sessions";
const validSessionId = "session_0123456789abcdef0123456789";
let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    firestore: { rules: await readFile("firestore.rules", "utf8") },
    storage: { rules: await readFile("storage.rules", "utf8") }
  });
});

after(async () => {
  if (env) await env.cleanup();
});

async function seedSession(uid, sessionId, expiresAt) {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(
      doc(context.firestore(), "userSessions", uid, "sessions", sessionId),
      { uid, sessionId, active: true, expiresAt }
    );
  });
}

function tokenFor(sessionId) {
  return { hamletSessionId: sessionId, email_verified: true };
}

test("Firestore rejects authenticated writes without a device session", async () => {
  const db = env.authenticatedContext("alice").firestore();
  await assertFails(setDoc(
    doc(db, "userPushTokens", "alice", "tokens", "browser"),
    { token: "a-valid-push-token-value-over-twenty", platform: "web" }
  ));
});

test("Firestore permits protected writes for an active, unexpired device session", async () => {
  await seedSession("alice", validSessionId, Timestamp.fromMillis(Date.now() + 60_000));
  const db = env.authenticatedContext("alice", tokenFor(validSessionId)).firestore();
  await assertSucceeds(setDoc(
    doc(db, "userPushTokens", "alice", "tokens", "browser"),
    { token: "a-valid-push-token-value-over-twenty", platform: "web" }
  ));
});

test("Firestore rejects expired and revoked device sessions", async () => {
  const expiredId = "session_expired_0123456789abcdef";
  const revokedId = "session_revoked_0123456789abcdef";
  await seedSession("alice", expiredId, Timestamp.fromMillis(Date.now() - 60_000));
  await seedSession("alice", revokedId, Timestamp.fromMillis(Date.now() + 60_000));
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "userSessions", "alice", "sessions", revokedId), {
      uid: "alice", sessionId: revokedId, active: false,
      expiresAt: Timestamp.fromMillis(Date.now() + 60_000)
    });
  });
  for (const sessionId of [expiredId, revokedId]) {
    const db = env.authenticatedContext("alice", tokenFor(sessionId)).firestore();
    await assertFails(setDoc(
      doc(db, "userPushTokens", "alice", "tokens", sessionId),
      { token: "a-valid-push-token-value-over-twenty", platform: "web" }
    ));
  }
});

test("Clients cannot read or write the server-owned session registry", async () => {
  await seedSession("alice", validSessionId, Timestamp.fromMillis(Date.now() + 60_000));
  const db = env.authenticatedContext("alice", tokenFor(validSessionId)).firestore();
  const sessionRef = doc(db, "userSessions", "alice", "sessions", validSessionId);
  await assertFails(getDoc(sessionRef));
  await assertFails(setDoc(sessionRef, { active: false }));
});

test("Public profile reads remain public", async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "publicProfiles", "public-member"), {
      uid: "public-member", isPublic: true, displayName: "Public member"
    });
  });
  const db = env.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(db, "publicProfiles", "public-member")));
});

test("Storage uploads require a valid device session", async () => {
  const bytes = new Uint8Array([137, 80, 78, 71]);
  const noSession = env.authenticatedContext("alice").storage();
  await assertFails(uploadBytes(
    ref(noSession, "commercialPropertyImages/alice/property/photo.png"),
    bytes,
    { contentType: "image/png", customMetadata: { ownerUid: "alice", propertyId: "property" } }
  ));
  await seedSession("alice", validSessionId, Timestamp.fromMillis(Date.now() + 60_000));
  const withSession = env.authenticatedContext("alice", tokenFor(validSessionId)).storage();
  await assertSucceeds(uploadBytes(
    ref(withSession, "commercialPropertyImages/alice/property/photo.png"),
    bytes,
    { contentType: "image/png", customMetadata: { ownerUid: "alice", propertyId: "property" } }
  ));
});
