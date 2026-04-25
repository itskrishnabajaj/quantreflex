/**
 * payment.js — Razorpay one-time payment routes for QuantReflex.
 * POST /api/payment/create-order
 * POST /api/payment/verify-payment
 *
 * No subscriptions. No webhooks. Orders API only.
 */

const express = require('express');
const router = express.Router();
const { authMiddleware, formatError } = require('../middleware/auth');
const firestore = require('../services/firebaseAdmin');
const razorpay = require('../services/razorpay');

/* ------------------------------------------------------------------ */
/*  POST /create-order                                                */
/*  Authenticated. Creates a Razorpay order for the given plan.       */
/* ------------------------------------------------------------------ */

router.post('/create-order', authMiddleware, async function (req, res) {
  try {
    var plan = req.body && req.body.plan;

    if (!razorpay.isValidPlan(plan)) {
      return res.status(400).json({
        error: { code: 'BAD_REQUEST', message: 'Invalid plan. Must be "premium", "plus_6m", or "plus_12m".', retryable: false }
      });
    }

    var amount = razorpay.getPlanAmount(plan);
    var receipt = 'rcpt_' + req.userId + '_' + Date.now();
    var notes = { userId: req.userId, plan: plan };

    var order = await razorpay.createOrder(amount, receipt, notes);
    console.log('[payment:create-order] userId:', req.userId, 'plan:', plan, 'orderId:', order.orderId);

    res.json({
      orderId: order.orderId,
      amount: order.amount,
      currency: order.currency,
      plan: plan
    });
  } catch (err) {
    console.error('[payment:create-order] ERROR userId:', req.userId, 'err:', err.message);
    var userMsg = 'Could not start payment. Please try again.';
    if (err.statusCode && err.error && err.error.description) {
      userMsg = err.error.description;
    }
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: userMsg, retryable: true } });
  }
});

/* ------------------------------------------------------------------ */
/*  POST /verify-payment                                              */
/*  Authenticated. Verifies Razorpay signature, unlocks access.       */
/* ------------------------------------------------------------------ */

router.post('/verify-payment', authMiddleware, async function (req, res) {
  try {
    var body = req.body || {};
    var orderId = typeof body.orderId === 'string' ? body.orderId.trim() : '';
    var paymentId = typeof body.paymentId === 'string' ? body.paymentId.trim() : '';
    var signature = typeof body.signature === 'string' ? body.signature.trim() : '';
    var plan = typeof body.plan === 'string' ? body.plan.trim() : '';

    if (!orderId || !paymentId || !signature || !plan) {
      return res.status(400).json({
        error: { code: 'BAD_REQUEST', message: 'Missing required fields: orderId, paymentId, signature, plan.', retryable: false }
      });
    }

    if (!razorpay.isValidPlan(plan)) {
      return res.status(400).json({
        error: { code: 'BAD_REQUEST', message: 'Invalid plan.', retryable: false }
      });
    }

    /* Verify signature using RAZORPAY_KEY_SECRET (server-side only) */
    var valid = razorpay.verifyPaymentSignature(orderId, paymentId, signature);
    if (!valid) {
      console.error('[payment:verify] SIGNATURE_INVALID userId:', req.userId, 'orderId:', orderId);
      return res.status(400).json({
        error: { code: 'SIGNATURE_INVALID', message: 'Payment verification failed. Please contact support.', retryable: false }
      });
    }

    console.log('[payment:verify] signature OK userId:', req.userId, 'plan:', plan, 'paymentId:', paymentId);

    /* Unlock access in Firestore (transactional, prevents duplicates) */
    var expiry = await firestore.unlockPremium(req.userId, plan, paymentId, orderId);

    console.log('[payment:verify] SUCCESS userId:', req.userId, 'plan:', plan, 'expiry:', expiry ? new Date(expiry).toISOString() : 'lifetime');
    res.json({ success: true, expiry: expiry, plan: plan });
  } catch (err) {
    console.error('[payment:verify] ERROR userId:', req.userId, 'err:', err.message);
    if (err instanceof firestore.AIServiceError && err.code === 'PAYMENT_REPLAY') {
      return res.status(409).json({
        error: { code: 'PAYMENT_REPLAY', message: err.message, retryable: false }
      });
    }
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Could not activate access. Please contact support.', retryable: false }
    });
  }
});

module.exports = router;
