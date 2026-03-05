/**
 * settings.js — User settings management
 *
 * Manages: dark mode, sound, vibration, difficulty, reduced motion,
 *          skip questions, notifications, profile, account deletion.
 * Stores settings in localStorage and syncs to Firestore.
 */

var SETTINGS_KEY = 'quant_reflex_settings';

function loadSettings() {
  try {
    var raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_) { /* ignore */ }
  return {
    darkMode: false, sound: true, vibration: true, difficulty: 'medium',
    dailyGoal: 50, reducedMotion: false, skipEnabled: false, notificationsEnabled: false
  };
}

function saveSettings(s) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    if (typeof FirestoreSync !== 'undefined') {
      FirestoreSync.syncSettings(s);
    }
  } catch (e) {
    console.warn('Failed to save settings:', e);
  }
}

function getDifficulty() {
  return loadSettings().difficulty || 'medium';
}

/**
 * Show a toast notification.
 * @param {string} message - text to display
 * @param {number} [duration=3000] - ms before auto-dismiss
 */
function showToast(message, duration) {
  var container = document.getElementById('toastContainer');
  if (!container) return;
  var toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  container.appendChild(toast);
  /* Trigger enter animation */
  requestAnimationFrame(function () {
    toast.classList.add('toast-visible');
  });
  setTimeout(function () {
    toast.classList.remove('toast-visible');
    setTimeout(function () {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 300);
  }, duration || 3000);
}

/**
 * Initialize settings view controls.
 * Called when settings view is shown.
 */
function initSettingsView() {
  var settings = loadSettings();

  var darkToggle = document.getElementById('darkModeToggle');
  var soundToggle = document.getElementById('soundToggle');
  var vibrationToggle = document.getElementById('vibrationToggle');
  var difficultySelect = document.getElementById('difficultySelect');

  if (!darkToggle) return;

  /* Remove old listeners by cloning */
  function rebind(el, event, handler) {
    if (!el) return null;
    var newEl = el.cloneNode(true);
    el.parentNode.replaceChild(newEl, el);
    newEl.addEventListener(event, handler);
    return newEl;
  }

  darkToggle = rebind(darkToggle, 'change', function () {
    settings.darkMode = this.checked;
    document.body.classList.toggle('dark-mode', this.checked);
    saveSettings(settings);
    SoundEngine.play('settingsToggle');
    if (typeof triggerHaptic === 'function') triggerHaptic(15);
  });
  darkToggle.checked = settings.darkMode || false;

  soundToggle = rebind(soundToggle, 'change', function () {
    settings.sound = this.checked;
    saveSettings(settings);
    /* Only play confirmation sound when enabling sound */
    if (this.checked) {
      SoundEngine.play('settingsToggle');
    }
    if (typeof triggerHaptic === 'function') triggerHaptic(15);
  });
  soundToggle.checked = settings.sound !== false;

  vibrationToggle = rebind(vibrationToggle, 'change', function () {
    settings.vibration = this.checked;
    saveSettings(settings);
    SoundEngine.play('settingsToggle');
    /* Provide feedback vibration when turning on; skip check since user is toggling this */
    if (this.checked && typeof navigator.vibrate === 'function') navigator.vibrate(15);
  });
  vibrationToggle.checked = settings.vibration !== false;

  /* Reduced Motion toggle */
  var reducedMotionToggle = document.getElementById('reducedMotionToggle');
  if (reducedMotionToggle) {
    reducedMotionToggle = rebind(reducedMotionToggle, 'change', function () {
      settings.reducedMotion = this.checked;
      document.body.classList.toggle('reduced-motion', this.checked);
      saveSettings(settings);
      SoundEngine.play('settingsToggle');
    });
    reducedMotionToggle.checked = !!settings.reducedMotion;
  }

  /* Skip Question toggle */
  var skipToggle = document.getElementById('skipToggle');
  if (skipToggle) {
    skipToggle = rebind(skipToggle, 'change', function () {
      var toggle = this;
      if (toggle.checked && settings.difficulty === 'hard') {
        /* Revert toggle immediately */
        toggle.checked = false;
        showToast('Skip is disabled in Hard mode to maintain challenge.');
        return;
      }
      settings.skipEnabled = toggle.checked;
      saveSettings(settings);
      SoundEngine.play('settingsToggle');
    });
    skipToggle.checked = !!(settings.skipEnabled && settings.difficulty !== 'hard');
  }

  difficultySelect = rebind(difficultySelect, 'change', function () {
    settings.difficulty = this.value;
    /* If switching to Hard, disable skip */
    if (this.value === 'hard' && settings.skipEnabled) {
      settings.skipEnabled = false;
      var st = document.getElementById('skipToggle');
      if (st) st.checked = false;
      showToast('Skip is disabled in Hard mode to maintain challenge.');
    }
    saveSettings(settings);
    SoundEngine.play('settingsToggle');
  });
  difficultySelect.value = settings.difficulty || 'medium';

  /* Daily goal input */
  var dailyGoalInput = document.getElementById('dailyGoalInput');
  if (dailyGoalInput) {
    dailyGoalInput = rebind(dailyGoalInput, 'change', function () {
      var val = parseInt(this.value);
      if (val >= 10 && val <= 500) {
        settings.dailyGoal = val;
        saveSettings(settings);
      }
    });
    dailyGoalInput.value = settings.dailyGoal || 50;
  }

  /* Notifications toggle */
  var notifToggle = document.getElementById('notificationsToggle');
  if (notifToggle) {
    var notifEnabled = typeof NotificationManager !== 'undefined' && NotificationManager.isEnabled();
    notifToggle = rebind(notifToggle, 'change', function () {
      var toggle = this;
      if (typeof NotificationManager === 'undefined') return;
      if (toggle.checked) {
        NotificationManager.enable(function (err) {
          if (err) {
            toggle.checked = false;
            console.warn('Notifications could not be enabled:', err);
          }
        });
      } else {
        NotificationManager.disable();
      }
      SoundEngine.play('settingsToggle');
    });
    notifToggle.checked = notifEnabled;
  }

  /* App Guide button — opens modal */
  var appGuideBtn = document.getElementById('openAppGuide');
  if (appGuideBtn) {
    rebind(appGuideBtn, 'click', function () {
      openInfoModal('appGuideModal');
    });
  }

  /* About button — opens modal */
  var aboutBtn = document.getElementById('openAbout');
  if (aboutBtn) {
    rebind(aboutBtn, 'click', function () {
      openInfoModal('aboutModal');
    });
  }

  /* Clear Data button — opens modal */
  var clearDataBtn = document.getElementById('clearDataBtn');
  if (clearDataBtn) {
    rebind(clearDataBtn, 'click', function () {
      openClearDataModal();
    });
  }

  /* Profile button — opens profile modal */
  var profileBtn = document.getElementById('openProfileModal');
  if (profileBtn) {
    rebind(profileBtn, 'click', function () {
      openProfileModal();
    });
  }

  /* Logout button */
  var logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    rebind(logoutBtn, 'click', function () {
      if (typeof Auth !== 'undefined') {
        /* Flush pending Firestore writes and clear local state BEFORE
           signing out, while the user context is still valid */
        if (typeof FirestoreSync !== 'undefined') {
          FirestoreSync.resetSyncState();
        }
        Auth.logout(function (err) {
          if (err) {
            alert('Logout failed: ' + err);
          } else {
            /* Reload page for clean state — auth persistence keeps
               the user logged out, and all JS state is reset */
            window.location.reload();
          }
        });
      }
    });
  }

  /* Delete Account button */
  var deleteBtn = document.getElementById('deleteAccountBtn');
  if (deleteBtn) {
    rebind(deleteBtn, 'click', function () {
      openDeleteAccountModal();
    });
  }

  /* PWA install button */
  var installCard = document.getElementById('installCard');
  var installBtn = document.getElementById('installBtn');
  if (installCard && installBtn && window._deferredPrompt) {
    installCard.style.display = 'block';
    rebind(installBtn, 'click', function () {
      window._deferredPrompt.prompt();
      window._deferredPrompt.userChoice.then(function () {
        window._deferredPrompt = null;
        installCard.style.display = 'none';
      });
    });
  }

  /* Apply reduced motion on load */
  document.body.classList.toggle('reduced-motion', !!settings.reducedMotion);
}

/**
 * Open the Clear Data modal with options.
 */
function openClearDataModal() {
  var modal = document.getElementById('clearDataModal');
  if (!modal) return;
  /* Prevent duplicate overlays */
  var confirmModal = document.getElementById('clearConfirmModal');
  if (confirmModal) confirmModal.style.display = 'none';

  modal.style.display = 'flex';

  var cancelBtn = document.getElementById('clearDataCancel');
  var optionBtns = modal.querySelectorAll('.clear-option-btn');

  /* Cancel */
  function closeModal() {
    modal.style.display = 'none';
  }
  cancelBtn.onclick = closeModal;
  modal.onclick = function (e) {
    if (e.target === modal) closeModal();
  };

  /* Option handlers */
  for (var i = 0; i < optionBtns.length; i++) {
    optionBtns[i].onclick = function () {
      var type = this.getAttribute('data-clear');
      closeModal();
      openClearConfirmModal(type);
    };
  }
}

/**
 * Open a confirmation dialog before clearing data.
 * @param {string} type - 'stats', 'streaks', 'formulas', or 'all'
 */
function openClearConfirmModal(type) {
  var modal = document.getElementById('clearConfirmModal');
  var textEl = document.getElementById('clearConfirmText');
  var cancelBtn = document.getElementById('clearConfirmCancel');
  var okBtn = document.getElementById('clearConfirmOk');
  if (!modal || !textEl) return;

  var messages = {
    stats: 'This will permanently reset all your statistics and performance history. Continue?',
    streaks: 'This will permanently reset your current and best streaks. Continue?',
    formulas: 'This will permanently delete all your custom topics and added formulas. Continue?',
    all: 'This will permanently reset ALL your data including settings, statistics, formulas, and bookmarks. Continue?'
  };
  textEl.textContent = messages[type] || 'Are you sure?';
  modal.style.display = 'flex';

  function closeModal() {
    modal.style.display = 'none';
  }
  cancelBtn.onclick = closeModal;
  modal.onclick = function (e) {
    if (e.target === modal) closeModal();
  };

  okBtn.onclick = function () {
    closeModal();
    if (type === 'streaks') {
      /* Handle streaks clearing locally */
      try {
        var progress = JSON.parse(localStorage.getItem('quant_reflex_progress') || '{}');
        progress.currentStreak = 0;
        progress.bestStreak = 0;
        progress.dailyStreak = 0;
        progress.bestDailyStreak = 0;
        progress.lastPracticeDate = null;
        localStorage.setItem('quant_reflex_progress', JSON.stringify(progress));
        if (typeof FirestoreSync !== 'undefined') {
          FirestoreSync.syncStats(progress);
        }
      } catch (_) {}
      showToast('Streaks cleared successfully.');
      if (typeof Router !== 'undefined') {
        Router.showView('settings');
      }
      return;
    }

    if (typeof FirestoreSync !== 'undefined') {
      FirestoreSync.clearUserData(type, function (err) {
        if (err) {
          alert('Failed to clear data: ' + err);
        } else {
          if (type === 'stats') {
            /* Stats only — re-render settings view without reload */
            showToast('Statistics cleared successfully.');
            if (typeof Router !== 'undefined') {
              Router.showView('settings');
            }
          } else {
            /* Formulas or all — reload page for clean DOM state.
               Auth persistence keeps the user logged in. */
            showToast('Data cleared successfully.');
            setTimeout(function () { window.location.reload(); }, 500);
          }
        }
      });
    } else {
      /* Fallback: clear local data only */
      if (type === 'stats') {
        resetProgress();
      } else if (type === 'formulas') {
        try {
          localStorage.setItem('quant_custom_formulas', '{}');
          localStorage.setItem('quant_custom_topics', '[]');
          localStorage.setItem('quant_bookmarks', '[]');
        } catch (_) {}
      } else if (type === 'all') {
        resetProgress();
        try {
          localStorage.setItem('quant_reflex_settings', JSON.stringify({
            darkMode: false, sound: true, vibration: true, difficulty: 'medium',
            dailyGoal: 50, reducedMotion: false, skipEnabled: false, notificationsEnabled: false
          }));
          localStorage.setItem('quant_custom_formulas', '{}');
          localStorage.setItem('quant_custom_topics', '[]');
          localStorage.setItem('quant_bookmarks', '[]');
          localStorage.setItem('quant_quick_links', JSON.stringify(['fractionTable', 'tablesContainer', 'formulaSections', 'mentalTricks']));
          localStorage.setItem('quant_notifications_enabled', 'false');
        } catch (_) {}
        if (typeof NotificationManager !== 'undefined') {
          NotificationManager.cancelScheduledNotifications();
        }
      }
      if (type === 'stats') {
        showToast('Statistics cleared successfully.');
        if (typeof Router !== 'undefined') {
          Router.showView('settings');
        }
      } else {
        showToast('Data cleared successfully.');
        setTimeout(function () { window.location.reload(); }, 500);
      }
    }
  };
}

/**
 * Open the profile modal showing user details.
 */
function openProfileModal() {
  var modal = document.getElementById('profileModal');
  if (!modal) return;
  modal.style.display = 'flex';

  var nameInput = document.getElementById('profileName');
  var usernameInput = document.getElementById('profileUsername');
  var joinedInput = document.getElementById('profileJoined');
  var passwordInput = document.getElementById('profilePassword');
  var cancelBtn = document.getElementById('profileCancel');
  var saveBtn = document.getElementById('profileSave');

  /* Populate fields from Firestore cache or localStorage */
  var profile = {};
  try {
    if (typeof FirestoreSync !== 'undefined' && FirestoreSync._getCache) {
      var cache = FirestoreSync._getCache();
      if (cache && cache.profile) profile = cache.profile;
    }
  } catch (_) {}

  if (nameInput) nameInput.value = profile.name || '';
  if (usernameInput) usernameInput.value = profile.username || '';
  if (joinedInput) {
    var joinedDate = profile.createdAt ? new Date(profile.createdAt) : null;
    joinedInput.value = joinedDate ? joinedDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '—';
  }
  if (passwordInput) passwordInput.value = '';

  function closeModal() {
    modal.style.display = 'none';
  }

  cancelBtn.onclick = closeModal;
  modal.onclick = function (e) {
    if (e.target === modal) closeModal();
  };

  saveBtn.onclick = function () {
    var newName = nameInput ? nameInput.value.trim() : '';
    var newPassword = passwordInput ? passwordInput.value : '';

    /* Update name in Firestore */
    if (newName && typeof FirestoreSync !== 'undefined') {
      FirestoreSync.updateProfileName(newName);
    }

    /* Update password via Firebase Auth */
    if (newPassword && newPassword.length >= 6) {
      if (typeof Auth !== 'undefined' && Auth.getCurrentUser()) {
        Auth.getCurrentUser().updatePassword(newPassword).then(function () {
          showToast('Password updated successfully.');
        }).catch(function (err) {
          showToast('Password update failed: ' + err.message);
        });
      }
    } else if (newPassword && newPassword.length < 6) {
      showToast('Password must be at least 6 characters.');
      return;
    }

    if (newName) {
      showToast('Profile updated.');
    }
    closeModal();
  };
}

/**
 * Open the delete account confirmation modal.
 */
function openDeleteAccountModal() {
  var modal = document.getElementById('deleteAccountModal');
  if (!modal) return;
  modal.style.display = 'flex';

  var cancelBtn = document.getElementById('deleteAccountCancel');
  var confirmBtn = document.getElementById('deleteAccountConfirm');

  function closeModal() {
    modal.style.display = 'none';
  }

  cancelBtn.onclick = closeModal;
  modal.onclick = function (e) {
    if (e.target === modal) closeModal();
  };

  confirmBtn.onclick = function () {
    closeModal();
    if (typeof Auth === 'undefined' || !Auth.getCurrentUser()) {
      showToast('Unable to delete account. Not logged in.');
      return;
    }

    var user = Auth.getCurrentUser();

    /**
     * Delete account in proper order:
     * 1. Delete Firestore user document (while auth context is valid)
     * 2. Clear all local data
     * 3. Delete Firebase Auth account (last — invalidates the session)
     */
    function deleteAuthAndReload() {
      try {
        localStorage.clear();
      } catch (_) {}
      user.delete().then(function () {
        window.location.reload();
      }).catch(function (err) {
        showToast('Account deletion failed: ' + err.message);
      });
    }

    if (typeof FirebaseApp !== 'undefined' && FirebaseApp.isReady()) {
      var db = FirebaseApp.getDb();
      var userId = FirebaseApp.getUserId();
      if (db && userId) {
        db.collection('users').doc(userId).delete()
          .then(deleteAuthAndReload)
          .catch(function (err) {
            console.warn('Failed to delete Firestore user document:', err);
            /* Proceed with auth deletion even if Firestore delete fails */
            deleteAuthAndReload();
          });
        return;
      }
    }

    /* No Firestore — just clear and delete auth */
    deleteAuthAndReload();
  };
}

/**
 * Open a full-screen info modal (App Guide or About).
 * @param {string} modalId - DOM id of the modal overlay
 */
function openInfoModal(modalId) {
  var modal = document.getElementById(modalId);
  if (!modal) return;
  modal.style.display = 'block';
  modal.classList.remove('closing');
  SoundEngine.play('tableModal');

  var closeBtn = modal.querySelector('.info-modal-close');

  function closeModal() {
    modal.classList.add('closing');
    SoundEngine.play('tableModal');
    document.removeEventListener('keydown', _infoModalEscapeHandler);
    _infoModalEscapeHandler = null;
    setTimeout(function () {
      modal.style.display = 'none';
      modal.classList.remove('closing');
    }, 200);
  }

  /* Store handler reference on module scope for cleanup by _closeAllInfoModals */
  _infoModalEscapeHandler = function (e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeModal();
    }
  };

  if (closeBtn) closeBtn.onclick = closeModal;
  modal.onclick = function (e) {
    if (e.target === modal) closeModal();
  };
  document.addEventListener('keydown', _infoModalEscapeHandler);
}

/* Reference to the active info modal Escape handler for cleanup */
var _infoModalEscapeHandler = null;
