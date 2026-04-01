const crypto = require('crypto');
const Razorpay = require('razorpay');

var RAZORPAY_KEY_ID = 'rzp_live_STanzIgCpSAfL7';
var RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;

var PLAN_AMOUNTS = {
  monthly: 4900,
  yearly: 49900
};

var razorpayInstance = null;

function _getRazorpay() {
  if (!razorpayInstance) {
    if (!RAZORPAY_KEY_SECRET) {
      throw new Error('RAZORPAY_KEY_SECRET is not configured.');
    }
    razorpayInstance = new Razorpay({
      key_id: RAZORPAY_KEY_ID,
      key_secret: RAZORPAY_KEY_SECRET
    });
  }
  return razorpayInstance;
}

async function createPremiumPlusOrder(plan) {
  var amount = PLAN_AMOUNTS[plan];
  if (!amount) {
    throw new Error('Invalid plan. Must be "monthly" or "yearly".');
  }
  var rzp = _getRazorpay();
  var order = await rzp.orders.create({
    amount: amount,
    currency: 'INR',
    receipt: 'premiumplus_' + plan + '_' + Date.now(),
    notes: { plan: plan, product: 'PremiumPlus' }
  });
  return {
    orderId: order.id,
    amount: order.amount,
    currency: order.currency,
    plan: plan
  };
}

async function fetchOrderPlan(orderId) {
  var rzp = _getRazorpay();
  var order = await rzp.orders.fetch(orderId);
  var plan = order && order.notes && order.notes.plan;
  if (plan !== 'monthly' && plan !== 'yearly') {
    throw new Error('Order plan mismatch or missing: ' + plan);
  }
  var expectedAmount = PLAN_AMOUNTS[plan];
  if (order.amount !== expectedAmount) {
    throw new Error('Order amount mismatch for plan ' + plan + ': got ' + order.amount + ' expected ' + expectedAmount);
  }
  return plan;
}

function verifyRazorpaySignature(orderId, paymentId, signature) {
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

module.exports = { createPremiumPlusOrder, fetchOrderPlan, verifyRazorpaySignature };
