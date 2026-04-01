var AIFeatures = (function () {
  var WP_FREE_LIMIT = 5;
  var WP_PREMIUM_DAILY_LIMIT = 25;
  var COACH_CACHE_HOURS = 24;

  var _wpInFlight = false;
  var _explainInFlight = false;
  var _insightsInFlight = false;

  function _esc(str) {
    if (typeof str !== 'string') return '';
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function _uid() {
    if (typeof Auth !== 'undefined' && typeof Auth.getCurrentUser === 'function') {
      var u = Auth.getCurrentUser();
      if (u && u.uid) return u.uid;
    }
    return 'anon';
  }

  function _wpKey() { return 'quant_ai_wp_usage_' + _uid(); }
  function _coachKey() { return 'quant_ai_coach_cache_' + _uid(); }

  function _getWpUsage() {
    try {
      var raw = localStorage.getItem(_wpKey());
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return { lifetimeUsed: 0, dailyUsed: 0, dailyDate: null };
  }

  function _saveWpUsage(usage) {
    try { localStorage.setItem(_wpKey(), JSON.stringify(usage)); } catch (_) {}
  }

  function _isPremium() {
    if (typeof canAccessFeature === 'function') {
      return canAccessFeature('ai_coach');
    }
    if (typeof FirestoreSync !== 'undefined' && typeof FirestoreSync.getAccessState === 'function') {
      var state = FirestoreSync.getAccessState();
      if (state && (state.isPremium === true || state.hasPaid === true || state.isEarlyUser === true || state.isTrial === true)) return true;
    }
    return false;
  }

  function _getIdToken(callback) {
    if (typeof Auth !== 'undefined' && typeof Auth.getCurrentUser === 'function') {
      var u = Auth.getCurrentUser();
      if (u && typeof u.getIdToken === 'function') {
        u.getIdToken().then(function (token) {
          callback(token);
        }).catch(function () {
          callback(null);
        });
        return;
      }
    }
    callback(null);
  }

  var FRIENDLY_ERROR = 'Unable to generate right now. Try again later.';

  function _sendAuthenticatedRequest(method, url, body, timeout, callback) {
    _getIdToken(function (token) {
      if (!token) {
        callback(FRIENDLY_ERROR);
        return;
      }
      var xhr = new XMLHttpRequest();
      xhr.open(method, url, true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.setRequestHeader('Authorization', 'Bearer ' + token);
      xhr.timeout = timeout;
      xhr.onload = function () {
        if (xhr.status === 200) {
          try {
            callback(null, JSON.parse(xhr.responseText));
          } catch (e) {
            callback(FRIENDLY_ERROR);
          }
        } else if (xhr.status === 403) {
          try {
            var errData = JSON.parse(xhr.responseText);
            callback(errData.error && errData.error.code === 'PREMIUM_REQUIRED' ? 'premium_required' : FRIENDLY_ERROR);
          } catch (_) {
            callback(FRIENDLY_ERROR);
          }
        } else {
          callback(FRIENDLY_ERROR);
        }
      };
      xhr.onerror = function () { callback(FRIENDLY_ERROR); };
      xhr.ontimeout = function () { callback(FRIENDLY_ERROR); };
      xhr.send(JSON.stringify(body));
    });
  }

  function getWordProblemQuota() {
    var usage = _getWpUsage();
    var today = new Date().toDateString();
    if (_isPremium()) {
      if (usage.dailyDate !== today) {
        usage.dailyUsed = 0;
        usage.dailyDate = today;
        _saveWpUsage(usage);
      }
      return { remaining: WP_PREMIUM_DAILY_LIMIT - usage.dailyUsed, limit: WP_PREMIUM_DAILY_LIMIT, type: 'daily' };
    }
    return { remaining: WP_FREE_LIMIT - usage.lifetimeUsed, limit: WP_FREE_LIMIT, type: 'lifetime' };
  }

  function consumeWordProblemQuota(count) {
    var usage = _getWpUsage();
    var today = new Date().toDateString();
    if (_isPremium()) {
      if (usage.dailyDate !== today) {
        usage.dailyUsed = 0;
        usage.dailyDate = today;
      }
      usage.dailyUsed += count;
    } else {
      usage.lifetimeUsed += count;
    }
    _saveWpUsage(usage);
  }

  function fetchWordProblems(category, difficulty, count, callback) {
    if (_wpInFlight) { callback('request_in_progress'); return; }
    _wpInFlight = true;

    var quota = getWordProblemQuota();
    if (quota.remaining <= 0) {
      _wpInFlight = false;
      if (!_isPremium()) {
        callback('free_limit_reached');
      } else {
        callback('daily_limit_reached');
      }
      return;
    }
    var actualCount = Math.min(count, quota.remaining);

    _sendAuthenticatedRequest('POST', '/api/ai/word-problems',
      { category: category, difficulty: difficulty, count: actualCount }, 30000,
      function (err, data) {
        _wpInFlight = false;
        if (err) { callback(err); return; }
        if (data.questions && data.questions.length > 0) {
          consumeWordProblemQuota(data.questions.length);
          callback(null, data.questions);
        } else {
          callback('No questions generated');
        }
      });
  }

  function fetchExplanation(question, answer, category, callback) {
    if (_explainInFlight) { callback('request_in_progress'); return; }
    _explainInFlight = true;

    _sendAuthenticatedRequest('POST', '/api/ai/explain',
      { question: question, answer: answer, category: category }, 20000,
      function (err, data) {
        _explainInFlight = false;
        if (err) { callback(err); return; }
        callback(null, data.explanation);
      });
  }

  function fetchInsights(stats, callback) {
    if (_insightsInFlight) { callback('request_in_progress'); return; }

    var cached = _getCachedCoach();
    if (cached) {
      callback(null, cached);
      return;
    }

    _insightsInFlight = true;
    _sendAuthenticatedRequest('POST', '/api/ai/insights',
      { stats: stats }, 20000,
      function (err, data) {
        _insightsInFlight = false;
        if (err) { callback(err); return; }
        _cacheCoach(data.insights);
        callback(null, data.insights);
      });
  }

  function _getCachedCoach() {
    try {
      var raw = localStorage.getItem(_coachKey());
      if (!raw) return null;
      var cached = JSON.parse(raw);
      var age = Date.now() - (cached.timestamp || 0);
      if (age < COACH_CACHE_HOURS * 60 * 60 * 1000) return cached.data;
    } catch (_) {}
    return null;
  }

  function _cacheCoach(data) {
    try {
      localStorage.setItem(_coachKey(), JSON.stringify({ data: data, timestamp: Date.now() }));
    } catch (_) {}
  }

  function showExplanationModal(question, answer, category) {
    if (_explainInFlight) return;

    var existing = document.getElementById('aiExplainModal');
    if (existing) existing.parentNode.removeChild(existing);

    var overlay = document.createElement('div');
    overlay.id = 'aiExplainModal';
    overlay.className = 'modal-overlay ai-explain-overlay';
    overlay.style.display = 'flex';
    overlay.innerHTML =
      '<div class="modal-content ai-explain-modal">' +
        '<h3 class="modal-title">🧠 AI Explanation</h3>' +
        '<div class="ai-explain-body">' +
          '<div class="ai-loading"><div class="ai-spinner"></div><p>Generating explanation...</p></div>' +
        '</div>' +
        '<div class="modal-actions">' +
          '<button class="btn modal-cancel ai-explain-close">Close</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);

    function closeModal() {
      overlay.style.display = 'none';
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }

    overlay.querySelector('.ai-explain-close').addEventListener('click', closeModal);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeModal();
    });

    fetchExplanation(question, answer, category, function (err, explanation) {
      var body = overlay.querySelector('.ai-explain-body');
      if (!body) return;

      if (err) {
        body.innerHTML = '<p class="ai-error">' + FRIENDLY_ERROR + '</p>';
        return;
      }

      var stepsHtml = '';
      if (explanation.steps && explanation.steps.length > 0) {
        for (var i = 0; i < explanation.steps.length; i++) {
          stepsHtml += '<li>' + _esc(explanation.steps[i]) + '</li>';
        }
      }

      body.innerHTML =
        '<div class="ai-explain-section">' +
          '<h4>📌 Concept</h4>' +
          '<p>' + _esc(explanation.concept) + '</p>' +
        '</div>' +
        '<div class="ai-explain-section">' +
          '<h4>📝 Step-by-Step Solution</h4>' +
          '<ol class="ai-steps-list">' + stepsHtml + '</ol>' +
        '</div>' +
        (explanation.mistake ? '<div class="ai-explain-section"><h4>⚠️ Common Mistake</h4><p>' + _esc(explanation.mistake) + '</p></div>' : '') +
        (explanation.tip ? '<div class="ai-explain-section ai-tip-section"><h4>💡 Quick Tip</h4><p>' + _esc(explanation.tip) + '</p></div>' : '');
    });
  }

  function _renderInsightsResult(container, insights) {
    container.innerHTML =
      '<div class="ai-insight-block">' +
        '<p class="ai-insight-text">' + _esc(insights.insight) + '</p>' +
      '</div>' +
      (insights.problem ? '<div class="ai-insight-block ai-insight-problem"><strong>Focus area:</strong> ' + _esc(insights.problem) + '</div>' : '') +
      (insights.action ? '<div class="ai-insight-block ai-insight-action"><strong>Today\'s action:</strong> ' + _esc(insights.action) + '</div>' : '');
  }

  function _triggerInsightsFetch(bodyEl, btnEl, stats) {
    var cached = _getCachedCoach();
    if (cached) {
      _renderInsightsResult(bodyEl, cached);
      return;
    }
    if (btnEl) btnEl.style.display = 'none';
    bodyEl.innerHTML = '<div class="ai-loading"><div class="ai-spinner"></div><p>Analyzing your performance...</p></div>';
    fetchInsights(stats, function (err, insights) {
      if (err) {
        bodyEl.innerHTML = '<p class="ai-error">Unable to generate right now. Try again later.</p>';
        if (btnEl) { btnEl.style.display = ''; btnEl.disabled = false; }
        return;
      }
      _renderInsightsResult(bodyEl, insights);
    });
  }

  function renderAICoachCard(containerId, stats) {
    var container = document.getElementById(containerId);
    if (!container) return;

    if (!_isPremium()) {
      container.innerHTML =
        '<div class="card ai-coach-card ai-coach-locked">' +
          '<h3>🤖 AI Coach</h3>' +
          '<p class="secondary-text">Get personalized daily insights powered by AI.</p>' +
          '<button class="btn accent ai-coach-unlock-btn" type="button">🔒 Unlock with Premium</button>' +
        '</div>';
      var unlockBtn = container.querySelector('.ai-coach-unlock-btn');
      if (unlockBtn) {
        unlockBtn.addEventListener('click', function () {
          if (typeof showPaywall === 'function') showPaywall('settings');
        });
      }
      return;
    }

    if (!stats || !stats.totalAttempted || stats.totalAttempted < 5) {
      container.innerHTML =
        '<div class="card ai-coach-card">' +
          '<h3>🤖 AI Coach</h3>' +
          '<div class="ai-coach-body">' +
            '<p class="secondary-text">Complete at least 5 questions to get your first AI insight.</p>' +
          '</div>' +
        '</div>';
      return;
    }

    var cached = _getCachedCoach();
    if (cached) {
      container.innerHTML =
        '<div class="card ai-coach-card">' +
          '<h3>🤖 AI Coach</h3>' +
          '<div class="ai-coach-body"></div>' +
        '</div>';
      _renderInsightsResult(container.querySelector('.ai-coach-body'), cached);
      return;
    }

    container.innerHTML =
      '<div class="card ai-coach-card">' +
        '<h3>🤖 AI Coach</h3>' +
        '<div class="ai-coach-body">' +
          '<button class="btn accent ai-insights-btn" type="button">View AI Insights ✨</button>' +
        '</div>' +
      '</div>';

    var insightsBtn = container.querySelector('.ai-insights-btn');
    var bodyEl = container.querySelector('.ai-coach-body');
    insightsBtn.addEventListener('click', function () {
      insightsBtn.disabled = true;
      _triggerInsightsFetch(bodyEl, insightsBtn, stats);
    });
  }

  var WP_CATEGORIES = [
    { key: 'percentages', label: 'Percentages' },
    { key: 'profit-loss', label: 'Profit & Loss' },
    { key: 'ratios', label: 'Ratios' },
    { key: 'time-speed-distance', label: 'Time Speed Dist' },
    { key: 'time-and-work', label: 'Time & Work' },
    { key: 'averages', label: 'Averages' },
    { key: 'fractions', label: 'Fractions' },
    { key: 'area', label: 'Area' },
    { key: 'volume', label: 'Volume' }
  ];
  var WP_MAX_QUESTIONS_PREMIUM = 25;
  var WP_MAX_QUESTIONS_FREE = 5;
  var WP_DEFAULT_QUESTIONS = 5;

  var _wpSelectedCategory = null;
  var _wpQuestionCount = WP_DEFAULT_QUESTIONS;
  var _wpTimerEnabled = false;
  var _wpTimerPillMode = 'per';
  var _wpTimerSeconds = 15;

  function renderWordProblemsSetup(container, onStart) {
    var quota = getWordProblemQuota();
    var quotaText = quota.type === 'lifetime'
      ? quota.remaining + '/' + quota.limit + ' free AI questions remaining'
      : quota.remaining + '/' + quota.limit + ' daily AI questions remaining';

    var wpMaxQuestions = _isPremium() ? WP_MAX_QUESTIONS_PREMIUM : WP_MAX_QUESTIONS_FREE;
    var wpDefaultCount = Math.min(WP_DEFAULT_QUESTIONS, wpMaxQuestions);

    _wpSelectedCategory = null;
    _wpQuestionCount = wpDefaultCount;
    _wpTimerEnabled = false;
    _wpTimerPillMode = 'per';
    _wpTimerSeconds = 15;

    var catHtml = '';
    for (var c = 0; c < WP_CATEGORIES.length; c++) {
      catHtml += '<button class="category-btn category-card wp-cat-btn" type="button" data-wpcat="' + WP_CATEGORIES[c].key + '">' + WP_CATEGORIES[c].label + '</button>';
    }

    container.innerHTML =
      '<div class="training-card">' +
        '<h3 class="category-select-title">🤖 Word Problems</h3>' +
        '<div class="training-card-body">' +
          '<p class="ai-quota-text">' + quotaText + '</p>' +
          '<div class="category-grid">' + catHtml + '</div>' +
          '<div class="wp-config-section">' +
            '<label class="secondary-text" for="wpQuestionSlider">Number of Questions</label>' +
            '<input id="wpQuestionSlider" class="custom-question-range" type="range" min="1" max="' + wpMaxQuestions + '" value="' + wpDefaultCount + '" />' +
            '<div class="custom-practice-meta-row">' +
              '<strong id="wpQuestionCountValue">' + wpDefaultCount + '</strong>' +
              '<span class="secondary-text" id="wpQuestionCountText">You will solve ' + wpDefaultCount + ' questions</span>' +
            '</div>' +
          '</div>' +
          '<div class="timer-select-section wp-timer-section">' +
            '<div class="timer-toggle-row">' +
              '<span class="timer-toggle-label">Timer</span>' +
              '<label class="toggle">' +
                '<input type="checkbox" id="wpTimerToggle" />' +
                '<span class="toggle-slider"></span>' +
              '</label>' +
            '</div>' +
            '<div class="timer-config-area" id="wpTimerConfigArea" style="display:none;">' +
              '<div class="timer-pill-selector">' +
                '<button class="timer-pill active" data-wppill="per" type="button">Per Ques.</button>' +
                '<button class="timer-pill" data-wppill="total" type="button">Total</button>' +
              '</div>' +
              '<div class="timer-input-row">' +
                '<input type="number" id="wpTimerSecondsInput" class="timer-seconds-input" min="5" max="600" value="15" />' +
                '<span class="timer-unit-label">seconds</span>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<button class="btn accent custom-practice-start-btn" id="startWordProblems" type="button">Generate Word Problems</button>' +
          '<div id="wpError" class="custom-mode-error secondary-text"></div>' +
        '</div>' +
        '<button class="training-card-back" id="wpBackToModes" type="button" aria-label="Back to practice modes">← Back</button>' +
      '</div>';

    var startBtn = container.querySelector('#startWordProblems');
    var backBtn = container.querySelector('#wpBackToModes');
    var errorEl = container.querySelector('#wpError');
    var slider = container.querySelector('#wpQuestionSlider');
    var countValue = container.querySelector('#wpQuestionCountValue');
    var countText = container.querySelector('#wpQuestionCountText');
    var wpTimerToggle = container.querySelector('#wpTimerToggle');
    var wpTimerConfigArea = container.querySelector('#wpTimerConfigArea');
    var wpTimerPillContainer = container.querySelector('.wp-timer-section .timer-pill-selector');
    var wpTimerSecondsInput = container.querySelector('#wpTimerSecondsInput');

    var catBtns = container.querySelectorAll('.wp-cat-btn');
    for (var cb = 0; cb < catBtns.length; cb++) {
      catBtns[cb].addEventListener('click', function () {
        var key = this.getAttribute('data-wpcat');
        if (_wpSelectedCategory === key) {
          _wpSelectedCategory = null;
          this.classList.remove('selected');
        } else {
          for (var j = 0; j < catBtns.length; j++) catBtns[j].classList.remove('selected');
          _wpSelectedCategory = key;
          this.classList.add('selected');
        }
        if (errorEl) errorEl.textContent = '';
      });
    }

    if (slider) {
      slider.addEventListener('input', function () {
        var val = parseInt(slider.value, 10);
        if (isNaN(val)) val = wpDefaultCount;
        _wpQuestionCount = Math.max(1, Math.min(wpMaxQuestions, val));
        if (countValue) countValue.textContent = String(_wpQuestionCount);
        if (countText) countText.textContent = 'You will solve ' + _wpQuestionCount + ' questions';
      });
    }

    if (wpTimerToggle) {
      wpTimerToggle.addEventListener('change', function () {
        _wpTimerEnabled = this.checked;
        if (wpTimerConfigArea) wpTimerConfigArea.style.display = this.checked ? 'block' : 'none';
      });
    }

    if (wpTimerPillContainer) {
      wpTimerPillContainer.addEventListener('click', function (e) {
        var pill = e.target.closest('.timer-pill');
        if (!pill) return;
        var pills = wpTimerPillContainer.querySelectorAll('.timer-pill');
        for (var i = 0; i < pills.length; i++) pills[i].classList.remove('active');
        pill.classList.add('active');
        _wpTimerPillMode = pill.getAttribute('data-wppill');
      });
    }

    if (wpTimerSecondsInput) {
      wpTimerSecondsInput.addEventListener('input', function () {
        var val = parseInt(this.value, 10);
        if (!isNaN(val)) _wpTimerSeconds = Math.max(5, Math.min(600, val));
      });
    }

    if (quota.remaining <= 0) {
      startBtn.disabled = true;
      startBtn.textContent = quota.type === 'lifetime' ? '🔒 Free limit reached' : 'Daily limit reached';
      if (quota.type === 'lifetime') {
        errorEl.textContent = 'Upgrade to Premium for 25 AI questions per day.';
        errorEl.style.display = 'block';
      }
    }

    startBtn.addEventListener('click', function () {
      if (!_wpSelectedCategory) {
        if (errorEl) errorEl.textContent = 'Please select a category';
        return;
      }
      var settings = (typeof loadSettings === 'function') ? loadSettings() : {};
      var diff = settings.difficulty || 'medium';
      var cnt = Math.min(_wpQuestionCount, quota.remaining);
      if (cnt <= 0) {
        if (errorEl) errorEl.textContent = quota.type === 'lifetime' ? 'No free questions remaining.' : 'Daily limit reached.';
        return;
      }

      startBtn.disabled = true;
      startBtn.innerHTML = '<div class="ai-spinner-inline"></div> Generating...';
      errorEl.textContent = '';

      var wpTimerCfg = { timeLimitSec: null, perQuestionSec: null };
      if (_wpTimerEnabled && _wpTimerSeconds >= 5) {
        if (_wpTimerPillMode === 'per') {
          wpTimerCfg.perQuestionSec = _wpTimerSeconds;
        } else {
          wpTimerCfg.timeLimitSec = _wpTimerSeconds;
        }
      }

      fetchWordProblems(_wpSelectedCategory, diff, cnt, function (err, questions) {
        if (err) {
          startBtn.disabled = false;
          startBtn.textContent = 'Generate Word Problems';
          if (err === 'free_limit_reached') {
            errorEl.textContent = 'You\'ve used all 5 free AI questions. Upgrade to Premium for more.';
            if (typeof showPaywall === 'function') showPaywall('settings');
          } else if (err === 'daily_limit_reached') {
            errorEl.textContent = 'You\'ve reached today\'s limit of 25 AI questions. Come back tomorrow!';
          } else if (err === 'request_in_progress') {
            errorEl.textContent = 'A request is already in progress. Please wait.';
          } else {
            errorEl.textContent = FRIENDLY_ERROR;
          }
          return;
        }
        if (onStart) onStart(questions, _wpSelectedCategory, diff, wpTimerCfg);
      });
    });

    if (backBtn) {
      backBtn.addEventListener('click', function () {
        if (typeof _resetPracticeUiToModes === 'function') {
          _resetPracticeUiToModes();
        }
      });
    }
  }

  var _studyPlanInFlight = false;
  var SP_EXAMS = ['CAT', 'GMAT', 'CET', 'Placement', 'GRE', 'XAT', 'SNAP', 'NMAT', 'Other'];

  function _spCacheKey(examDate) {
    return 'quant_ai_sp_' + _uid() + '_' + examDate;
  }

  function _getStudyPlanCache(examDate) {
    try {
      var raw = localStorage.getItem(_spCacheKey(examDate));
      if (!raw) return null;
      var cached = JSON.parse(raw);
      var ageMs = Date.now() - (cached.timestamp || 0);
      if (ageMs < 7 * 24 * 60 * 60 * 1000) return cached;
    } catch (_) {}
    return null;
  }

  function _setStudyPlanCache(examDate, examName, dailyTimeMinutes, plan) {
    try {
      localStorage.setItem(_spCacheKey(examDate), JSON.stringify({
        examDate: examDate,
        examName: examName,
        dailyTimeMinutes: dailyTimeMinutes,
        plan: plan,
        timestamp: Date.now()
      }));
      _saveLastUsed(examDate, examName, dailyTimeMinutes);
    } catch (_) {}
  }

  function _clearStudyPlanCache(examDate) {
    try { localStorage.removeItem(_spCacheKey(examDate)); } catch (_) {}
  }

  function _spLastUsedKey() {
    return 'quant_ai_sp_last_' + _uid();
  }

  function _saveLastUsed(examDate, examName, dailyTimeMinutes) {
    try {
      localStorage.setItem(_spLastUsedKey(), JSON.stringify({ examDate: examDate, examName: examName, dailyTimeMinutes: dailyTimeMinutes }));
    } catch (_) {}
  }

  function _getLastUsed() {
    try {
      var raw = localStorage.getItem(_spLastUsedKey());
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }

  function _buildResultHTML(plan, examName, examDate, daysRemaining) {
    var weekHtml = '';
    if (plan.weeklyPlan && plan.weeklyPlan.length > 0) {
      for (var i = 0; i < plan.weeklyPlan.length; i++) {
        weekHtml += '<li class="sp-week-item">' + _esc(plan.weeklyPlan[i]) + '</li>';
      }
    }
    var daysLabel = daysRemaining === 1 ? '1 day' : daysRemaining + ' days';
    return '<div class="sp-result" id="spResult">' +
      '<div class="sp-meta">' +
        '<span class="sp-exam-badge">' + _esc(examName) + '</span>' +
        '<span class="sp-days-badge">' + _esc(daysLabel) + ' left</span>' +
      '</div>' +
      '<div class="sp-section">' +
        '<h4 class="sp-section-title">🎯 Strategy</h4>' +
        '<p class="sp-section-body">' + _esc(plan.strategy) + '</p>' +
      '</div>' +
      '<div class="sp-section">' +
        '<h4 class="sp-section-title">📅 Weekly Plan</h4>' +
        '<ul class="sp-week-list">' + weekHtml + '</ul>' +
      '</div>' +
      '<div class="sp-section">' +
        '<h4 class="sp-section-title">⏱ Daily Structure</h4>' +
        '<p class="sp-section-body">' + _esc(plan.dailyStructure) + '</p>' +
      '</div>' +
      '<div class="sp-section sp-tip-section">' +
        '<h4 class="sp-section-title">💡 Pro Tip</h4>' +
        '<p class="sp-section-body">' + _esc(plan.tip) + '</p>' +
      '</div>' +
      '<div class="sp-result-actions">' +
        '<button class="btn sp-edit-inputs-btn" type="button">✏️ Edit Inputs</button>' +
        '<button class="btn sp-regenerate-btn" type="button">Regenerate ↺</button>' +
      '</div>' +
    '</div>';
  }

  function _openStudyPlanModal(containerId) {
    var existing = document.getElementById('aiStudyPlanModal');
    if (existing) existing.parentNode.removeChild(existing);

    var todayStr = new Date().toISOString().slice(0, 10);
    var examOptions = '';
    for (var e = 0; e < SP_EXAMS.length; e++) {
      examOptions += '<option value="' + SP_EXAMS[e] + '">' + SP_EXAMS[e] + '</option>';
    }

    var formHTML =
      '<div class="sp-form" id="spForm">' +
        '<div class="sp-field">' +
          '<label class="sp-label" for="spExamSelect">Target Exam</label>' +
          '<select id="spExamSelect" class="sp-select">' + examOptions + '</select>' +
          '<input id="spExamCustom" class="sp-input" type="text" placeholder="Or type exam name..." maxlength="80" style="display:none;margin-top:.5rem;" />' +
        '</div>' +
        '<div class="sp-field">' +
          '<label class="sp-label" for="spExamDate">Exam Date</label>' +
          '<input id="spExamDate" class="sp-input" type="date" min="' + todayStr + '" />' +
        '</div>' +
        '<div class="sp-field">' +
          '<label class="sp-label" for="spDailyTime">Daily Study Time: <strong id="spDailyTimeVal">60</strong> min</label>' +
          '<input id="spDailyTime" type="range" min="15" max="180" step="15" value="60" class="sp-range" />' +
          '<div class="sp-range-labels"><span>15 min</span><span>3 hrs</span></div>' +
        '</div>' +
        '<div class="sp-error" id="spError" style="display:none;"></div>' +
        '<button class="btn accent sp-generate-btn" id="spGenerateBtn" type="button">Generate Plan ✨</button>' +
      '</div>';

    var overlay = document.createElement('div');
    overlay.id = 'aiStudyPlanModal';
    overlay.className = 'modal-overlay sp-modal-overlay';
    overlay.style.display = 'flex';
    overlay.innerHTML =
      '<div class="modal-content sp-modal">' +
        '<h3 class="modal-title">📅 Your Study Plan</h3>' +
        '<div class="sp-modal-body" id="spModalBody">' + formHTML + '</div>' +
        '<div class="modal-actions">' +
          '<button class="btn modal-cancel sp-close-btn">Close</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);

    function closeModal() {
      _studyPlanInFlight = false;
      overlay.style.display = 'none';
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }

    function showForm() {
      var bodyEl = overlay.querySelector('#spModalBody');
      bodyEl.innerHTML = formHTML;
      _bindFormHandlers(bodyEl);
    }

    function showResult(plan, examName, examDate, dailyMins) {
      var examMs = new Date(examDate).getTime();
      var daysRemaining = Math.max(1, Math.ceil((examMs - Date.now()) / (1000 * 60 * 60 * 24)));
      var bodyEl = overlay.querySelector('#spModalBody');
      bodyEl.innerHTML = _buildResultHTML(plan, examName, examDate, daysRemaining);

      var editBtn = bodyEl.querySelector('.sp-edit-inputs-btn');
      if (editBtn) editBtn.addEventListener('click', showForm);

      var regenBtn = bodyEl.querySelector('.sp-regenerate-btn');
      if (regenBtn) {
        regenBtn.addEventListener('click', function () {
          if (_studyPlanInFlight) return;
          _studyPlanInFlight = true;
          regenBtn.disabled = true;
          regenBtn.innerHTML = '<div class="ai-spinner-inline"></div>';
          _clearStudyPlanCache(examDate);

          var progress = typeof loadProgress === 'function' ? loadProgress() : {};
          var statsPayload = {
            totalAttempted: progress.totalAttempted || 0,
            totalCorrect: progress.totalCorrect || 0,
            categoryStats: progress.categoryStats || {}
          };

          _sendAuthenticatedRequest('POST', '/api/ai/study-plan', {
            examName: examName,
            examDate: examDate,
            dailyTimeMinutes: dailyMins,
            forceRefresh: true,
            stats: statsPayload
          }, 45000, function (err, data) {
            _studyPlanInFlight = false;
            if (err || !data || !data.plan) {
              regenBtn.disabled = false;
              regenBtn.innerHTML = 'Regenerate ↺';
              return;
            }
            _setStudyPlanCache(examDate, examName, dailyMins, data.plan);
            showResult(data.plan, examName, examDate, dailyMins);
          });
        });
      }
    }

    function _bindFormHandlers(formContainer) {
      var examSelect = formContainer.querySelector('#spExamSelect');
      var examCustom = formContainer.querySelector('#spExamCustom');
      var examDateInput = formContainer.querySelector('#spExamDate');
      var dailyTimeInput = formContainer.querySelector('#spDailyTime');
      var dailyTimeVal = formContainer.querySelector('#spDailyTimeVal');
      var generateBtn = formContainer.querySelector('#spGenerateBtn');
      var errorEl = formContainer.querySelector('#spError');

      examSelect.addEventListener('change', function () {
        if (this.value === 'Other') {
          examCustom.style.display = 'block';
          examCustom.focus();
        } else {
          examCustom.style.display = 'none';
          examCustom.value = '';
        }
      });

      dailyTimeInput.addEventListener('input', function () {
        dailyTimeVal.textContent = this.value;
      });

      generateBtn.addEventListener('click', function () {
        if (_studyPlanInFlight) return;

        var examName = examSelect.value === 'Other'
          ? examCustom.value.trim()
          : examSelect.value;
        var examDate = examDateInput.value;
        var dailyMins = parseInt(dailyTimeInput.value, 10);

        errorEl.style.display = 'none';

        if (!examName) {
          errorEl.textContent = 'Please enter an exam name.';
          errorEl.style.display = 'block';
          if (examSelect.value === 'Other') examCustom.focus();
          return;
        }
        if (!examDate) {
          errorEl.textContent = 'Please select your exam date.';
          errorEl.style.display = 'block';
          examDateInput.focus();
          return;
        }
        var examMs = new Date(examDate).getTime();
        var daysRemaining = Math.ceil((examMs - Date.now()) / (1000 * 60 * 60 * 24));
        if (daysRemaining < 1) {
          errorEl.textContent = 'Exam date must be in the future.';
          errorEl.style.display = 'block';
          examDateInput.focus();
          return;
        }
        if (!dailyMins || dailyMins < 15) {
          errorEl.textContent = 'Please set a daily study time of at least 15 minutes.';
          errorEl.style.display = 'block';
          return;
        }

        var cached = _getStudyPlanCache(examDate);
        if (cached && cached.examName === examName && cached.dailyTimeMinutes === dailyMins && cached.plan) {
          showResult(cached.plan, examName, examDate, dailyMins);
          return;
        }

        _studyPlanInFlight = true;
        generateBtn.disabled = true;
        generateBtn.innerHTML = '<div class="ai-spinner-inline"></div> Generating...';

        var progress = typeof loadProgress === 'function' ? loadProgress() : {};
        var statsPayload = {
          totalAttempted: progress.totalAttempted || 0,
          totalCorrect: progress.totalCorrect || 0,
          categoryStats: progress.categoryStats || {}
        };

        _sendAuthenticatedRequest('POST', '/api/ai/study-plan', {
          examName: examName,
          examDate: examDate,
          dailyTimeMinutes: dailyMins,
          stats: statsPayload
        }, 45000, function (err, data) {
          _studyPlanInFlight = false;
          generateBtn.disabled = false;
          generateBtn.innerHTML = 'Generate Plan ✨';

          if (err === 'premium_required') {
            closeModal();
            if (typeof showPaywall === 'function') showPaywall('settings');
            return;
          }
          if (err) {
            errorEl.textContent = 'Unable to generate plan right now. Please try again.';
            errorEl.style.display = 'block';
            return;
          }
          if (!data || !data.plan) {
            errorEl.textContent = 'Received an invalid response. Please try again.';
            errorEl.style.display = 'block';
            return;
          }
          _setStudyPlanCache(examDate, examName, dailyMins, data.plan);
          showResult(data.plan, examName, examDate, dailyMins);
          if (typeof AIFeatures !== 'undefined' && containerId) {
            var cont = document.getElementById(containerId);
            if (cont) renderStudyPlanCard(containerId);
          }
        });
      });
    }

    overlay.querySelector('.sp-close-btn').addEventListener('click', closeModal);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeModal();
    });

    var initialForm = overlay.querySelector('#spForm');
    _bindFormHandlers(initialForm);

    var lastUsed = _getLastUsed();
    if (lastUsed && lastUsed.examDate && lastUsed.examName && lastUsed.dailyTimeMinutes) {
      var lastCached = _getStudyPlanCache(lastUsed.examDate);
      if (lastCached && lastCached.examName === lastUsed.examName && lastCached.dailyTimeMinutes === lastUsed.dailyTimeMinutes && lastCached.plan) {
        showResult(lastCached.plan, lastCached.examName, lastUsed.examDate, lastUsed.dailyTimeMinutes);
      }
    }
  }

  function renderStudyPlanCard(containerId) {
    var container = document.getElementById(containerId);
    if (!container) return;

    if (!_isPremium()) {
      container.innerHTML =
        '<div class="card sp-card sp-card-locked">' +
          '<h3>📅 Your Study Plan</h3>' +
          '<p class="secondary-text">Get a personalized AI study plan tailored to your exam and timeline.</p>' +
          '<button class="btn accent sp-unlock-btn" type="button">🔒 Unlock with Premium</button>' +
        '</div>';
      container.querySelector('.sp-unlock-btn').addEventListener('click', function () {
        if (typeof showPaywall === 'function') showPaywall('settings');
      });
      return;
    }

    container.innerHTML =
      '<div class="card sp-card">' +
        '<h3>📅 Your Study Plan</h3>' +
        '<p class="secondary-text">AI-personalized prep plan based on your exam date and weak topics.</p>' +
        '<button class="btn accent sp-open-btn" type="button">Generate Plan ✨</button>' +
      '</div>';

    container.querySelector('.sp-open-btn').addEventListener('click', function () {
      _openStudyPlanModal(containerId);
    });
  }

  return {
    getWordProblemQuota: getWordProblemQuota,
    consumeWordProblemQuota: consumeWordProblemQuota,
    fetchWordProblems: fetchWordProblems,
    fetchExplanation: fetchExplanation,
    fetchInsights: fetchInsights,
    showExplanationModal: showExplanationModal,
    renderAICoachCard: renderAICoachCard,
    renderStudyPlanCard: renderStudyPlanCard,
    renderStudyPlanModal: _openStudyPlanModal,
    renderWordProblemsSetup: renderWordProblemsSetup,
    isPremium: _isPremium,
    getCachedInsights: _getCachedCoach,
    triggerInsightsFetch: _triggerInsightsFetch,
    renderInsightsResult: _renderInsightsResult
  };
})();
