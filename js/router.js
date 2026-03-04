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

    /* Update hash without triggering hashchange */
    if (window.location.hash !== '#' + viewId) {
      history.replaceState(null, '', '#' + viewId);
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
    /* Handle hash-based navigation */
    var hash = window.location.hash.replace('#', '') || 'home';
    showView(hash);

    /* Listen for hash changes (back/forward) */
    window.addEventListener('hashchange', function () {
      var hash = window.location.hash.replace('#', '') || 'home';
      showView(hash);
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
