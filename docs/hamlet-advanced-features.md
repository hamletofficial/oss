# Hamlet advanced CRM features

This change set adds owner-scoped transaction history, transaction documents, saved searches and rules-based deal prioritisation to `/app/hamlet/index.html`.

## Data model

- `hamletDealEvents`: created by the trusted `recordHamletDealHistory` Cloud Function when a deal is created, changed or deleted. Client SDK writes are denied; event documents are immutable to clients.
- `hamletDocuments`: private metadata for documents stored under `hamletDocuments/{uid}/{dealId}/{documentId}/{fileName}` in Firebase Storage.
- `hamletSavedSearches`: private saved filters and the last set of matching deal IDs used to detect new matches when a broker opens Hamlet.
- Deal prioritisation is deliberately rules-based and transparent. It uses saved deal fields, stage, linked deadlines and update recency; it does not send deal data to an external AI provider.

## Deploy

From the repository root, after reviewing the target Firebase project and credentials:

```sh
firebase deploy --only firestore:rules,storage,functions:recordHamletDealHistory --project wale-491805
```

This deploys the rules and the server-side history trigger. The web workspace is committed to `main`; verify the hosting pipeline used for `hamlet-ai.co.uk` separately, because a GitHub commit does not itself prove that the production page or Firebase configuration is live.

## Automated checks

GitHub Actions runs:
- JavaScript syntax and feature/security-hook smoke tests.
- A Playwright browser flow using a mock Firebase layer to exercise deal creation, saved-search creation and document upload UI.
- Firestore and Storage rule tests against Firebase emulators, including owner isolation, immutable history, saved-search ownership and transaction-file access.

These are automated code/security checks, not a full authenticated browser test against production Firebase. Confirm the workflow run and perform a signed-in smoke test after deployment.
