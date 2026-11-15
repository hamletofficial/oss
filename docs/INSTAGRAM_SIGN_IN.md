# Instagram professional-account sign-in

The login page uses Meta's Instagram API with Instagram Login. The flow requests only `instagram_business_basic`, exchanges the authorization code on the server, reads the Instagram professional account ID, and signs in to Firebase with a custom token. Instagram access tokens are not returned to the browser or stored.

## Meta app setup

1. In Meta for Developers, add the Instagram product and configure Instagram Login for Business.
2. Set the valid OAuth redirect URI to `https://www.hamlet-ai.co.uk/login.html`.
3. Use the Meta app's Instagram App ID as the Firebase Functions parameter `INSTAGRAM_CLIENT_ID`.
4. Store the Instagram App Secret in Secret Manager as `INSTAGRAM_CLIENT_SECRET`; do not put it in client config or source control.
5. Request only `instagram_business_basic`. Test with Business or Creator professional accounts whose users have a role on the app. Meta App Review/Advanced Access (and business verification where required by Meta) may be needed for people outside the app's roles.
6. After setting the parameter and secret, deploy the `default` Functions codebase and Hosting page.

The authorization state is a cryptographically random, single-use Firestore record with a 10-minute lifetime. Expired records are cleaned up in bounded batches when a new sign-in starts.

## Firebase identity and linking

Firebase user IDs are stable as `instagram_<Instagram user ID>`. Instagram does not provide an email address through this login permission, so an Instagram-only user has no verified email for email-based account matching. The flow does not merge an Instagram identity into an existing Google, Microsoft, Facebook, LinkedIn, or password account. Existing provider sign-in behavior remains in place; users who need one Firebase account across providers need a separately authenticated linking flow.

## Region migration

The root `default` Functions codebase and its callable clients now target `europe-west1`. Source configuration does not move already-deployed functions. Before production rollout, inspect the live deployed inventory and migrate each existing function from its current region. During a regional trigger migration, old and new event-triggered instances can both receive events until the old instance is removed, so confirm idempotency and event side effects before each migration. Update external webhook URLs, including the Stripe endpoint, to the new regional URL after the new function is deployed and verified.
