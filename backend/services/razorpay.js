/**
 * razorpay.js — Razorpay Orders API service for QuantReflex.
 * ONE-TIME PAYMENTS ONLY. No subscriptions. No webhooks.
 */

const crypto = require('crypto');
const Razorpay = require('razorpay');

var RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID;
var RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;

if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
  console.warn('[razorpay] RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET not set. Payments will be unavailable.');
}

var razorpayInstance = null;

function _getRazorpay() {
  if (!razorpayInstance) {
    if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
      throw new Error('Razorpay credentials are not configured.');
    }
    if (RAZORPAY_KEY_SECRET.startsWith('rzp_')) {
      throw new Error('RAZORPAY_KEY_SECRET contains a key_id value. It must be the API secret, not the key ID.');
    }
    razorpayInstance = new Razorpay({
      key_id: RAZORPAY_KEY_ID,
      key_secret: RAZORPAY_KEY_SECRET
    });
  }
  return razorpayInstance;
}

/* ------------------------------------------------------------------ */
/*  Plan → Amount mapping (paise)                                     */
/* ------------------------------------------------------------------ */

var PLAN_AMOUNTS = {
  premium: 9900,     // ₹99 — lifetime
  plus_6m: 29900,    // ₹299 — 6 months
  plus_12m: 49900    // ₹499 — 12 months
};

function getPlanAmount(planType) {
  return PLAN_AMOUNTS[planType] || 0;
}

function isValidPlan(planType) {
  return PLAN_AMOUNTS.hasOwnProperty(planType);
}

/* ------------------------------------------------------------------ */
/*  Create Order                                                      */
/* ------------------------------------------------------------------ */

async function createOrder(amount, receipt, notes) {
  var rzp = _getRazorpay();
  console.log('[razorpay:createOrder] amount:', amount, 'receipt:', receipt);
  var order = await rzp.orders.create({
    amount: amount,
    currency: 'INR',
    receipt: receipt,
    notes: notes || {}
  });
  console.log('[razorpay:createOrder] success orderId:', order.id, 'status:', order.status);
  return {
    orderId: order.id,
    amount: order.amount,
    currency: order.currency
  };
}

/* ------------------------------------------------------------------ */
/*  Verify Payment Signature                                          */
/*  Razorpay order signature: HMAC_SHA256(order_id|payment_id, secret)*/
/* ------------------------------------------------------------------ */

function verifyPaymentSignature(orderId, paymentId, signature) {
  if (!RAZORPAY_KEY_SECRET) return false;
  if (!orderId || !paymentId || !signature) return false;
  try {
    var body = orderId + '|' + paymentId;
    var expected = crypto
      .createHmac('sha256', RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');
    return crypto.timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(signature, 'hex')
    );
  } catch (_) {
    return false;
  }
}

module.exports = {
  createOrder: createOrder,
  verifyPaymentSignature: verifyPaymentSignature,
  getPlanAmount: getPlanAmount,
  isValidPlan: isValidPlan
};
