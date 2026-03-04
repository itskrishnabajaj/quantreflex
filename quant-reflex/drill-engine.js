/**
 * drill-engine.js — Core drill / test engine
 *
 * Manages: question display, answer checking, per-question timer,
 *          scoring, and results summary.
 *
 * Usage (from drill.html or test.html):
 *   const engine = createDrillEngine(container, { count, timeLimitSec });
 *   engine.start();
 */

/**
 * Create a drill engine bound to the given container element.
 *
 * @param {HTMLElement} container  - wrapper element on the page
 * @param {object}      opts
 * @param {number}      opts.count         - number of questions (default 10)
 * @param {number|null} opts.timeLimitSec  - overall time limit in seconds (null = unlimited)
 * @returns {object} engine with .start() method
 */
function createDrillEngine(container, opts) {
  const count = opts.count || 10;
  const timeLimit = opts.timeLimitSec || null;

  let questions = [];
  let current = 0;
  let score = 0;
  let perQuestionTimes = [];
  let qStart = 0;
  let overallStart = 0;
  let overallTimer = null;

  /* ---- render helpers ---- */

  function renderStart() {
    container.innerHTML = `
      <div class="card center-content">
        <h2>Ready?</h2>
        <p>${count} questions${timeLimit ? ' · ' + timeLimit + 's time limit' : ''}</p>
        <button id="startBtn" class="btn accent">START DRILL</button>
      </div>`;
    container.querySelector('#startBtn').addEventListener('click', begin);
  }

  function renderQuestion() {
    const q = questions[current];
    container.innerHTML = `
      <div class="card center-content">
        <p class="drill-progress">Question ${current + 1} / ${count}</p>
        ${timeLimit ? '<p id="globalTimer" class="timer"></p>' : ''}
        <h2 class="question-text">${q.question}</h2>
        <input id="answerInput" class="input" type="text" inputmode="decimal" autocomplete="off" placeholder="Your answer" />
        <div id="feedback" class="feedback"></div>
        <button id="submitBtn" class="btn accent">Submit</button>
      </div>`;

    const input = container.querySelector('#answerInput');
    const submitBtn = container.querySelector('#submitBtn');
    input.focus();

    function submit() {
      checkAnswer(input.value.trim());
    }
    submitBtn.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });

    qStart = performance.now();
  }

  function checkAnswer(raw) {
    const elapsed = ((performance.now() - qStart) / 1000).toFixed(1);
    perQuestionTimes.push(parseFloat(elapsed));

    const q = questions[current];
    const expected = String(q.answer);
    const correct = raw === expected;

    if (correct) score++;
    recordAnswer(correct); // progress.js

    const feedback = container.querySelector('#feedback');
    feedback.textContent = correct ? '✓ Correct!' : `✗ Answer: ${expected}`;
    feedback.className = 'feedback ' + (correct ? 'correct' : 'wrong');

    /* Replace submit with next */
    const submitBtn = container.querySelector('#submitBtn');
    submitBtn.textContent = current + 1 < count ? 'Next →' : 'See Results';
    submitBtn.onclick = nextQuestion;
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
    if (overallTimer) clearInterval(overallTimer);
    const totalTime = ((performance.now() - overallStart) / 1000).toFixed(1);
    const avg = (perQuestionTimes.reduce((a, b) => a + b, 0) / perQuestionTimes.length).toFixed(1);
    const accuracy = ((score / count) * 100).toFixed(0);

    container.innerHTML = `
      <div class="card center-content">
        <h2>Results</h2>
        <div class="results-grid">
          <div class="result-item"><span class="result-value">${score}/${count}</span><span class="result-label">Score</span></div>
          <div class="result-item"><span class="result-value">${accuracy}%</span><span class="result-label">Accuracy</span></div>
          <div class="result-item"><span class="result-value">${avg}s</span><span class="result-label">Avg Time</span></div>
          <div class="result-item"><span class="result-value">${totalTime}s</span><span class="result-label">Total Time</span></div>
        </div>
        <a href="drill.html" class="btn accent">Try Again</a>
        <a href="index.html" class="btn">Home</a>
      </div>`;
  }

  /* ---- global timer (for timed tests) ---- */

  function startGlobalTimer() {
    if (!timeLimit) return;
    let remaining = timeLimit;
    function tick() {
      const el = document.getElementById('globalTimer');
      if (el) el.textContent = `⏱ ${remaining}s`;
      if (remaining <= 0) { finish(); return; }
      remaining--;
    }
    tick();
    overallTimer = setInterval(tick, 1000);
  }

  /* ---- begin drill ---- */

  function begin() {
    questions = generateQuestions(count); // questions.js
    current = 0;
    score = 0;
    perQuestionTimes = [];
    overallStart = performance.now();
    startGlobalTimer();
    renderQuestion();
  }

  /* ---- public API ---- */
  return { start: renderStart };
}
