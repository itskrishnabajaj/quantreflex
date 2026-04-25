/**
 * firebaseAdmin.js — Firebase Admin, Firestore, and Auth logic for QuantReflex.
 *
 * ENTITLEMENT MODEL (one-time payments only):
 *   premium = true/false
 *   plan = "premium" | "plus_6m" | "plus_12m"
 *   expiry = timestamp (ms) | null (lifetime)
 *
 * NO trial fields. NO subscription fields. NO isPremiumPlus.
 */

const admin = require('firebase-admin');

/* ------------------------------------------------------------------ */
/*  Firebase Admin initialization                                     */
/* ------------------------------------------------------------------ */

if (!admin.apps.length) {
  var firebaseConfig = { projectId: 'quant-reflex-trainer' };
  var serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (serviceAccountJson) {
    try {
      var serviceAccount = JSON.parse(serviceAccountJson);
      firebaseConfig.credential = admin.credential.cert(serviceAccount);
    } catch (parseErr) {
      console.error('FIREBASE_SERVICE_ACCOUNT is not valid JSON:', parseErr.message);
    }
  } else {
    console.warn('FIREBASE_SERVICE_ACCOUNT not set. Firestore and Auth will not work.');
  }
  admin.initializeApp(firebaseConfig);
}
var db = admin.firestore();

/* ------------------------------------------------------------------ */
/*  Error class                                                       */
/* ------------------------------------------------------------------ */

class AIServiceError {
  constructor(code, message, retryable) {
    this.code = code;
    this.message = message;
    this.retryable = retryable || false;
  }
}

/* ------------------------------------------------------------------ */
/*  Auth helpers                                                      */
/* ------------------------------------------------------------------ */

async function verifyIdToken(idToken) {
  return await admin.auth().verifyIdToken(idToken);
}

function _toExpiryMillis(value) {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  if (typeof value.toMillis === 'function') {
    try { return value.toMillis(); } catch (_) { return 0; }
  }
  if (typeof value.toDate === 'function') {
    try { return value.toDate().getTime(); } catch (_) { return 0; }
  }
  if (typeof value === 'string') {
    var parsed = Date.parse(value);
    return isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

async function safeUserUpdate(uid, data, caller) {
  if (!uid) {
    console.error('[firestore:safeUserUpdate] called without uid from ' + (caller || 'unknown'));
    return;
  }
  var payload = Object.assign({}, data);
  payload.updatedAt = new Date().toISOString();
  try {
    await db.collection('users').doc(uid).set(payload, { merge: true });
    console.log('[firestore:safeUserUpdate] success from ' + (caller || 'unknown') + ' (uid: ' + uid + ') fields:', Object.keys(payload).join(', '));
  } catch (err) {
    console.error('[firestore:safeUserUpdate] FAILED from ' + (caller || 'unknown') + ' (uid: ' + uid + '):', err.message);
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/*  checkAccess — Single unified access check                         */
/*                                                                    */
/*  Rules:                                                            */
/*    premium === true AND expiry === null  → lifetime → ALLOW        */
/*    premium === true AND expiry > now     → ALLOW                   */
/*    premium === true AND expiry <= now    → REVOKE, DENY            */
/*    Backward compat: isPremium/hasPaid    → treat as lifetime       */
/*    Everything else                      → DENY                    */
/* ------------------------------------------------------------------ */

async function checkAccess(uid) {
  try {
    var doc = await db.collection('users').doc(uid).get();
    if (!doc.exists) return false;
    var data = doc.data();

    /* New schema: premium + expiry */
    if (data.premium === true) {
      if (!data.expiry) return true; /* lifetime */
      var expiryMs = _toExpiryMillis(data.expiry);
      if (expiryMs > 0 && expiryMs > Date.now()) return true;
      /* Expired — revoke */
      console.log('[firebaseAdmin:checkAccess] premium expired for uid ' + uid + ', revoking');
      try {
        await safeUserUpdate(uid, { premium: false }, 'checkAccess:expiry');
      } catch (revokeErr) {
        console.error('[firebaseAdmin:checkAccess] revocation write failed (uid: ' + uid + '):', revokeErr.message);
      }
      return false;
    }

    /* Backward compatibility: old isPremium/hasPaid flags → treat as lifetime */
    if (data.isPremium === true || data.hasPaid === true) {
      return true;
    }

    return false;
  } catch (err) {
    console.error('[firebaseAdmin:checkAccess] lookup failed for uid ' + uid + ':', err.message);
    throw new AIServiceError('ENTITLEMENT_ERROR', 'Unable to verify access. Please try again.', true);
  }
}

/* ------------------------------------------------------------------ */
/*  unlockPremium — Transactional payment processing                  */
/*                                                                    */
/*  Handles:                                                          */
/*    - Duplicate payment detection (PAYMENT_REPLAY)                  */
/*    - Expiry extension for existing active plans                    */
/*    - Lifetime (null expiry) for "premium" plan                     */
/*    - 6-month / 12-month calculated expiry for plus plans           */
/* ------------------------------------------------------------------ */

function _calculateExpiry(plan, existingExpiry) {
  if (plan === 'premium') return null; /* lifetime */
  var durationMs = plan === 'plus_12m'
    ? 365 * 24 * 60 * 60 * 1000
    : 180 * 24 * 60 * 60 * 1000; /* plus_6m */

  /* If user has active existing expiry, extend from that */
  var baseTime = Date.now();
  if (existingExpiry) {
    var existingMs = _toExpiryMillis(existingExpiry);
    if (existingMs > baseTime) {
      baseTime = existingMs; /* extend from current expiry */
    }
  }
  return baseTime + durationMs;
}

async function unlockPremium(uid, plan, paymentId, orderId) {
  var paymentRef = db.collection('payments').doc(String(paymentId));
  var userRef = db.collection('users').doc(uid);
  var finalExpiry = null;

  await db.runTransaction(async function (tx) {
    /* Check for duplicate payment */
    var paymentDoc = await tx.get(paymentRef);
    if (paymentDoc.exists) {
      var existing = paymentDoc.data();
      if (existing.uid !== uid) {
        console.error('[firestore:unlockPremium] PAYMENT_REPLAY detected — different uid (uid: ' + uid + ', paymentId: ' + paymentId + ')');
        throw new AIServiceError('PAYMENT_REPLAY', 'Payment already used by another account.', false);
      }
      /* Idempotent: same user, same payment — return existing state */
      finalExpiry = existing.expiry || null;
      console.log('[firestore:unlockPremium] idempotent re-verification for uid ' + uid);
      return;
    }

    /* Fetch current user to check existing expiry for extension */
    var userDoc = await tx.get(userRef);
    var userData = userDoc.exists ? userDoc.data() : {};
    finalExpiry = _calculateExpiry(plan, userData.expiry);

    /* Record payment (prevents replay) */
    tx.create(paymentRef, {
      uid: uid,
      plan: plan,
      orderId: String(orderId),
      expiry: finalExpiry,
      amount: plan === 'premium' ? 9900 : (plan === 'plus_12m' ? 49900 : 29900),
      claimedAt: Date.now()
    });

    /* Update user entitlement */
    tx.set(userRef, {
      premium: true,
      plan: plan,
      expiry: finalExpiry,
      lastPaymentId: String(paymentId),
      lastOrderId: String(orderId),
      updatedAt: new Date().toISOString()
    }, { merge: true });
  });

  console.log('[firestore:unlockPremium] success (uid: ' + uid + ', plan: ' + plan + ', expiry: ' + (finalExpiry ? new Date(finalExpiry).toISOString() : 'lifetime') + ')');
  return finalExpiry;
}

/* ------------------------------------------------------------------ */
/*  Usage tracking & quota                                            */
/* ------------------------------------------------------------------ */

var WP_FREE_LIMIT = 5;
var WP_PREMIUM_DAILY = 25;
var usageCache = {};
var usageCacheTimestamps = {};
var USAGE_CACHE_TTL_MS = 10 * 60 * 1000;
var USAGE_CACHE_MAX_SIZE = 1000;

function _evictStaleCacheEntries() {
  var keys = Object.keys(usageCache);
  if (keys.length <= USAGE_CACHE_MAX_SIZE) return;
  var now = Date.now();
  for (var i = 0; i < keys.length; i++) {
    if (now - (usageCacheTimestamps[keys[i]] || 0) > USAGE_CACHE_TTL_MS) {
      delete usageCache[keys[i]];
      delete usageCacheTimestamps[keys[i]];
    }
  }
}

function _normalizeUsageDoc(data) {
  if (data.lastUsedDate && !data.lastUsageDate) data.lastUsageDate = data.lastUsedDate;
  if (data.lastUsedDate && !data.wordProblemsLastDate) data.wordProblemsLastDate = data.lastUsedDate;
  delete data.lastUsedDate;
  if (data.wordProblemsUsedLifetime === undefined) data.wordProblemsUsedLifetime = 0;
  if (data.wordProblemsUsedToday === undefined) data.wordProblemsUsedToday = 0;
  if (data.explanationsUsed === undefined) data.explanationsUsed = 0;
  return data;
}

async function _loadUsage(uid) {
  if (usageCache[uid] && usageCacheTimestamps[uid] && (Date.now() - usageCacheTimestamps[uid] < USAGE_CACHE_TTL_MS)) {
    return usageCache[uid];
  }
  try {
    var doc = await db.collection('users').doc(uid).collection('usage').doc('ai').get();
    if (doc.exists) {
      usageCache[uid] = _normalizeUsageDoc(doc.data());
      usageCacheTimestamps[uid] = Date.now();
      return usageCache[uid];
    }
  } catch (err) { console.warn('Usage read failed:', err.message); }
  try {
    var legacyDoc = await db.collection('users').doc(uid).collection('usage').doc('wordProblems').get();
    if (legacyDoc.exists) {
      var legacy = legacyDoc.data();
      var migrated = {
        wordProblemsUsedLifetime: legacy.wordProblemsUsedLifetime || 0,
        wordProblemsUsedToday: legacy.wordProblemsUsedToday || 0,
        wordProblemsLastDate: legacy.lastUsedDate || null,
        lastUsageDate: legacy.lastUsedDate || null,
        explanationsUsed: 0, insightsGeneratedDate: null
      };
      usageCache[uid] = migrated;
      db.collection('users').doc(uid).collection('usage').doc('ai').set(migrated, { merge: true }).catch(function (e) { console.warn('Legacy migration write failed:', e.message); });
      return migrated;
    }
  } catch (legacyErr) { console.warn('Legacy usage read failed:', legacyErr.message); }
  var fresh = {
    wordProblemsUsedLifetime: 0, wordProblemsUsedToday: 0,
    wordProblemsLastDate: null, lastUsageDate: null,
    explanationsUsed: 0, insightsGeneratedDate: null
  };
  usageCache[uid] = fresh;
  return fresh;
}

async function _saveUsage(uid) {
  var entry = usageCache[uid];
  if (!entry) return;
  usageCacheTimestamps[uid] = Date.now();
  _evictStaleCacheEntries();
  try {
    await db.collection('users').doc(uid).collection('usage').doc('ai').set(entry, { merge: true });
  } catch (err) {
    console.error('[firestore:_saveUsage] write failed (uid: ' + uid + '):', err.message);
    throw err;
  }
}

async function checkWordProblemQuota(uid, isPremium) {
  var entry = await _loadUsage(uid);
  var today = new Date().toDateString();
  if (isPremium) {
    var lastDate = entry.wordProblemsLastDate ? new Date(entry.wordProblemsLastDate).toDateString() : null;
    if (lastDate !== today) { entry.wordProblemsUsedToday = 0; }
    return Math.max(0, WP_PREMIUM_DAILY - entry.wordProblemsUsedToday);
  }
  return Math.max(0, WP_FREE_LIMIT - entry.wordProblemsUsedLifetime);
}

async function consumeWordProblemQuota(uid, isPremium, count) {
  var entry = await _loadUsage(uid);
  var now = new Date();
  var today = now.toDateString();
  var lastDate = entry.wordProblemsLastDate ? new Date(entry.wordProblemsLastDate).toDateString() : null;
  if (isPremium) {
    if (lastDate !== today) { entry.wordProblemsUsedToday = 0; }
    entry.wordProblemsUsedToday += count;
  } else {
    entry.wordProblemsUsedLifetime += count;
  }
  entry.wordProblemsLastDate = now.toISOString();
  entry.lastUsageDate = now.toISOString();
  usageCache[uid] = entry;
  await _saveUsage(uid);
}

async function trackExplanationUsage(uid) {
  var entry = await _loadUsage(uid);
  entry.explanationsUsed = (entry.explanationsUsed || 0) + 1;
  entry.lastUsageDate = new Date().toISOString();
  usageCache[uid] = entry;
  await _saveUsage(uid);
}

async function trackInsightsUsage(uid) {
  var entry = await _loadUsage(uid);
  var today = new Date();
  entry.insightsGeneratedDate = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();
  entry.lastUsageDate = today.toISOString();
  usageCache[uid] = entry;
  await _saveUsage(uid);
}

/* ------------------------------------------------------------------ */
/*  Firestore caching helpers                                         */
/* ------------------------------------------------------------------ */

function _hashString(str) {
  var hash = 5381;
  for (var i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0x7fffffff;
  }
  return hash.toString(36);
}

function _shuffleInPlace(arr) {
  for (var i = arr.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
  }
}

var STUDY_PLAN_TTL_DAYS = 7;

async function clearStudyPlanCache(userId, examDate) {
  try {
    var cacheDocId = userId + '_' + examDate.replace(/[^a-z0-9]/gi, '-');
    await db.collection('aiStudyPlans').doc(cacheDocId).delete();
  } catch (err) { console.warn('Study plan cache clear failed:', err.message); }
}

/* ------------------------------------------------------------------ */
/*  Exports                                                           */
/* ------------------------------------------------------------------ */

module.exports = {
  db: db, admin: admin, AIServiceError: AIServiceError,
  verifyIdToken: verifyIdToken,
  checkAccess: checkAccess,
  unlockPremium: unlockPremium,
  safeUserUpdate: safeUserUpdate,
  checkWordProblemQuota: checkWordProblemQuota,
  consumeWordProblemQuota: consumeWordProblemQuota,
  trackExplanationUsage: trackExplanationUsage,
  trackInsightsUsage: trackInsightsUsage,
  clearStudyPlanCache: clearStudyPlanCache,
  _hashString: _hashString, _shuffleInPlace: _shuffleInPlace,
  STUDY_PLAN_TTL_DAYS: STUDY_PLAN_TTL_DAYS
};
