'use strict';

// RFC 6920 "ni" URI for content integrity. GLEIPNIR uses it as
// storage.integrity_proof: a hash of the off-chain evidence binary, computed by
// the gateway. The binary itself is hashed then DISCARDED — evidence bytes never
// persist anywhere in GLEIPNIR.
//
//   ni:///sha-256;<base64url( sha256(bytes) )>   (no padding, RFC 6920 §3)

const crypto = require('node:crypto');

function niUri(bytes) {
  const digest = crypto.createHash('sha256').update(bytes).digest();
  return `ni:///sha-256;${digest.toString('base64url')}`;
}

module.exports = { niUri };
