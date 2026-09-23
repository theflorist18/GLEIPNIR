'use strict';

// createEvidence workload — per-operation round (ops breakdown), every variant.
//   mode: 'fabric' (standard/parallel) -> peer-gateway connector, CreateEvidence.
//   mode: 'rest'   (anchoring/parallel-anchored) -> REST connector, POST /api/v1/evidence.
// roundArguments: { mode, label, variant?, channels?, caseId?, channel?, payloadBytes? }.
// `channels: C` spreads successive transactions round-robin across
// case-001..case-00C (Parallel variants only); caseId/channel fix one target.
// Each timed tx is logged via lib/txlog (GLEIPNIR_TXLOG_DIR).

const { WorkloadModuleBase } = require('@hyperledger/caliper-core');
const { evidenceId, caseSelector, filler } = require('./lib/payloads');
const { createRequest } = require('./lib/pool');
const txlog = require('./lib/txlog');

class CreateEvidenceWorkload extends WorkloadModuleBase {
  async initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext) {
    await super.initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext);
    this.mode = roundArguments.mode || 'fabric';
    this.label = roundArguments.label || `round-${roundIndex}`;
    this.payloadBytes = roundArguments.payloadBytes | 0;
    this.caseId = roundArguments.caseId || null;
    this.channel = roundArguments.channel || null;
    this.nextCase = caseSelector(roundArguments, workerIndex);
    this.counter = 0;
  }

  async submitTransaction() {
    this.counter += 1;
    const id = evidenceId(this.workerIndex, this.roundIndex, this.counter);
    const spread = this.nextCase ? this.nextCase() : null;
    const target = { caseId: spread || this.caseId, channel: spread || this.channel };
    const status = await this.sutAdapter.sendRequests(
      createRequest(this.mode, id, `custodian-${this.workerIndex}`, target, filler(id, this.payloadBytes)),
    );
    txlog.log(this.workerIndex, this.label, 'CREATE', target.caseId || target.channel, id, status);
    return status;
  }
}

module.exports.createWorkloadModule = () => new CreateEvidenceWorkload();
