'use strict';

// Hand-rolled RFC 4180 CSV (M24) — deliberately no dependency. Every cell is
// quoted, embedded quotes are doubled, records end in CRLF. The first row is
// the header, taken from the keys of the `columns` spec.

// Spreadsheet formula-injection neutralisation (S10). User-controlled fields
// (evidence label, original filename, acquisition location, handed-over-by,
// case name, note/transfer text) flow into the CoC export, which a lead opens
// in Excel/Sheets — the intended workflow. A value beginning = + - @ TAB or CR
// is interpreted as a formula there (e.g. =HYPERLINK / a DDE payload). Prefix
// such values with a single quote so the cell renders literally. This is done
// BEFORE RFC-4180 quoting and does not affect any machine consumer (nothing
// re-parses these exports).
function neutralize(s) {
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

function cell(v) {
  const s = neutralize(v === null || v === undefined ? '' : String(v));
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
