/**
 * payment.js — Razorpay subscription routes for QuantReflex.
 * POST /api/subscriptions/create
 * POST /api/subscriptions/verify
 */

const express = require('express');
const router = express.Router();
const { authMiddleware, formatError } = require('../middleware/auth');
const firestore = require('../services/firebaseAdmin');
const paymentService = require('../services/razorpay');

/* ------------------------------------------------------------------ */
/*  Create subscription                                               */
/* ------------------------------------------------------------------ */

router.post('/create', authMiddleware, async function (req, res) {
  try {
    var plan = req.body && req.body.plan;
    if (plan !== 'monthly' && plan !== 'yearly') {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invalid plan. Must be "monthly" or "yearly".', retryable: false } });
    }
    var subscription = await paymentService.createPremiumPlusSubscription(plan);
    console.log('Subscription created for user', req.userId, ':', subscription.subscriptionId);
    res.json(subscription);
  } catch (err) {
    console.error('Create subscription error:', err.message, err.statusCode || '', JSON.stringify(err.error || ''));
    var userMsg = 'Could not start subscription. Please try again.';
    if (err.statusCode && err.error && err.error.description) {
      userMsg = err.error.description;
    } else if (err.message) {
      userMsg = err.message;
    }
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: userMsg, retryable: true } });
  }
});

/* ------------------------------------------------------------------ */
/*  Verify subscription                                               */
/* ------------------------------------------------------------------ */

router.post('/verify', authMiddleware, async function (req, res) {
  try {
    var body = req.body || {};
    var subscriptionId = typeof body.subscriptionId === 'string' ? body.subscriptionId.trim() : '';
    var paymentId = typeof body.paymentId === 'string' ? body.paymentId.trim() : '';
    var signature = typeof body.signature === 'string' ? body.signature.trim() : '';

    if (!subscriptionId || !paymentId || !signature) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Missing required fields: subscriptionId, paymentId, signature.', retryable: false } });
    }

    var valid = paymentService.verifySubscriptionSignature(subscriptionId, paymentId, signature);
    if (!valid) {
      console.error('Subscription signature verification failed for subscription:', subscriptionId);
      return res.status(400).json({ error: { code: 'SIGNATURE_INVALID', message: 'Payment verification failed. Please contact support.', retryable: false } });
    }

    var trustedPlan = await paymentService.fetchSubscriptionPlan(subscriptionId);
    console.log('Subscription verified for user', req.userId, '- plan:', trustedPlan, 'paymentId:', paymentId);

    var expiry = await firestore.unlockPremiumPlus(req.userId, trustedPlan, paymentId, subscriptionId);
    res.json({ success: true, expiry: expiry, plan: trustedPlan });
  } catch (err) {
    console.error('Verify subscription error:', err.message);
    if (err instanceof firestore.AIServiceError && err.code === 'PAYMENT_REPLAY') {
      return res.status(409).json({ error: { code: 'PAYMENT_REPLAY', message: err.message, retryable: false } });
    }
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Could not activate subscription. Please contact support.', retryable: false } });
  }
});

module.exports = router;
