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
  var answered = false; /* prevents double-counting */

  /* ---- render helpers ---- */

  function renderStart() {
    var subtitle = count + ' questions';
    if (timeLimit) subtitle += ' · ' + timeLimit + 's time limit';
    if (perQLimit) subtitle += ' · ' + perQLimit + 's per question';
    if (category) subtitle += ' · ' + category;

    container.innerHTML =
      '<div class="card center-content">' +
        '<h2>' + mode + '</h2>' +
        '<p>' + subtitle + '</p>' +
        '<button id="startBtn" class="btn accent">START</button>' +
      '</div>';
    container.querySelector('#startBtn').addEventListener('click', begin);
  }

  function renderQuestion() {
    answered = false;
    var q = questions[current];
    container.innerHTML =
      '<div class="card center-content fade-in">' +
        '<p class="drill-progress">Question ' + (current + 1) + ' / ' + count + '</p>' +
        (timeLimit ? '<p id="globalTimer" class="timer"></p>' : '') +
        (perQLimit ? '<p id="perQTimer" class="timer"></p>' : '') +
        '<h2 class="question-text">' + q.question + '</h2>' +
        '<input id="answerInput" class="input" type="text" inputmode="decimal" autocomplete="off" placeholder="Your answer" />' +
        '<div id="feedback" class="feedback"></div>' +
        '<button id="submitBtn" class="btn accent">Submit</button>' +
      '</div>';

    var input = container.querySelector('#answerInput');
    var submitBtn = container.querySelector('#submitBtn');
    input.focus();

    function submit() {
      if (!answered) checkAnswer(input.value.trim());
    }
    submitBtn.addEventListener('click', submit);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });

    qStart = performance.now();

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
    var correct = raw === expected;

    if (correct) {
      score++;
      currentSessionStreak++;
      if (currentSessionStreak > bestSessionStreak) bestSessionStreak = currentSessionStreak;
    } else {
      currentSessionStreak = 0;
    }

    /* Record answer with response time and question data for mistake tracking */
    recordAnswer(correct, q.category, q, elapsedRounded);

    /* Provide optional haptic/sound feedback */
    if (correct && typeof navigator.vibrate === 'function') {
      try {
        var settings = JSON.parse(localStorage.getItem('quant_reflex_settings') || '{}');
        if (settings.vibration !== false) navigator.vibrate(50);
      } catch (_) { /* ignore */ }
    }

    var feedback = container.querySelector('#feedback');
    feedback.textContent = correct ? '✓ Correct!' : '✗ Answer: ' + expected;
    feedback.className = 'feedback ' + (correct ? 'correct' : 'wrong');

    /* Add animation class */
    feedback.classList.add('feedback-anim');

    /* Replace submit with next */
    var submitBtn = container.querySelector('#submitBtn');
    submitBtn.textContent = current + 1 < count ? 'Next →' : 'See Results';
    submitBtn.onclick = nextQuestion;

    /* Focus next button for keyboard navigation */
    submitBtn.focus();

    container.querySelector('#answerInput').disabled = true;
  }

  function nextQuestion() {
    current++;
    if (current < count) {
      renderQuestion();
    } else {
      finish();
    }
  }

  function finish() {
    cleanup();

    /* Record session type */
    if (timeLimit) {
      recordTimedTestSession();
    } else {
      recordDrillSession();
    }

    var totalTime = ((performance.now() - overallStart) / 1000).toFixed(1);
    var avg = perQuestionTimes.length
      ? (perQuestionTimes.reduce(function (a, b) { return a + b; }, 0) / perQuestionTimes.length).toFixed(1)
      : '0';
    var accuracy = ((score / count) * 100).toFixed(0);

    container.innerHTML =
      '<div class="card center-content fade-in">' +
        '<h2>Results</h2>' +
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
      var el = container.querySelector('#globalTimer');
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
      var el = container.querySelector('#perQTimer');
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
  }

  /* ---- begin drill ---- */

  function begin() {
    if (reviewMode) {
      questions = generateMistakeReviewQuestions(count);
      if (questions.length === 0) {
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
