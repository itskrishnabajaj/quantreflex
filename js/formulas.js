/**
 * formulas.js — Formulas and shortcuts data for the Learn page
 *
 * Provides structured data for rendering topic-wise quant study material.
 */

function _buildFormulaTopic(title, id, items) {
  var html = '';
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    html += '<div class="formula-block">';
    html += '<h4 class="formula-block-title">' + item.title + '</h4>';
    html += '<div class="formula-label">Formula:</div>';
    html += '<p class="formula-text">' + item.formula + '</p>';
    if (item.tip) {
      html += '<div class="formula-label">Tip:</div>';
      html += '<p class="formula-tip">' + item.tip + '</p>';
    }
    html += '</div>';
  }
  return { title: title, id: id, content: html };
}

/**
 * Get all formula sections for the Learn page (Topic Wise Quant).
 * @returns {Array<{title: string, id: string, content: string}>}
 */
function getFormulaSections() {
  return [
    _buildFormulaTopic('📊 Percentages', 'percentageTricks', [
      { title: 'Percentage of a number', formula: 'x% of y = (x × y) / 100', tip: 'Use this when both percentage and base value are given.' },
      { title: 'Percentage change', formula: '% change = ((New − Old) / Old) × 100', tip: 'Positive result means increase; negative means decrease.' },
      { title: 'Successive percentage change', formula: 'Net change = a + b + (a × b) / 100', tip: 'Quickly combines two percentage changes.' },
      { title: 'Percentage to ratio (more)', formula: 'If A is p% more than B, then A:B = (100 + p) : 100', tip: 'Simplify ratio after substitution.' },
      { title: 'Percentage to ratio (less)', formula: 'If A is p% less than B, then A:B = (100 − p) : 100', tip: 'Useful for comparison-based DI and arithmetic sets.' }
    ]),
    _buildFormulaTopic('💰 Profit & Loss', 'profitLoss', [
      { title: 'Selling price with profit', formula: 'SP = CP × (1 + Profit% / 100)', tip: 'Convert percentage to multiplier first.' },
      { title: 'Selling price with loss', formula: 'SP = CP × (1 − Loss% / 100)', tip: 'Loss always reduces CP by a fraction.' },
      { title: 'Profit percentage', formula: 'Profit% = ((SP − CP) / CP) × 100', tip: 'CP is always the denominator.' },
      { title: 'Loss percentage', formula: 'Loss% = ((CP − SP) / CP) × 100', tip: 'Use when SP is lower than CP.' },
      { title: 'Successive discount', formula: 'Equivalent discount = d₁ + d₂ − (d₁ × d₂) / 100', tip: 'Avoid applying discount one by one in exam time.' }
    ]),
    _buildFormulaTopic('⚖️ Ratio & Proportion', 'ratioAverage', [
      { title: 'Part from ratio', formula: 'If A:B = x:y, then A = (x / (x + y)) × Total', tip: 'Same method works for more than 2 parts.' },
      { title: 'Proportion check', formula: 'a:b = c:d  ⇔  a × d = b × c', tip: 'Cross multiplication gives quick validation.' },
      { title: 'Alligation', formula: 'Required ratio = (Higher − Mean) : (Mean − Lower)', tip: 'Best for mixture and weighted average questions.' }
    ]),
    _buildFormulaTopic('📈 Averages', 'averages', [
      { title: 'Basic average', formula: 'Average = Sum of values / Number of values', tip: 'Rearrange to get sum quickly: Sum = Average × Count.' },
      { title: 'Weighted average', formula: 'Average = (n₁a₁ + n₂a₂ + …) / (n₁ + n₂ + …)', tip: 'Multiply each group average by its frequency.' },
      { title: 'Replacement average', formula: 'New average = Old average + (New value − Old value) / n', tip: 'Very useful when one item changes in a dataset.' }
    ]),
    _buildFormulaTopic('📐 Area', 'area', [
      { title: 'Square', formula: 'Area = a²', tip: 'Use when side length is known.' },
      { title: 'Rectangle', formula: 'Area = l × b', tip: 'Works directly with length and breadth.' },
      { title: 'Triangle', formula: 'Area = (1/2) × base × height', tip: 'Height must be perpendicular to the base.' },
      { title: 'Circle', formula: 'Area = πr²', tip: 'Use π = 22/7 or 3.14 based on question context.' },
      { title: 'Parallelogram', formula: 'Area = base × height', tip: 'Same base-height concept as rectangle.' },
      { title: 'Trapezium', formula: 'Area = (1/2) × (a + b) × height', tip: 'a and b are the parallel sides.' }
    ]),
    _buildFormulaTopic('🧊 Volume', 'volume', [
      { title: 'Cube', formula: 'Volume = a³', tip: 'All edges are equal in a cube.' },
      { title: 'Cuboid', formula: 'Volume = l × b × h', tip: 'Multiply all three dimensions.' },
      { title: 'Cylinder', formula: 'Volume = πr²h', tip: 'Area of base × height.' },
      { title: 'Sphere', formula: 'Volume = (4/3)πr³', tip: 'Remember the 4/3 multiplier.' },
      { title: 'Cone', formula: 'Volume = (1/3)πr²h', tip: 'Exactly one-third of corresponding cylinder.' }
    ]),
    _buildFormulaTopic('🔧 Time & Work', 'timeWork', [
      { title: 'Work relation', formula: 'Work done = Efficiency × Time', tip: 'If work is fixed, efficiency is inversely proportional to time.' },
      { title: 'Combined work', formula: 'If A in x days and B in y days, then together time T = xy / (x + y)', tip: 'Derived from 1/x + 1/y = 1/T.' },
      { title: 'Man-days concept', formula: 'Men × Days = Constant work', tip: 'Use for worker variation problems.' }
    ]),
    _buildFormulaTopic('🚀 Time, Speed & Distance', 'tsd', [
      { title: 'Core relation', formula: 'Speed = Distance / Time', tip: 'Also use Distance = Speed × Time and Time = Distance / Speed.' },
      { title: 'Relative speed', formula: 'Same direction: |S₁ − S₂|, Opposite direction: S₁ + S₂', tip: 'Apply for trains and chase problems.' },
      { title: 'Average speed (equal distances)', formula: 'Average speed = (2xy) / (x + y)', tip: 'Do not use simple mean unless times are equal.' },
      { title: 'Unit conversion', formula: 'km/h to m/s = × 5/18,  m/s to km/h = × 18/5', tip: 'Convert before substituting values.' }
    ])
  ];
}
