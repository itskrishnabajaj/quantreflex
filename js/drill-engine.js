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
  var preloadedQuestions = opts._preloadedQuestions || null;
  var adaptiveMode = opts.adaptive === true;

  /* ---- Adaptive controller state ---- */
  var _adaptiveHistory = [];   /* [{correct, timeSec}] last N answers */
  var _adaptiveDifficulty = 'medium';
  var _ADAPTIVE_WINDOW = 4;    /* rolling 4-answer window for fast in-session adaptation */

  function _computeAdaptiveDifficulty() {
    if (_adaptiveHistory.length < 2) return _adaptiveDifficulty;
    var window = _adaptiveHistory.slice(-_ADAPTIVE_WINDOW);
    var correct = 0;
    var totalTime = 0;
    for (var i = 0; i < window.length; i++) {
      if (window[i].correct) correct++;
      totalTime += window[i].timeSec;
    }
    var acc = correct / window.length;
    var avgTime = totalTime / window.length;
    if (acc > 0.8 && avgTime < 12) return 'hard';
    if (acc >= 0.5) return 'medium';
    return 'easy';
  }

  function _setAdaptiveOverride(diff) {
    _adaptiveDifficulty = diff;
    window._adaptiveOverrideDifficulty = diff;
  }

  function _clearAdaptiveOverride() {
    window._adaptiveOverrideDifficulty = null;
  }

  var questions = [];
  var current = 0;
  var score = 0;
  var bestSessionStreak = 0;
  var currentSessionStreak = 0;
  var perQuestionTimes = [];
  var sessionWrongCategories = {}; /* category → wrong count for insight engine */
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

  function _escHtml(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

  function _adaptiveDiffLabel(diff) {
    if (diff === 'hard') return '<span class="adaptive-mode-pill adaptive-pill-hard">Hard ▲</span>';
    if (diff === 'easy') return '<span class="adaptive-mode-pill adaptive-pill-easy">Easy ▼</span>';
    return '<span class="adaptive-mode-pill adaptive-pill-medium">Medium ●</span>';
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
    var adaptivePill = adaptiveMode ? _adaptiveDiffLabel(_adaptiveDifficulty) : '';
    container.innerHTML =
      '<button class="session-exit drill-exit-btn" id="drillExitBtn" aria-label="Exit session" title="Exit session">✕</button>' +
      '<div class="card center-content fade-in">' +
        '<div class="drill-question-scroll">' +
          '<p class="drill-progress">Question ' + (current + 1) + ' / ' + displayCount + (adaptivePill ? ' ' + adaptivePill : '') + '</p>' +
          '<div class="drill-progress-bar"><div class="drill-progress-fill" style="width:' + progressPct + '%"></div></div>' +
          (timeLimit ? '<p id="globalTimer" class="timer"></p>' : '') +
          (perQLimit ? '<p id="perQTimer" class="timer"></p>' : '') +
          '<h2 class="question-text">' + _escHtml(q.question) + '</h2>' +
          '<input id="answerInput" class="input" type="text" inputmode="none" autocomplete="off" placeholder="Your answer" readonly />' +
          '<div id="feedback" class="feedback"></div>' +
        '</div>' +
      '</div>' +
      '<div class="drill-actions">' +
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
        recordAnswer(false, q.category, q, 0);
        nextQuestion();
      });
      var actionsDiv = container.querySelector('.drill-actions');
      if (actionsDiv) {
        actionsDiv.classList.add('has-skip');
        actionsDiv.insertBefore(skipBtn, submitBtn);
      }
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

    /* Track for adaptive controller */
    if (adaptiveMode) {
      _adaptiveHistory.push({ correct: correct, timeSec: elapsedRounded });
    }

    if (correct) {
      score++;
      currentSessionStreak++;
      if (currentSessionStreak > bestSessionStreak) bestSessionStreak = currentSessionStreak;
    } else {
      currentSessionStreak = 0;
      /* Track wrong-answer categories for post-session insight */
      var _wCat = q.category || 'unknown';
      sessionWrongCategories[_wCat] = (sessionWrongCategories[_wCat] || 0) + 1;
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

    if (correct) {
      feedback.textContent = '✓ Correct!';
      feedback.className = 'feedback correct feedback-anim';
    } else {
      feedback.className = 'feedback wrong wrong-answer-card feedback-anim';
      feedback.innerHTML = '';
      var wrongLabel = document.createElement('div');
      wrongLabel.className = 'wrong-answer-header';
      wrongLabel.textContent = '❌ Wrong Answer';
      var correctLabel = document.createElement('div');
      correctLabel.className = 'wrong-answer-correct';
      correctLabel.textContent = 'Correct Answer: ' + expected;
      feedback.appendChild(wrongLabel);
      feedback.appendChild(correctLabel);

      /* Auto-explain: show a rule-based tip immediately, no button press needed.
         Premium users always see the tip. Free users get 5 lifetime credits. */
      var autoTipEl = document.createElement('div');
      var _isPremium = (typeof canAccessFeature === 'function') ? canAccessFeature('adaptive_training') : false;
      if (_isPremium) {
        autoTipEl.className = 'auto-explain-tip';
        autoTipEl.textContent = _getAutoTip(q.category, q.subtype);
      } else {
        var _credits = _getExplainCredits();
        if (_credits > 0) {
          _decrementExplainCredits();
          autoTipEl.className = 'auto-explain-tip';
          autoTipEl.textContent = _getAutoTip(q.category, q.subtype);
        } else {
          autoTipEl.className = 'auto-explain-tip auto-explain-locked';
          autoTipEl.innerHTML = '🔒 <a class="auto-explain-unlock" href="#">Unlock unlimited explanations</a>';
          var _lockLink = autoTipEl.querySelector('.auto-explain-unlock');
          if (_lockLink) {
            _lockLink.addEventListener('click', function (e) {
              e.preventDefault();
              if (typeof showPaywall === 'function') showPaywall('settings');
            });
          }
        }
      }
      feedback.appendChild(autoTipEl);

      var card = ui.cardEl;
      if (card) card.classList.add('feedback-shake');
      setTimeout(function () { if (card) card.classList.remove('feedback-shake'); }, 400);
    }

    if (typeof AIFeatures !== 'undefined' && (!correct || reviewMode)) {
      var explainBtn = document.createElement('button');
      explainBtn.className = 'drill-explain-btn';
      var _canExplain = (typeof canAccessFeature === 'function') ? canAccessFeature('ai_explain') : true;
      explainBtn.textContent = _canExplain ? '🧠 Explain' : '🧠 Explain 🔒';
      explainBtn.addEventListener('click', function () {
        if (typeof canAccessFeature === 'function' && !canAccessFeature('ai_explain')) {
          if (typeof showPaywall === 'function') showPaywall('settings');
          return;
        }
        AIFeatures.showExplanationModal(q.question, expected, q.category);
      });
      feedback.parentNode.insertBefore(explainBtn, feedback.nextSibling);
    }

    var actionsDiv = container.querySelector('.drill-actions');
    if (actionsDiv) {
      var existingSkip = actionsDiv.querySelector('.skip-btn');
      if (existingSkip) {
        if (correct) {
          existingSkip.parentNode.removeChild(existingSkip);
          actionsDiv.classList.remove('has-skip');
        } else {
          existingSkip.disabled = true;
          existingSkip.classList.add('skip-btn-disabled');
        }
      }
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
      /* Adaptive: recompute difficulty and generate a fresh question for next slot */
      if (adaptiveMode && !preloadedQuestions && !reviewMode) {
        var newDiff = _computeAdaptiveDifficulty();
        _setAdaptiveOverride(newDiff);
        var nextCat = category;
        if (!nextCat && topics && topics.length) {
          nextCat = topics[current % topics.length];
        }
        var fresh = generateQuestions(1, nextCat || null);
        if (fresh && fresh.length > 0) questions[current] = fresh[0];
        _clearAdaptiveOverride();
      }
      renderQuestion();
    } else {
      if (adaptiveMode) _clearAdaptiveOverride();
      finish();
    }
  }

  function _computeSpeedScore(accNum, avgTimeSec) {
    var timeScore = Math.max(0, Math.min(40, (15 - avgTimeSec) / 15 * 40));
    var accScore = accNum * 0.6;
    return Math.round(accScore + timeScore);
  }

  var _PERCENTILE_KEY = 'qr_last_percentile';
  var _BEST_SCORES_KEY = 'qr_best_scores';
  var _EXPLAIN_CREDITS_KEY = 'qr_explain_credits';
  var _SESSIONS_COUNT_KEY = 'qr_sessions_count';

  function _computeContinuousPercentile(speedScore) {
    var base = Math.min(95, Math.max(5, Math.round(speedScore * 0.92)));
    var jitter = Math.round((Math.random() - 0.5) * 6);
    return Math.min(95, Math.max(5, base + jitter));
  }

  function _getPercentileClass(pct) {
    if (pct >= 70) return 'benchmark-band-top';
    if (pct >= 35) return 'benchmark-band-mid';
    return 'benchmark-band-bottom';
  }

  function _loadBestScores() {
    try { return JSON.parse(localStorage.getItem(_BEST_SCORES_KEY) || '{}'); } catch (_) { return {}; }
  }

  function _saveBestScores(obj) {
    try { localStorage.setItem(_BEST_SCORES_KEY, JSON.stringify(obj)); } catch (_) {}
  }

  function _getExplainCredits() {
    var v = parseInt(localStorage.getItem(_EXPLAIN_CREDITS_KEY));
    return isNaN(v) ? 5 : v;
  }

  function _decrementExplainCredits() {
    var v = _getExplainCredits();
    if (v > 0) { try { localStorage.setItem(_EXPLAIN_CREDITS_KEY, String(v - 1)); } catch (_) {} }
  }

  function _getAutoTip(cat, subtype) {
    var subtypeTips = {
      square:           'Tip: Area of a square = side². Multiply the side length by itself.',
      rectangle:        'Tip: Area of a rectangle = length × breadth. Double-check which is length and which is breadth.',
      triangle:         'Tip: Area of a triangle = ½ × base × height. Divide by 2 at the end.',
      circle:           'Tip: Area of a circle = π × r² (π ≈ 3.14). Square the radius first, then multiply.',
      parallelogram:    'Tip: Area of a parallelogram = base × height (the perpendicular height, not the slant side).',
      trapezium:        'Tip: Area of a trapezium = ½ × (sum of parallel sides) × height.',
      cube:             'Tip: Volume of a cube = side³. Multiply the side by itself three times.',
      cuboid:           'Tip: Volume of a cuboid = length × breadth × height. Multiply all three dimensions.',
      cylinder:         'Tip: Volume of a cylinder = π × r² × height (π ≈ 3.14). Find the base area first.',
      sphere:           'Tip: Volume of a sphere = (4/3) × π × r³ (π ≈ 3.14). Cube the radius, then multiply by 4/3.',
      cone:             'Tip: Volume of a cone = (1/3) × π × r² × height. It\'s one-third of the matching cylinder.',
      multiplication:   'Tip: Break apart: 18 × 7 = (20 − 2) × 7 = 140 − 14 = 126.',
      division:         'Tip: Division is the inverse of multiplication — multiply back to verify your answer.',
      average:          'Tip: Average = Sum ÷ Count. Recount items — it\'s the most common error.',
      'average-missing': 'Tip: Missing number = (Average × Count) − Sum of known numbers.'
    };
    var categoryTips = {
      squares:             'Tip: Use (a±b)² = a² ± 2ab + b² to break large squares into manageable parts.',
      cubes:               'Tip: Memorise cube values 1–10 — fast recall beats calculation every time.',
      area:                'Tip: Write the formula first, then substitute. For circles, π ≈ 3.14.',
      volume:              'Tip: Volume = base area × height for prisms. Label your units.',
      percentages:         'Tip: x% of y = y% of x — swap the numbers when one is easier to compute.',
      multiplication:      'Tip: Break apart: 18 × 7 = (20 − 2) × 7 = 140 − 14 = 126.',
      fractions:           'Tip: Find the LCM before adding or subtracting fractions.',
      averages:            'Tip: Average = Sum ÷ Count. Recount items — it\'s the most common error.',
      ratios:              'Tip: Cross-multiply to solve proportions: a/b = c/d → ad = bc.',
      'profit-loss':       'Tip: Profit % = (Profit ÷ Cost Price) × 100, not Selling Price.',
      'time-speed-distance': 'Tip: D = S × T. Write it down and substitute known values first.',
      'time-and-work':     'Tip: If A does work in N days, rate = 1/N. Add rates for combined work.'
    };
    if (subtype && subtypeTips[subtype]) return subtypeTips[subtype];
    return categoryTips[cat] || 'Tip: Review the formula used for this type of question.';
  }

  /* ---- Share as image (Canvas-based PNG card) ---- */
  function _shareAsImage(accuracy, avg, percentile) {
    var W = 600, H = 340;
    var canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    var ctx = canvas.getContext('2d');
    if (!ctx) {
      /* Canvas not supported — fall back to text share */
      _shareTextFallback(accuracy, percentile);
      return;
    }

    /* Background */
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, W, H);

    /* Card */
    var cx = 20, cy = 20, cw = W - 40, ch = H - 40, r = 20;
    ctx.beginPath();
    ctx.moveTo(cx + r, cy);
    ctx.lineTo(cx + cw - r, cy);
    ctx.quadraticCurveTo(cx + cw, cy, cx + cw, cy + r);
    ctx.lineTo(cx + cw, cy + ch - r);
    ctx.quadraticCurveTo(cx + cw, cy + ch, cx + cw - r, cy + ch);
    ctx.lineTo(cx + r, cy + ch);
    ctx.quadraticCurveTo(cx, cy + ch, cx, cy + ch - r);
    ctx.lineTo(cx, cy + r);
    ctx.quadraticCurveTo(cx, cy, cx + r, cy);
    ctx.closePath();
    ctx.fillStyle = '#1e293b';
    ctx.fill();

    /* App name */
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 28px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('QuantReflex', W / 2, 76);

    /* Website */
    ctx.fillStyle = '#94a3b8';
    ctx.font = '13px system-ui, -apple-system, sans-serif';
    ctx.fillText('QuantReflex.netlify.app', W / 2, 100);

    /* Divider */
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(60, 116);
    ctx.lineTo(W - 60, 116);
    ctx.stroke();

    /* Accuracy (large) */
    ctx.fillStyle = '#22d3ee';
    ctx.font = 'bold 64px system-ui, -apple-system, sans-serif';
    ctx.fillText(accuracy + '%', W / 2, 188);

    /* Accuracy label */
    ctx.fillStyle = '#94a3b8';
    ctx.font = '14px system-ui, -apple-system, sans-serif';
    ctx.fillText('Accuracy', W / 2, 210);

    /* Avg time stat — left block */
    var leftX = W / 2 - 100;
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 22px system-ui, -apple-system, sans-serif';
    ctx.fillText(avg + 's', leftX, 248);
    ctx.fillStyle = '#64748b';
    ctx.font = '12px system-ui, -apple-system, sans-serif';
    ctx.fillText('Avg Time', leftX, 266);

    /* Speed benchmark — right block */
    var rightX = W / 2 + 100;
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 22px system-ui, -apple-system, sans-serif';
    ctx.fillText('Top ' + Math.max(1, 100 - percentile) + '%', rightX, 248);
    ctx.fillStyle = '#64748b';
    ctx.font = '12px system-ui, -apple-system, sans-serif';
    ctx.fillText('Speed Rank', rightX, 266);

    /* Tagline */
    ctx.fillStyle = '#475569';
    ctx.font = 'italic 13px system-ui, -apple-system, sans-serif';
    ctx.fillText('Train your brain daily', W / 2, 302);

    /* Share the image */
    canvas.toBlob(function (blob) {
      if (!blob) { _shareTextFallback(accuracy, percentile); return; }
      var file = new File([blob], 'quantreflex-result.png', { type: 'image/png' });
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], title: 'QuantReflex Result' }).catch(function () {
          _shareTextFallback(accuracy, percentile);
        });
      } else {
        /* navigator.share({ files }) not supported — fall back to text/clipboard */
        _shareTextFallback(accuracy, percentile);
      }
    }, 'image/png');
  }

  function _shareTextFallback(accuracy, percentile) {
    var shareText = 'I scored ' + accuracy + '% accuracy on QuantReflex \uD83D\uDD25 - faster than ' + percentile + '% of users! Train your mental math: https://quantreflex.netlify.app';
    if (navigator.share) {
      navigator.share({ text: shareText }).catch(function () {});
    } else if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(shareText).then(function () {
        if (typeof showToast === 'function') showToast('\u2705 Copied to clipboard!');
      }).catch(function () {
        if (typeof showToast === 'function') showToast('Could not copy. Try again.');
      });
    } else {
      if (typeof showToast === 'function') showToast('Sharing not supported on this browser.');
    }
  }

  function _computeSessionInsight(accNum, wrongCats) {
    /* Load 7-day rolling average from progress localStorage for comparison */
    var rollingAvg = null;
    try {
      var _prog = JSON.parse(localStorage.getItem('quant_reflex_progress') || '{}');
      var _hist = _prog.dailyHistory || {};
      /* Sort by timestamp — Date.toDateString() keys are NOT lexicographically
         chronological (e.g. "Mon Apr 1 2026"), so parse them before slicing. */
      var _histDates = Object.keys(_hist).sort(function (a, b) {
        return new Date(a).getTime() - new Date(b).getTime();
      }).slice(-7);
      var _histCorrect = 0, _histAttempted = 0;
      for (var _hd = 0; _hd < _histDates.length; _hd++) {
        var _he = _hist[_histDates[_hd]];
        if (_he && _he.attempted > 0) { _histCorrect += _he.correct; _histAttempted += _he.attempted; }
      }
      if (_histAttempted > 0) rollingAvg = (_histCorrect / _histAttempted) * 100;
    } catch (_) {}

    /* Find top missed category in this session */
    var topMissedCat = null, topMissedCount = 0;
    var _catKeys = Object.keys(wrongCats);
    for (var _ci = 0; _ci < _catKeys.length; _ci++) {
      if (wrongCats[_catKeys[_ci]] > topMissedCount) {
        topMissedCount = wrongCats[_catKeys[_ci]];
        topMissedCat = _catKeys[_ci];
      }
    }
    var _catLabels = {
      squares: 'squares', cubes: 'cubes', area: 'area', volume: 'volume',
      percentages: 'percentages', multiplication: 'multiplication', fractions: 'fractions',
      averages: 'averages', ratios: 'ratios', 'profit-loss': 'profit & loss',
      'time-speed-distance': 'time-speed-distance', 'time-and-work': 'time & work'
    };
    var catLabel = topMissedCat ? (_catLabels[topMissedCat] || topMissedCat) : null;

    /* Streak from progress */
    var streak = 0;
    try { streak = parseInt((JSON.parse(localStorage.getItem('quant_reflex_progress') || '{}')).dailyStreak) || 0; } catch (_) {}

    /* Build insight message */
    if (accNum === 100) return '\uD83C\uDF1F Perfect score! Flawless session — push the difficulty up next time.';
    if (rollingAvg !== null) {
      var diff = accNum - rollingAvg;
      if (diff <= -8 && catLabel) return '\uD83D\uDCC9 Accuracy dropped ' + Math.abs(Math.round(diff)) + '% vs your average — focus on ' + catLabel + ' next session.';
      if (diff <= -8) return '\uD83D\uDCC9 Accuracy dropped ' + Math.abs(Math.round(diff)) + '% below your 7-day average — keep practising to bounce back.';
      if (diff >= 8) return '\uD83D\uDCC8 Strong session! Accuracy is ' + Math.round(diff) + '% above your 7-day average — great form.';
    }
    if (catLabel && topMissedCount >= 2) return '\u26A0\uFE0F You missed ' + topMissedCount + ' ' + catLabel + ' question' + (topMissedCount > 1 ? 's' : '') + ' — try a focused ' + catLabel + ' drill next.';
    if (accNum >= 90) return '\uD83D\uDCAA Excellent accuracy (' + accNum + '%) — try a timed session to sharpen your speed.';
    if (accNum >= 75) return '\uD83D\uDC4D Good session! A little more practice on your weak spots will push you into the top tier.';
    if (accNum < 50) return '\uD83D\uDCDA Tough session — review the concepts and try again with fewer questions.';
    if (streak >= 3) return '\uD83D\uDD25 ' + streak + '-day streak! Consistency is your biggest advantage — keep showing up.';
    return '\uD83D\uDCCB Session done. Focus on accuracy first, speed will follow.';
  }

  function finish() {
    cleanup();
    _exitDrillSession();
    if (adaptiveMode) _clearAdaptiveOverride();
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
    var avgRaw = perQuestionTimes.length
      ? (perQuestionTimes.reduce(function (a, b) { return a + b; }, 0) / perQuestionTimes.length)
      : 0;
    var avg = avgRaw.toFixed(1);
    var accuracy = ((score / count) * 100).toFixed(0);
    var accNum = parseFloat(accuracy);

    /* Speed benchmark computation */
    var speedScore = _computeSpeedScore(accNum, avgRaw);
    var percentile = _computeContinuousPercentile(speedScore);
    var percentileClass = _getPercentileClass(percentile);

    /* Session delta: compare with last stored percentile */
    var lastPct = null;
    try { lastPct = parseInt(localStorage.getItem(_PERCENTILE_KEY)); } catch (_) {}
    var deltaHtml = '';
    if (!isNaN(lastPct) && lastPct > 0) {
      var delta = percentile - lastPct;
      if (delta > 0) deltaHtml = '<span class="percentile-delta delta-up">↑ +' + delta + '% from last session</span>';
      else if (delta < 0) deltaHtml = '<span class="percentile-delta delta-down">↓ ' + delta + '% from last session</span>';
    }
    try { localStorage.setItem(_PERCENTILE_KEY, String(percentile)); } catch (_) {}

    /* New Best detection */
    var bests = _loadBestScores();
    var prevBestAcc = bests.bestAccuracy || 0;
    var prevBestScore = bests.bestSpeedScore || 0;
    var isNewBest = (accNum > prevBestAcc) || (speedScore > prevBestScore);
    if (isNewBest) {
      bests.bestAccuracy = Math.max(prevBestAcc, accNum);
      bests.bestSpeedScore = Math.max(prevBestScore, speedScore);
      _saveBestScores(bests);
    }

    /* Performance badge */
    var badgeText, badgeClass;
    if (accNum >= 90) { badgeText = '🏆 Excellent'; badgeClass = 'badge-excellent'; }
    else if (accNum >= 75) { badgeText = '👍 Good'; badgeClass = 'badge-good'; }
    else if (accNum >= 50) { badgeText = '📝 Needs Practice'; badgeClass = 'badge-practice'; }
    else { badgeText = '💪 Keep Trying'; badgeClass = 'badge-weak'; }

    /* Rule-based post-session insight (always visible, no AI call) */
    var _insightText = _computeSessionInsight(accNum, sessionWrongCategories);

    container.innerHTML =
      '<div class="card center-content fade-in">' +
        '<h2>Results</h2>' +
        (isNewBest ? '<div class="new-best-badge">🎉 New Best!</div>' : '') +
        '<div class="performance-badge ' + badgeClass + '">' + badgeText + '</div>' +
        '<div class="session-insight-card">' + _escHtml(_insightText) + '</div>' +
        '<div class="results-grid">' +
          '<div class="result-item"><span class="result-value">' + score + '/' + count + '</span><span class="result-label">Score</span></div>' +
          '<div class="result-item"><span class="result-value">' + accuracy + '%</span><span class="result-label">Accuracy</span></div>' +
          '<div class="result-item"><span class="result-value">' + avg + 's</span><span class="result-label">Avg Time</span></div>' +
          '<div class="result-item"><span class="result-value">' + bestSessionStreak + '</span><span class="result-label">Best Streak</span></div>' +
          '<div class="result-item"><span class="result-value">' + totalTime + 's</span><span class="result-label">Total Time</span></div>' +
        '</div>' +
        '<div class="speed-benchmark-card" id="speedBenchmarkCard">' +
          '<div class="benchmark-header">' +
            '<span class="benchmark-icon">⚡</span>' +
            '<span class="benchmark-title">Speed Benchmark</span>' +
          '</div>' +
          '<div class="benchmark-highlight ' + percentileClass + '">' +
            '<span class="benchmark-highlight-pct">Faster than <strong>' + percentile + '%</strong> of users</span>' +
            deltaHtml +
          '</div>' +
          '<div class="benchmark-stats-row">' +
            '<div class="benchmark-stat-block">' +
              '<span class="benchmark-stat-value">' + accuracy + '%</span>' +
              '<span class="benchmark-stat-label">Accuracy</span>' +
            '</div>' +
            '<div class="benchmark-stat-block">' +
              '<span class="benchmark-stat-value">' + avg + 's</span>' +
              '<span class="benchmark-stat-label">Avg Time</span>' +
            '</div>' +
            '<div class="benchmark-stat-block">' +
              '<span class="benchmark-stat-value">' + speedScore + '</span>' +
              '<span class="benchmark-stat-label">Speed Score</span>' +
            '</div>' +
          '</div>' +
          '<div class="benchmark-ai-section" id="benchmarkAiSection">' +
            '<div class="benchmark-ai-placeholder" id="benchmarkAiPlaceholder"></div>' +
          '</div>' +
        '</div>' +
        '<button class="btn results-share-btn" type="button" id="shareResultBtn">\uD83D\uDCE4 Share Result</button>' +
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
    /* Share button — generates a PNG image card and shares it */
    var shareBtn = container.querySelector('#shareResultBtn');
    if (shareBtn) {
      shareBtn.addEventListener('click', function () {
        _shareAsImage(accuracy, avg, percentile);
      });
    }

    /* Speed Benchmark summary — generated locally, available to all users */
    var benchmarkPlaceholder = container.querySelector('#benchmarkAiPlaceholder');
    if (benchmarkPlaceholder && typeof AIFeatures !== 'undefined' && typeof AIFeatures.fetchSpeedBenchmark === 'function') {
      AIFeatures.fetchSpeedBenchmark(accNum, parseFloat(avg), speedScore, percentile, count, mode, function (err, data) {
        if (err || !data) {
          benchmarkPlaceholder.innerHTML = '';
          return;
        }
        _renderBenchmarkAi(benchmarkPlaceholder, data);
      });
    }

    /* Post-session paywall trigger — after 2nd completed session (free users only) */
    try {
      var _isPremiumUser = (typeof canAccessFeature === 'function') ? canAccessFeature('adaptive_training') : false;
      if (!_isPremiumUser) {
        var _sessCount = parseInt(localStorage.getItem(_SESSIONS_COUNT_KEY)) || 0;
        _sessCount++;
        localStorage.setItem(_SESSIONS_COUNT_KEY, String(_sessCount));
        if (_sessCount === 2) {
          setTimeout(function () {
            if (typeof showPaywall === 'function') showPaywall('upgrade');
          }, 1500);
        }
      }
    } catch (_) {}
  }

  function _renderBenchmarkAi(el, data) {
    if (!el || !data) return;
    el.innerHTML =
      '<div class="benchmark-ai-result">' +
        '<span class="benchmark-level">' + _escHtml(data.level || '') + '</span>' +
        '<p class="benchmark-summary">' + _escHtml(data.summary || '') + '</p>' +
        '<p class="benchmark-suggestion"><span class="benchmark-tip-label">Tip:</span> ' + _escHtml(data.suggestion || '') + '</p>' +
      '</div>';
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
    if (adaptiveMode) _clearAdaptiveOverride();
    /* Clear session pattern so non-adaptive sessions don't inherit stale hints */
    window._sessionAdaptivePattern = null;
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
    /* Reset anti-repetition tracker so new session gets fresh questions */
    if (typeof resetRecentQuestions === 'function') resetRecentQuestions();
    /* Mark session as active and hide nav for immersive experience */
    _enterDrillSession();

    /* Begin Firestore write batching during drill */
    if (typeof FirestoreSync !== 'undefined') {
      FirestoreSync.beginDrillBatch();
    }

    /* Set initial adaptive difficulty based on session settings */
    if (adaptiveMode) {
      try {
        var _s = JSON.parse(localStorage.getItem('quant_reflex_settings') || '{}');
        _setAdaptiveOverride(_s.difficulty || 'medium');
      } catch (_) { _setAdaptiveOverride('medium'); }
    }

    if (preloadedQuestions && preloadedQuestions.length > 0) {
      questions = preloadedQuestions;
      count = questions.length;
    } else if (reviewMode) {
      questions = generateMistakeReviewQuestions(count);
      if (questions.length === 0) {
        _exitDrillSession();
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
      count = questions.length;
      reviewOriginalCount = count;
    } else if (topics && topics.length) {
      questions = _generateCustomTopicQuestions(count, topics);
    } else {
      questions = generateQuestions(count, category);
    }
    current = 0;
    score = 0;
    bestSessionStreak = 0;
    currentSessionStreak = 0;
    perQuestionTimes = [];
    sessionWrongCategories = {};
    overallStart = performance.now();
    startGlobalTimer();
    renderQuestion();
  }

  /* ---- public API ---- */
  return { start: renderStart, cleanup: cleanup };
}
