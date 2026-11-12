// Stripe-hosted subscription checkout for Hamlet Organisations.
// Stripe credentials and the organisation Price ID are configured as Firebase secrets.
const crypto = require("crypto");
const admin = require("firebase-admin");
const {defineSecret} = require("firebase-functions/params");
const {HttpsError, onCall, onRequest} = require("firebase-functions/v2/https");
const {getFirestore, FieldValue} = require("firebase-admin/firestore");

const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");
const stripeWebhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET");
const organisationPriceId = defineSecret("STRIPE_ORGANISATION_PRICE_ID");
const REGION = "europe-west2";
const SITE_ORIGIN = "https://www.hamlet-ai.co.uk";
const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing"]);
function subscriptionIsEntitled(subscription) {
  return ACTIVE_SUBSCRIPTION_STATUSES.has(subscription.status) && !subscription.pause_collection;
}

function requireVerifiedUser(request) {
  if (!request.auth || !request.auth.uid) throw new HttpsError("unauthenticated", "Sign in to continue.");
  if (request.auth.token.email_verified !== true) throw new HttpsError("failed-precondition", "Verify your email address first.");
  return {uid: request.auth.uid, email: String(request.auth.token.email || "").trim().toLowerCase()};
}

function db() {
  try { admin.app(); } catch (_) { admin.initializeApp(); }
  return getFirestore(admin.app());
}

async function stripeFetch(path, options) {
  const response = await fetch("https://api.stripe.com/v1/" + path, {
    ...options,
    headers: {
      Authorization: "Bearer " + stripeSecretKey.value(),
      ...(options && options.headers || {}),
    },
  });
  const body = await response.json();
  if (!response.ok) {
    const stripeError = body && body.error || {};
    console.error("Stripe API request failed:", {
      status: response.status,
      requestId: response.headers.get("request-id") || null,
      type: stripeError.type || null,
      code: stripeError.code || null,
      parameter: stripeError.param || null,
      message: stripeError.message || null,
    });
    throw new HttpsError("unavailable", "Secure checkout is temporarily unavailable. Please try again later.");
  }
  return body;
}

async function suspendUnpaidOrganisation(database, subscription, organisationId) {
  const organisationRef = database.collection("organisations").doc(organisationId);
  const organisation = (await organisationRef.get()).data();
  const now = FieldValue.serverTimestamp();
  const effectiveStatus = subscription.pause_collection ? "paused" : (subscription.status || "canceled");
  const writes = [
    database.collection("organisationBilling").doc(organisationId).set({
      organisationId,
      subscriptionId: subscription.id,
      status: effectiveStatus,
      updatedAt: now,
    }, {merge: true}),
    organisationRef.set({
      status: "suspended",
      billingStatus: effectiveStatus,
      billingSuspendedAt: now,
      updatedAt: now,
    }, {merge: true}),
    database.collection("organisationDirectory").doc(organisationId).set({
      status: "suspended",
      isPublic: false,
      updatedAt: now,
    }, {merge: true}),
  ];
  if (organisation && organisation.slug) {
    writes.push(database.collection("organisationSlugs").doc(organisation.slug).set({
      status: "suspended",
      updatedAt: now,
    }, {merge: true}));
  }
  await Promise.all(writes);
}

async function recordStripeSubscription(database, subscription) {
  if (!subscription.id || !subscription.metadata ||
      subscription.metadata.hamlet_flow !== "organisation_subscription" ||
      !subscription.metadata.firebase_uid) return;

  const subscriptionRef = database.collection("organisationStripeSubscriptions").doc(subscription.id);
  const current = (await subscriptionRef.get()).data() || {};
  const stripeStatus = subscription.status || "canceled";
  const status = subscription.pause_collection ? "paused" : stripeStatus;
  await subscriptionRef.set({
    firebaseUid: subscription.metadata.firebase_uid,
    customerId: typeof subscription.customer === "string" ? subscription.customer : null,
    status,
    stripeStatus,
    pausedCollection: !!subscription.pause_collection,
    updatedAt: FieldValue.serverTimestamp(),
  }, {merge: true});

  const billing = await database.collection("organisationBilling")
    .where("subscriptionId", "==", subscription.id).limit(1).get();
  const organisationId = current.organisationId || (!billing.empty && billing.docs[0].id);
  if (subscriptionIsEntitled(subscription)) {
    if (organisationId) {
      await database.collection("organisationBilling").doc(organisationId).set({
        organisationId,
        subscriptionId: subscription.id,
        status,
        updatedAt: FieldValue.serverTimestamp(),
      }, {merge: true});
      const organisationRef = database.collection("organisations").doc(organisationId);
      await organisationRef.set({
        status: "active",
        billingStatus: "active",
        billingSuspendedAt: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      }, {merge: true});
      const organisation = (await organisationRef.get()).data();
      if (organisation && organisation.slug) {
        await database.collection("organisationSlugs").doc(organisation.slug).set({status: "active", updatedAt: FieldValue.serverTimestamp()}, {merge: true});
        await database.collection("organisationDirectory").doc(organisationId).set({status: "active", updatedAt: FieldValue.serverTimestamp()}, {merge: true});
      }
    }
    return;
  }

  // A pre-purchase subscription has no tenant to suspend.
  if (organisationId) await suspendUnpaidOrganisation(database, subscription, organisationId);
}

exports.createOrganisationCheckoutSession = onCall({
  region: REGION,
  timeoutSeconds: 30,
  memory: "256MiB",
  secrets: [stripeSecretKey, organisationPriceId],
}, async (request) => {
  const user = requireVerifiedUser(request);
  const priceId = organisationPriceId.value();
  if (!priceId || !/^price_[A-Za-z0-9]+$/.test(priceId)) {
    throw new HttpsError("failed-precondition", "Organisation subscription pricing is not configured yet.");
  }
  const form = new URLSearchParams();
  const values = {
    mode: "subscription",
    ui_mode: "hosted_page",
    billing_address_collection: "auto",
    "phone_number_collection[enabled]": "false",
    "automatic_tax[enabled]": "false",
    // Only this organisation subscription Checkout flow exposes promotion codes.
    // Stripe validates each code's active state, redemption limit and restrictions.
    allow_promotion_codes: "true",
    payment_method_collection: "always",
    "consent_collection[terms_of_service]": "required",
    "saved_payment_method_options[payment_method_save]": "enabled",
    success_url: SITE_ORIGIN + "/organisations.html?orgCheckoutSessionId={CHECKOUT_SESSION_ID}",
    cancel_url: SITE_ORIGIN + "/invoice.html?organisation=1&checkout=cancelled",
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    client_reference_id: user.uid,
    customer_email: user.email,
    "metadata[hamlet_flow]": "organisation_subscription",
    "metadata[firebase_uid]": user.uid,
    "subscription_data[metadata][hamlet_flow]": "organisation_subscription",
    "subscription_data[metadata][firebase_uid]": user.uid,
  };
  Object.entries(values).forEach(([key, value]) => form.set(key, value));
  const session = await stripeFetch("checkout/sessions", {
    method: "POST",
    headers: {"Content-Type": "application/x-www-form-urlencoded"},
    body: form,
  });
  if (!session.url || !session.id) throw new HttpsError("unavailable", "Stripe did not return a checkout link.");
  return {url: session.url};
});

exports.getMyOrganisationSubscription = onCall({
  region: REGION,
  timeoutSeconds: 15,
  memory: "256MiB",
}, async (request) => {
  const user = requireVerifiedUser(request);
  const database = db();
  const snapshot = await database.collection("organisationStripeSubscriptions")
    .where("firebaseUid", "==", user.uid)
    .get();
  const eligible = snapshot.docs.map((doc) => ({id: doc.id, ...doc.data()}))
    .filter((item) => ACTIVE_SUBSCRIPTION_STATUSES.has(item.status) && !item.organisationId)
    .sort((a, b) => {
      const aTime = a.updatedAt && a.updatedAt.toMillis ? a.updatedAt.toMillis() : 0;
      const bTime = b.updatedAt && b.updatedAt.toMillis ? b.updatedAt.toMillis() : 0;
      return bTime - aTime;
    });
  if (!eligible.length) return {ready: false, consumed: false};
  const subscription = eligible[0];
  const checkoutSnapshot = await database.collection("organisationCheckoutSessions")
    .where("subscriptionId", "==", subscription.id)
    .where("firebaseUid", "==", user.uid)
    .limit(1)
    .get();
  if (checkoutSnapshot.empty) return {ready: false, consumed: false};
  const checkout = checkoutSnapshot.docs[0];
  const checkoutData = checkout.data() || {};
  if (checkoutData.paymentStatus !== "paid" || checkoutData.organisationId) {
    return {ready: false, consumed: !!checkoutData.organisationId};
  }
  return {ready: true, consumed: false, sessionId: checkout.id};
});

exports.getOrganisationCheckoutStatus = onCall({
  region: REGION,
  timeoutSeconds: 15,
  memory: "256MiB",
}, async (request) => {
  const user = requireVerifiedUser(request);
  const sessionId = String(request.data && request.data.sessionId || "");
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) throw new HttpsError("invalid-argument", "Checkout session is invalid.");
  const snap = await db().collection("organisationCheckoutSessions").doc(sessionId).get();
  if (!snap.exists || snap.data().firebaseUid !== user.uid) return {ready: false};
  const record = snap.data();
  const subscription = record.subscriptionId ? await db().collection("organisationStripeSubscriptions").doc(record.subscriptionId).get() : null;
  const subStatus = subscription && subscription.exists ? subscription.data().status : "pending";
  return {ready: record.paymentStatus === "paid" && ["active", "trialing"].includes(subStatus), consumed: !!record.organisationId};
});

exports.resolveOrganisationTenant = onRequest({
  region: REGION,
  timeoutSeconds: 10,
  memory: "128MiB",
}, async (request, response) => {
  response.set("Cache-Control", "no-store, max-age=0");
  if (request.method !== "GET" && request.method !== "HEAD") {
    return response.set("Allow", "GET, HEAD").status(405).send("Method not allowed");
  }
  const slug = String(request.query.slug || "");
  if (!/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/.test(slug)) return response.status(404).end();
  try {
    const slugSnapshot = await db().collection("organisationSlugs").doc(slug).get();
    if (!slugSnapshot.exists || slugSnapshot.data().status !== "active") return response.status(404).end();
    const organisationId = slugSnapshot.data().organisationId;
    if (!organisationId) return response.status(404).end();
    const organisation = await db().collection("organisations").doc(organisationId).get();
    if (!organisation.exists || organisation.data().status !== "active") return response.status(404).end();
    return response.status(204).end();
  } catch (error) {
    console.error("Unable to resolve organisation tenant:", error && error.message);
    return response.status(503).end();
  }
});

function verifySignature(rawBody, signatureHeader, secret) {
  const parts = String(signatureHeader || "").split(",");
  const timestamp = parts.find(part => part.startsWith("t="));
  const signatures = parts.filter(part => part.startsWith("v1=")).map(part => part.slice(3));
  if (!timestamp || !signatures.length) return false;
  const time = Number(timestamp.slice(2));
  if (!Number.isFinite(time) || Math.abs(Date.now() / 1000 - time) > 300) return false;
  const expected = crypto.createHmac("sha256", secret).update(timestamp.slice(2) + ".").update(rawBody).digest();
  return signatures.some(signature => {
    if (!/^[a-f0-9]{64}$/i.test(signature)) return false;
    const received = Buffer.from(signature, "hex");
    return received.length === expected.length && crypto.timingSafeEqual(received, expected);
  });
}

exports.stripeOrganisationBillingWebhook = onRequest({
  region: REGION,
  timeoutSeconds: 30,
  memory: "256MiB",
  secrets: [stripeWebhookSecret, stripeSecretKey],
}, async (request, response) => {
  if (request.method !== "POST") return response.status(405).send("Method not allowed");
  const rawBody = request.rawBody;
  if (!Buffer.isBuffer(rawBody) || !verifySignature(rawBody, request.get("stripe-signature"), stripeWebhookSecret.value())) {
    return response.status(400).send("Invalid Stripe signature");
  }
  let event;
  try { event = JSON.parse(rawBody.toString("utf8")); }
  catch (_) { return response.status(400).send("Invalid event"); }

  try {
    const database = db();
    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      const session = event.data && event.data.object || {};
      if (session.mode === "subscription" && session.metadata && session.metadata.hamlet_flow === "organisation_subscription" && session.client_reference_id) {
        const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription && session.subscription.id;
        const paid = session.payment_status === "paid" || session.payment_status === "no_payment_required";
        await database.collection("organisationCheckoutSessions").doc(session.id).set({
          firebaseUid: session.client_reference_id,
          subscriptionId: subscriptionId || null,
          customerId: typeof session.customer === "string" ? session.customer : null,
          paymentStatus: paid ? "paid" : "pending",
          checkoutStatus: session.status || "complete",
          updatedAt: FieldValue.serverTimestamp(),
        }, {merge: true});
        if (subscriptionId) {
          const sub = await stripeFetch("subscriptions/" + encodeURIComponent(subscriptionId), {method: "GET"});
          await recordStripeSubscription(database, sub);
        }
      }
    } else if (event.type && event.type.startsWith("customer.subscription.")) {
      const eventSubscription = event.data && event.data.object || {};
      const sub = eventSubscription.id ? await stripeFetch("subscriptions/" + encodeURIComponent(eventSubscription.id), {method: "GET"}) : {};
      if (sub.id && sub.metadata && sub.metadata.hamlet_flow === "organisation_subscription" && sub.metadata.firebase_uid) {
        await recordStripeSubscription(database, sub);
      }
    }
    return response.status(200).json({received: true});
  } catch (error) {
    console.error("Unable to process organisation billing webhook:", error && error.message);
    return response.status(500).send("Webhook processing failed");
  }
});
