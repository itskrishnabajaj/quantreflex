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

async function generateWordProblems(category, difficulty, count) {
  const m = getModel();
  if (!m) throw new Error('AI service unavailable');

  const catLabel = CATEGORY_LABELS[category] || category;
  const diffDesc = {
    easy: 'simple, single-step problems suitable for beginners',
    medium: 'moderate difficulty requiring 2-3 steps',
    hard: 'challenging multi-step problems for competitive exam preparation'
  };

  const prompt = `Generate exactly ${count} unique word problems for the math category "${catLabel}" at ${difficulty} difficulty level (${diffDesc[difficulty] || diffDesc.medium}).

Requirements:
- Each problem must be a real-world word problem (not just a bare equation)
- The answer must be a single number (integer or decimal up to 2 decimal places)
- Problems should be varied and not repetitive
- Suitable for competitive exam prep (CAT/GMAT/placement tests)

Return ONLY a valid JSON array with exactly ${count} objects. Each object must have:
- "question": the word problem text (string, no line breaks)
- "answer": the numeric answer (number, not string)
- "category": "${category}"

Example format:
[{"question":"A shopkeeper buys an item for ₹200 and sells it for ₹250. What is the profit percentage?","answer":25,"category":"profit-loss"}]

Return ONLY the JSON array, no markdown, no explanation, no code fences.`;

  const result = await callGeminiWithRetry(m, prompt);
  const parsed = parseJsonResponse(result);

  if (!Array.isArray(parsed)) throw new Error('Invalid response format');

  const valid = parsed.filter(q =>
    q && typeof q.question === 'string' && q.question.length > 10 &&
    typeof q.answer === 'number' && !isNaN(q.answer) &&
    typeof q.category === 'string'
  );

  if (valid.length === 0) throw new Error('No valid questions generated');
  return valid;
}

async function generateExplanation(question, answer, category) {
  const m = getModel();
  if (!m) throw new Error('AI service unavailable');

  const catLabel = CATEGORY_LABELS[category] || category || 'General Math';

  const prompt = `A student got this math question wrong. Explain the solution clearly and concisely.

Question: ${question}
Correct Answer: ${answer}
Category: ${catLabel}

Return ONLY a valid JSON object with these fields:
- "concept": A one-line description of the math concept being tested (string)
- "steps": An array of step-by-step solution strings, each step being 1-2 sentences (array of strings)
- "mistake": The most common mistake students make on this type of problem (string)
- "tip": A quick mental math tip or shortcut for similar problems (string)

Example:
{"concept":"Profit percentage calculation","steps":["Cost Price (CP) = ₹200","Selling Price (SP) = ₹250","Profit = SP - CP = ₹50","Profit % = (Profit/CP) × 100 = 25%"],"mistake":"Using SP instead of CP as the base for percentage calculation","tip":"Remember: Profit% is always calculated on Cost Price, not Selling Price"}

Return ONLY the JSON object, no markdown, no explanation, no code fences.`;

  const result = await callGeminiWithRetry(m, prompt);
  const parsed = parseJsonResponse(result);

  if (!parsed || typeof parsed.concept !== 'string' || !Array.isArray(parsed.steps)) {
    throw new Error('Invalid explanation format');
  }

  return {
    concept: parsed.concept,
    steps: parsed.steps.filter(s => typeof s === 'string'),
    mistake: parsed.mistake || '',
    tip: parsed.tip || ''
  };
}

async function generateInsights(stats) {
  const m = getModel();
  if (!m) throw new Error('AI service unavailable');

  const accuracy = stats.totalAttempted > 0
    ? ((stats.totalCorrect / stats.totalAttempted) * 100).toFixed(1)
    : '0';
  const avgTime = stats.responseTimes && stats.responseTimes.length > 0
    ? (stats.responseTimes.reduce((a, b) => a + b, 0) / stats.responseTimes.length).toFixed(1)
    : 'N/A';

  const catStats = stats.categoryStats || {};
  const weakCats = [];
  const strongCats = [];
  for (const [cat, data] of Object.entries(catStats)) {
    if (data.attempted >= 3) {
      const catAcc = (data.correct / data.attempted) * 100;
      if (catAcc < 60) weakCats.push(cat + ' (' + catAcc.toFixed(0) + '%)');
      else if (catAcc >= 80) strongCats.push(cat + ' (' + catAcc.toFixed(0) + '%)');
    }
  }

  const prompt = `You are an AI math coach for a student preparing for competitive exams (CAT/GMAT/placements). Analyze their performance and give a brief, actionable daily insight.

Student Stats:
- Overall Accuracy: ${accuracy}%
- Average Response Time: ${avgTime} seconds
- Total Questions Attempted: ${stats.totalAttempted || 0}
- Current Daily Streak: ${stats.dailyStreak || 0} days
- Total Sessions: ${(stats.drillSessions || 0) + (stats.timedTestSessions || 0)}
- Mistakes Logged: ${(stats.mistakes || []).length}
- Weak Categories: ${weakCats.length > 0 ? weakCats.join(', ') : 'None identified yet'}
- Strong Categories: ${strongCats.length > 0 ? strongCats.join(', ') : 'None identified yet'}

Return ONLY a valid JSON object with:
- "insight": A personalized 1-2 sentence observation about their current performance (string)
- "problem": The single biggest area for improvement right now (string, 1 sentence)
- "action": A specific, actionable recommendation for today's practice (string, 1-2 sentences)

Keep the tone encouraging but direct. Be specific — reference actual numbers.

Return ONLY the JSON object, no markdown, no code fences.`;

  const result = await callGeminiWithRetry(m, prompt);
  const parsed = parseJsonResponse(result);

  if (!parsed || typeof parsed.insight !== 'string') {
    throw new Error('Invalid insights format');
  }

  return {
    insight: parsed.insight,
    problem: parsed.problem || '',
    action: parsed.action || ''
  };
}

async function callGeminiWithRetry(m, prompt, retries = 1) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await m.generateContent(prompt);
      const text = result.response.text();
      return text;
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

function parseJsonResponse(text) {
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  cleaned = cleaned.trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      try { return JSON.parse(arrayMatch[0]); } catch (_) {}
    }
    const objMatch = cleaned.match(/\{[\s\S]*\}/);
    if (objMatch) {
      try { return JSON.parse(objMatch[0]); } catch (_) {}
    }
    throw new Error('Failed to parse AI response as JSON');
  }
}

module.exports = { generateWordProblems, generateExplanation, generateInsights };
