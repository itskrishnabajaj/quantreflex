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
      /* Sanitize numeric fields — protect against NaN/undefined corruption */
      data.totalAttempted = parseInt(data.totalAttempted) || 0;
      data.totalCorrect = parseInt(data.totalCorrect) || 0;
      data.bestStreak = parseInt(data.bestStreak) || 0;
      data.currentStreak = parseInt(data.currentStreak) || 0;
      data.drillSessions = parseInt(data.drillSessions) || 0;
      data.timedTestSessions = parseInt(data.timedTestSessions) || 0;
      data.dailyStreak = parseInt(data.dailyStreak) || 0;
      data.bestDailyStreak = parseInt(data.bestDailyStreak) || 0;
      data.todayAttempted = parseInt(data.todayAttempted) || 0;
      data.todayCorrect = parseInt(data.todayCorrect) || 0;
      return data;
    }
  } catch (_) {
    /* ignore parse errors */
  }
  return {
    totalAttempted: 0, totalCorrect: 0,
    bestStreak: 0, currentStreak: 0,
    drillSessions: 0, timedTestSessions: 0,
    dailyStreak: 0, bestDailyStreak: 0,
    lastActiveDate: null,
    lastPracticeDate: null,
    todayAttempted: 0, todayCorrect: 0,
    categoryStats: {},
    mistakes: [],
    responseTimes: [],
    dailyHistory: {}
  };
}

/** Persist progress to localStorage and sync to Firestore */
function saveProgress(data) {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(data));
    if (typeof FirestoreSync !== 'undefined') {
      FirestoreSync.syncStats(data);
    }
  } catch (e) {
    console.warn('Failed to save progress:', e);
  }
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
    /* Track best daily streak ever achieved */
    if (p.dailyStreak > (p.bestDailyStreak || 0)) {
      p.bestDailyStreak = p.dailyStreak;
    }
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

  /* Cap dailyHistory to last 90 days to prevent unbounded storage growth */
  var histKeys = Object.keys(p.dailyHistory);
  if (histKeys.length > 90) {
    histKeys.sort();
    var toRemove = histKeys.slice(0, histKeys.length - 90);
    for (var h = 0; h < toRemove.length; h++) {
      delete p.dailyHistory[toRemove[h]];
    }
  }

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

/** Get average response time */
function getAvgResponseTime() {
  var p = loadProgress();
  var times = p.responseTimes || [];
  if (times.length === 0) return 0;
  var sum = 0;
  for (var i = 0; i < times.length; i++) sum += times[i];
  return (sum / times.length).toFixed(1);
}

/** Categories that are not valid for analytics (e.g. from legacy data) */
var _INVALID_CATEGORIES = { onboarding: true };

/** Check if a category name is valid for analytics display */
function isValidCategory(cat) {
  return !_INVALID_CATEGORIES[cat];
}

/** Get weakest category (lowest accuracy with at least 10 attempts) */
function getWeakestCategory() {
  var p = loadProgress();
  var cats = p.categoryStats || {};
  var keys = Object.keys(cats);
  var worst = null;
  var worstAcc = 101;
  for (var i = 0; i < keys.length; i++) {
    if (_INVALID_CATEGORIES[keys[i]]) continue;
    var c = cats[keys[i]];
    var attempted = parseInt(c.attempted) || 0;
    var correct = parseInt(c.correct) || 0;
    if (attempted >= 10) {
      var acc = (correct / attempted) * 100;
      if (!isNaN(acc) && acc < worstAcc) {
        worstAcc = acc;
        worst = keys[i];
      }
    }
  }
  return worst;
}

/** Get strongest category (highest accuracy with at least 10 attempts) */
function getStrongestCategory() {
  var p = loadProgress();
  var cats = p.categoryStats || {};
  var keys = Object.keys(cats);
  var best = null;
  var bestAcc = -1;
  for (var i = 0; i < keys.length; i++) {
    if (_INVALID_CATEGORIES[keys[i]]) continue;
    var c = cats[keys[i]];
    var attempted = parseInt(c.attempted) || 0;
    var correct = parseInt(c.correct) || 0;
    if (attempted >= 10) {
      var acc = (correct / attempted) * 100;
      if (!isNaN(acc) && acc > bestAcc) {
        bestAcc = acc;
        best = keys[i];
      }
    }
  }
  return best;
}

/** Reset all progress */
function resetProgress() {
  saveProgress({
    totalAttempted: 0, totalCorrect: 0,
    bestStreak: 0, currentStreak: 0,
    drillSessions: 0, timedTestSessions: 0,
    dailyStreak: 0, bestDailyStreak: 0,
    lastActiveDate: null,
    lastPracticeDate: null,
    todayAttempted: 0, todayCorrect: 0,
    categoryStats: {},
    mistakes: [],
    responseTimes: [],
    dailyHistory: {}
  });
}
