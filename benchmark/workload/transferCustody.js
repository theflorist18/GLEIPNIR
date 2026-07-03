'use strict';

// transferCustody workload. Each worker seeds a pool of evidence in
// initializeWorkloadModule (not timed), then transfers custody of a random
// pooled evidence each timed tx. roundArguments: { mode, caseId?, channel?, pool }.
//
// Seeding uses the same connector as the round, so it exercises the real write
// path; only the transfer transactions are measured.

const { WorkloadModuleBase } = require('@hyperledger/caliper-core');
const { evidenceId, codexJson, createRestBody, fabricRequest } = require('./lib/payloads');

class TransferCustodyWorkload extends WorkloadModuleBase {
  async initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext) {
    await super.initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext);
    this.mode = roundArguments.mode || 'fabric';
    this.caseId = roundArguments.caseId;
    this.channel = roundArguments.channel;
    this.poolSize = roundArguments.pool || 50;
    this.pool = [];
    this.n = 0;

    for (let i = 0; i < this.poolSize; i += 1) {
      const id = evidenceId(this.workerIndex, this.roundIndex, `seed${i}`);
      this.pool.push(id);
      if (this.mode === 'rest') {
        await this.sutAdapter.sendRequests({ method: 'POST', path: '/api/v1/evidence', body: createRestBody(id, this.workerIndex, this.caseId) });
      } else {
        await this.sutAdapter.sendRequests(fabricRequest('CreateEvidence', [id, codexJson(id, this.workerIndex)], this.channel));
      }
    }
  }

  async submitTransaction() {
    const id = this.pool[this.n % this.pool.length];
    this.n += 1;
    const newCustodian = `custodian-${this.workerIndex}-${this.n}`;
    if (this.mode === 'rest') {
      return this.sutAdapter.sendRequests({
        method: 'POST',
        path: `/api/v1/evidence/${encodeURIComponent(id)}/transfer`,
        body: { newCustodian, reason: 'benchmark-transfer', caseId: this.caseId },
      });
    }
    return this.sutAdapter.sendRequests(
      fabricRequest('TransferCustody', [id, newCustodian, 'benchmark-transfer'], this.channel),
    );
  }
}

module.exports.createWorkloadModule = () => new TransferCustodyWorkload();
