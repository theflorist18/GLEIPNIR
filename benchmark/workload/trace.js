'use strict';

// trace workload — replays slice k of THIS worker's pre-generated sequence
// (trace/generate.js). The mixed-workload round used by E1/E2/E3: the same
// transaction sequence is replayed against every variant; only the write path
// differs (`mode`). roundArguments: { mode, label, variant, trace: <abs path>,
// slice: k, sliceSize: S }.
//
//   fabric: contract call; channel = item.caseId for parallel variants, none
//           (coc-main) for standard.
//   rest:   gateway paths; caseId in the body only for parallel-anchored
//           (for anchoring a caseId would change the batch scope from `shared`).
//   DISPOSE -> DisposeEvidence / DELETE /api/v1/evidence/:id {reason, caseId?}.
//
// Runs out of items -> throws (txNumber must be <= sliceSize × workers).
// Each timed tx is logged via lib/txlog (GLEIPNIR_TXLOG_DIR).

const fs = require('node:fs');
const { WorkloadModuleBase } = require('@hyperledger/caliper-core');
const { codexJson, createRestBody, fabricRequest } = require('./lib/payloads');
const txlog = require('./lib/txlog');

const traces = new Map(); // path -> parsed trace (one read per worker process)

function loadTrace(file) {
  if (!traces.has(file)) traces.set(file, JSON.parse(fs.readFileSync(file, 'utf8')));
  return traces.get(file);
}

function fabricReq(item, channel) {
  const id = item.evidenceId;
  const d = item.detail || {};
  switch (item.op) {
    case 'CREATE': return fabricRequest('CreateEvidence', [id, codexJson(id, item.actor, d.payload)], channel);
    case 'TRANSFER': return fabricRequest('TransferCustody', [id, d.newCustodian, d.reason || ''], channel);
    case 'ACCESS': return fabricRequest('AccessLog', [id, item.actor, d.action || ''], channel);
    case 'DISPOSE': return fabricRequest('DisposeEvidence', [id, d.reason || ''], channel);
    default: throw new Error(`trace: unknown op ${item.op}`);
  }
}

function restReq(item, caseId) {
  const id = encodeURIComponent(item.evidenceId);
  const d = item.detail || {};
  const scope = caseId ? { caseId } : {};
  switch (item.op) {
    case 'CREATE': return { method: 'POST', path: '/api/v1/evidence', body: createRestBody(item.evidenceId, item.actor, caseId, d.payload) };
    case 'TRANSFER': return { method: 'POST', path: `/api/v1/evidence/${id}/transfer`, body: { newCustodian: d.newCustodian, reason: d.reason || '', actor: item.actor, ...scope } };
    case 'ACCESS': return { method: 'POST', path: `/api/v1/evidence/${id}/access`, body: { actor: item.actor, action: d.action || '', ...scope } };
    case 'DISPOSE': return { method: 'DELETE', path: `/api/v1/evidence/${id}`, body: { reason: d.reason || '', actor: item.actor, ...scope } };
    default: throw new Error(`trace: unknown op ${item.op}`);
  }
}

class TraceWorkload extends WorkloadModuleBase {
  async initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext) {
    await super.initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext);
    this.mode = roundArguments.mode || 'fabric';
    this.label = roundArguments.label || `round-${roundIndex}`;
    this.variant = roundArguments.variant || (this.mode === 'rest' ? 'anchoring' : 'standard');
    this.parallel = this.variant === 'parallel' || this.variant === 'parallel-anchored';
    if (!roundArguments.trace) throw new Error('trace: round argument `trace` (path) is required');
    const t = loadTrace(roundArguments.trace);
    if (t.params.workers !== totalWorkers) {
      throw new Error(`trace: generated for ${t.params.workers} workers but the round has ${totalWorkers}`);
    }
    const k = roundArguments.slice | 0;
    const S = roundArguments.sliceSize === undefined ? t.sliceSize : (roundArguments.sliceSize | 0);
    if (S !== t.sliceSize) throw new Error(`trace: sliceSize ${S} != trace sliceSize ${t.sliceSize}`);
    if (k < 0 || k >= t.params.rounds) throw new Error(`trace: slice ${k} out of range 0..${t.params.rounds - 1}`);
    this.items = t.workers[workerIndex].slice(k * S, (k + 1) * S);
    this.slice = k;
    this.i = 0;
  }

  async submitTransaction() {
    if (this.i >= this.items.length) {
      throw new Error(`trace: worker ${this.workerIndex} slice ${this.slice} exhausted after ${this.items.length} items — txNumber must be <= sliceSize x workers`);
    }
    const item = this.items[this.i];
    this.i += 1;
    const scope = this.parallel ? item.caseId : null;
    const req = this.mode === 'rest' ? restReq(item, scope) : fabricReq(item, scope);
    const status = await this.sutAdapter.sendRequests(req);
    txlog.log(this.workerIndex, this.label, item.op, scope, item.evidenceId, status);
    return status;
  }
}

module.exports.createWorkloadModule = () => new TraceWorkload();
