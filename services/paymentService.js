const crypto = require('crypto');
const Razorpay = require('razorpay');

var RAZORPAY_KEY_ID = 'rzp_live_STanzIgCpSAfL7';
var RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
if (!RAZORPAY_KEY_SECRET) {
  console.warn('RAZORPAY_KEY_SECRET not set. Subscription payments will be unavailable.');
}

var PLAN_IDS = {
  monthly: 'plan_SYT5165ofapoIK',
  yearly: 'plan_SYT68bs2ppUUVD'
};

var PLAN_ID_TO_TYPE = {};
PLAN_ID_TO_TYPE[PLAN_IDS.monthly] = 'monthly';
PLAN_ID_TO_TYPE[PLAN_IDS.yearly] = 'yearly';

var razorpayInstance = null;

function _getRazorpay() {
  if (!razorpayInstance) {
    if (!RAZORPAY_KEY_SECRET) {
      throw new Error('RAZORPAY_KEY_SECRET is not configured.');
    }
    if (RAZORPAY_KEY_SECRET.startsWith('rzp_')) {
      throw new Error('RAZORPAY_KEY_SECRET contains a key_id (starts with rzp_). It must be the API key secret, not the key ID.');
    }
    razorpayInstance = new Razorpay({
      key_id: RAZORPAY_KEY_ID,
      key_secret: RAZORPAY_KEY_SECRET
    });
  }
  return razorpayInstance;
}

async function createPremiumPlusSubscription(plan) {
  var planId = PLAN_IDS[plan];
  if (!planId) {
    throw new Error('Invalid plan. Must be "monthly" or "yearly".');
  }
  var rzp = _getRazorpay();
  console.log('Creating Razorpay subscription for plan:', plan, 'planId:', planId);
  var subscription = await rzp.subscriptions.create({
    plan_id: planId,
    total_count: plan === 'yearly' ? 10 : 120,
    notes: { plan: plan, product: 'PremiumPlus' }
  });
  console.log('Subscription created:', subscription.id, 'status:', subscription.status);
  return {
    subscriptionId: subscription.id,
    plan: plan
  };
}

var VALID_SUBSCRIPTION_STATUSES = ['authenticated', 'active', 'completed'];

async function fetchSubscriptionPlan(subscriptionId) {
  var rzp = _getRazorpay();
  var subscription = await rzp.subscriptions.fetch(subscriptionId);
  var status = subscription && subscription.status;
  if (VALID_SUBSCRIPTION_STATUSES.indexOf(status) === -1) {
    throw new Error('Subscription not in a valid paid state. Status: ' + status + ' (id: ' + subscriptionId + ')');
  }
  var planId = subscription && subscription.plan_id;
  var plan = PLAN_ID_TO_TYPE[planId];
  if (!plan) {
    throw new Error('Subscription plan mismatch or unknown plan_id: ' + planId);
  }
  return plan;
}

function verifySubscriptionSignature(subscriptionId, paymentId, signature) {
  if (!RAZORPAY_KEY_SECRET) return false;
  if (!subscriptionId || !paymentId || !signature) return false;
  try {
    var body = paymentId + '|' + subscriptionId;
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

module.exports = { createPremiumPlusSubscription, fetchSubscriptionPlan, verifySubscriptionSignature };
