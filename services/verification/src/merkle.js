'use strict';

// Pure, dependency-free Merkle primitives for GLEIPNIR verification.
//
// This file MUST stay byte-for-byte compatible with the merkle-batcher
// (services/merkle-batcher/src/merkle.js) and docs/CONTRACTS.md §4. Any change
// here that alters a hash breaks verification against already-anchored roots.
//
// Determinism constraints (do not "optimise" away):
//  - Canonical JSON: object keys recursively sorted by code-unit order, array
//    order preserved, no insignificant whitespace, UTF-8 bytes.
//  - Leaf hash    = SHA-256 over the canonical-JSON UTF-8 bytes, lowercase hex.
//  - Interior     = SHA-256 over the concatenated RAW (hex-decoded) bytes of
//    left || right, lowercase hex.
//  - Odd node rule = PROMOTE (unpaired node moves up unchanged; never duplicated).

const crypto = require('node:crypto');

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
  return JSON.stringify(value);
}

function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function leafHash(value) {
  return sha256Hex(Buffer.from(canonicalJSON(value), 'utf8'));
}

function interiorHash(leftHex, rightHex) {
  return sha256Hex(
    Buffer.concat([Buffer.from(leftHex, 'hex'), Buffer.from(rightHex, 'hex')])
  );
}

// Fold a leaf hash up its sibling path to the root it implies.
// Each step is {pos, hash} where `pos` is the side the SIBLING sits on.
function computeRoot(leaf, path) {
  let current = leaf;
  for (const step of path) {
    current = step.pos === 'L'
      ? interiorHash(step.hash, current)
      : interiorHash(current, step.hash);
  }
  return current;
}

// Recompute a root from a leaf + path and compare to the expected root.
function verifyPath(leaf, path, root) {
  return computeRoot(leaf, path) === root;
}

module.exports = {
  canonicalJSON,
  sha256Hex,
  leafHash,
  interiorHash,
  computeRoot,
  verifyPath,
};
