'use strict';

// Thin HTTP client to the receipt-store's per-evidence index (M26). Used by
// the READ path of the batched variants (Anchoring / Parallel-Anchored), whose
// audit events never land on the app channel as records — only the Merkle
// root does — so a trail must be reassembled from the off-chain receipts
// (each receipt carries the CoC `event` it witnesses). Injected into the
// routes so it can be faked in tests. Same shape as batcherClient.

function makeReceiptsClient(receiptStoreUrl) {
  return {
    // -> JSON array of receipts in index (enqueue) order; [] when none.
    async listByEvidence(evidenceId) {
      const resp = await fetch(`${receiptStoreUrl}/receipts?evidenceId=${encodeURIComponent(evidenceId)}`);
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        const err = new Error(`receipt-store /receipts?evidenceId -> ${resp.status} ${text}`);
        err.status = 502;
        throw err;
      }
      return resp.json();
    },
  };
}

module.exports = { makeReceiptsClient };
