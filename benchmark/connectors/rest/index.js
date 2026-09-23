'use strict';

// Custom Caliper 0.6.0 connector that drives the GLEIPNIR gateway BFF over HTTP.
// Used for the Anchoring / Parallel-Anchored write path and the verify workload,
// where transactions go through the REST enqueue path rather than the raw
// peer-gateway connector.
//
// Verified against the Caliper 0.6.0 "Writing Connectors" doc
// (docs/research/caliper-0.6.0.md Q5): the network config points caliper.blockchain
// at this module path; the required export is ConnectorFactory(workerIndex) ->
// ConnectorInterface. Extending ConnectorBase supplies constructor/getType/
// getWorkerIndex/prepareWorkerArguments/sendRequests(fan-out); we implement
// _sendSingleRequest, returning a timed TxStatus (start + final time + status).
//
// IMPORTANT: latency/throughput from this connector reflect the BFF path (enqueue
// or verify), NOT the raw peer-gateway path — keep its results labelled distinctly
// from the fabric-connector results (see benchmark/README.md).

const { ConnectorBase, TxStatus } = require('@hyperledger/caliper-core');

class RestGatewayConnector extends ConnectorBase {
  constructor(workerIndex, bcType) {
    super(workerIndex, bcType);
    this.gatewayUrl = process.env.GATEWAY_URL || 'http://localhost:3000';
    this.token = process.env.GLEIPNIR_TOKEN || 'dev-token';
  }

  getType() {
    return 'rest-gateway';
  }

  async init(_workerInit) { /* nothing to bootstrap */ }

  async installSmartContract() { /* chaincode is deployed by orchestration, not here */ }

  async prepareWorkerArguments(number) {
    return Array.from({ length: number }, () => ({}));
  }

  async getContext() {
    return {};
  }

  async releaseContext() { /* no per-round resources */ }

  // request = { method, path, body } (built by the workloads).
  async _sendSingleRequest(request) {
    const status = new TxStatus();               // records time_create
    const method = request.method || 'POST';
    const url = `${this.gatewayUrl}${request.path}`;
    const headers = { authorization: `Bearer ${this.token}` };
    let init = { method, headers };
    if (request.body !== undefined) {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(request.body);
    }
    try {
      const resp = await fetch(url, init);
      await resp.text().catch(() => '');         // drain body
      if (resp.ok) {
        status.SetStatusSuccess();
      } else {
        // The error string is what workload/lib/txlog.js records as `err`,
        // so collect.py can classify HTTP_4XX / HTTP_5XX failures.
        status.SetStatusFail();
        status.SetErrMsg(0, `HTTP ${resp.status}`);
      }
    } catch (err) {
      status.SetStatusFail();
      status.SetErrMsg(0, (err && err.message) || String(err));
    }
    // No extra time stamping here: SetStatusSuccess()/SetStatusFail() record
    // time_final themselves; TxStatus has no SetTimeFinal in Caliper 0.6.0
    // (calling it threw and aborted every rest-mode round — audit F45).
    return status;
  }
}

async function ConnectorFactory(workerIndex) {
  // workerIndex === -1 in the manager process; >= 0 per worker.
  return new RestGatewayConnector(workerIndex, 'rest-gateway');
}

module.exports.ConnectorFactory = ConnectorFactory;
module.exports.RestGatewayConnector = RestGatewayConnector;
