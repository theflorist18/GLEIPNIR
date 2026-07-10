'use strict';

// transferCustody workload. Each worker seeds a pool of evidence in
// initializeWorkloadModule (not timed), then transfers custody of a random
// pooled evidence each timed tx. roundArguments: { mode, caseId?, channel?, channels?, pool }.
// With `channels: C` (multi-channel Parallel cells, audit F6/F24) the pool is
// seeded round-robin across case-001..case-00C, and every transfer targets the
// SAME case its evidence was created on (custody heads live per channel).
//
// Seeding uses the same connector as the round, so it exercises the real write
// path; only the transfer transactions are measured.

const { WorkloadModuleBase } = require('@hyperledger/caliper-core');
const { evidenceId, codexJson, createRestBody, fabricRequest, caseSelector } = require('./lib/payloads');

class TransferCustodyWorkload extends WorkloadModuleBase {
  async initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext) {
    await super.initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext);
    this.mode = roundArguments.mode || 'fabric';
    this.caseId = roundArguments.caseId;
    this.channel = roundArguments.channel;
    this.poolSize = roundArguments.pool || 50;
    const nextCase = caseSelector(roundArguments, workerIndex);
    this.pool = [];
    this.n = 0;

    for (let i = 0; i < this.poolSize; i += 1) {
      const id = evidenceId(this.workerIndex, this.roundIndex, `seed${i}`);
      const spread = nextCase ? nextCase() : null;
      this.pool.push({ id, caseId: spread || this.caseId, channel: spread || this.channel });
      if (this.mode === 'rest') {
        await this.sutAdapter.sendRequests({ method: 'POST', path: '/api/v1/evidence', body: createRestBody(id, this.workerIndex, spread || this.caseId) });
      } else {
        await this.sutAdapter.sendRequests(fabricRequest('CreateEvidence', [id, codexJson(id, this.workerIndex)], spread || this.channel));
      }
    }
  }

  async submitTransaction() {
    const target = this.pool[this.n % this.pool.length];
    this.n += 1;
    const newCustodian = `custodian-${this.workerIndex}-${this.n}`;
    if (this.mode === 'rest') {
      return this.sutAdapter.sendRequests({
        method: 'POST',
        path: `/api/v1/evidence/${encodeURIComponent(target.id)}/transfer`,
        body: { newCustodian, reason: 'benchmark-transfer', caseId: target.caseId },
      });
    }
    return this.sutAdapter.sendRequests(
      fabricRequest('TransferCustody', [target.id, newCustodian, 'benchmark-transfer'], target.channel),
    );
  }
}

module.exports.createWorkloadModule = () => new TransferCustodyWorkload();
