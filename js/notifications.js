/**
 * notifications.js — Push notification support using Firebase Cloud Messaging
 *
 * Features:
 *   - Request notification permission
 *   - Register FCM token and store in Firestore
 *   - Schedule local motivational notifications at 7 AM, 1 PM, 7 PM
 *   - Toggle notifications on/off from settings
 */

var NotificationManager = (function () {
  var VAPID_KEY = 'BA-OmaPVMtv6bPY2MIhP8SZANG9VlRsWtk_fh2Ypybvk4YPc25lG-BPbB4mR4nKeOMKDv2fFXOsBsQqf7gVTz5Y';
  var NOTIF_KEY = 'quant_notifications_enabled';
  var _schedulerTimers = [];

  var MOTIVATIONAL_MESSAGES = [
    { title: '🧮 Time to Practice!', body: 'A quick 5-minute mental math session can sharpen your skills.' },
    { title: '📐 Math Reflex Check', body: 'Keep your calculation speed sharp — practice now!' },
    { title: '🔥 Streak Alert!', body: 'Don\'t break your streak! Solve a few questions today.' },
    { title: '💪 You\'re Getting Better!', body: 'Consistent practice leads to exam success. Start now!' },
    { title: '🎯 Daily Goal Reminder', body: 'Have you hit your daily question target yet?' },
    { title: '🧠 Train Your Brain', body: 'Train your brain. 5 minutes of mental math now.' },
    { title: '⚡ Quick Drill Time', body: 'Just 5 questions can make a difference. Ready?' },
    { title: '📊 Check Your Progress', body: 'See how much you\'ve improved this week!' },
    { title: '🏆 Challenge Yourself', body: 'Try the timed test mode and beat your best score.' },
    { title: '✨ Stay Consistent', body: 'Your quant reflex improves with daily practice.' },
    { title: '📈 Build Your Percentile', body: 'Today\'s 5 drills build tomorrow\'s CAT percentile.' },
    { title: '🔢 Numbers Reward Consistency', body: 'Numbers reward consistency. Open the app and prove it.' },
    { title: '📱 Your Streak is Waiting', body: 'Your daily math streak is waiting.' },
    { title: '🎯 Ready for Another?', body: 'Ready for another quick challenge?' }
  ];

  /* Track last shown message index to avoid immediate repeats */
  var _lastMessageIndex = -1;

  /**
   * Check if notifications are enabled in local storage.
   * Falls back to checking settings.notifications for Firestore sync compatibility.
   * @returns {boolean}
   */
  function isEnabled() {
    try {
      var val = localStorage.getItem(NOTIF_KEY);
      if (val !== null) return val === 'true';
      /* Fallback: check settings object for Firestore-synced state */
      var s = JSON.parse(localStorage.getItem('quant_reflex_settings') || '{}');
      return s.notifications === true;
    } catch (_) { return false; }
  }

  /**
   * Save notification enabled state.
   * @param {boolean} enabled
   */
  function setEnabled(enabled) {
    try {
      localStorage.setItem(NOTIF_KEY, enabled ? 'true' : 'false');
    } catch (_) { /* ignore */ }

    /* Sync to settings in Firestore */
    var settings = loadSettings();
    settings.notifications = enabled;
    saveSettings(settings);
  }

  /**
   * Request notification permission and register FCM token.
   * @param {function} [callback] - receives (error, token)
   */
  function requestPermission(callback) {
    if (!('Notification' in window)) {
      if (callback) callback('Notifications not supported in this browser');
      return;
    }

    Notification.requestPermission().then(function (permission) {
      if (permission === 'granted') {
        _registerToken(callback);
      } else {
        if (callback) callback('Permission denied');
      }
    }).catch(function (err) {
      if (callback) callback(err.message || 'Permission request failed');
    });
  }

  /**
   * Register the FCM token and store it in Firestore.
   * @param {function} [callback]
   */
  function _registerToken(callback) {
    if (typeof firebase === 'undefined' || !firebase.messaging) {
      if (callback) callback('Firebase Messaging not available');
      return;
    }

    try {
      var messaging = firebase.messaging();
      messaging.getToken({ vapidKey: VAPID_KEY }).then(function (token) {
        if (token) {
          /* Store token in Firestore */
          _saveTokenToFirestore(token);
          if (callback) callback(null, token);
        } else {
          if (callback) callback('No token received');
        }
      }).catch(function (err) {
        if (callback) callback(err.message || 'Token registration failed');
      });
    } catch (e) {
      if (callback) callback(e.message || 'Messaging initialization failed');
    }
  }

  /**
   * Save FCM token to Firestore user document.
   * @param {string} token
   */
  function _saveTokenToFirestore(token) {
    if (typeof FirebaseApp === 'undefined' || !FirebaseApp.isReady()) return;
    var userId = FirebaseApp.getUserId();
    if (!userId) return;
    var db = FirebaseApp.getDb();
    db.collection('users').doc(userId).set({
      fcmToken: token,
      fcmTokenUpdatedAt: new Date().toISOString()
    }, { merge: true }).catch(function (err) {
      console.warn('Failed to save FCM token:', err);
    });
  }

  /**
   * Schedule local notification timers at 7 AM, 1 PM, 7 PM.
   * Falls back to local scheduling since FCM server-side scheduling
   * requires a backend. These timers work while the app is open.
   */
  function scheduleNotifications() {
    cancelScheduledNotifications();

    if (!isEnabled()) return;
    if (Notification.permission !== 'granted') return;

    var scheduleHours = [7, 13, 19]; /* 7 AM, 1 PM, 7 PM */

    for (var i = 0; i < scheduleHours.length; i++) {
      _scheduleAtHour(scheduleHours[i]);
    }
  }

  /**
   * Schedule a notification at a specific hour today or tomorrow.
   * @param {number} hour - 0-23
   */
  function _scheduleAtHour(hour) {
    var now = new Date();
    var target = new Date();
    target.setHours(hour, 0, 0, 0);

    /* If the time has passed today, schedule for tomorrow */
    if (target <= now) {
      target.setDate(target.getDate() + 1);
    }

    var delay = target.getTime() - now.getTime();
    var timer = setTimeout(function () {
      _showLocalNotification();
      /* Re-schedule for the next day */
      _scheduleAtHour(hour);
    }, delay);

    _schedulerTimers.push(timer);
  }

  /**
   * Show a local notification with a rotating motivational message.
   * Avoids repeating the same message consecutively.
   */
  function _showLocalNotification() {
    if (!isEnabled()) return;
    if (Notification.permission !== 'granted') return;

    /* Pick a random message, avoiding the last one shown */
    var idx;
    do {
      idx = Math.floor(Math.random() * MOTIVATIONAL_MESSAGES.length);
    } while (idx === _lastMessageIndex && MOTIVATIONAL_MESSAGES.length > 1);
    _lastMessageIndex = idx;
    var msg = MOTIVATIONAL_MESSAGES[idx];

    /* Use service worker for notifications when available (works in background) */
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.ready.then(function (registration) {
        registration.showNotification(msg.title, {
          body: msg.body,
          icon: './icons/icon-192.svg',
          badge: './icons/icon-192.svg',
          tag: 'quant-motivation',
          renotify: true,
          data: { url: './index.html#home' }
        });
      });
    } else {
      /* Fallback to basic notification */
      try {
        new Notification(msg.title, {
          body: msg.body,
          icon: './icons/icon-192.svg'
        });
      } catch (_) { /* ignore */ }
    }
  }

  /**
   * Cancel all scheduled notification timers.
   */
  function cancelScheduledNotifications() {
    for (var i = 0; i < _schedulerTimers.length; i++) {
      clearTimeout(_schedulerTimers[i]);
    }
    _schedulerTimers = [];
  }

  /**
   * Enable notifications: request permission, register token, schedule.
   * @param {function} [callback] - receives (error)
   */
  function enable(callback) {
    requestPermission(function (err) {
      if (err) {
        if (callback) callback(err);
        return;
      }
      setEnabled(true);
      scheduleNotifications();
      if (callback) callback(null);
    });
  }

  /**
   * Disable notifications: cancel scheduled, update state.
   */
  function disable() {
    setEnabled(false);
    cancelScheduledNotifications();
  }

  /**
   * Initialize notification state on app startup.
   * Re-schedules notifications if previously enabled.
   */
  function init() {
    if (isEnabled() && Notification.permission === 'granted') {
      scheduleNotifications();
    }
  }

  return {
    isEnabled: isEnabled,
    enable: enable,
    disable: disable,
    init: init,
    scheduleNotifications: scheduleNotifications,
    cancelScheduledNotifications: cancelScheduledNotifications
  };
})();
