# Companies House organisation verification

Hamlet verifies UK company registration details server-side through the Companies House Public Data API.

## Configure the API key

1. Register a **live API key** application in the [Companies House Developer Hub](https://developer.company-information.service.gov.uk/).
2. Create an API key client for the application.
3. Set the Firebase Functions secret in the Hamlet project:

```bash
firebase functions:secrets:set COMPANIES_HOUSE_API_KEY --project wale-491805
```

Paste the API key when prompted. Do not put it in source code, browser configuration, GitHub Actions logs, or a client-side environment variable.

## Deploy

After setting the secret, deploy the organisation functions:

```bash
firebase deploy --only functions --project wale-491805
```

The `submitOrganisationVerification` callable is deployed in `europe-west2` and declares `COMPANIES_HOUSE_API_KEY` as a bound secret.

## Verification behaviour

- The callable requires an authenticated, email-verified organisation owner or administrator.
- It validates the UK company number and queries `GET /company/{companyNumber}` over HTTPS.
- It derives the evidence URL itself from the validated company number; it never fetches a caller-provided URL.
- It compares a normalised submitted legal name with the registry name and checks that the registry status is `active`.
- The registry result, source, registered name/number, status, type, incorporation date and check timestamp are stored on the private `organisationVerificationRequests/{organisationId}` record.
- A successful match remains **pending** until a Hamlet platform administrator reviews and approves it. A name mismatch or non-active company is flagged for manual review; it is not automatically rejected.
- Each organisation can initiate one registry lookup per minute, including failed attempts, to protect the Companies House API quota.\n- API failures and invalid credentials fail closed: the request is not submitted.

A registry match confirms that the public register returns the submitted company identity and active status. It does not establish that the submitting user is authorised to represent the company. Hamlet's reviewer must still assess representative authority before approval.

## Manual verification scope

This integration currently automates UK Companies House company-profile checks. Other legal forms or overseas registries require a separate verification route and must not be represented as Companies House-verified.
