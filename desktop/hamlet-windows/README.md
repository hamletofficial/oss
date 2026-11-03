# hamlet for Windows

This folder contains the Electron desktop application for Hamlet. The unified v1.04.04 Windows release workflow runs automated checks and packages the installer on a Windows runner before publishing the Windows prerelease. The desktop build is separate from the GitHub Pages deployment.

## Current functionality

- Opens the live Hamlet platform in a dedicated Windows desktop window.
- Uses Electron context isolation, sandboxing, disabled Node.js integration and HTTPS navigation controls.
- Routes ordinary HTTPS links to the default browser and permits only the configured authentication hosts in app popups.
- Exposes a narrowly scoped `window.hamletDesktop.notify({ title, body })` bridge for native desktop notifications.
- Connects the Hamlet deal pipeline's critical-path reminder checks to native notifications, with browser notifications as a fallback.
- Generates a Hamlet-branded `.ico` at build time and builds an NSIS installer with Start menu and desktop shortcuts.

## Local build (Windows 10/11)

From this directory, in PowerShell:

```powershell
npm install
npm run check
npm start
npm run pack:win
```

A successful Windows package build should produce `release/hamlet-Setup-1.4.4.exe`.

## Automated validation and v1.04.04 release

The GitHub Actions workflow `.github/workflows/hamlet-windows-release.yml` uses Node.js 24 on a Windows runner and:

1. Installs dependencies and runs JavaScript syntax, security and unit tests.
2. Verifies the desktop package version is `1.4.4`.
3. Builds the NSIS Windows installer.
4. Requires exactly one installer larger than 1 MB and checks that its filename is `hamlet-Setup-1.4.4.exe`.
5. Calculates SHA-256 and attaches the installer plus checksum to the `v1.04.04` Windows prerelease only after the preceding checks pass.

To run the release build manually, open the repository's Actions tab, select **Build and publish Hamlet v1.04.04 for Windows**, choose **Run workflow** on `main`, and keep the tag as `v1.04.04`. The workflow tests and builds before publishing. The release remains a prerelease because code signing and real-device acceptance are still outstanding.

The website's browser end-to-end test runs in the repository's smoke-test workflow. It uses a mocked Firebase environment to exercise the deal pipeline, workspace search, deal calculator, saved searches and transaction-document upload. It does not use production credentials or establish that real identity-provider login works in Electron.

## Manual Windows acceptance test before release

After downloading the workflow artifact, extract it and verify the installer checksum using PowerShell:

```powershell
Get-FileHash .\\hamlet-Setup-1.4.4.exe -Algorithm SHA256
Get-Content .\\SHA256SUMS.txt
```

Compare the hash with the entry for the installer in `SHA256SUMS.txt`. Then install on a supported Windows 10/11 machine and verify:

- The installer completes and creates the expected Start menu and desktop shortcuts.
- The app opens the correct Hamlet domain and can be closed and relaunched.
- Firebase sign-in, sign-out and each enabled provider are tested with real accounts; authentication callback handling may need provider-specific adjustments.
- The notification-enable action produces a native Windows notification when notifications are allowed.
- A test critical-path reminder is shown in the configured lead-time window and is not duplicated on the same day.
- Windows notification permissions, Focus/Do Not Disturb, app restart, upgrade and uninstall behaviour are checked.

A green CI build validates the package process, not every interactive Windows behaviour. The installer still requires the manual acceptance checks above before public release.

## Release and security notes

- Reminder checks are currently page-driven: the pipeline page must be running. Native notifications are not scheduled while the application is fully closed.
- Releases are not yet code-signed and an automatic secure update mechanism is not yet configured.
- Never include Firebase Admin credentials, service-account keys or other privileged secrets in the desktop package. Backend authorisation must remain enforced by the service.
