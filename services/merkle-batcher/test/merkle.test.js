'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  canonicalJSON,
  leafHash,
  interiorHash,
  buildTree,
  siblingPath,
  verifyPath,
} = require('../src/merkle');

// Normative constants from docs/CONTRACTS.md §4. These are pinned byte-for-byte.
const V1_ROOT =
  '015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862';
const V2 = {
  L0: 'e9f74e715a1806aa651489dcf176e77013b3c851dbc114cc9c24f2fe9d411d65',
  L1: '0b549edd218c251f511934cc2f3bc5c7f4780e27af6b8ab4ae8d92cd94121b4a',
  L2: '38f38fbef725fffb9fa39683d9e50f05ca8c61130c2da2322f9e9021007a2abf',
  PARENT_L0_L1:
    '4a89ef3715145c84282de7016b554021cd5019c03446f069e6061efbac670266',
  ROOT: 'c859dbaf0c89a0c3d8acd14558d491171dd4381073d79935182301300d296d2f',
};

test('canonicalJSON recursively sorts object keys, preserves array order', () => {
  assert.equal(canonicalJSON({ b: 2, a: { d: 4, c: 3 } }), '{"a":{"c":3,"d":4},"b":2}');
  assert.equal(canonicalJSON([3, 1, 2]), '[3,1,2]');
  assert.equal(canonicalJSON({ a: 1 }), '{"a":1}');
});

test('V1 — single leaf: leaf == root', () => {
  const leaf = leafHash({ a: 1 });
  assert.equal(leaf, V1_ROOT);
  const tree = buildTree([leaf]);
  assert.equal(tree.root, V1_ROOT);
  assert.deepEqual(siblingPath(tree.layers, 0), []);
  assert.equal(verifyPath(leaf, [], tree.root), true);
});

test('V2 — three leaves: leaves, parent, root, and L1 sibling path', () => {
  const L0 = leafHash({ i: 0 });
  const L1 = leafHash({ i: 1 });
  const L2 = leafHash({ i: 2 });
  assert.equal(L0, V2.L0);
  assert.equal(L1, V2.L1);
  assert.equal(L2, V2.L2);

  const parent = interiorHash(L0, L1);
  assert.equal(parent, V2.PARENT_L0_L1);

  const tree = buildTree([L0, L1, L2]);
  assert.equal(tree.root, V2.ROOT);
  // Layer 1 = [ parent(L0,L1), L2(promoted) ].
  assert.equal(tree.layers[1][0], V2.PARENT_L0_L1);
  assert.equal(tree.layers[1][1], V2.L2);

  const pathL1 = siblingPath(tree.layers, 1);
  assert.deepEqual(pathL1, [
    { pos: 'L', hash: V2.L0 },
    { pos: 'R', hash: V2.L2 },
  ]);
  assert.equal(verifyPath(L1, pathL1, tree.root), true);
});

test('property — every leaf path verifies for batch sizes 1..9', () => {
  for (let size = 1; size <= 9; size += 1) {
    const leaves = [];
    for (let i = 0; i < size; i += 1) leaves.push(leafHash({ i }));
    const tree = buildTree(leaves);
    for (let idx = 0; idx < size; idx += 1) {
      const path = siblingPath(tree.layers, idx);
      assert.equal(
        verifyPath(leaves[idx], path, tree.root),
        true,
        `size=${size} idx=${idx} failed to verify`
      );
      // A tampered leaf must NOT verify against the same path/root.
      const tampered = leafHash({ i: idx, tampered: true });
      if (size > 1) {
        assert.equal(verifyPath(tampered, path, tree.root), false);
      }
    }
  }
});
