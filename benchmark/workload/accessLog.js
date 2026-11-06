'use strict';

// accessLog workload — per-operation round (ops breakdown), every variant.
// AccessLog is a write custody event, so it belongs in the writes table. Each
// worker seeds a pool of `pool` evidence items (untimed, via lib/pool) and then
// logs an access to the pooled items round-robin, always on the case the
// evidence lives on.
//
// `scenario: shared` (the zero-MVCC-conflict check: every worker hits one
// evidenceId) needs no pool and shows that the composite
// (evidenceId, sortKey) design produces zero MVCC_READ_CONFLICT under
// concurrency. roundArguments: { mode, label, variant?, channels?, pool,
// payloadBytes?, scenario?, sharedEvidenceId? }.
// Each timed tx is logged via lib/txlog (GLEIPNIR_TXLOG_DIR).

const { WorkloadModuleBase } = require('@hyperledger/caliper-core');
const { opRequest } = require('./lib/payloads');
const { seedPool } = require('./lib/pool');
const txlog = require('./lib/txlog');

class AccessLogWorkload extends WorkloadModuleBase {
  async initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext) {
    await super.initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext);
    this.mode = roundArguments.mode || 'fabric';
    this.label = roundArguments.label || `round-${roundIndex}`;
    this.payloadBytes = roundArguments.payloadBytes | 0;
    this.n = 0;
    if (roundArguments.scenario === 'shared') {
      // AccessLog never reads the head, so even a not-yet-created id appends without conflict.
      this.targets = [{ id: roundArguments.sharedEvidenceId || 'ev-shared-gate', caseId: null }];
    } else {
      this.targets = await seedPool(this, roundArguments.pool || 25);
    }
  }

  async submitTransaction() {
    const target = this.targets[this.n % this.targets.length];
    this.n += 1;
    const actor = `worker-${this.workerIndex}`;
    const action = `access-${this.n}`;
    const status = await this.sutAdapter.sendRequests(opRequest(this.mode, {
      op: 'ACCESS', evidenceId: target.id, actor, detail: { action },
    }, target.caseId));
    txlog.log(this.workerIndex, this.label, 'ACCESS', target.caseId, target.id, status);
    return status;
  }
}

module.exports.createWorkloadModule = () => new AccessLogWorkload();
