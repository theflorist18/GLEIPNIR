#!/usr/bin/env python3
"""GLEIPNIR storage checkpoint (docs/CONTRACTS.md §11; ARCHITECTURE §4.7).

`checkpoint.py <runId> --label <t>` runs `du -sb` inside each peer container against
the block store (per channel) and the GoLevelDB world-state dir, plus the
receipt-store's data volume (the off-chain witness is the cost side of the
anchoring storage trade-off — audit F9), and appends JSONL rows to
benchmark/results/<runId>/checkpoints.jsonl.

Row schema (uniform keys; audit F70 — world state is ONE GoLevelDB dir shared by
all of a peer's channels, so it is emitted once per container, never per channel):
  {runId, label, tsUtc, container, channel, blockstoreBytes, stateBytes, receiptBytes}
  - per-channel row:   channel set, blockstoreBytes set, others null
  - per-container row: channel null, stateBytes set, others null
  - receipt-store row: container gleipnir-receipt-store, receiptBytes set

Paths (named volumes at stable mounts):
  block store   /var/hyperledger/production/ledgersData/chains/chains/<channel>
  world state   /var/hyperledger/production/ledgersData/stateLeveldb
  receipts      /data (receipt-data volume)
"""
import argparse
import json
import os
import subprocess
import sys
from datetime import datetime, timezone

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LEDGER = "/var/hyperledger/production/ledgersData"
PEERS = [
    ("peer0.org1.example.com", "Org1"),
    ("peer0.org2.example.com", "Org2"),
    ("peer0.anchor.example.com", "Anchor"),
]


def docker_exec(container, cmd):
    """Run a shell command in a container; return stdout or None if the container is absent."""
    try:
        out = subprocess.run(
            ["docker", "exec", container, "sh", "-c", cmd],
            capture_output=True, text=True, timeout=60,
        )
    except Exception as exc:  # noqa: BLE001
        print(f"  ! {container}: {exc}", file=sys.stderr)
        return None
    if out.returncode != 0:
        return None
    return out.stdout.strip()


def du_bytes(container, path):
    out = docker_exec(container, f"du -sb {path} 2>/dev/null | cut -f1")
    if out is None or out == "":
        return None
    try:
        return int(out.splitlines()[0])
    except (ValueError, IndexError):
        return None


def list_channels(container):
    out = docker_exec(container, f"ls {LEDGER}/chains/chains 2>/dev/null")
    return [c for c in (out.split() if out else []) if c]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("run_id")
    ap.add_argument("--label", default="t")
    args = ap.parse_args()

    out_dir = os.path.join(REPO_ROOT, "benchmark", "results", args.run_id)
    os.makedirs(out_dir, exist_ok=True)
    ts = datetime.now(timezone.utc).isoformat()
    rows = []

    def row(container, channel=None, blockstore=None, state=None, receipts=None):
        return {
            "runId": args.run_id,
            "label": args.label,
            "tsUtc": ts,
            "container": container,
            "channel": channel,
            "blockstoreBytes": blockstore,
            "stateBytes": state,
            "receiptBytes": receipts,
        }

    for container, _org in PEERS:
        channels = list_channels(container)
        if not channels:
            continue
        # World state once per container (shared GoLevelDB dir — F70).
        rows.append(row(container, state=du_bytes(container, f"{LEDGER}/stateLeveldb")))
        for channel in channels:
            rows.append(row(container, channel=channel,
                            blockstore=du_bytes(container, f"{LEDGER}/chains/chains/{channel}")))

    # Receipt store (anchoring variants; container absent otherwise — F9).
    receipt_bytes = du_bytes("gleipnir-receipt-store", "/data")
    if receipt_bytes is not None:
        rows.append(row("gleipnir-receipt-store", receipts=receipt_bytes))

    path = os.path.join(out_dir, "checkpoints.jsonl")
    with open(path, "a", encoding="utf-8") as fh:
        for row in rows:
            fh.write(json.dumps(row) + "\n")
    print(f"checkpoint '{args.label}': wrote {len(rows)} rows to {path}")


if __name__ == "__main__":
    main()
