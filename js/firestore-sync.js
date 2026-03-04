/**
 * firestore-sync.js — Firestore data synchronization layer
 *
 * Syncs localStorage data with Firestore using device-based user profiles.
 * Uses local caching for fast access and batched updates for efficiency.
 *
 * Firestore structure:
 *   users/{deviceId}
 *     ├── settings
 *     ├── stats (progress data)
 *     ├── quickLinks
 *     ├── customTopics
 *     ├── customFormulas
 *     └── bookmarks
 */

var FirestoreSync = (function () {
  var _syncTimer = null;
  var _pendingUpdates = {};
  var _memoryCache = null; /* In-memory cache of the user document */
  var _dataLoaded = false; /* Whether initial load has completed */
  var _drillActive = false; /* Whether a drill is in progress (defers syncing) */
  var SYNC_DEBOUNCE_MS = 2000; /* batch updates every 2 seconds */

  /**
   * Get the Firestore document reference for the current user.
   * @returns {object|null} Document reference or null
   */
  function _getUserDocRef() {
    if (!FirebaseApp.isReady()) return null;
    var db = FirebaseApp.getDb();
    var deviceId = FirebaseApp.getDeviceId();
    return db.collection('users').doc(deviceId);
  }

  /**
   * Load all user data from Firestore and merge into localStorage.
   * Uses in-memory cache to prevent duplicate reads within the same session.
   * Called on app startup.
   * @param {function} [callback] - Optional callback when done
   */
  function loadFromFirestore(callback) {
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

    docRef.get().then(function (doc) {
      if (doc.exists) {
        var data = doc.data();
        _memoryCache = data;
        _dataLoaded = true;
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
   * Pushes existing local data or initializes with defaults.
   */
  function _createDefaultDocument() {
    var docRef = _getUserDocRef();
    if (!docRef) return;

    var defaults = {
      settings: { darkMode: false, sound: true, vibration: true, difficulty: 'medium', dailyGoal: 50 },
      stats: {
        totalAttempted: 0, totalCorrect: 0,
        bestStreak: 0, currentStreak: 0,
        drillSessions: 0, timedTestSessions: 0,
        dailyStreak: 0, lastActiveDate: null,
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

    /* Override defaults with any existing local data */
    try {
      var localSettings = localStorage.getItem('quant_reflex_settings');
      if (localSettings) defaults.settings = JSON.parse(localSettings);
    } catch (_) {}
    try {
      var localStats = localStorage.getItem('quant_reflex_progress');
      if (localStats) defaults.stats = JSON.parse(localStats);
    } catch (_) {}
    try {
      var localLinks = localStorage.getItem('quant_quick_links');
      if (localLinks) defaults.quickLinks = JSON.parse(localLinks);
    } catch (_) {}
    try {
      var localTopics = localStorage.getItem('quant_custom_topics');
      if (localTopics) defaults.customTopics = JSON.parse(localTopics);
    } catch (_) {}
    try {
      var localFormulas = localStorage.getItem('quant_custom_formulas');
      if (localFormulas) defaults.customFormulas = JSON.parse(localFormulas);
    } catch (_) {}
    try {
      var localBookmarks = localStorage.getItem('quant_bookmarks');
      if (localBookmarks) defaults.bookmarks = JSON.parse(localBookmarks);
    } catch (_) {}

    _memoryCache = defaults;
    _dataLoaded = true;

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
    if (!FirebaseApp.isReady()) return;

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

  return {
    loadFromFirestore: loadFromFirestore,
    pushAllToFirestore: pushAllToFirestore,
    syncSettings: syncSettings,
    syncStats: syncStats,
    syncQuickLinks: syncQuickLinks,
    syncCustomTopics: syncCustomTopics,
    syncCustomFormulas: syncCustomFormulas,
    syncBookmarks: syncBookmarks,
    beginDrillBatch: beginDrillBatch,
    endDrillBatch: endDrillBatch
  };
})();
