/**
 * firestore-sync.js — Firestore data synchronization layer
 *
 * Syncs localStorage data with Firestore using authenticated user profiles.
 * Uses local caching for fast access and batched updates for efficiency.
 *
 * Firestore structure:
 *   users/{userId}
 *     ├── profile (username, createdAt)
 *     ├── settings
 *     ├── stats (progress data)
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
  var SYNC_DEBOUNCE_MS = 2000; /* batch updates every 2 seconds */

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
        _memoryCache = data;
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

    var userId = FirebaseApp.getUserId();
    var username = userId || 'user';
    /* Extract display username from Firebase Auth email */
    if (typeof Auth !== 'undefined' && Auth.getCurrentUser() && Auth.getCurrentUser().email) {
      username = Auth.getCurrentUser().email.split('@')[0];
    }
    var defaults = {
      profile: {
        name: '',
        username: username,
        createdAt: new Date().toISOString()
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
      bookmarks: []
    };

    _memoryCache = defaults;
    _dataLoaded = true;

    /* Write clean defaults to localStorage so the app has consistent state */
    try {
      localStorage.setItem('quant_reflex_settings', JSON.stringify(defaults.settings));
      localStorage.setItem('quant_reflex_progress', JSON.stringify(defaults.stats));
      localStorage.setItem('quant_quick_links', JSON.stringify(defaults.quickLinks));
      localStorage.setItem('quant_custom_topics', JSON.stringify(defaults.customTopics));
      localStorage.setItem('quant_custom_formulas', JSON.stringify(defaults.customFormulas));
      localStorage.setItem('quant_bookmarks', JSON.stringify(defaults.bookmarks));
    } catch (_) {}

    docRef.set(defaults, { merge: true }).catch(function (err) {
      console.warn('Firestore default document creation failed:', err);
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
    queueUpdate('stats', stats);
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
      if (docRef) {
        docRef.set({ stats: resetStats }, { merge: true }).then(function () {
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
    }
  };
})();
