/**
 * questions.js — Random question generator
 *
 * Categories:
 *   squares, cubes, fractions-to-percent,
 *   percentage-calculations, mental-multiplication
 *
 * Each generator returns { question: string, answer: number|string }
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
  const n = randInt(1, 30);
  return { question: `${n}² = ?`, answer: n * n };
}

/** Cubes: n³ where n ∈ [1, 15] */
function genCube() {
  const n = randInt(1, 15);
  return { question: `${n}³ = ?`, answer: n * n * n };
}

/** Fractions → percentage (complete table from spec) */
function genFraction() {
  const table = [
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
  const item = pick(table);
  return { question: `${item.frac} = ?%`, answer: item.pct };
}

/** Percentage calculations: x% of y */
function genPercentage() {
  const pcts = [10, 15, 20, 25, 30, 50];
  const bases = [120, 200, 250, 300, 400, 450, 500, 600, 800, 1000];
  const p = pick(pcts);
  const b = pick(bases);
  return { question: `${p}% of ${b} = ?`, answer: (p / 100) * b };
}

/** Mental multiplication tricks: x × 5, x × 25, x × 125 */
function genMultiplication() {
  const multipliers = [5, 25, 125];
  const m = pick(multipliers);
  const x = randInt(2, 64);
  return { question: `${x} × ${m} = ?`, answer: x * m };
}

/* ---- public API ---- */

const generators = [genSquare, genCube, genFraction, genPercentage, genMultiplication];

/**
 * Generate a single random question.
 * @returns {{ question: string, answer: number|string }}
 */
function generateQuestion() {
  return pick(generators)();
}

/**
 * Generate an array of n random questions.
 * @param {number} n
 * @returns {Array<{ question: string, answer: number|string }>}
 */
function generateQuestions(n) {
  const qs = [];
  for (let i = 0; i < n; i++) qs.push(generateQuestion());
  return qs;
}
