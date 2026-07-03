# orchestration

**Responsibility:** automate the network/channel lifecycle and metrics collection —
variant bring-up, per-case channel provisioning, storage checkpoints, Caliper runs, and
the N/K/channel sweep. Used by **all variants** (provisioning by Parallel*).

Bash scripts target Ubuntu 22.04 / WSL2 and drive Fabric admin ops inside the `cli`
fabric-tools container (`docker compose -p gleipnir exec cli`). Python 3.10+ (`pyyaml` only).
Prereqs on the host: docker + compose v2, `fabric-ca-client`, `curl`, `jq`.

## Entry points

| Script | Does |
|---|---|
| `up.sh --variant V [--channels N] [--skip-crypto]` | enroll → compose up → create channels (osnadmin, HTTP 201 on all 3 orderers) → deploy ccaas chaincode → start services |
| `down.sh [--wipe]` | stop all profiles; `--wipe` also removes named volumes + `organizations/` + `channel-artifacts/` |
| `provision-channel.sh case-NNN` | per-case channel + chaincode + emit `benchmark/networks/<caseId>.yaml` (idempotent-safe) |
| `teardown-channel.sh case-NNN` | `osnadmin channel remove` from orderers (peers can't un-join online — documented limit) |
| `smoke-standard.sh` | milestone-4 end-to-end via the gateway (create→transfer→access×2→audit==4→remove→transfer-fails) |
| `checkpoint.py <runId> --label t` | `du -sb` block store (per channel) + GoLevelDB state per peer → `checkpoints.jsonl` |
| `collect.py <runId>` | parse Caliper log → **successful-only** throughput + MVCC tally → `manifest.json` (+ gitCommit, configShas) |
| `sweep.py --variant V --regime steady\|smoke` | full cell × repetition loop; runs Caliper; checkpoints + collects |

`lib.sh` holds shared helpers (compose wrapper, `peer_env` org switching, `create_channel`
with the 3-orderer osnadmin 201 assertion, ccaas packaging, `.env` var writes).

## variant → compose profiles (docs/CONTRACTS.md §8)

standard → base · anchoring → `anchoring` · parallel → base + per-case channels ·
parallel-anchored → `parallel-anchored` (adds anchor org/peer/CA + anchor-client).

## Metrics contract

- Storage: `du -sb` at `…/ledgersData/chains/chains/<channel>` (block store) and
  `…/ledgersData/stateLeveldb` (world state), against **named volumes**.
- Throughput: **successful-only** = `reportedThroughput × Succ/(Succ+Fail)` (Caliper's
  reported numerator is `Succ+Fail`, issue #1418). `MVCC_READ_CONFLICT` tabulated separately.
- Manifest records `gitCommit` + per-config-file blob SHAs (`git hash-object`) so every run
  is reproducible against exact config (methodology hook).
- runIds: `run-*` (steady) vs `smoke-*` — never mixed in one results dir.

## Does NOT

- Generate benchmark load (Caliper does) or draw scalability claims from smoke runs.

## Verify (no live network)

```bash
bash -n up.sh down.sh provision-channel.sh teardown-channel.sh smoke-standard.sh lib.sh
python -m py_compile checkpoint.py collect.py sweep.py
pip install -r requirements.txt
```
