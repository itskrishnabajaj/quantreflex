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

/* ---- Apply dark mode from settings immediately ---- */
(function () {
  try {
    var settings = JSON.parse(localStorage.getItem('quant_reflex_settings') || '{}');
    if (settings.darkMode) document.body.classList.add('dark-mode');
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

/* ---- Service Worker Registration ---- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker
      .register('./service-worker.js')
      .catch(function (err) { console.warn('SW registration failed:', err); });
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

/* ---- Active drill engine reference for cleanup ---- */
var _activeDrillEngine = null;

/* ---- Quick Study Links Configuration ---- */
var QUICK_LINKS_KEY = 'quant_quick_links';
var AVAILABLE_QUICK_LINKS = [
  { id: 'fractionTable', icon: '📐', title: 'Fraction → Percentage', desc: 'Master common fraction-to-percentage conversions.', type: 'learn' },
  { id: 'tablesContainer', icon: '✖️', title: 'Multiplication Tables', desc: 'Review tables from 1 to 30.', type: 'learn' },
  { id: 'formulaSections', icon: '📝', title: 'Quant Formulas', desc: 'Profit & Loss, Ratios, Averages, TSD formulas.', type: 'learn' },
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
    /* Don't capture swipes on inputs or inside modals */
    if (e.target.closest('.modal-overlay, .table-modal-overlay, input, textarea, select')) return;
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

    /* Don't navigate during active drill */
    if (_activeDrillEngine) return;

    var nextIndex;
    if (deltaX > 0) {
      /* Swipe right → go to previous tab */
      nextIndex = currentIndex - 1;
    } else {
      /* Swipe left → go to next tab */
      nextIndex = currentIndex + 1;
    }

    if (nextIndex >= 0 && nextIndex < viewOrder.length) {
      SoundEngine.play('tabSwitch');
      Router.showView(viewOrder[nextIndex]);
    }
  }, { passive: true });
}

/* ---- Initialize SPA when DOM is ready ---- */
document.addEventListener('DOMContentLoaded', function () {
  document.body.classList.add('loaded');

  var loginScreen = document.getElementById('loginScreen');
  var container = document.querySelector('.container');
  var bottomNav = document.querySelector('.bottom-nav');

  /**
   * Show the main app and hide the login screen.
   * Loads data from Firestore and initializes the app.
   */
  function showApp() {
    if (loginScreen) loginScreen.style.display = 'none';
    if (container) container.style.display = '';
    if (bottomNav) bottomNav.style.display = '';

    /* Load data from Firestore after authentication */
    if (typeof FirestoreSync !== 'undefined' && typeof FirebaseApp !== 'undefined' && FirebaseApp.isReady() && FirebaseApp.getUserId()) {
      FirestoreSync.loadFromFirestore(function (success) {
        if (success) {
          /* Re-apply dark mode in case Firestore had updated settings */
          try {
            var s = JSON.parse(localStorage.getItem('quant_reflex_settings') || '{}');
            document.body.classList.toggle('dark-mode', !!s.darkMode);
          } catch (_) { /* ignore */ }
          /* Re-render current view to reflect loaded data */
          var currentView = Router.getCurrentView();
          if (currentView) Router.showView(currentView);
        }
      });
    }
  }

  /**
   * Show the login screen and hide the main app.
   */
  function showLogin() {
    if (loginScreen) loginScreen.style.display = 'flex';
    if (container) container.style.display = 'none';
    if (bottomNav) bottomNav.style.display = 'none';
  }

  /* ---- Auth Gate ---- */
  if (typeof Auth !== 'undefined' && typeof FirebaseApp !== 'undefined' && FirebaseApp.isReady()) {
    /* Initially hide app and show login screen */
    showLogin();

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
        hideError();
        var username = loginUsername ? loginUsername.value : '';
        var password = loginPassword ? loginPassword.value : '';
        setButtonsDisabled(true);

        Auth.login(username, password, function (err) {
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
        hideError();
        var username = loginUsername ? loginUsername.value : '';
        var password = loginPassword ? loginPassword.value : '';
        setButtonsDisabled(true);

        Auth.signup(username, password, function (err) {
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
    if (loginScreen) loginScreen.style.display = 'none';
  }

  /* ---- Bottom nav click handlers ---- */
  var navLinks = document.querySelectorAll('.bottom-nav a');
  for (var i = 0; i < navLinks.length; i++) {
    navLinks[i].addEventListener('click', function (e) {
      e.preventDefault();
      var view = this.getAttribute('data-view');
      /* Cleanup any active drill engine when navigating away */
      if (_activeDrillEngine) {
        _activeDrillEngine.cleanup();
        _activeDrillEngine = null;
      }
      SoundEngine.play('tabSwitch');
      Router.showView(view);
    });
  }

  /* ---- Cleanup drill engine on back/forward navigation ---- */
  window.addEventListener('popstate', function () {
    if (_activeDrillEngine) {
      _activeDrillEngine.cleanup();
      _activeDrillEngine = null;
    }
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
    /* Reset practice view state */
    var modeSelect = document.getElementById('modeSelect');
    var categorySelect = document.getElementById('categorySelect');
    var drillContainer = document.getElementById('drillContainer');
    if (modeSelect) modeSelect.style.display = 'block';
    if (categorySelect) categorySelect.style.display = 'none';
    if (drillContainer) {
      drillContainer.style.display = 'none';
      drillContainer.innerHTML = '';
    }
  });

  Router.onInit('practice', function () {
    var modeSelect = document.getElementById('modeSelect');
    var categorySelect = document.getElementById('categorySelect');
    var drillContainer = document.getElementById('drillContainer');

    /* Mode card clicks */
    var modeCards = document.querySelectorAll('.mode-card');
    for (var i = 0; i < modeCards.length; i++) {
      modeCards[i].addEventListener('click', function () {
        SoundEngine.play('settingsToggle');
        var modeKey = this.getAttribute('data-mode');
        if (modeKey === 'focus') {
          modeSelect.style.display = 'none';
          categorySelect.style.display = 'block';
        } else if (modeKey === 'review') {
          startDrillFromPractice('review');
        } else {
          startDrillFromPractice(modeKey);
        }
      });
    }

    /* Category button clicks */
    var catBtns = document.querySelectorAll('.category-btn');
    for (var j = 0; j < catBtns.length; j++) {
      catBtns[j].addEventListener('click', function () {
        SoundEngine.play('settingsToggle');
        var cat = this.getAttribute('data-cat');
        startDrillFromPractice('focus', cat, this.textContent);
      });
    }

    /* Back button */
    document.getElementById('backToModes').addEventListener('click', function () {
      categorySelect.style.display = 'none';
      modeSelect.style.display = 'block';
    });
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
  var modeSelect = document.getElementById('modeSelect');
  var categorySelect = document.getElementById('categorySelect');
  var drillContainer = document.getElementById('drillContainer');

  var modes = {
    quick:  { count: 5,  timeLimitSec: null, perQuestionSec: null, category: null, mode: '⚡ Quick Drill' },
    reflex: { count: 10, timeLimitSec: null, perQuestionSec: 15,   category: null, mode: '🧠 Reflex Drill' },
    timed:  { count: 10, timeLimitSec: 180,  perQuestionSec: null, category: null, mode: '⏱ Timed Test' },
    focus:  { count: 10, timeLimitSec: null, perQuestionSec: null, category: null, mode: '🎯 Focus Training' },
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
    Router.showView(view);
  };

  modeSelect.style.display = 'none';
  categorySelect.style.display = 'none';
  drillContainer.style.display = 'block';

  /* Cleanup previous engine if any */
  if (_activeDrillEngine) {
    _activeDrillEngine.cleanup();
  }

  var engine = createDrillEngine(drillContainer, config);
  _activeDrillEngine = engine;
  engine.start();
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
  var accuracy = p.totalAttempted ? ((p.totalCorrect / p.totalAttempted) * 100).toFixed(1) : '0';
  var avgTime = getAvgResponseTime();
  var weakest = getWeakestCategory();
  var strongest = getStrongestCategory();

  /* Calculate improvement trend from daily history.
     Compare last 7 days accuracy vs prior 7 days.
     A difference > 2% is considered meaningful enough to report as improving/declining,
     while smaller changes are reported as steady to avoid noise from variance. */
  var trend = '—';
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
        if (diff > 2) trend = '📈 Improving';
        else if (diff < -2) trend = '📉 Declining';
        else trend = '➡️ Steady';
      }
    }
  }

  var statsGrid = document.getElementById('statsGrid');
  if (statsGrid) {
    statsGrid.innerHTML =
      '<div class="stat-card"><div class="value">' + p.totalAttempted + '</div><div class="label">Questions Attempted</div></div>' +
      '<div class="stat-card"><div class="value">' + p.totalCorrect + '</div><div class="label">Correct Answers</div></div>' +
      '<div class="stat-card"><div class="value">' + accuracy + '%</div><div class="label">Accuracy</div></div>' +
      '<div class="stat-card"><div class="value">' + (p.bestStreak || 0) + '</div><div class="label">Best Streak</div></div>' +
      '<div class="stat-card"><div class="value">' + (p.drillSessions || 0) + '</div><div class="label">Drill Sessions</div></div>' +
      '<div class="stat-card"><div class="value">' + (p.timedTestSessions || 0) + '</div><div class="label">Timed Tests</div></div>' +
      '<div class="stat-card"><div class="value">' + (p.dailyStreak || 0) + '</div><div class="label">Daily Streak 🔥</div></div>' +
      '<div class="stat-card"><div class="value">' + (p.todayAttempted || 0) + '</div><div class="label">Today\'s Questions</div></div>' +
      '<div class="stat-card"><div class="value">' + (avgTime || '—') + 's</div><div class="label">Avg Response Time</div></div>' +
      '<div class="stat-card' + (weakest ? ' highlight' : '') + '"><div class="value value-sm">' + (weakest || '—') + '</div><div class="label">Weakest Category</div></div>' +
      '<div class="stat-card' + (strongest ? ' highlight' : '') + '"><div class="value value-sm">' + (strongest || '—') + '</div><div class="label">Strongest Category</div></div>' +
      '<div class="stat-card"><div class="value value-sm">' + trend + '</div><div class="label">Recent Trend</div></div>';
  }

  /* Category stats with color-coded bars and strength labels */
  var catContainer = document.getElementById('categoryStats');
  if (!catContainer) return;
  var cats = p.categoryStats || {};
  var keys = Object.keys(cats);
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
    else if (barWidth >= 40) { barClass += 'cat-bar-low'; strengthLabel = '<span class="category-strength-label strength-moderate">Moderate</span>'; }
    else { barClass += 'cat-bar-weak'; strengthLabel = '<span class="category-strength-label strength-weak">Weak</span>'; }
    html +=
      '<div class="category-stat-row">' +
        '<span class="cat-name">' + cat + '</span>' +
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
