/**
 * paywall.js — Premium access control + paywall + Razorpay flow
 */

(function (global) {
var API_BASE = window.QUANTREFLEX_API_BASE || '';
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
var _paywallPlusPaymentBusy = false;
var _paywallPlusGuestPromptAt = 0;
var _paymentSlowTimer = null;
var _plusPaymentSlowTimer = null;
var PAYMENT_SLOW_MS = 5000;

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
  if (_paymentSlowTimer) {
    clearTimeout(_paymentSlowTimer);
    _paymentSlowTimer = null;
  }
  _paywallPaymentBusy = false;
  _paywallUnlockInFlight = false;
  _paywallLastPaymentId = '';
  if (enableButton && _paywallUpgradeBtn) {
    _paywallUpgradeBtn.disabled = false;
    _paywallUpgradeBtn.classList.remove('btn-loading');
    _paywallUpgradeBtn.textContent = 'Unlock Premium \u2013 \u20B979';
  }
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
    ai_explain: {
      accent: '🧠 AI-powered explanations require Premium+.'
    },
    ai_coach: {
      accent: '🤖 AI Coach insights require Premium+.'
    },
    ai_study_plan: {
      accent: '📅 AI Study Plan generator requires Premium+.'
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
  if (_paywallUpgradeBtn) {
    _paywallUpgradeBtn.disabled = true;
    _paywallUpgradeBtn.textContent = 'Processing\u2026';
    _paywallUpgradeBtn.classList.add('btn-loading');
  }
  if (_paymentSlowTimer) clearTimeout(_paymentSlowTimer);
  _paymentSlowTimer = setTimeout(function () {
    if (_paywallUpgradeBtn && _paywallPaymentBusy) {
      _paywallUpgradeBtn.textContent = 'Still processing, please wait\u2026';
    }
  }, PAYMENT_SLOW_MS);
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

function _getPlusIdToken(callback) {
  if (typeof Auth !== 'undefined' && typeof Auth.getCurrentUser === 'function') {
    var u = Auth.getCurrentUser();
    if (u && typeof u.getIdToken === 'function') {
      u.getIdToken().then(function (tok) { callback(tok); }).catch(function () { callback(null); });
      return;
    }
  }
  callback(null);
}

var _plusPaymentSafetyTimer = null;
var _plusAttemptId = 0;

function _resetPlusPaymentGuards() {
  if (_plusPaymentSafetyTimer) {
    clearTimeout(_plusPaymentSafetyTimer);
    _plusPaymentSafetyTimer = null;
  }
  if (_plusPaymentSlowTimer) {
    clearTimeout(_plusPaymentSlowTimer);
    _plusPaymentSlowTimer = null;
  }
  _paywallPlusPaymentBusy = false;
  var plusBtn = document.querySelector('.paywall-plus-subscribe');
  if (plusBtn) {
    plusBtn.disabled = false;
    plusBtn.classList.remove('btn-loading');
    var activeToggle = document.querySelector('.paywall-plus-toggle-btn.active');
    var isYearly = activeToggle && activeToggle.getAttribute('data-plan') === 'yearly';
    plusBtn.textContent = isYearly ? 'Subscribe Yearly \u00B7 \u20B9499' : 'Subscribe Monthly \u00B7 \u20B949';
  }
}

function openPremiumPlusPayment(plan, userId) {
  if (_paywallPlusPaymentBusy) return;
  _paywallPlusPaymentBusy = true;
  var plusBtn = document.querySelector('.paywall-plus-subscribe');
  if (plusBtn) {
    plusBtn.disabled = true;
    plusBtn.textContent = 'Processing\u2026';
    plusBtn.classList.add('btn-loading');
  }

  var currentAttempt = ++_plusAttemptId;

  if (_plusPaymentSlowTimer) clearTimeout(_plusPaymentSlowTimer);
  _plusPaymentSlowTimer = setTimeout(function () {
    if (plusBtn && _paywallPlusPaymentBusy) {
      plusBtn.textContent = 'Still processing, please wait\u2026';
    }
  }, PAYMENT_SLOW_MS);

  if (_plusPaymentSafetyTimer) clearTimeout(_plusPaymentSafetyTimer);
  _plusPaymentSafetyTimer = setTimeout(function () {
    ++_plusAttemptId;
    _resetPlusPaymentGuards();
  }, PAYMENT_TIMEOUT_MS);

  _loadRazorpayScript(function (loadErr) {
    if (currentAttempt !== _plusAttemptId) return;
    if (loadErr || typeof Razorpay === 'undefined') {
      _resetPlusPaymentGuards();
      showToast('Payment service is unavailable right now.');
      return;
    }

    _getPlusIdToken(function (idToken) {
      if (currentAttempt !== _plusAttemptId) return;
      if (!idToken) {
        _resetPlusPaymentGuards();
        showToast('Please login to continue payment.');
        return;
      }

      console.log('[Premium+] Calling /api/subscriptions/create, plan:', plan);
      fetch(API_BASE + '/api/subscriptions/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + idToken },
        body: JSON.stringify({ plan: plan })
      })
        .then(function (resp) {
          if (currentAttempt !== _plusAttemptId) return null;
          console.log('[Premium+] /api/subscriptions/create response status:', resp.status);
          if (!resp.ok) {
            return resp.json().catch(function () { return {}; }).then(function (errData) {
              if (currentAttempt !== _plusAttemptId) return null;
              _resetPlusPaymentGuards();
              var errMsg = (errData && errData.error && errData.error.message) ? errData.error.message : 'Could not start subscription. Please try again.';
              console.error('[Premium+] Create subscription failed:', errMsg, errData);
              showToast(errMsg);
              return null;
            });
          }
          return resp.json();
        })
        .then(function (data) {
          if (currentAttempt !== _plusAttemptId) return;
          console.log('[Premium+] Subscription response data:', JSON.stringify(data));
          if (!data || !data.subscriptionId) {
            if (data !== null) {
              _resetPlusPaymentGuards();
              console.error('[Premium+] Missing subscriptionId in response:', data);
              showToast('Could not start subscription. Please try again.');
            }
            return;
          }

          console.log('[Premium+] Opening Razorpay checkout with subscription_id:', data.subscriptionId);
          var description = plan === 'yearly' ? 'Premium+ Yearly - Rs 499/yr' : 'Premium+ Monthly - Rs 49/mo';
          var options = {
            key: RAZORPAY_LIVE_KEY,
            subscription_id: data.subscriptionId,
            name: 'QuantReflex',
            description: description,
            modal: {
              ondismiss: function () {
                _resetPlusPaymentGuards();
                showToast('Payment cancelled. You can subscribe anytime.');
              }
            },
            handler: function (response) {
              if (currentAttempt !== _plusAttemptId) return;
              console.log('Razorpay subscription payment success:', response.razorpay_payment_id);
              var paymentId = response.razorpay_payment_id;
              var rzpSubscriptionId = response.razorpay_subscription_id;
              var signature = response.razorpay_signature;
              if (!paymentId || !rzpSubscriptionId || !signature) {
                _resetPlusPaymentGuards();
                showToast('Payment verification failed. Please retry.');
                return;
              }

              _getPlusIdToken(function (freshToken) {
                if (currentAttempt !== _plusAttemptId) return;
                fetch(API_BASE + '/api/subscriptions/verify', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (freshToken || idToken) },
                  body: JSON.stringify({ subscriptionId: rzpSubscriptionId, paymentId: paymentId, signature: signature })
                })
                  .then(function (r) {
                    if (currentAttempt !== _plusAttemptId) return null;
                    if (!r.ok) {
                      return r.json().catch(function () { return {}; }).then(function (errData) {
                        return { success: false, _serverError: (errData && errData.error && errData.error.message) || null };
                      });
                    }
                    return r.json();
                  })
                  .then(function (result) {
                    if (currentAttempt !== _plusAttemptId) return;
                    _resetPlusPaymentGuards();
                    if (!result || !result.success) {
                      var activationMsg = (result && result._serverError) ? result._serverError : 'Subscription activation failed. Please contact support.';
                      showToast(activationMsg);
                      return;
                    }
                    if (typeof FirestoreSync !== 'undefined' && typeof FirestoreSync.unlockPremiumPlus === 'function') {
                      FirestoreSync.unlockPremiumPlus(result.plan, result.expiry, paymentId, function (err) {
                        if (err) {
                          showToast('Subscribed! Refresh to see your benefits.');
                        } else {
                          showToast('Premium+ activated! AI features unlocked.');
                          _closePaywallModal();
                          var currentView = (typeof Router !== 'undefined' && Router.getCurrentView) ? Router.getCurrentView() : 'home';
                          if (currentView && typeof Router !== 'undefined' && Router.showView) Router.showView(currentView);
                        }
                      });
                    } else {
                      showToast('Subscribed! Refresh to see your benefits.');
                      _closePaywallModal();
                    }
                  })
                  .catch(function () {
                    if (currentAttempt !== _plusAttemptId) return;
                    _resetPlusPaymentGuards();
                    showToast('Subscription activation failed. Please contact support.');
                  });
              });
            }
          };

          try {
            var rzp = new Razorpay(options);
            rzp.on('payment.failed', function () {
              _resetPlusPaymentGuards();
              showToast('Payment failed. Please try again.');
            });
            rzp.open();
          } catch (_) {
            _resetPlusPaymentGuards();
            showToast('Could not open payment. Check your network and retry.');
          }
        })
        .catch(function (networkErr) {
          if (currentAttempt !== _plusAttemptId) return;
          _resetPlusPaymentGuards();
          console.error('[Premium+] Network/fetch error:', networkErr);
          showToast('Could not start subscription. Check your network and retry.');
        });
    });
  });
}

function showPaywall(featureType) {
  var user = _getAccessUserState();
  var isAiFeature = !!_AI_FEATURES[featureType];
  if (!isAiFeature) {
    if (user && (user.hasPaid === true || user.isPremium === true)) return;
    if (user && user.isTrial === true) {
      var te = _toMillis(user.trialEnd);
      if (te > 0 && Date.now() <= te) return;
    }
  } else {
    if (user && user.isPremiumPlus === true) return;
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
          '<div class="paywall-plus-toggle">' +
            '<button class="paywall-plus-toggle-btn paywall-plus-toggle-monthly active" type="button" data-plan="monthly">Monthly · ₹49</button>' +
            '<button class="paywall-plus-toggle-btn paywall-plus-toggle-yearly" type="button" data-plan="yearly">Yearly · ₹499</button>' +
          '</div>' +
          '<div class="paywall-plan-price paywall-plus-price">₹49<span class="paywall-plan-period">/mo</span></div>' +
          '<ul class="paywall-plan-features">' +
            '<li>✓ Everything in Premium</li>' +
            '<li>✓ AI mistake explanations</li>' +
            '<li>✓ AI coach insights</li>' +
            '<li>✓ Study plan generator</li>' +
            '<li>✓ AI word problem trainer</li>' +
          '</ul>' +
          '<button class="btn accent paywall-plus-subscribe" type="button">Subscribe Monthly · ₹49</button>' +
          '<p class="paywall-plan-note">Cancel anytime · Billed via Razorpay</p>' +
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

  var _selectedPlan = 'monthly';
  var monthlyBtn = overlay.querySelector('.paywall-plus-toggle-monthly');
  var yearlyBtn = overlay.querySelector('.paywall-plus-toggle-yearly');
  var plusPriceEl = overlay.querySelector('.paywall-plus-price');
  var subscribeBtn = overlay.querySelector('.paywall-plus-subscribe');

  function _updatePlanUI(plan) {
    _selectedPlan = plan;
    if (monthlyBtn) monthlyBtn.classList.toggle('active', plan === 'monthly');
    if (yearlyBtn) yearlyBtn.classList.toggle('active', plan === 'yearly');
    if (plusPriceEl) {
      plusPriceEl.innerHTML = plan === 'yearly'
        ? '₹499<span class="paywall-plan-period">/yr</span>'
        : '₹49<span class="paywall-plan-period">/mo</span>';
    }
    if (subscribeBtn) {
      subscribeBtn.textContent = plan === 'yearly' ? 'Subscribe Yearly · ₹499' : 'Subscribe Monthly · ₹49';
    }
  }

  if (monthlyBtn) {
    monthlyBtn.addEventListener('click', function () { _updatePlanUI('monthly'); });
  }
  if (yearlyBtn) {
    yearlyBtn.addEventListener('click', function () { _updatePlanUI('yearly'); });
  }

  if (subscribeBtn) {
    subscribeBtn.addEventListener('click', function () {
      if (!userId) {
        var _now2 = Date.now();
        if (_now2 - _paywallPlusGuestPromptAt < 1000) return;
        _paywallPlusGuestPromptAt = _now2;
        showToast('Please login to continue payment.');
        return;
      }
      openPremiumPlusPayment(_selectedPlan, userId);
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

  _loadRazorpayScript(null);
}

function getDailyQuestionLimit() {
  var user = _getAccessUserState();
  if (user && (user.hasPaid || user.isPremium)) return Infinity;
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
global.openPremiumPlusPayment = openPremiumPlusPayment;
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
