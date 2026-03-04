/**
 * progress.js — localStorage-based progress tracking
 *
 * Stores:
 *   totalAttempted, totalCorrect, bestStreak, currentStreak,
 *   drillSessions, timedTestSessions, dailyStreak,
 *   lastPracticeDate, todayAttempted, todayCorrect,
 *   categoryStats (per-category attempted/correct),
 *   mistakes (wrong questions log),
 *   responseTimes (array of per-question times),
 *   dailyHistory (date → {attempted, correct})
 */

var PROGRESS_KEY = 'quant_reflex_progress';

/** Return saved progress or defaults */
function loadProgress() {
  try {
    var raw = localStorage.getItem(PROGRESS_KEY);
    if (raw) {
      var data = JSON.parse(raw);
      /* Check if date has changed — reset today counters */
      var today = new Date().toDateString();
      if (data.lastActiveDate !== today) {
        /* Check daily streak continuity */
        if (data.lastActiveDate) {
          var last = new Date(data.lastActiveDate);
          var now = new Date(today);
          var diffDays = Math.round((now - last) / (1000 * 60 * 60 * 24));
          if (diffDays > 1) {
            data.dailyStreak = 0; /* streak broken */
          }
        }
        data.todayAttempted = 0;
        data.todayCorrect = 0;
        data.lastActiveDate = today;
        saveProgress(data);
      }
      /* Ensure required fields exist */
      if (!data.categoryStats) data.categoryStats = {};
      if (!data.mistakes) data.mistakes = [];
      if (!data.responseTimes) data.responseTimes = [];
      if (!data.dailyHistory) data.dailyHistory = {};
      return data;
    }
  } catch (_) {
    /* ignore parse errors */
  }
  return {
    totalAttempted: 0, totalCorrect: 0,
    bestStreak: 0, currentStreak: 0,
    drillSessions: 0, timedTestSessions: 0,
    dailyStreak: 0, lastActiveDate: null,
    lastPracticeDate: null,
    todayAttempted: 0, todayCorrect: 0,
    categoryStats: {},
    mistakes: [],
    responseTimes: [],
    dailyHistory: {}
  };
}

/** Persist progress to localStorage */
function saveProgress(data) {
  localStorage.setItem(PROGRESS_KEY, JSON.stringify(data));
}

/**
 * Record the result of a single answer.
 * @param {boolean} correct
 * @param {string}  [category] - optional question category for tracking
 * @param {object}  [questionData] - optional {question, answer, category} for mistake tracking
 * @param {number}  [responseTime] - optional response time in seconds
 */
function recordAnswer(correct, category, questionData, responseTime) {
  var p = loadProgress();
  var today = new Date().toDateString();

  /* Daily streak: increment on first practice of a new day */
  if (p.lastPracticeDate !== today) {
    p.dailyStreak = (p.dailyStreak || 0) + 1;
    p.lastPracticeDate = today;
  }

  p.lastActiveDate = today;
  p.totalAttempted++;
  p.todayAttempted = (p.todayAttempted || 0) + 1;

  if (correct) {
    p.totalCorrect++;
    p.todayCorrect = (p.todayCorrect || 0) + 1;
    p.currentStreak++;
    if (p.currentStreak > p.bestStreak) p.bestStreak = p.currentStreak;
  } else {
    p.currentStreak = 0;
    /* Track mistake */
    if (questionData) {
      if (!p.mistakes) p.mistakes = [];
      /* Keep max 100 mistakes to avoid localStorage bloat */
      if (p.mistakes.length >= 100) p.mistakes.shift();
      p.mistakes.push({
        question: questionData.question,
        answer: String(questionData.answer),
        category: questionData.category || category,
        date: today
      });
    }
  }

  /* Track response time */
  if (typeof responseTime === 'number') {
    if (!p.responseTimes) p.responseTimes = [];
    /* Keep last 200 response times */
    if (p.responseTimes.length >= 200) p.responseTimes.shift();
    p.responseTimes.push(responseTime);
  }

  /* Category tracking */
  if (category) {
    if (!p.categoryStats) p.categoryStats = {};
    if (!p.categoryStats[category]) {
      p.categoryStats[category] = { attempted: 0, correct: 0 };
    }
    p.categoryStats[category].attempted++;
    if (correct) p.categoryStats[category].correct++;
  }

  /* Daily history tracking */
  if (!p.dailyHistory) p.dailyHistory = {};
  if (!p.dailyHistory[today]) {
    p.dailyHistory[today] = { attempted: 0, correct: 0 };
  }
  p.dailyHistory[today].attempted++;
  if (correct) p.dailyHistory[today].correct++;

  saveProgress(p);
}

/** Record completion of a drill session */
function recordDrillSession() {
  var p = loadProgress();
  p.drillSessions = (p.drillSessions || 0) + 1;
  saveProgress(p);
}

/** Record completion of a timed test session */
function recordTimedTestSession() {
  var p = loadProgress();
  p.timedTestSessions = (p.timedTestSessions || 0) + 1;
  saveProgress(p);
}

/** Get stored mistakes for review mode */
function getMistakes() {
  var p = loadProgress();
  return p.mistakes || [];
}

/** Clear reviewed mistakes */
function clearMistakes() {
  var p = loadProgress();
  p.mistakes = [];
  saveProgress(p);
}

/** Get average response time */
function getAvgResponseTime() {
  var p = loadProgress();
  var times = p.responseTimes || [];
  if (times.length === 0) return 0;
  var sum = 0;
  for (var i = 0; i < times.length; i++) sum += times[i];
  return (sum / times.length).toFixed(1);
}

/** Get weakest category (lowest accuracy with at least 3 attempts) */
function getWeakestCategory() {
  var p = loadProgress();
  var cats = p.categoryStats || {};
  var keys = Object.keys(cats);
  var worst = null;
  var worstAcc = 101;
  for (var i = 0; i < keys.length; i++) {
    var c = cats[keys[i]];
    if (c.attempted >= 3) {
      var acc = (c.correct / c.attempted) * 100;
      if (acc < worstAcc) {
        worstAcc = acc;
        worst = keys[i];
      }
    }
  }
  return worst;
}

/** Get strongest category (highest accuracy with at least 3 attempts) */
function getStrongestCategory() {
  var p = loadProgress();
  var cats = p.categoryStats || {};
  var keys = Object.keys(cats);
  var best = null;
  var bestAcc = -1;
  for (var i = 0; i < keys.length; i++) {
    var c = cats[keys[i]];
    if (c.attempted >= 3) {
      var acc = (c.correct / c.attempted) * 100;
      if (acc > bestAcc) {
        bestAcc = acc;
        best = keys[i];
      }
    }
  }
  return best;
}

/** Get longest daily streak from history */
function getLongestDailyStreak() {
  var p = loadProgress();
  return p.bestDailyStreak || p.dailyStreak || 0;
}

/** Reset all progress */
function resetProgress() {
  saveProgress({
    totalAttempted: 0, totalCorrect: 0,
    bestStreak: 0, currentStreak: 0,
    drillSessions: 0, timedTestSessions: 0,
    dailyStreak: 0, lastActiveDate: null,
    lastPracticeDate: null,
    todayAttempted: 0, todayCorrect: 0,
    categoryStats: {},
    mistakes: [],
    responseTimes: [],
    dailyHistory: {}
  });
}
