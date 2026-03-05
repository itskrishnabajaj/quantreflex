/**
 * onboarding.js — Premium onboarding experience
 *
 * Manages a six-screen onboarding flow:
 *   1. Introduction
 *   2. Learn & Drill
 *   3. Stats
 *   4. Daily Goal Selection
 *   5. Ready to Train
 *   6. First Question (up to 3 attempts with guided retry)
 *
 * Display logic:
 *   - Shows only when `onboardingCompleted` is false in settings.
 *   - Stores `dailyGoal` in quant_reflex_settings.
 *   - Sets `onboardingCompleted = true` on completion.
 *
 * Skip behavior:
 *   - Skip jumps to Screen 4 (Daily Goal).
 *   - After selecting a goal, skips remaining screens and goes to Home.
 *
 * Analytics:
 *   - Records each onboarding question attempt via recordAnswer().
 */

var Onboarding = (function () {
  var SETTINGS_KEY = 'quant_reflex_settings';
  var _overlay = null;
  var _currentScreen = 0;
  var _skipped = false;
  var _selectedGoal = 50;
  var _onComplete = null;
  var _questionAttempt = 0;       /* 0-based: tracks which attempt (0, 1, 2) */
  var _currentQuestion = null;    /* current question object {text, answer} */

  /* Simple easy questions for the first question screen — very easy only */
  var EASY_QUESTIONS = [
    { text: '12 × 5 = ?', answer: 60 },
    { text: '8 × 7 = ?', answer: 56 },
    { text: '15 × 4 = ?', answer: 60 },
    { text: '9 × 6 = ?', answer: 54 },
    { text: '11 × 3 = ?', answer: 33 },
    { text: '25 × 2 = ?', answer: 50 },
    { text: '7 + 8 = ?', answer: 15 },
    { text: '14 + 9 = ?', answer: 23 },
    { text: '6 × 4 = ?', answer: 24 },
    { text: '5 × 9 = ?', answer: 45 },
    { text: '10 + 15 = ?', answer: 25 },
    { text: '3 × 8 = ?', answer: 24 },
    { text: '20 + 13 = ?', answer: 33 },
    { text: '7 × 5 = ?', answer: 35 },
    { text: '50% of 40 = ?', answer: 20 },
    { text: '10% of 90 = ?', answer: 9 }
  ];

  /**
   * Pick a random easy question, avoiding the current one.
   */
  function _pickNewQuestion() {
    var pool = EASY_QUESTIONS;
    if (_currentQuestion && pool.length > 1) {
      pool = pool.filter(function (q) { return q.text !== _currentQuestion.text; });
    }
    _currentQuestion = pool[Math.floor(Math.random() * pool.length)];
    return _currentQuestion;
  }

  /**
   * Check if onboarding should be shown.
   * @returns {boolean}
   */
  function shouldShow() {
    try {
      var settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      return !settings.onboardingCompleted;
    } catch (_) {
      return true;
    }
  }

  /**
   * Mark onboarding as completed and save the daily goal.
   */
  function _markCompleted() {
    try {
      var settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      settings.onboardingCompleted = true;
      settings.dailyGoal = _selectedGoal;
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      if (typeof FirestoreSync !== 'undefined') {
        FirestoreSync.syncSettings(settings);
      }
    } catch (_) { /* ignore */ }
  }

  /**
   * Save only the daily goal without completing onboarding.
   */
  function _saveDailyGoal() {
    try {
      var settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      settings.dailyGoal = _selectedGoal;
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (_) { /* ignore */ }
  }

  /**
   * Build and show the onboarding overlay.
   * @param {function} onComplete - Called when onboarding finishes
   */
  function show(onComplete) {
    _onComplete = onComplete;
    _currentScreen = 0;
    _skipped = false;
    _selectedGoal = 50;
    _questionAttempt = 0;
    _currentQuestion = null;

    _overlay = document.getElementById('onboardingOverlay');
    if (!_overlay) return;

    _overlay.style.display = 'flex';
    _renderScreen(0);
  }

  /**
   * Navigate to a specific screen index.
   */
  function _goToScreen(index) {
    _currentScreen = index;
    _renderScreen(index);
  }

  /**
   * Show/hide the bottom nav for Screen 3 guidance.
   * When visible, only the Stats tab is shown and highlighted.
   */
  function _showStatsNavGuide() {
    var bottomNav = document.querySelector('.bottom-nav');
    if (!bottomNav) return;
    var links = bottomNav.querySelectorAll('a');
    for (var i = 0; i < links.length; i++) {
      var view = links[i].getAttribute('data-view');
      if (view === 'stats') {
        links[i].style.display = '';
        links[i].classList.add('active');
      } else {
        links[i].style.display = 'none';
      }
    }
    bottomNav.style.display = 'flex';
    bottomNav.style.zIndex = '10001';
  }

  /**
   * Restore the bottom nav to its normal state after Screen 3.
   */
  function _hideStatsNavGuide() {
    var bottomNav = document.querySelector('.bottom-nav');
    if (!bottomNav) return;
    var links = bottomNav.querySelectorAll('a');
    for (var i = 0; i < links.length; i++) {
      links[i].style.display = '';
      links[i].classList.remove('active');
    }
    bottomNav.style.zIndex = '';
    /* Hide nav during onboarding (it's normally hidden) */
    bottomNav.style.display = '';
  }

  /**
   * Render the current screen inside the overlay.
   */
  function _renderScreen(index) {
    var card = _overlay.querySelector('.onboarding-card');
    if (!card) return;

    /* Clean up Screen 3 stats guide if leaving it */
    if (_currentScreen !== 2 || index !== 2) {
      _hideStatsNavGuide();
    }

    /* Slide-out animation */
    card.classList.remove('onboarding-card-enter');
    card.classList.add('onboarding-card-exit');

    setTimeout(function () {
      var content = '';
      var totalScreens = _skipped ? 4 : 6;
      var dotIndex = index;

      switch (index) {
        case 0:
          content = _screen1();
          dotIndex = 0;
          break;
        case 1:
          content = _screen2();
          dotIndex = 1;
          break;
        case 2:
          content = _screen3();
          dotIndex = 2;
          break;
        case 3:
          content = _screen4();
          dotIndex = 3;
          break;
        case 4:
          content = _screen5();
          dotIndex = 4;
          break;
        case 5:
          content = _screen6();
          dotIndex = 5;
          break;
      }

      /* Update progress dots */
      var dotsHtml = '<div class="onboarding-dots">';
      for (var i = 0; i < totalScreens; i++) {
        var activeClass = i === dotIndex ? ' onboarding-dot-active' : '';
        var completedClass = i < dotIndex ? ' onboarding-dot-completed' : '';
        dotsHtml += '<span class="onboarding-dot' + activeClass + completedClass + '"></span>';
      }
      dotsHtml += '</div>';

      card.innerHTML = content + dotsHtml;
      card.classList.remove('onboarding-card-exit');
      card.classList.add('onboarding-card-enter');

      /* Bind event handlers for this screen */
      _bindScreenHandlers(index);

      /* Show Stats nav guide on Screen 3 */
      if (index === 2) {
        _showStatsNavGuide();
      }
    }, 180);
  }

  /* ---- Screen Content Generators ---- */

  function _screen1() {
    return '<div class="onboarding-visual">' +
      '<div class="onboarding-icon-anim">' +
      '<span class="onboarding-icon-main">🧠</span>' +
      '<span class="onboarding-icon-sparkle onboarding-sparkle-1">⚡</span>' +
      '<span class="onboarding-icon-sparkle onboarding-sparkle-2">✨</span>' +
      '</div></div>' +
      '<h2 class="onboarding-title">Train Your Quant Reflex</h2>' +
      '<p class="onboarding-desc">Improve mental math speed for CAT, MBA CET, and other aptitude exams using fast drills and smart practice tools.</p>' +
      '<div class="onboarding-actions">' +
      '<button class="btn accent onboarding-next-btn" id="obNext">Next</button>' +
      '<button class="btn onboarding-skip-btn" id="obSkip">Skip</button>' +
      '</div>';
  }

  function _screen2() {
    return '<div class="onboarding-visual">' +
      '<div class="onboarding-split-preview">' +
      '<div class="onboarding-preview-card"><span class="onboarding-preview-icon">📖</span><span class="onboarding-preview-label">Learn</span></div>' +
      '<div class="onboarding-preview-card"><span class="onboarding-preview-icon">🎯</span><span class="onboarding-preview-label">Drill</span></div>' +
      '</div></div>' +
      '<h2 class="onboarding-title">Learn Fast. Practice Faster.</h2>' +
      '<p class="onboarding-desc">Use the Learn tab to revise multiplication tables, formulas, and shortcuts. Then jump into drills to train your calculation speed.</p>' +
      '<p class="onboarding-hint">💡 Triple tap any table to open a larger full-screen view.</p>' +
      '<div class="onboarding-actions">' +
      '<button class="btn accent onboarding-next-btn" id="obNext">Next</button>' +
      '<button class="btn onboarding-skip-btn" id="obSkip">Skip</button>' +
      '</div>';
  }

  function _screen3() {
    return '<div class="onboarding-visual">' +
      '<div class="onboarding-stats-preview">' +
      '<div class="onboarding-stat-item"><span class="onboarding-stat-val">92%</span><span class="onboarding-stat-label">Accuracy</span></div>' +
      '<div class="onboarding-stat-item"><span class="onboarding-stat-val">1.8s</span><span class="onboarding-stat-label">Avg Time</span></div>' +
      '<div class="onboarding-stat-item"><span class="onboarding-stat-val">5</span><span class="onboarding-stat-label">Streak</span></div>' +
      '</div></div>' +
      '<h2 class="onboarding-title">Track Your Progress</h2>' +
      '<p class="onboarding-desc">See your accuracy, response time, and weakest categories so you know exactly where to improve.</p>' +
      '<p class="onboarding-hint">The system helps identify weak topics automatically.</p>' +
      '<div class="onboarding-actions">' +
      '<button class="btn accent onboarding-next-btn" id="obNext">Next</button>' +
      '<button class="btn onboarding-skip-btn" id="obSkip">Skip</button>' +
      '</div>';
  }

  function _screen4() {
    return '<div class="onboarding-visual">' +
      '<span class="onboarding-goal-icon">🎯</span>' +
      '</div>' +
      '<h2 class="onboarding-title">How many questions per day?</h2>' +
      '<div class="onboarding-goal-options">' +
      '<button class="onboarding-goal-btn' + (_selectedGoal === 20 ? ' onboarding-goal-active' : '') + '" data-goal="20">20 questions</button>' +
      '<button class="onboarding-goal-btn' + (_selectedGoal === 50 ? ' onboarding-goal-active' : '') + '" data-goal="50">50 questions</button>' +
      '<button class="onboarding-goal-btn' + (_selectedGoal === 100 ? ' onboarding-goal-active' : '') + '" data-goal="100">100 questions</button>' +
      '</div>' +
      '<p class="onboarding-note">You can change this anytime from the Settings tab.</p>' +
      '<div class="onboarding-actions">' +
      '<button class="btn accent onboarding-next-btn" id="obNext">Continue</button>' +
      '</div>';
  }

  function _screen5() {
    return '<div class="onboarding-visual">' +
      '<div class="onboarding-icon-anim">' +
      '<span class="onboarding-icon-main">🚀</span>' +
      '<span class="onboarding-icon-sparkle onboarding-sparkle-1">💪</span>' +
      '<span class="onboarding-icon-sparkle onboarding-sparkle-2">🔥</span>' +
      '</div></div>' +
      '<h2 class="onboarding-title">Ready to Train Your Brain?</h2>' +
      '<p class="onboarding-desc">Your daily goal is set. Let\'s start your first question.</p>' +
      '<div class="onboarding-actions">' +
      '<button class="btn accent onboarding-next-btn" id="obNext">Start Training</button>' +
      '</div>';
  }

  function _screen6() {
    var q = _pickNewQuestion();
    var attemptLabel = _questionAttempt === 0 ? 'Your first question' :
                       _questionAttempt === 1 ? 'Try this one' :
                       'One more try';
    return '<div class="onboarding-question-screen" data-answer="' + q.answer + '">' +
      '<p class="onboarding-q-label">' + attemptLabel + '</p>' +
      '<h2 class="onboarding-q-text">' + q.text + '</h2>' +
      '<input type="text" class="input onboarding-q-input" id="obAnswer" readonly placeholder="Tap numpad to answer" autocomplete="off" />' +
      '<div class="onboarding-q-feedback" id="obFeedback"></div>' +
      '</div>';
  }

  /* ---- Event Binding ---- */

  function _bindScreenHandlers(index) {
    var nextBtn = document.getElementById('obNext');
    var skipBtn = document.getElementById('obSkip');

    if (nextBtn) {
      nextBtn.addEventListener('click', function () {
        if (typeof triggerHaptic === 'function') triggerHaptic(10);
        if (typeof SoundEngine !== 'undefined') SoundEngine.play('settingsToggle');

        if (index === 3) {
          /* Save daily goal */
          _saveDailyGoal();

          if (_skipped) {
            /* Skip mode: after goal selection, go straight to home */
            _finish();
            return;
          }
        }

        if (index < 5) {
          _goToScreen(index + 1);
        }
      });
    }

    if (skipBtn) {
      skipBtn.addEventListener('click', function () {
        if (typeof triggerHaptic === 'function') triggerHaptic(10);
        _skipped = true;
        /* Jump to screen 4 (Daily Goal Selection) */
        _goToScreen(3);
      });
    }

    /* Goal selection buttons */
    var goalBtns = _overlay.querySelectorAll('.onboarding-goal-btn');
    for (var i = 0; i < goalBtns.length; i++) {
      goalBtns[i].addEventListener('click', function () {
        if (typeof triggerHaptic === 'function') triggerHaptic(8);
        /* Deselect all */
        for (var j = 0; j < goalBtns.length; j++) {
          goalBtns[j].classList.remove('onboarding-goal-active');
        }
        this.classList.add('onboarding-goal-active');
        _selectedGoal = parseInt(this.getAttribute('data-goal'), 10);
      });
    }

    /* Screen 6: show numpad for the first question */
    if (index === 5) {
      var answerInput = document.getElementById('obAnswer');
      if (answerInput) {
        _showOnboardingNumpad(answerInput);
      }
    }
  }

  /**
   * Show the custom numpad for the onboarding first question.
   */
  function _showOnboardingNumpad(inputEl) {
    if (typeof showCustomNumpad !== 'function') return;
    /* Raise numpad above onboarding overlay */
    var numpad = document.getElementById('customNumpad');
    if (numpad) numpad.style.zIndex = '10001';
    if (numpad) numpad.style.bottom = 'env(safe-area-inset-bottom, 0px)';
    /* Allow clicks to pass through overlay to the numpad */
    if (_overlay) _overlay.style.pointerEvents = 'none';
    var card = _overlay ? _overlay.querySelector('.onboarding-card') : null;
    if (card) card.style.pointerEvents = 'auto';
    showCustomNumpad(inputEl, function () {
      _checkOnboardingAnswer();
    });
  }

  /**
   * Check the answer to the onboarding question.
   * Supports up to 3 attempts with guided retry.
   */
  function _checkOnboardingAnswer() {
    var inputEl = document.getElementById('obAnswer');
    var feedback = document.getElementById('obFeedback');
    var qScreen = _overlay.querySelector('.onboarding-question-screen');
    if (!inputEl || !feedback || !qScreen) return;

    var correctAnswer = parseInt(qScreen.getAttribute('data-answer'), 10);
    var userAnswer = inputEl.value.trim();

    if (userAnswer === '') return;

    var isCorrect = parseInt(userAnswer, 10) === correctAnswer;

    /* Record in analytics via progress.js */
    if (typeof recordAnswer === 'function') {
      var questionText = qScreen.querySelector('.onboarding-q-text');
      var qData = {
        question: questionText ? questionText.textContent : '',
        answer: correctAnswer,
        category: 'onboarding'
      };
      recordAnswer(isCorrect, 'onboarding', isCorrect ? null : qData);
    }

    if (isCorrect) {
      /* Correct! */
      inputEl.disabled = true;
      if (typeof triggerHaptic === 'function') triggerHaptic(50);
      if (typeof SoundEngine !== 'undefined') SoundEngine.play('drillEnd');
      feedback.innerHTML = '<span class="onboarding-success">🎉 Great job! You\'re ready to start training.</span>';
      feedback.style.display = 'block';

      /* Auto-complete after a short delay */
      setTimeout(function () {
        _finish();
      }, 1200);
    } else {
      /* Wrong answer — guided retry system */
      _questionAttempt++;

      if (_questionAttempt < 3) {
        /* Attempts 1 or 2: show supportive message, then present new question */
        if (typeof triggerHaptic === 'function') triggerHaptic([40, 30, 40]);
        var msg = _questionAttempt === 1
          ? 'Almost there. Try the next one.'
          : 'You\'re close. Give it one more try.';
        feedback.innerHTML = '<span class="onboarding-retry-msg">' + msg + '</span>';
        feedback.style.display = 'block';

        /* After a brief delay, show the next question */
        setTimeout(function () {
          _renderQuestionRetry();
        }, 1200);
      } else {
        /* 3rd wrong answer: reassuring message, redirect to Practice */
        inputEl.disabled = true;
        if (typeof triggerHaptic === 'function') triggerHaptic([40, 30, 40]);
        feedback.innerHTML = '<span class="onboarding-retry-msg">No worries. Everyone starts somewhere. Let\'s practice together.</span>';
        feedback.style.display = 'block';

        setTimeout(function () {
          _finishToPractice();
        }, 1800);
      }
    }
  }

  /**
   * Re-render screen 6 with a new question for retry attempts.
   * Keeps the numpad open.
   */
  function _renderQuestionRetry() {
    var card = _overlay.querySelector('.onboarding-card');
    if (!card) return;

    /* Build new question content */
    var q = _pickNewQuestion();
    var attemptLabel = _questionAttempt === 1 ? 'Try this one' : 'One more try';

    var content = '<div class="onboarding-question-screen" data-answer="' + q.answer + '">' +
      '<p class="onboarding-q-label">' + attemptLabel + '</p>' +
      '<h2 class="onboarding-q-text">' + q.text + '</h2>' +
      '<input type="text" class="input onboarding-q-input" id="obAnswer" readonly placeholder="Tap numpad to answer" autocomplete="off" />' +
      '<div class="onboarding-q-feedback" id="obFeedback"></div>' +
      '</div>';

    /* Keep progress dots */
    var dotsHtml = '<div class="onboarding-dots">';
    var totalScreens = 6;
    for (var i = 0; i < totalScreens; i++) {
      var activeClass = i === 5 ? ' onboarding-dot-active' : '';
      var completedClass = i < 5 ? ' onboarding-dot-completed' : '';
      dotsHtml += '<span class="onboarding-dot' + activeClass + completedClass + '"></span>';
    }
    dotsHtml += '</div>';

    /* Slide animation for new question */
    card.classList.remove('onboarding-card-enter');
    card.classList.add('onboarding-card-exit');

    setTimeout(function () {
      card.innerHTML = content + dotsHtml;
      card.classList.remove('onboarding-card-exit');
      card.classList.add('onboarding-card-enter');

      /* Re-bind numpad to new input */
      var newInput = document.getElementById('obAnswer');
      if (newInput) {
        _showOnboardingNumpad(newInput);
      }
    }, 180);
  }

  /**
   * Complete onboarding and clean up.
   * Navigates to Home tab.
   */
  function _finish() {
    _markCompleted();
    _cleanupNumpad();

    /* Fade out the overlay */
    if (_overlay) {
      _overlay.classList.add('onboarding-exit');
      setTimeout(function () {
        _overlay.style.display = 'none';
        _overlay.classList.remove('onboarding-exit');
      }, 300);
    }

    if (_onComplete) _onComplete();
  }

  /**
   * Complete onboarding and redirect to Practice tab.
   * Used when user fails all 3 attempts.
   */
  function _finishToPractice() {
    _markCompleted();
    _cleanupNumpad();

    /* Fade out the overlay */
    if (_overlay) {
      _overlay.classList.add('onboarding-exit');
      setTimeout(function () {
        _overlay.style.display = 'none';
        _overlay.classList.remove('onboarding-exit');
      }, 300);
    }

    /* Navigate to Practice tab instead of Home */
    if (typeof Router !== 'undefined') {
      Router.showView('practice');
    } else if (_onComplete) {
      _onComplete();
    }
  }

  /**
   * Clean up numpad overrides and hide it.
   */
  function _cleanupNumpad() {
    var numpad = document.getElementById('customNumpad');
    if (numpad) { numpad.style.zIndex = ''; numpad.style.bottom = ''; }
    if (_overlay) _overlay.style.pointerEvents = '';
    var card = _overlay ? _overlay.querySelector('.onboarding-card') : null;
    if (card) card.style.pointerEvents = '';
    document.body.classList.remove('onboarding-numpad-active');
    hideCustomNumpad();
  }

  return {
    shouldShow: shouldShow,
    show: show
  };
})();
