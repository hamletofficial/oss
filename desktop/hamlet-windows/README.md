# hamlet for Windows

This folder contains the Electron desktop application for Hamlet. The Windows release workflow builds the x64 NSIS installer and signs it with Microsoft Azure Artifact Signing when release credentials are configured.

## Current functionality

- Opens the live Hamlet platform in a dedicated Windows desktop window.
- Uses a dedicated Electron persistent session partition (`persist:hamlet`) so Chromium site storage survives application and Windows restarts.
- Keeps Firebase Authentication's existing `LOCAL` persistence and refresh-token lifecycle; Firebase silently refreshes ID tokens and emits auth-state changes when a user session is restored or revoked.
- Reuses the persistent partition for identity-provider popups so OAuth state and Firebase auth operations share the same desktop profile.
- Uses a restricted preload bridge for version information and native notifications.
- Uses Electron context isolation, sandboxing, disabled Node.js integration and HTTPS navigation controls.
- Generates a Hamlet-branded `.ico` at build time and builds an NSIS installer with Start menu and desktop shortcuts.

## Authentication behaviour

A user signs in once. When Hamlet closes, Electron retains the Firebase web-origin storage in its persistent Chromium session. On the next launch, the Firebase SDK restores its locally persisted refresh token, refreshes the ID token when required and triggers the normal auth-state observer. This does not bypass MFA, account disablement, refresh-token revocation or Firestore Security Rules.

The desktop app does not copy Firebase refresh tokens into application files, environment variables or a custom credential store. Credential persistence is handled by Chromium/Electron's persistent session store and Firebase Auth. Users sign out through Hamlet's existing Firebase sign-out action, which removes the Firebase session according to the SDK's normal lifecycle.

## Local build (Windows 10/11)

From this directory, in PowerShell:

```powershell
npm install
npm run check
npm start
npm run pack:win
```

The installer targets Windows x64. Local builds are unsigned unless signed through the configured Azure Artifact Signing workflow.

## Manual Windows acceptance tests

1. Install and launch Hamlet; sign in using a configured provider.
2. Close the application completely and relaunch it. The workspace should restore without a new sign-in while the Firebase session remains valid.
3. Restart Windows and repeat the launch check.
4. Sign out, close and relaunch. The app must remain signed out.
5. Revoke the user's refresh tokens or disable the test account in Firebase Admin, relaunch, and confirm protected data remains inaccessible after Firebase processes the revocation.
6. Confirm MFA and email-verification policy remains unchanged.
7. Verify Firestore Security Rules continue to deny unauthorised reads and writes.

Automated Electron unit tests cannot fully substitute for these interactive Windows/Firebase acceptance tests.

## Security notes

- The persistent partition is intentionally limited to the Hamlet desktop BrowserWindow and its approved identity-provider popups.
- Never include Firebase Admin credentials, service-account keys or other privileged secrets in the desktop package.
- Server-side Firestore/Storage rules remain the authority for access control.
- Persisted browser data resides in the current Windows user's Electron profile and is protected by that profile's OS account permissions. This implementation does not claim a separate DPAPI-encrypted Firebase-token vault; users who need protection against processes running as the same Windows account require a separately designed credential-storage architecture.
