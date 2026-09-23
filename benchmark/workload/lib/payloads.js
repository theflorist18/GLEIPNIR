'use strict';

// Shared payload builders for the GLEIPNIR workloads. Kept identical across the
// workload modules so create/transfer/access/dispose/read/verify/trace all speak
// the same shapes (docs/CONTRACTS.md §3 chaincode args, §5 event/head, §6
// gateway REST). Pure: no Caliper import, so trace/generate.js can reuse it.

const crypto = require('crypto');

function evidenceId(workerIndex, roundIndex, counter) {
  return `ev-w${workerIndex}-r${roundIndex}-${counter}-${crypto.randomUUID().slice(0, 8)}`;
}

// Deterministic synthetic evidence "file": exactly `bytes` ASCII characters
// derived from the evidenceId (sweeps.yaml workload.payload_bytes). It stands
// in for the off-chain binary — only its hash reaches the ledger.
function filler(id, bytes) {
  const n = Math.max(0, bytes | 0);
  let out = '';
  for (let i = 0; out.length < n; i += 1) {
    out += crypto.createHash('sha256').update(`${id}#${i}`).digest('hex');
  }
  return out.slice(0, n);
}

// RFC 6920 ni-URI over the payload bytes (docs/CONTRACTS.md §5: the client
// computes storage.integrity_proof, never the chaincode).
function integrityProof(payload) {
  return `ni:///sha-256;${crypto.createHash('sha256').update(payload, 'utf8').digest('base64url')}`;
}

// Codex-Entry JSON for CreateEvidence's second chaincode arg (fabric mode).
// `payload` is the filler string (or '' → the id itself is hashed).
function codexJson(id, subject, payload) {
  return JSON.stringify({
    id,
    version: '1.0',
    storage: {
      protocol: 'file',
      location: `blob://${id}`,
      integrity_proof: integrityProof(payload || id),
      jurisdiction: 'ID',
    },
    identity: { org: 'Org1MSP', subject },
  });
}

// Request body for the gateway POST /api/v1/evidence (rest mode). The gateway
// honours a client-supplied storage.integrity_proof (buildHead).
function createRestBody(id, subject, caseId, payload) {
  return {
    evidenceId: id,
    version: '1.0',
    identity: { org: 'Org1MSP', subject },
    storage: { protocol: 'file', location: `blob://${id}`, integrity_proof: integrityProof(payload || id) },
    ...(caseId ? { caseId } : {}),
  };
}

// A fabric-connector request (peer-gateway binding shape, digest Q3).
function fabricRequest(fn, args, channel) {
  const req = {
    contractId: 'evidence',
    contractFunction: fn,
    contractArguments: args,
    invokerIdentity: 'User1',
    readOnly: false,
  };
  if (channel) req.channel = channel;
  return req;
}

// Round-robin case selector for multi-channel Parallel cells (audit F6/F24).
// With roundArguments.channels = C, successive calls yield case-001..case-00C
// cyclically (offset by workerIndex so workers do not synchronise on one case),
// spreading the round's offered load across ALL provisioned case channels.
// Returns null when `channels` is absent, or when `variant` names a
// single-channel variant (standard / anchoring never carry a caseId — for
// anchoring a caseId would silently change the batch scope from `shared`).
function caseSelector(roundArguments, workerIndex) {
  const variant = roundArguments && roundArguments.variant;
  if (variant === 'standard' || variant === 'anchoring') return null;
  const channels = parseInt(roundArguments && roundArguments.channels, 10);
  if (!Number.isFinite(channels) || channels < 1) return null;
  let n = workerIndex;
  return () => {
    const caseId = `case-${String((n % channels) + 1).padStart(3, '0')}`;
    n += 1;
    return caseId;
  };
}

module.exports = { evidenceId, filler, integrityProof, codexJson, createRestBody, fabricRequest, caseSelector };
