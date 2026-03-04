/**
 * questions.js — Random question generator
 *
 * Categories:
 *   squares, cubes, fractions-to-percent, percentage-calculations,
 *   mental-multiplication, ratios, averages, profit-loss, time-speed-distance
 *
 * Each generator returns { question: string, answer: number|string, category: string }
 */

/* ---- helpers ---- */
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/* ---- category generators ---- */

/** Squares: n² where n ∈ [1, 30] */
function genSquare() {
  var n = randInt(1, 30);
  return { question: n + '² = ?', answer: n * n, category: 'squares' };
}

/** Cubes: n³ where n ∈ [1, 20] */
function genCube() {
  var n = randInt(1, 20);
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
    { frac: '1/12', pct: '8.33' },
    { frac: '1/15', pct: '6.66' },
    { frac: '1/20', pct: '5' },
    { frac: '1/25', pct: '4' },
    { frac: '1/40', pct: '2.5' },
    { frac: '1/50', pct: '2' }
  ];
  var item = pick(table);
  return { question: item.frac + ' = ?%', answer: item.pct, category: 'fractions' };
}

/** Percentage calculations: x% of y with randomized values */
function genPercentage() {
  var p = pick([5, 10, 12, 15, 20, 25, 30, 40, 50, 60, 75]);
  var b = randInt(2, 20) * pick([10, 25, 50]);
  var result = (p / 100) * b;
  /* Ensure whole-number result for clean mental math */
  if (result !== Math.floor(result)) {
    b = randInt(2, 10) * 100;
    result = (p / 100) * b;
  }
  return { question: p + '% of ' + b + ' = ?', answer: result, category: 'percentages' };
}

/** Mental multiplication: x × m */
function genMultiplication() {
  var x = randInt(2, 99);
  var y = randInt(2, 50);
  return { question: x + ' × ' + y + ' = ?', answer: x * y, category: 'multiplication' };
}

/** Ratio: percentage increase/decrease expressed as ratio */
function genRatio() {
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
  var s = pick(scenarios);
  return { question: s.q, answer: s.a, category: 'ratios' };
}

/** Average calculations */
function genAverage() {
  var count = randInt(3, 6);
  var nums = [];
  for (var i = 0; i < count; i++) nums.push(randInt(10, 100));
  var sum = nums.reduce(function (a, b) { return a + b; }, 0);
  var avg = sum / count;
  /* Use whole-number averages only */
  if (avg !== Math.floor(avg)) {
    nums[0] += (Math.ceil(avg) * count) - sum;
    sum = nums.reduce(function (a, b) { return a + b; }, 0);
    avg = sum / count;
  }
  return {
    question: 'Average of ' + nums.join(', ') + ' = ?',
    answer: avg,
    category: 'averages'
  };
}

/** Profit and Loss calculations with randomized values */
function genProfitLoss() {
  var type = randInt(0, 2);
  if (type === 0) {
    /* Find SP given CP and profit% */
    var cp = randInt(1, 10) * pick([50, 100, 200]);
    var profitPct = pick([5, 10, 15, 20, 25, 30, 40, 50]);
    var sp = cp * (1 + profitPct / 100);
    return { question: 'CP = ' + cp + ', Profit = ' + profitPct + '%. SP = ?', answer: sp, category: 'profit-loss' };
  } else if (type === 1) {
    /* Find SP given CP and loss% */
    var cp2 = randInt(1, 10) * pick([50, 100, 200]);
    var lossPct = pick([5, 10, 15, 20, 25]);
    var sp2 = cp2 * (1 - lossPct / 100);
    return { question: 'CP = ' + cp2 + ', Loss = ' + lossPct + '%. SP = ?', answer: sp2, category: 'profit-loss' };
  } else {
    /* Find profit% given CP and SP */
    var cp3 = randInt(1, 10) * 100;
    var profitPct2 = pick([10, 15, 20, 25, 30, 50]);
    var sp3 = cp3 * (1 + profitPct2 / 100);
    return { question: 'CP = ' + cp3 + ', SP = ' + sp3 + '. Profit% = ?', answer: profitPct2, category: 'profit-loss' };
  }
}

/** Time, Speed, Distance calculations with randomized values */
function genTSD() {
  var type = randInt(0, 2);
  if (type === 0) {
    /* Find distance given speed and time */
    var speed = randInt(2, 12) * 10;
    var time = randInt(2, 8);
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
