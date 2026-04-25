(function(global) {
'use strict';

/* ------------------------------------------------------------------ */
/*  Constants & Config                                                */
/* ------------------------------------------------------------------ */

var RAZORPAY_LIVE_KEY = 'rzp_live_RjO1O5A3zO1yI7'; // Extracted from original code
var API_BASE = (typeof window !== 'undefined' && window.QUANTREFLEX_API_BASE) || 'https://quantreflex-9o8w.onrender.com';
var PAYMENT_TIMEOUT_MS = 60000;
var PAYMENT_SLOW_MS = 5000;

var _paywallModalOpen = false;
var _paywallClosing = false;
var _paywallEscHandler = null;
var _paywallPaymentBusy = false;
var _paymentSafetyTimer = null;
var _paymentSlowTimer = null;
var _paywallUpgradeBtn = null;
var _paywallLastOpenAt = 0;
var PAYWALL_DEBOUNCE_MS = 500;
var _paywallGuestPromptAt = 0;

var _LOCKED_FEATURES = {
  custom_training: true,
  review_mistakes: true,
  add_formula: true,
  add_topic: true,
  stats: true,
  settings: true,
  focus_timer: true,
  adaptive_training: true,
  table_modal: true,
  ai_explain: true,
  ai_coach: true,
  ai_study_plan: true
};

/* ------------------------------------------------------------------ */
/*  Access Logic                                                      */
/* ------------------------------------------------------------------ */

function _getAccessUserState() {
  if (typeof FirestoreSync !== 'undefined' && typeof FirestoreSync.getAccessState === 'function') {
    var state = FirestoreSync.getAccessState();
    if (state) return state;
  }
  return { premium: false, plan: null, expiry: null };
}

function canAccess(feature, user) {
  var normalizedUser = user || _getAccessUserState();
  if (normalizedUser && normalizedUser.premium === true) return true;
  return !_LOCKED_FEATURES[feature];
}

function canAccessFeature(feature) {
  return canAccess(feature, _getAccessUserState());
}

function getDailyQuestionLimit() {
  var user = _getAccessUserState();
  if (user && user.premium === true) return Infinity;
  return 25;
}

function hasReachedDailyLimit() {
  var limit = getDailyQuestionLimit();
  if (limit === Infinity) return false;
  var p = (typeof loadProgress === 'function') ? loadProgress() : {};
  return (p.todayAttempted || 0) >= limit;
}

/* ------------------------------------------------------------------ */
/*  UI Helpers                                                        */
/* ------------------------------------------------------------------ */

function _getPaywallCopy(featureType) {
  var map = {
    custom_training: { accent: '🎯 You tried to start a custom session. This is a Premium feature.' },
    review_mistakes: { accent: '📋 Reviewing your mistakes is a Premium feature.' },
    add_formula: { accent: '📝 Saving your own formulas is a Premium feature.' },
    add_topic: { accent: '📂 Creating custom topics is a Premium feature.' },
    stats: { accent: '📊 Deep analytics are available in Premium.' },
    settings: { accent: '⚙️ This setting is unlocked in Premium.' },
    focus_timer: { accent: '⏱ Focus Timer is a Premium feature.' },
    adaptive_training: { accent: '🤖 Adaptive Training adjusts difficulty in real time. Premium only.' },
    table_modal: { accent: '📋 Full-screen table view is a Premium feature.' },
    ai_explain: { accent: '🧠 AI-powered explanations require Premium.' },
    ai_coach: { accent: '🤖 AI Coach insights require Premium.' },
    ai_study_plan: { accent: '📅 AI Study Plan generator requires Premium.' },
    upgrade: { accent: '🔥 You\'re on a roll! Unlock everything to keep the momentum going.' }
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

function showToast(msg) {
  if (typeof global.showToast === 'function') {
    global.showToast(msg);
  } else {
    console.log('Toast:', msg);
    alert(msg);
  }
}

/* ------------------------------------------------------------------ */
/*  Payment Processing                                                */
/* ------------------------------------------------------------------ */

function _getIdToken(callback) {
  if (typeof Auth !== 'undefined' && typeof Auth.getCurrentUser === 'function') {
    var u = Auth.getCurrentUser();
    if (u && typeof u.getIdToken === 'function') {
      u.getIdToken().then(function (tok) { callback(tok); }).catch(function () { callback(null); });
      return;
    }
  }
  callback(null);
}

function _resetPaymentGuards() {
  if (_paymentSafetyTimer) clearTimeout(_paymentSafetyTimer);
  if (_paymentSlowTimer) clearTimeout(_paymentSlowTimer);
  _paymentSafetyTimer = null;
  _paymentSlowTimer = null;
  _paywallPaymentBusy = false;
  
  if (_paywallUpgradeBtn) {
    _paywallUpgradeBtn.disabled = false;
    _paywallUpgradeBtn.classList.remove('btn-loading');
    var activePlan = document.querySelector('.paywall-plan-selected') || document.querySelector('.paywall-plan-premium');
    if (activePlan) {
      var planType = activePlan.getAttribute('data-plan') || 'premium';
      var price = planType === 'plus_12m' ? '499' : planType === 'plus_6m' ? '299' : '99';
      _paywallUpgradeBtn.textContent = 'Unlock Access \u2013 \u20B9' + price;
    } else {
      _paywallUpgradeBtn.textContent = 'Unlock Access';
    }
  }
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

var _paymentAttemptId = 0;

function openPayment(plan, userId) {
  if (_paywallPaymentBusy) return;
  _paywallPaymentBusy = true;
  
  if (_paywallUpgradeBtn) {
    _paywallUpgradeBtn.disabled = true;
    _paywallUpgradeBtn.textContent = 'Processing\u2026';
    _paywallUpgradeBtn.classList.add('btn-loading');
  }

  var currentAttempt = ++_paymentAttemptId;

  if (_paymentSlowTimer) clearTimeout(_paymentSlowTimer);
  _paymentSlowTimer = setTimeout(function () {
    if (_paywallUpgradeBtn && _paywallPaymentBusy) {
      _paywallUpgradeBtn.textContent = 'Still processing, please wait\u2026';
    }
  }, PAYMENT_SLOW_MS);

  if (_paymentSafetyTimer) clearTimeout(_paymentSafetyTimer);
  _paymentSafetyTimer = setTimeout(function () {
    ++_paymentAttemptId;
    _resetPaymentGuards();
  }, PAYMENT_TIMEOUT_MS);

  _loadRazorpayScript(function (loadErr) {
    if (currentAttempt !== _paymentAttemptId) return;
    if (loadErr || typeof Razorpay === 'undefined') {
      _resetPaymentGuards();
      showToast('Payment service is unavailable right now.');
      return;
    }

    _getIdToken(function (idToken) {
      if (currentAttempt !== _paymentAttemptId) return;
      if (!idToken) {
        _resetPaymentGuards();
        showToast('Please login to continue payment.');
        return;
      }

      console.log('[Payment] Calling /api/payment/create-order, plan:', plan);
      fetch(API_BASE + '/api/payment/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + idToken },
        body: JSON.stringify({ plan: plan })
      })
      .then(function (resp) {
        if (currentAttempt !== _paymentAttemptId) return null;
        if (!resp.ok) {
          return resp.json().catch(function () { return {}; }).then(function (errData) {
            if (currentAttempt !== _paymentAttemptId) return null;
            _resetPaymentGuards();
            var errMsg = (errData && errData.error && errData.error.message) ? errData.error.message : 'Could not start payment. Please try again.';
            console.error('[Payment] Create order failed:', errMsg, errData);
            showToast(errMsg);
            return null;
          });
        }
        return resp.json();
      })
      .then(function (data) {
        if (currentAttempt !== _paymentAttemptId) return;
        if (!data || !data.orderId) {
          if (data !== null) {
            _resetPaymentGuards();
            showToast('Could not start payment. Please try again.');
          }
          return;
        }

        var description = plan === 'plus_12m' ? '12 Months Access' : (plan === 'plus_6m' ? '6 Months Access' : 'Lifetime Access');
        
        var options = {
          key: RAZORPAY_LIVE_KEY,
          amount: data.amount,
          currency: data.currency,
          order_id: data.orderId,
          name: 'QuantReflex',
          description: description,
          modal: {
            ondismiss: function () {
              _resetPaymentGuards();
              showToast('Payment cancelled. You can upgrade anytime.');
            }
          },
          handler: function (response) {
            if (currentAttempt !== _paymentAttemptId) return;
            var paymentId = response.razorpay_payment_id;
            var orderId = response.razorpay_order_id;
            var signature = response.razorpay_signature;

            if (!paymentId || !orderId || !signature) {
              _resetPaymentGuards();
              showToast('Payment verification failed. Please retry.');
              return;
            }

            _getIdToken(function (freshToken) {
              if (currentAttempt !== _paymentAttemptId) return;
              fetch(API_BASE + '/api/payment/verify-payment', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (freshToken || idToken) },
                body: JSON.stringify({ orderId: orderId, paymentId: paymentId, signature: signature, plan: plan })
              })
              .then(function (r) {
                if (currentAttempt !== _paymentAttemptId) return null;
                if (!r.ok) {
                  return r.json().catch(function () { return {}; }).then(function (errData) {
                    return { success: false, _serverError: (errData && errData.error && errData.error.message) || null };
                  });
                }
                return r.json();
              })
              .then(function (result) {
                if (currentAttempt !== _paymentAttemptId) return;
                _resetPaymentGuards();
                if (!result || !result.success) {
                  var activationMsg = (result && result._serverError) ? result._serverError : 'Access activation failed. Please contact support.';
                  showToast(activationMsg);
                  return;
                }
                
                if (typeof FirestoreSync !== 'undefined' && typeof FirestoreSync.unlockAccess === 'function') {
                  FirestoreSync.unlockAccess(result.plan, result.expiry, paymentId, orderId, function (err) {
                    if (err) {
                      showToast('Payment successful! Refresh to see your benefits.');
                    } else {
                      showToast('Premium activated! 🎉');
                      _closePaywallModal();
                      var currentView = (typeof Router !== 'undefined' && Router.getCurrentView) ? Router.getCurrentView() : 'home';
                      if (currentView && typeof Router !== 'undefined' && Router.showView) Router.showView(currentView);
                    }
                  });
                } else {
                  showToast('Payment successful! Refresh to see your benefits.');
                  _closePaywallModal();
                }
              })
              .catch(function () {
                if (currentAttempt !== _paymentAttemptId) return;
                _resetPaymentGuards();
                showToast('Access activation failed. Please contact support.');
              });
            });
          }
        };

        try {
          var rzp = new Razorpay(options);
          rzp.on('payment.failed', function () {
            _resetPaymentGuards();
            showToast('Payment failed. Please try again.');
          });
          rzp.open();
        } catch (_) {
          _resetPaymentGuards();
          showToast('Could not open payment. Check your network and retry.');
        }
      })
      .catch(function (networkErr) {
        if (currentAttempt !== _paymentAttemptId) return;
        _resetPaymentGuards();
        showToast('Could not start payment. Check your network and retry.');
      });
    });
  });
}

/* ------------------------------------------------------------------ */
/*  UI Modal                                                          */
/* ------------------------------------------------------------------ */

function showPaywall(featureType) {
  var user = _getAccessUserState();
  if (user && user.premium === true) return;
  
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
        '<div class="paywall-hero-icon">🚀</div>' +
        '<h2 class="paywall-title">Unlock Your Full Potential</h2>' +
        '<p class="paywall-tagline">Train faster. Improve accuracy. Perform better.</p>' +
      '</div>' +

      (copy.accent ? '<p class="paywall-context-accent">' + copy.accent + '</p>' : '') +

      '<ul class="paywall-benefits">' +
        '<li><span class="paywall-benefit-icon">⚡</span><span>Custom & Adaptive Training</span></li>' +
        '<li><span class="paywall-benefit-icon">🎯</span><span>Mistake review & Retry</span></li>' +
        '<li><span class="paywall-benefit-icon">🧠</span><span>AI Coach & Explanations</span></li>' +
        '<li><span class="paywall-benefit-icon">📈</span><span>Deep Performance Analytics</span></li>' +
      '</ul>' +

      '<div class="paywall-plans" style="grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 20px;">' +
        
        '<div class="paywall-plan paywall-plan-premium paywall-plan-selected" data-plan="premium" data-price="99">' +
          '<div class="paywall-plan-badge" style="top: -12px;">Best Value</div>' +
          '<div class="paywall-plan-name" style="font-size: 14px;">Lifetime</div>' +
          '<div class="paywall-plan-price" style="font-size: 20px;">₹99</div>' +
        '</div>' +

        '<div class="paywall-plan paywall-plan-deselected" data-plan="plus_6m" data-price="299">' +
          '<div class="paywall-plan-name" style="font-size: 14px;">6 Months</div>' +
          '<div class="paywall-plan-price" style="font-size: 20px;">₹299</div>' +
        '</div>' +

        '<div class="paywall-plan paywall-plan-deselected" data-plan="plus_12m" data-price="499">' +
          '<div class="paywall-plan-name" style="font-size: 14px;">12 Months</div>' +
          '<div class="paywall-plan-price" style="font-size: 20px;">₹499</div>' +
        '</div>' +

      '</div>' +

      '<button class="btn accent paywall-upgrade" type="button" style="width:100%; margin-bottom: 12px; font-size: 16px;">Unlock Access – ₹99</button>' +
      '<p class="paywall-plan-note" style="text-align:center; font-size: 12px; color: #a1a1aa; margin-bottom: 16px;">One-time secure payment via Razorpay</p>' +

      '<div class="paywall-social-proof">' +
        '<p class="paywall-trust">⭐ Used by CAT, GMAT &amp; CET aspirants daily</p>' +
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

  var freeBtn = overlay.querySelector('.paywall-free-continue');
  if (freeBtn) freeBtn.addEventListener('click', _closePaywallModal);

  /* Interactive plan card selection */
  var planCards = overlay.querySelectorAll('.paywall-plan');
  var upgradeBtn = overlay.querySelector('.paywall-upgrade');
  var selectedPlan = 'premium';

  for (var i = 0; i < planCards.length; i++) {
    planCards[i].addEventListener('click', function(e) {
      if (e.target.closest('button')) return;
      var card = e.currentTarget;
      
      // Update UI selection
      for (var j = 0; j < planCards.length; j++) {
        planCards[j].classList.remove('paywall-plan-selected');
        planCards[j].classList.add('paywall-plan-deselected');
      }
      card.classList.remove('paywall-plan-deselected');
      card.classList.add('paywall-plan-selected');
      
      // Update state and button text
      selectedPlan = card.getAttribute('data-plan');
      var price = card.getAttribute('data-price');
      if (upgradeBtn) {
        upgradeBtn.textContent = 'Unlock Access – ₹' + price;
      }
    });
  }

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
      openPayment(selectedPlan, userId);
    });
  }

  _loadRazorpayScript(null);
}

/* ------------------------------------------------------------------ */
/*  Exports                                                           */
/* ------------------------------------------------------------------ */

global.canAccess = canAccess;
global.canAccessFeature = canAccessFeature;
global.showPaywall = showPaywall;
global.openPayment = openPayment;
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
