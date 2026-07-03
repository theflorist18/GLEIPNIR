'use strict';

// verify workload — measures VERIFICATION/AUDIT latency (thesis RQ2), the
// numerator of the latency-vs-storage tradeoff. Anchoring variants only.
//
// initializeWorkloadModule (NOT timed): seed M events through the gateway enqueue
// path (capturing their eventIds from the 202 responses), then force a batch
// boundary so roots are committed and receipts are complete. The timed round then
// hammers GET /api/v1/evidence/:id/verify?eventId=... through the connector, so
// Caliper's latency columns reflect fetch->recompute->compare-root cost.
//
// Seeding/flush use direct fetch (they need response bodies + are not part of the
// measurement); only the verify GETs go through sutAdapter.
// roundArguments: { seedCount, caseId? }. Env: GATEWAY_URL, BATCHER_URL, GLEIPNIR_TOKEN.

const { WorkloadModuleBase } = require('@hyperledger/caliper-core');
const crypto = require('crypto');

class VerifyWorkload extends WorkloadModuleBase {
  async initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext) {
    await super.initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext);
    this.gatewayUrl = process.env.GATEWAY_URL || 'http://localhost:3000';
    this.batcherUrl = process.env.BATCHER_URL || 'http://localhost:4001';
    this.token = process.env.GLEIPNIR_TOKEN || 'dev-token';
    this.caseId = roundArguments.caseId;
    this.eventIds = [];
    this.n = 0;

    const seedCount = roundArguments.seedCount || 50;
    const headers = { 'content-type': 'application/json', authorization: `Bearer ${this.token}` };
    for (let i = 0; i < seedCount; i += 1) {
      const id = `ev-verify-w${workerIndex}-r${roundIndex}-${i}-${crypto.randomUUID().slice(0, 8)}`;
      const body = { evidenceId: id, version: '1.0', identity: { org: 'Org1MSP', subject: `custodian-${workerIndex}` }, storage: { protocol: 'file', location: `blob://${id}` }, ...(this.caseId ? { caseId: this.caseId } : {}) };
      const resp = await fetch(`${this.gatewayUrl}/api/v1/evidence`, { method: 'POST', headers, body: JSON.stringify(body) });
      const j = await resp.json().catch(() => ({}));
      if (j.eventId) this.eventIds.push(j.eventId);
    }
    // Force the batch boundary so roots are committed and receipts finalised.
    await fetch(`${this.batcherUrl}/flush`, { method: 'POST' }).catch(() => {});
  }

  async submitTransaction() {
    if (this.eventIds.length === 0) {
      // Nothing seeded (misconfiguration) — issue a harmless verify to surface failure.
      return this.sutAdapter.sendRequests({ method: 'GET', path: '/api/v1/evidence/none/verify?eventId=none' });
    }
    const eventId = this.eventIds[this.n % this.eventIds.length];
    this.n += 1;
    return this.sutAdapter.sendRequests({
      method: 'GET',
      path: `/api/v1/evidence/${encodeURIComponent(eventId)}/verify?eventId=${encodeURIComponent(eventId)}`,
    });
  }
}

module.exports.createWorkloadModule = () => new VerifyWorkload();
