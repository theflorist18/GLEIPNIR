'use strict';

// disposeEvidence workload — per-operation round (ops breakdown), every variant.
// DisposeEvidence is a terminal STATUS TRANSITION (ACTIVE -> DISPOSED); nothing
// is deleted. Each worker seeds a pool of `pool` evidence items (NOT timed, via
// lib/pool) and disposes each exactly once — a second dispose would be a
// chaincode error, not a measurement — so txNumber must be <= pool × workers.
// roundArguments: { mode, label, variant?, channels?, pool, payloadBytes? }.
//   fabric -> DisposeEvidence(evidenceId, reason); rest -> DELETE /api/v1/evidence/:id {reason, caseId?}.
// Each timed tx is logged via lib/txlog (GLEIPNIR_TXLOG_DIR).

const { WorkloadModuleBase } = require('@hyperledger/caliper-core');
const { opRequest } = require('./lib/payloads');
const { seedPool } = require('./lib/pool');
const txlog = require('./lib/txlog');

class DisposeEvidenceWorkload extends WorkloadModuleBase {
  async initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext) {
    await super.initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext);
    this.mode = roundArguments.mode || 'fabric';
    this.label = roundArguments.label || `round-${roundIndex}`;
    this.payloadBytes = roundArguments.payloadBytes | 0;
    this.pool = await seedPool(this, roundArguments.pool || 50);
    this.n = 0;
  }

  async submitTransaction() {
    if (this.n >= this.pool.length) {
      throw new Error(`disposeEvidence: worker ${this.workerIndex} exhausted its pool of ${this.pool.length} — txNumber must be <= pool x workers`);
    }
    const target = this.pool[this.n];
    this.n += 1;
    const reason = 'benchmark-disposition';
    const status = await this.sutAdapter.sendRequests(opRequest(this.mode, {
      op: 'DISPOSE', evidenceId: target.id, detail: { reason },
    }, target.caseId));
    txlog.log(this.workerIndex, this.label, 'DISPOSE', target.caseId, target.id, status);
    return status;
  }
}

module.exports.createWorkloadModule = () => new DisposeEvidenceWorkload();
