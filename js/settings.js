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

  /* Reset progress */
  var resetBtn = document.getElementById('resetBtn');
  rebind(resetBtn, 'click', function () {
    if (confirm('Reset all progress? This cannot be undone.')) {
      resetProgress();
      alert('Progress has been reset.');
    }
  });

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
