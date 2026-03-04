/**
 * tables.js — Dynamically generates multiplication tables
 *
 * Generates multiplication tables from 1 to maxNum (default 30).
 * Each table shows n × 1 through n × 10.
 * Provides a selector UI so users can choose which tables to view.
 * Supports triple-tap to open expanded modal view.
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
 * Build aligned table rows HTML for a given number.
 * @param {number} n     - Table number
 * @param {number} maxI  - Multiplier range (default 10)
 * @returns {string} HTML rows
 */
function _buildTableRows(n, maxI) {
  maxI = maxI || 10;
  var maxResult = n * maxI;
  var nWidth = String(n).length;
  var iWidth = String(maxI).length;
  var rWidth = String(maxResult).length;
  var html = '';
  for (var i = 1; i <= maxI; i++) {
    html += '<tr><td>' +
      padTableNum(n, nWidth) + ' × ' + padTableNum(i, iWidth) +
      ' = ' + padTableNum(n * i, rWidth) +
      '</td></tr>';
  }
  return html;
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
  table.innerHTML = _buildTableRows(n);

  card.appendChild(table);
  container.appendChild(card);

  /* Triple-tap detection */
  _attachTripleTap(card, n);
}

/** Helper: pad number with non-breaking spaces for alignment */
function padTableNum(n, width) {
  var s = String(n);
  while (s.length < width) s = '\u00A0' + s;
  return s;
}

/**
 * Triple-tap detection: opens expanded modal on 3 rapid taps.
 * @param {HTMLElement} card - The table card element
 * @param {number}      n   - Table number
 */
function _attachTripleTap(card, n) {
  var tapCount = 0;
  var tapTimer = null;
  var TAP_WINDOW = 500; /* ms window for 3 taps */

  function resetTaps() {
    tapCount = 0;
    if (tapTimer) { clearTimeout(tapTimer); tapTimer = null; }
  }

  card.addEventListener('click', function (e) {
    /* Ignore if event target is a button or link inside the card */
    if (e.target.closest('button, a')) return;
    tapCount++;
    if (tapCount === 1) {
      tapTimer = setTimeout(resetTaps, TAP_WINDOW);
    }
    if (tapCount >= 3) {
      resetTaps();
      _openTableModal(n);
    }
  });
}

/**
 * Open expanded table modal for comfortable viewing.
 * @param {number} n - Table number
 */
function _openTableModal(n) {
  /* Prevent duplicate modals */
  if (document.querySelector('.table-modal-overlay')) return;

  SoundEngine.play('tableModal');

  var overlay = document.createElement('div');
  overlay.className = 'table-modal-overlay';

  var modal = document.createElement('div');
  modal.className = 'table-modal-content';

  /* Close button */
  var closeBtn = document.createElement('button');
  closeBtn.className = 'table-modal-close';
  closeBtn.textContent = '✕';
  closeBtn.setAttribute('aria-label', 'Close');
  modal.appendChild(closeBtn);

  /* Title */
  var title = document.createElement('h3');
  title.className = 'table-modal-title';
  title.textContent = 'Table of ' + n;
  modal.appendChild(title);

  /* Enlarged table */
  var table = document.createElement('table');
  table.className = 'math-table mono-table';
  table.innerHTML = _buildTableRows(n);
  modal.appendChild(table);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  function closeModal() {
    SoundEngine.play('tableModal');
    overlay.classList.add('closing');
    document.removeEventListener('keydown', handleEscape);
    setTimeout(function () {
      if (overlay.parentNode) overlay.remove();
    }, 200);
  }

  function handleEscape(e) {
    if (e.key === 'Escape') closeModal();
  }

  closeBtn.addEventListener('click', closeModal);
  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) closeModal();
  });
  document.addEventListener('keydown', handleEscape);
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
