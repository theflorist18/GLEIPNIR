'use strict';

// CONTRACTS §4: audit/merkle.js is a byte-identical copy of the services'
// merkle.js (itself pinned identical between merkle-batcher and verification).
// Drift here would make reconstruct.js "verify" against a different hash
// function than the one that produced the receipts.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const here = fs.readFileSync(path.join(__dirname, '..', 'audit', 'merkle.js'));

for (const svc of ['merkle-batcher', 'verification']) {
  test(`audit/merkle.js is byte-identical to services/${svc}/src/merkle.js`, () => {
    const other = fs.readFileSync(path.join(__dirname, '..', '..', 'services', svc, 'src', 'merkle.js'));
    assert.equal(here.equals(other), true,
      `benchmark/audit/merkle.js has diverged from services/${svc}/src/merkle.js — copy the services' file over it`);
  });
}
