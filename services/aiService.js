const { GoogleGenerativeAI } = require('@google/generative-ai');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.warn('GEMINI_API_KEY not set. AI features will be unavailable.');
}

let genAI = null;
let model = null;

function getModel() {
  if (!model && GEMINI_API_KEY) {
    genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
  }
  return model;
}

class AIServiceError {
  constructor(code, message, retryable) {
    this.code = code;
    this.message = message;
    this.retryable = retryable || false;
  }
}

const CATEGORY_LABELS = {
  squares: 'Squares & Square Roots',
  cubes: 'Cubes & Cube Roots',
  area: 'Area Calculations',
  volume: 'Volume Calculations',
  percentages: 'Percentages',
  multiplication: 'Multiplication & Division',
  fractions: 'Fractions',
  averages: 'Averages',
  ratios: 'Ratios & Proportions',
  'profit-loss': 'Profit & Loss',
  'time-speed-distance': 'Time, Speed & Distance',
  'time-and-work': 'Time & Work'
};

const cache = {
  wordProblems: new Map(),
  explanations: new Map(),
  insights: new Map()
};

const CACHE_TTL = {
  wordProblems: 6 * 60 * 60 * 1000,
  explanations: 24 * 60 * 60 * 1000,
  insights: 24 * 60 * 60 * 1000
};

const MAX_CACHE_SIZE = 200;

function _cacheGet(store, key) {
  var entry = cache[store].get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL[store]) {
    cache[store].delete(key);
    return null;
  }
  return entry;
}

function _cacheSet(store, key, data) {
  if (cache[store].size >= MAX_CACHE_SIZE) {
    var oldest = cache[store].keys().next().value;
    cache[store].delete(oldest);
  }
  cache[store].set(key, { data: data, ts: Date.now(), usageCount: 0 });
}

function _wpCacheKey(category, difficulty) {
  return category + ':' + difficulty;
}

function _explainCacheKey(question, answer) {
  var h = 0;
  var str = question + ':' + answer;
  for (var i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return 'exp:' + h;
}

function _insightsCacheKey(userId) {
  var d = new Date();
  return 'ins:' + userId + ':' + d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
}

async function generateWordProblems(category, difficulty, count) {
  var m = getModel();
  if (!m) throw new AIServiceError('SERVICE_UNAVAILABLE', 'AI service unavailable', true);

  var cacheKey = _wpCacheKey(category, difficulty);
  var cached = _cacheGet('wordProblems', cacheKey);
  if (cached && cached.data.length >= count) {
    cached.usageCount++;
    var shuffled = cached.data.slice().sort(function () { return Math.random() - 0.5; });
    return shuffled.slice(0, count);
  }

  var catLabel = CATEGORY_LABELS[category] || category;
  var diffDesc = {
    easy: 'simple, single-step problems suitable for beginners',
    medium: 'moderate difficulty requiring 2-3 steps',
    hard: 'challenging multi-step problems for competitive exam preparation'
  };

  var prompt = 'Generate exactly ' + (count + 3) + ' unique word problems for the math category "' + catLabel + '" at ' + difficulty + ' difficulty level (' + (diffDesc[difficulty] || diffDesc.medium) + ').\n\nRequirements:\n- Each problem must be a real-world word problem (not just a bare equation)\n- The answer must be a single number (integer or decimal up to 2 decimal places)\n- Problems should be varied and not repetitive\n- Suitable for competitive exam prep (CAT/GMAT/placement tests)\n\nReturn ONLY a valid JSON array with exactly ' + (count + 3) + ' objects. Each object must have:\n- "question": the word problem text (string, no line breaks)\n- "answer": the numeric answer (number, not string)\n- "category": "' + category + '"\n\nExample format:\n[{"question":"A shopkeeper buys an item for ₹200 and sells it for ₹250. What is the profit percentage?","answer":25,"category":"profit-loss"}]\n\nReturn ONLY the JSON array, no markdown, no explanation, no code fences.';

  var valid = await _callAndParse(m, prompt, function (parsed) {
    if (!Array.isArray(parsed)) return null;
    var v = parsed.filter(function (q) {
      return q && typeof q.question === 'string' && q.question.length > 10 &&
        typeof q.answer === 'number' && !isNaN(q.answer) &&
        typeof q.category === 'string';
    });
    return v.length > 0 ? v : null;
  });

  if (!valid) throw new AIServiceError('INVALID_RESPONSE', 'No valid questions generated after retries', true);

  _cacheSet('wordProblems', cacheKey, valid);
  return valid.slice(0, count);
}

async function generateExplanation(question, answer, category) {
  var m = getModel();
  if (!m) throw new AIServiceError('SERVICE_UNAVAILABLE', 'AI service unavailable', true);

  var cacheKey = _explainCacheKey(question, answer);
  var cached = _cacheGet('explanations', cacheKey);
  if (cached) {
    cached.usageCount++;
    return cached.data;
  }

  var catLabel = CATEGORY_LABELS[category] || category || 'General Math';

  var prompt = 'A student got this math question wrong. Explain the solution clearly and concisely.\n\nQuestion: ' + question + '\nCorrect Answer: ' + answer + '\nCategory: ' + catLabel + '\n\nReturn ONLY a valid JSON object with these fields:\n- "concept": A one-line description of the math concept being tested (string)\n- "steps": An array of step-by-step solution strings, each step being 1-2 sentences (array of strings)\n- "mistake": The most common mistake students make on this type of problem (string)\n- "tip": A quick mental math tip or shortcut for similar problems (string)\n\nIMPORTANT: The final step must arrive at the answer ' + answer + '. Your explanation must be consistent with this correct answer.\n\nReturn ONLY the JSON object, no markdown, no explanation, no code fences.';

  var result = await _callAndParse(m, prompt, function (parsed) {
    if (!parsed || typeof parsed.concept !== 'string' || !Array.isArray(parsed.steps)) return null;
    return {
      concept: parsed.concept,
      steps: parsed.steps.filter(function (s) { return typeof s === 'string'; }),
      mistake: parsed.mistake || '',
      tip: parsed.tip || ''
    };
  });

  if (!result) throw new AIServiceError('INVALID_RESPONSE', 'Invalid explanation format after retries', true);

  _cacheSet('explanations', cacheKey, result);
  return result;
}

async function generateInsights(stats, userId) {
  var m = getModel();
  if (!m) throw new AIServiceError('SERVICE_UNAVAILABLE', 'AI service unavailable', true);

  var cacheKey = _insightsCacheKey(userId || 'anon');
  var cached = _cacheGet('insights', cacheKey);
  if (cached) {
    cached.usageCount++;
    return cached.data;
  }

  var accuracy = stats.totalAttempted > 0
    ? ((stats.totalCorrect / stats.totalAttempted) * 100).toFixed(1)
    : '0';
  var avgTime = stats.responseTimes && stats.responseTimes.length > 0
    ? (stats.responseTimes.reduce(function (a, b) { return a + b; }, 0) / stats.responseTimes.length).toFixed(1)
    : 'N/A';

  var catStats = stats.categoryStats || {};
  var weakCats = [];
  var strongCats = [];
  for (var cat in catStats) {
    var data = catStats[cat];
    if (data.attempted >= 3) {
      var catAcc = (data.correct / data.attempted) * 100;
      if (catAcc < 60) weakCats.push(cat + ' (' + catAcc.toFixed(0) + '%)');
      else if (catAcc >= 80) strongCats.push(cat + ' (' + catAcc.toFixed(0) + '%)');
    }
  }

  var prompt = 'You are an AI math coach for a student preparing for competitive exams (CAT/GMAT/placements). Analyze their performance and give a brief, actionable daily insight.\n\nStudent Stats:\n- Overall Accuracy: ' + accuracy + '%\n- Average Response Time: ' + avgTime + ' seconds\n- Total Questions Attempted: ' + (stats.totalAttempted || 0) + '\n- Current Daily Streak: ' + (stats.dailyStreak || 0) + ' days\n- Total Sessions: ' + ((stats.drillSessions || 0) + (stats.timedTestSessions || 0)) + '\n- Mistakes Logged: ' + ((stats.mistakes || []).length) + '\n- Weak Categories: ' + (weakCats.length > 0 ? weakCats.join(', ') : 'None identified yet') + '\n- Strong Categories: ' + (strongCats.length > 0 ? strongCats.join(', ') : 'None identified yet') + '\n\nReturn ONLY a valid JSON object with:\n- "insight": A personalized 1-2 sentence observation about their current performance (string)\n- "problem": The single biggest area for improvement right now (string, 1 sentence)\n- "action": A specific, actionable recommendation for today\'s practice (string, 1-2 sentences)\n\nKeep the tone encouraging but direct. Be specific — reference actual numbers.\n\nReturn ONLY the JSON object, no markdown, no code fences.';

  var result = await _callAndParse(m, prompt, function (parsed) {
    if (!parsed || typeof parsed.insight !== 'string') return null;
    return {
      insight: parsed.insight,
      problem: parsed.problem || '',
      action: parsed.action || ''
    };
  });

  if (!result) throw new AIServiceError('INVALID_RESPONSE', 'Invalid insights format after retries', true);

  _cacheSet('insights', cacheKey, result);
  return result;
}

async function _callAndParse(m, prompt, validator) {
  var lastErr = null;
  for (var attempt = 0; attempt < 2; attempt++) {
    try {
      var raw = await m.generateContent(prompt);
      var text = raw.response.text();
      var parsed = _parseJsonResponse(text);
      var validated = validator(parsed);
      if (validated) return validated;
      lastErr = new AIServiceError('PARSE_ERROR', 'Response failed validation on attempt ' + (attempt + 1), true);
    } catch (err) {
      if (err instanceof AIServiceError) {
        lastErr = err;
      } else {
        lastErr = new AIServiceError('API_ERROR', err.message, true);
      }
    }
    if (attempt < 1) await new Promise(function (r) { setTimeout(r, 1500); });
  }
  throw lastErr || new AIServiceError('UNKNOWN', 'Failed after retries', true);
}

function _parseJsonResponse(text) {
  var cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  cleaned = cleaned.trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    var arrayMatch = cleaned.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      try { return JSON.parse(arrayMatch[0]); } catch (_) {}
    }
    var objMatch = cleaned.match(/\{[\s\S]*\}/);
    if (objMatch) {
      try { return JSON.parse(objMatch[0]); } catch (_) {}
    }
    throw new AIServiceError('PARSE_ERROR', 'Failed to parse AI response as JSON', true);
  }
}

module.exports = { generateWordProblems, generateExplanation, generateInsights, AIServiceError };
