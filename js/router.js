/**
 * router.js — Simple vanilla SPA router
 *
 * Manages view switching by showing/hiding sections.
 * Supports hash-based navigation and bottom nav active states.
 */

var Router = (function () {
  var currentView = null;
  var viewInitCallbacks = {};
  var afterShowCallbacks = {};
  var _navigatingFromPopstate = false;

  /**
   * Register an initialization callback for a view.
   * Called the first time a view is shown.
   */
  function onInit(viewId, callback) {
    viewInitCallbacks[viewId] = callback;
  }

  /**
   * Register a callback that runs every time a view is shown.
   */
  function onShow(viewId, callback) {
    afterShowCallbacks[viewId] = callback;
  }

  /**
   * Show a view by its ID, hide all others.
   * @param {string} viewId - The view to show (e.g. 'home', 'practice')
   * @param {object} [params] - Optional parameters to pass to callbacks
   */
  function showView(viewId, params) {
    var views = document.querySelectorAll('.spa-view');
    for (var i = 0; i < views.length; i++) {
      views[i].classList.remove('spa-view-active');
    }

    var target = document.getElementById('view-' + viewId);
    if (!target) {
      target = document.getElementById('view-home');
      viewId = 'home';
    }
    target.classList.add('spa-view-active');

    /* Update bottom nav active state */
    var navLinks = document.querySelectorAll('.bottom-nav a');
    for (var j = 0; j < navLinks.length; j++) {
      navLinks[j].classList.remove('active');
      var href = navLinks[j].getAttribute('data-view');
      if (href === viewId) {
        navLinks[j].classList.add('active');
      }
    }

    /* Run init callback once */
    if (viewInitCallbacks[viewId]) {
      viewInitCallbacks[viewId](params);
      delete viewInitCallbacks[viewId];
    }

    /* Run after-show callback every time */
    if (afterShowCallbacks[viewId]) {
      afterShowCallbacks[viewId](params);
    }

    currentView = viewId;

    /* Update hash — only pushState for user-initiated navigation,
       skip when restoring from popstate to avoid duplicate history entries
       that would break swipe-back / browser back button behavior */
    if (!_navigatingFromPopstate && window.location.hash !== '#' + viewId) {
      history.pushState({ view: viewId }, '', '#' + viewId);
    }

    /* Scroll to top */
    window.scrollTo(0, 0);
  }

  /**
   * Get the current active view ID.
   */
  function getCurrentView() {
    return currentView;
  }

  /**
   * Initialize router: read hash and show the correct view.
   */
  function init() {
    /* Set initial history state so first back press works correctly */
    var hash = window.location.hash.replace('#', '') || 'home';
    history.replaceState({ view: hash }, '', '#' + hash);
    _navigatingFromPopstate = true;
    try { showView(hash); } finally { _navigatingFromPopstate = false; }

    /* Listen for back/forward button and swipe-back navigation */
    window.addEventListener('popstate', function () {
      var hash = window.location.hash.replace('#', '') || 'home';
      _navigatingFromPopstate = true;
      try { showView(hash); } finally { _navigatingFromPopstate = false; }
    });
  }

  return {
    showView: showView,
    onInit: onInit,
    onShow: onShow,
    getCurrentView: getCurrentView,
    init: init
  };
})();
