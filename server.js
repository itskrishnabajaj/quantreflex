const express = require('express');
const path = require('path');
const aiService = require('./services/aiService');
const paymentService = require('./services/paymentService');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json({ limit: '16kb' }));

app.use(function (req, res, next) {
  var p = req.path.toLowerCase();
  if (p === '/server.js' || p === '/services' || p.startsWith('/services/') || p === '/package.json' || p === '/package-lock.json' || p.endsWith('.md') || p.startsWith('/.local/') || p.startsWith('/node_modules/') || p === '/.replit' || p === '/replit.nix') {
    return res.status(404).end();
  }
  next();
});

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
  for (var key in rateLimitStore) {
    if (now - rateLimitStore[key].windowStart > RATE_WINDOW_MS * 5) {
      delete rateLimitStore[key];
    }
  }
}, 5 * 60 * 1000);

function rateLimitMiddleware(req, res, next) {
  /* Key by authenticated userId (set by authMiddleware which runs first).
     Fall back to IP only if userId is somehow absent. */
  var key = req.userId || req.ip || req.connection.remoteAddress || 'unknown';
  var now = Date.now();
  var isPremium = req.userPremium === true;
  var limit = isPremium ? RATE_LIMIT_PREMIUM : RATE_LIMIT_FREE;

  if (!rateLimitStore[key] || now - rateLimitStore[key].windowStart > RATE_WINDOW_MS) {
    rateLimitStore[key] = { count: 1, windowStart: now };
  } else {
    rateLimitStore[key].count++;
  }

  if (rateLimitStore[key].count > limit) {
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
    var entitlement = await Promise.all([
      aiService.isUserPremium(decoded.uid),
      aiService.isUserPremiumPlus(decoded.uid)
    ]);
    req.userPremium = entitlement[0];
    req.userPremiumPlus = entitlement[1];
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

function premiumPlusGate(featureKey) {
  return function (req, res, next) {
    if (!req.userPremiumPlus) {
      return res.status(403).json({
        error: { code: 'PREMIUM_PLUS_REQUIRED', message: 'This feature requires a Premium+ subscription.', retryable: false }
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

app.post('/api/ai/word-problems', authMiddleware, rateLimitMiddleware, premiumPlusGate('ai_word_problems'), async function (req, res) {
  try {
    var remaining = await aiService.checkWordProblemQuota(req.userId, req.userPremiumPlus);
    if (remaining <= 0) {
      var msg = req.userPremiumPlus ? 'Daily word problem limit reached. Come back tomorrow.' : 'Free word problem limit reached. Upgrade to Premium+ for more.';
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
    var questions = await aiService.generateWordProblems(category, difficulty, clampedCount);
    await aiService.consumeWordProblemQuota(req.userId, req.userPremiumPlus, questions.length);
    res.json({ questions: questions, remaining: remaining - questions.length });
  } catch (err) {
    console.error('Word problems error:', err.message);
    res.status(500).json({ error: formatError(err) });
  }
});

app.post('/api/ai/explain', authMiddleware, rateLimitMiddleware, premiumPlusGate('ai_explain'), async function (req, res) {
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

app.post('/api/ai/insights', authMiddleware, rateLimitMiddleware, premiumPlusGate('ai_coach'), async function (req, res) {
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

app.post('/api/ai/study-plan', authMiddleware, rateLimitMiddleware, premiumPlusGate('ai_study_plan'), async function (req, res) {
  try {
    var body = req.body;
    var examName = typeof body.examName === 'string' ? body.examName.trim().substring(0, 100) : '';
    var examDate = typeof body.examDate === 'string' ? body.examDate.trim() : '';
    var dailyTimeMinutes = parseInt(body.dailyTimeMinutes) || 0;
    var forceRefresh = body.forceRefresh === true;

    if (!examName) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Exam name is required.', retryable: false } });
    }
    if (!examDate || !/^\d{4}-\d{2}-\d{2}$/.test(examDate)) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'A valid exam date (YYYY-MM-DD) is required.', retryable: false } });
    }

    var todayStr = new Date().toISOString().slice(0, 10);
    if (examDate <= todayStr) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Exam date must be a future date.', retryable: false } });
    }
    var examMs = new Date(examDate).getTime();
    var daysRemaining = Math.ceil((examMs - Date.now()) / (1000 * 60 * 60 * 24));

    if (dailyTimeMinutes < 15 || dailyTimeMinutes > 180) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Daily time must be between 15 and 180 minutes.', retryable: false } });
    }

    var rawStats = body.stats || {};
    var totalAttempted = parseInt(rawStats.totalAttempted) || 0;
    var totalCorrect = parseInt(rawStats.totalCorrect) || 0;
    var accuracy = totalAttempted > 0 ? ((totalCorrect / totalAttempted) * 100).toFixed(1) : '0';

    var weakTopics = [];
    if (rawStats.categoryStats && typeof rawStats.categoryStats === 'object') {
      var catKeys = Object.keys(rawStats.categoryStats).slice(0, 20);
      catKeys.forEach(function (key) {
        var d = rawStats.categoryStats[key];
        if (d && typeof d === 'object') {
          var attempted = parseInt(d.attempted) || 0;
          var correct = parseInt(d.correct) || 0;
          if (attempted >= 5) {
            var catAcc = (correct / attempted) * 100;
            if (catAcc < 60) weakTopics.push(String(key).substring(0, 50));
          }
        }
      });
    }

    if (forceRefresh) {
      await aiService.clearStudyPlanCache(req.userId, examDate);
    }

    var plan = await aiService.generateStudyPlan({
      examName: examName,
      examDate: examDate,
      daysRemaining: daysRemaining,
      dailyTimeMinutes: dailyTimeMinutes,
      weakTopics: weakTopics,
      accuracy: accuracy,
      userId: req.userId
    });

    res.json({ plan: plan });
  } catch (err) {
    console.error('Study plan error:', err.message);
    res.status(500).json({ error: formatError(err) });
  }
});


app.post('/api/subscriptions/create-order', authMiddleware, async function (req, res) {
  try {
    var plan = req.body && req.body.plan;
    if (plan !== 'monthly' && plan !== 'yearly') {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invalid plan. Must be "monthly" or "yearly".', retryable: false } });
    }
    var order = await paymentService.createPremiumPlusOrder(plan);
    res.json(order);
  } catch (err) {
    console.error('Create order error:', err.message);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Could not create payment order. Please try again.', retryable: true } });
  }
});

app.post('/api/subscriptions/verify', authMiddleware, async function (req, res) {
  try {
    var body = req.body || {};
    var orderId = typeof body.orderId === 'string' ? body.orderId.trim() : '';
    var paymentId = typeof body.paymentId === 'string' ? body.paymentId.trim() : '';
    var signature = typeof body.signature === 'string' ? body.signature.trim() : '';

    if (!orderId || !paymentId || !signature) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Missing required fields: orderId, paymentId, signature.', retryable: false } });
    }

    var valid = paymentService.verifyRazorpaySignature(orderId, paymentId, signature);
    if (!valid) {
      return res.status(400).json({ error: { code: 'SIGNATURE_INVALID', message: 'Payment verification failed. Please contact support.', retryable: false } });
    }

    var trustedPlan = await paymentService.fetchOrderPlan(orderId);

    var expiry = await aiService.unlockPremiumPlus(req.userId, trustedPlan, paymentId);
    res.json({ success: true, expiry: expiry, plan: trustedPlan });
  } catch (err) {
    console.error('Verify subscription error:', err.message);
    if (err instanceof aiService.AIServiceError && err.code === 'PAYMENT_REPLAY') {
      return res.status(409).json({ error: { code: 'PAYMENT_REPLAY', message: err.message, retryable: false } });
    }
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Could not activate subscription. Please contact support.', retryable: false } });
  }
});

app.get('/{*splat}', function (req, res) {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', function () {
  console.log('QuantReflex server running on port ' + PORT);
});
