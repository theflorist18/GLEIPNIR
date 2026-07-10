'use strict';

// Shared payload builders for the GLEIPNIR workloads. Kept identical across the
// four modules so create/transfer/access/verify all speak the same shapes
// (docs/CONTRACTS.md §3 chaincode args, §5 event/head, §6 gateway REST).

const crypto = require('crypto');

function evidenceId(workerIndex, roundIndex, counter) {
  return `ev-w${workerIndex}-r${roundIndex}-${counter}-${crypto.randomUUID().slice(0, 8)}`;
}

// Codex-Entry JSON for CreateEvidence's second chaincode arg (fabric mode).
function codexJson(id, workerIndex) {
  return JSON.stringify({
    id,
    version: '1.0',
    storage: {
      protocol: 'file',
      location: `blob://${id}`,
      integrity_proof: `ni:///sha-256;${crypto.createHash('sha256').update(id).digest('base64url')}`,
      jurisdiction: 'ID',
    },
    identity: { org: 'Org1MSP', subject: `custodian-${workerIndex}` },
  });
}

// Request body for the gateway POST /api/v1/evidence (rest mode).
function createRestBody(id, workerIndex, caseId) {
  return {
    evidenceId: id,
    version: '1.0',
    identity: { org: 'Org1MSP', subject: `custodian-${workerIndex}` },
    storage: { protocol: 'file', location: `blob://${id}` },
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
// Returns null when `channels` is absent — single-channel rounds (caseId /
// channel arguments) behave exactly as before, in every variant.
function caseSelector(roundArguments, workerIndex) {
  const channels = parseInt(roundArguments && roundArguments.channels, 10);
  if (!Number.isFinite(channels) || channels < 1) return null;
  let n = workerIndex;
  return () => {
    const caseId = `case-${String((n % channels) + 1).padStart(3, '0')}`;
    n += 1;
    return caseId;
  };
}

module.exports = { evidenceId, codexJson, createRestBody, fabricRequest, caseSelector };
