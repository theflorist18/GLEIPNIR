'use strict';

// read workload — the READ-ONLY operations reported in the separate reads
// table (brief §1 Q7): fn = ReadEvidence | GetAuditTrail. Reads cut no block,
// so their latency is not comparable with write latency — never mix the tables.
// Each worker seeds a pool of `pool` evidence items (NOT timed, via lib/pool),
// then reads them round-robin:
//   fabric -> evaluate (readOnly: true) on the evidence's channel;
//   rest   -> GET /api/v1/evidence/:id | /api/v1/evidence/:id/audit
//             (+ ?caseId=case-NNN for parallel-anchored). The service token
//             never auto-logs, so reads do not mutate the ledger.
// roundArguments: { mode, label, fn, variant?, channels?, caseId?, channel?, pool, payloadBytes? }.
// Each timed read is logged via lib/txlog as READ_EVIDENCE | READ_TRAIL.

const { WorkloadModuleBase } = require('@hyperledger/caliper-core');
const { fabricRequest } = require('./lib/payloads');
const { seedPool, flushBatcher } = require('./lib/pool');
const txlog = require('./lib/txlog');

const FNS = { ReadEvidence: { path: '', op: 'READ_EVIDENCE' }, GetAuditTrail: { path: '/audit', op: 'READ_TRAIL' } };

class ReadWorkload extends WorkloadModuleBase {
  async initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext) {
    await super.initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext);
    this.mode = roundArguments.mode || 'fabric';
    this.label = roundArguments.label || `round-${roundIndex}`;
    this.payloadBytes = roundArguments.payloadBytes | 0;
    this.fn = roundArguments.fn || 'ReadEvidence';
    if (!FNS[this.fn]) throw new Error(`read: fn must be ReadEvidence | GetAuditTrail (got ${this.fn})`);
    this.pool = await seedPool(this, roundArguments.pool || 50);
    if (this.mode === 'rest') {
      // The anchored variants answer reads from the OFF-CHAIN trail, which only
      // exists once a batch closes (receipts carry the event copy). Seeds still
      // in an open queue would read back as 404 / [] and this round would
      // measure misses, not reads. Untimed, like the seeding itself.
      await flushBatcher();
    }
    this.n = 0;
  }

  async submitTransaction() {
    const target = this.pool[this.n % this.pool.length];
    this.n += 1;
    const spec = FNS[this.fn];
    const req = this.mode === 'rest'
      ? {
        method: 'GET',
        path: `/api/v1/evidence/${encodeURIComponent(target.id)}${spec.path}${target.caseId ? `?caseId=${encodeURIComponent(target.caseId)}` : ''}`,
      }
      : { ...fabricRequest(this.fn, [target.id], target.channel), readOnly: true };
    const status = await this.sutAdapter.sendRequests(req);
    txlog.log(this.workerIndex, this.label, spec.op, target.caseId || target.channel, target.id, status);
    return status;
  }
}

module.exports.createWorkloadModule = () => new ReadWorkload();
