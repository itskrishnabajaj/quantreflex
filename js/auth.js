/**
 * auth.js — Firebase Authentication module
 *
 * Manages user authentication using Firebase Auth with email/password.
 * Converts usernames to email format internally for Firebase compatibility.
 * Replaces the previous device-based identity system.
 */

var Auth = (function () {
  var _auth = null;
  var _currentUser = null;
  var _authReady = false;
  var _authReadyCallbacks = [];

  var EMAIL_DOMAIN = 'quantreflex.app';

  /**
   * Convert a username to a valid email for Firebase Auth.
   * @param {string} username
   * @returns {string}
   */
  function _usernameToEmail(username) {
    return sanitizeUsername(username) + '@' + EMAIL_DOMAIN;
  }

  /**
   * Sanitize username: lowercase, trim, allow only alphanumeric and underscore.
   * @param {string} username
   * @returns {string}
   */
  function sanitizeUsername(username) {
    if (!username) return '';
    return username.toLowerCase().trim().replace(/[^a-z0-9_]/g, '');
  }

  /**
   * Validate username and password inputs.
   * @param {string} username
   * @param {string} password
   * @returns {string|null} Error message or null if valid
   */
  function _validate(username, password) {
    if (!username || username.length < 3) {
      return 'Username must be at least 3 characters.';
    }
    if (username.length > 30) {
      return 'Username must be 30 characters or less.';
    }
    if (!password || password.length < 6) {
      return 'Password must be at least 6 characters.';
    }
    return null;
  }

  /**
   * Initialize Firebase Auth.
   * Must be called after FirebaseApp.init().
   */
  function init() {
    if (!FirebaseApp.isConfigured() || typeof firebase === 'undefined' || !firebase.auth) {
      return;
    }

    try {
      _auth = firebase.auth();
      /* Set persistence to LOCAL — survives browser restart */
      _auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(function (err) {
        console.warn('Auth persistence error:', err);
      });

      /* Listen for auth state changes */
      _auth.onAuthStateChanged(function (user) {
        var previousUser = _currentUser;
        _currentUser = user;

        /* If transitioning away from an authenticated user (logout, token
           expiry, or user switch), reset the Firestore sync layer so no
           cached data from the previous user leaks into the next session.
           This is a defense-in-depth measure — the logout button handler
           also calls resetSyncState(), but this covers edge cases like
           token revocation or sign-out from another tab. */
        if (previousUser && (!user || user.uid !== previousUser.uid)) {
          if (typeof FirestoreSync !== 'undefined') {
            FirestoreSync.resetSyncState();
          }
        }

        _authReady = true;
        /* Fire all waiting callbacks */
        for (var i = 0; i < _authReadyCallbacks.length; i++) {
          try { _authReadyCallbacks[i](user); } catch (e) { console.warn('Auth callback error:', e); }
        }
        _authReadyCallbacks = [];
      });
    } catch (e) {
      console.warn('Auth initialization failed:', e);
    }
  }

  /**
   * Register a callback to fire when auth state is determined.
   * If auth is already ready, fires immediately.
   * @param {function} callback - receives the user object (or null)
   */
  function onAuthReady(callback) {
    if (_authReady) {
      callback(_currentUser);
    } else {
      _authReadyCallbacks.push(callback);
    }
  }

  /**
   * Sign up a new user.
   * @param {string} username
   * @param {string} password
   * @param {function} callback - receives (error, user)
   */
  function signup(username, password, callback) {
    var clean = sanitizeUsername(username);
    var err = _validate(clean, password);
    if (err) {
      callback(err, null);
      return;
    }

    if (!_auth) {
      callback('Authentication service not available.', null);
      return;
    }

    var email = _usernameToEmail(clean);
    _auth.createUserWithEmailAndPassword(email, password)
      .then(function (cred) {
        _currentUser = cred.user;
        callback(null, cred.user);
      })
      .catch(function (error) {
        var msg = 'Account creation failed.';
        if (error.code === 'auth/email-already-in-use') {
          msg = 'This username is already taken.';
        } else if (error.code === 'auth/weak-password') {
          msg = 'Password is too weak. Use at least 6 characters.';
        } else if (error.code === 'auth/invalid-email') {
          msg = 'Invalid username format.';
        }
        callback(msg, null);
      });
  }

  /**
   * Log in an existing user.
   * @param {string} username
   * @param {string} password
   * @param {function} callback - receives (error, user)
   */
  function login(username, password, callback) {
    var clean = sanitizeUsername(username);
    var err = _validate(clean, password);
    if (err) {
      callback(err, null);
      return;
    }

    if (!_auth) {
      callback('Authentication service not available.', null);
      return;
    }

    var email = _usernameToEmail(clean);
    _auth.signInWithEmailAndPassword(email, password)
      .then(function (cred) {
        _currentUser = cred.user;
        callback(null, cred.user);
      })
      .catch(function (error) {
        var msg = 'Login failed.';
        if (error.code === 'auth/user-not-found') {
          msg = 'No account found with this username.';
        } else if (error.code === 'auth/wrong-password') {
          msg = 'Incorrect password.';
        } else if (error.code === 'auth/invalid-credential') {
          msg = 'Invalid username or password.';
        } else if (error.code === 'auth/too-many-requests') {
          msg = 'Too many attempts. Please try again later.';
        }
        callback(msg, null);
      });
  }

  /**
   * Log out the current user.
   * @param {function} [callback] - optional callback receives (error)
   */
  function logout(callback) {
    if (!_auth) {
      if (callback) callback('Authentication service not available.');
      return;
    }

    _auth.signOut()
      .then(function () {
        _currentUser = null;
        if (callback) callback(null);
      })
      .catch(function (error) {
        if (callback) callback('Logout failed: ' + error.message);
      });
  }

  /**
   * Get the current Firebase user object.
   * @returns {object|null}
   */
  function getCurrentUser() {
    return _currentUser;
  }

  /**
   * Get the current user's UID.
   * @returns {string|null}
   */
  function getUserId() {
    return _currentUser ? _currentUser.uid : null;
  }

  /**
   * Check if a user is currently logged in.
   * @returns {boolean}
   */
  function isLoggedIn() {
    return _currentUser !== null;
  }

  return {
    init: init,
    onAuthReady: onAuthReady,
    signup: signup,
    login: login,
    logout: logout,
    getCurrentUser: getCurrentUser,
    getUserId: getUserId,
    isLoggedIn: isLoggedIn,
    sanitizeUsername: sanitizeUsername
  };
})();
