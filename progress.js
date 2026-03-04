/**
 * progress.js — localStorage-based progress tracking
 *
 * Stores:
 *   totalAttempted, totalCorrect, bestStreak, currentStreak, drillSessions
 */

const PROGRESS_KEY = 'quant_reflex_progress';

/** Return saved progress or defaults */
function loadProgress() {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_) {
    /* ignore parse errors */
  }
  return { totalAttempted: 0, totalCorrect: 0, bestStreak: 0, currentStreak: 0, drillSessions: 0 };
}

/** Persist progress to localStorage */
function saveProgress(data) {
  localStorage.setItem(PROGRESS_KEY, JSON.stringify(data));
}

/**
 * Record the result of a single answer.
 * @param {boolean} correct
 */
function recordAnswer(correct) {
  const p = loadProgress();
  p.totalAttempted++;
  if (correct) {
    p.totalCorrect++;
    p.currentStreak++;
    if (p.currentStreak > p.bestStreak) p.bestStreak = p.currentStreak;
  } else {
    p.currentStreak = 0;
  }
  saveProgress(p);
}

/** Record completion of a drill session */
function recordDrillSession() {
  const p = loadProgress();
  p.drillSessions = (p.drillSessions || 0) + 1;
  saveProgress(p);
}

/** Reset all progress */
function resetProgress() {
  saveProgress({ totalAttempted: 0, totalCorrect: 0, bestStreak: 0, currentStreak: 0, drillSessions: 0 });
}
