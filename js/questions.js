/**
 * questions.js — Random question generator with difficulty scaling
 *
 * Categories:
 *   squares, cubes, fractions-to-percent, percentage-calculations,
 *   mental-multiplication, ratios, averages, profit-loss, time-speed-distance
 *
 * Each generator returns { question: string, answer: number|string, category: string }
 *
 * Difficulty levels: easy, medium, hard
 * Difficulty is read from settings at generation time.
 */

/* ---- helpers ---- */
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Get current difficulty from settings */
function _getDifficulty() {
  try {
    var s = JSON.parse(localStorage.getItem('quant_reflex_settings') || '{}');
    return s.difficulty || 'medium';
  } catch (_) { return 'medium'; }
}

/* ---- category generators ---- */

/** Squares: n² */
function genSquare() {
  var diff = _getDifficulty();
  var n;
  if (diff === 'easy') {
    n = randInt(1, 15);
  } else if (diff === 'hard') {
    n = randInt(10, 50);
  } else {
    n = randInt(1, 30);
  }
  return { question: n + '² = ?', answer: n * n, category: 'squares' };
}

/** Cubes: n³ */
function genCube() {
  var diff = _getDifficulty();
  var n;
  if (diff === 'easy') {
    n = randInt(1, 10);
  } else if (diff === 'hard') {
    n = randInt(5, 15);
  } else {
    n = randInt(1, 12);
  }
  return { question: n + '³ = ?', answer: n * n * n, category: 'cubes' };
}

/** Fractions → percentage (complete table from spec) */
function genFraction() {
  var table = [
    { frac: '1/2', pct: '50' },
    { frac: '1/3', pct: '33.33' },
    { frac: '2/3', pct: '66.66' },
    { frac: '1/4', pct: '25' },
    { frac: '3/4', pct: '75' },
    { frac: '1/5', pct: '20' },
    { frac: '2/5', pct: '40' },
    { frac: '3/5', pct: '60' },
    { frac: '4/5', pct: '80' },
    { frac: '1/6', pct: '16.66' },
    { frac: '5/6', pct: '83.33' },
    { frac: '1/8', pct: '12.5' },
    { frac: '3/8', pct: '37.5' },
    { frac: '5/8', pct: '62.5' },
    { frac: '7/8', pct: '87.5' },
    { frac: '1/9', pct: '11.11' },
    { frac: '2/9', pct: '22.22' },
    { frac: '4/9', pct: '44.44' },
    { frac: '5/9', pct: '55.55' },
    { frac: '7/9', pct: '77.77' },
    { frac: '8/9', pct: '88.88' },
    { frac: '1/10', pct: '10' },
    { frac: '1/11', pct: '9.09' },
    { frac: '2/11', pct: '18.18' },
    { frac: '3/11', pct: '27.27' },
    { frac: '5/11', pct: '45.45' },
    { frac: '9/11', pct: '81.81' },
    { frac: '1/12', pct: '8.33' },
    { frac: '1/15', pct: '6.66' },
    { frac: '1/20', pct: '5' },
    { frac: '1/25', pct: '4' },
    { frac: '1/40', pct: '2.5' },
    { frac: '1/50', pct: '2' }
  ];
  var diff = _getDifficulty();
  var subset;
  if (diff === 'easy') {
    /* Only common fractions */
    subset = table.slice(0, 11);
  } else {
    subset = table;
  }
  var item = pick(subset);
  return { question: item.frac + ' = ?%', answer: item.pct, category: 'fractions' };
}

/** Percentage calculations: x% of y with randomized values */
function genPercentage() {
  var diff = _getDifficulty();
  var percentages, bases;

  if (diff === 'easy') {
    percentages = [5, 10, 20, 25, 50];
    bases = [100, 200, 400, 500, 1000];
  } else if (diff === 'hard') {
    percentages = [5, 8, 12, 15, 18, 20, 25, 30, 37, 40, 50, 60, 75];
    bases = [120, 160, 200, 240, 300, 360, 400, 480, 500, 600, 720, 840, 960, 1000, 1200];
  } else {
    percentages = [5, 10, 12, 15, 20, 25, 30, 40, 50, 60, 75];
    bases = null; /* use original random logic */
  }

  var p, b, result;
  if (bases) {
    /* Pick from curated lists ensuring whole-number results */
    var maxAttempts = 50;
    do {
      p = pick(percentages);
      b = pick(bases);
      result = (p / 100) * b;
      maxAttempts--;
    } while (result !== Math.floor(result) && maxAttempts > 0);
    if (result !== Math.floor(result)) {
      p = 10; b = 200; result = 20;
    }
  } else {
    p = pick(percentages);
    var pctAttempts = 0;
    do {
      b = randInt(2, 20) * pick([10, 20, 25, 50, 100]);
      result = (p / 100) * b;
      pctAttempts++;
    } while (result !== Math.floor(result) && pctAttempts < 50);
    /* Fallback to guaranteed whole-number result */
    if (result !== Math.floor(result)) {
      p = 10; b = 200; result = 20;
    }
  }

  return { question: p + '% of ' + b + ' = ?', answer: result, category: 'percentages' };
}

/** Mental multiplication: x × y */
function genMultiplication() {
  var diff = _getDifficulty();
  var x, y;
  if (diff === 'easy') {
    x = randInt(2, 20);
    y = randInt(2, 12);
  } else if (diff === 'hard') {
    x = randInt(11, 50);
    y = randInt(2, 25);
  } else {
    x = randInt(2, 30);
    y = randInt(2, 20);
  }
  return { question: x + ' × ' + y + ' = ?', answer: x * y, category: 'multiplication' };
}

/** Ratio: percentage increase/decrease expressed as ratio */
function genRatio() {
  var diff = _getDifficulty();
  var scenarios = [
    { q: 'A is 25% more than B. A:B = ?', a: '5:4' },
    { q: 'A is 20% less than B. A:B = ?', a: '4:5' },
    { q: 'A is 50% more than B. A:B = ?', a: '3:2' },
    { q: 'A is 33.33% more than B. A:B = ?', a: '4:3' },
    { q: 'A is 20% more than B. A:B = ?', a: '6:5' },
    { q: 'A is 25% less than B. A:B = ?', a: '3:4' },
    { q: 'A is 40% more than B. A:B = ?', a: '7:5' },
    { q: 'A is 10% less than B. A:B = ?', a: '9:10' },
    { q: 'A is 60% more than B. A:B = ?', a: '8:5' },
    { q: 'A is 75% more than B. A:B = ?', a: '7:4' }
  ];

  if (diff === 'hard') {
    /* Add more CAT-style ratio questions */
    scenarios = scenarios.concat([
      { q: 'A is 12.5% more than B. A:B = ?', a: '9:8' },
      { q: 'A is 16.66% less than B. A:B = ?', a: '5:6' },
      { q: 'A is 37.5% more than B. A:B = ?', a: '11:8' },
      { q: 'A is 11.11% less than B. A:B = ?', a: '8:9' },
      { q: 'A is 66.66% more than B. A:B = ?', a: '5:3' },
      { q: 'A is 150% more than B. A:B = ?', a: '5:2' }
    ]);
  } else if (diff === 'easy') {
    scenarios = scenarios.slice(0, 6);
  }

  var s = pick(scenarios);
  return { question: s.q, answer: s.a, category: 'ratios' };
}

/** Average calculations */
function genAverage() {
  var diff = _getDifficulty();
  var count, minVal, maxVal;

  if (diff === 'easy') {
    count = randInt(3, 4);
    minVal = 10; maxVal = 50;
  } else if (diff === 'hard') {
    /* Include missing number problems */
    if (randInt(0, 1) === 0) {
      return genAverageMissing();
    }
    count = randInt(4, 5);
    minVal = 10; maxVal = 100;
  } else {
    count = randInt(3, 5);
    minVal = 10; maxVal = 80;
  }

  var nums = [];
  for (var i = 0; i < count; i++) nums.push(randInt(minVal, maxVal));
  var sum = nums.reduce(function (a, b) { return a + b; }, 0);
  var avg = sum / count;
  /* Use whole-number averages only */
  if (avg !== Math.floor(avg)) {
    var adjustment = (Math.ceil(avg) * count) - sum;
    nums[0] += adjustment;
    /* Ensure no negative numbers after adjustment */
    if (nums[0] <= 0) {
      nums[0] = minVal;
      sum = nums.reduce(function (a, b) { return a + b; }, 0);
      avg = Math.round(sum / count);
      /* Force the sum to be divisible by count */
      nums[0] += (avg * count) - sum;
    }
    sum = nums.reduce(function (a, b) { return a + b; }, 0);
    avg = sum / count;
  }
  /* Final safety: ensure all numbers are positive and average is integer */
  var allPositive = true;
  for (var j = 0; j < nums.length; j++) {
    if (nums[j] <= 0) { allPositive = false; break; }
  }
  if (!allPositive || avg !== Math.floor(avg)) {
    avg = randInt(15, 60);
    nums = [];
    for (var s = 0; s < count; s++) nums.push(avg);
    sum = avg * count;
  }
  return {
    question: 'Average of ' + nums.join(', ') + ' = ?',
    answer: avg,
    category: 'averages'
  };
}

/** Average - find missing number (hard mode) */
function genAverageMissing() {
  var count = randInt(4, 6);
  var avg = randInt(20, 80);
  var totalSum = avg * count;
  var nums = [];
  var partialSum = 0;
  /* Generate numbers close to the average to keep the missing value reasonable */
  for (var i = 0; i < count - 1; i++) {
    var n = randInt(Math.max(1, avg - 30), avg + 30);
    nums.push(n);
    partialSum += n;
  }
  var missing = totalSum - partialSum;
  /* Regenerate if missing value is negative or unreasonably large */
  if (missing <= 0 || missing > 200) {
    /* Fallback: adjust last known number to make missing value reasonable */
    var target = randInt(Math.max(1, avg - 20), avg + 20);
    nums[nums.length - 1] = totalSum - (partialSum - nums[nums.length - 1]) - target;
    partialSum = nums.reduce(function (a, b) { return a + b; }, 0);
    missing = totalSum - partialSum;
    /* Final fallback */
    if (missing <= 0 || missing > 200) {
      return genAverage();
    }
  }
  /* Safety: ensure all displayed numbers are positive */
  for (var c = 0; c < nums.length; c++) {
    if (nums[c] <= 0) return genAverage();
  }
  return {
    question: 'Average of ' + nums.join(', ') + ', x is ' + avg + '. x = ?',
    answer: missing,
    category: 'averages'
  };
}

/** Profit and Loss calculations with randomized values */
function genProfitLoss() {
  var diff = _getDifficulty();
  var type = randInt(0, 2);

  if (type === 0) {
    /* Find SP given CP and profit% — ensure whole-number result */
    var profitOpts = diff === 'easy' ? [10, 20, 25, 50] : (diff === 'hard' ? [5, 8, 10, 12, 15, 20, 25, 30, 40, 50] : [5, 10, 15, 20, 25, 30, 40, 50]);
    var profitPct = pick(profitOpts);
    var cp, sp;
    var plAttempts = 0;
    do {
      cp = randInt(1, 10) * 100;
      sp = cp * (1 + profitPct / 100);
      plAttempts++;
    } while (sp !== Math.floor(sp) && plAttempts < 30);
    if (sp !== Math.floor(sp)) { cp = 200; profitPct = 25; sp = 250; }
    return { question: 'CP = ' + cp + ', Profit = ' + profitPct + '%. SP = ?', answer: sp, category: 'profit-loss' };
  } else if (type === 1) {
    /* Find SP given CP and loss% — ensure whole-number result */
    var lossOpts = diff === 'easy' ? [10, 20, 25] : [5, 10, 15, 20, 25];
    var lossPct = pick(lossOpts);
    var cp2, sp2;
    var plAttempts2 = 0;
    do {
      cp2 = randInt(1, 10) * 100;
      sp2 = cp2 * (1 - lossPct / 100);
      plAttempts2++;
    } while (sp2 !== Math.floor(sp2) && plAttempts2 < 30);
    if (sp2 !== Math.floor(sp2)) { cp2 = 200; lossPct = 20; sp2 = 160; }
    return { question: 'CP = ' + cp2 + ', Loss = ' + lossPct + '%. SP = ?', answer: sp2, category: 'profit-loss' };
  } else {
    /* Find profit% given CP and SP */
    var cp3 = randInt(1, 10) * 100;
    var profitPct2 = pick([10, 15, 20, 25, 30, 50]);
    var sp3 = Math.round(cp3 * (1 + profitPct2 / 100));
    return { question: 'CP = ' + cp3 + ', SP = ' + sp3 + '. Profit% = ?', answer: profitPct2, category: 'profit-loss' };
  }
}

/** Time, Speed, Distance calculations with randomized values */
function genTSD() {
  var diff = _getDifficulty();
  var type = randInt(0, 2);

  if (type === 0) {
    /* Find distance given speed and time */
    var sMin = diff === 'easy' ? 2 : (diff === 'hard' ? 3 : 2);
    var sMax = diff === 'easy' ? 8 : (diff === 'hard' ? 15 : 12);
    var tMax = diff === 'easy' ? 5 : (diff === 'hard' ? 10 : 8);
    var speed = randInt(sMin, sMax) * 10;
    var time = randInt(2, tMax);
    return { question: 'Speed = ' + speed + ' km/h, Time = ' + time + ' hrs. Distance = ?', answer: speed * time, category: 'time-speed-distance' };
  } else if (type === 1) {
    /* Find time given speed and distance */
    var speed2 = randInt(2, 10) * 10;
    var time2 = randInt(2, 6);
    var dist = speed2 * time2;
    return { question: 'Speed = ' + speed2 + ' km/h, Distance = ' + dist + ' km. Time = ?', answer: time2, category: 'time-speed-distance' };
  } else {
    /* Find speed given distance and time */
    var speed3 = randInt(2, 12) * 10;
    var time3 = randInt(2, 6);
    var dist2 = speed3 * time3;
    return { question: 'Distance = ' + dist2 + ' km, Time = ' + time3 + ' hrs. Speed = ?', answer: speed3, category: 'time-speed-distance' };
  }
}

/* ---- category map for focus training ---- */
var categoryGenerators = {
  squares: genSquare,
  cubes: genCube,
  fractions: genFraction,
  percentages: genPercentage,
  multiplication: genMultiplication,
  ratios: genRatio,
  averages: genAverage,
  'profit-loss': genProfitLoss,
  'time-speed-distance': genTSD
};

/* ---- public API ---- */

var generators = [genSquare, genCube, genFraction, genPercentage, genMultiplication,
  genRatio, genAverage, genProfitLoss, genTSD];

/**
 * Generate a single random question (all categories).
 * @returns {{ question: string, answer: number|string, category: string }}
 */
function generateQuestion() {
  return pick(generators)();
}

/**
 * Generate an array of n random questions with deduplication.
 * Tracks recently asked questions within the session to avoid repeats.
 * @param {number} n
 * @param {string} [category] - optional category filter
 * @returns {Array<{ question: string, answer: number|string, category: string }>}
 */
function generateQuestions(n, category) {
  var gen = category && categoryGenerators[category] ? categoryGenerators[category] : null;
  var qs = [];
  var seen = {}; /* track question strings to avoid repeats */
  var maxAttempts = n * 5; /* prevent infinite loops */
  var attempts = 0;

  while (qs.length < n && attempts < maxAttempts) {
    var q = gen ? gen() : generateQuestion();
    attempts++;
    /* Skip if we've already generated this exact question */
    if (seen[q.question]) continue;
    seen[q.question] = true;
    qs.push(q);
  }

  /* Fill remaining if deduplication exhausted attempts */
  while (qs.length < n) {
    qs.push(gen ? gen() : generateQuestion());
  }

  return qs;
}

/**
 * Generate questions from mistake history for review mode.
 * @param {number} n - max number of questions
 * @returns {Array<{ question: string, answer: number|string, category: string }>}
 */
function generateMistakeReviewQuestions(n) {
  var mistakes = getMistakes();
  if (mistakes.length === 0) return [];

  /* Shuffle and take up to n */
  var shuffled = mistakes.slice();
  for (var i = shuffled.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var temp = shuffled[i];
    shuffled[i] = shuffled[j];
    shuffled[j] = temp;
  }

  return shuffled.slice(0, n).map(function (m) {
    return { question: m.question, answer: m.answer, category: m.category };
  });
}
