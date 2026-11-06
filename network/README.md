# network

**Responsibility:** the version-controlled Hyperledger Fabric 2.5.15 substrate — channel
config, peer/orderer config, CA-based crypto enrollment, and the Docker Compose topology.
Used by **all variants**. Referenced by commit SHA in every run manifest (methodology hook).

## Topology (docs/CONTRACTS.md §1, §8)

| Component | MSP | Host | Ports (host = container) |
|---|---|---|---|
| orderer0/1/2 | OrdererMSP | `orderer{0,1,2}.example.com` | 7050/8050/9050 · admin 7053/8053/9053 · ops 9443/9444/9445 |
| peer0-org1 | Org1MSP | `peer0.org1.example.com` | 7051 · cc 7052 · ops 9446 |
| peer0-org2 | Org2MSP | `peer0.org2.example.com` | 9051 · cc 9052 · ops 9447 |
| ca-org1/org2/orderer | — | `ca-*` | 7054 / 8054 / 10054 |
| ccaas-evidence | — | `ccaas-evidence` | 9999 (internal) |
| cli (fabric-tools) | — | `gleipnir-cli` | — |

Three organizations, one CA each: Org1MSP and Org2MSP (one peer each) and OrdererMSP (three
orderers). Every variant uses the same topology; the anchored variants add only off-chain
services.

## Channels

`coc-main` (Org1+Org2; Standard, Anchoring) · `case-001..case-NNN` (Org1+Org2; Parallel*;
as many as the E2 `channel_counts` / E3b `case_counts` / E3c `e3c.case_counts` grids in
`benchmark/sweeps.yaml` need, provisioned by `orchestration/provision-channel.sh` /
`experiment.py`). Both anchored variants commit their Merkle roots on these channels:
Anchoring on `coc-main`, Parallel-Anchored on each case's own channel. Channel creation is
channel-participation only: `configtxgen -outputBlock` → `osnadmin channel join` on all
three orderer admin endpoints (HTTP 201) → `peer channel join`. **No legacy bootstrap
channel of any kind** (that mechanism is removed in Fabric 3.0).

There is no anchor channel. The earlier design (campaigns 1–5, git commit `573017b`) also
created `anchor-main`, a channel of a third peer org (AnchorClientMSP, with its own peer
`peer0-anchor` and CA `ca-anchor`) that held Parallel-Anchored's roots.

## Files

- `configtx/configtx.yaml` — one `AppChannel` profile (Org1MSP + Org2MSP) for `coc-main` and
  every `case-*` channel; 3 etcdraft consenters; capabilities Channel/Orderer V2_0, Application
  V2_5. Each peer org names its anchor peer (`peer0.org1.example.com:7051`,
  `peer0.org2.example.com:9051`); `configtxgen -outputBlock` writes an Application org's
  AnchorPeers into the channel's genesis block, so every new channel starts with cross-org
  gossip and the gateway peer (peer0.org1) discovers Org2's peer, which a 2-of-2 endorsement
  policy needs. The chaincode endorsement policy is not set here: `orchestration/lib.sh`
  `endorsement_policy` sets it when it commits the chaincode on a channel.
- `core.yaml` / `orderer.yaml` — verbatim 2.5.15 sampleconfig (core.yaml pinned to goleveldb,
  rich-query backend removed); mounted into peers/orderers; overrides via env in compose.
- `crypto/registerEnroll.sh` — Fabric CA 1.5.19 enrollment for the three orgs (NodeOUs).
  Output → `organizations/` (gitignored).
- `compose/compose-{net,ca,services}.yaml` + `.env` — the three-file topology, always merged
  (`-f` all three): `gleipnir-net` is declared once in `compose-net.yaml`, and the settings
  shared by the orderers / peers / CAs live in `x-*` anchors merged into each service.

## Compose profiles per variant (docs/CONTRACTS.md §8)

| Variant | profiles |
|---|---|
| standard | (base) |
| anchoring | `anchoring` |
| parallel | (base) + per-case channels |
| parallel-anchored | `parallel-anchored` |

Base = orderers, org1/org2 peers, the three CAs, ccaas-evidence, cli, gateway, frontend,
case-registry, evidence-store. `anchoring` adds merkle-batcher + receipt-store +
verification. `parallel-anchored` adds the same three services.

## Named volumes (measurement design — never anonymous)

`peer0org1-ledger`, `peer0org2-ledger` → `/var/hyperledger/production`;
`orderer{0,1,2}-ledger` → `/var/hyperledger/production/orderer`; `receipt-data` → `/data`;
`verify-metrics` → `/verify-metrics` (verification service's per-request JSONL); library:
`gateway-auth-data`, `case-registry-data`, `evidence-blob-data`.
`du` checkpoints target `…/ledgersData/chains/chains/<channel>` (block store),
`…/ledgersData/stateLeveldb` (world state) and the receipt store's `/data`.
`orchestration/reset-network.sh` removes only the five ledger volumes + `receipt-data` +
`verify-metrics` between runs and never the library volumes or `organizations/`.
`.env` also carries the batcher's per-run `BATCH_SIZE` / `BATCH_FLUSH_MS` (age timer) /
`BATCH_IDLE_MS` (idle timer) / `BATCH_EPOCH` (one batch-size grid for both anchored
variants), written by `experiment.py`, and `ENDORSEMENT` (`any` | `all`), written by
`orchestration/up.sh --endorsement`.

## Decision record (docs/CONTRACTS.md §12)

- **No anchor org.** The earlier design (campaigns 1–5) had a third peer org for
  the anchor channel: the `AND('AnchorClientMSP.member')` policy on `anchor-main` needed an
  endorsing peer whose MSP was AnchorClientMSP, so Parallel-Anchored added `peer0-anchor` +
  `ca-anchor` (profile-gated). Parallel-Anchored now commits its roots on its case channels,
  so that org, its peer, CA, chaincode server and channel are gone.
- **Anchor peers in `configtx.yaml`.** They put cross-org gossip into every channel's
  genesis block, so a 2-of-2 policy (`ENDORSEMENT=all`) can collect Org2's endorsement. This
  changes the network of every variant slightly against campaigns 1–5.
- **Endorsement policy as a run setting.** `OR('Org1MSP.peer','Org2MSP.peer')` (1-of-any, the
  default) or `AND('Org1MSP.peer','Org2MSP.peer')` (2-of-2), one policy for the chaincode on
  every app channel of a stack.
- **CCaaS** honors the Go 1.25.5 pin exactly (the peer's in-image toolchain differs).

## Does NOT

- Run benchmarks, hold application state, or embed secrets beyond dev CA bootstrap creds.

## Verify (no live network needed)

```bash
python -c "import yaml; [yaml.safe_load_all(open(f)) for f in ...]"   # all YAML parses
bash -n crypto/registerEnroll.sh                                       # script syntax
docker compose --project-directory compose -f compose/compose-net.yaml \
  -f compose/compose-ca.yaml -f compose/compose-services.yaml config -q # + --profile parallel-anchored
```
