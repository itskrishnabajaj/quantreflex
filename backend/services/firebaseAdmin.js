/**
 * firebaseAdmin.js — Firebase Admin, Firestore, and Auth logic for QuantReflex.
 * Extracted from the previous monolithic aiService.js.
 * All writes use merge:true. All operations are wrapped in try/catch.
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
/*  Premium checks                                                    */
/* ------------------------------------------------------------------ */

async function isUserPremium(uid) {
  try {
    var doc = await db.collection('users').doc(uid).get();
    if (!doc.exists) return false;
    var data = doc.data();
    if (data.isPremium === true || data.premiumUser === true || data.hasPaid === true || data.isEarlyUser === true) return true;
    if (data.isTrial === true) {
      var trialEndMs = _toExpiryMillis(data.trialEnd);
      return trialEndMs > 0 && trialEndMs >= Date.now();
    }
    return false;
  } catch (err) {
    console.error('Premium lookup failed for uid ' + uid + ':', err.message);
    throw new AIServiceError('ENTITLEMENT_ERROR', 'Unable to verify subscription status. Please try again.', true);
  }
}

async function isUserPremiumPlus(uid) {
  try {
    var doc = await db.collection('users').doc(uid).get();
    if (!doc.exists) return false;
    var data = doc.data();
    if (data.isPremiumPlus !== true) return false;
    var expiryMs = _toExpiryMillis(data.premiumPlusExpiry);
    if (expiryMs > 0 && expiryMs < Date.now()) {
      try {
        await safeUserUpdate(uid, { isPremiumPlus: false, premiumPlusStatus: 'expired' }, 'isUserPremiumPlus:expiry');
      } catch (expiryErr) {
        console.error('[firestore:isUserPremiumPlus] expiry revocation write failed (uid: ' + uid + '):', expiryErr.message);
      }
      return false;
    }
    return true;
  } catch (err) {
    console.error('[firestore:isUserPremiumPlus] lookup failed (uid: ' + uid + '):', err.message);
    throw new AIServiceError('ENTITLEMENT_ERROR', 'Unable to verify subscription status. Please try again.', true);
  }
}

/* ------------------------------------------------------------------ */
/*  Premium+ unlock (transactional)                                   */
/* ------------------------------------------------------------------ */

async function unlockPremiumPlus(uid, plan, paymentId, subscriptionId) {
  var days = plan === 'yearly' ? 365 : 30;
  var expiry = Date.now() + days * 24 * 60 * 60 * 1000;
  var paymentRef = db.collection('payments').doc(String(paymentId));
  var userRef = db.collection('users').doc(uid);
  var finalExpiry = expiry;

  await db.runTransaction(async function (tx) {
    var paymentDoc = await tx.get(paymentRef);
    if (paymentDoc.exists) {
      var existing = paymentDoc.data();
      if (existing.uid !== uid) {
        console.error('[firestore:unlockPremiumPlus] PAYMENT_REPLAY detected (uid: ' + uid + ', paymentId: ' + paymentId + ')');
        throw new AIServiceError('PAYMENT_REPLAY', 'Payment already used by another account.', false);
      }
      finalExpiry = existing.expiry || expiry;
      tx.set(userRef, {
        isPremiumPlus: true, premiumPlusPlan: existing.plan || plan,
        premiumPlusExpiry: finalExpiry, premiumPlusStatus: 'active',
        lastPremiumPlusPaymentId: String(paymentId), updatedAt: new Date().toISOString()
      }, { merge: true });
      return;
    }
    var paymentDoc2 = { uid: uid, plan: plan, expiry: expiry, claimedAt: Date.now() };
    if (subscriptionId) paymentDoc2.subscriptionId = String(subscriptionId);
    tx.create(paymentRef, paymentDoc2);
    tx.set(userRef, {
      isPremiumPlus: true, premiumPlusPlan: plan,
      premiumPlusExpiry: expiry, premiumPlusStatus: 'active',
      lastPremiumPlusPaymentId: String(paymentId), updatedAt: new Date().toISOString()
    }, { merge: true });
  });

  console.log('[firestore:unlockPremiumPlus] success (uid: ' + uid + ', plan: ' + plan + ', expiry: ' + new Date(finalExpiry).toISOString() + ')');
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

module.exports = {
  db: db, admin: admin, AIServiceError: AIServiceError,
  verifyIdToken: verifyIdToken, isUserPremium: isUserPremium,
  isUserPremiumPlus: isUserPremiumPlus, unlockPremiumPlus: unlockPremiumPlus,
  safeUserUpdate: safeUserUpdate,
  checkWordProblemQuota: checkWordProblemQuota, consumeWordProblemQuota: consumeWordProblemQuota,
  trackExplanationUsage: trackExplanationUsage, trackInsightsUsage: trackInsightsUsage,
  clearStudyPlanCache: clearStudyPlanCache,
  _hashString: _hashString, _shuffleInPlace: _shuffleInPlace, STUDY_PLAN_TTL_DAYS: STUDY_PLAN_TTL_DAYS
};
