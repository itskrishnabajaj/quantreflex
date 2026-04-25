/**
 * webhook.js — Razorpay webhook handler for QuantReflex.
 *
 * POST /api/webhooks/razorpay
 *
 * Handles subscription lifecycle events:
 *   - subscription.activated    → grant Premium+
 *   - subscription.charged      → confirm Premium+, update billing date
 *   - subscription.cancelled    → revoke Premium+ at period end
 *   - subscription.halted       → revoke Premium+ immediately
 *   - payment.failed            → log warning
 *
 * Security:
 *   - Verifies Razorpay webhook signature (HMAC SHA256)
 *   - Requires raw body for signature verification
 *   - Idempotent — safe to receive same event multiple times
 */

const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const firestore = require('../services/firebaseAdmin');

var WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;
if (!WEBHOOK_SECRET) {
  console.warn('[webhook] RAZORPAY_WEBHOOK_SECRET not set. Webhook signature verification will fail.');
}

/* ------------------------------------------------------------------ */
/*  Signature verification                                            */
/* ------------------------------------------------------------------ */

function _verifyWebhookSignature(rawBody, signature) {
  if (!WEBHOOK_SECRET || !signature || !rawBody) return false;
  try {
    var expected = crypto
      .createHmac('sha256', WEBHOOK_SECRET)
      .update(rawBody)
      .digest('hex');
    return crypto.timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(signature, 'hex')
    );
  } catch (err) {
    console.error('[webhook] signature verification error:', err.message);
    return false;
  }
}

/* ------------------------------------------------------------------ */
/*  Find user by subscription ID                                      */
/* ------------------------------------------------------------------ */

async function _findUserBySubscription(subscriptionId) {
  var db = firestore.db;
  /* Look up which user owns this subscription via payments collection */
  try {
    var paymentsSnap = await db.collection('payments')
      .where('subscriptionId', '==', subscriptionId)
      .limit(1)
      .get();
    if (!paymentsSnap.empty) {
      return paymentsSnap.docs[0].data().uid;
    }
  } catch (err) {
    console.warn('[webhook] payments collection lookup failed:', err.message);
  }

  /* Fallback: scan users collection for matching subscriptionId */
  try {
    var usersSnap = await db.collection('users')
      .where('lastPremiumPlusPaymentId', '!=', null)
      .limit(500)
      .get();
    for (var i = 0; i < usersSnap.docs.length; i++) {
      var data = usersSnap.docs[i].data();
      if (data.subscriptionId === subscriptionId ||
          data.lastPremiumPlusSubscriptionId === subscriptionId) {
        return usersSnap.docs[i].id;
      }
    }
  } catch (err) {
    console.warn('[webhook] users fallback lookup failed:', err.message);
  }

  return null;
}

/* ------------------------------------------------------------------ */
/*  Event handlers                                                     */
/* ------------------------------------------------------------------ */

async function _handleSubscriptionActivated(payload) {
  var subscription = payload.subscription && payload.subscription.entity;
  if (!subscription) return;
  var subscriptionId = subscription.id;
  var planId = subscription.plan_id;

  console.log('[webhook] subscription.activated — id:', subscriptionId, 'plan:', planId);

  var uid = await _findUserBySubscription(subscriptionId);
  if (!uid) {
    console.error('[webhook] subscription.activated — NO USER FOUND for subscription:', subscriptionId);
    return;
  }

  var nextBilling = subscription.charge_at
    ? new Date(subscription.charge_at * 1000).toISOString()
    : null;

  await firestore.safeUserUpdate(uid, {
    isPremiumPlus: true,
    premiumPlusStatus: 'active',
    subscriptionId: subscriptionId,
    nextBillingDate: nextBilling,
    isTrial: false
  }, 'webhook:subscription.activated');

  console.log('[webhook] subscription.activated — uid:', uid, 'Premium+ granted');
}

async function _handleSubscriptionCharged(payload) {
  var subscription = payload.subscription && payload.subscription.entity;
  var payment = payload.payment && payload.payment.entity;
  if (!subscription) return;
  var subscriptionId = subscription.id;

  console.log('[webhook] subscription.charged — id:', subscriptionId);

  var uid = await _findUserBySubscription(subscriptionId);
  if (!uid) {
    console.error('[webhook] subscription.charged — NO USER FOUND for subscription:', subscriptionId);
    return;
  }

  var nextBilling = subscription.charge_at
    ? new Date(subscription.charge_at * 1000).toISOString()
    : null;

  /* Determine plan duration from plan notes or subscription */
  var plan = (subscription.notes && subscription.notes.plan) || null;
  var days = plan === 'yearly' ? 365 : 30;
  var newExpiry = Date.now() + days * 24 * 60 * 60 * 1000;

  await firestore.safeUserUpdate(uid, {
    isPremiumPlus: true,
    premiumPlusStatus: 'active',
    premiumPlusExpiry: newExpiry,
    premiumPlusPlan: plan,
    subscriptionId: subscriptionId,
    nextBillingDate: nextBilling,
    lastPremiumPlusPaymentId: payment ? String(payment.id) : null
  }, 'webhook:subscription.charged');

  console.log('[webhook] subscription.charged — uid:', uid, 'expiry renewed to', new Date(newExpiry).toISOString());
}

async function _handleSubscriptionCancelled(payload) {
  var subscription = payload.subscription && payload.subscription.entity;
  if (!subscription) return;
  var subscriptionId = subscription.id;

  console.log('[webhook] subscription.cancelled — id:', subscriptionId);

  var uid = await _findUserBySubscription(subscriptionId);
  if (!uid) {
    console.error('[webhook] subscription.cancelled — NO USER FOUND for subscription:', subscriptionId);
    return;
  }

  /* Don't revoke immediately — let current period expire.
     Mark status as cancelled so frontend can show appropriate messaging. */
  await firestore.safeUserUpdate(uid, {
    premiumPlusStatus: 'cancelled'
  }, 'webhook:subscription.cancelled');

  console.log('[webhook] subscription.cancelled — uid:', uid, 'status set to cancelled, access continues until expiry');
}

async function _handleSubscriptionHalted(payload) {
  var subscription = payload.subscription && payload.subscription.entity;
  if (!subscription) return;
  var subscriptionId = subscription.id;

  console.log('[webhook] subscription.halted — id:', subscriptionId);

  var uid = await _findUserBySubscription(subscriptionId);
  if (!uid) {
    console.error('[webhook] subscription.halted — NO USER FOUND for subscription:', subscriptionId);
    return;
  }

  /* Halted = payment retries exhausted. Revoke access immediately. */
  await firestore.safeUserUpdate(uid, {
    isPremiumPlus: false,
    premiumPlusStatus: 'halted'
  }, 'webhook:subscription.halted');

  console.log('[webhook] subscription.halted — uid:', uid, 'Premium+ REVOKED');
}

async function _handlePaymentFailed(payload) {
  var payment = payload.payment && payload.payment.entity;
  if (!payment) return;

  console.warn('[webhook] payment.failed — id:', payment.id,
    'amount:', payment.amount,
    'error:', payment.error_code, payment.error_description
  );
  /* No immediate action — Razorpay retries automatically.
     If all retries fail, subscription.halted will fire. */
}

/* ------------------------------------------------------------------ */
/*  Main webhook route                                                */
/* ------------------------------------------------------------------ */

router.post('/razorpay', async function (req, res) {
  var signature = req.headers['x-razorpay-signature'];
  var rawBody = req.rawBody;

  if (!rawBody || !signature) {
    console.warn('[webhook] Missing body or signature header');
    return res.status(400).json({ error: 'Missing signature' });
  }

  if (!_verifyWebhookSignature(rawBody, signature)) {
    console.error('[webhook] SIGNATURE VERIFICATION FAILED');
    return res.status(400).json({ error: 'Invalid signature' });
  }

  var event;
  try {
    event = JSON.parse(rawBody);
  } catch (parseErr) {
    console.error('[webhook] Failed to parse webhook body:', parseErr.message);
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  var eventType = event.event;
  var payload = event.payload || {};

  console.log('[webhook] Received event:', eventType, '— id:', event.id || 'unknown');

  try {
    switch (eventType) {
      case 'subscription.activated':
        await _handleSubscriptionActivated(payload);
        break;
      case 'subscription.charged':
        await _handleSubscriptionCharged(payload);
        break;
      case 'subscription.cancelled':
        await _handleSubscriptionCancelled(payload);
        break;
      case 'subscription.halted':
        await _handleSubscriptionHalted(payload);
        break;
      case 'payment.failed':
        await _handlePaymentFailed(payload);
        break;
      default:
        console.log('[webhook] Unhandled event type:', eventType);
    }
  } catch (err) {
    console.error('[webhook] Error processing event ' + eventType + ':', err.message);
    /* Return 200 anyway to prevent Razorpay from retrying.
       We log the error for debugging. */
  }

  /* Always return 200 to acknowledge receipt */
  res.status(200).json({ status: 'ok' });
});

module.exports = router;
