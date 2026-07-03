'use strict';

// Thin HTTP client to the merkle-batcher's enqueue endpoint. Used for the
// Anchoring / Parallel-Anchored write path (docs/CONTRACTS.md §6, §9). Injected
// into the routes so it can be faked in tests.

function makeBatcherClient(batcherUrl) {
  return {
    async enqueue(event) {
      const resp = await fetch(`${batcherUrl}/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(event),
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        const err = new Error(`batcher /events -> ${resp.status} ${text}`);
        err.status = 502;
        throw err;
      }
      return resp.json();
    },
  };
}

module.exports = { makeBatcherClient };
