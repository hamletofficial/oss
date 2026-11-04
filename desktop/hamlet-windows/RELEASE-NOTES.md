# Hamlet v1.04.06 — Windows desktop build

Hamlet v1.04.06 introduces Microsoft Azure Artifact Signing (formerly Trusted Signing) into the Windows release pipeline.

## Windows application and security

- Hamlet-branded 64-bit Windows installer for Windows 10 and 11.
- Native Windows notifications for critical-path reminders, with browser notifications as a fallback.
- Electron security controls: context isolation, sandboxing, disabled Node.js integration and HTTPS navigation restrictions.
- Installer digitally signed through Microsoft Azure Artifact Signing with an RFC 3161 trusted timestamp.
- CI validates the Authenticode signature before release publication.
- SHA-256 checksum generated from the final signed installer and published alongside it.

## Install and verify

The expected installer filename is `hamlet-Setup-1.4.6.exe`.

Verify the Authenticode signature in PowerShell:

```powershell
Get-AuthenticodeSignature .\hamlet-Setup-1.4.6.exe | Format-List Status,StatusMessage,SignerCertificate
```

The status must be `Valid` and the signer must identify the verified publishing organisation. Then verify the SHA-256 digest:

```powershell
Get-FileHash .\hamlet-Setup-1.4.6.exe -Algorithm SHA256
Get-Content .\SHA256SUMS.txt
```

Do not install the file if the signature is invalid or the checksum does not match.

## Validation required

- Run automated syntax, security and unit tests.
- Build the x64 NSIS installer on a Windows runner.
- Sign with Azure Artifact Signing and verify Authenticode status before publishing.
- Confirm the published checksum matches the signed installer.
- Complete Windows 10/11 installation, sign-in, notifications, shortcut, upgrade and uninstall acceptance tests.

## Known limitations

- Critical-path reminder checks are page-driven; the pipeline page must be running.
- Secure automatic updates are not yet configured. Code signing verifies publisher identity and file integrity; it does not itself implement update delivery or automatic update validation.
- Automated CI checks do not replace real-device acceptance testing.

For assistance, visit the [Hamlet Support Centre](https://support.hamlet-ai.co.uk/).
