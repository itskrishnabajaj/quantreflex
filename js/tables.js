/**
 * tables.js — Dynamically generates multiplication tables
 *
 * Generates multiplication tables from 1 to maxNum (default 30).
 * Each table shows n × 1 through n × 10.
 * Provides a selector UI so users can choose which tables to view.
 */

/**
 * Render a table selector and display area.
 * Users can tap number buttons to show/hide individual tables.
 * @param {HTMLElement} selectorContainer - Element for number buttons
 * @param {HTMLElement} displayContainer  - Element for rendered tables
 * @param {number}      maxNum            - Highest table to generate (default 30)
 */
function renderTableSelector(selectorContainer, displayContainer, maxNum) {
  maxNum = maxNum || 30;

  /* Build selector buttons */
  for (var n = 1; n <= maxNum; n++) {
    var btn = document.createElement('button');
    btn.className = 'table-select-btn';
    btn.textContent = n;
    btn.setAttribute('data-table', n);
    btn.addEventListener('click', (function (num) {
      return function () {
        this.classList.toggle('active');
        toggleTableDisplay(displayContainer, num);
      };
    })(n));
    selectorContainer.appendChild(btn);
  }

  /* Show All / Clear All buttons */
  var controls = document.createElement('div');
  controls.className = 'table-controls';
  controls.innerHTML =
    '<button class="btn" id="showAllTables" style="font-size:.85rem;padding:.5rem;">Show All</button>' +
    '<button class="btn" id="clearAllTables" style="font-size:.85rem;padding:.5rem;">Clear All</button>';
  selectorContainer.appendChild(controls);

  controls.querySelector('#showAllTables').addEventListener('click', function () {
    var btns = selectorContainer.querySelectorAll('.table-select-btn');
    displayContainer.innerHTML = '';
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.add('active');
      renderSingleTable(displayContainer, parseInt(btns[i].getAttribute('data-table')));
    }
  });

  controls.querySelector('#clearAllTables').addEventListener('click', function () {
    var btns = selectorContainer.querySelectorAll('.table-select-btn');
    for (var i = 0; i < btns.length; i++) btns[i].classList.remove('active');
    displayContainer.innerHTML = '';
  });
}

/**
 * Toggle display of a single multiplication table.
 * @param {HTMLElement} container - Display container
 * @param {number}      num      - Table number to toggle
 */
function toggleTableDisplay(container, num) {
  var existing = container.querySelector('[data-table-card="' + num + '"]');
  if (existing) {
    existing.remove();
  } else {
    renderSingleTable(container, num);
  }
}

/**
 * Render a single multiplication table card into the container.
 * @param {HTMLElement} container - Display container
 * @param {number}      n        - Table number
 */
function renderSingleTable(container, n) {
  var card = document.createElement('div');
  card.className = 'table-card';
  card.setAttribute('data-table-card', n);

  var title = document.createElement('h4');
  title.className = 'table-title';
  title.textContent = 'Table of ' + n;
  card.appendChild(title);

  var table = document.createElement('table');
  table.className = 'math-table mono-table';

  for (var i = 1; i <= 10; i++) {
    var row = document.createElement('tr');
    row.innerHTML = '<td>' + n + ' × ' + i + ' = ' + (n * i) + '</td>';
    table.appendChild(row);
  }

  card.appendChild(table);
  container.appendChild(card);
}

/** Helper: pad number with non-breaking spaces for alignment */
function padTableNum(n, width) {
  var s = String(n);
  while (s.length < width) s = '\u00A0' + s;
  return s;
}

/**
 * Legacy function: Render all multiplication tables at once.
 * @param {HTMLElement} container - Element to render tables into
 * @param {number}      maxNum   - Highest table to generate (default 30)
 */
function renderMultiplicationTables(container, maxNum) {
  maxNum = maxNum || 30;
  for (var n = 1; n <= maxNum; n++) {
    renderSingleTable(container, n);
  }
}
