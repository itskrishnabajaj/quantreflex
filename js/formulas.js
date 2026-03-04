/**
 * formulas.js — Formulas and shortcuts data for the Learn page
 *
 * Provides structured data for rendering topic-wise quant study material.
 * Each section includes formulas, shortcut tricks, and examples.
 */

/**
 * Get all formula sections for the Learn page (Topic Wise Quant).
 * @returns {Array<{title: string, id: string, content: string}>}
 */
function getFormulaSections() {
  return [
    {
      title: '📊 Percentages',
      id: 'percentageTricks',
      content:
        '<h4>Key Formulas</h4>' +
        '<p class="formula-text">x% of y = (x × y) / 100</p>' +
        '<p class="formula-text">% change = ((New − Old) / Old) × 100</p>' +
        '<h4>Successive Percentage Change</h4>' +
        '<p class="formula-text">Net change = a + b + (a × b) / 100</p>' +
        '<h4>Percentage ↔ Ratio</h4>' +
        '<table class="math-table">' +
          '<tr><th>Statement</th><th>Ratio</th></tr>' +
          '<tr><td>A is 25% more than B</td><td>A:B = 5:4</td></tr>' +
          '<tr><td>A is 20% less than B</td><td>A:B = 4:5</td></tr>' +
          '<tr><td>A is 50% more than B</td><td>A:B = 3:2</td></tr>' +
          '<tr><td>A is 33.33% more than B</td><td>A:B = 4:3</td></tr>' +
        '</table>' +
        '<h4>Common % → Fraction</h4>' +
        '<table class="math-table">' +
          '<tr><th>Percentage</th><th>Fraction</th></tr>' +
          '<tr><td>12.5%</td><td>1/8</td></tr>' +
          '<tr><td>20%</td><td>1/5</td></tr>' +
          '<tr><td>25%</td><td>1/4</td></tr>' +
          '<tr><td>33.33%</td><td>1/3</td></tr>' +
          '<tr><td>50%</td><td>1/2</td></tr>' +
          '<tr><td>66.66%</td><td>2/3</td></tr>' +
          '<tr><td>75%</td><td>3/4</td></tr>' +
        '</table>'
    },
    {
      title: '💰 Profit & Loss',
      id: 'profitLoss',
      content:
        '<h4>Key Formulas</h4>' +
        '<table class="math-table">' +
          '<tr><th>Formula</th><th>Expression</th></tr>' +
          '<tr><td>SP (Profit)</td><td>CP × (1 + Profit% / 100)</td></tr>' +
          '<tr><td>SP (Loss)</td><td>CP × (1 − Loss% / 100)</td></tr>' +
          '<tr><td>Profit%</td><td>((SP − CP) / CP) × 100</td></tr>' +
          '<tr><td>Loss%</td><td>((CP − SP) / CP) × 100</td></tr>' +
          '<tr><td>Successive Discount</td><td>d₁ + d₂ − (d₁ × d₂) / 100</td></tr>' +
        '</table>' +
        '<h4>Quick Example</h4>' +
        '<p class="formula-text">CP = 200, Profit = 25% → SP = 200 × 1.25 = 250</p>'
    },
    {
      title: '⚖️ Ratio & Proportion',
      id: 'ratioAverage',
      content:
        '<h4>Key Formulas</h4>' +
        '<p class="formula-text">If A:B = x:y, then A = x/(x+y) × Total</p>' +
        '<h4>Alligation Rule (Mixtures)</h4>' +
        '<p class="formula-text">Ratio = (Higher − Mean) : (Mean − Lower)</p>' +
        '<p class="secondary-text">Used for mixture problems to find the ratio of mixing.</p>' +
        '<h4>Quick Example</h4>' +
        '<p class="formula-text">Mix ₹40/kg and ₹60/kg to get ₹45/kg → (60−45):(45−40) = 15:5 = 3:1</p>'
    },
    {
      title: '📈 Averages',
      id: 'averages',
      content:
        '<h4>Key Formulas</h4>' +
        '<p class="formula-text">Average = Sum of values / Number of values</p>' +
        '<h4>Weighted Average</h4>' +
        '<p class="formula-text">Avg = (n₁×a₁ + n₂×a₂) / (n₁ + n₂)</p>' +
        '<h4>Replacement Formula</h4>' +
        '<p class="formula-text">New avg = Old avg + (New − Old) / n</p>' +
        '<h4>Quick Example</h4>' +
        '<p class="formula-text">Avg of 5 numbers is 20. One number (15) replaced by 25 → New avg = 20 + (25−15)/5 = 22</p>'
    },
    {
      title: '🔧 Time & Work',
      id: 'timeWork',
      content:
        '<h4>Key Formulas</h4>' +
        '<table class="math-table">' +
          '<tr><th>Concept</th><th>Formula</th></tr>' +
          '<tr><td>Efficiency</td><td>∝ 1/Time taken</td></tr>' +
          '<tr><td>Work done</td><td>Efficiency × Time</td></tr>' +
          '<tr><td>A + B together</td><td>1/A + 1/B = 1/T</td></tr>' +
          '<tr><td>LCM Method</td><td>Take LCM of days, assign units of work</td></tr>' +
        '</table>' +
        '<h4>Quick Example</h4>' +
        '<p class="formula-text">A finishes in 10 days, B in 15 days. Together: LCM=30, A=3u/day, B=2u/day → 30/5 = 6 days</p>'
    },
    {
      title: '🚀 Time, Speed & Distance',
      id: 'tsd',
      content:
        '<h4>Key Formulas</h4>' +
        '<table class="math-table">' +
          '<tr><th>Formula</th><th>Expression</th></tr>' +
          '<tr><td>Speed</td><td>Distance / Time</td></tr>' +
          '<tr><td>Distance</td><td>Speed × Time</td></tr>' +
          '<tr><td>Time</td><td>Distance / Speed</td></tr>' +
          '<tr><td>Relative Speed (same dir)</td><td>|S₁ − S₂|</td></tr>' +
          '<tr><td>Relative Speed (opp dir)</td><td>S₁ + S₂</td></tr>' +
          '<tr><td>Avg Speed (equal dist)</td><td>2xy / (x + y)</td></tr>' +
          '<tr><td>Train crossing platform</td><td>Time = (L_train + L_platform) / Speed</td></tr>' +
          '<tr><td>Train crossing person</td><td>Time = L_train / Speed</td></tr>' +
        '</table>' +
        '<h4>Unit Conversions</h4>' +
        '<p class="formula-text">km/h → m/s: multiply by 5/18</p>' +
        '<p class="formula-text">m/s → km/h: multiply by 18/5</p>' +
        '<h4>Quick Example</h4>' +
        '<p class="formula-text">Speed = 60 km/h, Time = 3 hrs → Distance = 60 × 3 = 180 km</p>'
    }
  ];
}
