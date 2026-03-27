/**
 * app.js — SPA application bootstrap
 *
 * Responsibilities:
 *   1. Register the service worker
 *   2. Handle the PWA install prompt
 *   3. Apply saved dark mode setting
 *   4. Initialize Firebase and authentication
 *   5. Initialize the SPA router
 *   6. Set up view initialization callbacks
 *   7. Manage swipe gesture navigation
 *   8. Manage customizable quick study links
 */

/* ---- Detect runtime mode (PWA standalone vs browser tab) ---- */
(function () {
  var isPWA = false;
  try {
    isPWA = !!(
      (window.matchMedia && (
        window.matchMedia('(display-mode: standalone)').matches ||
        window.matchMedia('(display-mode: fullscreen)').matches
      )) ||
      navigator.standalone === true
    );
  } catch (e) { /* ignore */ }

  document.documentElement.classList.add(isPWA ? 'pwa-mode' : 'web-mode');
  document.body.classList.add(isPWA ? 'pwa-mode' : 'web-mode');
})();

/* ---- Apply dark mode, theme and reduced motion from settings immediately ---- */
(function () {
  try {
    var settings = JSON.parse(localStorage.getItem('quant_reflex_settings') || '{}');
    if (settings.darkMode) document.body.classList.add('dark-mode');
    if (settings.reducedMotion) document.body.classList.add('reduced-motion');
    if (settings.theme === 'playful') document.body.classList.add('theme-playful');
  } catch (_) { /* ignore */ }
})();

/* ---- Initialize Firebase ---- */
(function () {
  if (typeof FirebaseApp !== 'undefined') {
    FirebaseApp.init();
  }
})();

/* ---- Prevent native context menu on long-press (native app feel) ---- */
document.addEventListener('contextmenu', function (e) {
  /* Allow context menu only on inputs and textareas */
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
  e.preventDefault();
});

/* ---- Prevent accidental image/element dragging ---- */
document.addEventListener('dragstart', function (e) {
  e.preventDefault();
});

/* ---- Ripple effect on interactive elements ---- */
(function () {
  var RIPPLE_SELECTORS = '.btn, .mode-card, .category-btn, .study-card, .learn-jump-btn, .table-select-btn, .clear-option-btn, .quick-link-option, .bottom-nav a';

  document.addEventListener('pointerdown', function (e) {
    var target = e.target.closest(RIPPLE_SELECTORS);
    if (!target) return;

    /* Ensure ripple container setup */
    var style = window.getComputedStyle(target);
    if (style.position === 'static') {
      target.style.position = 'relative';
    }
    if (style.overflow !== 'hidden') {
      target.style.overflow = 'hidden';
    }

    var rect = target.getBoundingClientRect();
    var size = Math.max(rect.width, rect.height) * 1.4;
    var ripple = document.createElement('span');
    ripple.className = 'ripple-effect';
    ripple.style.width = size + 'px';
    ripple.style.height = size + 'px';
    ripple.style.left = (e.clientX - rect.left - size / 2) + 'px';
    ripple.style.top = (e.clientY - rect.top - size / 2) + 'px';
    target.appendChild(ripple);

    /* Remove ripple after animation */
    setTimeout(function () {
      if (ripple.parentNode) ripple.parentNode.removeChild(ripple);
    }, 500);
  });
})();

/* ---- Haptic feedback utility ---- */
function triggerHaptic(pattern) {
  try {
    var settings = JSON.parse(localStorage.getItem('quant_reflex_settings') || '{}');
    if (settings.vibration === false) return;
    if (typeof navigator.vibrate !== 'function') return;
    navigator.vibrate(pattern || 10);
  } catch (_) { /* ignore */ }
}

/* ---- Numpad key press visual feedback ---- */
(function () {
  document.addEventListener('pointerdown', function (e) {
    var btn = e.target.closest('.numpad-btn');
    if (!btn) return;
    btn.classList.add('pressed');
    triggerHaptic(8);
  });

  document.addEventListener('pointerup', function () {
    var pressed = document.querySelectorAll('.numpad-btn.pressed');
    for (var i = 0; i < pressed.length; i++) {
      pressed[i].classList.remove('pressed');
    }
  });

  document.addEventListener('pointercancel', function () {
    var pressed = document.querySelectorAll('.numpad-btn.pressed');
    for (var i = 0; i < pressed.length; i++) {
      pressed[i].classList.remove('pressed');
    }
  });
})();

/* ---- Global error handling for unhandled promise rejections ---- */
window.addEventListener('unhandledrejection', function (event) {
  console.warn('Unhandled promise rejection:', event.reason);
  event.preventDefault(); /* Prevent console error noise */
});

/* ---- Service Worker Registration ---- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker
      .register('./service-worker.js')
      .then(function (registration) {
        /* Detect a new SW waiting to activate and prompt user to reload */
        function onUpdateFound() {
          var newWorker = registration.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', function () {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              /* New version is ready — show a lightweight toast / reload prompt */
              _showUpdateToast();
            }
          });
        }

        if (registration.waiting && navigator.serviceWorker.controller) {
          _showUpdateToast();
        }
        registration.addEventListener('updatefound', onUpdateFound);

        /* Guard against infinite reload loops: only reload once per session */
        navigator.serviceWorker.addEventListener('controllerchange', function () {
          if (window._swReloading) return;
          window._swReloading = true;
          window.location.reload();
        });
      })
      .catch(function (err) { console.warn('SW registration failed:', err); });
  });
}

/* Show a non-blocking "Update available" banner at the bottom of the screen */
function _showUpdateToast() {
  if (document.getElementById('_swUpdateToast')) return;
  var toast = document.createElement('div');
  toast.id = '_swUpdateToast';
  toast.setAttribute('role', 'status');
  toast.style.cssText = [
    'position:fixed', 'bottom:72px', 'left:50%', 'transform:translateX(-50%)',
    'background:#1e293b', 'color:#f8fafc', 'padding:10px 18px',
    'border-radius:10px', 'font-size:14px', 'z-index:99999',
    'display:flex', 'align-items:center', 'gap:12px',
    'box-shadow:0 4px 16px rgba(0,0,0,.35)', 'max-width:90vw'
  ].join(';');
  var label = document.createElement('span');
  label.textContent = '🔄 Update available';
  var btn = document.createElement('button');
  btn.id = '_swUpdateBtn';
  btn.textContent = 'Reload';
  btn.style.cssText = 'background:#2563eb;color:#fff;border:none;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:13px;';
  toast.appendChild(label);
  toast.appendChild(btn);
  document.body.appendChild(toast);
  btn.addEventListener('click', function () {
    navigator.serviceWorker.getRegistration().then(function (reg) {
      if (reg && reg.waiting) {
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      } else {
        window.location.reload();
      }
    });
    toast.remove();
  });
}

/* ---- PWA Install Prompt ---- */
window._deferredPrompt = null;

window.addEventListener('beforeinstallprompt', function (e) {
  e.preventDefault();
  window._deferredPrompt = e;

  /* Show install card if settings view is active */
  var installCard = document.getElementById('installCard');
  if (installCard) {
    installCard.style.display = 'block';
  }
});

/* ---- Category name formatting for display ---- */
var _CATEGORY_LABELS = {
  'squares': 'Squares',
  'cubes': 'Cubes',
  'area': 'Area',
  'volume': 'Volume',
  'fractions': 'Fractions',
  'percentages': 'Percentages',
  'multiplication': 'Multiplication',
  'ratios': 'Ratios',
  'averages': 'Averages',
  'profit-loss': 'Profit & Loss',
  'time-speed-distance': 'Time, Speed & Distance',
  'time-and-work': 'Time & Work'
};

/**
 * Format a raw category key into a human-readable label.
 * @param {string} key - raw category key (e.g. 'time-and-work')
 * @returns {string} formatted label (e.g. 'Time & Work')
 */
function formatCategoryName(key) {
  if (!key) return '—';
  if (_CATEGORY_LABELS[key]) return _CATEGORY_LABELS[key];
  /* Fallback: capitalize and replace hyphens with spaces */
  return key.replace(/-/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
}

/* ---- Theme-Based Navigation Icon Switching ---- */
var _NAV_EMOJIS = {
  home: '🏠', practice: '🎯', learn: '📖', stats: '📊', settings: '⚙️'
};
var _NAV_SVGS = {
  home: 'appicons/tab/hometab.svg',
  practice: 'appicons/tab/practicetab.svg',
  learn: 'appicons/tab/learntab.svg',
  stats: 'appicons/tab/statstab.svg',
  settings: 'appicons/tab/settingstab.svg'
};
var _HEADER_LABELS = {
  'view-practice': { emoji: '🎯', label: 'Practice', view: 'practice' },
  'view-learn': { emoji: '📖', label: 'Learn', view: 'learn' },
  'view-stats': { emoji: '📊', label: 'Analytics', view: 'stats' },
  'view-settings': { emoji: '⚙️', label: 'Settings', view: 'settings' }
};
function _handleTabPopAnimationEnd() {
  this.classList.remove('tab-pop');
}

/**
 * Switch navigation and header icons based on theme.
 * Classic Blue: emoji icons, Playful Professional: SVG icons.
 * @param {string} theme - 'classic' or 'playful'
 */
function updateNavigationIcons(theme) {
  /* Update bottom nav icons */
  var navLinks = document.querySelectorAll('.bottom-nav a[data-view]');
  for (var i = 0; i < navLinks.length; i++) {
    var view = navLinks[i].getAttribute('data-view');
    var navIcon = navLinks[i].querySelector('.nav-icon');
    if (!navIcon) continue;
    navIcon.innerHTML = '';

    if (theme === 'playful' && _NAV_SVGS[view]) {
      var img = document.createElement('img');
      img.src = _NAV_SVGS[view];
      img.alt = '';
      img.width = 24;
      img.height = 24;
      img.draggable = false;
      navIcon.appendChild(img);
    } else {
      var span = document.createElement('span');
      span.className = 'nav-emoji';
      span.textContent = _NAV_EMOJIS[view] || '';
      navIcon.appendChild(span);
    }

    /* Re-attach animationend cleanup listener */
    var iconChild = navIcon.firstChild;
    if (iconChild) {
      iconChild.removeEventListener('animationend', _handleTabPopAnimationEnd);
      iconChild.addEventListener('animationend', _handleTabPopAnimationEnd);
    }
  }

  /* Update header icons (home header stays as title text, no icon) */
  for (var viewId in _HEADER_LABELS) {
    var viewEl = document.getElementById(viewId);
    if (!viewEl) continue;
    var h1 = viewEl.querySelector('header h1');
    if (!h1) continue;
    var info = _HEADER_LABELS[viewId];
    h1.textContent = '';

    if (theme === 'playful' && _NAV_SVGS[info.view]) {
      var hImg = document.createElement('img');
      hImg.src = _NAV_SVGS[info.view];
      hImg.alt = '';
      hImg.className = 'header-icon';
      hImg.width = 28;
      hImg.height = 28;
      hImg.draggable = false;
      h1.appendChild(hImg);
      h1.appendChild(document.createTextNode(' ' + info.label));
    } else {
      h1.textContent = info.emoji + ' ' + info.label;
    }
  }
}

/* ---- Active drill engine reference for cleanup ---- */
var _activeDrillEngine = null;
var _navTransitionInProgress = false;
var _practiceActionLocked = false;
/* True only while user is actively answering questions (after START pressed) */
var _drillSessionActive = false;
var _exitSessionMsg = 'Exit this session? Your progress will be lost.';
/* Prevents multiple exit dialogs from stacking */
var _exitDialogShowing = false;

/**
 * Enter drill session mode:
 * - set session active flag
 * - hide bottom navigation bar for immersive experience
 * - add body class for CSS adjustments (numpad positioning)
 */
function _enterDrillSession() {
  _drillSessionActive = true;
  var nav = document.querySelector('.bottom-nav');
  if (nav) nav.style.display = 'none';
  document.body.classList.add('drill-session-active');
  document.documentElement.classList.add('drill-session-active');
}

/**
 * Exit drill session mode (unified cleanup):
 * - reset session flag
 * - restore bottom navigation bar
 * - remove body class
 * - hide custom numpad and clean up input state
 */
function _exitDrillSession() {
  _drillSessionActive = false;
  var nav = document.querySelector('.bottom-nav');
  if (nav) nav.style.display = '';
  document.body.classList.remove('drill-session-active');
  document.documentElement.classList.remove('drill-session-active');
  hideCustomNumpad();
}

function _tryBeginNavTransition() {
  if (_navTransitionInProgress) return false;
  _navTransitionInProgress = true;
  setTimeout(function () {
    _navTransitionInProgress = false;
  }, 220);
  return true;
}

function _tryPracticeAction() {
  if (_practiceActionLocked) return false;
  _practiceActionLocked = true;
  setTimeout(function () {
    _practiceActionLocked = false;
  }, 220);
  return true;
}

function _resetPracticeUiToModes() {
  _customPracticeActive = false;
  var modeSelect = document.getElementById('modeSelect');
  var categorySelect = document.getElementById('categorySelect');
  var customPracticeConfig = document.getElementById('customPracticeConfig');
  var drillContainer = document.getElementById('drillContainer');
  if (modeSelect) modeSelect.style.display = 'block';
  if (categorySelect) categorySelect.style.display = 'none';
  if (customPracticeConfig) customPracticeConfig.style.display = 'none';
  if (drillContainer) {
    drillContainer.style.display = 'none';
    drillContainer.innerHTML = '';
  }
  _resetCustomPracticeState();
}

/**
 * Show a custom in-app exit confirmation dialog instead of native confirm().
 * Native confirm() can behave unreliably in TWA/WebView contexts,
 * sometimes ending the session even when Cancel is pressed.
 * @param {function} onConfirm - callback when user confirms exit
 */
function showExitSessionDialog(onConfirm) {
  if (_exitDialogShowing) return;
  _exitDialogShowing = true;

  function closeDialog(modalEl) {
    if (modalEl) modalEl.style.display = 'none';
    _exitDialogShowing = false;
  }

  var modal = document.getElementById('exitSessionModal');
  if (!modal) {
    /* Fallback: use native confirm if modal element is missing */
    var shouldExit = confirm(_exitSessionMsg);
    closeDialog(null);
    if (shouldExit) onConfirm();
    return;
  }

  modal.style.display = 'flex';

  var cancelBtn = document.getElementById('exitSessionCancel');
  var confirmBtn = document.getElementById('exitSessionConfirm');
  if (!cancelBtn || !confirmBtn) {
    var fallbackExit = confirm(_exitSessionMsg);
    closeDialog(modal);
    if (fallbackExit) onConfirm();
    return;
  }

  cancelBtn.onclick = function () {
    closeDialog(modal);
    /* Session continues — do nothing else */
  };

  confirmBtn.onclick = function () {
    closeDialog(modal);
    onConfirm();
  };

  /* Close on overlay click (treat as cancel) */
  modal.onclick = function (e) {
    if (e.target === modal) closeDialog(modal);
  };
}

/* Prevent accidental page close / tab close during active drill sessions */
window.addEventListener('beforeunload', function (e) {
  if (_drillSessionActive) {
    e.preventDefault();
    /* Modern browsers require returnValue to be set */
    e.returnValue = '';
  }
});

/**
 * Run the splash screen animation sequence and remove it when finished.
 * Stages: pause → bounce → blob emerge → amoeba expand → fill → fade out.
 * Uses CSS classes to trigger GPU-accelerated animations.
 * Falls back to an instant hide when reduced-motion is active.
 */
function _hideAppLoader() {
  var loader = document.getElementById('appLoader');
  if (!loader) return;

  /* Reduced motion — skip animation entirely */
  if (document.body.classList.contains('reduced-motion')) {
    loader.style.display = 'none';
    return;
  }

  /* Stage timing constants (ms) — keep in sync with CSS animation durations.
     Stages overlap slightly for fluid sequencing (~1.95 s total). */
  var BOUNCE_START = 200;   /* idle → bounce          */
  var BLOB_EMERGE  = 480;   /* blob fades in           */
  var BLOB_EXPAND  = 880;   /* amoeba growth begins    */
  var FILL_START   = 1380;  /* bg turns blue + emphasis */
  var FADEOUT_START = 1650;  /* dissolve out            */
  var REMOVE_AT    = 1950;  /* DOM cleanup             */

  /* Stage 1 — brief pause is implicit: the loader is already visible
     with a gentle idle pulse on the Q logo. */

  /* Stage 2 — Q bounce (replaces idle animation via higher specificity) */
  setTimeout(function () {
    loader.classList.add('splash-bounce');
  }, BOUNCE_START);

  /* Stage 3 — blob emerge (overlaps with bounce tail for organic feel) */
  setTimeout(function () {
    loader.classList.add('splash-blob-emerge');
  }, BLOB_EMERGE);

  /* Stage 4 — amoeba expansion (CSS source order overrides emerge animation;
     blob-emerge class stays so opacity: 1 forwards fill is not lost) */
  setTimeout(function () {
    loader.classList.add('splash-expand');
  }, BLOB_EXPAND);

  /* Stage 5 — full-screen blue fill + Q emphasis */
  setTimeout(function () {
    loader.classList.add('splash-fill');
  }, FILL_START);

  /* Stage 6 — fade out */
  setTimeout(function () {
    loader.classList.add('splash-fadeout');
  }, FADEOUT_START);

  /* Remove from DOM after animation completes */
  setTimeout(function () {
    if (loader && loader.parentNode) loader.parentNode.removeChild(loader);
  }, REMOVE_AT);
}

/**
 * Close all open info modals (App Guide, About).
 * Called on navigation to prevent stale modals.
 */
function _closeAllInfoModals() {
  var modals = document.querySelectorAll('.info-modal-overlay');
  for (var i = 0; i < modals.length; i++) {
    modals[i].style.display = 'none';
    modals[i].classList.remove('closing');
  }
  /* Clean up any active Escape key handler from openInfoModal */
  if (typeof _infoModalEscapeHandler === 'function') {
    document.removeEventListener('keydown', _infoModalEscapeHandler);
    _infoModalEscapeHandler = null;
  }
}

/* ---- Quick Study Links Configuration ---- */
var QUICK_LINKS_KEY = 'quant_quick_links';
var AVAILABLE_QUICK_LINKS = [
  { id: 'fractionTable', icon: '📐', title: 'Fraction → Percentage', desc: 'Master common fraction-to-percentage conversions.', type: 'learn' },
  { id: 'tablesContainer', icon: '✖️', title: 'Multiplication Tables', desc: 'Review tables from 1 to 30.', type: 'learn' },
  { id: 'formulaSections', icon: '📝', title: 'Quant Formulas', desc: 'Percentages, ratios, averages, area, volume and more.', type: 'learn' },
  { id: 'mentalTricks', icon: '💡', title: 'Shortcut Tricks', desc: 'Mental math tricks for faster calculations.', type: 'learn' },
  { id: 'squaresSection', icon: '🔢', title: 'Squares & Cubes', desc: 'Quick reference for squares and cubes.', type: 'learn' },
  { id: 'practice', icon: '🎯', title: 'Practice Drills', desc: 'Jump into practice drills and tests.', type: 'nav' },
  { id: 'stats', icon: '📊', title: 'Stats', desc: 'View your performance statistics.', type: 'nav' },
  { id: 'bookmarksSection', icon: '⭐', title: 'Starred Formulas', desc: 'View your bookmarked formulas.', type: 'learn' }
];
var DEFAULT_QUICK_LINKS = ['fractionTable', 'tablesContainer', 'formulaSections', 'mentalTricks'];

function loadQuickLinks() {
  try {
    var raw = localStorage.getItem(QUICK_LINKS_KEY);
    if (raw) {
      var data = JSON.parse(raw);
      if (Array.isArray(data) && data.length > 0) {
        /* Deduplicate and validate */
        var seen = {};
        var unique = [];
        for (var i = 0; i < data.length && unique.length < 4; i++) {
          if (typeof data[i] === 'string' && !seen[data[i]]) {
            seen[data[i]] = true;
            unique.push(data[i]);
          }
        }
        return unique.length > 0 ? unique : DEFAULT_QUICK_LINKS.slice();
      }
    }
  } catch (_) { /* ignore */ }
  return DEFAULT_QUICK_LINKS.slice();
}

function saveQuickLinks(links) {
  try {
    localStorage.setItem(QUICK_LINKS_KEY, JSON.stringify(links.slice(0, 4)));
    if (typeof FirestoreSync !== 'undefined') {
      FirestoreSync.syncQuickLinks(links.slice(0, 4));
    }
  } catch (_) { /* ignore */ }
}

function renderQuickStudyLinks() {
  var container = document.getElementById('quickStudyContainer');
  if (!container) return;
  container.innerHTML = '';
  var selectedIds = loadQuickLinks();

  for (var i = 0; i < selectedIds.length; i++) {
    var linkData = null;
    for (var j = 0; j < AVAILABLE_QUICK_LINKS.length; j++) {
      if (AVAILABLE_QUICK_LINKS[j].id === selectedIds[i]) {
        linkData = AVAILABLE_QUICK_LINKS[j];
        break;
      }
    }
    if (!linkData) continue;

    var card = document.createElement('a');
    card.className = 'study-card';

    if (linkData.type === 'learn') {
      card.href = '#learn';
      card.setAttribute('data-learn-section', linkData.id);
    } else {
      card.href = '#' + linkData.id;
    }

    card.innerHTML = '<h3>' + linkData.icon + ' ' + linkData.title + '</h3><p>' + linkData.desc + '</p>';
    container.appendChild(card);
  }

  /* Re-bind click handlers for learn section links */
  var studyLinks = container.querySelectorAll('[data-learn-section]');
  for (var s = 0; s < studyLinks.length; s++) {
    studyLinks[s].addEventListener('click', function (e) {
      e.preventDefault();
      var section = this.getAttribute('data-learn-section');
      Router.showView('learn');
      setTimeout(function () {
        var target = document.getElementById(section);
        if (target) {
          var header = target.querySelector('.collapsible-header');
          if (header) {
            var content = header.nextElementSibling;
            if (content && window.getComputedStyle(content).display === 'none') {
              toggleSection(header);
            }
          }
          target.scrollIntoView({ behavior: 'smooth' });
        }
      }, 100);
    });
  }

  /* Bind nav-type links */
  var navLinks = container.querySelectorAll('a[href^="#"]:not([data-learn-section])');
  for (var n = 0; n < navLinks.length; n++) {
    navLinks[n].addEventListener('click', function (e) {
      e.preventDefault();
      var view = this.getAttribute('href').replace('#', '');
      Router.showView(view);
    });
  }
}

function openQuickLinksEditor() {
  var selectedIds = loadQuickLinks();

  var overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  var modal = document.createElement('div');
  modal.className = 'modal-content';

  var html = '<h3 class="modal-title">Customize Quick Links</h3>';
  html += '<p class="secondary-text" style="margin-bottom:.75rem;">Select up to 4 quick links for your home screen.</p>';

  for (var i = 0; i < AVAILABLE_QUICK_LINKS.length; i++) {
    var link = AVAILABLE_QUICK_LINKS[i];
    var isChecked = selectedIds.indexOf(link.id) !== -1;
    html += '<label class="quick-link-option' + (isChecked ? ' selected' : '') + '">';
    html += '<input type="checkbox" value="' + link.id + '"' + (isChecked ? ' checked' : '') + ' />';
    html += '<span>' + link.icon + ' ' + link.title + '</span>';
    html += '</label>';
  }

  html += '<div class="modal-actions">';
  html += '<button class="btn modal-cancel">Cancel</button>';
  html += '<button class="btn accent modal-save">Save</button>';
  html += '</div>';

  modal.innerHTML = html;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  /* Limit to 4 selections */
  var checkboxes = modal.querySelectorAll('input[type="checkbox"]');
  function updateCheckboxStates() {
    var checkedCount = 0;
    for (var c = 0; c < checkboxes.length; c++) {
      if (checkboxes[c].checked) checkedCount++;
    }
    for (var d = 0; d < checkboxes.length; d++) {
      var label = checkboxes[d].closest('.quick-link-option');
      if (checkboxes[d].checked) {
        label.classList.add('selected');
        checkboxes[d].disabled = false;
      } else {
        label.classList.remove('selected');
        checkboxes[d].disabled = checkedCount >= 4;
      }
    }
  }

  for (var k = 0; k < checkboxes.length; k++) {
    checkboxes[k].addEventListener('change', updateCheckboxStates);
  }
  updateCheckboxStates();

  overlay.querySelector('.modal-cancel').addEventListener('click', function () {
    document.body.removeChild(overlay);
  });
  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) document.body.removeChild(overlay);
  });
  overlay.querySelector('.modal-save').addEventListener('click', function () {
    var newLinks = [];
    for (var m = 0; m < checkboxes.length; m++) {
      if (checkboxes[m].checked) newLinks.push(checkboxes[m].value);
    }
    if (newLinks.length === 0) newLinks = DEFAULT_QUICK_LINKS.slice();
    saveQuickLinks(newLinks);
    renderQuickStudyLinks();
    document.body.removeChild(overlay);
  });
}

/* ---- Swipe Navigation ---- */
function initSwipeNavigation() {
  var viewOrder = ['home', 'practice', 'learn', 'stats', 'settings'];
  var touchStartX = 0;
  var touchStartY = 0;
  var touchStartTime = 0;
  var isSwiping = false;
  var swipeLocked = false;
  var SWIPE_THRESHOLD = 40;
  var SWIPE_VELOCITY_THRESHOLD = 0.25;
  var VERTICAL_THRESHOLD_RATIO = 1.2;
  var MIN_VERTICAL_PX = 10;

  document.addEventListener('touchstart', function (e) {
    /* Don't capture swipes on inputs or inside modals or onboarding */
    if (e.target.closest('.modal-overlay, .table-modal-overlay, .info-modal-overlay, .onboarding-overlay, input, textarea, select')) return;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    touchStartTime = Date.now();
    isSwiping = true;
    swipeLocked = false;
  }, { passive: true });

  document.addEventListener('touchmove', function (e) {
    if (!isSwiping || swipeLocked) return;
    var dx = e.touches[0].clientX - touchStartX;
    var dy = e.touches[0].clientY - touchStartY;
    /* If vertical movement dominates early, cancel swipe detection */
    if (Math.abs(dy) > MIN_VERTICAL_PX && Math.abs(dy) > Math.abs(dx) * VERTICAL_THRESHOLD_RATIO) {
      isSwiping = false;
      swipeLocked = true;
    }
  }, { passive: true });

  document.addEventListener('touchend', function (e) {
    if (!isSwiping) return;
    isSwiping = false;

    var touchEndX = e.changedTouches[0].clientX;
    var touchEndY = e.changedTouches[0].clientY;
    var deltaX = touchEndX - touchStartX;
    var deltaY = touchEndY - touchStartY;
    var elapsed = Date.now() - touchStartTime;

    /* Must be primarily horizontal */
    if (Math.abs(deltaY) * VERTICAL_THRESHOLD_RATIO > Math.abs(deltaX)) return;
    /* Must exceed minimum distance */
    if (Math.abs(deltaX) < SWIPE_THRESHOLD) return;
    /* Check velocity */
    var velocity = Math.abs(deltaX) / elapsed;
    if (velocity < SWIPE_VELOCITY_THRESHOLD) return;

    var currentView = Router.getCurrentView();
    var currentIndex = viewOrder.indexOf(currentView);
    if (currentIndex === -1) return;

    /* Block swipe during active drill/test session or on drill start screen */
    if (_drillSessionActive || _activeDrillEngine) return;

    var nextIndex;
    if (deltaX > 0) {
      /* Swipe right → go to previous tab */
      nextIndex = currentIndex - 1;
    } else {
      /* Swipe left → go to next tab */
      nextIndex = currentIndex + 1;
    }

    if (nextIndex >= 0 && nextIndex < viewOrder.length) {
      _closeAllInfoModals();
      SoundEngine.play('tabSwitch');
      triggerHaptic(10);
      Router.showView(viewOrder[nextIndex]);
    }
  }, { passive: true });
}

/* ---- Custom Numpad Controller ---- */
var _numpadInput = null;
var _numpadSubmitCb = null;

function showCustomNumpad(inputEl, submitCallback) {
  _numpadInput = inputEl;
  _numpadSubmitCb = submitCallback;
  var numpad = document.getElementById('customNumpad');
  if (numpad) {
    numpad.classList.add('visible');
    document.body.classList.add('numpad-active');
  }
}

function hideCustomNumpad() {
  _numpadInput = null;
  _numpadSubmitCb = null;
  var numpad = document.getElementById('customNumpad');
  if (numpad) {
    numpad.classList.remove('visible');
    document.body.classList.remove('numpad-active');
  }
}

(function initNumpad() {
  document.addEventListener('click', function(e) {
    var btn = e.target.closest('[data-numpad]');
    if (!btn || !_numpadInput) return;
    var key = btn.getAttribute('data-numpad');

    /* Prevent input after answer is submitted (input is disabled) */
    if (_numpadInput.disabled && key !== 'submit') return;

    if (key === 'submit') {
      if (_numpadSubmitCb) _numpadSubmitCb();
    } else if (key === 'backspace') {
      _numpadInput.value = _numpadInput.value.slice(0, -1);
    } else {
      _numpadInput.value += key;
    }

    /* Keep input focused for visual feedback */
    _numpadInput.focus();
  });
})();

/* ---- Initialize SPA when DOM is ready ---- */
document.addEventListener('DOMContentLoaded', function () {
  document.body.classList.add('loaded');

  var loginScreen = document.getElementById('loginScreen');
  var container = document.querySelector('.container');
  var bottomNav = document.querySelector('.bottom-nav');
  var _authRequestInFlight = false;
  var _authViewToken = 0;

  /**
   * Show the main app and hide the login screen.
   * Loads data from Firestore and initializes the app.
   * Onboarding is checked before revealing the main app UI
   * to prevent the main interface from flashing before onboarding.
   */
  function showApp() {
    _authViewToken++;
    var token = _authViewToken;
    var expectedUserId = (typeof Auth !== 'undefined' && typeof Auth.getUserId === 'function') ? Auth.getUserId() : null;
    if (loginScreen) loginScreen.style.display = 'none';

    /* Load data from Firestore after authentication */
    if (typeof FirestoreSync !== 'undefined' && typeof FirebaseApp !== 'undefined' && FirebaseApp.isReady() && FirebaseApp.getUserId()) {
      FirestoreSync.loadFromFirestore(function (success) {
        if (token !== _authViewToken) return;
        var currentUserId = (typeof Auth !== 'undefined' && typeof Auth.getUserId === 'function') ? Auth.getUserId() : null;
        if (expectedUserId && currentUserId !== expectedUserId) return;
        if (success) {
          /* Re-apply dark mode and theme in case Firestore had updated settings */
          try {
            var s = JSON.parse(localStorage.getItem('quant_reflex_settings') || '{}');
            document.body.classList.toggle('dark-mode', !!s.darkMode);
            if (typeof applyTheme === 'function') applyTheme(s.theme || 'classic');
          } catch (_) { /* ignore */ }
        }
        /* Check onboarding BEFORE showing main UI */
        _launchOnboardingOrShowMain();
      });
    } else {
      if (token !== _authViewToken) return;
      var currentUserId = (typeof Auth !== 'undefined' && typeof Auth.getUserId === 'function') ? Auth.getUserId() : null;
      if (expectedUserId && currentUserId !== expectedUserId) return;
      /* No Firestore — check onboarding immediately */
      _launchOnboardingOrShowMain();
    }
  }

  /**
   * Check onboarding: if needed, show it first (main UI stays hidden).
   * After onboarding completes, reveal the main app.
   * If no onboarding needed, reveal immediately.
   */
  function _launchOnboardingOrShowMain() {
    if (typeof Onboarding !== 'undefined' && Onboarding.shouldShow()) {
      /* Show the onboarding overlay without revealing main app behind it */
      Onboarding.show(function () {
        /* Onboarding finished — now reveal the main app */
        _revealMainApp();
        Router.showView('home');
      });
    } else {
      /* No onboarding needed — reveal immediately */
      _revealMainApp();
    }

    /* Initialize notification scheduling if enabled */
    if (typeof NotificationManager !== 'undefined') {
      NotificationManager.init();
    }
  }

  /**
   * Reveal the main app container and bottom nav.
   * Re-render the current view to reflect loaded data.
   */
  function _revealMainApp() {
    _hideAppLoader();
    if (container) container.style.display = '';
    if (bottomNav) bottomNav.style.display = '';
    /* Apply correct navigation icons for the current theme */
    try {
      var s = JSON.parse(localStorage.getItem('quant_reflex_settings') || '{}');
      updateNavigationIcons(s.theme || 'classic');
    } catch (_) {
      updateNavigationIcons('classic');
    }
    /* Re-render current view to reflect loaded data.
       Fall back to 'home' if Router hasn't initialized yet —
       Router.showView safely handles unknown views by defaulting to home. */
    var currentView = Router.getCurrentView() || 'home';
    Router.showView(currentView);
  }

  /**
   * Show the login screen and hide the main app.
   */
  function showLogin() {
    _authViewToken++;
    _hideAppLoader();
    _authRequestInFlight = false;
    if (loginScreen) loginScreen.style.display = 'flex';
    if (container) container.style.display = 'none';
    if (bottomNav) bottomNav.style.display = 'none';
  }

  /* ---- Auth Gate ---- */
  if (typeof Auth !== 'undefined' && typeof FirebaseApp !== 'undefined' && FirebaseApp.isReady()) {
    /* Keep everything hidden until auth state is determined.
       This prevents the login screen from flashing for authenticated users. */
    if (loginScreen) loginScreen.style.display = 'none';
    if (container) container.style.display = 'none';
    if (bottomNav) bottomNav.style.display = 'none';

    Auth.onAuthReady(function (user) {
      if (user) {
        showApp();
      } else {
        showLogin();
      }
    });

    /* Login form handlers */
    var loginBtn = document.getElementById('loginBtn');
    var signupBtn = document.getElementById('signupBtn');
    var loginUsername = document.getElementById('loginUsername');
    var loginPassword = document.getElementById('loginPassword');
    var loginError = document.getElementById('loginError');

    function showError(msg) {
      if (loginError) {
        loginError.textContent = msg;
        loginError.style.display = 'block';
      }
    }

    function hideError() {
      if (loginError) {
        loginError.style.display = 'none';
      }
    }

    function setButtonsDisabled(disabled) {
      if (loginBtn) loginBtn.disabled = disabled;
      if (signupBtn) signupBtn.disabled = disabled;
    }

    if (loginBtn) {
      loginBtn.addEventListener('click', function () {
        if (_authRequestInFlight) return;
        hideError();
        var username = loginUsername ? loginUsername.value : '';
        var password = loginPassword ? loginPassword.value : '';
        _authRequestInFlight = true;
        setButtonsDisabled(true);

        Auth.login(username, password, function (err) {
          _authRequestInFlight = false;
          setButtonsDisabled(false);
          if (err) {
            showError(err);
          } else {
            /* Clear form fields for security */
            if (loginUsername) loginUsername.value = '';
            if (loginPassword) loginPassword.value = '';
            showApp();
          }
        });
      });
    }

    if (signupBtn) {
      signupBtn.addEventListener('click', function () {
        if (_authRequestInFlight) return;
        hideError();
        var username = loginUsername ? loginUsername.value : '';
        var password = loginPassword ? loginPassword.value : '';
        _authRequestInFlight = true;
        setButtonsDisabled(true);

        Auth.signup(username, password, function (err) {
          _authRequestInFlight = false;
          setButtonsDisabled(false);
          if (err) {
            showError(err);
          } else {
            /* Clear form fields for security */
            if (loginUsername) loginUsername.value = '';
            if (loginPassword) loginPassword.value = '';
            showApp();
          }
        });
      });
    }

    /* Allow Enter key to submit login */
    if (loginPassword) {
      loginPassword.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (loginBtn) loginBtn.click();
        }
      });
    }
    if (loginUsername) {
      loginUsername.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (loginPassword) loginPassword.focus();
        }
      });
    }
  } else {
    /* Firebase not available — show app directly (localStorage only mode) */
    _hideAppLoader();
    if (loginScreen) loginScreen.style.display = 'none';
    _launchOnboardingOrShowMain();
  }

  /* ---- Bottom nav click handlers ---- */
  var navLinks = document.querySelectorAll('.bottom-nav a');
  for (var i = 0; i < navLinks.length; i++) {
    /* Clean up tab-pop class after animation finishes */
    (function (link) {
      var icon = link.querySelector('.nav-icon img') || link.querySelector('.nav-icon .nav-emoji');
      if (icon) {
        icon.removeEventListener('animationend', _handleTabPopAnimationEnd);
        icon.addEventListener('animationend', _handleTabPopAnimationEnd);
      }
    })(navLinks[i]);

    navLinks[i].addEventListener('click', function (e) {
      e.preventDefault();
      if (!_tryBeginNavTransition()) return;
      var view = this.getAttribute('data-view');
      /* Skip if already on this tab and no drill is active */
      if (this.classList.contains('active') && !_drillSessionActive) return;
      /* Cleanup any active drill engine when navigating away */
      if (_activeDrillEngine) {
        _activeDrillEngine.cleanup();
        _activeDrillEngine = null;
      }
      /* End any active Firestore batch */
      if (_drillSessionActive && typeof FirestoreSync !== 'undefined') {
        FirestoreSync.endDrillBatch();
      }
      _exitDrillSession();
      /* Close any open info modals */
      _closeAllInfoModals();
      SoundEngine.play('tabSwitch');
      triggerHaptic(10);
      /* Trigger icon pop animation (works for both img and emoji) */
      var iconEl = this.querySelector('.nav-icon img') || this.querySelector('.nav-icon .nav-emoji');
      if (iconEl) {
        iconEl.classList.remove('tab-pop');
        void iconEl.offsetWidth; /* force reflow to restart animation */
        iconEl.classList.add('tab-pop');
      }
      Router.showView(view);
    });
  }

  /* ---- Cleanup drill engine on back/forward navigation ---- */
  window.addEventListener('popstate', function (e) {
    /* Close any open info modals on navigation */
    _closeAllInfoModals();
    if (_drillSessionActive) {
      /* Push history state back to prevent the browser from actually navigating away.
         This must happen before the dialog to keep the URL stable. */
      history.pushState({ view: 'practice' }, '', '#practice');

      showExitSessionDialog(function () {
        if (_activeDrillEngine) {
          _activeDrillEngine.cleanup();
          _activeDrillEngine = null;
        }
        /* End Firestore batch that was started when session began */
        if (typeof FirestoreSync !== 'undefined') {
          FirestoreSync.endDrillBatch();
        }
        _exitDrillSession();
        Router.showView('practice');
      });
      /* If cancelled, session continues — dialog closes without action */
      return;
    }
    if (_activeDrillEngine) {
      _activeDrillEngine.cleanup();
      _activeDrillEngine = null;
    }
    _exitDrillSession();
  });

  /* ---- HOME VIEW: render stats on every show ---- */
  Router.onShow('home', function () {
    var p = loadProgress();
    var accuracy = p.totalAttempted ? ((p.totalCorrect / p.totalAttempted) * 100).toFixed(0) : '0';
    var el = document.getElementById('homeStats');
    if (el) {
      el.innerHTML =
        '<div class="stat-card"><div class="value">' + (p.todayAttempted || 0) + '</div><div class="label">Today</div></div>' +
        '<div class="stat-card"><div class="value">' + accuracy + '%</div><div class="label">Accuracy</div></div>' +
        '<div class="stat-card"><div class="value">' + (p.currentStreak || 0) + '</div><div class="label">Current Streak</div></div>' +
        '<div class="stat-card"><div class="value">' + (p.bestStreak || 0) + '</div><div class="label">Best Streak</div></div>';
    }

    /* Dynamic greeting */
    var greetingEl = document.getElementById('homeGreeting');
    if (greetingEl) {
      var userName = '';
      try {
        if (typeof FirestoreSync !== 'undefined' && FirestoreSync._getCache) {
          var cache = FirestoreSync._getCache();
          if (cache && cache.profile && cache.profile.name) {
            userName = String(cache.profile.name).trim();
          }
        }
      } catch (_) {}
      var hour = new Date().getHours();
      var greeting;
      if (hour < 12) {
        greeting = userName ? 'Good morning, ' + userName + '. Ready to train your brain?' : 'Good morning! Ready to train your brain?';
      } else if (hour < 17) {
        greeting = userName ? 'Keep the momentum going, ' + userName + '.' : 'Keep the momentum going!';
      } else {
        greeting = userName ? 'Let\'s finish today\'s training strong, ' + userName + '.' : 'Let\'s finish today\'s training strong!';
      }
      greetingEl.textContent = greeting;
    }

    /* Daily goal card */
    var settings = loadSettings();
    var goal = settings.dailyGoal || 50;
    var done = p.todayAttempted || 0;
    var pct = Math.min(100, Math.round((done / goal) * 100));
    var goalDone = document.getElementById('goalDone');
    var goalTarget = document.getElementById('goalTarget');
    var goalFill = document.getElementById('goalFill');
    var goalStatus = document.getElementById('goalStatus');
    var goalPct = document.getElementById('goalPct');
    if (goalDone) goalDone.textContent = done;
    if (goalTarget) goalTarget.textContent = goal;
    if (goalFill) {
      goalFill.style.width = pct + '%';
      goalFill.className = 'goal-progress-fill' + (pct >= 100 ? ' goal-met' : '');
    }
    if (goalPct) goalPct.textContent = pct + '%';
    if (goalStatus) {
      if (pct >= 100) goalStatus.textContent = '🎉 Goal completed!';
      else if (pct >= 75) goalStatus.textContent = '🔥 Almost there!';
      else if (pct >= 50) goalStatus.textContent = '💪 Halfway done!';
      else goalStatus.textContent = 'Keep going!';
    }

    /* Render customizable quick study links */
    renderQuickStudyLinks();
  });

  /* ---- HOME VIEW: warmup handler ---- */
  document.getElementById('startWarmup').addEventListener('click', function (e) {
    e.preventDefault();
    if (!_tryPracticeAction()) return;
    SoundEngine.play('settingsToggle');
    Router.showView('practice');
    startDrillFromPractice('quick');
  });

  /* Edit quick links button */
  var editBtn = document.getElementById('editQuickLinks');
  if (editBtn) {
    editBtn.addEventListener('click', function () {
      openQuickLinksEditor();
    });
  }

  /* ---- PRACTICE VIEW ---- */
  Router.onShow('practice', function () {
    /* Cleanup active drill engine when re-entering practice view */
    if (_activeDrillEngine) {
      _activeDrillEngine.cleanup();
      _activeDrillEngine = null;
    }
    /* End any active Firestore batch */
    if (_drillSessionActive && typeof FirestoreSync !== 'undefined') {
      FirestoreSync.endDrillBatch();
    }
    _exitDrillSession();
    _resetPracticeUiToModes();
  });

  Router.onInit('practice', function () {
    var modeSelect = document.getElementById('modeSelect');
    var categorySelect = document.getElementById('categorySelect');
    var customPracticeConfig = document.getElementById('customPracticeConfig');
    var drillContainer = document.getElementById('drillContainer');
    var customSlider = document.getElementById('customQuestionCount');
    var customStartBtn = document.getElementById('startCustomSessionBtn');
    _customPracticeDom.slider = customSlider;
    _customPracticeDom.value = document.getElementById('customQuestionCountValue');
    _customPracticeDom.text = document.getElementById('customQuestionCountText');
    _customPracticeDom.error = document.getElementById('customModeError');
    if (!modeSelect || !categorySelect || !drillContainer) return;

    /* Mode card clicks */
    var modeCards = modeSelect.querySelectorAll('.mode-card');
    for (var i = 0; i < modeCards.length; i++) {
      modeCards[i].addEventListener('click', function () {
        if (!_tryPracticeAction()) return;
        SoundEngine.play('settingsToggle');
        var modeKey = this.getAttribute('data-mode');
        if (modeKey === 'wordproblems') {
          /* Future feature teaser */
          if (typeof showToast === 'function') {
            showToast('Word problem training is coming soon.');
          }
          return;
        }
        if (modeKey === 'custom') {
          if (!canAccessFeature('custom_training')) {
            showPaywall('custom_training');
            return;
          }
          _customPracticeActive = true;
          modeSelect.style.display = 'none';
          categorySelect.style.display = 'block';
          if (customPracticeConfig) customPracticeConfig.style.display = 'block';
          _resetCustomPracticeState();
          _syncCustomPracticeSelectionUi();
          return;
        }
        _customPracticeActive = false;
        if (modeKey === 'focus') {
          modeSelect.style.display = 'none';
          categorySelect.style.display = 'block';
          _syncCustomPracticeSelectionUi();
        } else if (modeKey === 'review') {
          if (!canAccessFeature('review_mistakes')) {
            showPaywall('review_mistakes');
            return;
          }
          startDrillFromPractice('review');
        } else {
          startDrillFromPractice(modeKey);
        }
      });
    }

    /* Category button clicks */
    var catBtns = categorySelect.querySelectorAll('.category-btn');
    _customPracticeDom.catBtns = catBtns;
    categorySelect.addEventListener('click', function (e) {
      var target = e.target;
      if (!target || !target.classList || !target.classList.contains('category-btn')) return;
      if (!_tryPracticeAction()) return;
      SoundEngine.play('settingsToggle');
      var cat = target.getAttribute('data-cat');
      if (!cat) return;
      if (_customPracticeActive) {
        _toggleCustomPracticeTopic(cat);
        _syncCustomPracticeSelectionUi();
        if (_customPracticeDom.error) _customPracticeDom.error.textContent = '';
        return;
      }
      startDrillFromPractice('focus', cat, target.textContent);
    });

    if (customSlider) {
      customSlider.addEventListener('input', function () {
        var val = parseInt(customSlider.value, 10);
        if (isNaN(val)) val = _CUSTOM_DEFAULT_QUESTIONS;
        _customPracticeState.totalQuestions = Math.max(_CUSTOM_MIN_QUESTIONS, Math.min(_CUSTOM_MAX_QUESTIONS, val));
        _updateCustomQuestionCountUI();
      });
    }

    if (customStartBtn) {
      customStartBtn.addEventListener('click', function () {
        if (!_tryPracticeAction()) return;
        if (!canAccessFeature('custom_training')) {
          showPaywall('custom_training');
          return;
        }
        if (selectedTopics.length === 0) {
          if (_customPracticeDom.error) _customPracticeDom.error.textContent = 'Please select at least one topic';
          return;
        }
        startDrillFromPractice('custom');
      });
    }

    /* Back button */
    var backToModesBtn = document.getElementById('backToModes');
    if (backToModesBtn) {
      backToModesBtn.addEventListener('click', function () {
        _exitDrillSession();
        _resetPracticeUiToModes();
      });
    }
  });

  /* ---- LEARN VIEW: lazy init ---- */
  var learnInitialized = false;
  Router.onShow('learn', function () {
    if (!learnInitialized) {
      initLearnView();
      learnInitialized = true;
    }
  });

  /* ---- STATS VIEW: render on every show ---- */
  Router.onShow('stats', renderStatsView);

  /* ---- SETTINGS VIEW: init on every show ---- */
  Router.onShow('settings', initSettingsView);

  /* ---- Initialize swipe navigation ---- */
  initSwipeNavigation();

  /* ---- Initialize router ---- */
  Router.init();
});

/* ---- Practice drill starter ---- */
function startDrillFromPractice(modeKey, category, categoryLabel) {
  /* Preserve custom selection mode only for custom sessions. */
  if (modeKey !== 'custom') _customPracticeActive = false;
  if (modeKey === 'custom' && !canAccessFeature('custom_training')) {
    showPaywall('custom_training');
    return;
  }
  if (modeKey === 'review' && !canAccessFeature('review_mistakes')) {
    showPaywall('review_mistakes');
    return;
  }
  var modeSelect = document.getElementById('modeSelect');
  var categorySelect = document.getElementById('categorySelect');
  var customPracticeConfig = document.getElementById('customPracticeConfig');
  var drillContainer = document.getElementById('drillContainer');
  if (!modeSelect || !categorySelect || !drillContainer) return;

  var modes = {
    quick:  { count: 5,  timeLimitSec: null, perQuestionSec: null, category: null, mode: '⚡ Quick Drill' },
    reflex: { count: 10, timeLimitSec: null, perQuestionSec: 15,   category: null, mode: '🧠 Reflex Drill' },
    timed:  { count: 10, timeLimitSec: 180,  perQuestionSec: null, category: null, mode: '⏱ Timed Test' },
    focus:  { count: 10, timeLimitSec: null, perQuestionSec: null, category: null, mode: '🎯 Focus Training' },
    custom: { count: _customPracticeState.totalQuestions, timeLimitSec: null, perQuestionSec: null, category: null, topics: selectedTopics.slice(), mode: '📑 Custom Training' },
    review: { count: 10, timeLimitSec: null, perQuestionSec: null, category: null, mode: '🔄 Review Mistakes', reviewMode: true }
  };

  var config = Object.assign({}, modes[modeKey] || modes.quick);
  if (category) {
    config.category = category;
    config.mode = '🎯 ' + (categoryLabel || category);
  }

  config.onFinish = function (view) {
    if (_activeDrillEngine) {
      _activeDrillEngine.cleanup();
      _activeDrillEngine = null;
    }
    /* End any active Firestore batch */
    if (_drillSessionActive && typeof FirestoreSync !== 'undefined') {
      FirestoreSync.endDrillBatch();
    }
    _exitDrillSession();
    if (view === 'practice') {
      _resetPracticeUiToModes();
    }
    Router.showView(view);
  };

  modeSelect.style.display = 'none';
  categorySelect.style.display = 'none';
  if (customPracticeConfig) customPracticeConfig.style.display = 'none';
  drillContainer.style.display = 'block';
  _startPracticeEngine(drillContainer, config);
}

function _startPracticeEngine(drillContainer, config) {
  if (_activeDrillEngine) {
    _activeDrillEngine.cleanup();
  }
  var engine = createDrillEngine(drillContainer, config);
  _activeDrillEngine = engine;
  engine.start();
}

var _customPracticeState = {
  totalQuestions: 20
};
var selectedTopics = [];
var _customPracticeDom = {
  slider: null,
  value: null,
  text: null,
  error: null,
  catBtns: null
};
var _customPracticeActive = false;
var _CUSTOM_DEFAULT_QUESTIONS = 20;
var _CUSTOM_MIN_QUESTIONS = 1;
var _CUSTOM_MAX_QUESTIONS = 100;

function _toggleCustomPracticeTopic(topicKey) {
  if (!topicKey) return;
  var idx = selectedTopics.indexOf(topicKey);
  if (idx === -1) selectedTopics.push(topicKey);
  else selectedTopics.splice(idx, 1);
}

function _syncCustomPracticeSelectionUi() {
  var catBtns = _getCustomPracticeCategoryButtons();
  if (!catBtns) return;
  var availableTopics = {};
  for (var j = 0; j < catBtns.length; j++) {
    var key = catBtns[j].getAttribute('data-cat');
    if (key) availableTopics[key] = true;
  }
  var normalized = [];
  for (var k = 0; k < selectedTopics.length; k++) {
    var topic = selectedTopics[k];
    if (availableTopics[topic] && normalized.indexOf(topic) === -1) {
      normalized.push(topic);
    }
  }
  if (normalized.length !== selectedTopics.length) {
    selectedTopics.splice.apply(selectedTopics, [0, selectedTopics.length].concat(normalized));
  }
  for (var i = 0; i < catBtns.length; i++) {
    var topicKey = catBtns[i].getAttribute('data-cat');
    catBtns[i].classList.toggle('selected', selectedTopics.indexOf(topicKey) !== -1);
  }
}

function _getCustomPracticeCategoryButtons() {
  _customPracticeDom.catBtns = document.querySelectorAll('#categorySelect .category-btn');
  return _customPracticeDom.catBtns;
}

function _ensureCustomPracticeDomCached() {
  if (!_customPracticeDom.slider) _customPracticeDom.slider = document.getElementById('customQuestionCount');
  if (!_customPracticeDom.value) _customPracticeDom.value = document.getElementById('customQuestionCountValue');
  if (!_customPracticeDom.text) _customPracticeDom.text = document.getElementById('customQuestionCountText');
  if (!_customPracticeDom.error) _customPracticeDom.error = document.getElementById('customModeError');
  _getCustomPracticeCategoryButtons();
}

function _updateCustomQuestionCountUI() {
  _ensureCustomPracticeDomCached();
  var valueEl = _customPracticeDom.value;
  var textEl = _customPracticeDom.text;
  if (valueEl) valueEl.textContent = String(_customPracticeState.totalQuestions);
  if (textEl) textEl.textContent = 'You will solve ' + _customPracticeState.totalQuestions + ' questions';
}

function _resetCustomPracticeState() {
  _ensureCustomPracticeDomCached();
  selectedTopics.splice(0, selectedTopics.length);
  _customPracticeState.totalQuestions = _CUSTOM_DEFAULT_QUESTIONS;
  var slider = _customPracticeDom.slider;
  if (slider) slider.value = String(_CUSTOM_DEFAULT_QUESTIONS);
  _updateCustomQuestionCountUI();
  var customErr = _customPracticeDom.error;
  if (customErr) customErr.textContent = '';
  _syncCustomPracticeSelectionUi();
}

/* ---- Learn view initializer ---- */
function initLearnView() {
  /* Render multiplication table selector and display */
  var tableSelector = document.getElementById('tableSelector');
  var tableDisplay = document.getElementById('tableDisplay');
  if (tableSelector && tableDisplay) {
    renderTableSelector(tableSelector, tableDisplay, 30);
  }

  /* Populate squares grid (1–30) */
  var sqGrid = document.getElementById('squaresGrid');
  if (sqGrid) {
    for (var n = 1; n <= 30; n++) {
      var item = document.createElement('div');
      item.className = 'math-grid-item';
      item.innerHTML = '<span class="math-expr">' + padTableNum(n, 2) + '²</span><span class="math-eq">=</span><span class="math-val">' + padTableNum(n * n, 3) + '</span>';
      sqGrid.appendChild(item);
    }
  }

  /* Populate cubes grid (1–20) */
  var cuGrid = document.getElementById('cubesGrid');
  if (cuGrid) {
    for (var m = 1; m <= 20; m++) {
      var item2 = document.createElement('div');
      item2.className = 'math-grid-item';
      item2.innerHTML = '<span class="math-expr">' + padTableNum(m, 2) + '³</span><span class="math-eq">=</span><span class="math-val">' + padTableNum(m * m * m, 4) + '</span>';
      cuGrid.appendChild(item2);
    }
  }

  /* Render topic-wise formula sections from formulas.js with add-formula support */
  var sections = getFormulaSections();
  var topicContainer = document.getElementById('topicSections');
  if (topicContainer) {
    for (var i = 0; i < sections.length; i++) {
      (function (s) {
        var card = document.createElement('div');
        card.className = 'card learn-searchable';
        card.id = s.id;
        card.innerHTML = '<h3 class="section-title">' + s.title + '</h3>' + s.content;

        /* Add custom formulas area for this built-in topic */
        var customArea = document.createElement('div');
        customArea.className = 'custom-formulas-list';
        card.appendChild(customArea);

        function refreshBuiltinTopicFormulas() {
          renderCustomFormulas(customArea, s.id, refreshBuiltinTopicFormulas);
        }
        refreshBuiltinTopicFormulas();
        renderAddFormulaButton(card, s.id, refreshBuiltinTopicFormulas);

        topicContainer.appendChild(card);
      })(sections[i]);
    }
  }

  /* Render custom topic sections */
  renderCustomTopicSections();
  updateCustomTopicJumpNav();

  /* Render bookmarked formulas */
  renderBookmarksSection();

  /* Add new topic button handler */
  var addTopicBtn = document.getElementById('addTopicBtn');
  if (addTopicBtn) {
    addTopicBtn.addEventListener('click', function () {
      if (!canAccessFeature('add_topic')) {
        showPaywall('add_topic');
        return;
      }
      _createModal('Create New Topic', [
        { name: 'name', label: 'Topic Name', placeholder: 'e.g. Number Systems' }
      ], function (values) {
        if (!values.name) return;
        addCustomTopic(values.name);
        renderCustomTopicSections();
        updateCustomTopicJumpNav();
      });
    });
  }

  /* Quick jump navigation with active highlight */
  var jumpBtns = document.querySelectorAll('.learn-jump-btn');
  for (var j = 0; j < jumpBtns.length; j++) {
    jumpBtns[j].addEventListener('click', function () {
      /* Highlight active button */
      var allJumpBtns = document.querySelectorAll('.learn-jump-btn');
      for (var ab = 0; ab < allJumpBtns.length; ab++) allJumpBtns[ab].classList.remove('active');
      this.classList.add('active');

      var targetId = this.getAttribute('data-jump');
      var target = document.getElementById(targetId);
      if (target) {
        /* Expand collapsible if needed */
        var header = target.querySelector('.collapsible-header');
        if (header) {
          var content = header.nextElementSibling;
          if (content && window.getComputedStyle(content).display === 'none') {
            toggleSection(header);
          }
        }
        target.scrollIntoView({ behavior: 'smooth' });
      }
    });
  }

  /* Enhanced search functionality with debouncing */
  var searchInput = document.getElementById('learnSearch');
  if (searchInput) {
    var _searchDebounce = null;
    searchInput.addEventListener('input', function () {
      var self = this;
      if (_searchDebounce) clearTimeout(_searchDebounce);
      _searchDebounce = setTimeout(function () {
        var query = self.value.toLowerCase().trim();
        performLearnSearch(query);
      }, 200);
    });
  }
}

/* ---- Collapsible section toggle (used in Learn view) ---- */
function toggleSection(header) {
  var content = header.nextElementSibling;
  var icon = header.querySelector('.collapse-icon');
  if (content.style.display === 'none' || !content.style.display) {
    content.style.display = 'block';
    icon.textContent = '▲';
  } else {
    content.style.display = 'none';
    icon.textContent = '▼';
  }
}

/* ---- Stats view renderer ---- */
function renderStatsView() {
  var p = loadProgress();
  var canSeeInsights = canAccessFeature('performance_insights');
  var canSeeCategoryAccuracy = canAccessFeature('category_accuracy');
  var accuracy = p.totalAttempted ? ((p.totalCorrect / p.totalAttempted) * 100).toFixed(1) : '0';
  var avgTime = getAvgResponseTime();
  var weakest = getWeakestCategory();
  var strongest = getStrongestCategory();

  /* Calculate improvement trend from daily history.
     Compare last 7 days accuracy vs prior 7 days.
     A difference > 2% is considered meaningful enough to report as improving/declining,
     while smaller changes are reported as steady to avoid noise from variance. */
  var trend = '—';
  var trendClass = '';
  var history = p.dailyHistory || {};
  var dates = Object.keys(history).sort();
  if (dates.length >= 2) {
    var recentDays = dates.slice(-7);
    var olderDays = dates.slice(-14, -7);
    if (olderDays.length > 0) {
      var recentAcc = 0, recentTotal = 0;
      for (var r = 0; r < recentDays.length; r++) {
        var rd = history[recentDays[r]];
        if (rd.attempted > 0) { recentAcc += rd.correct; recentTotal += rd.attempted; }
      }
      var olderAcc = 0, olderTotal = 0;
      for (var o = 0; o < olderDays.length; o++) {
        var od = history[olderDays[o]];
        if (od.attempted > 0) { olderAcc += od.correct; olderTotal += od.attempted; }
      }
      if (recentTotal > 0 && olderTotal > 0) {
        var recentPct = (recentAcc / recentTotal) * 100;
        var olderPct = (olderAcc / olderTotal) * 100;
        var diff = recentPct - olderPct;
        if (diff > 2) {
          trend = '📈 Improving';
          trendClass = ' stat-card-positive';
        } else if (diff < -2) {
          trend = '📉 Declining';
          trendClass = ' stat-card-negative';
        } else {
          trend = '➡️ Steady';
        }
      }
    }
  }

  /* Section 1 — Practice Overview (3 cols) */
  var overviewEl = document.getElementById('statsPracticeOverview');
  if (overviewEl) {
    overviewEl.innerHTML =
      '<div class="stat-card"><div class="value">' + p.totalAttempted + '</div><div class="label">Questions Attempted</div></div>' +
      '<div class="stat-card"><div class="value">' + p.totalCorrect + '</div><div class="label">Correct Answers</div></div>' +
      '<div class="stat-card"><div class="value">' + accuracy + '%</div><div class="label">Accuracy</div></div>';
  }

  /* Section 2 — Speed & Efficiency (2 cols) */
  var speedEl = document.getElementById('statsSpeed');
  if (speedEl) {
    speedEl.innerHTML =
      '<div class="stat-card"><div class="value">' + (avgTime || '—') + 's</div><div class="label">Avg Response Time</div></div>' +
      '<div class="stat-card"><div class="value">' + (p.bestStreak || 0) + '</div><div class="label">Best Streak</div></div>';
  }

  /* Section 3 — Activity Stats (2 cols) */
  var activityEl = document.getElementById('statsActivity');
  if (activityEl) {
    activityEl.innerHTML =
      '<div class="stat-card"><div class="value">' + (p.drillSessions || 0) + '</div><div class="label">Drill Sessions</div></div>' +
      '<div class="stat-card"><div class="value">' + (p.timedTestSessions || 0) + '</div><div class="label">Timed Tests</div></div>';
  }

  /* Section 4 — Consistency (2 cols) */
  var consistencyEl = document.getElementById('statsConsistency');
  if (consistencyEl) {
    consistencyEl.innerHTML =
      '<div class="stat-card"><div class="value">' + (p.dailyStreak || 0) + ' 🔥</div><div class="label">Daily Streak</div></div>' +
      '<div class="stat-card"><div class="value">' + (p.todayAttempted || 0) + '</div><div class="label">Today\'s Questions</div></div>';
  }

  /* Section 5 — Performance Insights (3 cols) */
  var insightsEl = document.getElementById('statsInsights');
  if (insightsEl) {
    if (!canSeeInsights) {
      insightsEl.innerHTML =
        '<button class="stats-insights-locked" id="unlockInsightsBtn" type="button">' +
          '<div class="stats-insights-locked-content">' +
            '<p class="stats-insights-locked-title">Unlock Performance Insights 🔒</p>' +
            '<p class="stats-insights-locked-cta">Upgrade to view detailed insights</p>' +
          '</div>' +
        '</button>';
      var unlockInsightsBtn = document.getElementById('unlockInsightsBtn');
      if (unlockInsightsBtn) {
        unlockInsightsBtn.addEventListener('click', function () { showPaywall('stats'); });
      }
    } else {
    var categoryInsightMsg = (!weakest && !strongest) ? 'Solve more questions to unlock category insights.' : '';
    var weakestDisplay = weakest ? formatCategoryName(weakest) : (categoryInsightMsg ? '🔒' : '—');
    var strongestDisplay = strongest ? formatCategoryName(strongest) : (categoryInsightMsg ? '🔒' : '—');

    insightsEl.innerHTML =
      '<div class="stat-card' + (strongest ? ' stat-card-positive' : '') + '"><div class="value value-sm">' + strongestDisplay + '</div><div class="label">Strongest Category</div>' + (categoryInsightMsg && !strongest ? '<div class="stat-hint">' + categoryInsightMsg + '</div>' : '') + '</div>' +
      '<div class="stat-card' + (weakest ? ' stat-card-negative' : '') + '"><div class="value value-sm">' + weakestDisplay + '</div><div class="label">Weakest Category</div>' + (categoryInsightMsg && !weakest ? '<div class="stat-hint">' + categoryInsightMsg + '</div>' : '') + '</div>' +
      '<div class="stat-card' + trendClass + '"><div class="value value-sm">' + trend + '</div><div class="label">Recent Trend</div></div>';
    }
  }

  /* Category stats with color-coded bars and strength labels */
  var catContainer = document.getElementById('categoryStats');
  if (!catContainer) return;
  if (!canSeeCategoryAccuracy) {
    catContainer.innerHTML =
      '<button class="category-locked-card" id="unlockCategoryAccuracyBtn" type="button">' +
        '<strong>🔒 Category Accuracy is Premium</strong><span>Unlock category-level strengths and weaknesses.</span>' +
      '</button>';
    var unlockCategoryAccuracyBtn = document.getElementById('unlockCategoryAccuracyBtn');
    if (unlockCategoryAccuracyBtn) {
      unlockCategoryAccuracyBtn.addEventListener('click', function () { showPaywall('stats'); });
    }
    return;
  }
  var cats = p.categoryStats || {};
  var keys = Object.keys(cats);

  /* Filter out invalid categories (e.g. legacy "onboarding" entries) */
  keys = keys.filter(function (k) { return isValidCategory(k); });

  if (keys.length === 0) {
    catContainer.innerHTML = '<p class="secondary-text">Start practicing to see category-wise performance.</p>';
    return;
  }

  /* Sort by accuracy ascending so weak categories appear first */
  keys.sort(function (a, b) {
    var accA = cats[a].attempted ? (cats[a].correct / cats[a].attempted) : 0;
    var accB = cats[b].attempted ? (cats[b].correct / cats[b].attempted) : 0;
    return accA - accB;
  });

  var html = '<div class="category-stats-list">';
  for (var i = 0; i < keys.length; i++) {
    var cat = keys[i];
    var cs = cats[cat];
    var catAcc = cs.attempted ? ((cs.correct / cs.attempted) * 100).toFixed(0) : '0';
    var barWidth = cs.attempted ? Math.round((cs.correct / cs.attempted) * 100) : 0;
    /* Color-coded bar class */
    var barClass = 'cat-bar ';
    var strengthLabel = '';
    if (barWidth >= 85) { barClass += 'cat-bar-high'; strengthLabel = '<span class="category-strength-label strength-strong">Strong</span>'; }
    else if (barWidth >= 65) { barClass += 'cat-bar-mid'; strengthLabel = '<span class="category-strength-label strength-moderate">Moderate</span>'; }
    else if (barWidth >= 40) { barClass += 'cat-bar-low'; strengthLabel = '<span class="category-strength-label strength-weak">Weak</span>'; }
    else { barClass += 'cat-bar-weak'; strengthLabel = '<span class="category-strength-label strength-weak">Weak</span>'; }
    html +=
      '<div class="category-stat-row">' +
        '<span class="cat-name">' + formatCategoryName(cat) + '</span>' +
        '<div class="cat-bar-container">' +
          '<div class="' + barClass + '" style="width:' + barWidth + '%"></div>' +
        '</div>' +
        strengthLabel +
        '<span class="cat-accuracy">' + catAcc + '%</span>' +
      '</div>';
  }
  html += '</div>';
  catContainer.innerHTML = html;
}
