/**
 * settings.js — User settings management
 *
 * Manages: dark mode, sound, vibration, difficulty
 * Stores settings in localStorage.
 */

var SETTINGS_KEY = 'quant_reflex_settings';

function loadSettings() {
  try {
    var raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_) { /* ignore */ }
  return { darkMode: false, sound: true, vibration: true, difficulty: 'medium', dailyGoal: 50 };
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
  });
  darkToggle.checked = settings.darkMode || false;

  soundToggle = rebind(soundToggle, 'change', function () {
    settings.sound = this.checked;
    saveSettings(settings);
    /* Only play confirmation sound when enabling sound */
    if (this.checked) {
      SoundEngine.play('settingsToggle');
    }
  });
  soundToggle.checked = settings.sound !== false;

  vibrationToggle = rebind(vibrationToggle, 'change', function () {
    settings.vibration = this.checked;
    saveSettings(settings);
    SoundEngine.play('settingsToggle');
  });
  vibrationToggle.checked = settings.vibration !== false;

  difficultySelect = rebind(difficultySelect, 'change', function () {
    settings.difficulty = this.value;
    saveSettings(settings);
    SoundEngine.play('settingsToggle');
  });
  difficultySelect.value = settings.difficulty || 'medium';

  /* Daily goal input */
  var dailyGoalInput = document.getElementById('dailyGoalInput');
  if (dailyGoalInput) {
    dailyGoalInput.value = settings.dailyGoal || 50;
    rebind(dailyGoalInput, 'change', function () {
      var val = parseInt(this.value);
      if (val >= 10 && val <= 500) {
        settings.dailyGoal = val;
        saveSettings(settings);
      }
    });
  }

  /* Clear Data button — opens modal */
  var clearDataBtn = document.getElementById('clearDataBtn');
  if (clearDataBtn) {
    rebind(clearDataBtn, 'click', function () {
      openClearDataModal();
    });
  }

  /* Logout button */
  var logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    rebind(logoutBtn, 'click', function () {
      if (typeof Auth !== 'undefined') {
        Auth.logout(function (err) {
          if (err) {
            alert('Logout failed: ' + err);
          } else {
            /* Reset sync state before reload */
            if (typeof FirestoreSync !== 'undefined') {
              FirestoreSync.resetSyncState();
            }
            /* Reload page for clean state — auth persistence keeps
               the user logged out, and all JS state is reset */
            window.location.reload();
          }
        });
      }
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
}

/**
 * Open the Clear Data modal with options.
 */
function openClearDataModal() {
  var modal = document.getElementById('clearDataModal');
  if (!modal) return;
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
 * @param {string} type - 'stats', 'formulas', or 'all'
 */
function openClearConfirmModal(type) {
  var modal = document.getElementById('clearConfirmModal');
  var textEl = document.getElementById('clearConfirmText');
  var cancelBtn = document.getElementById('clearConfirmCancel');
  var okBtn = document.getElementById('clearConfirmOk');
  if (!modal || !textEl) return;

  var messages = {
    stats: 'This will permanently reset all your statistics, streaks, and performance history. Continue?',
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
    if (typeof FirestoreSync !== 'undefined') {
      FirestoreSync.clearUserData(type, function (err) {
        if (err) {
          alert('Failed to clear data: ' + err);
        } else {
          if (type === 'stats') {
            /* Stats only — re-render settings view without reload */
            alert('Statistics cleared successfully.');
            if (typeof Router !== 'undefined') {
              Router.showView('settings');
            }
          } else {
            /* Formulas or all — reload page for clean DOM state.
               Auth persistence keeps the user logged in. */
            alert('Data cleared successfully.');
            window.location.reload();
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
        } catch (_) {}
      } else if (type === 'all') {
        resetProgress();
        try {
          localStorage.setItem('quant_custom_formulas', '{}');
          localStorage.setItem('quant_custom_topics', '[]');
          localStorage.setItem('quant_bookmarks', '[]');
          localStorage.removeItem('quant_reflex_settings');
        } catch (_) {}
      }
      if (type === 'stats') {
        alert('Statistics cleared successfully.');
        if (typeof Router !== 'undefined') {
          Router.showView('settings');
        }
      } else {
        alert('Data cleared successfully.');
        window.location.reload();
      }
    }
  };
}
