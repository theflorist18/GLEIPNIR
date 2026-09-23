'use strict';

// verify workload — VERIFICATION latency of one event (thesis RQ2), reported
// in the reads table. Anchored variants only (rest mode).
//
// initializeWorkloadModule (NOT timed): seed `seedCount` events through the
// gateway enqueue path (capturing eventIds from the 202 responses), then force
// a batch boundary so roots are committed and receipts are complete. The timed
// round then GETs /api/v1/evidence/:id/verify?eventId=... through the REST
// connector, so latency reflects fetch -> recompute branch -> compare root.
//
// Seeding/flush use direct fetch (they need response bodies and are not part
// of the measurement); only the verify GETs go through sutAdapter.
// roundArguments: { label, seedCount, variant?, channels?, caseId?, payloadBytes? }.
// With `channels: C` (Parallel-Anchored) seeds are spread across
// case-001..case-00C; the verify GET itself is caseId-free (the receipt's
// rootRef carries the scope). Env: GATEWAY_URL, BATCHER_URL, GLEIPNIR_TOKEN.
// Each timed verify is logged via lib/txlog as VERIFY.

const { WorkloadModuleBase } = require('@hyperledger/caliper-core');
const crypto = require('crypto');
const { caseSelector, createRestBody, filler } = require('./lib/payloads');
const { flushBatcher } = require('./lib/pool');
const txlog = require('./lib/txlog');

class VerifyWorkload extends WorkloadModuleBase {
  async initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext) {
    await super.initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext);
    this.gatewayUrl = process.env.GATEWAY_URL || 'http://localhost:3000';
    this.token = process.env.GLEIPNIR_TOKEN || 'dev-token';
    this.label = roundArguments.label || `round-${roundIndex}`;
    this.payloadBytes = roundArguments.payloadBytes | 0;
    const nextCase = caseSelector(roundArguments, workerIndex);
    this.seeded = []; // {eventId, evidenceId, caseId}
    this.n = 0;

    const seedCount = roundArguments.seedCount || 50;
    const headers = { 'content-type': 'application/json', authorization: `Bearer ${this.token}` };
    for (let i = 0; i < seedCount; i += 1) {
      const id = `ev-verify-w${workerIndex}-r${roundIndex}-${i}-${crypto.randomUUID().slice(0, 8)}`;
      const caseId = nextCase ? nextCase() : (roundArguments.caseId || null);
      const body = createRestBody(id, `custodian-${workerIndex}`, caseId, filler(id, this.payloadBytes));
      const resp = await fetch(`${this.gatewayUrl}/api/v1/evidence`, { method: 'POST', headers, body: JSON.stringify(body) });
      const j = await resp.json().catch(() => ({}));
      if (j.eventId) this.seeded.push({ eventId: j.eventId, evidenceId: id, caseId });
      // Untimed ledger write (no TxStatus — this goes over plain fetch), so it
      // counts toward storage bytes/event but never toward a timing statistic.
      txlog.logUntimed(workerIndex, this.label, 'CREATE', caseId, id, resp.ok,
        resp.ok ? null : `HTTP ${resp.status}`);
    }
    // Force the batch boundary so roots are committed and receipts finalised.
    await flushBatcher();
  }

  async submitTransaction() {
    if (this.seeded.length === 0) {
      // Nothing seeded (misconfiguration) — issue a harmless verify to surface failure.
      const status = await this.sutAdapter.sendRequests({ method: 'GET', path: '/api/v1/evidence/none/verify?eventId=none' });
      txlog.log(this.workerIndex, this.label, 'VERIFY', null, null, status);
      return status;
    }
    const s = this.seeded[this.n % this.seeded.length];
    this.n += 1;
    const status = await this.sutAdapter.sendRequests({
      method: 'GET',
      path: `/api/v1/evidence/${encodeURIComponent(s.eventId)}/verify?eventId=${encodeURIComponent(s.eventId)}`,
    });
    txlog.log(this.workerIndex, this.label, 'VERIFY', s.caseId, s.evidenceId, status);
    return status;
  }
}

module.exports.createWorkloadModule = () => new VerifyWorkload();
