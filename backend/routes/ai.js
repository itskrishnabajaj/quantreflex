/**
 * ai.js — AI API routes for QuantReflex.
 * POST /api/ai/word-problems
 * POST /api/ai/explain
 * POST /api/ai/insights      (alias: /api/ai/coach)
 * POST /api/ai/study-plan    (alias: /api/ai/plan)
 */

const express = require('express');
const router = express.Router();
const { authMiddleware, rateLimitMiddleware, premiumGate, formatError } = require('../middleware/auth');
const firestore = require('../services/firebaseAdmin');
const openai = require('../services/openai');

var VALID_CATEGORIES = ['squares', 'cubes', 'area', 'volume', 'percentages', 'multiplication', 'fractions', 'averages', 'ratios', 'profit-loss', 'time-speed-distance', 'time-and-work'];
var MAX_QUESTION_INPUT_LENGTH = 500;

/* ------------------------------------------------------------------ */
/*  Word Problems                                                     */
/* ------------------------------------------------------------------ */

router.post('/word-problems', authMiddleware, rateLimitMiddleware, premiumGate('ai_word_problems'), async function (req, res) {
  try {
    var remaining = await firestore.checkWordProblemQuota(req.userId, req.userPremium);
    if (remaining <= 0) {
      var msg = req.userPremium ? 'Daily word problem limit reached. Come back tomorrow.' : 'Free word problem limit reached. Upgrade to Premium for more.';
      return res.status(429).json({ error: { code: 'QUOTA_EXCEEDED', message: msg, retryable: false } });
    }
    var body = req.body;
    var category = body.category;
    var difficulty = body.difficulty;
    var count = body.count;
    if (!category || !difficulty || !count) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Missing required fields: category, difficulty, count', retryable: false } });
    }
    if (VALID_CATEGORIES.indexOf(category) === -1) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invalid category.', retryable: false } });
    }
    var validDifficulties = ['easy', 'medium', 'hard'];
    if (validDifficulties.indexOf(difficulty) === -1) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invalid difficulty. Must be easy, medium, or hard.', retryable: false } });
    }
    var clampedCount = Math.min(Math.max(parseInt(count) || 5, 1), 25);
    clampedCount = Math.min(clampedCount, remaining);

    /* Check Firestore cache first */
    var db = firestore.db;
    var cacheRef = db.collection('wordProblems');
    var questions = null;

    try {
      var cached = await cacheRef
        .where('category', '==', category)
        .where('difficulty', '==', difficulty)
        .orderBy('usageCount', 'asc')
        .limit(clampedCount * 2)
        .get();

      if (!cached.empty && cached.docs.length >= clampedCount) {
        var pool = cached.docs.map(function (d) { return Object.assign({ _docId: d.id }, d.data()); });
        firestore._shuffleInPlace(pool);
        var selected = pool.slice(0, clampedCount);
        var batch = db.batch();
        selected.forEach(function (item) {
          batch.update(cacheRef.doc(item._docId), { usageCount: (item.usageCount || 0) + 1, lastUsed: firestore.admin.firestore.FieldValue.serverTimestamp() });
        });
        batch.commit().catch(function (e) { console.warn('[ai:word-problems] usageCount batch update failed:', e.message); });
        questions = selected.map(function (item) {
          return { question: item.question, answer: item.answer, steps: item.steps || '', category: item.category };
        });
      }
    } catch (cacheErr) {
      console.warn('Firestore cache read failed, generating fresh:', cacheErr.message);
    }

    if (!questions) {
      /* Generate via OpenAI */
      var generated = await openai.generateWordProblems(category, difficulty, clampedCount);
      if (!generated) throw new firestore.AIServiceError('INVALID_RESPONSE', 'No valid questions generated after retries', true);

      /* Deduplicate and cache */
      var deduplicated = generated;
      try {
        var existingSnap = await cacheRef.where('category', '==', category).where('difficulty', '==', difficulty).limit(50).get();
        if (!existingSnap.empty) {
          var existingPrefixes = {};
          existingSnap.docs.forEach(function (d) { var q = d.data().question || ''; existingPrefixes[q.substring(0, 50).toLowerCase()] = true; });
          deduplicated = generated.filter(function (item) { return !existingPrefixes[item.question.substring(0, 50).toLowerCase()]; });
        }
      } catch (dedupErr) { console.warn('Dedup check failed, storing all:', dedupErr.message); }

      if (deduplicated.length > 0) {
        try {
          var writeBatch = db.batch();
          deduplicated.forEach(function (item) {
            var docRef = cacheRef.doc();
            writeBatch.set(docRef, {
              question: item.question, answer: item.answer, steps: item.steps || '',
              category: item.category || category, difficulty: difficulty,
              usageCount: 0, createdAt: firestore.admin.firestore.FieldValue.serverTimestamp()
            });
          });
          await writeBatch.commit();
        } catch (writeErr) { console.warn('Firestore cache write failed:', writeErr.message); }
      }
      questions = generated.slice(0, clampedCount);
    }

    await firestore.consumeWordProblemQuota(req.userId, req.userPremium, questions.length);
    res.json({ questions: questions, remaining: remaining - questions.length });
  } catch (err) {
    console.error('Word problems error:', err.message);
    res.status(500).json({ error: formatError(err) });
  }
});

/* ------------------------------------------------------------------ */
/*  Explain                                                           */
/* ------------------------------------------------------------------ */

router.post('/explain', authMiddleware, rateLimitMiddleware, premiumGate('ai_explain'), async function (req, res) {
  try {
    var body = req.body;
    var question = typeof body.question === 'string' ? body.question.substring(0, MAX_QUESTION_INPUT_LENGTH) : '';
    var answer = body.answer;
    var category = body.category;
    if (!question || answer === undefined) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Missing required fields: question, answer', retryable: false } });
    }
    var answerStr = String(answer).substring(0, 50);

    /* Check explanation cache */
    var db = firestore.db;
    var questionHash = firestore._hashString(question + ':' + answerStr);
    var cacheRef = db.collection('explanations');
    var explanation = null;

    try {
      var cached = await cacheRef.doc(questionHash).get();
      if (cached.exists) {
        var data = cached.data();
        cacheRef.doc(questionHash).update({ usageCount: (data.usageCount || 0) + 1 }).catch(function (e) { console.warn('[ai:explain] usageCount update failed:', e.message); });
        explanation = { concept: data.concept, steps: data.steps, mistake: data.mistake, tip: data.tip };
      }
    } catch (cacheErr) { console.warn('Firestore explain cache read failed:', cacheErr.message); }

    if (!explanation) {
      explanation = await openai.generateExplanation(question, answerStr, category);
      if (!explanation) throw new firestore.AIServiceError('INVALID_RESPONSE', 'Invalid explanation format after retries', true);

      try {
        await cacheRef.doc(questionHash).set({
          questionId: questionHash, question: question, answer: answerStr, category: category || '',
          concept: explanation.concept, steps: explanation.steps, mistake: explanation.mistake, tip: explanation.tip,
          usageCount: 1, createdAt: firestore.admin.firestore.FieldValue.serverTimestamp()
        });
      } catch (writeErr) { console.warn('Firestore explain cache write failed:', writeErr.message); }
    }

    try { await firestore.trackExplanationUsage(req.userId); }
    catch (e) { console.warn('[ai:explain] usage tracking failed (uid: ' + req.userId + '):', e.message); }

    res.json({ explanation: explanation });
  } catch (err) {
    console.error('Explanation error:', err.message);
    res.status(500).json({ error: formatError(err) });
  }
});

/* ------------------------------------------------------------------ */
/*  Insights (AI Coach)                                               */
/* ------------------------------------------------------------------ */

async function insightsHandler(req, res) {
  try {
    var rawStats = req.body.stats;
    if (!rawStats) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Missing required field: stats', retryable: false } });
    }
    var stats = {
      totalAttempted: parseInt(rawStats.totalAttempted) || 0,
      totalCorrect: parseInt(rawStats.totalCorrect) || 0,
      dailyStreak: parseInt(rawStats.dailyStreak) || 0,
      drillSessions: parseInt(rawStats.drillSessions) || 0,
      timedTestSessions: parseInt(rawStats.timedTestSessions) || 0,
      mistakes: Array.isArray(rawStats.mistakes) ? rawStats.mistakes.slice(0, 50) : [],
      responseTimes: Array.isArray(rawStats.responseTimes) ? rawStats.responseTimes.slice(0, 100).map(Number).filter(function (n) { return !isNaN(n); }) : [],
      categoryStats: {}
    };
    if (rawStats.categoryStats && typeof rawStats.categoryStats === 'object') {
      var catKeys = Object.keys(rawStats.categoryStats).slice(0, 20);
      catKeys.forEach(function (key) {
        var safeKey = String(key).substring(0, 50);
        var d = rawStats.categoryStats[key];
        if (d && typeof d === 'object') {
          stats.categoryStats[safeKey] = { attempted: parseInt(d.attempted) || 0, correct: parseInt(d.correct) || 0 };
        }
      });
    }

    /* Check daily cache */
    var db = firestore.db;
    var today = new Date();
    var dateKey = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();
    var cacheDocId = req.userId + '_' + dateKey;
    var cacheRef = db.collection('aiInsights');
    var insights = null;

    try {
      var cached = await cacheRef.doc(cacheDocId).get();
      if (cached.exists) {
        var data = cached.data();
        insights = { insight: data.insight, problem: data.problem, action: data.action };
      }
    } catch (cacheErr) { console.warn('Firestore insights cache read failed:', cacheErr.message); }

    if (!insights) {
      insights = await openai.generateInsights(stats);
      if (!insights) throw new firestore.AIServiceError('INVALID_RESPONSE', 'Invalid insights format after retries', true);

      try {
        await cacheRef.doc(cacheDocId).set({
          userId: req.userId, date: dateKey,
          insight: insights.insight, problem: insights.problem, action: insights.action,
          createdAt: firestore.admin.firestore.FieldValue.serverTimestamp()
        });
      } catch (writeErr) { console.warn('Firestore insights cache write failed:', writeErr.message); }
    }

    try { await firestore.trackInsightsUsage(req.userId); }
    catch (e) { console.warn('[ai:insights] usage tracking failed (uid: ' + req.userId + '):', e.message); }

    res.json({ insights: insights });
  } catch (err) {
    console.error('Insights error:', err.message);
    res.status(500).json({ error: formatError(err) });
  }
}

router.post('/insights', authMiddleware, rateLimitMiddleware, premiumGate('ai_coach'), insightsHandler);
router.post('/coach', authMiddleware, rateLimitMiddleware, premiumGate('ai_coach'), insightsHandler);

/* ------------------------------------------------------------------ */
/*  Study Plan                                                        */
/* ------------------------------------------------------------------ */

async function studyPlanHandler(req, res) {
  try {
    var body = req.body;
    var examName = typeof body.examName === 'string' ? body.examName.trim().substring(0, 100) : '';
    var examDate = typeof body.examDate === 'string' ? body.examDate.trim() : '';
    var dailyTimeMinutes = parseInt(body.dailyTimeMinutes) || 0;
    var forceRefresh = body.forceRefresh === true;

    if (!examName) return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Exam name is required.', retryable: false } });
    if (!examDate || !/^\d{4}-\d{2}-\d{2}$/.test(examDate)) return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'A valid exam date (YYYY-MM-DD) is required.', retryable: false } });
    var todayStr = new Date().toISOString().slice(0, 10);
    if (examDate <= todayStr) return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Exam date must be a future date.', retryable: false } });
    var examMs = new Date(examDate).getTime();
    var daysRemaining = Math.ceil((examMs - Date.now()) / (1000 * 60 * 60 * 24));
    if (dailyTimeMinutes < 15 || dailyTimeMinutes > 180) return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Daily time must be between 15 and 180 minutes.', retryable: false } });

    var rawStats = body.stats || {};
    var totalAttempted = parseInt(rawStats.totalAttempted) || 0;
    var totalCorrect = parseInt(rawStats.totalCorrect) || 0;
    var accuracy = totalAttempted > 0 ? ((totalCorrect / totalAttempted) * 100).toFixed(1) : '0';
    var weakTopics = [];
    if (rawStats.categoryStats && typeof rawStats.categoryStats === 'object') {
      Object.keys(rawStats.categoryStats).slice(0, 20).forEach(function (key) {
        var d = rawStats.categoryStats[key];
        if (d && typeof d === 'object') {
          var attempted = parseInt(d.attempted) || 0;
          var correct = parseInt(d.correct) || 0;
          if (attempted >= 5 && (correct / attempted) * 100 < 60) weakTopics.push(String(key).substring(0, 50));
        }
      });
    }

    if (forceRefresh) await firestore.clearStudyPlanCache(req.userId, examDate);

    /* Check cache */
    var db = firestore.db;
    var cacheRef = db.collection('aiStudyPlans');
    var cacheDocId = req.userId + '_' + examDate.replace(/[^a-z0-9]/gi, '-');
    var plan = null;

    try {
      var cached = await cacheRef.doc(cacheDocId).get();
      if (cached.exists) {
        var data = cached.data();
        var createdMs = data.createdAt ? data.createdAt.toMillis() : 0;
        var ageMs = Date.now() - createdMs;
        if (ageMs < firestore.STUDY_PLAN_TTL_DAYS * 24 * 60 * 60 * 1000 && data.examName === examName && data.dailyTimeMinutes === dailyTimeMinutes) {
          plan = { strategy: data.strategy, weeklyPlan: data.weeklyPlan, dailyStructure: data.dailyStructure, tip: data.tip };
        }
      }
    } catch (cacheErr) { console.warn('Study plan cache read failed:', cacheErr.message); }

    if (!plan) {
      plan = await openai.generateStudyPlan({
        examName: examName, examDate: examDate, daysRemaining: daysRemaining,
        dailyTimeMinutes: dailyTimeMinutes, weakTopics: weakTopics, accuracy: accuracy, userId: req.userId
      });
      if (!plan) throw new firestore.AIServiceError('INVALID_RESPONSE', 'Invalid study plan format after retries', true);

      try {
        await cacheRef.doc(cacheDocId).set({
          userId: req.userId, examName: examName, examDate: examDate, dailyTimeMinutes: dailyTimeMinutes,
          strategy: plan.strategy, weeklyPlan: plan.weeklyPlan, dailyStructure: plan.dailyStructure, tip: plan.tip,
          createdAt: firestore.admin.firestore.FieldValue.serverTimestamp()
        });
      } catch (writeErr) { console.warn('Study plan cache write failed:', writeErr.message); }
    }

    res.json({ plan: plan });
  } catch (err) {
    console.error('Study plan error:', err.message);
    res.status(500).json({ error: formatError(err) });
  }
}

router.post('/study-plan', authMiddleware, rateLimitMiddleware, premiumGate('ai_study_plan'), studyPlanHandler);
router.post('/plan', authMiddleware, rateLimitMiddleware, premiumGate('ai_study_plan'), studyPlanHandler);

module.exports = router;

