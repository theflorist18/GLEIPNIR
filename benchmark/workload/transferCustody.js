'use strict';

// transferCustody workload — per-operation round (ops breakdown), every variant.
// Each worker seeds a pool of `pool` evidence items in initializeWorkloadModule
// (NOT timed, via lib/pool), then transfers custody of the pooled items
// round-robin — each transfer targets the SAME case its evidence lives on.
// roundArguments: { mode, label, variant?, channels?, pool, payloadBytes? }.
// Each timed tx is logged via lib/txlog (GLEIPNIR_TXLOG_DIR).

const { WorkloadModuleBase } = require('@hyperledger/caliper-core');
const { opRequest } = require('./lib/payloads');
const { seedPool } = require('./lib/pool');
const txlog = require('./lib/txlog');

class TransferCustodyWorkload extends WorkloadModuleBase {
  async initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext) {
    await super.initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext);
    this.mode = roundArguments.mode || 'fabric';
    this.label = roundArguments.label || `round-${roundIndex}`;
    this.payloadBytes = roundArguments.payloadBytes | 0;
    this.pool = await seedPool(this, roundArguments.pool || 50);
    this.n = 0;
  }

  async submitTransaction() {
    const target = this.pool[this.n % this.pool.length];
    this.n += 1;
    const newCustodian = `custodian-${this.workerIndex}-${this.n}`;
    const status = await this.sutAdapter.sendRequests(opRequest(this.mode, {
      op: 'TRANSFER', evidenceId: target.id, detail: { newCustodian, reason: 'benchmark-transfer' },
    }, target.caseId));
    txlog.log(this.workerIndex, this.label, 'TRANSFER', target.caseId, target.id, status);
    return status;
  }
}

module.exports.createWorkloadModule = () => new TransferCustodyWorkload();
