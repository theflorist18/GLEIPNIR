'use strict';

// Untimed pool seeding shared by the pool workloads (transfer / access /
// dispose / read): each worker creates `size` evidence items through the
// round's OWN connector (the real write path, never measured) and gets back
// [{id, caseId}] for its timed phase to target. Every later op hits
// the SAME case its evidence was created on (custody heads live per channel).
//
// The seeds ARE ledger writes, so each one is recorded in the per-transaction
// log with `timed: false`: collect.py counts them in the storage
// bytes-per-event denominator and excludes them from every timing statistic.

const { evidenceId, opRequest, caseSelector, filler } = require('./payloads');
const txlog = require('./txlog');

// wl = the workload module instance (after super.initializeWorkloadModule).
async function seedPool(wl, size) {
  const nextCase = caseSelector(wl.roundArguments, wl.workerIndex);
  const pool = [];
  for (let i = 0; i < size; i += 1) {
    const id = evidenceId(wl.workerIndex, wl.roundIndex, `seed${i}`);
    const target = { id, caseId: nextCase ? nextCase() : null };
    pool.push(target);
    const status = await wl.sutAdapter.sendRequests(opRequest(wl.mode, {
      op: 'CREATE', evidenceId: id, actor: `custodian-${wl.workerIndex}`, detail: { payload: filler(id, wl.payloadBytes) },
    }, target.caseId));
    txlog.log(wl.workerIndex, wl.label, 'CREATE', target.caseId, id, status, false);
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

module.exports = { seedPool, flushBatcher };
