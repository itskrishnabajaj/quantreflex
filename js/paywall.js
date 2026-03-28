/**
 * paywall.js — Premium access control + paywall + Razorpay flow
 */

(function (global) {
var RAZORPAY_LIVE_KEY = 'rzp_live_STanzIgCpSAfL7';
var _LOCKED_FEATURES = {
  custom_training: true,
  review_mistakes: true,
  add_formula: true,
  add_topic: true,
  performance_insights: true,
  category_accuracy: true,
  hard_mode: true,
  skip_question: true,
  advanced_theme: true,
  daily_goal_limit: true
};
var PAYWALL_DEBOUNCE_MS = 280;
var PAYMENT_TIMEOUT_MS = 120000;
var _paywallModalOpen = false;
var _paywallClosing = false;
var _paywallPaymentBusy = false;
var _paywallUnlockInFlight = false;
var _paywallLastPaymentId = '';
var _paywallUpgradeBtn = null;
var _paywallEscHandler = null;
var _paywallGuestPromptAt = 0;
var _paywallLastOpenAt = 0;
var _paymentSafetyTimer = null;
var _unlockGuard = {};

function _toMillis(value) {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') {
    var parsed = Date.parse(value);
    return isNaN(parsed) ? 0 : parsed;
  }
  if (typeof value.toDate === 'function') {
    try { return value.toDate().getTime(); } catch (_) { return 0; }
  }
  return 0;
}

function _resetPaymentGuards(enableButton) {
  if (_paymentSafetyTimer) {
    clearTimeout(_paymentSafetyTimer);
    _paymentSafetyTimer = null;
  }
  _paywallPaymentBusy = false;
  _paywallUnlockInFlight = false;
  _paywallLastPaymentId = '';
  if (enableButton && _paywallUpgradeBtn) _paywallUpgradeBtn.disabled = false;
}

function _getAccessUserState() {
  if (typeof FirestoreSync !== 'undefined' && typeof FirestoreSync.getAccessState === 'function') {
    var state = FirestoreSync.getAccessState();
    if (state) return state;
  }
  return { isPremium: false, isTrial: false, hasPaid: false, isEarlyUser: false, trialEnd: null };
}

function canAccess(feature, user) {
  var normalizedUser = user || _getAccessUserState();
  if (normalizedUser && normalizedUser.hasPaid === true) return true;
  if (normalizedUser && normalizedUser.isEarlyUser === true) return true;
  if (normalizedUser && normalizedUser.isTrial === true) {
    var trialEndMs = _toMillis(normalizedUser.trialEnd);
    if (trialEndMs > 0 && Date.now() <= trialEndMs) return true;
  }
  if (normalizedUser && normalizedUser.isPremium === true && normalizedUser.isTrial !== true) return true;
  return !_LOCKED_FEATURES[feature];
}

function canAccessFeature(feature) {
  return canAccess(feature, _getAccessUserState());
}

function canAccessCustomMode(user) {
  return canAccess('custom_training', user || _getAccessUserState());
}

function _getPaywallCopy(featureType) {
  var map = {
    custom_training: {
      title: 'Custom Training Pro',
      subtitle: 'Build laser-focused sessions by choosing exact topics and question count.',
      bullets: ['Target weak areas faster', 'Practice exactly what matters', 'Train with personalized sets']
    },
    review_mistakes: {
      title: 'Review Mistakes Pro',
      subtitle: 'Turn wrong answers into strengths with dedicated correction practice.',
      bullets: ['Fix recurring mistakes', 'Boost retention', 'Improve exam-day accuracy']
    },
    add_formula: {
      title: 'Formula Vault Pro',
      subtitle: 'Save your own formulas and shortcuts so your Learn vault matches your prep.',
      bullets: ['Build personal notes', 'Store shortcut tricks', 'Revise smarter daily']
    },
    add_topic: {
      title: 'Custom Topics Pro',
      subtitle: 'Create topic buckets tailored to your syllabus and revision strategy.',
      bullets: ['Organize by your exam plan', 'Keep formulas grouped', 'Scale your study system']
    },
    stats: {
      title: 'Analytics Pro',
      subtitle: 'Unlock deeper insights to train with precision and consistency.',
      bullets: ['Find strongest and weakest areas', 'Track trend direction', 'Optimize daily practice']
    },
    settings: {
      title: 'Power Settings Pro',
      subtitle: 'Unlock advanced training controls for faster, tougher prep.',
      bullets: ['Hard mode challenge', 'Skip controls', 'Premium themes and goals']
    }
  };
  return map[featureType] || {
    title: 'Upgrade to Premium',
    subtitle: 'Get lifetime access to all advanced QuantReflex features.',
    bullets: ['One-time payment', 'Instant unlock', 'Future premium updates included']
  };
}

function _closePaywallModal() {
  if (_paywallClosing) return;
  var overlay = document.getElementById('paywallModalOverlay');
  if (!overlay) {
    _paywallModalOpen = false;
    _paywallClosing = false;
    document.body.classList.remove('paywall-open');
    return;
  }
  _paywallClosing = true;
  overlay.classList.add('closing');
  document.body.classList.remove('paywall-open');
  _paywallUpgradeBtn = null;
  if (_paywallEscHandler) {
    document.removeEventListener('keydown', _paywallEscHandler);
    _paywallEscHandler = null;
  }
  setTimeout(function () {
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    _paywallModalOpen = false;
    _paywallClosing = false;
  }, 220);
}

function unlockPremium(userId, paymentId) {
  var unlockToken = arguments.length > 2 ? arguments[2] : null;
  if (unlockToken !== _unlockGuard) return;
  if (_paywallUnlockInFlight) return;
  if (!_paywallPaymentBusy || _paywallLastPaymentId !== String(paymentId || '')) {
    showToast('Payment validation failed. Please retry.');
    return;
  }
  if (typeof Auth !== 'undefined' && typeof Auth.getUserId === 'function') {
    var currentUser = Auth.getUserId();
    if (currentUser && userId && currentUser !== userId) {
      _resetPaymentGuards(true);
      return;
    }
  }
  if (typeof FirestoreSync !== 'undefined' && typeof FirestoreSync.unlockPremium === 'function') {
    _paywallUnlockInFlight = true;
    FirestoreSync.unlockPremium(paymentId, function (err) {
      _resetPaymentGuards(true);
      if (err) {
        showToast('Unable to unlock premium. Please try again.');
        return;
      }
      showToast('Premium unlocked successfully 🎉');
      _closePaywallModal();
      var currentView = Router.getCurrentView ? Router.getCurrentView() : 'home';
      if (currentView && Router.showView) Router.showView(currentView);
    });
    return;
  }
  _resetPaymentGuards(true);
  showToast('Unable to unlock premium. Please try again.');
}

function verifyPaymentResponse(response) {
  if (!response || typeof response !== 'object') return false;
  if (typeof response.razorpay_payment_id !== 'string') return false;
  var id = response.razorpay_payment_id.trim();
  return id.length > 0 && id.length <= 128;
}

function _loadRazorpayScript(callback) {
  if (typeof Razorpay !== 'undefined') {
    if (callback) callback(null);
    return;
  }
  var existing = document.getElementById('razorpayCheckoutScript');
  if (existing) {
    existing.addEventListener('load', function () { if (callback) callback(null); }, { once: true });
    existing.addEventListener('error', function () { if (callback) callback('script_load_failed'); }, { once: true });
    return;
  }
  var script = document.createElement('script');
  script.id = 'razorpayCheckoutScript';
  script.src = 'https://checkout.razorpay.com/v1/checkout.js';
  script.async = true;
  script.onload = function () { if (callback) callback(null); };
  script.onerror = function () { if (callback) callback('script_load_failed'); };
  document.body.appendChild(script);
}

function openPayment(userId) {
  if (_paywallPaymentBusy || _paywallUnlockInFlight) return;
  _paywallPaymentBusy = true;
  if (_paywallUpgradeBtn) _paywallUpgradeBtn.disabled = true;
  if (_paymentSafetyTimer) clearTimeout(_paymentSafetyTimer);
  _paymentSafetyTimer = setTimeout(function () {
    _resetPaymentGuards(true);
  }, PAYMENT_TIMEOUT_MS);
  _loadRazorpayScript(function (loadErr) {
    if (loadErr || typeof Razorpay === 'undefined') {
      _resetPaymentGuards(true);
      showToast('Payment service is unavailable right now.');
      return;
    }
    var options = {
      key: RAZORPAY_LIVE_KEY,
      amount: 6900,
      currency: 'INR',
      name: 'QuantReflex',
      description: 'Lifetime Premium Access',
      modal: {
        ondismiss: function () {
          _resetPaymentGuards(true);
          showToast('Payment cancelled. You can upgrade anytime.');
        }
      },
      handler: function (response) {
        if (!verifyPaymentResponse(response)) {
          _resetPaymentGuards(true);
          showToast('Payment verification failed. Please retry.');
          return;
        }
        _paywallLastPaymentId = String(response.razorpay_payment_id).trim();
        unlockPremium(userId, response.razorpay_payment_id, _unlockGuard);
      }
    };
    try {
      var rzp = new Razorpay(options);
      rzp.on('payment.failed', function () {
        _resetPaymentGuards(true);
        showToast('Payment failed. Please try again.');
      });
      rzp.open();
    } catch (_) {
      _resetPaymentGuards(true);
      showToast('Could not open payment. Check your network and retry.');
    }
  });
}

function showPaywall(featureType) {
  var now = Date.now();
  if (now - _paywallLastOpenAt < PAYWALL_DEBOUNCE_MS) return;
  if (_paywallModalOpen || _paywallClosing) return;
  var existing = document.getElementById('paywallModalOverlay');
  if (existing) {
    document.body.classList.add('paywall-open');
    if (_paywallEscHandler) {
      document.removeEventListener('keydown', _paywallEscHandler);
      _paywallEscHandler = null;
    }
    _paywallEscHandler = function (event) {
      if (event.key === 'Escape') _closePaywallModal();
    };
    document.addEventListener('keydown', _paywallEscHandler);
    _paywallUpgradeBtn = existing.querySelector('.paywall-upgrade');
    _paywallModalOpen = true;
    return;
  }
  _paywallLastOpenAt = now;
  _paywallModalOpen = true;
  var copy = _getPaywallCopy(featureType);
  var userId = (typeof Auth !== 'undefined' && typeof Auth.getUserId === 'function') ? Auth.getUserId() : '';
  var overlay = document.createElement('div');
  overlay.id = 'paywallModalOverlay';
  overlay.className = 'paywall-overlay';
  overlay.innerHTML =
    '<div class="paywall-card">' +
      '<button class="paywall-close" type="button" aria-label="Close">×</button>' +
      '<div class="paywall-hero-icon">🧠</div>' +
      '<p class="paywall-badge">Premium</p>' +
      '<h2>Train your brain like a top performer</h2>' +
      '<p class="paywall-subtitle">' + copy.subtitle + '</p>' +
      '<ul class="paywall-benefits">' +
        '<li>' + copy.bullets[0] + '</li>' +
        '<li>' + copy.bullets[1] + '</li>' +
        '<li>' + copy.bullets[2] + '</li>' +
        '<li>All future premium features included</li>' +
      '</ul>' +
      '<button class="btn accent paywall-upgrade" type="button">Unlock Lifetime Premium · ₹69</button>' +
      '<p class="paywall-footnote">One-time payment · No subscription · Instant access</p>' +
    '</div>';
  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) _closePaywallModal();
  });
  document.body.appendChild(overlay);
  document.body.classList.add('paywall-open');
  _paywallEscHandler = function (event) {
    if (event.key === 'Escape') _closePaywallModal();
  };
  document.addEventListener('keydown', _paywallEscHandler);

  var closeBtn = overlay.querySelector('.paywall-close');
  if (closeBtn) closeBtn.addEventListener('click', _closePaywallModal);
  var upgradeBtn = overlay.querySelector('.paywall-upgrade');
  if (upgradeBtn) {
    _paywallUpgradeBtn = upgradeBtn;
    upgradeBtn.addEventListener('click', function () {
      if (!userId) {
        var now = Date.now();
        if (now - _paywallGuestPromptAt < 1000) return;
        _paywallGuestPromptAt = now;
        showToast('Please login to continue payment.');
        return;
      }
      openPayment(userId);
    });
  }
}

function showFirstLoginPaywall() {
  try {
    var shown = localStorage.getItem('quant_first_login_paywall_shown');
    if (shown) return;
    localStorage.setItem('quant_first_login_paywall_shown', '1');
    setTimeout(function () {
      showPaywall('settings');
    }, 2000);
  } catch (_) {}
}

function getDailyQuestionLimit() {
  var user = _getAccessUserState();
  if (user && (user.hasPaid || user.isEarlyUser || user.isPremium)) return Infinity;
  return 25;
}

function hasReachedDailyLimit() {
  var limit = getDailyQuestionLimit();
  if (limit === Infinity) return false;
  var p = (typeof loadProgress === 'function') ? loadProgress() : {};
  return (p.todayAttempted || 0) >= limit;
}

global.canAccess = canAccess;
global.canAccessFeature = canAccessFeature;
global.canAccessCustomMode = canAccessCustomMode;
global.showPaywall = showPaywall;
global.openPayment = openPayment;
global.verifyPaymentResponse = verifyPaymentResponse;
global.unlockPremium = unlockPremium;
global.showFirstLoginPaywall = showFirstLoginPaywall;
global.getDailyQuestionLimit = getDailyQuestionLimit;
global.hasReachedDailyLimit = hasReachedDailyLimit;
global.Paywall = {
  canAccess: canAccess,
  canAccessFeature: canAccessFeature,
  showPaywall: showPaywall,
  showFirstLoginPaywall: showFirstLoginPaywall,
  getDailyQuestionLimit: getDailyQuestionLimit,
  hasReachedDailyLimit: hasReachedDailyLimit
};
})(window);
