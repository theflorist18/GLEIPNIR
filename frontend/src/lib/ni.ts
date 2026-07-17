// RFC 6920 "ni" URI, byte-identical to gateway/src/ni.js (CONTRACTS §4
// discipline):  ni:///sha-256;<base64url( sha256(bytes) )>  — no padding.
// Computed client-side (M22) so the wizard can verify the server's
// integrityProof end-to-end. crypto.subtle requires a secure context;
// localhost qualifies (the deployment posture — single host, no TLS).

export function base64url(bytes: ArrayBuffer): string {
  let bin = '';
  const view = new Uint8Array(bytes);
  for (let i = 0; i < view.length; i += 1) bin += String.fromCharCode(view[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function niUri(bytes: ArrayBuffer): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('WebCrypto unavailable (requires a secure context — use localhost or HTTPS)');
  }
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return `ni:///sha-256;${base64url(digest)}`;
}
