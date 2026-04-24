/**
 * openai.js — OpenAI GPT-4o-mini integration for QuantReflex AI features.
 * Replaces the previous Gemini integration with cost-optimized GPT-4o-mini.
 */

const OpenAI = require('openai');

let openaiClient = null;

function _getClient() {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.warn('OPENAI_API_KEY not set. AI features will be unavailable.');
      return null;
    }
    openaiClient = new OpenAI({ apiKey: apiKey });
  }
  return openaiClient;
}

const MODEL = 'gpt-4o-mini';
const MAX_TOKENS = 1024;
const TEMPERATURE = 0.7;

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

var MAX_QUESTION_LENGTH = 300;

/* JSON parsing — identical to previous implementation */
function _parseJsonResponse(text) {
  const { AIServiceError } = require('./firebaseAdmin');
  var cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try { return JSON.parse(cleaned); } catch (e) {
    var arrM = cleaned.match(/\[[\s\S]*\]/);
    if (arrM) { try { return JSON.parse(arrM[0]); } catch (_) {} }
    var objM = cleaned.match(/\{[\s\S]*\}/);
    if (objM) { try { return JSON.parse(objM[0]); } catch (_) {} }
    throw new AIServiceError('PARSE_ERROR', 'Failed to parse AI response as JSON', true);
  }
}

/**
 * Core call-and-parse helper. Retries once on failure.
 */
async function _callAndParseGPT(systemPrompt, userPrompt, validator) {
  const { AIServiceError } = require('./firebaseAdmin');
  const client = _getClient();
  if (!client) throw new AIServiceError('SERVICE_UNAVAILABLE', 'AI service unavailable', true);

  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const completion = await client.chat.completions.create({
        model: MODEL, max_tokens: MAX_TOKENS, temperature: TEMPERATURE,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      });
      const text = completion.choices[0].message.content || '';
      const parsed = _parseJsonResponse(text);
      const validated = validator(parsed);
      if (validated) return validated;
      lastErr = new AIServiceError('PARSE_ERROR', 'Response failed validation on attempt ' + (attempt + 1), true);
    } catch (err) {
      if (err.code && typeof err.retryable !== 'undefined') { lastErr = err; }
      else { lastErr = new AIServiceError('API_ERROR', err.message || 'OpenAI API error', true); }
    }
    if (attempt < 1) await new Promise(function (r) { setTimeout(r, 1500); });
  }
  throw lastErr || new AIServiceError('UNKNOWN', 'Failed after retries', true);
}

async function generateWordProblems(category, difficulty, count) {
  var catLabel = CATEGORY_LABELS[category] || category;
  var diffDesc = { easy: 'simple, single-step', medium: 'moderate, 2-3 steps', hard: 'challenging multi-step for competitive exams' };
  var genCount = count + 3;
  var sys = 'You are an expert math problem generator for competitive exam prep. Respond with valid JSON only.';
  var usr = 'Generate ' + genCount + ' unique word problems for "' + catLabel + '" at ' + difficulty + ' (' + (diffDesc[difficulty] || diffDesc.medium) + ').\nReturn JSON: {"questions":[{"question":"...","answer":number,"steps":"...","category":"' + category + '"}]}\nEach question must be a real-world word problem (>10 chars, <300 chars). Answer must be a number.';

  return await _callAndParseGPT(sys, usr, function (parsed) {
    var qs = parsed && parsed.questions ? parsed.questions : (Array.isArray(parsed) ? parsed : null);
    if (!Array.isArray(qs)) return null;
    var v = qs.filter(function (q) {
      return q && typeof q.question === 'string' && q.question.length > 10 &&
        q.question.length <= MAX_QUESTION_LENGTH &&
        typeof q.answer === 'number' && !isNaN(q.answer) && typeof q.category === 'string';
    });
    return v.length > 0 ? v : null;
  });
}

async function generateExplanation(question, answer, category) {
  var catLabel = CATEGORY_LABELS[category] || category || 'General Math';
  var sys = 'You are a math tutor. Explain solutions clearly and concisely. Respond with valid JSON only.';
  var usr = 'Student got this wrong. Explain:\nQuestion: ' + question + '\nCorrect Answer: ' + answer + '\nCategory: ' + catLabel + '\nReturn JSON: {"concept":"...","steps":["step1","step2"],"mistake":"...","tip":"...","computedAnswer":number}\nSteps MUST arrive at exactly ' + answer + '.';

  return await _callAndParseGPT(sys, usr, function (parsed) {
    if (!parsed || typeof parsed.concept !== 'string' || !Array.isArray(parsed.steps)) return null;
    var expected = parseFloat(answer);
    var computed = parseFloat(parsed.computedAnswer);
    if (isNaN(computed) || (!isNaN(expected) && Math.abs(expected - computed) > 0.01)) return null;
    return {
      concept: parsed.concept,
      steps: parsed.steps.filter(function (s) { return typeof s === 'string'; }),
      mistake: parsed.mistake || '', tip: parsed.tip || ''
    };
  });
}

async function generateInsights(stats) {
  var accuracy = stats.totalAttempted > 0 ? ((stats.totalCorrect / stats.totalAttempted) * 100).toFixed(1) : '0';
  var avgTime = stats.responseTimes && stats.responseTimes.length > 0
    ? (stats.responseTimes.reduce(function (a, b) { return a + b; }, 0) / stats.responseTimes.length).toFixed(1) : 'N/A';
  var catStats = stats.categoryStats || {};
  var weakCats = [], strongCats = [];
  for (var cat in catStats) {
    var d = catStats[cat];
    if (d.attempted >= 3) {
      var catAcc = (d.correct / d.attempted) * 100;
      if (catAcc < 60) weakCats.push(cat + ' (' + catAcc.toFixed(0) + '%)');
      else if (catAcc >= 80) strongCats.push(cat + ' (' + catAcc.toFixed(0) + '%)');
    }
  }
  var sys = 'You are an AI math coach. Give brief, actionable daily insights. Respond with valid JSON only.';
  var usr = 'Student stats:\n- Accuracy: ' + accuracy + '%\n- Avg Time: ' + avgTime + 's\n- Attempted: ' + (stats.totalAttempted || 0) + '\n- Streak: ' + (stats.dailyStreak || 0) + ' days\n- Sessions: ' + ((stats.drillSessions || 0) + (stats.timedTestSessions || 0)) + '\n- Weak: ' + (weakCats.join(', ') || 'None') + '\n- Strong: ' + (strongCats.join(', ') || 'None') + '\nReturn JSON: {"insight":"1-2 sentences","problem":"1 sentence","action":"1-2 sentences"}';

  return await _callAndParseGPT(sys, usr, function (parsed) {
    if (!parsed || typeof parsed.insight !== 'string') return null;
    return { insight: parsed.insight, problem: parsed.problem || '', action: parsed.action || '' };
  });
}

async function generateStudyPlan(params) {
  var weakStr = (params.weakTopics || []).length > 0 ? params.weakTopics.join(', ') : 'None identified';
  var timeLabel = params.daysRemaining <= 7 ? 'critical' : params.daysRemaining <= 30 ? 'short' : params.daysRemaining <= 60 ? 'moderate' : 'comfortable';
  var sys = 'You are an expert quant coach for competitive exams. Create SMART study plans. Respond with valid JSON only.';
  var usr = 'Exam: ' + params.examName + '\nDays left: ' + params.daysRemaining + ' (' + timeLabel + ')\nDaily time: ' + params.dailyTimeMinutes + ' min\nWeak topics: ' + weakStr + '\nAccuracy: ' + (params.accuracy || '0') + '%\nReturn JSON: {"strategy":"2-3 sentences","weeklyPlan":["Week 1: ..."],"dailyStructure":"how to split ' + params.dailyTimeMinutes + ' min","tip":"one specific tip"}\nweeklyPlan: 1-8 entries. Focus on quant only. Prioritize weak areas.';

  return await _callAndParseGPT(sys, usr, function (parsed) {
    if (!parsed || typeof parsed.strategy !== 'string') return null;
    if (!Array.isArray(parsed.weeklyPlan) || parsed.weeklyPlan.length < 1 || parsed.weeklyPlan.length > 8) return null;
    if (typeof parsed.dailyStructure !== 'string' || typeof parsed.tip !== 'string') return null;
    var validWeeks = parsed.weeklyPlan.filter(function (s) { return typeof s === 'string'; });
    if (validWeeks.length < 1) return null;
    return { strategy: parsed.strategy, weeklyPlan: validWeeks, dailyStructure: parsed.dailyStructure, tip: parsed.tip };
  });
}

module.exports = { generateWordProblems, generateExplanation, generateInsights, generateStudyPlan, CATEGORY_LABELS };
