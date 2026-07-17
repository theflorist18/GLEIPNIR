import { describe, expect, it } from 'vitest';
import { niUri } from './ni';

// Vectors computed with the gateway implementation (node:crypto):
//   require('./gateway/src/ni').niUri(Buffer.from(...))
// The two implementations MUST stay byte-identical (CONTRACTS §4).
const VECTORS: Array<[string, string]> = [
  ['abc', 'ni:///sha-256;ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0'],
  ['', 'ni:///sha-256;47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU'],
  ['the quick brown exhibit', 'ni:///sha-256;LHbllZF-TATvdTE3HW8W4gNI1wIgmzvwfC7A3Z_8qdM'],
];

describe('lib/ni', () => {
  it.each(VECTORS)('matches the gateway ni-URI for %j', async (input, expected) => {
    const bytes = new TextEncoder().encode(input);
    // Pass a tight ArrayBuffer view of exactly the encoded bytes.
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    expect(await niUri(buf)).toBe(expected);
  });
});
