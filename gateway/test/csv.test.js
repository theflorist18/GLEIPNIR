'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { toCsv } = require('../src/csv');

test('toCsv: RFC 4180 — all cells quoted, quotes doubled, CRLF endings', () => {
  const out = toCsv(['a', 'b'], [
    { a: 'plain', b: 'with "quotes"' },
    { a: 'comma, inside', b: 'line\nbreak' },
    { a: null, b: undefined },
  ]);
  const lines = out.split('\r\n');
  assert.equal(lines[0], '"a","b"');
  assert.equal(lines[1], '"plain","with ""quotes"""');
  assert.equal(lines[2], '"comma, inside","line\nbreak"');
  assert.equal(lines[3], '"",""');
  assert.equal(lines[4], ''); // trailing CRLF
  assert.ok(out.endsWith('\r\n'));
});

test('toCsv: header-only for zero rows', () => {
  assert.equal(toCsv(['x'], []), '"x"\r\n');
});

// S10: spreadsheet formula-injection neutralisation. A cell whose value begins
// = + - @ TAB or CR is a formula in Excel/Sheets; it must be prefixed with a
// single quote so it renders literally, while ordinary cells are unchanged.
test('toCsv: neutralises leading formula characters', () => {
  const out = toCsv(['f'], [
    { f: '=HYPERLINK("http://evil","x")' },
    { f: '+1+2' },
    { f: '-2+3' },
    { f: '@SUM(A1)' },
    { f: '\tTAB' },
  ]);
  const lines = out.split('\r\n');
  assert.equal(lines[1], '"\'=HYPERLINK(""http://evil"",""x"")"');
  assert.equal(lines[2], '"\'+1+2"');
  assert.equal(lines[3], '"\'-2+3"');
  assert.equal(lines[4], '"\'@SUM(A1)"');
  assert.equal(lines[5], '"\'\tTAB"');
});

test('toCsv: leaves ordinary values untouched (no spurious quote prefix)', () => {
  const out = toCsv(['f'], [{ f: 'ITEM-001' }, { f: 'disk.img' }, { f: 'exhibit A' }]);
  const lines = out.split('\r\n');
  assert.equal(lines[1], '"ITEM-001"'); // a hyphen NOT at position 0 is fine
  assert.equal(lines[2], '"disk.img"');
  assert.equal(lines[3], '"exhibit A"');
});
