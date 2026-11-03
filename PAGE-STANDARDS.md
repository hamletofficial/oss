# Hamlet HTML Page Standards

## Shared animated background

HTML pages should load `/hamlet-background.js` to use the animated network background shown on `/members.html`.

- Exclude the two landing pages: `/index.html` and `/app/hamlet/index.html`.
- Exclude all pages in `/app/public/`.
- `/members.html` retains its existing particles.js implementation; the shared script automatically skips that page.
- Keep the content panels readable and interactive above the background effect.

## Branding

Do not add a separate fixed `hamlet` title or badge. Retain each page's existing title and header branding without overlays or duplicates.
