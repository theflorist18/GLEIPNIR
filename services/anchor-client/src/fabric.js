// fabric.js — the ONLY @hyperledger/fabric-gateway session to the anchor channel
// (ANCHOR_CHANNEL=anchor-main), under the fixed AnchorClientMSP identity.
//
// This module is a FACTORY: connectAnchorFabric() builds a small contract
// adapter ({ submit, evaluate }) that src/index.js consumes. Tests never call
// this factory; they inject a fake adapter with the same shape into createApp().
// Keeping fabric.js out of index.js's static import graph means `node --test`
// can run the HTTP routing without the grpc / fabric-gateway dependencies.
//
// API facts pinned from docs/research/fabric-2.5.md §7 (fabric-gateway 1.11.0):
//   new grpc.Client(endpoint, createSsl(tlsRootCert), { 'grpc.ssl_target_name_override': hostAlias })
//   connect({ client, identity:{mspId,credentials}, signer, hash }) -> getNetwork -> getContract

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import * as grpc from '@grpc/grpc-js';
import { connect, hash, signers } from '@hyperledger/fabric-gateway';

async function firstFile(dir) {
  const entries = (await fs.readdir(dir)).filter((n) => !n.startsWith('.')).sort();
  if (entries.length === 0) {
    throw new Error(`no files found in ${dir}`);
  }
  return path.join(dir, entries[0]);
}

// CRYPTO_PATH is a Fabric-CA-enrolled MSP dir: signcerts/<cert>.pem + keystore/<hash>_sk
async function readIdentity(cryptoPath) {
  const certFile = await firstFile(path.join(cryptoPath, 'signcerts'));
  const keyFile = await firstFile(path.join(cryptoPath, 'keystore'));
  const credentials = await fs.readFile(certFile);
  const privateKeyPem = await fs.readFile(keyFile);
  return { credentials, privateKeyPem };
}

// Wrap a raw fabric-gateway Contract in the adapter shape index.js expects.
// submit() uses submitAsync so we can return the committed transaction id;
// plain submitTransaction() would only return the result bytes.
export function wrapContract(gwContract) {
  return {
    async submit(fn, args) {
      const submitted = await gwContract.submitAsync(fn, { arguments: args });
      const status = await submitted.getStatus();
      if (!status.successful) {
        const err = new Error(
          `transaction ${status.transactionId} failed to commit (status code ${status.code})`,
        );
        err.code = 'COMMIT_FAILED';
        throw err;
      }
      return { txId: submitted.getTransactionId(), result: submitted.getResult() };
    },
    async evaluate(fn, args) {
      return gwContract.evaluateTransaction(fn, ...args);
    },
  };
}

export async function connectAnchorFabric(env) {
  const {
    PEER_ENDPOINT,
    PEER_HOST_ALIAS,
    MSP_ID,
    CRYPTO_PATH,
    TLS_CERT_PATH,
    ANCHOR_CHANNEL = 'anchor-main',
    CC_NAME = 'evidence',
  } = env;

  for (const [name, value] of Object.entries({
    PEER_ENDPOINT,
    PEER_HOST_ALIAS,
    MSP_ID,
    CRYPTO_PATH,
    TLS_CERT_PATH,
  })) {
    if (!value) {
      throw new Error(`anchor-client: required env ${name} is not set`);
    }
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

  const network = gateway.getNetwork(ANCHOR_CHANNEL);
  const contract = wrapContract(network.getContract(CC_NAME));

  const close = () => {
    gateway.close();
    client.close();
  };

  return { contract, close };
}
