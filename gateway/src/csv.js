'use strict';

// Hand-rolled RFC 4180 CSV (M24) — deliberately no dependency. Every cell is
// quoted, embedded quotes are doubled, records end in CRLF. The first row is
// the header, taken from the keys of the `columns` spec.

function cell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return `"${s.replace(/"/g, '""')}"`;
}

// columns: array of header names; rows: array of objects keyed by header.
function toCsv(columns, rows) {
  const lines = [columns.map(cell).join(',')];
  for (const row of rows) {
    lines.push(columns.map((c) => cell(row[c])).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

module.exports = { toCsv };
