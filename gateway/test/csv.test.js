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
