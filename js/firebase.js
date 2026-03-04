/**
 * firebase.js — Firebase initialization and user identity management
 *
 * Initializes Firebase App, Firestore, and Auth.
 * Manages user identity via Firebase Authentication.
 * Falls back to device ID for local-only mode when Firebase is not configured.
 * Exports initialized database instance via global FirebaseApp object.
 *
 * IMPORTANT: Replace the firebaseConfig values with your own Firebase project config.
 * See FIREBASE_SETUP.md for instructions.
 */

var FirebaseApp = (function () {
  var _db = null;
  var _initialized = false;

  /**
   * Firebase project configuration.
   * NOTE: Firebase client-side API keys are designed to be public.
   * Access is controlled by Firebase Security Rules, not by hiding the key.
   * See FIREBASE_SETUP.md for security rules configuration.
   */
  var firebaseConfig = {
    apiKey: 'AIzaSyDHTnIhjlyLy6CGOeLHfAIjIX_Bd4kSfco',
    authDomain: 'quant-reflex-trainer.firebaseapp.com',
    projectId: 'quant-reflex-trainer',
    storageBucket: 'quant-reflex-trainer.firebasestorage.app',
    messagingSenderId: '438863369800',
    appId: '1:438863369800:web:eea1aa154fdd6d5d852a7d'
  };

  /**
   * Check if Firebase SDK scripts are loaded and config is set.
   * @returns {boolean}
   */
  function isConfigured() {
    return firebaseConfig.apiKey &&
           firebaseConfig.projectId &&
           typeof firebase !== 'undefined';
  }

  /**
   * Get the current user ID from Firebase Auth.
   * Returns the authenticated user's UID if logged in, null otherwise.
   * @returns {string|null}
   */
  function getUserId() {
    if (typeof Auth !== 'undefined' && Auth.isLoggedIn()) {
      return Auth.getUserId();
    }
    return null;
  }

  /**
   * Initialize Firebase, Firestore, and Auth.
   * Call this once on app startup.
   * @returns {boolean} true if successfully initialized
   */
  function init() {
    if (_initialized) return true;

    if (!isConfigured()) {
      console.info('Firebase not configured. App will use localStorage only. See FIREBASE_SETUP.md');
      return false;
    }

    try {
      /* Initialize Firebase App */
      if (!firebase.apps || firebase.apps.length === 0) {
        firebase.initializeApp(firebaseConfig);
      }

      /* Initialize Firestore with offline persistence */
      _db = firebase.firestore();
      _db.enablePersistence({ synchronizeTabs: true }).catch(function (err) {
        if (err.code === 'failed-precondition') {
          console.warn('Firestore persistence failed: multiple tabs open');
        } else if (err.code === 'unimplemented') {
          console.warn('Firestore persistence not supported in this browser');
        }
      });

      /* Initialize Auth module */
      if (typeof Auth !== 'undefined') {
        Auth.init();
      }

      _initialized = true;
      return true;
    } catch (e) {
      console.warn('Firebase initialization failed:', e);
      return false;
    }
  }

  /**
   * Get the Firestore database instance.
   * @returns {object|null} Firestore db or null if not initialized
   */
  function getDb() {
    return _db;
  }

  /**
   * Check if Firebase is initialized and ready.
   * @returns {boolean}
   */
  function isReady() {
    return _initialized && _db !== null;
  }

  return {
    init: init,
    getDb: getDb,
    getUserId: getUserId,
    isReady: isReady,
    isConfigured: isConfigured
  };
})();
