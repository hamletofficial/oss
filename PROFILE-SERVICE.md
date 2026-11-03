# Shared Profile Service Convention

## Canonical profile record

The canonical public profile document is `publicProfiles/{uid}` in Firebase Firestore. Profile field names remain camelCase, including `firstName`, `lastName`, `imageDataUrl`, `bio`, `isPublic`, and `incognito`.

## Shared client module

Use `/profile-service.js` for browser-side profile reads and ordinary profile updates.

- `getProfile(uid)` returns `{ exists, data }`.
- `listPublicProfiles()` returns public profile entries as `{ uid, data }`.
- `saveProfile(uid, fields)` merges the editable profile fields.
- `updateProfile(uid, fields)` merges profile metadata or individual profile fields.
- `watchProfile(uid, onChange, onError)` subscribes to live updates for one profile document.

The module normalizes saved first and last names and the `imageDataUrl` field. Pages should use this module rather than independently reimplementing ordinary profile access. Existing fallback reads may remain temporarily for graceful compatibility during migration.

## Security boundary

`onfidoVerified` is controlled by the identity-verification workflow and Firestore security rules. The shared client service deliberately removes this field from ordinary client writes. Never treat this client-side guard as a replacement for server-side verification or Firestore rules.

The email-based verified tick is a separate presentation rule and must not be changed to depend on `onfidoVerified`.

## Naming convention

- HTML pages: `kebab-case.html` (retain existing public URLs such as `editprofile.html`).
- Shared JavaScript: `kebab-case.js`.
- Shared CSS: `kebab-case.css`.
- JavaScript variables and Firestore fields: `camelCase`.
- Use a versioned query string when changing a cached shared browser module, for example `/profile-service.js?v=20261010-2`.

## Migrated client pages

The shared service is now used by `editprofile.html`, `settings.html`, `login.html`, `header-profile.js`, `profile.html`, `directory.html`, `members.html`, `archive.html`, `messages.html`, `app/public/dashboard.html`, and `app/public/live.html`.

Page-specific workflows (messages, archive records, listings, broker reviews, MFA, and identity verification) remain owned by their respective pages or trusted backend workflows.
