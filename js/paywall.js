/**
 * paywall.js — Premium access control + paywall + Razorpay flow
 */

function _getAccessUserState() {
  if (typeof FirestoreSync !== 'undefined' && typeof FirestoreSync.getAccessState === 'function') {
    var state = FirestoreSync.getAccessState();
    if (state) return state;
  }
  return { isPremium: true };
}

function canAccess(feature, user) {
  if (user && user.isPremium) return true;
  var lockedFeatures = {
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
  return !lockedFeatures[feature];
}

function canAccessFeature(feature) {
  return canAccess(feature, _getAccessUserState());
}

function canAccessCustomMode(user) {
  if (!canAccess('custom_training', user || _getAccessUserState())) return false;
  return true;
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
  var overlay = document.getElementById('paywallModalOverlay');
  if (!overlay) return;
  overlay.classList.add('closing');
  document.body.classList.remove('paywall-open');
  setTimeout(function () {
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
  }, 220);
}

function unlockPremium(userId, paymentId) {
  if (typeof Auth !== 'undefined' && typeof Auth.getUserId === 'function') {
    var currentUser = Auth.getUserId();
    if (currentUser && userId && currentUser !== userId) return;
  }
  if (typeof FirestoreSync !== 'undefined' && typeof FirestoreSync.unlockPremium === 'function') {
    FirestoreSync.unlockPremium(paymentId, function (err) {
      if (err) {
        showToast('Unable to unlock premium. Please try again.');
        return;
      }
      showToast('Premium unlocked successfully 🎉');
      _closePaywallModal();
      var currentView = Router.getCurrentView ? Router.getCurrentView() : 'home';
      if (currentView && Router.showView) Router.showView(currentView);
    });
  }
}

function verifyPaymentResponse(response) {
  return !!(response && response.razorpay_payment_id);
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
  _loadRazorpayScript(function (loadErr) {
    if (loadErr || typeof Razorpay === 'undefined') {
      showToast('Payment service is unavailable right now.');
      return;
    }
    var options = {
      key: 'rzp_live_STanzIgCpSAfL7',
      amount: 6900,
      currency: 'INR',
      name: 'QuantReflex',
      description: 'Lifetime Premium Access',
      modal: {
        ondismiss: function () {
          showToast('Payment cancelled. You can upgrade anytime.');
        }
      },
      handler: function (response) {
        if (!verifyPaymentResponse(response)) {
          showToast('Payment verification failed. Please retry.');
          return;
        }
        unlockPremium(userId, response.razorpay_payment_id);
      }
    };
    try {
      var rzp = new Razorpay(options);
      rzp.on('payment.failed', function () {
        showToast('Payment failed. Please try again.');
      });
      rzp.open();
    } catch (_) {
      showToast('Could not open payment. Check your network and retry.');
    }
  });
}

function showPaywall(featureType) {
  var existing = document.getElementById('paywallModalOverlay');
  if (existing) return;
  var copy = _getPaywallCopy(featureType);
  var userId = (typeof Auth !== 'undefined' && typeof Auth.getUserId === 'function') ? Auth.getUserId() : '';
  var overlay = document.createElement('div');
  overlay.id = 'paywallModalOverlay';
  overlay.className = 'paywall-overlay';
  overlay.innerHTML =
    '<div class="paywall-card">' +
      '<button class="paywall-close" type="button" aria-label="Close">×</button>' +
      '<p class="paywall-badge">Premium</p>' +
      '<h2>' + copy.title + '</h2>' +
      '<p class="paywall-subtitle">' + copy.subtitle + '</p>' +
      '<ul class="paywall-benefits">' +
        '<li>' + copy.bullets[0] + '</li>' +
        '<li>' + copy.bullets[1] + '</li>' +
        '<li>' + copy.bullets[2] + '</li>' +
      '</ul>' +
      '<button class="btn accent paywall-upgrade" type="button">Unlock Lifetime Premium · ₹69</button>' +
      '<p class="paywall-footnote">One-time payment. Future premium features included.</p>' +
    '</div>';
  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) _closePaywallModal();
  });
  document.body.appendChild(overlay);
  document.body.classList.add('paywall-open');

  var closeBtn = overlay.querySelector('.paywall-close');
  if (closeBtn) closeBtn.addEventListener('click', _closePaywallModal);
  var upgradeBtn = overlay.querySelector('.paywall-upgrade');
  if (upgradeBtn) {
    upgradeBtn.addEventListener('click', function () {
      if (!userId) {
        showToast('Please login to continue payment.');
        return;
      }
      openPayment(userId);
    });
  }
}
