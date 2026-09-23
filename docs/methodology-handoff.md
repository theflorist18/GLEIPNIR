# GLEIPNIR — Experimental Design & Methodology Handoff

> **SUPERSEDED (2026-09-22) — historical record, not the current design.**
> The supervisor's 10 Sep review and 17 Sep call
> (`GLEIPNIR_Supervisor_Guidance_Consolidated_2026-09-22.md`) replaced the design
> sketched below. **The current methodology is `docs/methodology/experiments.md`**;
> the constants are `benchmark/sweeps.yaml`. Kept verbatim because it records how
> the authors reasoned before that guidance arrived.
>
> What changed, so nothing here is read as current:
> - Three experiments (E1 batch calibration → E2 channel calibration → E3
>   scalability, plus an E0 pilot), not one sweep with a fixed channel count.
> - **One** batch-size grid shared by both anchored variants (§3's separate
>   N ∈ {10,50,100,250} and K ∈ {5,10,25,50} are gone), and channel counts
>   {5,10,20,30,40,50} rather than {1,2,5}.
> - Send rate is a swept **independent** variable, and "TPS" is a unit only —
>   never the name of a factor (§3, §5 below use it as one).
> - Channel count is **calibrated** in E2 and fixed at the median of the healthy
>   range; §4's "best/most representative" wording is superseded, and the project
>   says "baseline", never "best" or "optimal".
> - CPU/memory capture is **implemented** (Caliper's docker resource monitor), so
>   §3's "not done, no decision made yet" no longer holds; success/failure counts,
>   audit reconstruction time, anchoring delay and p95 latency are also live.
> - The chaincode operation is **`DisposeEvidence`** (op `DISPOSE`, terminal
>   status `DISPOSED`); §1's `RemoveEvidence`/`REMOVE` is the pre-rename name.

**Purpose.** This captures a working session (2026-09-16) that worked through
the thesis's experimental design in detail — what generates load, what the
independent/dependent/control variables actually are, and how results should
be tabulated/charted. None of this is written down elsewhere in the repo, and
it isn't yet promoted into `CLAUDE.md`/`CONTRACTS.md` as binding — treat it as
the current working plan, not a locked contract, until the authors decide to
formalize it. Written for whichever of the two authors (or whichever Claude
session) picks this up next.

For the code architecture itself (modules, ports, data flow, sequence
diagrams), don't re-derive it — `docs/AS-BUILT.md` is current as of this
session and already covers it in full, including the `owasp-top10-review`
branch's security hardening. This file is the methodology layer on top of
that architecture, not a replacement for it.

---

## 1. What actually drives the measured results

Every variant exposes the same chaincode interface
(`chaincode/evidence/contract.go`): four write operations plus one
anchoring-specific write, plus three reads.

| Op | Writes a "head" record? | Writes a "log" (event)? | Used by |
|---|:-:|:-:|---|
| `CreateEvidence` | yes | yes (CREATE) | all 4 variants |
| `TransferCustody` | yes | yes (TRANSFER) | all 4 |
| `AccessLog` | **no** | yes (ACCESS) only | all 4 — the load-generation workhorse |
| `RemoveEvidence` | yes (terminal) | yes (REMOVE) | all 4 |
| `CommitAnchorRoot` | no | writes a Merkle root, not an event | Anchoring, Parallel-Anchored only |
| `ReadEvidence` / `GetAuditTrail` / `ReadAnchorRoot` | — reads (evaluate), not timed the same way as writes | | all 4 (the anchor-root read only where relevant) |

`AccessLog` never touches the head record — it only appends a fresh
append-only event key — which is exactly why it's structurally immune to
MVCC conflicts and is the operation used for the correctness gate (many
workers, one `evidenceId`, distinct sub-keys, zero conflicts expected).

**What's explicitly off-chain and never drives on-chain results:** the case
entity (`case-registry`'s SQLite `CASE-<uuid>`, a UI/RBAC concept) and the
evidence binary itself (`evidence-store`'s filesystem blob). Neither touches
Fabric in any variant.

## 2. The four variants are a 2×2 factorial, not four independent designs

Two independent architectural toggles produce all four variants:

|  | Direct write | Batched (Merkle) write |
|---|---|---|
| **Shared channel** | Standard | Anchoring |
| **Per-case channel** | Parallel | Parallel-Anchored |

This is worth stating explicitly in the methodology section — it explains
*why* four variants and not three or five, and why N/K and channel-count
never co-occur except in the one cell (Parallel-Anchored) where both toggles
are on.

## 3. Variable taxonomy

**Independent variables (manipulated):**
1. **Variant** (primary) — standard / anchoring / parallel / parallel-anchored. This is the actual research comparison; everything else exists to characterize it.
2. **Merkle batch size** (secondary, variant-specific) — `N ∈ {10,50,100,250}` for Anchoring (shared pool), `K ∈ {5,10,25,50}` for Parallel-Anchored (per-case pool). Bigger batch → fewer on-chain writes / better storage compression, but → longer O(log₂N) sibling path → higher verification latency. This is the mechanism behind RQ2 and stays independent — it's not a candidate for being controlled away.
3. **Offered load (TPS)** (tertiary) — swept per cell (25/50/100 for the `createEvidence` workload specifically; `transferCustody`/`accessLog` run at one fixed offered load per steady round) to trace the throughput/latency response curve.

**Control variables (held constant so they don't confound the variant comparison):**
- **Channel-count** — see §4 below; the emerging decision this session is to fix this rather than sweep it for the *primary* cross-variant comparison.
- Chaincode logic (identical across all 4 variants — the whole point).
- Fabric/network config (`core.yaml`, `orderer.yaml`, GoLevelDB only, same host).
- Caliper worker count (fixed at 4 across every round).
- Endorsement policy (fixed per channel type, not varied as a factor).
- Steady-state event floor (≥1000 events/channel, `sweeps.yaml`).
- Repetitions (3 per cell everywhere, for comparable statistical uncertainty).

**Dependent variables (measured outcomes):** throughput (successful-only —
Caliper issue #1418 ambiguity, resolved in `orchestration/collect.py`),
latency min/avg/max, verification/audit latency (fetch → recompute →
compare, Anchoring pair only), success rate + failure-mode breakdown
(MVCC_READ_CONFLICT counted separately), ledger size per channel, GoLevelDB
state size, byte-per-log via regression.

**Explicitly discussed and NOT yet added:** CPU/memory utilization (seen in
a comparator paper). GLEIPNIR's current metrics contract has no
container-resource-usage capture — only throughput/latency/storage/success
rate. Adding it would mean a poller (`docker stats` at a fixed interval)
running alongside `checkpoint.py`, writing something like
`resource-usage.jsonl`, reduced to avg/max per round the same way latency is.
Flagged as a real "stop and ask" contract change to `CLAUDE.md`'s metrics
table if pursued — **not done, no decision made yet.** Worth noting: this
would be the direct evidence for the architecture doc's existing unverified
claim that "if single-host throughput collapses, the host is the bottleneck,
not Fabric" — i.e. it strengthens the channel-count finding in §4, not just
a box-ticking match to the comparator paper.

## 4. The channel-count-as-control decision

Reasoning that came out of this session: channel-count and "number of
cases" are the same number in Parallel/Parallel-Anchored (one case = one
channel), so sweeping it alongside batch size and TPS makes Parallel-Anchored
a 3-factor design (K × channels × TPS) while every other variant is at most
2-factor. Fixing channel-count to one representative value for the
**primary, headline cross-variant comparison** brings Parallel-Anchored back
to a clean 2-factor grid (K × TPS), symmetric with Anchoring's (N × TPS).

Resulting per-variant IV shape once channel-count is fixed:

| Variant | Live independent variables |
|---|---|
| Standard | TPS only |
| Anchoring | TPS × N |
| Parallel | TPS only |
| Parallel-Anchored | TPS × K |

**Important: this does not require re-running anything.** The full swept
grid (channel-count ∈ {1,2,5}, all N/K values, 3 reps each) is already
sitting in `benchmark/results/` from the steady-state sweeps that already
ran. "Controlling" channel-count is an **analysis-layer decision** — which
slice of the already-collected data goes into the primary comparison table —
not a change to `sweeps.yaml` or a rebenchmark. The channel-count sweep
itself can and should still be reported as a **secondary finding** ("does
Parallel throughput scale with channel-count on a single host") using the
exact same dataset.

**Open, undecided: which channel-count value to fix as the control.**
Two candidate justifications discussed, neither chosen yet:
- **Fix at 1** — cleanest apples-to-apples with Standard/Anchoring, which
  have no channel concept at all (arguably the most defensible "equal
  footing" framing).
- **Fix at whatever value the existing data shows as best/most
  representative** — a "realistic deployment size" justification, but
  needs the existing results pulled first to argue for a specific number.

**Next action, not yet done:** pull real numbers out of
`benchmark/results/*/manifest.json` to (a) settle the channel-count value
above with actual evidence rather than a priori reasoning, and (b) build a
real version of the result tables in §5 instead of mockups.

## 5. Planned result presentation (mockup structure agreed this session)

Three layers, not one flat table, because the design is inherently nested:

1. **Headline chart** — offered load (x) vs. achieved/successful throughput
   (y), one line per variant (at the fixed channel-count and a representative
   N/K), plus a y = offered-load reference line. Where a variant's line peels
   away from the diagonal is its saturation point.
2. **Per-variant deep-dive tables** — the thing the headline chart can't show:
   - Anchoring: throughput *and* verification latency vs. N, at fixed/faceted
     offered load — this is where the RQ2 tradeoff actually becomes visible
     (throughput barely moves with N; verification latency climbs with it).
   - Parallel (secondary finding, §4): aggregate *and* per-channel throughput
     vs. channel-count — per-channel dropping while aggregate rises
     sub-linearly is the signature of host-bound (not Fabric-bound)
     contention.
   - Parallel-Anchored: K × channel-count as a 2D heatmap (secondary finding
     for the channel-count axis; K × TPS is the primary 2-factor table per
     §4).
3. **Raw appendix table** — every (variant × N/K/channels × offered load ×
   repetition) cell, mean ± SD, feeding all of the above. This is what a
   reviewer checks the charts against.

## 6. Adjacent, lower-priority discussion this session

- **Product naming.** Brainstormed a possible rename away from GLEIPNIR
  (candidates: Custodia, Provenant, CustodyLedger; also considered staying
  in the Norse-mythology lane with Vör). **No decision made.** Flagged that
  a real rename is expensive — `GLEIPNIR_TOKEN`/`GLEIPNIR_INTERNAL_TOKEN` env
  vars, the Docker project name, every doc, and git history the thesis cites
  by SHA all reference GLEIPNIR — so this would need to be a deliberate
  scoped decision (and likely land as new commits, never a history rewrite,
  per `CLAUDE.md`'s citation-stability rule) rather than something to do in
  passing.
- **Elicit search queries** for related work on Fabric+Caliper benchmarking
  methodology were drafted earlier in the session (not reproduced here —
  see the conversation transcript if needed; the gist was: search
  methodology/bottleneck-characterization/comparative-architecture/
  domain-specific angles separately rather than one broad query, then
  snowball from the first couple of strong hits via Elicit's citation graph).

## 7. Pointers

- Paper-facing methodology (2×2 frame, variable table, E0–E3 procedures,
  level-selection rules, run budget, flowcharts): `docs/methodology/experiments.md`
- Code architecture (modules, ports, data flow, sequence diagrams, security
  posture): `docs/AS-BUILT.md`
- Binding build plan / interface contracts: `docs/ARCHITECTURE.md`,
  `docs/CONTRACTS.md`
- Sweep constants (single source of truth): `benchmark/sweeps.yaml`
- Metrics/manifest generation: `orchestration/checkpoint.py`,
  `orchestration/collect.py`
- Already-collected steady-state run data: `benchmark/results/run-*`
  (manifests at `benchmark/results/<runId>/manifest.json`)
