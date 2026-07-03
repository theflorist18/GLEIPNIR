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

module.exports = { evidenceId, codexJson, createRestBody, fabricRequest };
