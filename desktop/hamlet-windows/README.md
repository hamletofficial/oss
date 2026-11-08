# hamlet for Windows

This folder contains the Electron desktop application for Hamlet. The v1.04.06 Windows release workflow runs automated checks, builds the x64 NSIS installer, signs it with Microsoft Azure Artifact Signing and verifies the signature before publishing.

## Current functionality

- Opens the live Hamlet platform in a dedicated Windows desktop window.
- Uses a dedicated Electron persistent session partition (`persist:hamlet`) so the Firebase-authenticated Chromium profile survives application and Windows restarts.
- Shares that persistent partition with approved identity-provider popups, preserving OAuth flow state within the desktop profile.
- Uses Electron context isolation, sandboxing, disabled Node.js integration and HTTPS navigation controls.
- Routes ordinary HTTPS links to the default browser and permits only the configured authentication hosts in app popups.
- Exposes a narrowly scoped `window.hamletDesktop.notify({ title, body })` bridge for native desktop notifications.
- Connects the Hamlet deal pipeline's critical-path reminder checks to native notifications, with browser notifications as a fallback.
- Generates a Hamlet-branded `.ico` at build time and builds an NSIS installer with Start menu and desktop shortcuts.

## Persistent Firebase authentication

A user signs in once. When Hamlet closes, Electron retains the Firebase web-origin storage in its named persistent Chromium session. On the next launch, Firebase Auth restores its existing `LOCAL` session, refreshes ID tokens when required and notifies the application's existing auth-state observer. This does not bypass MFA, email-verification policy, account disablement, refresh-token revocation or Firestore Security Rules.

The desktop shell does not copy Firebase refresh tokens into application files, environment variables or a custom credential store. Persistence remains owned by Firebase Auth and Chromium's persistent profile. Explicit sign-out continues to use Hamlet's existing Firebase sign-out action.

## Local build (Windows 10/11)

From this directory, in PowerShell:

```powershell
npm install
npm run check
npm start
npm run pack:win
```

The package produces `release/hamlet-Setup-1.4.6.exe`. Local builds are unsigned unless signed through the configured Azure Artifact Signing workflow.

## Automated v1.04.06 release

The GitHub Actions workflow `.github/workflows/hamlet-windows-release.yml`:

1. Runs on a Windows 2025 runner with Node.js 24.
2. Installs desktop dependencies and runs syntax, security and unit tests.
3. Verifies package version `1.4.6`.
4. Builds exactly the x64 NSIS installer.
5. Signs the installer with Azure Artifact Signing and an RFC 3161 timestamp.
6. Requires a valid Authenticode signature before calculating the SHA-256 digest.
7. Publishes the signed installer and matching checksum to the GitHub release.

### Required GitHub Actions configuration

Configure these repository secrets (never commit credentials):

- `AZURE_CLIENT_ID`: Entra application/client ID.
- `AZURE_SUBSCRIPTION_ID`: Azure subscription ID used by the Azure login action.
- `AZURE_TENANT_ID`: Entra tenant ID.
- `AZURE_TRUSTED_SIGNING_ENDPOINT`: region-specific Artifact Signing endpoint.
- `AZURE_TRUSTED_SIGNING_ACCOUNT`: Artifact Signing account name.
- `AZURE_TRUSTED_SIGNING_CERT_PROFILE`: public-trust certificate profile name.

The existing Azure subscription ID is used as `AZURE_SUBSCRIPTION_ID`, and the existing Microsoft Entra tenant ID is used as `AZURE_TENANT_ID`. The Entra application must have a federated identity credential trusting this repository's GitHub Actions OIDC subject for the `main` branch (or the release environment/ref you explicitly configure), and the **Artifact Signing Certificate Profile Signer** role on the Artifact Signing account. The workflow authenticates with `azure/login@v3` using GitHub OIDC, then allows the signing action to use the Azure CLI credential (`exclude-azure-cli-credential: false`). GitHub Actions must permit OIDC token issuance. Do not use a client secret when workload identity federation is configured.

Pull requests run the Windows build and tests without requesting Azure credentials, signing, or publishing. The signing job runs only on non-PR events after a successful build. A manual dispatch publishes a public release only when `publish_release` is explicitly set to `true`; leave it `false` for a signing-only validation run. The repository workflow deliberately fails closed: if signing credentials are missing, signing cannot complete, or Authenticode validation is not `Valid`, the installer is not published.

## Manual Windows acceptance tests

After downloading the signed installer and checksum, verify both:

```powershell
Get-AuthenticodeSignature .\hamlet-Setup-1.4.6.exe | Format-List Status,StatusMessage,SignerCertificate
Get-FileHash .\hamlet-Setup-1.4.6.exe -Algorithm SHA256
Get-Content .\SHA256SUMS.txt
```

Then install on Windows 10/11 and test launch, first sign-in, close/reopen session restoration, sign-out followed by reopen, notifications, shortcuts, upgrade and uninstall. Also verify enabled identity-provider sign-in with real accounts. A green CI build validates packaging and signing; it does not establish every interactive Windows behaviour.

## Release and security notes

- Reminder checks are page-driven: the pipeline page must be running; reminders are not scheduled while the application is fully closed.
- Signing credentials and private keys must remain in Azure/GitHub secure identity configuration and never in the desktop package.
- Persisted browser data resides in the current Windows user's Electron profile and inherits that profile's OS account permissions. This implementation does not claim a separate DPAPI-encrypted Firebase-token vault; protection against processes running as the same Windows account would require a separately designed credential-storage architecture.
- Code signing does not yet provide an automatic secure update mechanism.
- Never include Firebase Admin credentials, service-account keys or other privileged secrets in the desktop package.
