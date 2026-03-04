/**
 * tables.js — Dynamically generates multiplication tables
 *
 * Generates multiplication tables from 1 to maxNum (default 30).
 * Each table shows n × 1 through n × 10.
 * Results are rendered as cards inside the given container element.
 */

/**
 * Render multiplication tables into the given container.
 * @param {HTMLElement} container - Element to render tables into
 * @param {number}      maxNum   - Highest table to generate (default 30)
 */
function renderMultiplicationTables(container, maxNum) {
  maxNum = maxNum || 30;

  for (var n = 1; n <= maxNum; n++) {
    /* Create a card for each table */
    var card = document.createElement('div');
    card.className = 'table-card';

    var title = document.createElement('h4');
    title.className = 'table-title';
    title.textContent = 'Table of ' + n;
    card.appendChild(title);

    var table = document.createElement('table');
    table.className = 'shortcut-table';

    for (var i = 1; i <= 10; i++) {
      var row = document.createElement('tr');
      row.innerHTML = '<td>' + n + ' × ' + i + '</td><td>= ' + (n * i) + '</td>';
      table.appendChild(row);
    }

    card.appendChild(table);
    container.appendChild(card);
  }
}
