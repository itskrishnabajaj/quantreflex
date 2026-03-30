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

  var _insightsDebounceTimer = null;
  function _debouncedFetchInsights(stats, callback) {
    if (_insightsDebounceTimer) clearTimeout(_insightsDebounceTimer);
    _insightsDebounceTimer = setTimeout(function () {
      _insightsDebounceTimer = null;
      fetchInsights(stats, callback);
    }, 500);
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

    container.innerHTML =
      '<div class="card ai-coach-card">' +
        '<h3>🤖 AI Coach</h3>' +
        '<div class="ai-coach-body">' +
          '<div class="ai-loading"><div class="ai-spinner"></div><p>Analyzing your performance...</p></div>' +
        '</div>' +
      '</div>';

    if (!stats || !stats.totalAttempted || stats.totalAttempted < 5) {
      container.querySelector('.ai-coach-body').innerHTML =
        '<p class="secondary-text">Complete at least 5 questions to get your first AI insight.</p>';
      return;
    }

    _debouncedFetchInsights(stats, function (err, insights) {
      var body = container.querySelector('.ai-coach-body');
      if (!body) return;

      if (err) {
        body.innerHTML = '<p class="ai-error">Unable to generate right now. Try again later.</p>';
        return;
      }

      body.innerHTML =
        '<div class="ai-insight-block">' +
          '<p class="ai-insight-text">' + _esc(insights.insight) + '</p>' +
        '</div>' +
        (insights.problem ? '<div class="ai-insight-block ai-insight-problem"><strong>Focus area:</strong> ' + _esc(insights.problem) + '</div>' : '') +
        (insights.action ? '<div class="ai-insight-block ai-insight-action"><strong>Today\'s action:</strong> ' + _esc(insights.action) + '</div>' : '');
    });
  }

  function renderWordProblemsSetup(container, onStart) {
    var quota = getWordProblemQuota();
    var quotaText = quota.type === 'lifetime'
      ? quota.remaining + '/' + quota.limit + ' free AI questions remaining'
      : quota.remaining + '/' + quota.limit + ' daily AI questions remaining';

    container.innerHTML =
      '<div class="training-card">' +
        '<h3 class="category-select-title">🤖 Word Problems</h3>' +
        '<div class="training-card-body">' +
          '<p class="ai-quota-text">' + quotaText + '</p>' +
          '<div class="ai-wp-config">' +
            '<label class="secondary-text">Category</label>' +
            '<select id="wpCategorySelect" class="theme-select ai-wp-select">' +
              '<option value="percentages">Percentages</option>' +
              '<option value="profit-loss">Profit & Loss</option>' +
              '<option value="ratios">Ratios & Proportions</option>' +
              '<option value="time-speed-distance">Time, Speed & Distance</option>' +
              '<option value="time-and-work">Time & Work</option>' +
              '<option value="averages">Averages</option>' +
              '<option value="fractions">Fractions</option>' +
              '<option value="area">Area</option>' +
              '<option value="volume">Volume</option>' +
            '</select>' +
            '<label class="secondary-text" style="margin-top:.75rem;">Difficulty</label>' +
            '<select id="wpDifficultySelect" class="theme-select ai-wp-select">' +
              '<option value="easy">Easy</option>' +
              '<option value="medium" selected>Medium</option>' +
              '<option value="hard">Hard</option>' +
            '</select>' +
            '<label class="secondary-text" style="margin-top:.75rem;">Number of Questions</label>' +
            '<select id="wpCountSelect" class="theme-select ai-wp-select">' +
              '<option value="3">3 questions</option>' +
              '<option value="5" selected>5 questions</option>' +
              '<option value="10">10 questions</option>' +
            '</select>' +
          '</div>' +
          '<button class="btn accent custom-practice-start-btn" id="startWordProblems" type="button">Generate Word Problems</button>' +
          '<div id="wpError" class="custom-mode-error secondary-text"></div>' +
        '</div>' +
        '<button class="training-card-back" id="wpBackToModes" type="button" aria-label="Back to practice modes">← Back</button>' +
      '</div>';

    var startBtn = container.querySelector('#startWordProblems');
    var backBtn = container.querySelector('#wpBackToModes');
    var errorEl = container.querySelector('#wpError');

    if (quota.remaining <= 0) {
      startBtn.disabled = true;
      startBtn.textContent = quota.type === 'lifetime' ? '🔒 Free limit reached' : 'Daily limit reached';
      if (quota.type === 'lifetime') {
        errorEl.textContent = 'Upgrade to Premium for 25 AI questions per day.';
        errorEl.style.display = 'block';
      }
    }

    startBtn.addEventListener('click', function () {
      var cat = document.getElementById('wpCategorySelect').value;
      var diff = document.getElementById('wpDifficultySelect').value;
      var cnt = parseInt(document.getElementById('wpCountSelect').value);

      startBtn.disabled = true;
      startBtn.innerHTML = '<div class="ai-spinner-inline"></div> Generating...';
      errorEl.textContent = '';

      fetchWordProblems(cat, diff, cnt, function (err, questions) {
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
        if (onStart) onStart(questions, cat, diff);
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

  return {
    getWordProblemQuota: getWordProblemQuota,
    consumeWordProblemQuota: consumeWordProblemQuota,
    fetchWordProblems: fetchWordProblems,
    fetchExplanation: fetchExplanation,
    fetchInsights: fetchInsights,
    showExplanationModal: showExplanationModal,
    renderAICoachCard: renderAICoachCard,
    renderWordProblemsSetup: renderWordProblemsSetup,
    isPremium: _isPremium,
    debouncedFetchInsights: _debouncedFetchInsights
  };
})();
