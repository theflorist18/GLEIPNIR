'use strict';

// accessLog workload. Two scenarios via roundArguments.scenario:
//
//   'shared'  — the Stage-1 CORRECTNESS GATE. Every worker issues AccessLog
//               against ONE shared evidenceId (roundArguments.sharedEvidenceId).
//               Because each access appends under a distinct (evidenceId, sortKey)
//               composite key, this MUST produce ZERO MVCC_READ_CONFLICT even at
//               high concurrency — the structural guarantee the whole design rests
//               on. (Contrast: mutating one record here would guarantee conflicts.)
//
//   'spread'  — each worker logs access to its own seeded pool (throughput shape).
//
// roundArguments: { mode, scenario, sharedEvidenceId?, caseId?, channel?, channels?, pool? }.
// With `channels: C` (multi-channel Parallel cells, audit F6/F24) the spread pool
// is seeded round-robin across case-001..case-00C and every access targets the
// SAME case its evidence was created on.

const { WorkloadModuleBase } = require('@hyperledger/caliper-core');
const { evidenceId, codexJson, createRestBody, fabricRequest, caseSelector } = require('./lib/payloads');

class AccessLogWorkload extends WorkloadModuleBase {
  async initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext) {
    await super.initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext);
    this.mode = roundArguments.mode || 'fabric';
    this.scenario = roundArguments.scenario || 'spread';
    this.caseId = roundArguments.caseId;
    this.channel = roundArguments.channel;
    this.n = 0;

    if (this.scenario === 'shared') {
      // The shared evidence is expected to already exist (created by the
      // orchestration gate before the round). AccessLog never reads the head,
      // so even a not-yet-created id would still be appended without conflict.
      this.targets = [{ id: roundArguments.sharedEvidenceId || 'ev-shared-gate', caseId: this.caseId, channel: this.channel }];
    } else {
      const poolSize = roundArguments.pool || 25;
      const nextCase = caseSelector(roundArguments, workerIndex);
      this.targets = [];
      for (let i = 0; i < poolSize; i += 1) {
        const id = evidenceId(this.workerIndex, this.roundIndex, `seed${i}`);
        const spread = nextCase ? nextCase() : null;
        this.targets.push({ id, caseId: spread || this.caseId, channel: spread || this.channel });
        if (this.mode === 'rest') {
          await this.sutAdapter.sendRequests({ method: 'POST', path: '/api/v1/evidence', body: createRestBody(id, this.workerIndex, spread || this.caseId) });
        } else {
          await this.sutAdapter.sendRequests(fabricRequest('CreateEvidence', [id, codexJson(id, this.workerIndex)], spread || this.channel));
        }
      }
    }
  }

  async submitTransaction() {
    const target = this.targets[this.n % this.targets.length];
    this.n += 1;
    const actor = `worker-${this.workerIndex}`;
    const action = `access-${this.n}`;
    if (this.mode === 'rest') {
      return this.sutAdapter.sendRequests({
        method: 'POST',
        path: `/api/v1/evidence/${encodeURIComponent(target.id)}/access`,
        body: { actor, action, caseId: target.caseId },
      });
    }
    return this.sutAdapter.sendRequests(
      fabricRequest('AccessLog', [target.id, actor, action], target.channel),
    );
  }
}

module.exports.createWorkloadModule = () => new AccessLogWorkload();
