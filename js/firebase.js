/**
 * firebase.js — Firebase Firestore initialization and device ID management
 *
 * Initializes Firebase App and Firestore.
 * Manages device-based user identity (no authentication required).
 * Exports initialized database instance via global FirebaseApp object.
 *
 * IMPORTANT: Replace the firebaseConfig values with your own Firebase project config.
 * See FIREBASE_SETUP.md for instructions.
 */

var FirebaseApp = (function () {
  var _db = null;
  var _deviceId = null;
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
   * Get or generate a persistent device ID.
   * Stored in localStorage so it survives page reloads.
   * @returns {string} The device ID
   */
  function getDeviceId() {
    if (_deviceId) return _deviceId;
    try {
      _deviceId = localStorage.getItem('deviceId');
      if (!_deviceId) {
        _deviceId = 'device_' + _generateId();
        localStorage.setItem('deviceId', _deviceId);
      }
    } catch (e) {
      /* Fallback if localStorage is unavailable */
      _deviceId = 'device_' + _generateId();
    }
    return _deviceId;
  }

  /**
   * Generate a random ID string.
   * Uses crypto.randomUUID if available, otherwise falls back to manual generation.
   * @returns {string}
   */
  function _generateId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    /* Fallback for older browsers — generates UUID v4 format */
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      var v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

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
   * Initialize Firebase and Firestore.
   * Call this once on app startup.
   * @returns {boolean} true if successfully initialized
   */
  function init() {
    if (_initialized) return true;

    /* Ensure device ID is generated on first launch */
    getDeviceId();

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
    getDeviceId: getDeviceId,
    isReady: isReady,
    isConfigured: isConfigured
  };
})();
