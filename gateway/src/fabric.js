'use strict';

// The ONLY @hyperledger/fabric-gateway sessions to the APPLICATION channels
// (coc-main, case-*). One shared grpc client; a Network/Contract is created and
// cached per channel on first use. Returns a {submit, evaluate} adapter that the
// routes/variantRouter consume. The anchor channel is owned by the anchor-client
// service, not here (docs/CONTRACTS.md §6).
//
// API pinned from docs/research/fabric-2.5.md §7 (fabric-gateway 1.11.0). This
// module is loaded only at server start; tests inject a fake adapter instead.

const { promises: fs } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const grpc = require('@grpc/grpc-js');
const { connect, hash, signers } = require('@hyperledger/fabric-gateway');

async function firstFile(dir) {
  const entries = (await fs.readdir(dir)).filter((n) => !n.startsWith('.')).sort();
  if (entries.length === 0) throw new Error(`no files found in ${dir}`);
  return path.join(dir, entries[0]);
}

// Signing-key selection (audit F47/F56): re-enrollment over a live crypto tree
// ADDS a hash-named key beside the old one, and hex names sort before priv_sk —
// so "alphabetically first" can pair a stale key with the fresh cert. Prefer
// the normalized priv_sk copy (registerEnroll.sh refreshes it to the newest
// key on every enrollment); otherwise fall back to the newest key by mtime.
async function keyFile(dir) {
  const entries = (await fs.readdir(dir)).filter((n) => !n.startsWith('.'));
  if (entries.length === 0) throw new Error(`no files found in ${dir}`);
  if (entries.includes('priv_sk')) return path.join(dir, 'priv_sk');
  const stats = await Promise.all(entries.map(async (n) => ({
    name: n,
    mtimeMs: (await fs.stat(path.join(dir, n))).mtimeMs,
  })));
  stats.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return path.join(dir, stats[0].name);
}

async function readIdentity(cryptoPath) {
  const credentials = await fs.readFile(await firstFile(path.join(cryptoPath, 'signcerts')));
  const privateKeyPem = await fs.readFile(await keyFile(path.join(cryptoPath, 'keystore')));
  return { credentials, privateKeyPem };
}

async function connectFabric(env) {
  const {
    PEER_ENDPOINT,
    PEER_HOST_ALIAS,
    MSP_ID,
    CRYPTO_PATH,
    TLS_CERT_PATH,
    CC_NAME = 'evidence',
  } = env;

  for (const [name, value] of Object.entries({ PEER_ENDPOINT, PEER_HOST_ALIAS, MSP_ID, CRYPTO_PATH, TLS_CERT_PATH })) {
    if (!value) throw new Error(`gateway: required env ${name} is not set`);
  }

  const tlsRootCert = await fs.readFile(TLS_CERT_PATH);
  const client = new grpc.Client(
    PEER_ENDPOINT,
    grpc.credentials.createSsl(tlsRootCert),
    { 'grpc.ssl_target_name_override': PEER_HOST_ALIAS },
  );

  const { credentials, privateKeyPem } = await readIdentity(CRYPTO_PATH);
  const gateway = connect({
    client,
    identity: { mspId: MSP_ID, credentials },
    signer: signers.newPrivateKeySigner(crypto.createPrivateKey(privateKeyPem)),
    hash: hash.sha256,
    evaluateOptions: () => ({ deadline: Date.now() + 5000 }),
    endorseOptions: () => ({ deadline: Date.now() + 15000 }),
    submitOptions: () => ({ deadline: Date.now() + 5000 }),
    commitStatusOptions: () => ({ deadline: Date.now() + 60000 }),
  });

  const contracts = new Map();
  const contractFor = (channel) => {
    let c = contracts.get(channel);
    if (!c) {
      c = gateway.getNetwork(channel).getContract(CC_NAME);
      contracts.set(channel, c);
    }
    return c;
  };

  const fabric = {
    async submit(channel, fn, args) {
      const submitted = await contractFor(channel).submitAsync(fn, { arguments: args });
      const status = await submitted.getStatus();
      if (!status.successful) {
        const err = new Error(`transaction ${status.transactionId} failed to commit (code ${status.code})`);
        err.code = 'COMMIT_FAILED';
        throw err;
      }
      return submitted.getTransactionId();
    },
    async evaluate(channel, fn, args) {
      const bytes = await contractFor(channel).evaluateTransaction(fn, ...args);
      return Buffer.from(bytes).toString('utf8');
    },
  };

  const close = () => { gateway.close(); client.close(); };
  return { fabric, close };
}

module.exports = { connectFabric };
