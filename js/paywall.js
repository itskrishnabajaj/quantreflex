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
  daily_goal_limit: true,
  focus_timer: true,
  table_modal: true,
  ai_explain: true,
  ai_coach: true,
  ai_study_plan: true,
  adaptive_training: true
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

var _AI_FEATURES = { ai_explain: true, ai_coach: true, ai_study_plan: true };

function _getAccessUserState() {
  if (typeof FirestoreSync !== 'undefined' && typeof FirestoreSync.getAccessState === 'function') {
    var state = FirestoreSync.getAccessState();
    if (state) return state;
  }
  return { isPremium: false, isPremiumPlus: false, isTrial: false, hasPaid: false, isEarlyUser: false, trialEnd: null };
}

function canAccess(feature, user) {
  var normalizedUser = user || _getAccessUserState();
  if (_AI_FEATURES[feature]) {
    return !!(normalizedUser && normalizedUser.isPremiumPlus === true);
  }
  if (normalizedUser && normalizedUser.isPremium === true) return true;
  if (normalizedUser && normalizedUser.hasPaid === true) return true;
  if (normalizedUser && normalizedUser.isEarlyUser === true) return true;
  if (normalizedUser && normalizedUser.isTrial === true) {
    var trialEndMs = _toMillis(normalizedUser.trialEnd);
    if (trialEndMs > 0 && Date.now() <= trialEndMs) return true;
  }
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
      accent: '🎯 You tried to start a custom session. This is a Premium feature.'
    },
    review_mistakes: {
      accent: '📋 Reviewing your mistakes is a Premium feature.'
    },
    add_formula: {
      accent: '📝 Saving your own formulas is a Premium feature.'
    },
    add_topic: {
      accent: '📂 Creating custom topics is a Premium feature.'
    },
    stats: {
      accent: '📊 Deep analytics are available in Premium.'
    },
    settings: {
      accent: '⚙️ This setting is unlocked in Premium.'
    },
    focus_timer: {
      accent: '⏱ Focus Timer is a Premium feature.'
    },
    adaptive_training: {
      accent: '🤖 Adaptive Training adjusts difficulty in real time. Premium only.'
    },
    table_modal: {
      accent: '📋 Full-screen table view is a Premium feature.'
    },
    upgrade: {
      accent: '🔥 You\'re on a roll! Unlock everything to keep the momentum going.'
    }
  };
  return map[featureType] || {};
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
      amount: 7900,
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
  var user = _getAccessUserState();
  if (user && user.isPremium === true) return;
  if (user && (user.hasPaid === true || user.isEarlyUser === true)) return;
  if (user && user.isTrial === true) {
    var te = _toMillis(user.trialEnd);
    if (te > 0 && Date.now() <= te) return;
  }
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

      '<div class="paywall-header">' +
        '<div class="paywall-hero-icon">🧠</div>' +
        '<h2 class="paywall-title">Unlock Your Full Potential</h2>' +
        '<p class="paywall-tagline">Train faster. Improve accuracy. Perform better.</p>' +
      '</div>' +

      (copy.accent ? '<p class="paywall-context-accent">' + copy.accent + '</p>' : '') +

      '<ul class="paywall-benefits">' +
        '<li><span class="paywall-benefit-icon">⚡</span><span>Train your brain for speed</span></li>' +
        '<li><span class="paywall-benefit-icon">🎯</span><span>Improve weak areas faster</span></li>' +
        '<li><span class="paywall-benefit-icon">📈</span><span>Build accuracy and consistency</span></li>' +
        '<li><span class="paywall-benefit-icon">🧠</span><span>Learn from mistakes instantly</span></li>' +
      '</ul>' +

      '<div class="paywall-plans">' +
        '<div class="paywall-plan paywall-plan-premium">' +
          '<div class="paywall-plan-badge">Most Popular</div>' +
          '<div class="paywall-plan-name">Premium</div>' +
          '<div class="paywall-plan-price">₹79 <span class="paywall-plan-period">Lifetime</span></div>' +
          '<ul class="paywall-plan-features">' +
            '<li>✓ All training modes unlocked</li>' +
            '<li>✓ Custom practice sessions</li>' +
            '<li>✓ Mistake review & retry</li>' +
            '<li>✓ Adaptive difficulty</li>' +
            '<li>✓ Hard mode & power settings</li>' +
            '<li>✓ Speed benchmark & analytics</li>' +
            '<li>✓ All future updates included</li>' +
          '</ul>' +
          '<button class="btn accent paywall-upgrade" type="button">Unlock Premium – ₹79</button>' +
          '<p class="paywall-plan-note">One-time payment · No subscription</p>' +
        '</div>' +

        '<div class="paywall-plan paywall-plan-plus">' +
          '<div class="paywall-plan-name">Premium+</div>' +
          '<div class="paywall-plan-price">₹49<span class="paywall-plan-period">/mo</span></div>' +
          '<div class="paywall-plan-or">or ₹499/yr</div>' +
          '<ul class="paywall-plan-features">' +
            '<li>✓ Everything in Premium</li>' +
            '<li>✓ AI mistake explanations</li>' +
            '<li>✓ AI coach insights</li>' +
            '<li>✓ Study plan generator</li>' +
            '<li>✓ AI word problem trainer</li>' +
          '</ul>' +
          '<button class="btn paywall-plus-btn" type="button">Coming Soon</button>' +
          '<p class="paywall-plan-note">Notify me when available</p>' +
        '</div>' +
      '</div>' +

      '<table class="paywall-compare">' +
        '<thead><tr>' +
          '<th>Feature</th>' +
          '<th>Free</th>' +
          '<th class="paywall-compare-highlight">Premium</th>' +
          '<th>Premium+</th>' +
        '</tr></thead>' +
        '<tbody>' +
          '<tr><td>Practice</td><td>✓</td><td class="paywall-compare-highlight">✓</td><td>✓</td></tr>' +
          '<tr><td>Custom training</td><td>✗</td><td class="paywall-compare-highlight">✓</td><td>✓</td></tr>' +
          '<tr><td>Review mistakes</td><td>✗</td><td class="paywall-compare-highlight">✓</td><td>✓</td></tr>' +
          '<tr><td>Adaptive training</td><td>✗</td><td class="paywall-compare-highlight">✓</td><td>✓</td></tr>' +
          '<tr><td>Speed benchmark</td><td>✗</td><td class="paywall-compare-highlight">✓</td><td>✓</td></tr>' +
          '<tr><td>AI features</td><td>✗</td><td class="paywall-compare-highlight">✗</td><td>✓</td></tr>' +
        '</tbody>' +
      '</table>' +

      '<div class="paywall-social-proof">' +
        '<p class="paywall-trust">⭐ Used by CAT, GMAT &amp; CET aspirants daily</p>' +
        '<p class="paywall-urgency">🔥 Lifetime pricing · only while it lasts</p>' +
      '</div>' +

      '<div class="paywall-sticky-footer">' +
        '<button class="paywall-free-continue" type="button">Continue Free</button>' +
      '</div>' +
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
        var _now = Date.now();
        if (_now - _paywallGuestPromptAt < 1000) return;
        _paywallGuestPromptAt = _now;
        showToast('Please login to continue payment.');
        return;
      }
      openPayment(userId);
    });
  }

  var plusBtn = overlay.querySelector('.paywall-plus-btn');
  if (plusBtn) {
    plusBtn.addEventListener('click', function () {
      showToast('Premium+ coming soon. Contact us to express interest.');
    });
  }

  var freeBtn = overlay.querySelector('.paywall-free-continue');
  if (freeBtn) {
    freeBtn.addEventListener('click', _closePaywallModal);
  }

  /* Interactive plan card selection */
  var planPremium = overlay.querySelector('.paywall-plan-premium');
  var planPlus = overlay.querySelector('.paywall-plan-plus');
  if (planPremium && planPlus) {
    planPremium.addEventListener('click', function (e) {
      if (e.target.closest('button')) return;
      planPremium.classList.remove('paywall-plan-deselected');
      planPlus.classList.remove('paywall-plan-selected');
    });
    planPlus.addEventListener('click', function (e) {
      if (e.target.closest('button')) return;
      planPlus.classList.add('paywall-plan-selected');
      planPremium.classList.add('paywall-plan-deselected');
    });
  }
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
global.showPaywall = showPaywall;
global.openPayment = openPayment;
global.verifyPaymentResponse = verifyPaymentResponse;
global.unlockPremium = unlockPremium;
global.getDailyQuestionLimit = getDailyQuestionLimit;
global.hasReachedDailyLimit = hasReachedDailyLimit;
global.Paywall = {
  canAccess: canAccess,
  canAccessFeature: canAccessFeature,
  showPaywall: showPaywall,
  getDailyQuestionLimit: getDailyQuestionLimit,
  hasReachedDailyLimit: hasReachedDailyLimit
};
})(window);
