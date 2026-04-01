const { GoogleGenerativeAI } = require('@google/generative-ai');
const admin = require('firebase-admin');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.warn('GEMINI_API_KEY not set. AI features will be unavailable.');
}

if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'quant-reflex-trainer' });
}
var db = admin.firestore();

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

async function verifyIdToken(idToken) {
  try {
    var decoded = await admin.auth().verifyIdToken(idToken);
    return decoded;
  } catch (err) {
    return null;
  }
}

async function isUserPremium(uid) {
  try {
    var doc = await db.collection('users').doc(uid).get();
    if (!doc.exists) return false;
    var data = doc.data();
    return data.isPremium === true || data.premiumUser === true || data.hasPaid === true || data.isEarlyUser === true || data.isTrial === true;
  } catch (err) {
    console.error('Premium lookup failed for uid ' + uid + ':', err.message);
    throw new AIServiceError('ENTITLEMENT_ERROR', 'Unable to verify subscription status. Please try again.', true);
  }
}

var WP_FREE_LIMIT = 5;
var WP_PREMIUM_DAILY = 25;
var MAX_QUESTION_LENGTH = 300;
var usageCache = {};

async function _loadUsage(uid) {
  if (usageCache[uid]) return usageCache[uid];
  try {
    var doc = await db.collection('users').doc(uid).collection('usage').doc('ai').get();
    if (doc.exists) {
      usageCache[uid] = _normalizeUsageDoc(doc.data());
      return usageCache[uid];
    }
  } catch (err) {
    console.warn('Usage read failed:', err.message);
  }
  try {
    var legacyDoc = await db.collection('users').doc(uid).collection('usage').doc('wordProblems').get();
    if (legacyDoc.exists) {
      var legacy = legacyDoc.data();
      var migrated = {
        wordProblemsUsedLifetime: legacy.wordProblemsUsedLifetime || 0,
        wordProblemsUsedToday: legacy.wordProblemsUsedToday || 0,
        wordProblemsLastDate: legacy.lastUsedDate || null,
        lastUsageDate: legacy.lastUsedDate || null,
        explanationsUsed: 0,
        insightsGeneratedDate: null
      };
      usageCache[uid] = migrated;
      db.collection('users').doc(uid).collection('usage').doc('ai').set(migrated).catch(function (e) { console.warn('Legacy migration write failed:', e.message); });
      return migrated;
    }
  } catch (legacyErr) {
    console.warn('Legacy usage read failed:', legacyErr.message);
  }
  var fresh = {
    wordProblemsUsedLifetime: 0,
    wordProblemsUsedToday: 0,
    wordProblemsLastDate: null,
    lastUsageDate: null,
    explanationsUsed: 0,
    insightsGeneratedDate: null
  };
  usageCache[uid] = fresh;
  return fresh;
}

function _normalizeUsageDoc(data) {
  if (data.lastUsedDate && !data.lastUsageDate) {
    data.lastUsageDate = data.lastUsedDate;
  }
  if (data.lastUsedDate && !data.wordProblemsLastDate) {
    data.wordProblemsLastDate = data.lastUsedDate;
  }
  delete data.lastUsedDate;
  if (data.wordProblemsUsedLifetime === undefined) data.wordProblemsUsedLifetime = 0;
  if (data.wordProblemsUsedToday === undefined) data.wordProblemsUsedToday = 0;
  if (data.explanationsUsed === undefined) data.explanationsUsed = 0;
  return data;
}

async function _saveUsage(uid) {
  var entry = usageCache[uid];
  if (!entry) return;
  try {
    await db.collection('users').doc(uid).collection('usage').doc('ai').set(entry);
  } catch (err) {
    console.warn('Usage write failed:', err.message);
  }
}

async function checkWordProblemQuota(uid, isPremium) {
  var entry = await _loadUsage(uid);
  var today = new Date().toDateString();
  if (isPremium) {
    var lastDate = entry.wordProblemsLastDate ? new Date(entry.wordProblemsLastDate).toDateString() : null;
    if (lastDate !== today) { entry.wordProblemsUsedToday = 0; }
    return WP_PREMIUM_DAILY - entry.wordProblemsUsedToday;
  }
  return WP_FREE_LIMIT - entry.wordProblemsUsedLifetime;
}

async function consumeWordProblemQuota(uid, isPremium, count) {
  var entry = await _loadUsage(uid);
  var now = new Date();
  var today = now.toDateString();
  var lastDate = entry.wordProblemsLastDate ? new Date(entry.wordProblemsLastDate).toDateString() : null;
  if (isPremium) {
    if (lastDate !== today) { entry.wordProblemsUsedToday = 0; }
    entry.wordProblemsUsedToday += count;
  } else {
    entry.wordProblemsUsedLifetime += count;
  }
  entry.wordProblemsLastDate = now.toISOString();
  entry.lastUsageDate = now.toISOString();
  usageCache[uid] = entry;
  await _saveUsage(uid);
}

async function trackExplanationUsage(uid) {
  var entry = await _loadUsage(uid);
  entry.explanationsUsed = (entry.explanationsUsed || 0) + 1;
  entry.lastUsageDate = new Date().toISOString();
  usageCache[uid] = entry;
  await _saveUsage(uid);
}

async function trackInsightsUsage(uid) {
  var entry = await _loadUsage(uid);
  var today = new Date();
  var dateKey = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();
  entry.insightsGeneratedDate = dateKey;
  entry.lastUsageDate = today.toISOString();
  usageCache[uid] = entry;
  await _saveUsage(uid);
}

async function generateWordProblems(category, difficulty, count) {
  var m = getModel();
  if (!m) throw new AIServiceError('SERVICE_UNAVAILABLE', 'AI service unavailable', true);

  var cacheRef = db.collection('wordProblems');
  try {
    var cached = await cacheRef
      .where('category', '==', category)
      .where('difficulty', '==', difficulty)
      .orderBy('usageCount', 'asc')
      .limit(count * 2)
      .get();

    if (!cached.empty && cached.docs.length >= count) {
      var pool = cached.docs.map(function (d) { return Object.assign({ _docId: d.id }, d.data()); });
      _shuffleInPlace(pool);
      var selected = pool.slice(0, count);
      var batch = db.batch();
      selected.forEach(function (item) {
        batch.update(cacheRef.doc(item._docId), { usageCount: (item.usageCount || 0) + 1, lastUsed: admin.firestore.FieldValue.serverTimestamp() });
      });
      batch.commit().catch(function () {});
      return selected.map(function (item) {
        return { question: item.question, answer: item.answer, steps: item.steps || '', category: item.category };
      });
    }
  } catch (cacheErr) {
    console.warn('Firestore cache read failed, generating fresh:', cacheErr.message);
  }

  var catLabel = CATEGORY_LABELS[category] || category;
  var diffDesc = {
    easy: 'simple, single-step problems suitable for beginners',
    medium: 'moderate difficulty requiring 2-3 steps',
    hard: 'challenging multi-step problems for competitive exam preparation'
  };

  var genCount = count + 3;
  var prompt = 'Generate exactly ' + genCount + ' unique word problems for the math category "' + catLabel + '" at ' + difficulty + ' difficulty level (' + (diffDesc[difficulty] || diffDesc.medium) + ').\n\nRequirements:\n- Each problem must be a real-world word problem (not just a bare equation)\n- The answer must be a single number (integer or decimal up to 2 decimal places)\n- Problems should be varied and not repetitive\n- Suitable for competitive exam prep (CAT/GMAT/placement tests)\n\nReturn ONLY a valid JSON array with exactly ' + genCount + ' objects. Each object must have:\n- "question": the word problem text (string, no line breaks)\n- "answer": the numeric answer (number, not string)\n- "steps": optional short explanation of the solution approach (string)\n- "category": "' + category + '"\n\nExample format:\n[{"question":"A shopkeeper buys an item for ₹200 and sells it for ₹250. What is the profit percentage?","answer":25,"steps":"Profit = 250-200 = 50. Profit% = (50/200)*100 = 25%","category":"profit-loss"}]\n\nReturn ONLY the JSON array, no markdown, no explanation, no code fences.';

  var valid = await _callAndParse(m, prompt, function (parsed) {
    if (!Array.isArray(parsed)) return null;
    var v = parsed.filter(function (q) {
      return q && typeof q.question === 'string' && q.question.length > 10 &&
        q.question.length <= MAX_QUESTION_LENGTH &&
        typeof q.answer === 'number' && !isNaN(q.answer) &&
        typeof q.category === 'string';
    });
    return v.length > 0 ? v : null;
  });

  if (!valid) throw new AIServiceError('INVALID_RESPONSE', 'No valid questions generated after retries', true);

  var deduplicated = valid;
  try {
    var existingSnap = await cacheRef
      .where('category', '==', category)
      .where('difficulty', '==', difficulty)
      .limit(50)
      .get();
    if (!existingSnap.empty) {
      var existingPrefixes = {};
      existingSnap.docs.forEach(function (d) {
        var q = d.data().question || '';
        existingPrefixes[q.substring(0, 50).toLowerCase()] = true;
      });
      deduplicated = valid.filter(function (item) {
        var prefix = item.question.substring(0, 50).toLowerCase();
        return !existingPrefixes[prefix];
      });
    }
  } catch (dedupErr) {
    console.warn('Dedup check failed, storing all:', dedupErr.message);
  }

  if (deduplicated.length > 0) {
    try {
      var writeBatch = db.batch();
      deduplicated.forEach(function (item) {
        var docRef = cacheRef.doc();
        writeBatch.set(docRef, {
          question: item.question,
          answer: item.answer,
          steps: item.steps || '',
          category: item.category || category,
          difficulty: difficulty,
          usageCount: 0,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
      });
      await writeBatch.commit();
    } catch (writeErr) {
      console.warn('Firestore cache write failed:', writeErr.message);
    }
  }

  return valid.slice(0, count);
}

async function generateExplanation(question, answer, category) {
  var m = getModel();
  if (!m) throw new AIServiceError('SERVICE_UNAVAILABLE', 'AI service unavailable', true);

  var questionHash = _hashString(question + ':' + answer);
  var cacheRef = db.collection('explanations');

  try {
    var cached = await cacheRef.doc(questionHash).get();
    if (cached.exists) {
      var data = cached.data();
      await cacheRef.doc(questionHash).update({ usageCount: (data.usageCount || 0) + 1 });
      return { concept: data.concept, steps: data.steps, mistake: data.mistake, tip: data.tip };
    }
  } catch (cacheErr) {
    console.warn('Firestore explain cache read failed:', cacheErr.message);
  }

  var catLabel = CATEGORY_LABELS[category] || category || 'General Math';

  var prompt = 'A student got this math question wrong. Explain the solution clearly and concisely.\n\nQuestion: ' + question + '\nCorrect Answer: ' + answer + '\nCategory: ' + catLabel + '\n\nReturn ONLY a valid JSON object with these fields:\n- "concept": A one-line description of the math concept being tested (string)\n- "steps": An array of step-by-step solution strings, each step being 1-2 sentences (array of strings). The final step MUST state the final answer as ' + answer + '.\n- "mistake": The most common mistake students make on this type of problem (string)\n- "tip": A quick mental math tip or shortcut for similar problems (string)\n- "computedAnswer": The numeric answer your steps arrive at (number)\n\nIMPORTANT: Your solution steps must arrive at exactly ' + answer + ' as the final answer. Include the computed answer in the computedAnswer field for verification.\n\nReturn ONLY the JSON object, no markdown, no explanation, no code fences.';

  var result = await _callAndParse(m, prompt, function (parsed) {
    if (!parsed || typeof parsed.concept !== 'string' || !Array.isArray(parsed.steps)) return null;

    var expected = parseFloat(answer);
    var computed = parseFloat(parsed.computedAnswer);
    if (isNaN(computed) || (!isNaN(expected) && Math.abs(expected - computed) > 0.01)) {
      return null;
    }

    return {
      concept: parsed.concept,
      steps: parsed.steps.filter(function (s) { return typeof s === 'string'; }),
      mistake: parsed.mistake || '',
      tip: parsed.tip || ''
    };
  });

  if (!result) throw new AIServiceError('INVALID_RESPONSE', 'Invalid explanation format after retries', true);

  try {
    await cacheRef.doc(questionHash).set({
      questionId: questionHash,
      question: question,
      answer: answer,
      category: category || '',
      concept: result.concept,
      steps: result.steps,
      mistake: result.mistake,
      tip: result.tip,
      usageCount: 1,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
  } catch (writeErr) {
    console.warn('Firestore explain cache write failed:', writeErr.message);
  }

  return result;
}

async function generateInsights(stats, userId) {
  var m = getModel();
  if (!m) throw new AIServiceError('SERVICE_UNAVAILABLE', 'AI service unavailable', true);

  var today = new Date();
  var dateKey = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();
  var cacheDocId = userId + '_' + dateKey;
  var cacheRef = db.collection('aiInsights');

  try {
    var cached = await cacheRef.doc(cacheDocId).get();
    if (cached.exists) {
      var data = cached.data();
      return { insight: data.insight, problem: data.problem, action: data.action };
    }
  } catch (cacheErr) {
    console.warn('Firestore insights cache read failed:', cacheErr.message);
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
    var d = catStats[cat];
    if (d.attempted >= 3) {
      var catAcc = (d.correct / d.attempted) * 100;
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

  try {
    await cacheRef.doc(cacheDocId).set({
      userId: userId,
      date: dateKey,
      insight: result.insight,
      problem: result.problem,
      action: result.action,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
  } catch (writeErr) {
    console.warn('Firestore insights cache write failed:', writeErr.message);
  }

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

function _hashString(str) {
  var hash = 5381;
  for (var i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0x7fffffff;
  }
  return hash.toString(36);
}

function _shuffleInPlace(arr) {
  for (var i = arr.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
}

var STUDY_PLAN_TTL_DAYS = 7;

async function generateStudyPlan(params) {
  var m = getModel();
  if (!m) throw new AIServiceError('SERVICE_UNAVAILABLE', 'AI service unavailable', true);

  var examName = params.examName;
  var examDate = params.examDate;
  var daysRemaining = params.daysRemaining;
  var dailyTimeMinutes = params.dailyTimeMinutes;
  var weakTopics = params.weakTopics || [];
  var accuracy = params.accuracy || '0';
  var userId = params.userId;

  var cacheRef = db.collection('aiStudyPlans');
  var cacheDocId = userId + '_' + examDate.replace(/[^a-z0-9]/gi, '-');

  try {
    var cached = await cacheRef.doc(cacheDocId).get();
    if (cached.exists) {
      var data = cached.data();
      var createdMs = data.createdAt ? data.createdAt.toMillis() : 0;
      var ageMs = Date.now() - createdMs;
      var examNameMatch = data.examName === examName;
      var dailyTimeMatch = data.dailyTimeMinutes === dailyTimeMinutes;
      if (ageMs < STUDY_PLAN_TTL_DAYS * 24 * 60 * 60 * 1000 && examNameMatch && dailyTimeMatch) {
        return { strategy: data.strategy, weeklyPlan: data.weeklyPlan, dailyStructure: data.dailyStructure, tip: data.tip };
      }
    }
  } catch (cacheErr) {
    console.warn('Study plan cache read failed:', cacheErr.message);
  }

  var weakStr = weakTopics.length > 0 ? weakTopics.join(', ') : 'None identified yet';
  var timeLabel = daysRemaining <= 7 ? 'critical — less than a week' : daysRemaining <= 30 ? 'short — under a month' : daysRemaining <= 60 ? 'moderate — 1-2 months' : 'comfortable — more than 2 months';

  var prompt = 'You are an expert quantitative aptitude coach for competitive exams like CAT, GMAT, CET, and placements.\n\nUser details:\n- Exam: ' + examName + '\n- Days remaining: ' + daysRemaining + ' (' + timeLabel + ')\n- Daily time available: ' + dailyTimeMinutes + ' minutes\n- Weak topics: ' + weakStr + '\n- Current accuracy: ' + accuracy + '%\n\nCreate a SMART and REALISTIC quant study plan.\n\nRequirements:\n- Focus ONLY on quant preparation\n- Prioritize weak areas specifically\n- Keep plan achievable within the given daily time\n- Break into weekly phases proportional to days remaining\n- Use specific topic names (not vague advice)\n- Keep it practical, not theoretical\n- For short timelines (< 14 days), focus on high-impact topics only\n- Reference actual numbers where helpful\n\nReturn ONLY a valid JSON object with exactly these fields:\n{\n  "strategy": "Overall 2-3 sentence approach, referencing the timeline and accuracy",\n  "weeklyPlan": ["Week 1: ...", "Week 2: ...", ...],\n  "dailyStructure": "How to split ' + dailyTimeMinutes + ' minutes per day effectively",\n  "tip": "One powerful, specific improvement tip for this exam"\n}\n\nThe weeklyPlan array must have at least 1 entry and at most 8 entries.\nReturn ONLY the JSON object, no markdown, no explanation, no code fences.';

  var result = await _callAndParse(m, prompt, function (parsed) {
    if (!parsed || typeof parsed.strategy !== 'string') return null;
    if (!Array.isArray(parsed.weeklyPlan) || parsed.weeklyPlan.length < 1) return null;
    if (typeof parsed.dailyStructure !== 'string') return null;
    if (typeof parsed.tip !== 'string') return null;
    return {
      strategy: parsed.strategy,
      weeklyPlan: parsed.weeklyPlan.filter(function (s) { return typeof s === 'string'; }),
      dailyStructure: parsed.dailyStructure,
      tip: parsed.tip
    };
  });

  if (!result) throw new AIServiceError('INVALID_RESPONSE', 'Invalid study plan format after retries', true);

  try {
    await cacheRef.doc(cacheDocId).set({
      userId: userId,
      examName: examName,
      examDate: examDate,
      dailyTimeMinutes: dailyTimeMinutes,
      strategy: result.strategy,
      weeklyPlan: result.weeklyPlan,
      dailyStructure: result.dailyStructure,
      tip: result.tip,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
  } catch (writeErr) {
    console.warn('Study plan cache write failed:', writeErr.message);
  }

  return result;
}

async function clearStudyPlanCache(userId, examDate) {
  try {
    var cacheDocId = userId + '_' + examDate.replace(/[^a-z0-9]/gi, '-');
    await db.collection('aiStudyPlans').doc(cacheDocId).delete();
  } catch (err) {
    console.warn('Study plan cache clear failed:', err.message);
  }
}

module.exports = { generateWordProblems, generateExplanation, generateInsights, generateStudyPlan, clearStudyPlanCache, verifyIdToken, isUserPremium, checkWordProblemQuota, consumeWordProblemQuota, trackExplanationUsage, trackInsightsUsage, AIServiceError };
