'use strict';

// createEvidence workload — runs against every variant.
//   mode: 'fabric' (standard/parallel) -> sutAdapter drives the peer-gateway
//         connector directly (CreateEvidence).
//   mode: 'rest'   (anchoring/parallel-anchored) -> sutAdapter is the custom REST
//         connector that POSTs the CoC event to the gateway enqueue path.
// roundArguments: { mode, caseId?, channel?, channels? }.
// `channels: C` (multi-channel Parallel cells, audit F6/F24) spreads successive
// transactions round-robin across case-001..case-00C; caseId/channel select a
// single fixed target as before.

const { WorkloadModuleBase } = require('@hyperledger/caliper-core');
const { evidenceId, codexJson, createRestBody, fabricRequest, caseSelector } = require('./lib/payloads');

class CreateEvidenceWorkload extends WorkloadModuleBase {
  async initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext) {
    await super.initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext);
    this.mode = roundArguments.mode || 'fabric';
    this.caseId = roundArguments.caseId;   // parallel* variants
    this.channel = roundArguments.channel;  // per-channel override (parallel, fabric mode)
    this.nextCase = caseSelector(roundArguments, workerIndex);
    this.counter = 0;
  }

  async submitTransaction() {
    this.counter += 1;
    const id = evidenceId(this.workerIndex, this.roundIndex, this.counter);
    const spread = this.nextCase ? this.nextCase() : null;
    if (this.mode === 'rest') {
      return this.sutAdapter.sendRequests({
        method: 'POST',
        path: '/api/v1/evidence',
        body: createRestBody(id, this.workerIndex, spread || this.caseId),
      });
    }
    return this.sutAdapter.sendRequests(
      fabricRequest('CreateEvidence', [id, codexJson(id, this.workerIndex)], spread || this.channel),
    );
  }
}

module.exports.createWorkloadModule = () => new CreateEvidenceWorkload();
