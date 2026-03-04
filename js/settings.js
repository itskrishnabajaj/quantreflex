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
  return { darkMode: false, sound: true, vibration: true, difficulty: 'medium' };
}

function saveSettings(s) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
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

  darkToggle.checked = settings.darkMode || false;
  soundToggle.checked = settings.sound !== false;
  vibrationToggle.checked = settings.vibration !== false;
  difficultySelect.value = settings.difficulty || 'medium';

  /* Remove old listeners by cloning */
  function rebind(el, event, handler) {
    var newEl = el.cloneNode(true);
    el.parentNode.replaceChild(newEl, el);
    newEl.addEventListener(event, handler);
    return newEl;
  }

  darkToggle = rebind(darkToggle, 'change', function () {
    settings.darkMode = this.checked;
    document.body.classList.toggle('dark-mode', this.checked);
    saveSettings(settings);
  });

  soundToggle = rebind(soundToggle, 'change', function () {
    settings.sound = this.checked;
    saveSettings(settings);
  });

  vibrationToggle = rebind(vibrationToggle, 'change', function () {
    settings.vibration = this.checked;
    saveSettings(settings);
  });

  difficultySelect = rebind(difficultySelect, 'change', function () {
    settings.difficulty = this.value;
    saveSettings(settings);
  });

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
