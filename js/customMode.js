var CustomMode = (function () {
  var selectedTopics = [];
  var selectedNumber = 20;
  var TOPICS = [
    { key: 'squares', label: 'Squares' },
    { key: 'cubes', label: 'Cubes' },
    { key: 'fractions', label: 'Fractions' },
    { key: 'percentages', label: 'Percentages' },
    { key: 'multiplication', label: 'Multiplication' },
    { key: 'ratios', label: 'Ratios' },
    { key: 'averages', label: 'Averages' },
    { key: 'profit-loss', label: 'Profit & Loss' },
    { key: 'time-speed-distance', label: 'Time Speed Dist' },
    { key: 'time-and-work', label: 'Time & Work' }
  ];

  function canAccessCustomMode(user) {
    return true;
  }

  function getConfig() {
    return {
      topics: selectedTopics.slice(),
      totalQuestions: selectedNumber,
      mode: 'custom'
    };
  }

  function setError(message) {
    var el = document.getElementById('customModeError');
    if (el) el.textContent = message || '';
  }

  function updateCountUI() {
    var valueEl = document.getElementById('customQuestionCountValue');
    var textEl = document.getElementById('customQuestionCountText');
    if (valueEl) valueEl.textContent = String(selectedNumber);
    if (textEl) textEl.textContent = 'You will solve ' + selectedNumber + ' questions';
  }

  function toggleTopic(topicKey) {
    var idx = selectedTopics.indexOf(topicKey);
    if (idx === -1) selectedTopics.push(topicKey);
    else selectedTopics.splice(idx, 1);
  }

  function renderTopics() {
    var grid = document.getElementById('customTopicGrid');
    if (!grid) return;
    grid.innerHTML = '';

    for (var i = 0; i < TOPICS.length; i++) {
      (function (topic) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'custom-topic-card';
        btn.setAttribute('data-topic', topic.key);
        btn.setAttribute('aria-pressed', 'false');
        btn.innerHTML = '<span>' + topic.label + '</span><span class="custom-topic-check">✓</span>';

        btn.addEventListener('click', function () {
          toggleTopic(topic.key);
          setError('');
          syncTopicSelectionUI();
        });

        grid.appendChild(btn);
      })(TOPICS[i]);
    }
    syncTopicSelectionUI();
  }

  function syncTopicSelectionUI() {
    var cards = document.querySelectorAll('.custom-topic-card');
    for (var i = 0; i < cards.length; i++) {
      var key = cards[i].getAttribute('data-topic');
      var selected = selectedTopics.indexOf(key) !== -1;
      cards[i].classList.toggle('selected', selected);
      cards[i].setAttribute('aria-pressed', selected ? 'true' : 'false');
    }
  }

  function showPanel() {
    var modeSelect = document.getElementById('modeSelect');
    var categorySelect = document.getElementById('categorySelect');
    var panel = document.getElementById('customModePanel');
    if (modeSelect) modeSelect.style.display = 'none';
    if (categorySelect) categorySelect.style.display = 'none';
    if (panel) panel.style.display = 'block';
  }

  function hidePanel() {
    var panel = document.getElementById('customModePanel');
    var modeSelect = document.getElementById('modeSelect');
    if (panel) panel.style.display = 'none';
    if (modeSelect) modeSelect.style.display = 'block';
  }

  function reset() {
    selectedTopics = [];
    selectedNumber = 20;
    var slider = document.getElementById('customQuestionCount');
    if (slider) slider.value = String(selectedNumber);
    updateCountUI();
    setError('');
    syncTopicSelectionUI();
  }

  function init() {
    renderTopics();
    updateCountUI();

    var slider = document.getElementById('customQuestionCount');
    var backBtn = document.getElementById('backToModesFromCustom');
    var startBtn = document.getElementById('startCustomSessionBtn');

    if (slider) {
      slider.addEventListener('input', function () {
        var val = parseInt(slider.value, 10);
        if (isNaN(val)) val = 20;
        selectedNumber = Math.max(1, Math.min(100, val));
        updateCountUI();
      });
    }

    if (backBtn) {
      backBtn.addEventListener('click', function () {
        hidePanel();
      });
    }

    if (startBtn) {
      startBtn.addEventListener('click', function () {
        var user = (typeof Auth !== 'undefined' && typeof Auth.getCurrentUser === 'function') ? Auth.getCurrentUser() : null;
        if (!canAccessCustomMode(user)) {
          return;
        }
        if (selectedTopics.length === 0) {
          setError('Please select at least one topic');
          return;
        }
        setError('');
        if (typeof startCustomDrillFromPractice === 'function') {
          startCustomDrillFromPractice(getConfig());
        }
      });
    }
  }

  return {
    init: init,
    showPanel: showPanel,
    hidePanel: hidePanel,
    reset: reset,
    getConfig: getConfig,
    canAccessCustomMode: canAccessCustomMode
  };
})();
