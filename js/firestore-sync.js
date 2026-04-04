/**
 * firestore-sync.js — Firestore data synchronization layer
 *
 * Syncs localStorage data with Firestore using authenticated user profiles.
 * Uses local caching for fast access and batched updates for efficiency.
 *
 * Firestore structure:
 *   users/{userId}                               (root doc — source of truth)
 *     ├── profile (username, createdAt)
 *     ├── settings
 *     ├── stats (progress data)
 *     ├── quickLinks, customTopics, customFormulas, bookmarks
 *     ├── isPremium, isTrial, trialEnd, hasPaid, isEarlyUser
 *     ├── isPremiumPlus, premiumPlusPlan, premiumPlusExpiry, premiumPlusStatus
 *     ├── updatedAt, createdAt
 *
 *   users/{userId}/practiceSessions/{sessionId}  (subcollection — drill history)
 *
 *   Structured subcollections (dual-written alongside root doc, read-only for now):
 *   users/{userId}/profile/data                  (name, premium flags)
 *   users/{userId}/performance/overall           (derived accuracy, avgTime, streaks)
 *   users/{userId}/practice/data                 (mistakes, savedQuestions)
 *   users/{userId}/ai/usage                      (mirrors usage/ai)
 *   users/{userId}/ai/benchmarks/{fingerprint}   (speed benchmark results — server-written)
 */

var FirestoreSync = (function () {
  var _syncTimer = null;
  var _pendingUpdates = {};
  var _memoryCache = null; /* In-memory cache of the user document */
  var _dataLoaded = false; /* Whether initial load has completed */
  var _drillActive = false; /* Whether a drill is in progress (defers syncing) */
  var _loadedUserId = null; /* UID whose data is currently loaded — detects user switches */
  var _trialExpiryPersistInFlight = false;
  var _flushRetryCount = 0;
  var _flushRetryTimer = null;
  var _flushInFlight = false;
  var SYNC_DEBOUNCE_MS = 2000; /* batch updates every 2 seconds */
  var FLUSH_RETRY_DELAY_MS = 5000;
  var FLUSH_MAX_RETRIES = 2;
  var EARLY_USER_LIMIT = 121;
  var TRIAL_DAYS = 7;

  /* All localStorage keys that store user-specific data */
  var _USER_STORAGE_KEYS = [
    'quant_reflex_settings',
    'quant_reflex_progress',
    'quant_quick_links',
    'quant_custom_topics',
    'quant_custom_formulas',
    'quant_bookmarks',
    'quant_notifications_enabled'
  ];

  /**
   * Remove all user-related keys from localStorage.
   * Prevents data from one user leaking to another session.
   */
  function _clearUserLocalStorage() {
    try {
      for (var i = 0; i < _USER_STORAGE_KEYS.length; i++) {
        localStorage.removeItem(_USER_STORAGE_KEYS[i]);
      }
    } catch (_) {}
  }

  /**
   * Get the Firestore document reference for the current authenticated user.
   * @returns {object|null} Document reference or null
   */
  function _getUserDocRef() {
    if (!FirebaseApp.isReady()) return null;
    var userId = FirebaseApp.getUserId();
    if (!userId) return null;
    var db = FirebaseApp.getDb();
    return db.collection('users').doc(userId);
  }

  /* ---- Structured subcollection helpers (dual-write with single retry) ---- */

  function _subcollectionWrite(collPath, docId, payload, label) {
    var docRef = _getUserDocRef();
    if (!docRef) return;
    var uid = _loadedUserId || 'unknown';
    var ref = docRef.collection(collPath).doc(docId);
    ref.set(payload, { merge: true }).then(function () {
      console.log('[FirestoreSync:' + label + '] write succeeded (uid: ' + uid + ')');
    }).catch(function (err) {
      console.warn('[FirestoreSync:' + label + '] write failed (uid: ' + uid + '), retrying in 3s:', err.message || err);
      setTimeout(function () {
        ref.set(payload, { merge: true }).then(function () {
          console.log('[FirestoreSync:' + label + '] retry succeeded (uid: ' + uid + ')');
        }).catch(function (retryErr) {
          console.error('[FirestoreSync:' + label + '] retry failed (uid: ' + uid + '), data lost for this cycle:', retryErr.message || retryErr);
        });
      }, 3000);
    });
  }

  function _syncPerformanceSubcollection(stats) {
    if (!stats) return;
    var totalAttempted = stats.totalAttempted || 0;
    var totalCorrect = stats.totalCorrect || 0;
    var accuracy = totalAttempted > 0 ? Math.round((totalCorrect / totalAttempted) * 100) : 0;
    var times = Array.isArray(stats.responseTimes) ? stats.responseTimes : [];
    var avgTime = times.length > 0
      ? parseFloat((times.reduce(function (a, b) { return a + b; }, 0) / times.length).toFixed(1))
      : 0;
    _subcollectionWrite('performance', 'overall', {
      totalAttempted: totalAttempted,
      totalCorrect: totalCorrect,
      accuracy: accuracy,
      avgTime: avgTime,
      bestStreak: stats.bestStreak || 0,
      currentStreak: stats.currentStreak || 0,
      dailyStreak: stats.dailyStreak || 0,
      updatedAt: new Date().toISOString()
    }, 'Performance');
  }

  function _syncPracticeSubcollection(stats, bookmarks) {
    var payload = { updatedAt: new Date().toISOString() };
    if (stats && Array.isArray(stats.mistakes)) payload.mistakes = stats.mistakes;
    if (Array.isArray(bookmarks)) payload.savedQuestions = bookmarks;
    if (!payload.mistakes && !payload.savedQuestions) return;
    _subcollectionWrite('practice', 'data', payload, 'Practice');
  }

  function _syncProfileSubcollection(profile, premiumFlags) {
    var payload = { updatedAt: new Date().toISOString() };
    try {
      var currentUser = (typeof Auth !== 'undefined' && Auth.getCurrentUser) ? Auth.getCurrentUser() : null;
      if (currentUser && currentUser.email) payload.email = currentUser.email;
    } catch (_) {}
    if (profile) {
      if (profile.name !== undefined) payload.name = profile.name || '';
      if (profile.username !== undefined && !payload.name) payload.name = profile.username || '';
    }
    if (premiumFlags) {
      if (premiumFlags.isPremium !== undefined) payload.isPremium = !!premiumFlags.isPremium;
      if (premiumFlags.isTrial !== undefined) payload.isTrial = !!premiumFlags.isTrial;
      if (premiumFlags.trialEnd !== undefined) payload.trialEnd = premiumFlags.trialEnd || null;
      if (premiumFlags.isEarlyUser !== undefined) payload.isEarlyUser = !!premiumFlags.isEarlyUser;
      if (premiumFlags.hasPaid !== undefined) payload.hasPaid = !!premiumFlags.hasPaid;
      if (premiumFlags.isPremiumPlus !== undefined) payload.isPremiumPlus = !!premiumFlags.isPremiumPlus;
      if (premiumFlags.premiumPlusPlan !== undefined) payload.premiumPlusPlan = premiumFlags.premiumPlusPlan || null;
    }
    _subcollectionWrite('profile', 'data', payload, 'Profile');
  }

  /* ---- End subcollection helpers ---- */

  /**
   * Reset the sync state when user logs out.
   * Flushes any pending writes for the current user, then clears all
   * in-memory caches AND user-related localStorage keys so no data
   * leaks to the next session.
   */
  function resetSyncState() {
    /* Flush any pending writes for the current user before clearing */
    if (Object.keys(_pendingUpdates).length > 0) {
      _flushUpdates();
    }

    _memoryCache = null;
    _dataLoaded = false;
    _pendingUpdates = {};
    _drillActive = false;
    _loadedUserId = null;
    _flushRetryCount = 0;
    _flushInFlight = false;
    if (_syncTimer) {
      clearTimeout(_syncTimer);
      _syncTimer = null;
    }
    if (_flushRetryTimer) {
      clearTimeout(_flushRetryTimer);
      _flushRetryTimer = null;
    }

    /* Clear all user-related localStorage keys to prevent data leakage */
    _clearUserLocalStorage();
  }

  /**
   * Load all user data from Firestore and merge into localStorage.
   * Uses in-memory cache to prevent duplicate reads within the same session.
   * Called on app startup after authentication.
   * Clears stale localStorage data before loading to prevent cross-user leakage.
   * @param {function} [callback] - Optional callback when done
   */
  function loadFromFirestore(callback) {
    var currentUserId = FirebaseApp.getUserId();

    /* If a different user is now authenticated, force a full reset so we
       never serve stale data from the previous user's cache. */
    if (_loadedUserId && currentUserId && _loadedUserId !== currentUserId) {
      resetSyncState();
    }

    /* Return cached data if already loaded this session */
    if (_dataLoaded && _memoryCache) {
      if (callback) callback(true);
      return;
    }

    var docRef = _getUserDocRef();
    if (!docRef) {
      if (callback) callback(false);
      return;
    }

    /* Clear stale localStorage before loading the authenticated user's data.
       This prevents the previous user's cached data from being displayed
       before Firestore responds. */
    _clearUserLocalStorage();

    docRef.get().then(function (doc) {
      if (doc.exists) {
        var data = doc.data();
        _normalizeMonetization(data, docRef);
        _validateAndFillDefaults(data, docRef);
        _memoryCache = data;
        _enforceTrialExpiry(_memoryCache, docRef);
        _enforcePremiumPlusExpiry(_memoryCache, docRef);
        _dataLoaded = true;
        _loadedUserId = currentUserId;
        if (data.settings) {
          try { localStorage.setItem('quant_reflex_settings', JSON.stringify(data.settings)); } catch (_) {}
        }
        if (data.stats) {
          try { localStorage.setItem('quant_reflex_progress', JSON.stringify(data.stats)); } catch (_) {}
        }
        if (data.quickLinks) {
          try { localStorage.setItem('quant_quick_links', JSON.stringify(data.quickLinks)); } catch (_) {}
        }
        if (data.customTopics) {
          try { localStorage.setItem('quant_custom_topics', JSON.stringify(data.customTopics)); } catch (_) {}
        }
        if (data.customFormulas) {
          try { localStorage.setItem('quant_custom_formulas', JSON.stringify(data.customFormulas)); } catch (_) {}
        }
        if (data.bookmarks) {
          try { localStorage.setItem('quant_bookmarks', JSON.stringify(data.bookmarks)); } catch (_) {}
        }
      } else {
        /* First time: create document with default data */
        _createDefaultDocument();
        _loadedUserId = currentUserId;
      }
      if (callback) callback(true);
    }).catch(function (err) {
      console.warn('Firestore load failed:', err);
      _dataLoaded = true; /* Mark as loaded to prevent retries */
      if (callback) callback(false);
    });
  }

  /**
   * Create a default Firestore document for a new user.
   * Always uses clean defaults — never reads from localStorage to prevent
   * data leakage from a previously logged-in user.
   */
  function _createDefaultDocument() {
    var docRef = _getUserDocRef();
    if (!docRef) return;
    var db = FirebaseApp.getDb();
    if (!db) return;

    var userId = FirebaseApp.getUserId();
    var username = userId || 'user';
    /* Extract display username from Firebase Auth email */
    if (typeof Auth !== 'undefined' && Auth.getCurrentUser() && Auth.getCurrentUser().email) {
      username = Auth.getCurrentUser().email.split('@')[0];
    }
    var now = new Date();
    var trialEndMs = now.getTime() + (TRIAL_DAYS * 24 * 60 * 60 * 1000);
    var fallbackDefaults = {
      profile: {
        name: '',
        username: username,
        createdAt: now.toISOString()
      },
      settings: {
        darkMode: false, sound: true, vibration: true, difficulty: 'medium',
        dailyGoal: 50, reducedMotion: false, skipEnabled: false, notificationsEnabled: false,
        theme: 'classic'
      },
      stats: {
        totalAttempted: 0, totalCorrect: 0,
        bestStreak: 0, currentStreak: 0,
        drillSessions: 0, timedTestSessions: 0,
        dailyStreak: 0, bestDailyStreak: 0, lastActiveDate: null,
        lastPracticeDate: null,
        todayAttempted: 0, todayCorrect: 0,
        categoryStats: {}, mistakes: [],
        responseTimes: [], dailyHistory: {}
      },
      quickLinks: ['fractionTable', 'tablesContainer', 'formulaSections', 'mentalTricks'],
      customTopics: [],
      customFormulas: {},
      bookmarks: [],
      isPremium: false,
      isTrial: false,
      trialEnd: null,
      hasPaid: false,
      isEarlyUser: false,
      isPremiumPlus: false,
      premiumPlusPlan: null,
      premiumPlusExpiry: null,
      premiumPlusStatus: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    };

    _memoryCache = fallbackDefaults;
    _dataLoaded = true;

    /* Write clean defaults to localStorage so the app has consistent state */
    try {
      localStorage.setItem('quant_reflex_settings', JSON.stringify(fallbackDefaults.settings));
      localStorage.setItem('quant_reflex_progress', JSON.stringify(fallbackDefaults.stats));
      localStorage.setItem('quant_quick_links', JSON.stringify(fallbackDefaults.quickLinks));
      localStorage.setItem('quant_custom_topics', JSON.stringify(fallbackDefaults.customTopics));
      localStorage.setItem('quant_custom_formulas', JSON.stringify(fallbackDefaults.customFormulas));
      localStorage.setItem('quant_bookmarks', JSON.stringify(fallbackDefaults.bookmarks));
    } catch (_) {}
    var metaRef = db.collection('appMeta').doc('global');

    db.runTransaction(function (tx) {
      return tx.get(docRef).then(function (userDoc) {
        if (userDoc.exists) return;
        return tx.get(metaRef).then(function (metaDoc) {
        var meta = metaDoc.exists ? (metaDoc.data() || {}) : {};
        var totalUsers = parseInt(meta.totalUsers, 10);
        if (isNaN(totalUsers) || totalUsers < 0) totalUsers = 0;
        var isEarlyUser = totalUsers < EARLY_USER_LIMIT;
        var monetizationState = isEarlyUser
          ? {
              isPremium: true,
              isEarlyUser: true,
              isTrial: false,
              hasPaid: false,
              trialEnd: null
            }
          : {
              isPremium: true,
              isEarlyUser: false,
              isTrial: true,
              hasPaid: false,
              trialEnd: trialEndMs
            };
        var docDefaults = {
          profile: {
            name: '',
            username: username,
            createdAt: now.toISOString()
          },
          settings: fallbackDefaults.settings,
          stats: fallbackDefaults.stats,
          quickLinks: fallbackDefaults.quickLinks,
          customTopics: fallbackDefaults.customTopics,
          customFormulas: fallbackDefaults.customFormulas,
          bookmarks: fallbackDefaults.bookmarks,
          isPremium: monetizationState.isPremium,
          isTrial: monetizationState.isTrial,
          trialEnd: monetizationState.trialEnd,
          hasPaid: monetizationState.hasPaid,
          isEarlyUser: monetizationState.isEarlyUser,
          isPremiumPlus: false,
          premiumPlusPlan: null,
          premiumPlusExpiry: null,
          premiumPlusStatus: null,
          createdAt: (typeof firebase !== 'undefined' && firebase.firestore && firebase.firestore.FieldValue)
            ? firebase.firestore.FieldValue.serverTimestamp()
            : now.toISOString(),
          updatedAt: now.toISOString()
        };
        tx.set(docRef, docDefaults, { merge: true });
        tx.set(metaRef, { totalUsers: totalUsers + 1 }, { merge: true });
        _memoryCache = docDefaults;
        if (_memoryCache.createdAt && typeof _memoryCache.createdAt.toDate === 'function') {
          _memoryCache.createdAt = _memoryCache.createdAt.toDate().toISOString();
        }
        });
      });
    }).then(function () {
      console.log('Firestore: new user document created successfully');
      /* Non-blocking: eagerly seed all structured subcollections for new user */
      var mc = _memoryCache || fallbackDefaults;
      var seedDocRef = _getUserDocRef();
      _syncProfileSubcollection(
        { name: (mc.profile && mc.profile.name) || '', username: (mc.profile && mc.profile.username) || '' },
        { isPremium: !!mc.isPremium, isTrial: !!mc.isTrial, trialEnd: mc.trialEnd || null, isEarlyUser: !!mc.isEarlyUser, hasPaid: !!mc.hasPaid }
      );
      _syncPerformanceSubcollection(mc.stats || fallbackDefaults.stats);
      /* Eagerly create practice/data and ai/usage so all subcollections exist from day 0 */
      if (seedDocRef) {
        seedDocRef.collection('practice').doc('data').set({
          mistakes: [],
          savedQuestions: [],
          updatedAt: new Date().toISOString()
        }, { merge: true }).catch(function (err) { console.warn('Practice seed failed:', err); });
        seedDocRef.collection('ai').doc('usage').set({
          wordProblemsUsedLifetime: 0,
          wordProblemsUsedToday: 0,
          explanationsUsed: 0,
          updatedAt: new Date().toISOString()
        }, { merge: true }).catch(function (err) { console.warn('AI usage seed failed:', err); });
      }
    }).catch(function (err) {
      console.warn('Firestore default document creation failed:', err);
      fallbackDefaults.isPremium = false;
      fallbackDefaults.isEarlyUser = false;
      fallbackDefaults.isTrial = false;
      fallbackDefaults.trialEnd = null;
      docRef.set(fallbackDefaults, { merge: true }).catch(function (fallbackErr) {
        console.warn('Firestore fallback default document creation failed:', fallbackErr);
      });
    });
  }

  function _toMillis(ts) {
    if (!ts) return 0;
    if (typeof ts === 'number') return ts;
    if (typeof ts === 'string') {
      var parsed = Date.parse(ts);
      return isNaN(parsed) ? 0 : parsed;
    }
    if (typeof ts.toDate === 'function') {
      try { return ts.toDate().getTime(); } catch (_) { return 0; }
    }
    if (ts instanceof Date) return ts.getTime();
    return 0;
  }

  function _normalizeMonetization(data, docRef) {
    if (!data) return;
    var hasAll =
      typeof data.isPremium === 'boolean' &&
      typeof data.isTrial === 'boolean' &&
      typeof data.hasPaid === 'boolean' &&
      typeof data.isEarlyUser === 'boolean' &&
      data.hasOwnProperty('trialEnd') &&
      data.hasOwnProperty('createdAt') &&
      typeof data.isPremiumPlus === 'boolean' &&
      data.hasOwnProperty('premiumPlusPlan') &&
      data.hasOwnProperty('premiumPlusExpiry') &&
      data.hasOwnProperty('premiumPlusStatus') &&
      data.hasOwnProperty('updatedAt');
    if (hasAll) return;

    var patch = {};
    if (typeof data.isPremium !== 'boolean') patch.isPremium = false;
    if (typeof data.isTrial !== 'boolean') patch.isTrial = false;
    if (!data.hasOwnProperty('trialEnd')) patch.trialEnd = null;
    if (typeof data.hasPaid !== 'boolean') patch.hasPaid = false;
    if (typeof data.isEarlyUser !== 'boolean') patch.isEarlyUser = false;
    if (!data.hasOwnProperty('createdAt')) patch.createdAt = new Date().toISOString();
    if (typeof data.isPremiumPlus !== 'boolean') patch.isPremiumPlus = false;
    if (!data.hasOwnProperty('premiumPlusPlan')) patch.premiumPlusPlan = null;
    if (!data.hasOwnProperty('premiumPlusExpiry')) patch.premiumPlusExpiry = null;
    if (!data.hasOwnProperty('premiumPlusStatus')) patch.premiumPlusStatus = null;
    if (!data.hasOwnProperty('updatedAt')) patch.updatedAt = new Date().toISOString();

    var keys = Object.keys(patch);
    if (keys.length === 0) return;

    for (var i = 0; i < keys.length; i++) {
      data[keys[i]] = patch[keys[i]];
    }
    docRef.set(patch, { merge: true }).then(function () {
      console.log('Firestore: normalized monetization fields:', Object.keys(patch).join(', '));
    }).catch(function (err) {
      console.warn('Failed to normalize monetization fields:', err);
    });
  }

  var _defaultStats = {
    totalAttempted: 0, totalCorrect: 0,
    bestStreak: 0, currentStreak: 0,
    drillSessions: 0, timedTestSessions: 0,
    dailyStreak: 0, bestDailyStreak: 0, lastActiveDate: null,
    lastPracticeDate: null,
    todayAttempted: 0, todayCorrect: 0,
    categoryStats: {}, mistakes: [],
    responseTimes: [], dailyHistory: {}
  };

  var _defaultSettings = {
    darkMode: false, sound: true, vibration: true, difficulty: 'medium',
    dailyGoal: 50, reducedMotion: false, skipEnabled: false, notificationsEnabled: false,
    theme: 'classic'
  };

  function _validateAndFillDefaults(data, docRef) {
    if (!data) return;
    var patch = {};
    var needsPatch = false;

    if (!data.stats || typeof data.stats !== 'object') {
      data.stats = JSON.parse(JSON.stringify(_defaultStats));
      patch.stats = data.stats;
      needsPatch = true;
    } else {
      var sk = Object.keys(_defaultStats);
      for (var i = 0; i < sk.length; i++) {
        if (data.stats[sk[i]] === undefined) {
          data.stats[sk[i]] = _defaultStats[sk[i]];
          needsPatch = true;
        }
      }
      if (needsPatch) patch.stats = data.stats;
    }

    if (!data.settings || typeof data.settings !== 'object') {
      data.settings = JSON.parse(JSON.stringify(_defaultSettings));
      patch.settings = data.settings;
      needsPatch = true;
    } else {
      var stk = Object.keys(_defaultSettings);
      var settingsPatched = false;
      for (var j = 0; j < stk.length; j++) {
        if (data.settings[stk[j]] === undefined) {
          data.settings[stk[j]] = _defaultSettings[stk[j]];
          settingsPatched = true;
        }
      }
      if (settingsPatched) {
        patch.settings = data.settings;
        needsPatch = true;
      }
    }

    if (!Array.isArray(data.quickLinks)) { data.quickLinks = ['fractionTable', 'tablesContainer', 'formulaSections', 'mentalTricks']; patch.quickLinks = data.quickLinks; needsPatch = true; }
    if (!Array.isArray(data.customTopics)) { data.customTopics = []; patch.customTopics = data.customTopics; needsPatch = true; }
    if (!data.customFormulas || typeof data.customFormulas !== 'object') { data.customFormulas = {}; patch.customFormulas = data.customFormulas; needsPatch = true; }
    if (!Array.isArray(data.bookmarks)) { data.bookmarks = []; patch.bookmarks = data.bookmarks; needsPatch = true; }

    if (!needsPatch) return;
    patch.updatedAt = new Date().toISOString();
    data.updatedAt = patch.updatedAt;
    docRef.set(patch, { merge: true }).then(function () {
      console.log('Firestore: filled missing defaults:', Object.keys(patch).join(', '));
    }).catch(function (err) {
      console.warn('Failed to fill missing defaults:', err);
    });
  }

  function _enforceTrialExpiry(data, docRef) {
    if (!data || !data.isTrial) return;
    var trialEndMs = _toMillis(data.trialEnd);
    if (!trialEndMs || Date.now() <= trialEndMs) return;
    data.isPremium = false;
    data.isTrial = false;
    docRef.set({ isPremium: false, isTrial: false, updatedAt: new Date().toISOString() }, { merge: true }).then(function () {
      console.log('[FirestoreSync:_enforceTrialExpiry] trial expired, access revoked');
    }).catch(function (err) {
      console.warn('[FirestoreSync:_enforceTrialExpiry] failed to persist trial expiry:', err.message || err);
    });
  }

  function _enforcePremiumPlusExpiry(data, docRef) {
    if (!data || data.isPremiumPlus !== true) return;
    var expiryMs = _toMillis(data.premiumPlusExpiry);
    if (!expiryMs || expiryMs >= Date.now()) return;
    data.isPremiumPlus = false;
    data.premiumPlusStatus = 'expired';
    console.log('[FirestoreSync:_enforcePremiumPlusExpiry] Premium+ expired on load, revoking access');
    docRef.set({ isPremiumPlus: false, premiumPlusStatus: 'expired', updatedAt: new Date().toISOString() }, { merge: true }).then(function () {
      console.log('[FirestoreSync:_enforcePremiumPlusExpiry] expiry persisted to Firestore');
    }).catch(function (err) {
      console.warn('[FirestoreSync:_enforcePremiumPlusExpiry] failed to persist expiry:', err.message || err);
    });
  }

  /**
   * Push all local data to Firestore.
   * Used on first launch or after reset.
   */
  function pushAllToFirestore() {
    var docRef = _getUserDocRef();
    if (!docRef) return;

    var data = {};
    try {
      var settings = localStorage.getItem('quant_reflex_settings');
      if (settings) data.settings = JSON.parse(settings);
    } catch (_) {}
    try {
      var stats = localStorage.getItem('quant_reflex_progress');
      if (stats) data.stats = JSON.parse(stats);
    } catch (_) {}
    try {
      var quickLinks = localStorage.getItem('quant_quick_links');
      if (quickLinks) data.quickLinks = JSON.parse(quickLinks);
    } catch (_) {}
    try {
      var customTopics = localStorage.getItem('quant_custom_topics');
      if (customTopics) data.customTopics = JSON.parse(customTopics);
    } catch (_) {}
    try {
      var customFormulas = localStorage.getItem('quant_custom_formulas');
      if (customFormulas) data.customFormulas = JSON.parse(customFormulas);
    } catch (_) {}
    try {
      var bookmarks = localStorage.getItem('quant_bookmarks');
      if (bookmarks) data.bookmarks = JSON.parse(bookmarks);
    } catch (_) {}

    if (Object.keys(data).length > 0) {
      docRef.set(data, { merge: true }).catch(function (err) {
        console.warn('Firestore push failed:', err);
      });
    }
  }

  /**
   * Queue a field update for batched Firestore write.
   * Only changed fields are updated to minimize writes.
   * During active drills, stats updates are deferred until drill ends.
   * @param {string} field - Firestore document field name
   * @param {*} value - Value to write
   */
  function queueUpdate(field, value) {
    if (!FirebaseApp.isReady() || !FirebaseApp.getUserId()) return;

    /* Update in-memory cache */
    if (_memoryCache) {
      _memoryCache[field] = value;
    }

    _pendingUpdates[field] = value;

    /* During drills, defer all syncing to reduce writes */
    if (_drillActive) return;

    /* Debounce: batch updates */
    if (_syncTimer) clearTimeout(_syncTimer);
    _syncTimer = setTimeout(_flushUpdates, SYNC_DEBOUNCE_MS);
  }

  /**
   * Flush all pending updates to Firestore in a single write.
   */
  function _flushUpdates() {
    var docRef = _getUserDocRef();
    if (!docRef || Object.keys(_pendingUpdates).length === 0) return;
    if (_flushInFlight) return;
    var currentUserId = FirebaseApp.getUserId();
    if (!currentUserId || (_loadedUserId && currentUserId !== _loadedUserId)) {
      console.warn('[FirestoreSync:_flushUpdates] aborted: user context changed');
      _pendingUpdates = {};
      _flushRetryCount = 0;
      return;
    }

    var snapshot = {};
    var keys = Object.keys(_pendingUpdates);
    for (var i = 0; i < keys.length; i++) {
      snapshot[keys[i]] = _pendingUpdates[keys[i]];
    }
    snapshot.updatedAt = new Date().toISOString();
    _pendingUpdates = {};
    _flushInFlight = true;

    docRef.set(snapshot, { merge: true }).then(function () {
      _flushInFlight = false;
      _flushRetryCount = 0;
      if (_flushRetryTimer) { clearTimeout(_flushRetryTimer); _flushRetryTimer = null; }
      console.log('[FirestoreSync:_flushUpdates] flushed', keys.length, 'field(s):', keys.join(', '));
      if (Object.keys(_pendingUpdates).length > 0) {
        if (_syncTimer) clearTimeout(_syncTimer);
        _syncTimer = setTimeout(_flushUpdates, SYNC_DEBOUNCE_MS);
      }
    }).catch(function (err) {
      _flushInFlight = false;
      for (var k = 0; k < keys.length; k++) {
        if (!_pendingUpdates.hasOwnProperty(keys[k])) {
          _pendingUpdates[keys[k]] = snapshot[keys[k]];
        }
      }
      _flushRetryCount++;
      if (_flushRetryCount <= FLUSH_MAX_RETRIES) {
        console.warn('[FirestoreSync:_flushUpdates] write failed (attempt ' + _flushRetryCount + '/' + FLUSH_MAX_RETRIES + '), retrying in ' + (FLUSH_RETRY_DELAY_MS / 1000) + 's:', err.message || err);
        if (_flushRetryTimer) clearTimeout(_flushRetryTimer);
        _flushRetryTimer = setTimeout(_flushUpdates, FLUSH_RETRY_DELAY_MS);
      } else {
        console.error('[FirestoreSync:_flushUpdates] write failed after ' + FLUSH_MAX_RETRIES + ' retries, data re-queued:', err.message || err);
        _flushRetryCount = 0;
        if (_flushRetryTimer) clearTimeout(_flushRetryTimer);
        _flushRetryTimer = setTimeout(_flushUpdates, FLUSH_RETRY_DELAY_MS * 6);
      }
    });
  }

  /**
   * Sync settings to Firestore.
   * @param {object} settings
   */
  function syncSettings(settings) {
    queueUpdate('settings', settings);
  }

  /**
   * Sync progress/stats to Firestore.
   * @param {object} stats
   */
  function syncStats(stats) {
    queueUpdate('stats', stats);
    /* Skip subcollection writes during active drill sessions to avoid per-answer write amplification.
       The drill-end flush (endDrillMode → _flushPendingUpdates → syncStats) runs with _drillActive=false,
       so subcollections are always updated once at session end. */
    if (!_drillActive) {
      _syncPerformanceSubcollection(stats);
      var cachedBookmarks = (_memoryCache && Array.isArray(_memoryCache.bookmarks)) ? _memoryCache.bookmarks : null;
      _syncPracticeSubcollection(stats, cachedBookmarks);
    }
  }

  /**
   * Sync quick links to Firestore.
   * @param {Array} links
   */
  function syncQuickLinks(links) {
    queueUpdate('quickLinks', links);
  }

  /**
   * Sync custom topics to Firestore.
   * @param {Array} topics
   */
  function syncCustomTopics(topics) {
    queueUpdate('customTopics', topics);
  }

  /**
   * Sync custom formulas to Firestore.
   * @param {object} formulas
   */
  function syncCustomFormulas(formulas) {
    queueUpdate('customFormulas', formulas);
  }

  /**
   * Sync bookmarks to Firestore.
   * @param {Array} bookmarks
   */
  function syncBookmarks(bookmarks) {
    queueUpdate('bookmarks', bookmarks);
    _syncPracticeSubcollection(null, bookmarks);
  }

  /**
   * Save a practice session to the subcollection.
   * @param {object} sessionData - {mode, category, score, total, duration, date}
   */
  function savePracticeSession(sessionData) {
    var docRef = _getUserDocRef();
    if (!docRef) return;

    sessionData.timestamp = new Date().toISOString();
    docRef.collection('practiceSessions').add(sessionData).catch(function (err) {
      console.warn('Failed to save practice session:', err);
    });
  }

  /**
   * Clear specific data types from Firestore and localStorage.
   * @param {string} type - 'stats', 'formulas', or 'all'
   * @param {function} [callback] - optional callback receives (error)
   */
  function clearUserData(type, callback) {
    var docRef = _getUserDocRef();

    if (type === 'stats') {
      var resetStats = {
        totalAttempted: 0, totalCorrect: 0,
        bestStreak: 0, currentStreak: 0,
        drillSessions: 0, timedTestSessions: 0,
        dailyStreak: 0, bestDailyStreak: 0,
        lastActiveDate: null,
        lastPracticeDate: null,
        todayAttempted: 0, todayCorrect: 0,
        categoryStats: {}, mistakes: [],
        responseTimes: [], dailyHistory: {}
      };
      try { localStorage.setItem('quant_reflex_progress', JSON.stringify(resetStats)); } catch (_) {}
      if (_memoryCache) _memoryCache.stats = resetStats;
      if (docRef) {
        docRef.set({ stats: resetStats }, { merge: true }).then(function () {
          /* Also reset structured subcollections so they stay consistent */
          var uid = docRef.id;
          var db = docRef.firestore;
          db.collection('users').doc(uid).collection('performance').doc('overall').set({
            totalAttempted: 0, totalCorrect: 0, accuracy: 0, avgTime: 0,
            bestStreak: 0, currentStreak: 0,
            dailyStreak: 0, bestDailyStreak: 0,
            drillSessions: 0, timedTestSessions: 0,
            categoryStats: {}, responseTimes: [],
            updatedAt: new Date().toISOString()
          }, { merge: true }).catch(function () {});
          db.collection('users').doc(uid).collection('practice').doc('data').set({
            mistakes: [], savedQuestions: [],
            updatedAt: new Date().toISOString()
          }, { merge: true }).catch(function () {});
          if (callback) callback(null);
        }).catch(function (err) {
          if (callback) callback(err.message);
        });
      } else {
        if (callback) callback(null);
      }
    } else if (type === 'formulas') {
      try { localStorage.setItem('quant_custom_formulas', '{}'); } catch (_) {}
      try { localStorage.setItem('quant_custom_topics', '[]'); } catch (_) {}
      try { localStorage.setItem('quant_bookmarks', '[]'); } catch (_) {}
      if (_memoryCache) {
        _memoryCache.customFormulas = {};
        _memoryCache.customTopics = [];
        _memoryCache.bookmarks = [];
      }
      if (docRef) {
        docRef.set({ customFormulas: {}, customTopics: [], bookmarks: [] }, { merge: true }).then(function () {
          if (callback) callback(null);
        }).catch(function (err) {
          if (callback) callback(err.message);
        });
      } else {
        if (callback) callback(null);
      }
    } else if (type === 'all') {
      var defaultSettings = {
        darkMode: false, sound: true, vibration: true, difficulty: 'medium',
        dailyGoal: 50, reducedMotion: false, skipEnabled: false, notificationsEnabled: false,
        theme: 'classic'
      };
      var defaultStats = {
        totalAttempted: 0, totalCorrect: 0,
        bestStreak: 0, currentStreak: 0,
        drillSessions: 0, timedTestSessions: 0,
        dailyStreak: 0, bestDailyStreak: 0,
        lastActiveDate: null,
        lastPracticeDate: null,
        todayAttempted: 0, todayCorrect: 0,
        categoryStats: {}, mistakes: [],
        responseTimes: [], dailyHistory: {}
      };
      try {
        localStorage.setItem('quant_reflex_settings', JSON.stringify(defaultSettings));
        localStorage.setItem('quant_reflex_progress', JSON.stringify(defaultStats));
        localStorage.setItem('quant_quick_links', JSON.stringify(['fractionTable', 'tablesContainer', 'formulaSections', 'mentalTricks']));
        localStorage.setItem('quant_custom_topics', '[]');
        localStorage.setItem('quant_custom_formulas', '{}');
        localStorage.setItem('quant_bookmarks', '[]');
        /* Reset notification state when clearing all data */
        localStorage.setItem('quant_notifications_enabled', 'false');
      } catch (_) {}
      /* Cancel any active notification timers */
      if (typeof NotificationManager !== 'undefined') {
        NotificationManager.cancelScheduledNotifications();
      }
      var resetAll = {
        settings: defaultSettings,
        stats: defaultStats,
        quickLinks: ['fractionTable', 'tablesContainer', 'formulaSections', 'mentalTricks'],
        customTopics: [],
        customFormulas: {},
        bookmarks: []
      };
      /* Preserve profile data in memory cache (account info should not be cleared) */
      var existingProfile = _memoryCache ? _memoryCache.profile : null;
      _memoryCache = resetAll;
      if (existingProfile) _memoryCache.profile = existingProfile;
      if (docRef) {
        docRef.set(resetAll, { merge: true }).then(function () {
          /* Also reset structured subcollections so they stay consistent */
          var uid = docRef.id;
          var db = docRef.firestore;
          db.collection('users').doc(uid).collection('performance').doc('overall').set({
            totalAttempted: 0, totalCorrect: 0, accuracy: 0, avgTime: 0,
            bestStreak: 0, currentStreak: 0,
            dailyStreak: 0, bestDailyStreak: 0,
            drillSessions: 0, timedTestSessions: 0,
            categoryStats: {}, responseTimes: [],
            updatedAt: new Date().toISOString()
          }, { merge: true }).catch(function () {});
          db.collection('users').doc(uid).collection('practice').doc('data').set({
            mistakes: [], savedQuestions: [],
            updatedAt: new Date().toISOString()
          }, { merge: true }).catch(function () {});
          if (callback) callback(null);
        }).catch(function (err) {
          if (callback) callback(err.message);
        });
      } else {
        if (callback) callback(null);
      }
    }
  }

  /**
   * Begin drill mode — defers Firestore writes until drill ends.
   * Reduces write costs during rapid stat updates.
   */
  function beginDrillBatch() {
    _drillActive = true;
  }

  /**
   * End drill mode — flushes all pending updates to Firestore.
   */
  function endDrillBatch() {
    _drillActive = false;
    if (Object.keys(_pendingUpdates).length > 0) {
      _flushUpdates();
    }
    /* Flush subcollections once at drill end using latest cached stats.
       This guarantees performance/overall and practice/data are updated
       even though per-answer calls are gated by _drillActive. */
    if (_memoryCache && _memoryCache.stats) {
      _syncPerformanceSubcollection(_memoryCache.stats);
      _syncPracticeSubcollection(
        _memoryCache.stats,
        Array.isArray(_memoryCache.bookmarks) ? _memoryCache.bookmarks : null
      );
    }
  }

  /* Flush pending updates when the page is closing */
  window.addEventListener('beforeunload', function () {
    if (Object.keys(_pendingUpdates).length > 0) {
      _flushUpdates();
    }
  });

  /* Flush when app goes to background (mobile PWA) */
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden' && Object.keys(_pendingUpdates).length > 0) {
      _flushUpdates();
    }
  });

  return {
    loadFromFirestore: loadFromFirestore,
    pushAllToFirestore: pushAllToFirestore,
    resetSyncState: resetSyncState,
    syncSettings: syncSettings,
    syncStats: syncStats,
    syncQuickLinks: syncQuickLinks,
    syncCustomTopics: syncCustomTopics,
    syncCustomFormulas: syncCustomFormulas,
    syncBookmarks: syncBookmarks,
    savePracticeSession: savePracticeSession,
    clearUserData: clearUserData,
    beginDrillBatch: beginDrillBatch,
    endDrillBatch: endDrillBatch,
    /**
     * Expose the in-memory cache for profile reading (used by settings).
     * @returns {object|null}
     */
    _getCache: function () { return _memoryCache; },
    /**
     * Update the user's display name in Firestore profile.
     * @param {string} name
     */
    updateProfileName: function (name) {
      if (!name) return;
      if (_memoryCache && _memoryCache.profile) {
        /* Full profile is cached — update in-place and queue the whole object.
           set({ profile: fullObj }, { merge:true }) safely replaces only the
           profile top-level key while keeping all other document fields. */
        _memoryCache.profile.name = name;
        queueUpdate('profile', _memoryCache.profile);
      } else {
        /* No full profile in cache — use dot-notation update to avoid
           overwriting username and createdAt inside the profile sub-document.
           set({ profile: {name} }, { merge:true }) would replace the ENTIRE
           profile map; update() with dot notation patches only the one field. */
        if (_memoryCache) _memoryCache.profile = { name: name };
        var docRef = _getUserDocRef();
        if (docRef) {
          docRef.update({ 'profile.name': name }).catch(function (err) {
            console.warn('Failed to update profile name (dot-notation fallback):', err);
          });
        }
      }
      _syncProfileSubcollection({ name: name }, null);
    },
    getAccessState: function () {
      if (!_memoryCache) return null;
      var now = Date.now();
      if (_memoryCache.isTrial === true) {
        var trialEndMs = _toMillis(_memoryCache.trialEnd);
        if (trialEndMs > 0 && now > trialEndMs) {
          _memoryCache.isPremium = false;
          _memoryCache.isTrial = false;
          if (!_trialExpiryPersistInFlight) {
            var docRef = _getUserDocRef();
            if (docRef) {
              _trialExpiryPersistInFlight = true;
              docRef.set({ isPremium: false, isTrial: false, updatedAt: new Date().toISOString() }, { merge: true }).catch(function (err) {
                console.warn('Failed to persist trial expiry from access state:', err);
              }).finally(function () {
                _trialExpiryPersistInFlight = false;
              });
            }
          }
        }
      }
      if (_memoryCache.isPremiumPlus === true) {
        var ppExpiry = _memoryCache.premiumPlusExpiry;
        var ppExpiryMs = _toMillis(ppExpiry);
        if (ppExpiryMs > 0 && ppExpiryMs < now) {
          _memoryCache.isPremiumPlus = false;
          _memoryCache.premiumPlusStatus = 'expired';
          var ppDocRef = _getUserDocRef();
          if (ppDocRef) {
            ppDocRef.set({ isPremiumPlus: false, premiumPlusStatus: 'expired', updatedAt: new Date().toISOString() }, { merge: true }).catch(function (err) {
              console.warn('Failed to persist PremiumPlus expiry from access state:', err);
            });
          }
        }
      }
      return {
        isPremium: _memoryCache.isPremium === true,
        isPremiumPlus: _memoryCache.isPremiumPlus === true,
        premiumPlusPlan: _memoryCache.premiumPlusPlan || null,
        premiumPlusExpiry: _memoryCache.premiumPlusExpiry || null,
        isTrial: _memoryCache.isTrial === true,
        trialEnd: _memoryCache.trialEnd || null,
        hasPaid: _memoryCache.hasPaid === true,
        isEarlyUser: _memoryCache.isEarlyUser === true,
        createdAt: _memoryCache.createdAt || null
      };
    },
    unlockPremiumPlus: function (plan, expiry, paymentId, callback) {
      var docRef = _getUserDocRef();
      if (!docRef) {
        if (callback) callback('User not authenticated');
        return;
      }
      var payload = {
        isPremiumPlus: true,
        premiumPlusPlan: plan,
        premiumPlusExpiry: expiry,
        premiumPlusStatus: 'active',
        updatedAt: new Date().toISOString()
      };
      if (paymentId) payload.lastPremiumPlusPaymentId = String(paymentId);
      if (_memoryCache) {
        _memoryCache.isPremiumPlus = true;
        _memoryCache.premiumPlusPlan = plan;
        _memoryCache.premiumPlusExpiry = expiry;
        _memoryCache.premiumPlusStatus = 'active';
        if (paymentId) _memoryCache.lastPremiumPlusPaymentId = String(paymentId);
      }
      docRef.set(payload, { merge: true }).then(function () {
        console.log('Firestore: Premium+ unlocked — plan:', plan, 'expiry:', expiry);
        if (callback) callback(null);
        _syncProfileSubcollection(null, { isPremiumPlus: true, premiumPlusPlan: plan });
      }).catch(function (err) {
        console.warn('Firestore: Premium+ unlock write failed:', err);
        if (callback) callback(err && err.message ? err.message : 'PremiumPlus unlock failed');
      });
    },
    unlockPremium: function (paymentId, callback) {
      var docRef = _getUserDocRef();
      if (!docRef) {
        if (callback) callback('User not authenticated');
        return;
      }
      var payload = {
        isPremium: true,
        hasPaid: true,
        isTrial: false,
        trialEnd: null,
        updatedAt: new Date().toISOString()
      };
      if (paymentId) payload.lastPaymentId = String(paymentId);
      if (_memoryCache) {
        _memoryCache.isPremium = true;
        _memoryCache.hasPaid = true;
        _memoryCache.isTrial = false;
        _memoryCache.trialEnd = null;
        if (paymentId) _memoryCache.lastPaymentId = String(paymentId);
      }
      docRef.set(payload, { merge: true }).then(function () {
        console.log('Firestore: Premium unlocked — paymentId:', paymentId);
        if (callback) callback(null);
        _syncProfileSubcollection(null, { isPremium: true, hasPaid: true, isTrial: false, trialEnd: null });
      }).catch(function (err) {
        console.warn('Firestore: Premium unlock write failed:', err);
        if (callback) callback(err && err.message ? err.message : 'Premium unlock failed');
      });
    }
  };
})();
