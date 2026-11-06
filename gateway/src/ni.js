'use strict';

// RFC 6920 "ni" URI for content integrity. GLEIPNIR uses it as
// storage.integrity_proof: a hash of the off-chain evidence binary, computed by
// the gateway. The bytes passed in are hashed and then discarded; this module
// never stores them (uploaded binaries are kept by evidence-store).
//
//   ni:///sha-256;<base64url( sha256(bytes) )>   (no padding, RFC 6920 §3)

const crypto = require('node:crypto');

function niUri(bytes) {
  const digest = crypto.createHash('sha256').update(bytes).digest();
  return `ni:///sha-256;${digest.toString('base64url')}`;
}

module.exports = { niUri };
