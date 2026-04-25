/**
 * auth.js — Authentication, rate limiting, and premium gating middleware.
 *
 * Uses checkAccess() for unified entitlement — no subscription tiers.
 */

const firestore = require('../services/firebaseAdmin');

/* ------------------------------------------------------------------ */
/*  Rate limiting (in-memory, per-user)                               */
/* ------------------------------------------------------------------ */

var rateLimitStore = {};
var RATE_WINDOW_MS = 60 * 1000;
var RATE_LIMIT_FREE = 5;
var RATE_LIMIT_PREMIUM = 30;

setInterval(function () {
  var now = Date.now();
  for (var key in rateLimitStore) {
    if (now - rateLimitStore[key].windowStart > RATE_WINDOW_MS * 5) {
      delete rateLimitStore[key];
    }
  }
}, 5 * 60 * 1000);

function rateLimitMiddleware(req, res, next) {
  var key = req.userId || req.ip || req.connection.remoteAddress || 'unknown';
  var now = Date.now();
  var isPremium = req.userPremium === true;
  var limit = isPremium ? RATE_LIMIT_PREMIUM : RATE_LIMIT_FREE;

  if (!rateLimitStore[key] || now - rateLimitStore[key].windowStart > RATE_WINDOW_MS) {
    rateLimitStore[key] = { count: 1, windowStart: now };
  } else {
    rateLimitStore[key].count++;
  }

  if (rateLimitStore[key].count > limit) {
    return res.status(429).json({
      error: { code: 'RATE_LIMITED', message: 'Too many requests. Please wait before trying again.', retryable: true }
    });
  }
  next();
}

/* ------------------------------------------------------------------ */
/*  Firebase Auth middleware                                           */
/*  Sets req.userId and req.userPremium (boolean)                     */
/* ------------------------------------------------------------------ */

async function authMiddleware(req, res, next) {
  var authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: { code: 'UNAUTHORIZED', message: 'Authentication required.', retryable: false }
    });
  }

  var idToken = authHeader.substring(7);
  var decoded;
  try {
    decoded = await firestore.verifyIdToken(idToken);
  } catch (tokenErr) {
    console.error('[auth] token verification failed:', tokenErr.message);
    return res.status(401).json({
      error: { code: 'UNAUTHORIZED', message: 'Authentication failed. Please login again.', retryable: false }
    });
  }
  if (!decoded || !decoded.uid) {
    return res.status(401).json({
      error: { code: 'UNAUTHORIZED', message: 'Invalid or expired authentication token.', retryable: false }
    });
  }

  req.userId = decoded.uid;
  try {
    req.userPremium = await firestore.checkAccess(decoded.uid);
  } catch (entitlementErr) {
    return res.status(503).json({ error: formatError(entitlementErr) });
  }
  next();
}

/* ------------------------------------------------------------------ */
/*  Premium gate — single tier, covers everything                     */
/* ------------------------------------------------------------------ */

function premiumGate(featureKey) {
  return function (req, res, next) {
    if (!req.userPremium) {
      return res.status(403).json({
        error: { code: 'PREMIUM_REQUIRED', message: 'This feature requires Premium access.', retryable: false }
      });
    }
    next();
  };
}

/* ------------------------------------------------------------------ */
/*  Error formatting                                                  */
/* ------------------------------------------------------------------ */

function formatError(err) {
  if (err instanceof firestore.AIServiceError) {
    return { code: err.code, message: err.message, retryable: err.retryable };
  }
  return { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred. Try again later.', retryable: true };
}

module.exports = {
  authMiddleware: authMiddleware,
  rateLimitMiddleware: rateLimitMiddleware,
  premiumGate: premiumGate,
  formatError: formatError
};
