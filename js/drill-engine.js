/**
 * drill-engine.js — Core drill / test engine (SPA compatible)
 *
 * Manages: question display, answer checking, per-question timer,
 *          scoring, streak tracking, and results summary.
 *
 * Modes:
 *   - Quick Drill:    5 questions, no timer
 *   - Reflex Drill:  10 questions, per-question timer (15s)
 *   - Timed Test:    10 questions, 180s overall limit
 *   - Focus Training: 10 questions from a specific category
 *   - Review Mistakes: review previously wrong questions
 *
 * Usage:
 *   var engine = createDrillEngine(container, { count, timeLimitSec, perQuestionSec, category, mode });
 *   engine.start();
 */

/**
 * Create a drill engine bound to the given container element.
 *
 * @param {HTMLElement} container  - wrapper element on the page
 * @param {object}      opts
 * @param {number}      opts.count           - number of questions (default 10)
 * @param {number|null} opts.timeLimitSec    - overall time limit in seconds (null = unlimited)
 * @param {number|null} opts.perQuestionSec  - per-question time limit in seconds (null = unlimited)
 * @param {string|null} opts.category        - question category filter (null = all)
 * @param {string[]|null} opts.topics        - optional custom mode topic list
 * @param {string}      opts.mode            - drill mode label for display
 * @param {boolean}     opts.reviewMode      - if true, use mistake review questions
 * @param {function}    opts.onFinish        - callback when drill finishes (for SPA navigation)
 * @returns {object} engine with .start() and .cleanup() methods
 */
function createDrillEngine(container, opts) {
  var count = opts.count || 10;
  var timeLimit = opts.timeLimitSec || null;
  var perQLimit = opts.perQuestionSec || null;
  var category = opts.category || null;
  var topics = Array.isArray(opts.topics) ? opts.topics : null;
  var mode = opts.mode || 'Drill';
  var reviewMode = opts.reviewMode || false;
  var onFinish = opts.onFinish || null;

  var questions = [];
  var current = 0;
  var score = 0;
  var bestSessionStreak = 0;
  var currentSessionStreak = 0;
  var perQuestionTimes = [];
  var qStart = 0;
  var overallStart = 0;
  var overallTimer = null;
  var perQTimer = null;
  var autoAdvanceTimer = null;
  var answered = false; /* prevents double-counting */
  var beginStarted = false; /* prevents duplicate START on rapid taps */
  var reviewOriginalCount = 0; /* track original count for review mode cap */
  var ui = {
    globalTimerEl: null,
    perQTimerEl: null,
    answerInputEl: null,
    submitBtnEl: null,
    feedbackEl: null,
    cardEl: null
  };

  /* ---- render helpers ---- */

  function renderStart() {
    var subtitle = count + ' questions';
    if (timeLimit) subtitle += ' · ' + timeLimit + 's time limit';
    if (perQLimit) subtitle += ' · ' + perQLimit + 's per question';
    if (category) subtitle += ' · ' + category;
    if (topics && topics.length) subtitle += ' · ' + topics.length + ' topics';

    container.innerHTML =
      '<div class="card center-content">' +
        '<h2>' + mode + '</h2>' +
        '<p>' + subtitle + '</p>' +
        '<button id="startBtn" class="btn accent">START</button>' +
        '<button id="startBackBtn" class="btn">← Back</button>' +
      '</div>';
    hideCustomNumpad();
    _exitDrillSession();
    container.querySelector('#startBtn').addEventListener('click', begin);
    container.querySelector('#startBackBtn').addEventListener('click', function () {
      cleanup();
      _exitDrillSession();
      if (typeof FirestoreSync !== 'undefined') {
        FirestoreSync.endDrillBatch();
      }
      if (onFinish) {
        onFinish('practice');
      } else {
        Router.showView('practice');
      }
    });
  }

  function renderQuestion() {
    answered = false;
    var q = questions[current];
    /* Use original count for progress display in review mode to avoid
       confusing jumps when wrong answers add questions to the queue.
       If current question exceeds original count (re-queued mistakes),
       show actual count instead. */
    var displayCount = reviewMode && reviewOriginalCount > 0
      ? (current >= reviewOriginalCount ? count : reviewOriginalCount)
      : count;
    var progressPct = displayCount > 0 ? Math.min(100, Math.round(((current) / displayCount) * 100)) : 0;
    container.innerHTML =
      '<button class="session-exit drill-exit-btn" id="drillExitBtn" aria-label="Exit session" title="Exit session">✕</button>' +
      '<div class="card center-content fade-in">' +
        '<p class="drill-progress">Question ' + (current + 1) + ' / ' + displayCount + '</p>' +
        '<div class="drill-progress-bar"><div class="drill-progress-fill" style="width:' + progressPct + '%"></div></div>' +
        (timeLimit ? '<p id="globalTimer" class="timer"></p>' : '') +
        (perQLimit ? '<p id="perQTimer" class="timer"></p>' : '') +
        '<h2 class="question-text">' + q.question + '</h2>' +
        '<input id="answerInput" class="input" type="text" inputmode="none" autocomplete="off" placeholder="Your answer" readonly />' +
        '<div id="feedback" class="feedback"></div>' +
        '<button id="submitBtn" class="btn accent">Submit</button>' +
      '</div>';
    ui.globalTimerEl = container.querySelector('#globalTimer');
    ui.perQTimerEl = container.querySelector('#perQTimer');
    ui.answerInputEl = container.querySelector('#answerInput');
    ui.submitBtnEl = container.querySelector('#submitBtn');
    ui.feedbackEl = container.querySelector('#feedback');
    ui.cardEl = container.querySelector('.card');

    /* Exit button handler — uses custom in-app dialog to prevent
       the TWA/WebView bug where native confirm() can end the session
       even when Cancel is pressed */
    container.querySelector('#drillExitBtn').addEventListener('click', function () {
      function performExit() {
        cleanup();
        _exitDrillSession();
        /* End Firestore batch that was started in begin() */
        if (typeof FirestoreSync !== 'undefined') {
          FirestoreSync.endDrillBatch();
        }
        if (onFinish) {
          onFinish('practice');
        } else {
          Router.showView('practice');
        }
      }

      if (typeof showExitSessionDialog === 'function') {
        showExitSessionDialog(performExit);
      } else if (confirm(_exitSessionMsg)) {
        performExit();
      }
    });

    var input = ui.answerInputEl;
    var submitBtn = ui.submitBtnEl;
    /* Auto-focus input with delay to ensure DOM is ready */
    setTimeout(function () { input.focus(); }, 50);

    function submit() {
      if (!answered) checkAnswer(input.value.trim());
    }
    submitBtn.addEventListener('click', submit);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        submit();
      }
    });

    /* Skip button — only when skip setting is enabled and difficulty is not hard */
    var _skipSettings = typeof loadSettings === 'function' ? loadSettings() : {};
    var _skipFeatureAccess = (typeof canAccessFeature === 'function') ? canAccessFeature('skip_question') : true;
    if (_skipFeatureAccess && _skipSettings.skipEnabled && _skipSettings.difficulty !== 'hard') {
      var skipBtn = document.createElement('button');
      skipBtn.className = 'btn skip-btn';
      skipBtn.textContent = 'Skip →';
      skipBtn.addEventListener('click', function () {
        if (answered) return;
        answered = true;
        if (perQTimer) { clearInterval(perQTimer); perQTimer = null; }
        /* Record skipped question as incorrect with 0 response time */
        recordAnswer(false, q.category, q, 0);
        nextQuestion();
      });
      var card = ui.cardEl;
      if (card) card.appendChild(skipBtn);
    }

    qStart = performance.now();

    /* Show custom numpad */
    showCustomNumpad(input, function() {
      if (!answered) checkAnswer(input.value.trim());
    });

    /* Per-question timer */
    if (perQLimit) {
      startPerQTimer();
    }
  }

  function checkAnswer(raw) {
    if (answered) return; /* prevent double-counting */
    answered = true;

    if (perQTimer) { clearInterval(perQTimer); perQTimer = null; }

    var elapsed = ((performance.now() - qStart) / 1000);
    var elapsedRounded = parseFloat(elapsed.toFixed(1));
    perQuestionTimes.push(elapsedRounded);

    var q = questions[current];
    var expected = String(q.answer);

    /* Normalize both values for comparison:
       - trim whitespace
       - handle numeric equivalence (e.g. "57.0" == "57", "3234.00" == "3234")
       - answer tolerance for decimal precision (33.33 matches 33.333, 33.3)
       Tolerance: allow rounding differences up to 0.5% of the expected value
       (min 0.05) to accept reasonable decimal approximations without being too lenient */
    var normalizedRaw = raw.replace(/\s/g, '');
    var normalizedExpected = expected.replace(/\s/g, '');
    var correct = false;

    if (normalizedRaw === normalizedExpected) {
      correct = true;
    } else if (normalizedRaw !== '' && !isNaN(normalizedRaw) && !isNaN(normalizedExpected)) {
      var rawNum = parseFloat(normalizedRaw);
      var expNum = parseFloat(normalizedExpected);
      if (rawNum === expNum) {
        correct = true;
      } else {
        /* Tolerance: allow rounding differences up to 0.05 for decimal answers */
        var tolerance = Math.abs(expNum) > 0 ? Math.max(0.05, Math.abs(expNum) * 0.005) : 0.05;
        if (Math.abs(rawNum - expNum) <= tolerance) {
          correct = true;
        }
      }
    }

    if (correct) {
      score++;
      currentSessionStreak++;
      if (currentSessionStreak > bestSessionStreak) bestSessionStreak = currentSessionStreak;
    } else {
      currentSessionStreak = 0;
      /* In review mode, re-queue incorrect questions at the end so users
         cycle through remaining mistakes before seeing the same one again.
         Only re-queue if this exact question isn't already waiting in the
         remaining queue, to prevent duplicates. Cap at 2x original count. */
      if (reviewMode && count < reviewOriginalCount * 2) {
        var isDuplicate = false;
        for (var ri = current + 1; ri < questions.length; ri++) {
          if (questions[ri].question === q.question && String(questions[ri].answer) === String(q.answer)) {
            isDuplicate = true;
            break;
          }
        }
        if (!isDuplicate) {
          questions.push({ question: q.question, answer: q.answer, category: q.category });
          count++;
        }
      }
    }

    /* Record answer with response time and question data for mistake tracking */
    recordAnswer(correct, q.category, q, elapsedRounded);

    /* Provide optional haptic/sound feedback */
    if (correct) {
      if (typeof triggerHaptic === 'function') triggerHaptic(50);
    } else {
      SoundEngine.play('wrongAnswer');
      if (typeof triggerHaptic === 'function') triggerHaptic([40, 30, 40]);
    }

    var feedback = ui.feedbackEl;
    feedback.textContent = correct ? '✓ Correct!' : '✗ Answer: ' + expected;
    feedback.className = 'feedback ' + (correct ? 'correct' : 'wrong');

    /* Add animation class — shake on wrong, pop on correct */
    feedback.classList.add('feedback-anim');
    if (!correct) {
      var card = ui.cardEl;
      if (card) card.classList.add('feedback-shake');
      setTimeout(function () { if (card) card.classList.remove('feedback-shake'); }, 400);
    }

    /* Replace submit with next */
    var submitBtn = ui.submitBtnEl;
    submitBtn.textContent = current + 1 < count ? 'Next →' : 'See Results';
    submitBtn.onclick = nextQuestion;

    /* Focus next button for keyboard navigation */
    submitBtn.focus();

    ui.answerInputEl.disabled = true;

    /* Auto-advance on correct answer after a short delay for feedback visibility */
    if (correct && current + 1 < count) {
      autoAdvanceTimer = setTimeout(function () {
        autoAdvanceTimer = null;
        if (answered) nextQuestion();
      }, 600);
    }
  }

  function nextQuestion() {
    /* Clear any pending auto-advance timer to prevent stale callbacks */
    if (autoAdvanceTimer) { clearTimeout(autoAdvanceTimer); autoAdvanceTimer = null; }
    current++;
    if (current < count) {
      renderQuestion();
    } else {
      finish();
    }
  }

  function finish() {
    cleanup();
    _exitDrillSession();
    SoundEngine.play('drillEnd');
    /* Haptic feedback on drill completion */
    if (typeof triggerHaptic === 'function') triggerHaptic([50, 50, 100]);

    /* Record session type */
    if (timeLimit) {
      recordTimedTestSession();
    } else {
      recordDrillSession();
    }

    /* End Firestore write batching — flush all queued updates */
    if (typeof FirestoreSync !== 'undefined') {
      FirestoreSync.endDrillBatch();
    }

    var totalTime = ((performance.now() - overallStart) / 1000).toFixed(1);
    var avg = perQuestionTimes.length
      ? (perQuestionTimes.reduce(function (a, b) { return a + b; }, 0) / perQuestionTimes.length).toFixed(1)
      : '0';
    var accuracy = ((score / count) * 100).toFixed(0);

    /* Performance badge */
    var badgeText, badgeClass;
    var accNum = parseFloat(accuracy);
    if (accNum >= 90) { badgeText = '🏆 Excellent'; badgeClass = 'badge-excellent'; }
    else if (accNum >= 75) { badgeText = '👍 Good'; badgeClass = 'badge-good'; }
    else if (accNum >= 50) { badgeText = '📝 Needs Practice'; badgeClass = 'badge-practice'; }
    else { badgeText = '💪 Keep Trying'; badgeClass = 'badge-weak'; }

    container.innerHTML =
      '<div class="card center-content fade-in">' +
        '<h2>Results</h2>' +
        '<div class="performance-badge ' + badgeClass + '">' + badgeText + '</div>' +
        '<div class="results-grid">' +
          '<div class="result-item"><span class="result-value">' + score + '/' + count + '</span><span class="result-label">Score</span></div>' +
          '<div class="result-item"><span class="result-value">' + accuracy + '%</span><span class="result-label">Accuracy</span></div>' +
          '<div class="result-item"><span class="result-value">' + avg + 's</span><span class="result-label">Avg Time</span></div>' +
          '<div class="result-item"><span class="result-value">' + bestSessionStreak + '</span><span class="result-label">Best Streak</span></div>' +
          '<div class="result-item"><span class="result-value">' + totalTime + 's</span><span class="result-label">Total Time</span></div>' +
        '</div>' +
        '<button class="btn accent" id="tryAgainBtn">Try Again</button>' +
        '<button class="btn" id="homeBtn">Home</button>' +
      '</div>';

    container.querySelector('#tryAgainBtn').addEventListener('click', function () {
      if (onFinish) {
        onFinish('practice');
      } else {
        Router.showView('practice');
      }
    });
    container.querySelector('#homeBtn').addEventListener('click', function () {
      if (onFinish) {
        onFinish('home');
      } else {
        Router.showView('home');
      }
    });
  }

  /* ---- global timer (for timed tests) ---- */

  function startGlobalTimer() {
    if (!timeLimit) return;
    var remaining = timeLimit;
    function tick() {
      var el = ui.globalTimerEl;
      if (el) el.textContent = '⏱ ' + remaining + 's';
      if (remaining <= 0) { clearInterval(overallTimer); overallTimer = null; finish(); return; }
      remaining--;
    }
    tick();
    overallTimer = setInterval(tick, 1000);
  }

  /* ---- per-question timer (for reflex drills) ---- */

  function startPerQTimer() {
    var remaining = perQLimit;
    function tick() {
      var el = ui.perQTimerEl;
      if (el) el.textContent = '⏱ ' + remaining + 's';
      if (remaining <= 0) {
        clearInterval(perQTimer);
        perQTimer = null;
        /* Auto-submit empty answer when time runs out */
        if (!answered) checkAnswer('');
        return;
      }
      remaining--;
    }
    tick();
    perQTimer = setInterval(tick, 1000);
  }

  /* ---- cleanup timers ---- */
  function cleanup() {
    if (overallTimer) { clearInterval(overallTimer); overallTimer = null; }
    if (perQTimer) { clearInterval(perQTimer); perQTimer = null; }
    if (autoAdvanceTimer) { clearTimeout(autoAdvanceTimer); autoAdvanceTimer = null; }
  }

  /* ---- begin drill ---- */

  function _generateCustomTopicQuestions(totalCount, topicKeys) {
    var validTopics = [];
    var topicSeen = {};
    for (var i = 0; i < topicKeys.length; i++) {
      var topicKey = topicKeys[i];
      if (categoryGenerators[topicKey] && !topicSeen[topicKey]) {
        validTopics.push(topicKey);
        topicSeen[topicKey] = true;
      }
    }

    if (!validTopics.length) {
      return generateQuestions(totalCount, null);
    }

    var eachCount = Math.floor(totalCount / validTopics.length);
    var remainder = totalCount % validTopics.length;
    var assembled = [];

    for (var v = 0; v < validTopics.length; v++) {
      var perTopic = eachCount + (v < remainder ? 1 : 0);
      if (perTopic <= 0) continue;
      var topicQuestions = generateQuestions(perTopic, validTopics[v]);
      for (var q = 0; q < topicQuestions.length; q++) {
        assembled.push(topicQuestions[q]);
      }
    }

    _shuffleInPlace(assembled);

    return assembled.slice(0, totalCount);
  }

  function _shuffleInPlace(arr) {
    for (var currentIndex = arr.length - 1; currentIndex > 0; currentIndex--) {
      var randomIndex = Math.floor(Math.random() * (currentIndex + 1));
      var tempQuestion = arr[currentIndex];
      arr[currentIndex] = arr[randomIndex];
      arr[randomIndex] = tempQuestion;
    }
  }

  function begin() {
    if (beginStarted) return;
    beginStarted = true;
    /* Mark session as active and hide nav for immersive experience */
    _enterDrillSession();

    /* Begin Firestore write batching during drill */
    if (typeof FirestoreSync !== 'undefined') {
      FirestoreSync.beginDrillBatch();
    }

    if (reviewMode) {
      questions = generateMistakeReviewQuestions(count);
      if (questions.length === 0) {
        _exitDrillSession();
        /* End drill batch since no drill will happen */
        if (typeof FirestoreSync !== 'undefined') {
          FirestoreSync.endDrillBatch();
        }
        container.innerHTML =
          '<div class="card center-content">' +
            '<h2>No Mistakes to Review</h2>' +
            '<p class="secondary-text">Great job! You have no wrong answers to review.</p>' +
            '<button class="btn accent" id="backToPractice">Back to Practice</button>' +
          '</div>';
        container.querySelector('#backToPractice').addEventListener('click', function () {
          Router.showView('practice');
        });
        return;
      }
      count = questions.length; /* May be less than requested */
      reviewOriginalCount = count;
    } else if (topics && topics.length) {
      questions = _generateCustomTopicQuestions(count, topics);
    } else {
      questions = generateQuestions(count, category); /* questions.js */
    }
    current = 0;
    score = 0;
    bestSessionStreak = 0;
    currentSessionStreak = 0;
    perQuestionTimes = [];
    overallStart = performance.now();
    startGlobalTimer();
    renderQuestion();
  }

  /* ---- public API ---- */
  return { start: renderStart, cleanup: cleanup };
}
