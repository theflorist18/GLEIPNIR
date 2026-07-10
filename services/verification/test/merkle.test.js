'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { canonicalJSON, leafHash, interiorHash, computeRoot, verifyPath } = require('../src/merkle');

// Normative vectors from docs/CONTRACTS.md §4 — MUST match the merkle-batcher.
const V1_ROOT = '015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862';
const V2 = {
  L0: 'e9f74e715a1806aa651489dcf176e77013b3c851dbc114cc9c24f2fe9d411d65',
  L1: '0b549edd218c251f511934cc2f3bc5c7f4780e27af6b8ab4ae8d92cd94121b4a',
  L2: '38f38fbef725fffb9fa39683d9e50f05ca8c61130c2da2322f9e9021007a2abf',
  PARENT_L0_L1: '4a89ef3715145c84282de7016b554021cd5019c03446f069e6061efbac670266',
  ROOT: 'c859dbaf0c89a0c3d8acd14558d491171dd4381073d79935182301300d296d2f',
};

// CONTRACTS §4: the two merkle.js copies MUST be byte-identical. This is the
// enforcement mechanism (audit F5) — semantic drift starts as byte drift.
test('merkle.js is byte-identical to the merkle-batcher copy', () => {
  const here = fs.readFileSync(path.join(__dirname, '..', 'src', 'merkle.js'));
  const other = fs.readFileSync(
    path.join(__dirname, '..', '..', 'merkle-batcher', 'src', 'merkle.js'),
  );
  assert.equal(
    here.equals(other),
    true,
    'merkle.js has diverged from services/merkle-batcher/src/merkle.js — edit both copies together',
  );
});

test('canonicalJSON sorts keys, preserves array order', () => {
  assert.equal(canonicalJSON({ b: 2, a: { d: 4, c: 3 } }), '{"a":{"c":3,"d":4},"b":2}');
  assert.equal(canonicalJSON({ a: 1 }), '{"a":1}');
});

test('V1 single leaf', () => {
  assert.equal(leafHash({ a: 1 }), V1_ROOT);
  assert.equal(computeRoot(V1_ROOT, []), V1_ROOT);
});

test('V2 three leaves — leaves, parent, L1 path folds to root', () => {
  assert.equal(leafHash({ i: 0 }), V2.L0);
  assert.equal(leafHash({ i: 1 }), V2.L1);
  assert.equal(leafHash({ i: 2 }), V2.L2);
  assert.equal(interiorHash(V2.L0, V2.L1), V2.PARENT_L0_L1);

  const pathL1 = [{ pos: 'L', hash: V2.L0 }, { pos: 'R', hash: V2.L2 }];
  assert.equal(computeRoot(V2.L1, pathL1), V2.ROOT);
  assert.equal(verifyPath(V2.L1, pathL1, V2.ROOT), true);
  assert.equal(verifyPath('deadbeef', pathL1, V2.ROOT), false); // tamper -> no verify
});
