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
| peer0-anchor † | AnchorClientMSP | `peer0.anchor.example.com` | 11051 · cc 11052 · ops 9448 |
| ca-org1/org2/anchor†/orderer | — | `ca-*` | 7054 / 8054 / 9054 / 10054 |
| ccaas-evidence(-anchor†) | — | `ccaas-evidence*` | 9999 (internal) |
| cli (fabric-tools) | — | `gleipnir-cli` | — |

† Parallel-Anchored only (compose profile `parallel-anchored`).

## Channels

`coc-main` (Org1+Org2; Standard, Anchoring) · `case-001..005` (Org1+Org2; Parallel*) ·
`anchor-main` (AnchorClientMSP; Parallel-Anchored). Channel creation is
channel-participation only: `configtxgen -outputBlock` → `osnadmin channel join` on all
three orderer admin endpoints (HTTP 201) → `peer channel join`. **No legacy bootstrap
channel of any kind** (that mechanism is removed in Fabric 3.0).

## Files

- `configtx/configtx.yaml` — `AppChannel` + `AnchorChannel` profiles; 3 etcdraft consenters;
  capabilities Channel/Orderer V2_0, Application V2_5.
- `core.yaml` / `orderer.yaml` — verbatim 2.5.15 sampleconfig (core.yaml pinned to goleveldb,
  rich-query backend removed); mounted into peers/orderers; overrides via env in compose.
- `crypto/registerEnroll.sh` — Fabric CA 1.5.19 enrollment for all four orgs (NodeOUs).
  Anchor org only when `ENABLE_ANCHOR_ORG=true`. Output → `organizations/` (gitignored).
- `compose/compose-{net,ca,services}.yaml` + `.env` — the three-file topology.

## Compose profiles per variant (docs/CONTRACTS.md §8)

| Variant | profiles |
|---|---|
| standard | (base) |
| anchoring | `anchoring` |
| parallel | (base) + per-case channels |
| parallel-anchored | `parallel-anchored` |

Base = orderers, org1/org2 peers, ccaas-evidence, cli, gateway, frontend.
`anchoring` adds merkle-batcher + receipt-store + verification. `parallel-anchored` adds those
plus anchor-client, peer0-anchor, ccaas-evidence-anchor, ca-anchor.

## Named volumes (measurement design — never anonymous)

`peer0org1-ledger`, `peer0org2-ledger`, `peer0anchor-ledger` → `/var/hyperledger/production`;
`orderer{0,1,2}-ledger` → `/var/hyperledger/production/orderer`; `receipt-data` → `/data`.
`du` checkpoints target `…/ledgersData/chains/chains/<channel>` (block store) and
`…/ledgersData/stateLeveldb` (world state).

## Decision record (docs/CONTRACTS.md §12)

- **Anchor org with one peer + a 4th CA.** The `AND('AnchorClientMSP.member')` endorsement
  policy on `anchor-main` needs an endorsing peer whose MSP is AnchorClientMSP; a client id
  alone cannot endorse. So Parallel-Anchored adds `peer0-anchor` + `ca-anchor` (profile-gated).
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
