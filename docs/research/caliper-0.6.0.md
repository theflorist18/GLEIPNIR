# Hyperledger Caliper 0.6.0 — Research Digest (GLEIPNIR)

Scope: everything needed to bind Caliper 0.6.0 to a **Fabric 2.5 SUT via the peer-gateway
connector**, write network configs + workloads, run rate-controlled rounds, read the report,
and (Q5) decide whether a **custom REST connector** can drive the HTTP gateway BFF.

All facts verified against PRIMARY sources: the versioned docs site
`hyperledger-caliper.github.io/caliper/0.6.0/`, the `hyperledger-caliper/caliper` repo at tag
**v0.6.0**, `hyperledger-caliper/caliper-benchmarks` at tag **v0.6.0**, and the npm registry.
Each item is tagged **VERIFIED** (with source) or **UNVERIFIED**.

> **Headline correction to CLAUDE.md / ARCHITECTURE.md.** Those docs say Caliper "binds SUT
> `fabric:2.5`". That string *does work* in 0.6.0, but only because the bind config **aliases**
> `2.4`, `2.5`, `3`, and `fabric-gateway` to the **same** peer-gateway binding. The docs page only
> lists `1.4`, `2.2`, `fabric-gateway` as "supported". There is **no separate `fabric:2.5`
> connector** — `fabric:2.5` == `fabric:fabric-gateway` == the peer-gateway connector using
> `@hyperledger/fabric-gateway@1.5.0`. Use `fabric:2.5` or `fabric:fabric-gateway`; they are byte-identical bindings. See Q1.

---

## Q1 — Install + `caliper bind` for a Fabric 2.5 SUT

### Package versions **[VERIFIED]**
- `@hyperledger/caliper-cli@0.6.0` published **2024-04-30**.
  Deps: `@hyperledger/caliper-core@0.6.0`, `@hyperledger/caliper-fabric@0.6.0`,
  `@hyperledger/caliper-ethereum@0.6.0`; `yargs@15.3.1`.
  `engines`: `node >=18.19.0`, `npm >=6.14.16`. `bin`: `caliper`.
  Source: `https://registry.npmjs.org/@hyperledger/caliper-cli/0.6.0`
- `@hyperledger/caliper-fabric@0.6.0` deps: `semver@7.1.1`, `@hyperledger/caliper-core@0.6.0`;
  same `engines`. Fabric SDK packages are **not** direct deps — they are installed at *bind* time.
  Source: `https://registry.npmjs.org/@hyperledger/caliper-fabric/0.6.0`

### Install **[VERIFIED]**
```bash
# local (recommended: prod deps only, as a project devDependency)
npm install --only=prod @hyperledger/caliper-cli@0.6.0
```
Source (docs): `https://hyperledger-caliper.github.io/caliper/0.6.0/getting-started/installing-caliper/`

### The bind command **[VERIFIED — authoritative from source config]**
The valid `--caliper-bind-sut` values for Fabric in 0.6.0 come from the bind config
`packages/caliper-cli/lib/lib/config.yaml` (verbatim at tag v0.6.0):

```yaml
sut:
    fabric:
        1.4: &fabric-sdk-v1
            packages: ['fabric-client@1.4.20', 'fabric-network@1.4.20','fs-extra@8.1.0']
        1.4.20: *fabric-sdk-v1
        1: *fabric-sdk-v1
        2.2: &fabric-sdk-v2
            packages: ['fabric-network@2.2.20']
        2.2.20: *fabric-sdk-v2
        2.4: &fabric-gateway
            packages: ['@hyperledger/fabric-gateway@1.5.0', '@grpc/grpc-js@1.10.3']
        2.5: *fabric-gateway
        3: *fabric-gateway
        fabric-gateway: *fabric-gateway
```
Source: `https://raw.githubusercontent.com/hyperledger-caliper/caliper/v0.6.0/packages/caliper-cli/lib/lib/config.yaml`

Interpretation:
- **Peer-gateway connector** is selected by **any** of `fabric:2.4`, `fabric:2.5`, `fabric:3`,
  `fabric:fabric-gateway` — they are YAML aliases of one binding that installs
  `@hyperledger/fabric-gateway@1.5.0` + `@grpc/grpc-js@1.10.3`. This is the legacy-SDK-free
  connector that talks to the Fabric 2.4+ peer Gateway service (the one GLEIPNIR wants).
- `fabric:1.4` and `fabric:2.2` install the **old node SDKs** (`fabric-network`) — the
  non-gateway connectors. Do **not** use these for GLEIPNIR.
- The docs "supported" list (`1.4, 2.2, fabric-gateway`) omits the 2.4/2.5/3 aliases, but the
  source proves they resolve to the same gateway binding.
- Config comment: the `2.4` key is **not** integration-cached, so upstream can mutate it without
  a version bump; `2.5`/`3`/`fabric-gateway` point at whatever `2.4` currently is.

**Recommended GLEIPNIR bind command** (either line is equivalent; prefer the second so the string
matches the SUT and reads self-documenting):
```bash
npx caliper bind --caliper-bind-sut fabric:fabric-gateway
# equivalently, and valid in 0.6.0:
npx caliper bind --caliper-bind-sut fabric:2.5
```
Notes:
- There is **no `--caliper-bind-sdk`** for the Fabric gateway binding (SDK version is fixed by the
  SUT key). `--caliper-bind-sdk` existed for older multi-SDK bindings; not needed here.
- Record the exact string used in `benchmark/README.md` (CLAUDE.md §Stale-knowledge traps). Use
  `fabric:fabric-gateway` (or `fabric:2.5`).

### Launch commands **[VERIFIED]**
```bash
npx caliper launch manager \
    --caliper-workspace . \
    --caliper-benchconfig benchmarks/scenario/simple/config.yaml \
    --caliper-networkconfig networks/fabric/test-network.yaml
# workers are spawned by the manager; `caliper launch worker` exists for distributed mode
```
Source (docs): installing-caliper page (above).

---

## Q2 — Fabric network-config for the peer-gateway connector

The Caliper **network configuration** (a.k.a. connector config) for 0.6.0. Real, verbatim example
from `caliper-benchmarks` v0.6.0 (`networks/fabric/test-network.yaml`) — this is the canonical
minimal shape and works with the gateway binding **[VERIFIED]**:

```yaml
name: Caliper Benchmarks
version: "2.0.0"                 # MUST be the string "2.0.0"

caliper:
  blockchain: fabric            # selects the Fabric connector

channels:
  - channelName: mychannel      # exact channel name on the SUT
    contracts:                  # NOTE: key is `contracts`, NOT `contractIds`
    - id: fabcar                # chaincode/contract id as deployed on the channel
    - id: simple
    #   contractID: <alias>     # optional caliper-level unique id (defaults to `id`)

organizations:
  - mspid: Org1MSP
    identities:
      certificates:
      - name: 'User1'                     # identity label used as invokerIdentity
        clientPrivateKey:
          path: '.../users/User1@org1.example.com/msp/keystore/priv_sk'
        clientSignedCert:
          path: '.../users/User1@org1.example.com/msp/signcerts/User1@...-cert.pem'
    connectionProfile:
      path: '.../connection-org1.yaml'    # standard Fabric CCP
      discover: true                      # IGNORED by the gateway binding (see below)
```
Source: `https://raw.githubusercontent.com/hyperledger-caliper/caliper-benchmarks/v0.6.0/networks/fabric/test-network.yaml`
and docs `https://hyperledger-caliper.github.io/caliper/0.6.0/connectors/fabric-config/`

Exact-key notes **[VERIFIED]**:
- Top-level keys: `name`, `version` (`"2.0.0"`), `caliper.blockchain: fabric`, `channels[]`,
  `organizations[]`; optional `info`, and `caliper.sutOptions.mutualTls` (gateway ignores it).
- The channel contract key is **`contracts`** (array of `{ id, contractID? }`) — **`contractIds`
  is NOT the 0.6.0 key**. `contractID` (if set) must be unique across all channels.
- Identity: `identities.certificates[]` each has `name`, optional `admin: true`, and
  `clientPrivateKey` / `clientSignedCert`, each of which takes **either** `path:` **or** `pem:`.
  A file-system `identities.wallet.path` (+ `adminNames`) is the alternative.
- Each org needs **either** `connectionProfile.{path,discover}` **or** a `peers:` block (the
  gateway-era alternative to a CCP).

### Gateway connector: requires vs ignores **[VERIFIED — fabric-config doc]**
- **Requires**: `name`, `version`, `caliper.blockchain: fabric`, `channels[].channelName` +
  `contracts[].id`, `organizations[].mspid`, at least one identity, and one of
  `connectionProfile`/`peers` to locate + TLS-trust the peer(s).
- **Ignores / unsupported under `fabric:fabric-gateway`**:
  - `connectionProfile.discover` — ignored (the peer Gateway service does its own
    endorsement discovery server-side).
  - **mutual TLS** (`caliper.sutOptions.mutualTls`) — not supported.
  - request options `targetPeers` / `targetOrganizations` — **throw an error** (peer/org
    targeting is a server-side gateway decision). See Q3.
  - per-transaction detailed execution data — not surfaced by the gateway binding.

### Minimal standard Fabric connection profile (CCP)  **[VERIFIED structure — standard Fabric CCP; discover ignored by gateway]**
A standard Fabric CCP is accepted. `ssl-target-name-override` lives under
`peers.<peer>.grpcOptions`. Minimal single-peer/single-org form:
```yaml
name: org1-ccp
version: "1.0.0"
client:
  organization: Org1
organizations:
  Org1:
    mspid: Org1MSP
    peers:
      - peer0.org1.example.com
peers:
  peer0.org1.example.com:
    url: grpcs://localhost:7051
    tlsCACerts:
      path: .../peerOrganizations/org1.example.com/tlsca/tlsca.org1.example.com-cert.pem
    grpcOptions:
      ssl-target-name-override: peer0.org1.example.com
      grpc.keepalive_time_ms: 600000
```
Because the gateway binding ignores `discover`, endorsement targeting is handled by the peer's
Gateway service; the CCP mainly supplies the **peer endpoint + TLS root**. (The `peers:`-in-network-config
alternative carries the same `endpoint` + `tlsCACerts` + `grpcOptions` fields inline.)

---

## Q3 — Workload module API

`WorkloadModuleBase` is imported from `@hyperledger/caliper-core`. **[VERIFIED — workload-module doc]**

Methods (exact signatures):
```js
'use strict';
const { WorkloadModuleBase } = require('@hyperledger/caliper-core');

class MyWorkload extends WorkloadModuleBase {
  async initializeWorkloadModule(workerIndex, totalWorkers, roundIndex,
                                 roundArguments, sutAdapter, sutContext) {
    await super.initializeWorkloadModule(workerIndex, totalWorkers, roundIndex,
                                         roundArguments, sutAdapter, sutContext);
    // seed per-worker state (evidence IDs, counters) from roundArguments here
  }
  async submitTransaction() {           // called once per generated TX (hot path)
    const request = { /* see below */ };
    await this.sutAdapter.sendRequests(request);
  }
  async cleanupWorkloadModule() { /* teardown */ }
}
function createWorkloadModule() { return new MyWorkload(); }
module.exports.createWorkloadModule = createWorkloadModule;
```
- `this.sutAdapter` (the connector) and `this.sutContext` are set by the base
  `initializeWorkloadModule`; `this.roundArguments` holds the round's `workload.arguments`.

### `sutAdapter.sendRequests(...)` argument shape (Fabric) **[VERIFIED — fabric-config doc]**
Canonical example object:
```js
let requestSettings = {
    contractId: 'marbles',                 // required — matches contracts[].id (or contractID)
    contractFunction: 'initMarble',        // required — chaincode function
    contractArguments: ['MARBLE#1','Red','100','Attila'], // optional string[]
    invokerIdentity: 'User1',              // optional — identities.certificates[].name
    invokerMspId: 'Org1MSP',               // optional — disambiguates identity across orgs
    readOnly: false,                       // optional — true => evaluate (query) not submit
    transientMap: { /* k: v */ },          // optional — transient data
    channel: 'mychannel',                  // optional — overrides default channel
    // targetPeers / targetOrganizations   // OPTIONAL but THROW under fabric-gateway binding
    // timeout, orderer                     // 1.4 binding ONLY (ignored/invalid for gateway)
};
await this.sutAdapter.sendRequests(requestSettings);   // accepts one object or an array
```
Property support summary:
- Supported by gateway binding: `contractId`, `contractFunction`, `contractArguments`,
  `invokerIdentity`, `invokerMspId`, `readOnly`, `transientMap`, `channel`.
- **Errors** under gateway binding: `targetPeers`, `targetOrganizations`.
- `timeout` / `orderer`: **1.4 binding only** — do not use with GLEIPNIR's gateway binding.

For GLEIPNIR's create/transfer/access/verify workloads: use `readOnly:false` for
`CreateEvidence`/`TransferCustody`/`AccessLog`/`RemoveEvidence`; `readOnly:true` for
`ReadEvidence`/`GetAuditTrail`. For the Parallel variant, per-case channel is selected either by a
per-channel network config **or** by the `channel:` request field.
Source: `https://hyperledger-caliper.github.io/caliper/0.6.0/concepts/workload-module/` and `.../connectors/fabric-config/`

---

## Q4 — Rate controllers + round config

### fixed-rate **[VERIFIED — rate-controllers doc]**
```yaml
rateControl:
  type: fixed-rate
  opts:
    tps: 25          # constant transactions/sec across ALL workers combined
```

### fixed-load **[VERIFIED — rate-controllers doc]**
```yaml
rateControl:
  type: fixed-load
  opts:
    transactionLoad: 5    # target number of in-flight (pending) TX to hold on the SUT
    startTps: 100         # initial send rate before the controller adapts
```
`fixed-load` is closed-loop: it dynamically raises/lowers TPS to keep `transactionLoad` pending
transactions on the system. `fixed-rate` is open-loop constant offered-load.
Source: `https://hyperledger-caliper.github.io/caliper/0.6.0/concepts/rate-controllers/`

### Round/benchmark config YAML shape **[VERIFIED — bench-config doc + real caliper-benchmarks config]**
Real verbatim example (`caliper-benchmarks` v0.6.0 `benchmarks/scenario/simple/config.yaml`):
```yaml
test:
  name: simple
  description: >-
    ...
  workers:
    number: 1                         # worker process count (type optional)
  rounds:
    - label: open                     # round label (appears in report)
      txNumber: 1000                  # EITHER a fixed TX count ...
      rateControl:
        type: fixed-rate
        opts:
          tps: 50
      workload:
        module: benchmarks/scenario/simple/open.js   # path to workload module
        arguments:                    # object passed to the workload (this.roundArguments)
          initialMoney: 10000
          moneyToTransfer: 100
          numberOfAccounts: 1000
    - label: query
      txDuration: 60                  # ... OR a duration in seconds (mutually exclusive)
      rateControl:
        type: fixed-rate
        opts:
          tps: 100
      workload:
        module: benchmarks/scenario/simple/query.js
```
Per-round keys: `label`, `txNumber` **or** `txDuration` (seconds), `rateControl.{type,opts}`,
`workload.{module, arguments}`. Top level: `test.{name, description, workers.number, rounds[]}`;
optional sibling `monitors:` block (`transaction`/`resource` modules like `prometheus`, `docker`).
Source: `https://hyperledger-caliper.github.io/caliper/0.6.0/concepts/bench-config/` and
`https://raw.githubusercontent.com/hyperledger-caliper/caliper-benchmarks/v0.6.0/benchmarks/scenario/simple/config.yaml`

---

## Q5 — Custom / community connector (can a REST connector drive the HTTP gateway?)

**Yes.** `caliper.blockchain` can point to a **local connector module path** (relative to the
Caliper workspace, or absolute) **or** an npm package name. **[VERIFIED — writing-connectors doc]**
Source: `https://hyperledger-caliper.github.io/caliper/0.6.0/connectors/writing-connectors/`

Required entry-point export:
```js
// index.js of the custom connector
module.exports.ConnectorFactory = require('./lib/connectorFactory').ConnectorFactory;

// factory: called once in the manager (workerIndex === -1) and once per worker (>= 0)
async function ConnectorFactory(workerIndex) {
    return new MyConnector(workerIndex);   // returns a ConnectorInterface instance
}
```
Network config:
```yaml
caliper:
  blockchain: ./fast-ledger/index.js      # local path (or an npm package name)
```

Connector interface — methods to implement (`ConnectorInterface`):
- `getType()` → string connector name
- `getWorkerIndex()` → zero-based worker index
- `async init(workerInit)` — one-time init (boolean flags worker vs manager)
- `async installSmartContract()` — deploy/prepare contract (manager only; may be a no-op)
- `async prepareWorkerArguments(number)` → `Promise<object[]>` (manager → per-worker payloads)
- `async getContext(roundIndex, args)` → `Promise<object>` (per-round context)
- `async releaseContext()` — per-round cleanup
- `async sendRequests(requests)` — **hot path**; returns `Promise`

Easiest path: extend **`ConnectorBase`** (from `@hyperledger/caliper-core`), which supplies default
`constructor`, `getType`, `getWorkerIndex`, `prepareWorkerArguments`, and `sendRequests` (fan-out).
Then you only implement:
```js
async _sendSingleRequest(request) {
    const status = new TxStatus();          // from @hyperledger/caliper-core
    // ... perform the work (e.g. HTTP POST to the GLEIPNIR gateway BFF) ...
    status.SetStatusSuccess();  // or status.SetStatusFail();
    return status;              // must carry start time, finish time, final status
}
```
`TxStatus` usage: the connector must record at least **start time, finish time, and final
status** (success/fail) per request; results are emitted via the `txsFinished` event with
`TxStatus | TxStatus[]`.

**Conclusion for GLEIPNIR**: a custom **REST connector** is fully supported and is the clean way to
drive the HTTP gateway BFF from Caliper for the Anchoring/Parallel-Anchored enqueue path — set
`caliper.blockchain` to the local connector path, extend `ConnectorBase`, and implement
`_sendSingleRequest` to call the REST endpoint and return a timed `TxStatus`. (Latency/throughput
then reflect the BFF path, not the raw peer-gateway path — keep the two connectors' results
labelled distinctly.)

---

## Q6 — Report output + throughput caveat

### Where the report lands **[VERIFIED — caliper-core default.yaml]**
`packages/caliper-core/lib/common/config/default.yaml` (verbatim):
```yaml
report:
    path: 'report.html'         # absolute or WORKSPACE-RELATIVE (default: ./report.html)
    options:
        flag: 'w'
        mode: 0666
    precision: 3                # significant figures in the report
    charting:
        hue: 21
        scheme: 'triade'
```
Override via config key `caliper.report.path` / CLI `--caliper-report-path`. A single
**`report.html`** is written to the Caliper workspace (there is no separate `results/` dir by
default; JSON/round data are embedded in the HTML). GLEIPNIR's `checkpoint.py` should point at this
path per run.
Source: `https://raw.githubusercontent.com/hyperledger-caliper/caliper/v0.6.0/packages/caliper-core/lib/common/config/default.yaml`

### Per-round summary columns **[VERIFIED — report.js source, v0.6.0]**
`packages/caliper-core/lib/manager/report/report.js` line 137:
```js
const columns = ['Name','Succ','Fail','Send Rate (TPS)',
                 'Max Latency (s)','Min Latency (s)','Avg Latency (s)','Throughput (TPS)'];
```
Exact per-round semantics from the same file (v0.6.0):
- `Max/Min/Avg Latency (s)` — computed over **successful TX only**; printed as `'-'` when
  `Succ == 0`. Latency = submit→commit, seconds.
- `Send Rate (TPS)` = `(Succ + Fail) / (lastCreateTime − firstCreateTime)` (first→last **submit**).
- `Throughput (TPS)` = `(Succ + Fail) / (lastFinishTime − firstCreateTime)` (first submit → last
  **commit**).
Source: `https://raw.githubusercontent.com/hyperledger-caliper/caliper/v0.6.0/packages/caliper-core/lib/manager/report/report.js`

### The throughput-semantics caveat (issue #1418) **[VERIFIED]**
- **report.js** numerator is **`Succ + Fail`** (both throughput and send rate). So a round with
  **0 successes still shows positive throughput** — issue #1418's repro: **32.6 TPS with 0 Succ /
  5001 Fail**. Latency columns, by contrast, are successful-only.
- Issue #1418 was filed against an **older FAQ** that said `Succ / (...)`. As of the **0.6.0** FAQ
  the text now reads `(Succ+Fail) / (last submitting time − first submitting time)` — i.e. the FAQ
  was aligned toward the code (tracked by PR #1695), but the **throughput denominator in code ends
  at last commit**, while the FAQ/send-rate window ends at last submit — a residual nuance.
- **GLEIPNIR action** (already in ARCHITECTURE.md §Key Findings 4): do **not** report Caliper's
  `Throughput (TPS)` as-is. Compute **successful-only** throughput yourself from the round data:
  `Succ / (lastFinishTime − firstCreateTime)`, and state this in the methodology. Optionally treat
  `MVCC_READ_CONFLICT` as a tabulated failure class (issue #1397).
Sources: `https://github.com/hyperledger-caliper/caliper/issues/1418` ,
`https://hyperledger-caliper.github.io/caliper/0.6.0/getting-started/faq/`

---

## Q7 — Node.js support for 0.6.0

**Node 18 and Node 20** (no others). **[VERIFIED]**
- 0.6.0 release/CHANGELOG: *"Official support for Node 18 and Node 20 for users and contributors
  (previous versions of node are now unsupported)."*
  Source: `https://raw.githubusercontent.com/hyperledger-caliper/caliper/v0.6.0/CHANGELOG.md`
- `engines` on `@hyperledger/caliper-cli@0.6.0`: `node >=18.19.0`, `npm >=6.14.16`.
  Source: npm (Q1).
- GLEIPNIR pins **Node 20.19** — inside the supported window. ✅

---

## Quick-reference cheat sheet (all VERIFIED)

| Thing | Value |
|---|---|
| CLI package | `@hyperledger/caliper-cli@0.6.0` (deps core/fabric/ethereum @0.6.0) |
| Install | `npm install --only=prod @hyperledger/caliper-cli@0.6.0` |
| Bind (peer-gateway) | `npx caliper bind --caliper-bind-sut fabric:fabric-gateway` (== `fabric:2.5` == `fabric:2.4` == `fabric:3`) |
| Gateway SDK installed at bind | `@hyperledger/fabric-gateway@1.5.0`, `@grpc/grpc-js@1.10.3` |
| Non-gateway (do not use) | `fabric:1.4` (fabric-network@1.4.20), `fabric:2.2` (fabric-network@2.2.20) |
| Net-config `version` | `"2.0.0"` |
| Channel contracts key | `channels[].contracts[].id` (NOT `contractIds`) |
| Request keys (gateway) | `contractId, contractFunction, contractArguments, invokerIdentity, invokerMspId, readOnly, transientMap, channel` |
| Request keys that ERROR (gateway) | `targetPeers, targetOrganizations` |
| Rate controllers | `fixed-rate` (`opts.tps`), `fixed-load` (`opts.transactionLoad`, `opts.startTps`) |
| Round keys | `label`, `txNumber`\|`txDuration`, `rateControl.{type,opts}`, `workload.{module,arguments}` |
| Custom connector export | `module.exports.ConnectorFactory = async (workerIndex) => connector` |
| Custom connector base | extend `ConnectorBase`, implement `_sendSingleRequest(req) -> TxStatus` |
| Report file | `report.html` (workspace-relative; key `caliper.report.path`) |
| Report columns | `Name, Succ, Fail, Send Rate (TPS), Max/Min/Avg Latency (s), Throughput (TPS)` |
| Throughput caveat | code numerator = `Succ+Fail`; report successful-only yourself (issue #1418) |
| Node | 18 or 20 (`engines: node >=18.19.0`) |

### Primary sources
- Docs 0.6.0: installing-caliper, connectors/fabric-config, connectors/writing-connectors,
  concepts/rate-controllers, concepts/bench-config, concepts/workload-module, getting-started/faq
  under `https://hyperledger-caliper.github.io/caliper/0.6.0/`
- Repo `hyperledger-caliper/caliper` @ **v0.6.0**: `packages/caliper-cli/lib/lib/config.yaml`,
  `packages/caliper-core/lib/common/config/default.yaml`,
  `packages/caliper-core/lib/manager/report/report.js`, `CHANGELOG.md`
- Repo `hyperledger-caliper/caliper-benchmarks` @ **v0.6.0**: `networks/fabric/test-network.yaml`,
  `benchmarks/scenario/simple/config.yaml`
- npm: `@hyperledger/caliper-cli/0.6.0`, `@hyperledger/caliper-fabric/0.6.0`
- Issue #1418 (throughput semantics)

### Unverified / caveats
- **[UNVERIFIED]** The minimal standalone CCP above is assembled from the standard Fabric
  connection-profile schema (fabric-samples `connection-org1.yaml` pattern), not quoted verbatim
  from a 0.6.0 file; the `ssl-target-name-override` placement under `peers.<peer>.grpcOptions` is
  standard Fabric CCP. The gateway binding ignores `discover` regardless.
- **[UNVERIFIED nuance]** FAQ wording can drift between doc builds; the **code** (report.js at
  v0.6.0, quoted) is authoritative: throughput numerator is `Succ+Fail`, denominator ends at last
  commit. Treat the code as ground truth over the FAQ prose.
