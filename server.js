const express = require('express');
const path = require('path');
const aiService = require('./services/aiService');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json({ limit: '16kb' }));
app.use(express.static(path.join(__dirname), {
  extensions: ['html'],
  index: 'index.html'
}));

var VALID_CATEGORIES = ['squares', 'cubes', 'area', 'volume', 'percentages', 'multiplication', 'fractions', 'averages', 'ratios', 'profit-loss', 'time-speed-distance', 'time-and-work'];
var MAX_QUESTION_INPUT_LENGTH = 500;

var rateLimitStore = {};
var RATE_WINDOW_MS = 60 * 1000;
var RATE_LIMIT_FREE = 5;
var RATE_LIMIT_PREMIUM = 30;

setInterval(function () {
  var now = Date.now();
  for (var ip in rateLimitStore) {
    if (now - rateLimitStore[ip].windowStart > RATE_WINDOW_MS * 5) {
      delete rateLimitStore[ip];
    }
  }
}, 5 * 60 * 1000);

function rateLimitMiddleware(req, res, next) {
  var ip = req.ip || req.connection.remoteAddress || 'unknown';
  var now = Date.now();
  var isPremium = req.userPremium === true;
  var limit = isPremium ? RATE_LIMIT_PREMIUM : RATE_LIMIT_FREE;

  if (!rateLimitStore[ip] || now - rateLimitStore[ip].windowStart > RATE_WINDOW_MS) {
    rateLimitStore[ip] = { count: 1, windowStart: now };
  } else {
    rateLimitStore[ip].count++;
  }

  if (rateLimitStore[ip].count > limit) {
    return res.status(429).json({
      error: { code: 'RATE_LIMITED', message: 'Too many requests. Please wait before trying again.', retryable: true }
    });
  }
  next();
}

async function authMiddleware(req, res, next) {
  var authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: { code: 'UNAUTHORIZED', message: 'Authentication required to use AI features.', retryable: false }
    });
  }

  var idToken = authHeader.substring(7);
  var decoded = await aiService.verifyIdToken(idToken);
  if (!decoded || !decoded.uid) {
    return res.status(401).json({
      error: { code: 'UNAUTHORIZED', message: 'Invalid or expired authentication token.', retryable: false }
    });
  }

  req.userId = decoded.uid;
  try {
    req.userPremium = await aiService.isUserPremium(decoded.uid);
  } catch (entitlementErr) {
    return res.status(503).json({ error: formatError(entitlementErr) });
  }
  next();
}

function premiumGate(featureKey) {
  return function (req, res, next) {
    if (!req.userPremium) {
      return res.status(403).json({
        error: { code: 'PREMIUM_REQUIRED', message: 'This feature requires a premium subscription.', retryable: false }
      });
    }
    next();
  };
}

function formatError(err) {
  if (err instanceof aiService.AIServiceError) {
    return { code: err.code, message: err.message, retryable: err.retryable };
  }
  return { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred. Try again later.', retryable: true };
}

app.post('/api/ai/word-problems', authMiddleware, rateLimitMiddleware, async function (req, res) {
  try {
    var remaining = await aiService.checkWordProblemQuota(req.userId, req.userPremium);
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
    var clampedCount = Math.min(Math.max(parseInt(count) || 5, 1), 20);
    clampedCount = Math.min(clampedCount, remaining);
    var questions = await aiService.generateWordProblems(category, difficulty, clampedCount);
    await aiService.consumeWordProblemQuota(req.userId, req.userPremium, questions.length);
    res.json({ questions: questions, remaining: remaining - questions.length });
  } catch (err) {
    console.error('Word problems error:', err.message);
    res.status(500).json({ error: formatError(err) });
  }
});

app.post('/api/ai/explain', authMiddleware, rateLimitMiddleware, premiumGate('ai_explain'), async function (req, res) {
  try {
    var body = req.body;
    var question = typeof body.question === 'string' ? body.question.substring(0, MAX_QUESTION_INPUT_LENGTH) : '';
    var answer = body.answer;
    var category = body.category;
    if (!question || answer === undefined) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Missing required fields: question, answer', retryable: false } });
    }
    var answerStr = String(answer).substring(0, 50);
    var explanation = await aiService.generateExplanation(question, answerStr, category);
    aiService.trackExplanationUsage(req.userId).catch(function (e) { console.warn('Explain usage track failed:', e.message); });
    res.json({ explanation: explanation });
  } catch (err) {
    console.error('Explanation error:', err.message);
    res.status(500).json({ error: formatError(err) });
  }
});

app.post('/api/ai/insights', authMiddleware, rateLimitMiddleware, premiumGate('ai_coach'), async function (req, res) {
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
    var insights = await aiService.generateInsights(stats, req.userId);
    aiService.trackInsightsUsage(req.userId).catch(function (e) { console.warn('Insights usage track failed:', e.message); });
    res.json({ insights: insights });
  } catch (err) {
    console.error('Insights error:', err.message);
    res.status(500).json({ error: formatError(err) });
  }
});

app.get('/{*splat}', function (req, res) {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', function () {
  console.log('QuantReflex server running on port ' + PORT);
});
