/**
 * firestore-sync.js — Firestore data synchronization layer
 *
 * Syncs localStorage data with Firestore using authenticated user profiles.
 * Uses local caching for fast access and batched updates for efficiency.
 *
 * Firestore structure:
 *   users/{userId}
 *     ├── profile
 *     ├── access
 *     ├── settings
 *     ├── stats
 *     ├── categoryStats
 *     ├── dailyHistory
 *     ├── mistakes
 *     ├── responseTimes
 *     ├── quickLinks
 *     ├── customTopics
 *     ├── customFormulas
 *     └── bookmarks
 *
 *   users/{userId}/practiceSessions/{sessionId}  (subcollection)
 */

var FirestoreSync = (function () {
  var _syncTimer = null;
  var _pendingUpdates = {};
  var _memoryCache = null; /* In-memory cache of the user document */
  var _dataLoaded = false; /* Whether initial load has completed */
  var _drillActive = false; /* Whether a drill is in progress (defers syncing) */
  var _loadedUserId = null; /* UID whose data is currently loaded — detects user switches */
  var _trialExpiryPersistInFlight = false;
  var SYNC_DEBOUNCE_MS = 2000; /* batch updates every 2 seconds */
  var EARLY_USER_LIMIT = 121;
  var TRIAL_DAYS = 7;
  var PASSWORD_HASH_SALT_BYTES = 16;
  var PASSWORD_HASH_PBKDF2_ITERATIONS = 120000;

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
    if (_syncTimer) {
      clearTimeout(_syncTimer);
      _syncTimer = null;
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
        data.stats = _buildProgressStats(data);
        _memoryCache = data;
        _enforceTrialExpiry(_memoryCache, docRef);
        _dataLoaded = true;
        _loadedUserId = currentUserId;
        /* Merge Firestore data into localStorage (Firestore is source of truth) */
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
        _createDefaultDocument(function (created) {
          if (created) _loadedUserId = currentUserId;
          if (callback) callback(!!created);
        });
        return;
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
  function assignUserTier(db, userId, baseUserData) {
    var userRef = db.collection('users').doc(userId);
    var metaRef = db.collection('appMeta').doc('global');

    return db.runTransaction(function (tx) {
      return tx.get(userRef).then(function (userDoc) {
        if (userDoc.exists) {
          return userDoc.data() || {};
        }
        return tx.get(metaRef).then(function (metaDoc) {
          var meta = metaDoc.exists ? (metaDoc.data() || {}) : {};
          var totalUsers = parseInt(meta.totalUsers, 10);
          if (isNaN(totalUsers) || totalUsers < 0) totalUsers = 0;

          var userNumber = totalUsers + 1;
          var nowMs = Date.now();
          var userData = {
            profile: baseUserData.profile,
            access: {
              userNumber: userNumber,
              isPremium: false,
              isTrial: false,
              isEarlyUser: false,
              trialEnd: null,
              hasPaid: false
            },
            settings: baseUserData.settings,
            stats: baseUserData.stats,
            categoryStats: baseUserData.categoryStats,
            dailyHistory: baseUserData.dailyHistory,
            mistakes: baseUserData.mistakes,
            responseTimes: baseUserData.responseTimes,
            quickLinks: baseUserData.quickLinks,
            customTopics: baseUserData.customTopics,
            customFormulas: baseUserData.customFormulas,
            bookmarks: baseUserData.bookmarks
          };

          if (userNumber <= EARLY_USER_LIMIT) {
            userData.access.isPremium = true;
            userData.access.isEarlyUser = true;
            userData.access.isTrial = false;
            userData.access.hasPaid = false;
            userData.access.trialEnd = null;
          } else {
            userData.access.isPremium = true;
            userData.access.isTrial = true;
            userData.access.isEarlyUser = false;
            userData.access.hasPaid = false;
            userData.access.trialEnd = nowMs + (TRIAL_DAYS * 24 * 60 * 60 * 1000);
          }

          tx.set(userRef, userData, { merge: true });
          tx.set(metaRef, { totalUsers: userNumber }, { merge: true });
          return userData;
        });
      });
    });
  }

  function _createDefaultDocument(callback) {
    var docRef = _getUserDocRef();
    if (!docRef) {
      if (callback) callback(false);
      return;
    }
    var db = FirebaseApp.getDb();
    if (!db) {
      if (callback) callback(false);
      return;
    }

    var userId = FirebaseApp.getUserId();
    if (!userId) {
      if (callback) callback(false);
      return;
    }
    var username = userId || 'user';
    /* Extract display username from Firebase Auth email */
    if (typeof Auth !== 'undefined' && Auth.getCurrentUser() && Auth.getCurrentUser().email) {
      username = Auth.getCurrentUser().email.split('@')[0];
    }
    var now = new Date();
    var fallbackDefaults = {
      profile: {
        name: '',
        username: username,
        createdAt: now.toISOString()
      },
      access: {
        userNumber: 0,
        isPremium: false,
        isTrial: false,
        isEarlyUser: false,
        trialEnd: null,
        hasPaid: false
      },
      settings: {
        darkMode: false, sound: true, vibration: true, difficulty: 'medium',
        dailyGoal: 50, reducedMotion: false, skipEnabled: false, notificationsEnabled: false,
        onboardingCompleted: false, theme: 'classic'
      },
      stats: {
        totalAttempted: 0, totalCorrect: 0,
        bestStreak: 0,
        bestDailyStreak: 0
      },
      categoryStats: {},
      dailyHistory: {},
      mistakes: [],
      responseTimes: [],
      quickLinks: ['fractionTable', 'tablesContainer', 'formulaSections', 'mentalTricks'],
      customTopics: [],
      customFormulas: {},
      bookmarks: []
    };

    /* Write clean defaults to localStorage so the app has consistent state */
    try {
      localStorage.setItem('quant_reflex_settings', JSON.stringify(fallbackDefaults.settings));
      localStorage.setItem('quant_reflex_progress', JSON.stringify(_buildProgressStats(fallbackDefaults)));
      localStorage.setItem('quant_quick_links', JSON.stringify(fallbackDefaults.quickLinks));
      localStorage.setItem('quant_custom_topics', JSON.stringify(fallbackDefaults.customTopics));
      localStorage.setItem('quant_custom_formulas', JSON.stringify(fallbackDefaults.customFormulas));
      localStorage.setItem('quant_bookmarks', JSON.stringify(fallbackDefaults.bookmarks));
    } catch (_) {}

    assignUserTier(db, userId, fallbackDefaults).then(function (resolvedUserData) {
      _memoryCache = resolvedUserData;
      _normalizeMonetization(_memoryCache, docRef);
      _enforceTrialExpiry(_memoryCache, docRef);
      _dataLoaded = true;
      _memoryCache.stats = _buildProgressStats(_memoryCache);
      if (_memoryCache.profile && _memoryCache.profile.createdAt && typeof _memoryCache.profile.createdAt.toDate === 'function') {
        _memoryCache.profile.createdAt = _memoryCache.profile.createdAt.toDate().toISOString();
      }
      if (callback) callback(true);
    }).catch(function (err) {
      console.warn('Firestore default document creation failed:', err);
      fallbackDefaults.access.isPremium = false;
      fallbackDefaults.access.isEarlyUser = false;
      fallbackDefaults.access.isTrial = false;
      fallbackDefaults.access.trialEnd = null;
      _memoryCache = fallbackDefaults;
      _dataLoaded = true;
      if (callback) callback(false);
    });
  }

  function _buildProgressStats(data) {
    if (!data) return {};
    var baseStats = data.stats || {};
    return {
      totalAttempted: parseInt(baseStats.totalAttempted, 10) || 0,
      totalCorrect: parseInt(baseStats.totalCorrect, 10) || 0,
      bestStreak: parseInt(baseStats.bestStreak, 10) || 0,
      currentStreak: parseInt(baseStats.currentStreak, 10) || 0,
      drillSessions: parseInt(baseStats.drillSessions, 10) || 0,
      timedTestSessions: parseInt(baseStats.timedTestSessions, 10) || 0,
      dailyStreak: parseInt(baseStats.dailyStreak, 10) || 0,
      bestDailyStreak: parseInt(baseStats.bestDailyStreak, 10) || 0,
      lastActiveDate: baseStats.lastActiveDate || null,
      lastPracticeDate: baseStats.lastPracticeDate || null,
      todayAttempted: parseInt(baseStats.todayAttempted, 10) || 0,
      todayCorrect: parseInt(baseStats.todayCorrect, 10) || 0,
      categoryStats: data.categoryStats || baseStats.categoryStats || {},
      mistakes: data.mistakes || baseStats.mistakes || [],
      responseTimes: data.responseTimes || baseStats.responseTimes || [],
      dailyHistory: data.dailyHistory || baseStats.dailyHistory || {}
    };
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

  function _bytesToHex(bytes) {
    var hex = '';
    for (var i = 0; i < bytes.length; i++) {
      hex += bytes[i].toString(16).padStart(2, '0');
    }
    return hex;
  }

  function _removeLegacyProfilePassword(docRef) {
    if (!docRef) return;
    if (typeof firebase === 'undefined' || !firebase.firestore || !firebase.firestore.FieldValue) return;
    var patch = {};
    patch['profile.password'] = firebase.firestore.FieldValue.delete();
    docRef.set(patch, { merge: true }).catch(function (err) {
      console.warn('Failed to remove legacy profile password field:', err);
    });
  }

  function _normalizeMonetization(data, docRef) {
    if (!data) return;
    var patch = {};
    var access = data.access && typeof data.access === 'object' ? data.access : {};
    var accessPatch = {};

    var resolvedUserNumber = parseInt(access.userNumber, 10);
    if (isNaN(resolvedUserNumber) || resolvedUserNumber < 0) {
      resolvedUserNumber = parseInt(data.userNumber, 10);
    }
    if (isNaN(resolvedUserNumber) || resolvedUserNumber < 0) resolvedUserNumber = 0;
    if (parseInt(access.userNumber, 10) !== resolvedUserNumber) accessPatch.userNumber = resolvedUserNumber;

    if (typeof access.isPremium !== 'boolean') accessPatch.isPremium = (typeof data.isPremium === 'boolean') ? data.isPremium : false;
    if (typeof access.isTrial !== 'boolean') accessPatch.isTrial = (typeof data.isTrial === 'boolean') ? data.isTrial : false;
    if (typeof access.hasPaid !== 'boolean') accessPatch.hasPaid = (typeof data.hasPaid === 'boolean') ? data.hasPaid : false;
    if (typeof access.isEarlyUser !== 'boolean') accessPatch.isEarlyUser = (typeof data.isEarlyUser === 'boolean') ? data.isEarlyUser : false;
    if (!access.hasOwnProperty('trialEnd')) accessPatch.trialEnd = data.hasOwnProperty('trialEnd') ? data.trialEnd : null;

    if (!data.categoryStats && data.stats && data.stats.categoryStats) patch.categoryStats = data.stats.categoryStats;
    if (!data.dailyHistory && data.stats && data.stats.dailyHistory) patch.dailyHistory = data.stats.dailyHistory;
    if (!data.mistakes && data.stats && data.stats.mistakes) patch.mistakes = data.stats.mistakes;
    if (!data.responseTimes && data.stats && data.stats.responseTimes) patch.responseTimes = data.stats.responseTimes;

    if (typeof data.settings !== 'object' || !data.settings) patch.settings = {};
    var mergedSettings = data.settings || {};
    if (typeof mergedSettings.onboardingCompleted !== 'boolean') {
      mergedSettings.onboardingCompleted = false;
      patch.settings = mergedSettings;
    }

    if (Object.keys(accessPatch).length > 0) {
      patch.access = Object.assign({}, access, accessPatch);
      data.access = patch.access;
    }
    if (data.profile && data.profile.hasOwnProperty('password')) {
      delete data.profile.password;
      patch.profile = data.profile;
      _removeLegacyProfilePassword(docRef);
    }

    var keys = Object.keys(patch);
    if (keys.length === 0) return;

    for (var i = 0; i < keys.length; i++) {
      data[keys[i]] = patch[keys[i]];
    }
    docRef.set(patch, { merge: true }).catch(function (err) {
      console.warn('Failed to normalize monetization fields:', err);
    });
  }

  function _persistTrialExpiry(docRef) {
    if (_trialExpiryPersistInFlight) return;
    var db = FirebaseApp.getDb();
    if (!db || !docRef) return;
    _trialExpiryPersistInFlight = true;
    db.runTransaction(function (tx) {
      return tx.get(docRef).then(function (doc) {
        if (!doc.exists) return;
        var liveData = doc.data() || {};
        var liveAccess = liveData.access && typeof liveData.access === 'object' ? liveData.access : {};
        if (liveAccess.hasPaid === true || liveAccess.isTrial !== true) return;
        var trialEndMs = _toMillis(liveAccess.trialEnd);
        if (!trialEndMs || Date.now() <= trialEndMs) return;
        tx.set(docRef, { access: { isPremium: false, isTrial: false, trialEnd: null } }, { merge: true });
      });
    }).catch(function (err) {
      console.warn('Failed to persist trial expiry:', err);
    }).finally(function () {
      _trialExpiryPersistInFlight = false;
    });
  }

  function _enforceTrialExpiry(data, docRef) {
    if (!data || !data.access || data.access.isTrial !== true) return;
    var trialEndMs = _toMillis(data.access.trialEnd);
    if (!trialEndMs || Date.now() <= trialEndMs) return;
    data.access.isPremium = false;
    data.access.isTrial = false;
    data.access.trialEnd = null;
    _persistTrialExpiry(docRef);
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
      if (stats) {
        var parsedStats = JSON.parse(stats);
        data.stats = {
          totalAttempted: parseInt(parsedStats.totalAttempted, 10) || 0,
          totalCorrect: parseInt(parsedStats.totalCorrect, 10) || 0,
          bestStreak: parseInt(parsedStats.bestStreak, 10) || 0,
          currentStreak: parseInt(parsedStats.currentStreak, 10) || 0,
          drillSessions: parseInt(parsedStats.drillSessions, 10) || 0,
          timedTestSessions: parseInt(parsedStats.timedTestSessions, 10) || 0,
          dailyStreak: parseInt(parsedStats.dailyStreak, 10) || 0,
          bestDailyStreak: parseInt(parsedStats.bestDailyStreak, 10) || 0,
          lastActiveDate: parsedStats.lastActiveDate || null,
          lastPracticeDate: parsedStats.lastPracticeDate || null,
          todayAttempted: parseInt(parsedStats.todayAttempted, 10) || 0,
          todayCorrect: parseInt(parsedStats.todayCorrect, 10) || 0
        };
        data.categoryStats = _normalizeCategoryStatsForWrite(parsedStats.categoryStats);
        data.dailyHistory = _normalizeDailyHistoryForWrite(parsedStats.dailyHistory);
        data.mistakes = parsedStats.mistakes || [];
        data.responseTimes = parsedStats.responseTimes || [];
      }
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
    var currentUserId = FirebaseApp.getUserId();
    if (!currentUserId || (_loadedUserId && currentUserId !== _loadedUserId)) {
      console.warn('Firestore sync aborted: user context changed before pending updates flush.');
      _pendingUpdates = {};
      return;
    }

    var updates = {};
    var keys = Object.keys(_pendingUpdates);
    for (var i = 0; i < keys.length; i++) {
      updates[keys[i]] = _pendingUpdates[keys[i]];
    }
    _pendingUpdates = {};

    docRef.set(updates, { merge: true }).catch(function (err) {
      console.warn('Firestore batch update failed:', err);
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
    var progress = stats || {};
    queueUpdate('stats', {
      totalAttempted: parseInt(progress.totalAttempted, 10) || 0,
      totalCorrect: parseInt(progress.totalCorrect, 10) || 0,
      bestStreak: parseInt(progress.bestStreak, 10) || 0,
      currentStreak: parseInt(progress.currentStreak, 10) || 0,
      drillSessions: parseInt(progress.drillSessions, 10) || 0,
      timedTestSessions: parseInt(progress.timedTestSessions, 10) || 0,
      dailyStreak: parseInt(progress.dailyStreak, 10) || 0,
      bestDailyStreak: parseInt(progress.bestDailyStreak, 10) || 0,
      lastActiveDate: progress.lastActiveDate || null,
      lastPracticeDate: progress.lastPracticeDate || null,
      todayAttempted: parseInt(progress.todayAttempted, 10) || 0,
      todayCorrect: parseInt(progress.todayCorrect, 10) || 0
    });
    queueUpdate('categoryStats', _normalizeCategoryStatsForWrite(progress.categoryStats));
    queueUpdate('dailyHistory', _normalizeDailyHistoryForWrite(progress.dailyHistory));
    queueUpdate('mistakes', progress.mistakes || []);
    queueUpdate('responseTimes', progress.responseTimes || []);
  }

  function _normalizeCategoryStatsForWrite(categoryStats) {
    var source = categoryStats && typeof categoryStats === 'object' ? categoryStats : {};
    var normalized = {};
    var keys = Object.keys(source);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var row = source[key] || {};
      var attempted = parseInt(row.attempted, 10) || 0;
      var correct = parseInt(row.correct, 10) || 0;
      var accuracy = attempted > 0 ? Math.round((correct / attempted) * 10000) / 100 : 0;
      normalized[key] = { attempted: attempted, correct: correct, accuracy: accuracy };
    }
    return normalized;
  }

  function _normalizeDailyHistoryForWrite(dailyHistory) {
    var source = dailyHistory && typeof dailyHistory === 'object' ? dailyHistory : {};
    var normalized = {};
    var keys = Object.keys(source);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var row = source[key] || {};
      normalized[key] = {
        attempted: parseInt(row.attempted, 10) || 0,
        correct: parseInt(row.correct, 10) || 0,
        dailyStreak: parseInt(row.dailyStreak, 10) || 0
      };
    }
    return normalized;
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
      if (_memoryCache) _memoryCache.categoryStats = {};
      if (_memoryCache) _memoryCache.mistakes = [];
      if (_memoryCache) _memoryCache.responseTimes = [];
      if (_memoryCache) _memoryCache.dailyHistory = {};
      if (docRef) {
        docRef.set({
          stats: {
            totalAttempted: 0, totalCorrect: 0,
            bestStreak: 0, currentStreak: 0,
            drillSessions: 0, timedTestSessions: 0,
            dailyStreak: 0, bestDailyStreak: 0,
            lastActiveDate: null, lastPracticeDate: null,
            todayAttempted: 0, todayCorrect: 0
          },
          categoryStats: {},
          mistakes: [],
          responseTimes: [],
          dailyHistory: {}
        }, { merge: true }).then(function () {
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
        onboardingCompleted: false, theme: 'classic'
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
        stats: {
          totalAttempted: 0, totalCorrect: 0,
          bestStreak: 0, currentStreak: 0,
          drillSessions: 0, timedTestSessions: 0,
          dailyStreak: 0, bestDailyStreak: 0,
          lastActiveDate: null, lastPracticeDate: null,
          todayAttempted: 0, todayCorrect: 0
        },
        categoryStats: {},
        dailyHistory: {},
        mistakes: [],
        responseTimes: [],
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
      var profile;
      if (_memoryCache && _memoryCache.profile) {
        _memoryCache.profile.name = name;
        profile = _memoryCache.profile;
      } else {
        profile = { name: name };
      }
      queueUpdate('profile', profile);
    },
    /**
     * Update the user's password in Firestore profile.
     * Stored alongside the profile for retrieval in the profile modal.
     * @param {string} password
     */
    updateProfilePassword: function (password) {
      if (!password) return;
      if (typeof crypto === 'undefined' || !crypto.subtle || typeof TextEncoder === 'undefined') {
        console.warn('Secure password hashing APIs are unavailable; skipping passwordHash sync.');
        _removeLegacyProfilePassword(_getUserDocRef());
        return;
      }
      var profile = (_memoryCache && _memoryCache.profile) ? _memoryCache.profile : {};
      var salt = new Uint8Array(PASSWORD_HASH_SALT_BYTES);
      crypto.getRandomValues(salt);
      var iterations = PASSWORD_HASH_PBKDF2_ITERATIONS;
      crypto.subtle.importKey('raw', new TextEncoder().encode(String(password)), 'PBKDF2', false, ['deriveBits']).then(function (key) {
        return crypto.subtle.deriveBits({
          name: 'PBKDF2',
          salt: salt,
          iterations: iterations,
          hash: 'SHA-256'
        }, key, 256);
      }).then(function (bits) {
        var hashBytes = new Uint8Array(bits);
        profile.passwordHash = 'pbkdf2_sha256$' + iterations + '$' + _bytesToHex(salt) + '$' + _bytesToHex(hashBytes);
        if (profile.hasOwnProperty('password')) delete profile.password;
        if (_memoryCache) _memoryCache.profile = profile;
        queueUpdate('profile', profile);
        _removeLegacyProfilePassword(_getUserDocRef());
      }).catch(function () {
        console.warn('Failed to derive passwordHash for profile sync.');
      });
    },
    getAccessState: function () {
      if (!_memoryCache) return null;
      var access = _memoryCache.access && typeof _memoryCache.access === 'object' ? _memoryCache.access : {};
      if (access.isTrial === true) {
        var trialEndMs = _toMillis(access.trialEnd);
        if (trialEndMs > 0 && Date.now() > trialEndMs) {
          access.isPremium = false;
          access.isTrial = false;
          access.trialEnd = null;
          _memoryCache.access = access;
          _persistTrialExpiry(_getUserDocRef());
        }
      }
      return {
        isPremium: access.isPremium === true,
        isTrial: access.isTrial === true,
        trialEnd: access.trialEnd || null,
        hasPaid: access.hasPaid === true,
        isEarlyUser: access.isEarlyUser === true,
        createdAt: (_memoryCache.profile && _memoryCache.profile.createdAt) ? _memoryCache.profile.createdAt : null
      };
    },
    unlockPremium: function (paymentId, callback) {
      var docRef = _getUserDocRef();
      if (!docRef) {
        if (callback) callback('User not authenticated');
        return;
      }
      var payload = {
        access: {
          isPremium: true,
          hasPaid: true,
          isTrial: false,
          trialEnd: null
        }
      };
      if (paymentId) payload.lastPaymentId = String(paymentId);
      if (_memoryCache) {
        if (!_memoryCache.access || typeof _memoryCache.access !== 'object') _memoryCache.access = {};
        _memoryCache.access.isPremium = true;
        _memoryCache.access.hasPaid = true;
        _memoryCache.access.isTrial = false;
        _memoryCache.access.trialEnd = null;
        if (paymentId) _memoryCache.lastPaymentId = String(paymentId);
      }
      docRef.set(payload, { merge: true }).then(function () {
        if (callback) callback(null);
      }).catch(function (err) {
        if (callback) callback(err && err.message ? err.message : 'Premium unlock failed');
      });
    }
  };
})();
