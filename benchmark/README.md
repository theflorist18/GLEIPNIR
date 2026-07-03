# benchmark

**Responsibility:** the Hyperledger **Caliper 0.6.0** workspace — the four workload modules,
per-variant network configs, the custom REST connector, and rate-controlled round configs.
Drives all four variants; results feed `orchestration/collect.py`.

## Binding (record the exact string — CLAUDE.md stale-knowledge trap)

```bash
npm install
npm run bind           # == npx caliper bind --caliper-bind-sut fabric:fabric-gateway
```

`fabric:fabric-gateway` selects the **peer-gateway connector** (installs
`@hyperledger/fabric-gateway@1.5.0` + `@grpc/grpc-js@1.10.3`). `fabric:2.5`, `fabric:2.4`,
`fabric:3` are byte-identical aliases of the same binding (docs/research/caliper-0.6.0.md
Q1). Node 18 or 20 (0.6.0 support window).

## Launch

```bash
# Standard / Parallel (fabric connector, peer-gateway):
npx caliper launch manager --caliper-workspace . \
  --caliper-benchconfig benchmarks/steady-standard.yaml \
  --caliper-networkconfig networks/coc-main.yaml

# Anchoring / Parallel-Anchored + verify (custom REST connector -> gateway BFF):
GATEWAY_URL=http://localhost:3000 BATCHER_URL=http://localhost:4001 GLEIPNIR_TOKEN=dev-token \
npx caliper launch manager --caliper-workspace . \
  --caliper-benchconfig benchmarks/steady-anchoring.yaml \
  --caliper-networkconfig networks/rest-gateway.yaml
```

`orchestration/sweep.py` invokes these per cell of the N/K/channel sweep.

## Layout

| Path | What |
|---|---|
| `sweeps.yaml` | **single source of truth** for N/K/channels/load/repetitions (§10) |
| `workload/*.js` | createEvidence, transferCustody, accessLog, verify — extend `WorkloadModuleBase` |
| `connectors/rest/` | custom `ConnectorBase` connector driving the gateway REST path |
| `networks/coc-main.yaml`, `case-template.yaml` | fabric peer-gateway network configs |
| `networks/rest-gateway.yaml` | points `caliper.blockchain` at the REST connector |
| `benchmarks/*.yaml` | round configs (smoke + steady per variant + verify) |
| `generate-rounds.js` | renders the load-swept create rounds from `sweeps.yaml` |
| `results/<runId>/` | Caliper `report.html` + manifest/checkpoints (gitignored) |

`mode` (round argument) selects the write path: `fabric` (standard/parallel → peer-gateway
`sendRequests`) or `rest` (anchoring variants → gateway enqueue). `accessLog.js` has a
`scenario: shared` mode — the Stage-1 zero-MVCC-conflict gate (all workers hit one evidenceId).

## Sweeps sync rule

`benchmarks/steady-standard.yaml` and `steady-anchoring.yaml` are **generated** from
`sweeps.yaml`. After editing sweep values run `npm run gen:rounds`; do not hand-edit those
two files (they carry a GENERATED header).

## Throughput semantics (issue #1418 — report this explicitly)

Caliper's `Throughput (TPS)` numerator is `Succ + Fail`, so a round with 0 successes can
still show positive throughput. GLEIPNIR does **not** report that number as-is. `collect.py`
recomputes **successful-only** throughput = `Succ / (lastFinishTime − firstCreateTime)`.
`MVCC_READ_CONFLICT` is tabulated as its own failure class (issue #1397); the append-only
sub-key design should keep it near zero.

REST-connector results measure the **BFF path** (enqueue / verify), not the raw peer-gateway
path — keep them labelled distinctly from fabric-connector results.

## Does NOT

- Provision channels or deploy chaincode (orchestration does).
- Draw scalability conclusions from smoke runs (functional only).

## Verify (no live SUT)

```bash
npm install                 # resolves @hyperledger/caliper-cli@0.6.0 + js-yaml
npm run gen:rounds          # regenerate from sweeps.yaml
node --check workload/*.js connectors/rest/index.js
python -c "import yaml; [list(yaml.safe_load_all(open(f))) for f in ...]"
```
