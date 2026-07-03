'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { niUri } = require('../src/ni');

test('niUri produces an RFC 6920 ni:///sha-256; URI with base64url (no padding)', () => {
  const bytes = Buffer.from('gleipnir evidence blob', 'utf8');
  const expectedDigest = crypto.createHash('sha256').update(bytes).digest().toString('base64url');
  const uri = niUri(bytes);
  assert.equal(uri, `ni:///sha-256;${expectedDigest}`);
  assert.match(uri, /^ni:\/\/\/sha-256;[A-Za-z0-9_-]+$/); // base64url alphabet, no '+' '/' '='
  assert.ok(!uri.includes('='));
});
