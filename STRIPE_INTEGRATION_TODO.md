# Stripe organisation subscription setup

## Values to Replace

The code is wired to Firebase secret parameters. These values are intentionally not committed to the repository.

**Files using the secret values:**
- [functions/hamlet-organisation-billing.js](functions/hamlet-organisation-billing.js)

| Field | Current Value | What to Set |
|-------|--------------|-------------|
| `STRIPE_SECRET_KEY` | Not configured | The Stripe API secret key for the same mode (test or live) as the organisation Price. |
| `STRIPE_ORGANISATION_PRICE_ID` | Not configured | A recurring Stripe Price ID for one organisation subscription. One checkout creates one subscription for one organisation. |
| `STRIPE_WEBHOOK_SECRET` | Not configured | The signing secret for the Stripe webhook endpoint below. |

Set each with `firebase functions:secrets:set SECRET_NAME` from the repository root. Do not put secret values in HTML, source files, or `.env` files committed to Git.

## Configured Parameters

**File containing Checkout Session configuration:**
- [functions/hamlet-organisation-billing.js](functions/hamlet-organisation-billing.js)

| Parameter | Configured value |
|-----------|------------------|
| `ui_mode` | `hosted_page` |
| `mode` | `subscription` |
| `billing_address_collection` | `auto` |
| `phone_number_collection.enabled` | `false` |
| `automatic_tax.enabled` | `false` |
| `allow_promotion_codes` | `false` |
| `payment_method_collection` | `always` |
| `submit_type` | `auto` |
| `consent_collection.terms_of_service` | `required` |
| `saved_payment_method_options.payment_method_save` | `enabled` |
| `integration_identifier` | `hosted_mobile_app_0002` |
| `origin_context` | `mobile_app` |
| `success_url` | `https://www.hamlet-ai.co.uk/organisation.html?orgCheckoutSessionId={CHECKOUT_SESSION_ID}` |
| `cancel_url` | `https://www.hamlet-ai.co.uk/invoice.html?organisation=1&checkout=cancelled` |
| `line_items[0].price` | Firebase secret `STRIPE_ORGANISATION_PRICE_ID` |
| `line_items[0].quantity` | `1` |

## Setup and next steps

1. Create and activate a recurring organisation Price in the Stripe Dashboard. The checkout expects one subscription to cover one organisation.
2. Set the three Firebase secrets in the same Stripe mode (test or live).
3. Set the Terms of Service URL in Stripe account business details; Checkout is configured to require terms acceptance.
4. Add a Stripe webhook endpoint at `https://europe-west2-wale-491805.cloudfunctions.net/stripeOrganisationBillingWebhook` and subscribe it to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `customer.subscription.created`, `customer.subscription.updated`, and `customer.subscription.deleted` events. Store the endpoint's signing secret as `STRIPE_WEBHOOK_SECRET`.
5. Deploy the `default` Functions codebase, Hosting files, and the `hamlet-organisations-router` Worker. The Worker checks `resolveOrganisationTenant` for each tenant-host request, so tenant subdomains stop routing once the billing organisation is suspended or erased. Do not treat successful Checkout redirection by itself as proof of payment; the verified webhook record is what authorizes organisation creation.
6. Test in Stripe test mode with a test Price and test API/webhook secrets before switching all three secrets to live mode. Stripe's standard test card is `4242 4242 4242 4242` with any future expiry and any CVC.

The integration creates hosted Checkout Sessions from an authenticated, email-verified Firebase callable. The webhook verifies Stripe signatures and fetches current subscription state to avoid acting on stale event snapshots. A canceled, paused, unpaid, past-due, or collection-paused subscription for a linked organisation suspends its organisation, slug, and directory listing while retaining all tenant data for possible renewal. The Worker stops routing the tenant subdomain while suspended. When Stripe reports the subscription active or trialing again, the webhook restores routing and access. Active and trialing subscriptions retain tenant access. The organisation creation callable atomically consumes one active subscription. Existing organisation memberships route to the tenant dashboard; accepting an invitation and creating a new organisation also route to the tenant dashboard.

The organisation option on `/invoice.html` uses the hosted Checkout Session endpoint so the Firebase user can be tied to the payment. If a separate embedded Stripe Pricing Table is required, create it in Stripe and provide its Pricing Table ID; no organisation Pricing Table ID was present in the repository or supplied with this integration task.

This change requires an active subscription to create an organisation and removes tenant-host routing when billing access ends. Firestore rules already require an active organisation for tenant data access. Deploy the current Functions and Worker code together so the webhook can suspend and later restore the tenant.

Resources: [Stripe Checkout Sessions](https://docs.stripe.com/api/checkout/sessions/create), [Stripe Checkout fulfilment](https://docs.stripe.com/checkout/fulfillment), [Stripe webhooks](https://docs.stripe.com/webhooks), [Firebase Functions secrets](https://firebase.google.com/docs/functions/config-env).
