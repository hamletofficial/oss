# Hamlet v1.04.04 — Windows desktop build

Hamlet v1.04.04 updates the Windows desktop branding with the refreshed orbital h icon and aligns the installer version with the platform release.

## Windows application

- Dedicated Windows desktop window for the live Hamlet platform.
- Hamlet-branded installer with Start menu and desktop shortcuts.
- Native Windows notifications for critical-path reminders, with browser notifications as a fallback.
- Electron security controls: context isolation, sandboxing, disabled Node.js integration and HTTPS navigation restrictions.
- Automated syntax, security and packaging checks.
- SHA-256 checksum generated for the installer.

## Install and verify

The expected installer filename is `hamlet-Setup-1.4.4.exe`.

After the build artifact is available, download both the installer and `SHA256SUMS.txt`. In PowerShell, run:

```powershell
Get-FileHash .\hamlet-Setup-1.4.4.exe -Algorithm SHA256
Get-Content .\SHA256SUMS.txt
```

Compare the computed hash with the installer entry in the checksum file. Do not install if they differ.

## Validation required before publication

- Run the automated syntax and security test suite.
- Build the installer on a Windows runner and verify its size and SHA-256 checksum.
- Install on Windows 10/11 and test launch, sign-in, sign-out, notifications, shortcuts, upgrade and uninstall.
- Verify enabled identity-provider sign-in with real accounts.
- Confirm the published checksum matches the exact installer offered for download.

## Known limitations

- Critical-path reminder checks are page-driven. The pipeline page must be running; reminders are not scheduled while the application is fully closed.
- The installer is not yet code-signed.
- Secure automatic updates are not yet configured.
- Automated CI checks do not replace real-device acceptance testing.

For assistance, visit the [Hamlet Support Centre](https://support.hamlet-ai.co.uk/).
