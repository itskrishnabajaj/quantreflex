const express = require('express');
const path = require('path');
const aiService = require('./services/aiService');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());
app.use(express.static(path.join(__dirname), {
  extensions: ['html'],
  index: 'index.html'
}));

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
  req.userPremium = await aiService.isUserPremium(decoded.uid);
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
    var body = req.body;
    var category = body.category;
    var difficulty = body.difficulty;
    var count = body.count;
    if (!category || !difficulty || !count) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Missing required fields: category, difficulty, count', retryable: false } });
    }
    var validDifficulties = ['easy', 'medium', 'hard'];
    if (validDifficulties.indexOf(difficulty) === -1) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invalid difficulty. Must be easy, medium, or hard.', retryable: false } });
    }
    var clampedCount = Math.min(Math.max(parseInt(count) || 5, 1), 20);
    var questions = await aiService.generateWordProblems(category, difficulty, clampedCount);
    res.json({ questions: questions });
  } catch (err) {
    console.error('Word problems error:', err.message);
    res.status(500).json({ error: formatError(err) });
  }
});

app.post('/api/ai/explain', authMiddleware, rateLimitMiddleware, premiumGate('ai_explain'), async function (req, res) {
  try {
    var body = req.body;
    var question = body.question;
    var answer = body.answer;
    var category = body.category;
    if (!question || answer === undefined) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Missing required fields: question, answer', retryable: false } });
    }
    var explanation = await aiService.generateExplanation(question, answer, category);
    res.json({ explanation: explanation });
  } catch (err) {
    console.error('Explanation error:', err.message);
    res.status(500).json({ error: formatError(err) });
  }
});

app.post('/api/ai/insights', authMiddleware, rateLimitMiddleware, premiumGate('ai_coach'), async function (req, res) {
  try {
    var stats = req.body.stats;
    if (!stats) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Missing required field: stats', retryable: false } });
    }
    var insights = await aiService.generateInsights(stats, req.userId);
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
