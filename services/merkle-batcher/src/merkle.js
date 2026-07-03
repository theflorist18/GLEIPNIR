'use strict';

// Pure, dependency-free Merkle primitives for GLEIPNIR anchoring.
//
// This file MUST stay byte-for-byte compatible with the verification service
// (docs/CONTRACTS.md §4). Any change here that alters a hash is a breaking
// change to the on-chain anchored roots and every stored receipt.
//
// Determinism constraints (do not "optimise" away):
//  - Canonical JSON: object keys recursively sorted by UTF-16 code-unit order,
//    array order preserved, no insignificant whitespace, UTF-8 bytes.
//  - Leaf hash    = SHA-256 over the canonical-JSON UTF-8 bytes, lowercase hex.
//  - Interior     = SHA-256 over the concatenated RAW (hex-decoded) bytes of
//    left || right, lowercase hex.
//  - Odd node rule = PROMOTE (an unpaired node moves up unchanged; never
//    duplicated). Root of a single leaf equals that leaf's hash.

const crypto = require('node:crypto');

// Canonical JSON string. Keys are emitted in code-unit sort order regardless
// of JavaScript's own object-key ordering rules (integer-like keys are NOT
// hoisted, because the string is built by hand rather than via JSON.stringify
// on a rebuilt object).
function canonicalJSON(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalJSON).join(',') + ']';
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return '{' + keys
      .map((k) => JSON.stringify(k) + ':' + canonicalJSON(value[k]))
      .join(',') + '}';
  }
  // string | number | boolean — events only ever carry strings + safe ints.
  return JSON.stringify(value);
}

function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

// Leaf hash of a CoC event (or any JSON value).
function leafHash(value) {
  return sha256Hex(Buffer.from(canonicalJSON(value), 'utf8'));
}

// Interior node over two hex child hashes.
function interiorHash(leftHex, rightHex) {
  return sha256Hex(
    Buffer.concat([Buffer.from(leftHex, 'hex'), Buffer.from(rightHex, 'hex')])
  );
}

// Build a full Merkle tree from an ordered array of leaf hex hashes.
// Returns { root, layers } where layers[0] is the leaf layer and the last
// layer is the single-element root layer.
function buildTree(leaves) {
  if (!Array.isArray(leaves) || leaves.length === 0) {
    throw new Error('buildTree requires at least one leaf');
  }
  const layers = [leaves.slice()];
  let current = layers[0];
  while (current.length > 1) {
    const next = [];
    for (let i = 0; i < current.length; i += 2) {
      if (i + 1 < current.length) {
        next.push(interiorHash(current[i], current[i + 1]));
      } else {
        next.push(current[i]); // odd node promoted unchanged
      }
    }
    layers.push(next);
    current = next;
  }
  return { root: current[0], layers };
}

// Bottom-up sibling path for a leaf. Each step is {pos, hash} where `pos` is
// the side the SIBLING sits on ("L" = sibling is left of the running hash).
// A promoted odd node contributes no step at its level.
function siblingPath(layers, leafIndex) {
  const path = [];
  let idx = leafIndex;
  for (let level = 0; level < layers.length - 1; level += 1) {
    const layer = layers[level];
    if (idx % 2 === 1) {
      path.push({ pos: 'L', hash: layer[idx - 1] });
    } else if (idx + 1 < layer.length) {
      path.push({ pos: 'R', hash: layer[idx + 1] });
    }
    // else: unpaired (promoted) node — no sibling at this level.
    idx = Math.floor(idx / 2);
  }
  return path;
}

// Recompute a root from a leaf hash + its sibling path and compare.
function verifyPath(leaf, path, root) {
  let current = leaf;
  for (const step of path) {
    current = step.pos === 'L'
      ? interiorHash(step.hash, current)
      : interiorHash(current, step.hash);
  }
  return current === root;
}

module.exports = {
  canonicalJSON,
  sha256Hex,
  leafHash,
  interiorHash,
  buildTree,
  siblingPath,
  verifyPath,
};
