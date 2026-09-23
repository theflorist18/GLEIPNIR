'use strict';

// Untimed pool seeding shared by the pool workloads (transfer / access /
// dispose / read): each worker creates `size` evidence items through the
// round's OWN connector (the real write path, never measured) and gets back
// [{id, caseId, channel}] for its timed phase to target. Every later op hits
// the SAME case its evidence was created on (custody heads live per channel).
//
// The seeds ARE ledger writes, so each one is recorded in the per-transaction
// log with `timed: false`: collect.py counts them in the storage
// bytes-per-event denominator and excludes them from every timing statistic.

const { evidenceId, codexJson, createRestBody, fabricRequest, caseSelector, filler } = require('./payloads');
const txlog = require('./txlog');

// The CreateEvidence request for either write path.
function createRequest(mode, id, subject, target, payload) {
  if (mode === 'rest') {
    return { method: 'POST', path: '/api/v1/evidence', body: createRestBody(id, subject, target.caseId, payload) };
  }
  return fabricRequest('CreateEvidence', [id, codexJson(id, subject, payload)], target.channel);
}

// wl = the workload module instance (after super.initializeWorkloadModule).
async function seedPool(wl, size) {
  const ra = wl.roundArguments || {};
  const nextCase = caseSelector(ra, wl.workerIndex);
  const pool = [];
  for (let i = 0; i < size; i += 1) {
    const id = evidenceId(wl.workerIndex, wl.roundIndex, `seed${i}`);
    const spread = nextCase ? nextCase() : null;
    const target = { id, caseId: spread || ra.caseId || null, channel: spread || ra.channel || null };
    pool.push(target);
    const status = await wl.sutAdapter.sendRequests(
      createRequest(wl.mode, id, `custodian-${wl.workerIndex}`, target, filler(id, wl.payloadBytes)),
    );
    txlog.log(wl.workerIndex, wl.label, 'CREATE', target.caseId || target.channel, id, status, false);
  }
  return pool;
}

// Force a batch boundary on the merkle-batcher (rest mode only). The off-chain
// trail a read round consults only exists once a batch closes — receipts (with
// their event copy) are written in processBatch — so seeds left in an open
// queue would read back as 404 / an empty trail and the reads table would
// measure misses instead of reads. verify.js flushes for the same reason.
// Best-effort: a missing batcher must not abort a non-anchored round.
async function flushBatcher() {
  const url = process.env.BATCHER_URL || 'http://localhost:4001';
  try {
    const resp = await fetch(`${url}/flush`, { method: 'POST' });
    if (!resp.ok) process.stderr.write(`[pool] batcher /flush -> ${resp.status}\n`);
    await resp.text().catch(() => '');
  } catch (err) {
    process.stderr.write(`[pool] batcher /flush failed: ${(err && err.message) || err}\n`);
  }
}

module.exports = { seedPool, createRequest, flushBatcher };
