# GLEIPNIR — Supervisor Guidance, Consolidated
## Discord thread (5 Aug – 17 Sep 2026) + Discord call (17 Sep 2026, 18:30 WIB) → Development Specification

**Prepared:** 22 Sep 2026
**Purpose:** Single reference for implementation and coding (Caliper harness, chaincode adjustments, orchestration, data collection, reporting) and for the Bab 3 / methodology rewrite. Written to be handed to Claude (Code) as the governing brief.
**Author of the thesis:** Netsakh (N). **Supervisor:** referred to as D (Discord handle `kaiaraia`; N's handle `fried_tofu`).

### Precedence rules (read first)

1. **The 17 Sep call (Appendix B) is the latest word.** Where the call and the chat overlap or conflict, the call governs.
2. The supervisor's written review of **10 Sep** (chat) governs anything the call did not touch.
3. N's own proposals in the chat (1 Sep, 17 Sep 15:57) are inputs, not decisions, unless D accepted them.
4. Existing GLEIPNIR project decisions (four-variant scope, anchor-channel terminology, Fabric 2.5.15 / Caliper 0.6.0 pins, ≥ 10³ events per channel before any scalability framing, config pinned by commit SHA, STRIDE table, GoLevelDB) remain in force; where supervisor guidance interacts with them, the interaction is stated explicitly below.

**Provenance tags used throughout:** `[CHAT dd/mm]` = Discord message date; `[AUDIO Pn mm:ss]` = call recording part and timestamp (see Appendix B); `[PROJECT]` = pre-existing GLEIPNIR decision; `[INFERRED]` = my interpretation where the source is ambiguous — treat as a question to confirm, not a fact.

---

## 1. Source timeline

| Date (2026) | Source | What happened |
|---|---|---|
| 5 Aug | Chat | End of a consultation. D promises related papers; N must log the discussion in the BINUS consultation-session record. D sends three papers (Appendix C). |
| 12 Aug | Chat | N logs the consultation; has skimmed the papers. |
| 24 Aug | Chat | N asks for access to an ICRITO 2024 Caliper paper; reports Caliper installed on the system per D's recommendation, plans small load per variant first; asks whether hardware must appear in the methodology. |
| 26 Aug – 5 Sep | Chat | N obtains the paper; repeatedly asks about independent variables (no reply until 10 Sep). |
| 1 Sep | Chat | N's variable design **v1** (see §2.3). |
| 10 Sep | Chat | **D's written review** — the prerequisite design corrections (see §2.4). |
| 14 Sep | Chat | N will apply the corrections on the experiment machine and send an updated methodology draft before running. |
| 17 Sep 15:57 | Chat | N's pre-meeting design **v2** and questions (see §2.5). |
| 17 Sep 18:30 | **Audio** | ~90-minute Discord call. Design restructured into three experiments; variables, table format, paper and timeline settled (see §3). |

---

## 2. Discord chat — talking points (English summary)

### 2.1 Administrative (5–12 Aug)
- The export begins mid-conversation ("maksimal banget" / "seharusnya bisa lebih cepat dari itu" refer to a duration discussed before the export starts; context unavailable). `[CHAT 05/08]`
- D will forward papers related to the thesis as they are found. `[CHAT 05/08]`
- N must record the outcome of each discussion in the consultation-session log. `[CHAT 05/08]`
- Three papers sent by D (identified in Appendix C): Ajwalia & Shah (2025) — Fabric vs Ethereum under varying workload with Caliper; Khan et al. (2022), *Sensors* 22(3):915 — Fabric LTS empirical performance with Caliper; Dinh et al. (2017) — BLOCKBENCH, arXiv:1703.04057. `[CHAT 05/08]`

### 2.2 Progress and early questions (24–26 Aug)
- N requested the ICRITO 2024 paper (DOI 10.1109/ICRITO61523.2024.10522188) as a Caliper-benchmarking reference; later obtained access. `[CHAT 24/08, 26/08]`
- Caliper is installed on the system, configured as D recommended; plan: run a small load per variant before increasing load. `[CHAT 24/08]`
- Question: must hardware be listed in the methodology (only software listed so far)? → answered in the call: optional (§3.8). `[CHAT 24/08]`

### 2.3 N's variable design v1 (1 Sep) — superseded, kept for traceability
- IV: variant {Standard, Parallel, Anchoring, Anchoring-Parallel}; "TPS" = transaction types {CreateEvidence, TransferCustody, AccessLog, RemoveEvidence}.
- Controlled: number of cases = number of channels = 100; hardware; etc.
- Question: Merkle batching fixed at 10 logs per batch, or an independent variable? If independent, compared against what, since Standard and Parallel do not batch?
- DV: Send Rate, Throughput, Max Latency, CPU Utilization, Memory Usage.

### 2.4 D's written review (10 Sep) — the prerequisite corrections
1. **The design is a 2×2 factorial.** The title "Anchor, Parallelize, or Both?" names two binary factors — anchoring (on/off) and parallelization (on/off); the four variants are the four combinations.
2. **Batch size confound.** The original plan (batch 100 for Anchoring, batch 10 for Parallel-Anchored) changes two things at once; if Parallel-Anchored wins you cannot say whether parallelism or the smaller batch caused it. For the main experiment the batch size must be **controlled and identical** in both anchored variants (10 or 100 — N's choice, but identical).
3. **Batch size as its own experiment (sensitivity analysis).** Use only the two anchored variants and vary batch size **10, 25, 50, 100, 200**. Standard and Parallel are not data points but appear as **horizontal reference lines**. X = batch size; Y = throughput or ledger size; two curves + two baselines. This answers the inevitable "why N = 10?".
4. **100 channels — check before running.** Fabric documentation advises ideally one CPU core per channel running at full load. 100 active channels on an ordinary machine measures resource exhaustion, not architecture; results would not support the claims. Do not fix at 100; **sweep channel count** (e.g., 5, 10, 20, 50) to obtain a scalability curve and find the point where Parallel starts to lose to Standard because of channel overhead — a more interesting finding than one point at 100. If 100 cases are still wanted on limited hardware: namespaces/composite keys within one channel — but then "parallel" is logical, not physical, and must be stated honestly.
5. **Send rate is an input, not an output.** Send rate is configured; throughput is measured. Caliper example: send rate set to 307 tps, throughput achieved 109 tps at 2.94 s latency — the gap shows saturation. Move send rate to the IVs and **sweep it**; scalability is only visible as a curve; find the saturation point where throughput flattens and latency rises.
6. **Three metrics to add:** (a) **success and failure rate** — mandatory; otherwise rising throughput may hide failed transactions (easiest reviewer attack); (b) **ledger growth / storage size** — the whole reason anchoring exists; without it the paper cannot prove its own claim; (c) **audit reconstruction time** — time to reconstruct one case's complete chain of custody; this is anchoring's trade-off and what distinguishes the paper from a standard Caliper replication.
7. **Max latency alone is insufficient** (one outlier dominates). Report min, max, avg, and p95 if possible.
8. **Terminology:** "TPS" as an IV is a mix-up — TPS is transactions per second, the unit of throughput; what N means is *transaction type* / *operation type*.
9. **Rename RemoveEvidence.** In forensic chain of custody evidence is never truly deleted (immutability; admissibility would be challenged). Use disposition / status change: **DisposeEvidence** or **UpdateEvidenceStatus**.
10. **AccessLog is probably read-only.** Caliper separates read latency from transaction latency; reads produce no block. Do not average reads with writes — separate tables. *(See §4 item 10: this assumption is contradicted by GLEIPNIR's semantics.)*
11. **Process gate:** check the experiment machine's specification, decide channel count, revise the variable table per the notes above, and **send it to D before starting experiments**. Better to fix the design now than discover unusable data after weeks of runs. Overall direction is correct; it needs tidying.

### 2.5 N's pre-meeting design v2 (17 Sep 15:57) — inputs to the call
- Two experiments: (1) static batch size, four variants; (2) dynamic batch size, two anchored variants. N asks whether to run (2) first to find the best batching, then (1) with that batch size. → **Accepted in the call** (with renumbering; §3.6).
- 100 channels is not workable on N's laptop; proposed channel levels **5, 10, 20, 30, 40, 50**, with number of cases following channel count (case = channel), justified by Fabric's channel-partitioned ledger. → **Superseded by the call**: calibrate first, use the median, do not lock at the maximum (§3.2).
- Send rate sweep **10, 25, 50, 75, 100** up to the system's saturation point; values to be adjusted. → Values remain open (§5.4).
- DV confirmation: throughput; latency (min, max, avg, p95); CPU utilization; memory usage; success and failure rate; ledger growth / storage size; audit reconstruction time. → Accepted; table presentation refined in the call (§3.7).
- IV proposal: Exp 1 — channels/case number, send rate, transaction type; Exp 2 — batch size, channels/case number, send rate, transaction type. → **Superseded**: transaction type is not an IV (§3.4); channel count is calibrated (§3.2).
- Asked for a call to discuss the above and how to present results. Call fixed for 18:30 the same day.

---

## 3. Discord call (17 Sep, ~90 min) — talking points (English summary)

### 3.1 Batch size: trade-off and calibration
- Large batch → smaller ledger, but slower audit reconstruction and a longer window before a log is anchored on-chain. Small batch → more frequent anchoring, faster audit, more overhead. D confirmed. `[AUDIO P1 00:00–01:45]`
- D asked whether the anchoring delay is a processing effect or a CPU/resource effect; N: it is inherent to the batching process (waiting for the batch to fill), not resource-bound. `[AUDIO P1 00:26–00:52]`
- Wording: find the **baseline** value between the high and low settings — do **not** write "finding the best/optimal". `[AUDIO P1 01:19–01:45]`
- The baseline batch size is chosen in a calibration experiment and carried into the main experiment; the justification when asked "why this batch size?" is "obtained from the preceding experiment". `[AUDIO P1 13:52–14:37]`
- Batch calibration is run on **both** anchored variants (Anchoring and Parallel-Anchored). `[AUDIO P3 00:27–00:50]`
- Transaction type is **not** a factor in the batch calibration; adding it "does not help answer the question at all". Pick **one** batch size for the main experiment. `[AUDIO P1 18:06–20:44]`
- Unlike channel count, batch size is **not** swept again in the main experiment; one baseline value is used, and it only applies to the two anchored variants (Standard and Parallel have no batch concept). `[AUDIO P3 03:57–05:30]`

### 3.2 Channel count: run-count explosion, retraction of "100", calibration, median rule
- N: Fabric guidance ≈ one CPU core per channel; start from 5 and raise until the curve breaks because CPU runs out. D agreed. `[AUDIO P1 01:46–02:37]`
- D's warning: the number of runs explodes — e.g., 4 variants × 6 channel levels × 5 send rates × 4 transaction types × 5 repetitions ≈ 2,000+ runs = months. N must size the run count to available resources. `[AUDIO P1 02:37–03:53]`
- D asked whether N had identified which variables actually matter (some have minimal effect); N: not yet on the system; from the literature, send rate drives throughput/latency; N leans toward 2–3 IVs (send rate, variant, one more). `[AUDIO P1 05:57–07:58]`
- **D retracts the earlier "100 channels".** If channel count is fixed high at the start, every batch size will look equally good because throughput is capped by the send rate, so N cannot be chosen from data. Hence a **calibration phase** before the main experiments. `[AUDIO P2 12:02–14:41]`
- Channel calibration is run on **one variant only — Parallel**. `[AUDIO P2 22:01–22:55; P3 00:00–00:27]`
- The fixed channel value for the main experiment: **do not lock at the maximum** — start from below and take the **median** of the healthy range (illustration: 5–50 → 25). At the maximum "what you measure is no longer the architectural difference but the host running out of CPU". `[AUDIO P3 05:52–07:52]`
- **Case vs channel:** D: cases are *data*, channels are *infrastructure*; they may be separated — the number of cases can be the same across experiments while the number of channels differs. N's 1-case-per-channel mapping was accepted as "fine", but the split is allowed. `[AUDIO P2 17:18–18:05; P3 02:19–03:12]`
- Standard uses a single default channel ("like an ordinary blockchain"). `[AUDIO P3 00:52–01:15]`
- N's remark that channel count "affects all variants except Standard" `[AUDIO P3 05:17–05:30]` conflicts with the 2×2 frame (Anchoring is single-channel) — see §4 item 18.

### 3.3 TPS, send rate, throughput
- D: TPS is a **unit** (like km/h), not a variable. Send rate = the transaction rate you configure (input). Throughput = how many transactions were actually committed (measured). TPS ≠ send rate. N is to re-read the reference paper with this in mind. `[AUDIO P1 10:47–12:50]`
- Mid-call N listed the IVs as batch size, channel/case count, send rate and transaction type `[AUDIO P1 12:52–13:28]`; by the end of the call transaction type was removed (§3.4) and batch size / channel count became calibrated constants (§3.6).
- N later confirmed from the scalability reference paper that its "TPS" is throughput. `[AUDIO P3 14:48–15:00]`
- Send rate must be configured by N; values are to be explored empirically. `[AUDIO P1 15:48–16:12]` Higher send rate = higher workload; send rate is the workload knob for scalability. `[AUDIO P2 09:26–10:06; P3 19:47–20:04]`
- D remarked that a send-rate range of "100–200 is already enough" for the table structure. `[AUDIO P3 20:26]` — treat as illustrative; the sweep still has to reach saturation (chat 10/09).

### 3.4 Transaction (operation) type
- Not an independent or dependent variable. It is part of the **workload**: a script sends operations to the smart contract in a **fixed proportion**. `[AUDIO P1 22:44–24:29]`
- Nevertheless **every operation is exercised and reported separately** (as in the reference paper) — not as a factor, but as a consistency check across operations, and to answer "which operation is most expensive?" and "does anchoring help all operations or only some?". `[AUDIO P2 00:00–03:06]`
- Do not cross transaction type across the entire experimental grid; report the per-operation breakdown at a single operating point. `[AUDIO P2 00:00–00:35]` `[INFERRED — the phrase was "cukup di satu titik operation, misalkan di satu node/note aja"; confirm with D.]`
- N raised two implementation options for the script: a randomised mix of all operations, or a single reference operation (CreateEvidence, view/AccessLog, or TransferCustody). `[AUDIO P1 20:46–21:38]` The call's outcome (mix with fixed proportions + per-operation breakdown) covers both.
- N mentioned that viewing evidence **creates a log** (i.e., AccessLog is a write event). `[AUDIO P1 21:15–21:38]`

### 3.5 Benchmark script requirements
- **Reusable**: someone re-running the script on the same hardware/environment should obtain the same results. `[AUDIO P2 03:06–03:46]`
- **Parameterizable**: number of evidence items, number of concurrent cases, file size per evidence (MB), etc. — user-settable inputs. D: fine. `[AUDIO P2 03:46–04:41]`
- **Sweep small first**: run a small workload before the large one to see the effect on the system. D: correct. `[AUDIO P2 04:41–05:07]`
- Alternative: **hierarchical randomisation** (choose operation type → choose target evidence/case). If used, **fix the seed** so the transaction sequence is identical across all four variants. N's approach also acceptable. `[AUDIO P2 05:07–06:50]`

### 3.6 Final experiment structure
- Three experiments: **E1 batch-size calibration** (Anchoring + Parallel-Anchored) → **E2 channel-count calibration** (Parallel only) → **E3 scalability** (all four variants, batch and channel fixed at calibrated values, send rate swept). Calibrations **must be reported** because they were performed. `[AUDIO P2 18:11–19:25; P3 00:00–01:20]`
- Batch size and channel count remain design factors but are **static** in E3 at their calibrated values. `[AUDIO P3 01:19–02:15]`
- Two scalability dimensions in E3: **scalability vs. load** (send rate) and **scalability vs. cases** (case/channel count) → two tables. `[AUDIO P3 25:38–26:04]`
- N's concern that E3 would be "8 tables, 8 graphs" (4 variants × 2 dimensions); D: one graph may carry several lines; N: too many lines → separate graphs per metric with one line per variant. D: fine. `[AUDIO P3 26:04–27:36]`

### 3.7 Result tables and graphs
- Reference-paper table format is acceptable. `[AUDIO P2 06:50–07:20]`
- Include latency alongside the throughput curve; latency is especially informative under high load. `[AUDIO P3 18:31–19:30]`
- Latency: **one column** — average with (min–max) in parentheses; "better". `[AUDIO P3 20:46–21:32]`
- CPU utilization stays; memory in MB. `[AUDIO P3 21:40–24:35]`
- Success and failure as **counts**; plus **failure rate (%)**. `[AUDIO P3 21:40–23:54]`
- **Every column needs a unit**: throughput TPS, latency s, CPU %, memory MB. `[AUDIO P3 23:58–24:35]`
- D: the metric set discussed on screen "only half answers the scalability question — but that's fine, it can be added". `[AUDIO P3 24:50–25:38]` (The missing half is the chat's ledger growth / storage and audit reconstruction time — §5.2.)
- Graphs: separate per metric, one line per variant. `[AUDIO P3 26:04–27:36]`

### 3.8 Paper and methodology
- Draft paper not yet started; N wants the system final first so Bab 3 reflects it. D: fine — but **write incrementally ("dicicil")**. `[AUDIO P1 17:25–17:51; P3 41:55–42:19]`
- After the system is done, N updates the methodology draft (many changes) and sends it. `[AUDIO P3 27:11–28:04]`
- **Fix the diagrams**: the experiment-flow diagram must be updated — **one flowchart per experiment (three)**; units corrected. D reads the diagram alongside the Bab 1–3 text. `[AUDIO P3 27:50–29:48]`
- Hardware specification is **not required** in the paper (keep as personal notes); the software-stack table may stay or go; including both is acceptable. `[AUDIO P3 29:48–31:31]`

### 3.9 Timeline and administration
- Target conference submission **October–November 2026**; review ≥ 1 month; notification accepted/rejected (both with revision status); if rejected, find another conference while applying the reviewers' notes. `[AUDIO P3 31:05–33:46]`
- Prefer a **BINUS-partnered** (no fee) and **Scopus-indexed** conference; D will look for candidates around November; late-year options are scarce → December/January likely. Acceptance rates ≈ 50–65%. `[AUDIO P3 33:48–35:22]`
- After acceptance: revise, resubmit, fee/administration (D handles the documents if no fee), then present; Indonesian conferences are on-site or hybrid; 100–200 papers in 2–3 days; questions are light. `[AUDIO P3 35:22–37:10]`
- Then the **defense**: one examiner (not the supervisor), presentation/poster + Q&A; then remaining documentation. `[AUDIO P3 37:10–38:30]`
- N's understood deadline is January 2027 ("already final" for the standard thesis track); D: the article track has a longer assessment window, to **end Feb / early Mar 2027**; no extra SKS; stage-3 score follows the final paper's status. `[AUDIO P3 38:30–40:34]`
- GitHub repo for system + scripts: allowed, do it last. `[AUDIO P3 41:00–41:51]`

---

## 4. Reconciliation: chat vs. call

| # | Topic | Chat position | Call position | Resolution | Status |
|---|---|---|---|---|---|
| 1 | Number/order of experiments | Main experiment (4 variants, batch controlled) + a second batch-sensitivity experiment; N asked (17/09) to run the sensitivity one first | Yes: batch calibration first (**E1**), then a new channel calibration (**E2**), then scalability (**E3**) | Three experiments, in that order. **Numbering changed** — "experiment 2" in the chat is E1 here | RESOLVED |
| 2 | Batch-size grid | 10, 25, 50, 100, 200 | No explicit grid ("high vs low"; illustrative 20…80) | One **identical** grid for both anchored variants; default to the chat grid unless the pilot shows otherwise. The paper's separate N ∈ {10,50,100,250} and K ∈ {5,10,25,50} `[PROJECT]` must be **unified** | Values OPEN; identical-grid rule RESOLVED |
| 3 | Presentation of E1 | X = batch size; Y = throughput or ledger size; Standard & Parallel as horizontal reference lines | Not discussed | Keep the chat format; add audit-reconstruction time vs batch size (the trade-off N described at P1 00:00) | RESOLVED |
| 4 | Channel count | Don't fix 100; sweep 5,10,20,50; find where Parallel loses to Standard. N proposed 5–50 with cases = channels | "100" retracted; calibrate on Parallel only; E3 fixed value = **median** of healthy range; sweep from low; never lock at max | E2 sweep on Parallel → healthy range → E3a fixed at median; E3b case sweep from low to the upper healthy bound (not beyond) | Procedure RESOLVED; values OPEN (after E2) |
| 5 | Cases vs channels | N: case = channel (100) | Case = data, channel = infra; may differ; N settles on ~25 (illustrative) | Keep 1 channel per case as the default for Parallel variants `[PROJECT]`, but implement **cases-per-channel** as a harness parameter so the split is possible; state the mapping in the paper. Links to Open Decision #1 (provisioning policy) | OPEN |
| 6 | Namespace/composite-key fallback | Allowed if 100 cases needed; "logical, not physical parallelism" must be stated | Moot (100 dropped) | Not pursued; keep as a documented fallback only | RESOLVED |
| 7 | Send rate | IV; sweep to saturation; N: 10,25,50,75,100 | IV; configured; "100–200 enough" remark | Sweep from low to beyond saturation; grid fixed after the pilot | Values OPEN |
| 8 | "TPS" terminology | TPS = throughput unit; N meant transaction type | TPS is a unit; TPS ≠ send rate; throughput measured by Caliper | Fix proposal and all text | RESOLVED |
| 9 | Transaction type | IV (after renaming); N kept it as IV on 17/09 | **Not** an IV/DV; workload mix with fixed proportions; each operation still run and reported separately; not crossed with everything | Call wins: controlled workload-mix parameter + per-operation breakdown at one operating point | RESOLVED |
| 10 | AccessLog semantics | "Probably read-only" → separate read tables | N: viewing evidence **creates a log** (write) | In GLEIPNIR AccessLog is a **write** custody event (consistent with Open Decision #4 on MVCC for access-log writes). D's assumption was wrong — inform D. Genuine read-only operations (get evidence, get custody chain, verify) are reported separately as reads | CONFIRM with D |
| 11 | RemoveEvidence | Rename to DisposeEvidence / UpdateEvidenceStatus | — | **DisposeEvidence** (status transition; nothing deleted) | RESOLVED |
| 12 | DV set | Throughput; latency min/avg/max/p95; CPU; memory; success/failure rate; ledger growth/storage; audit reconstruction time | Table: latency as one column avg (min–max); success & failure counts + failure rate %; units; "half answers → add" | Collect the full chat set; present per the call's table format; storage and audit time are mandatory columns/tables | RESOLVED |
| 13 | Hardware in methodology | Asked 24/08 | Not required; optional; personal notes | Optional per D. Recommendation `[INFERRED]`: include a brief hardware line and keep Table 1 (software) — harmless and helps reproducibility | RESOLVED |
| 14 | 2×2 factorial frame | Stated by D | Silent | Keep as the analysis frame (main effects + interaction) | RESOLVED |
| 15 | Reproducibility | "hardware etc." as controls | Reusable, parameterized, fixed seed | Adopt (§5.5) | RESOLVED |
| 16 | Run budget | — | ≈2,000+ runs warning; size to resources | Hard constraint; plan in §5.8 | RESOLVED (values OPEN) |
| 17 | Repetitions | — | D's example used 5; Fig. 1 has an "N runs complete?" loop | Decide r (3 or 5) and the statistic | OPEN |
| 18 | Variants used in calibrations | — | Batch: Anchoring + Parallel-Anchored; channel: Parallel only. N's "channel affects all except Standard" | Correct N's remark: in the 2×2 frame Anchoring is single-channel; channel count applies to Parallel and Parallel-Anchored only; case count (data) applies to all four | CONFIRM |
| 19 | Reporting calibrations | — | Must be reported since performed | Report E1 and E2 as experiments | RESOLVED |
| 20 | Draft/paper gate | Send revised variable table + methodology **before** starting experiments (10/09, 14/09) | Finalize system first, then update Bab 3; but write incrementally | Gate stands for **E3**: variable table + three flowcharts go to D before E3 runs; E0/E1/E2 may start now | RESOLVED |

---

## 5. Consolidated development specification

### 5.1 Experimental frame
- **2×2 factorial** `[CHAT 10/09]`: Factor A = Anchoring {off, on}; Factor B = Parallelization (per-case channels) {off, on}.
  - Standard = A off, B off — one shared channel, one transaction per event.
  - Anchoring = A on, B off — one shared channel; events batched off-chain into Merkle trees, root committed on-chain.
  - Parallel = A off, B on — one channel per case (or per case group; §5.3 E2), one transaction per event.
  - Parallel-Anchored = A on, B on — per-case channels + per-case Merkle roots committed to the **anchor channel** by the off-chain anchor-client `[PROJECT]`.
- Consequences that the code must enforce: batch size is **identical** across A-on variants; channel count is **identical** across B-on variants; the Anchoring variant is **single-channel**; Standard is single-channel.
- Everything else is held constant and documented: Fabric 2.5.15, Caliper 0.6.0, Node 20.19, Go 1.25.5, Fabric CA 1.5.19, two peer orgs, Raft, GoLevelDB, `@hyperledger/fabric-gateway` `[PROJECT]`; block-cutting parameters (`BatchTimeout`, `MaxMessageCount`, `AbsoluteMaxBytes`, `PreferredMaxBytes`), endorsement policy, chaincode version, anchor-client identity/MSP/flush policy, host machine. Configs live in a version-controlled repo and are cited by commit SHA `[PROJECT]`.
- Analysis: report per-variant results and, where the design allows, the factorial main effects (anchoring, parallelization) and their interaction — this is literally what the title asks.

### 5.2 Variables (final)

**Independent (swept):**
| Variable | Levels | Where swept | Where fixed |
|---|---|---|---|
| Architecture variant | 4 | E3 | E1 (2 anchored), E2 (Parallel) |
| Send rate (offered load, tx/s) | grid from low to beyond saturation (proposal: 10, 25, 50, 75, 100, 150, 200 → trim after pilot) | E3a | E1, E2 (one sub-saturation value from the pilot) |
| Case / channel count | proposal 5, 10, 20, 30, 40, 50 within core limits | E2; E3b | E3a (median of healthy range) |
| Batch size N (= K) | proposal 10, 25, 50, 100, 200 (identical grid for both anchored variants) | E1 | E2 n/a; E3 (baseline from E1) |

**Controlled (fixed and documented):** workload operation mix (proportions); PRNG seed / pre-generated trace; evidence payload sizes (metadata size; hash of file; file size per evidence if the harness generates files); evidence items per case; events per case (steady-state runs must reach **≥ 10³ events per channel** before any scalability framing `[PROJECT]`); transactions per round / round duration; warm-up; repetitions r; Fabric block parameters; endorsement policy; anchor-client flush policy; hardware & software stack.

**Dependent (measured):**
| Metric | Unit | How measured | Notes |
|---|---|---|---|
| Throughput (committed) | TPS | Caliper per-round report | Report per channel and aggregate for multi-channel variants `[PROJECT]` |
| Latency | s | Caliper min/avg/max; **p95 needs per-transaction latencies** (custom TxObserver or parsing per-tx logs) | Table shows one column: avg (min–max); p95 in text/appendix `[CHAT 10/09]` |
| Success count / failure count / failure rate | n / n / % | Caliper Succ/Fail; classify failure causes from gateway errors (MVCC_READ_CONFLICT, endorsement, timeout) | Mandatory `[CHAT 10/09]`; format `[AUDIO P3 21:40]` |
| CPU utilization | % | Caliper Docker resource monitor per container (peers, orderers, chaincode, anchor-client); `docker stats` fallback | Aggregate + per-component in appendix |
| Memory usage | MB | same | |
| Ledger growth / storage | MB (and bytes/log) | `du` on peer block store per channel + GoLevelDB state dir + anchor channel + **off-chain store** at checkpoints; linear regression → byte-per-log `[PROJECT]` | Report on-chain reduction in log-payload bytes vs Standard, **with** off-chain bytes shown, never a clean 1/N `[PROJECT]` |
| Audit reconstruction time | s | Custom harness: reconstruct and verify the full CoC of one case — Standard/Parallel: query chain; Anchoring/PA: fetch events from off-chain store → recompute Merkle branches → verify roots on-chain | Mandatory `[CHAT 10/09]`; also the driver of the batch trade-off `[AUDIO P1 00:00]`. Add to Table 3 `[PROJECT]` |
| Anchoring delay (event → root committed) | s | Timestamps in anchor-client logs | N's "window time" `[AUDIO P1 00:00]`; report for anchored variants `[INFERRED as a useful sub-metric]` |

### 5.3 Experiments

**E0 — Pilot / functional smoke test (not reported as scalability).** 10 cases × 10–25 logs at low send rate on all four variants and all operations `[PROJECT]`, then short ramps to locate approximate saturation. Outputs: harness validated; provisional sub-saturation send rate for E1/E2; provisional channel count below the core limit; trimmed send-rate grid.

**E1 — Batch-size calibration.** Variants: Anchoring, Parallel-Anchored. Sweep batch size over the identical grid. Fixed: send rate (sub-saturation), channel count (pilot value), workload mix, seed. DVs: throughput, latency, storage, audit reconstruction time, anchoring delay. Plot X = batch size; Y = throughput / ledger size / audit time; Standard and Parallel as horizontal reference lines `[CHAT 10/09]`. Choose the **baseline** N by a stated rule (e.g., the smallest N at which throughput and storage have plateaued while audit time remains acceptable) — never "optimal" `[AUDIO P1 01:19]`. Transaction type is not a factor here `[AUDIO P1 18:06]`.

**E2 — Channel-count calibration.** Variant: Parallel only `[AUDIO P2 22:01]`. Sweep channel count (proposal 5…50; stop when throughput declines or flattens). Fixed: send rate, seed, mix. DVs: throughput, latency, CPU, memory. Output: the healthy range; the E3a fixed value = **median** of that range `[AUDIO P3 06:41–07:48]`; the E3b upper bound = top of the healthy range. Constraint from the Fabric 2.5 "Performance considerations" page: "ensure that there is a CPU core available for each channel that is running at maximum load" — Caliper drives all channels simultaneously, so the laptop's core count bounds the fully-loaded channel count (see Appendix C).

**E3 — Scalability (main).** Four variants; batch = E1 baseline; repetitions r.
- **E3a scalability vs load:** channel/case count fixed at the E2 median; sweep send rate from low to beyond saturation `[CHAT 10/09; AUDIO P2 09:26]`.
- **E3b scalability vs cases:** send rate fixed at a sub-saturation value; sweep case/channel count from low up to the E2 upper bound — not beyond, since past it "you measure the host running out of CPU" `[AUDIO P3 06:41–07:48]`. This is where "the point at which Parallel starts to lose to Standard" `[CHAT 10/09]` is observed.
- **Per-operation breakdown:** at one operating point (e.g., the E2 median × a mid send rate) run per-operation rounds for each variant; report writes and reads in **separate tables** `[CHAT 10/09; AUDIO P2 00:00–03:06]`.
- Two result tables (vs load, vs cases) per the call; graphs separate per metric with one line per variant `[AUDIO P3 25:38–27:36]`.

### 5.4 Level-selection rules (write these into Bab 3)
- Batch size: single baseline from E1; identical for both anchored variants; rule stated.
- Channel count: E3a value = median of the E2 healthy range; never the maximum `[AUDIO P3 06:41–07:48]`.
- Send rate: grid must bracket saturation (throughput flattens, latency rises) `[CHAT 10/09]`; values trimmed after E0; the "100–200" remark `[AUDIO P3 20:26]` is a table illustration, not a bound.
- Cases: number of cases may be held constant across experiments while channel count varies `[AUDIO P3 02:19]`; the cases→channels mapping is a documented parameter (default 1:1 for Parallel variants).

### 5.5 Benchmark harness requirements (Caliper 0.6.0, Node.js workload modules)
1. **Parameterization** (YAML/CLI/env): variant; number of cases; channels or cases-per-channel; batch size; send rate(s); tx count or duration per round; workload mix proportions; seed; evidence payload/file size; evidence items per case; repetitions; monitor interval `[AUDIO P2 03:46]`.
2. **Determinism**: seeded PRNG; **pre-generate the transaction trace** (operation, target case/evidence, payload) once per configuration and replay it identically across all four variants — only the adapter/chaincode target differs `[AUDIO P2 05:07–06:50]`.
3. **Operation set** (chaincode functions): `CreateEvidence`, `TransferCustody`, `AccessLog` (write custody event), `DisposeEvidence` (status transition, nothing deleted) `[CHAT 10/09]`; read-only: `GetEvidence` / `GetCustodyChain`, `VerifyEvent` (Merkle branch), audit reconstruction. Reads and writes are reported separately (Caliper read latency ≠ transaction latency; reads cut no block) `[CHAT 10/09]`.
4. **Rounds**: mixed-workload rounds (fixed proportions) for E1–E3; per-operation rounds for the breakdown. Each Caliper round = one (variant, factor levels, repetition) cell.
5. **Sweep small first** `[AUDIO P2 04:41]`: the orchestrator supports a `--pilot` profile.
6. **Orchestration** (shell/Python `[PROJECT]`): runs the whole grid; tears down and redeploys the network between runs (fresh ledgers are required for storage measurement and independent repetitions); names outputs by `experiment/variant/levels/rep`; collects Caliper JSON/HTML, resource-monitor output, storage snapshots, anchor-client logs, audit-time measurements into one CSV/JSON store.
7. **Anchor-client / batcher**: batch size N (= K) and flush timeout as parameters; timeout held constant; log per-batch timestamps for anchoring delay; anchor-client identity, MSP and endorsement policy fixed `[PROJECT]`.
8. **MVCC**: concurrent `AccessLog` writes on the same evidence key will collide (MVCC_READ_CONFLICT) and inflate the failure count — implement the per-record event sub-key `(evidenceId, monotonicCounter)` (Open Decision #4) or document the collision rate as a finding.
9. **Reporting scripts**: generate tables with units (TPS, s, %, MB, n) and graphs per metric with one line per variant; E1 graphs with horizontal baselines.
10. **Run log**: every run records config hash, Fabric/Caliper versions, git SHA, timestamps — this is the reproducibility evidence D asked for `[AUDIO P2 03:06]`.

### 5.6 Terminology (enforce in code, configs, and paper)
- `DisposeEvidence`, not `RemoveEvidence` `[CHAT 10/09]`.
- "anchor channel" / "audit channel", never "system channel" `[PROJECT]`.
- "baseline" batch size / channel count, never "best" or "optimal" `[AUDIO P1 01:19]`.
- "send rate" (offered load, configured) vs "throughput" (committed, measured); "TPS" only as a unit `[CHAT 10/09; AUDIO P1 10:47]`.
- "transaction type" / "operation type", never "TPS" for the operation dimension `[CHAT 10/09]`.
- Variant names: Standard, Anchoring, Parallel, Parallel-Anchored (consistently; the chat's "Anchoring Parallel" and the paper's variants must match).
- "Blockchain-Based" `[PROJECT]`.

### 5.7 Paper / methodology deliverables
1. Rewrite Bab 3 around **three experiments** (E1 batch calibration, E2 channel calibration, E3 scalability with two dimensions), plus the pilot described as a functional smoke test, not a benchmark `[PROJECT]`.
2. Variable table: IV / controlled / DV with levels, units, instrument — send to D **before E3** `[CHAT 10/09; §4 item 20]`.
3. Replace Fig. 1 with **three flowcharts** (Mermaid/PlantUML source `[PROJECT]`), units corrected, "on lockb0x" labels replaced by "on Hyperledger Fabric 2.5 LTS" `[PROJECT]` `[AUDIO P3 27:50]`.
4. Table 3: add audit/verification latency and anchoring delay `[PROJECT; CHAT 10/09]`; latency presented as avg (min–max) with p95 reported `[AUDIO P3 20:46; CHAT 10/09]`; success/failure counts + failure rate `[AUDIO P3 21:40]`.
5. Unify the N and K grids into one batch-size grid `[§4 item 2]`.
6. State the selection rules (§5.4), the run budget and repetitions (§5.8).
7. Hardware: brief line or appendix (optional per D); keep the software-stack table `[AUDIO P3 29:48]`.
8. Threats to validity: single host (channel count bounded by cores), GoLevelDB (no rich-query overhead) `[PROJECT]`, calibration-dependent fixed values, off-chain store integrity assumptions `[PROJECT]`.
9. Keep the 2×2 factorial framing visible ("Anchor, Parallelize, or Both?") `[CHAT 10/09]`.
10. Write incrementally; do not wait for the system to be final `[AUDIO P3 41:55]`.

### 5.8 Run budget (planning estimate — replace with measured durations after E0)
- Crossed design D warned about: 4 × 6 × 5 × 4 × 5 ≈ 2,400 runs `[AUDIO P1 02:37]` — not feasible.
- Proposed budget with r = 3: E1 = 2 variants × 5 batch levels × 3 = 30; E2 = 1 × 6 × 3 = 18; E3a = 4 × 6 send rates × 3 = 72; E3b = 4 × 5 case levels × 3 = 60; per-operation breakdown = 4 × 5 ops × 3 = 60 (or folded into E3a rounds). **Total ≈ 240 runs.** At 5–10 min per run including network reset ≈ 20–40 machine-hours; with r = 5 ≈ 400 runs. Decide r and trim grids accordingly.
- Statistic: mean ± SD (or 95% CI) over repetitions; state it.

### 5.9 Timeline (from D)
- Now → end Sep: harness, E0, E1, E2; Bab 3 variable table + flowcharts to D.
- Oct: E3, analysis, full draft; submission **Oct–Nov 2026** to a BINUS-partnered, Scopus-indexed conference (D to suggest; Dec/Jan likely) `[AUDIO P3 31:05–35:22]`.
- Review ≥ 1 month; revise/resubmit; presentation (on-site/hybrid); defense with one examiner; grading window to end Feb / early Mar 2027 `[AUDIO P3 35:22–40:34]`.

### 5.10 Repository
- Keep a version-controlled repo from the start (needed for commit-SHA references `[PROJECT]`); make it public at the end `[AUDIO P3 41:00]`.

---

## 6. Open questions — confirm with D or decide before coding

1. Batch-size grid values; confirm one identical grid for N (Anchoring) and K (Parallel-Anchored) replaces the paper's two grids.
2. Channel calibration on Parallel only — confirm Parallel-Anchored simply inherits the value; confirm the Anchoring variant is single-channel (correct N's "all except Standard" remark).
3. Cases-per-channel: fixed 1:1, or a parameter (→ Open Decision #1: per-case vs per-case-family provisioning).
4. Send-rate grid and the saturation rule (e.g., throughput < 90% of send rate or latency knee).
5. Repetitions r and the reported statistic.
6. Per-operation breakdown: which single operating point; confirm the "one point" reading of `[AUDIO P2 00:00]`.
7. AccessLog is a write in GLEIPNIR — tell D (his 10/09 note assumed read-only); which read-only operations to benchmark as reads.
8. p95 latency: Caliper 0.6.0 reports min/avg/max only — confirm the custom per-transaction collection is worth the effort or report avg (min–max) only.
9. Audit reconstruction time definition: per case, including Merkle verification; whether anchoring delay is reported as a separate metric.
10. Storage definition: block store + state DB + off-chain store + anchor channel; checkpoint schedule.
11. E3b for Standard and Anchoring (single-channel variants): the case sweep is a data-scaling sweep there — confirm it is still run for all four.
12. Hardware line in the paper: include (recommended) or omit.
13. Conference candidates (D to send); template/page limit affects how many tables fit.

---

## 7. Pre-development checklist (ordered)

- [ ] Rename `RemoveEvidence` → `DisposeEvidence`; audit all chaincode/API/docs for "system channel", "optimal", "TPS" misuse.
- [ ] Implement MVCC-safe access-log sub-keys or a documented collision measurement.
- [ ] Harness parameters (§5.5-1) and seeded trace generator (§5.5-2); replay verified identical across variants.
- [ ] Orchestrator with teardown/redeploy, output naming, config-hash + git-SHA logging.
- [ ] Storage snapshot script (per-channel block store, state DB, off-chain store, anchor channel) + byte-per-log regression.
- [ ] Audit-reconstruction harness for all four variants; anchoring-delay logging.
- [ ] Caliper Docker resource monitor configured; per-container CPU/memory aggregation.
- [ ] Per-transaction latency capture for p95 (if confirmed in Q8).
- [ ] E0 pilot run; trim grids; record saturation and core limits.
- [ ] Bab 3 variable table + three flowcharts drafted and sent to D before E3.
- [ ] Run E1 → choose baseline N; run E2 → healthy range, median, upper bound.
- [ ] Run E3a, E3b, per-operation breakdown; generate tables (units!) and per-metric graphs.
- [ ] Consultation-session log updated after each discussion `[CHAT 05/08]`.

---

## Appendix A — Discord thread, verbatim (5 Aug – 17 Sep 2026)

Copied unchanged from the export N provided. `kaiaraia` (OP) = supervisor; `fried_tofu` = N. Original language: Bahasa Indonesia (informal). Nothing edited, including typos.

```text
kaiaraia
OP
 — 05/08/2026 12:55
maksimal banget
fried_tofu — 05/08/2026 12:55
okayyy kakk
seharusnya bisa lebih cepat dari itu
thankyouuu kakkk
kaiaraia
OP
 — 05/08/2026 12:56
Okaaai
nanti kalau sy ketemu paper2 yg kaiatnya dg thesis kamu ini, sy kasih ke sini yak
jangan lupa,masukin hasil diskusi kita ini ke consultation session
fried_tofu — 05/08/2026 12:57
okayy kakk 🫡
kaiaraia
OP
 — 05/08/2026 12:58
https://www.sciencedirect.com/science/article/pii/S277248592500064X
https://www.mdpi.com/1424-8220/22/3/915
https://arxiv.org/pdf/1703.04057
fried_tofu — 12/08/2026 08:59
selamatt pagi kakk, ini aku udh bikin ya kak untuk consultation. untuk paper'nya aku baru sempat baca sekilas, nnti secepatnya aku baca' semuanya dulu ya kakk, thankyouuu kakk
Image
kaiaraia
OP
 — 12/08/2026 16:11
okeeee
fried_tofu — 24/08/2026 16:14
siang kakk, aku mau tanya kak, bisa ga kak di bantu untuk akses paper kak?
aku sudah cek di website yang di kirim kakak kemarin gaada kak
untuk linknya ini kakk
https://doi.org/10.1109/ICRITO61523.2024.10522188
kayakny ini papernya bagus kak untuk referensi mengenai benchmarking pake hyperledger caliper
fried_tofu — 24/08/2026 16:39
untuk progressnya kak, aku udah coba pasang hyperledger calipernya di sistemnya
paling sesuai dengan yang di rekomendasi kakanya, nnti aku bakal coba load kecil untuk masing' variant dulu sebelum tambahin loadnya
selain  mengenai paper, aku mau tanya juga kak, ini kan aku running systemnya di laptop, aku perlu masukkin hardware ke methodology ga kak? soalnya di paper aku blm ada hardware baru ada software yang di pake
fried_tofu — 26/08/2026 10:43
pagii kakk
untuk paper itu aku sudah ada akses
aku mau tanya kak, mungkin kalo kakak ada waktuu
mengenai indpendent variablenya kakk
fried_tofu — 26/08/2026 11:03
aku agak bingung untuk itu soalnya kakk @kaiaraia
fried_tofu — 31/08/2026 09:30
pagii kakk, boleh kak aku mau tanya itu kakk?
fried_tofu — 01/09/2026 08:46
pagii kakk
fried_tofu — 01/09/2026 08:57
untuk independent variablenya aku mau pake 
variannya(standard, parallel, achoring, anchoring parallel) dan
TPS-nya (tipe tranfernya CreateEvidence, TransferCustody, AccessLog, RemoveEvidence)

control variable, 
jumlah case = jumlah channel jadi karena itu jumlah channel tidak bisa di iterate jadi di samain dengan jumlah case yang sama (100) case
hardware
dsb

yang aku mau tanya itu untuk batching Merklenya itu dibikin fixed di setiap 10 log di batch atau itu di bikin independent?
soalnya aku bingungnya di menunjukkan datanya kakk, batching di bikin controlled variable straight forward untuk table dan graphnya, tapi aku di bikin independent aku bingung itu di compare dengan apa gitu, soalnya varian standard & parallel itu tidak batching jadi tidak bisa di compare

boleh minta bantuannya kak kalo ada idenya
fried_tofu — 01/09/2026 09:04
oiya dan untuk dependent variablenya
Send Rate, Throughput, Max Latency, CPU Utilization, dan Memory Usage
ada masukkan kakk atau recommendation?
fried_tofu — 03/09/2026 10:27
pagi kakk aku mau tanya mengenai ini kak, bisa di cek apakah sudah oke atau ada perubahan?
fried_tofu — 05/09/2026 14:24
siangg kakk, blh tanya kakk kalo ada masukkan mengenai progress sblmnya kakk
kaiaraia
OP
 — 10/09/2026 15:08
Sbb, Netsakh yaaaa. 
Coba lihat judul papermu sendiri: "Anchor, Parallelize, or Both?" Itu sebenarnya desain faktorial 2x2. Ada dua faktor: anchoring (ada/tidak) dan parallelization (ada/tidak). Empat varianmu itu adalah empat kombinasinya.
Trs geser ke rancangan awal. Kamu rencana pakai batch 100 log untuk Anchoring, tapi batch 10 log untuk Parallel Anchored. Kalau nanti Parallel Anchored menang, kamu nggak bisa jawab kenapa dia menang — karena parallel-nya, atau karena batch-nya lebih kecil? Dua hal berubah bersamaan, jadi efeknya nggak bisa dipisah. Ini pasti akan jadi pertanyaan. 

Jadi untuk eksperimen utama, batch-nya dibuat controlled dan nilainya harus sama persis di kedua varian yang pakai anchoring. Mau 10 atau 100 terserah kamu, yang penting identik.
"kalau dibikin independent, dibandingkan sama apa?"
ini bisa dengan dipiisah jadi eksperimen kedua. Di eksperimen kedua ini kamu cuma pakai dua varian yang beranchor, lalu batch-nya kamu variasikan: 10, 25, 50, 100, 200. Standard dan Parallel nggak ikut dibandingkan sebagai titik data, tapi muncul sebagai garis horizontal referensi di grafik. Jadi sumbu X-nya batch size, sumbu Y-nya throughput atau ledger size, kurvanya dua varian anchored, dan dua garis lurus sebagai baseline.
Eksperimen kedua ini penting karena nanti pasti ditanya "kenapa kamu pilih N=10?". Kalau ada sensitivity analysis, kamu punya jawabannya.
Soal 100 channel, dicek dulu sebelum running.
 Kalau baca didokumentasi resmi Hyperledger Fabric menyarankan idealnya ada satu CPU core untuk setiap channel yang berjalan dengan beban penuh. Kalau kamu bikin 100 channel dan semuanya aktif, di mesin biasa itu yang bakal terukur bukan lagi perbedaan arsitektur, tapi laptop kamu nanti akan kehabisan resource. Hasilnya jadi nggak valid untuk klaim yang mau kamu buat.
Saran saya, jangan difix di 100. Justru jadikan jumlah channel sebagai variabel yang kamu sweep, misalnya 5, 10, 20, 50. Dengan begitu kamu dapat kurva skalabilitas, dan kamu bisa lihat di titik mana Parallel mulai kalah dari Standard gara-gara overhead channel. Temuan seperti itu jauh lebih menarik daripada satu titik di 100.
Kalau kamu tetap mau 100 case tapi hardware-nya terbatas, alternatifnya pakai namespace atau composite key dalam satu channel. Tapi konsekuensinya "parallel"nya jadi logis bukan fisik, dan itu harus kamu tulis dengan jujur di paper.
Send Rate posisinya kebalik.
Kamu taruh Send Rate di dependent variable. Sebenarnya itu input, bukan output. Send rate adalah yang kamu atur di config, throughput adalah yang kamu ukur. Contohnya ada kasus nyata di Caliper: send rate di-set 307 tps, tapi throughput yang tercapai cuma 109 tps dengan latency 2,94 detik. Selisih itulah yang menunjukkan sistemnya sudah jenuh.

Jadi send rate pindah ke independent variable, dan tolong disweep juga jangan cuma satu nilai. Skalabilitas baru kelihatan kalau ada kurvanya. Yang kita cari itu titik jenuhnya di beban berapa throughput mulai mendatar dan kenaikan latency
3 metrik yg pelru kamu tambahkan:
Daftar DVmu sekarang belum lengkap, dan yang hilang justru yang bikin papermu punya nilai lebih.

>Pertama, success dan failure rate. Ini wajib. Tanpa ini, throughput yang naik bisa jadi naik karena banyak transaksi yang gagal, dan kamu nggak bisa bedakan. Ini titik serangan paling gampang buat reviewer.

>Kedua, ledger growth atau ukuran storage. Ini seluruh alasan kenapa anchoring ada. Kalau nggak diukur, papermu nggak bisa membuktikan klaimnya sendiri.

>Ketiga, audit reconstruction time — berapa lama merekonstruksi chain of custody lengkap satu kasus. Ini trade-off dari anchoring, dan ini yang membedakan papermu dari benchmark Hyperledger biasa. Tanpa ini, papermu cuma jadi replikasi test standar Caliper.

Satu lagi, Max Latency saja nggak cukup. Satu outlier bisa mendominasi angkanya. Laporkan min, max, dan avg sekaligus, kalau bisa tambah p95.
kaiaraia
OP
 — 10/09/2026 15:15
Notes: 
Di rancanganmu, independent variable kedua kamu tulis "TPS-nya (CreateEvidence, TransferCustody, dst)". Itu ketuker istilah. TPS itu transactions per second, satuan throughput. Yang kamu maksud itu transaction type atau operation type. 

Terus, nama operasi RemoveEvidence sebaiknya diganti. Di chain of custody forensik, bukti itu nggak pernah benar-benar dihapus , itu melanggar prinsip immutability dan bisa dipersoalkan admissibilitynya di pengadilan. Yang benar itu disposition atau perubahan status. Ganti jadi DisposeEvidence atau UpdateEvidenceStatus.

Oh iya, AccessLog kemungkinan operasi read only. Caliper memisahkan read latency dari transaction latency, dan operasi read nggak menghasilkan block. Jadi jangan dirata-ratakan bareng operasi write, pisahkan tabelnya.
Cek dulu spesifikasi mesin eksperimen kamu, lalu putuskan mau berapa channel. Setelah itu revisi tabel variabelnya sesuai catatan di atas, dan kirim lagi ke saya sebelum mulai eksperimen. Lebih baik kita benerin desainnya sekarang daripada sudah jalan berminggu-minggu baru ketahuan datanya nggak bisa dipakai.

Secara keseluruhan arah kamu sudah benar kok, ini tinggal dirapikan. Kalau ada yang bingung, tanya aja ya
fried_tofu — 14/09/2026 11:03
sbb kakk aku baru sempat baca full. okayyy kakk noted, aku apply dulu di mesin experimennya kakk. untuk bentuk yang nnti akan aku kirim ke kakak sebelum di jalankan experimen nnti aku update di bagian methodology, jadi nnti aku kirim updated draftnya ya kakk
kaiaraia
OP
 — 16/09/2026 12:28
Oke,Netsakh
fried_tofu — 17/09/2026 15:57
kak ada beberapa poin yang ingin aku tanya, jadikan akan ada 2 experimen yang satu batch size statis dan dengan 4 varian yang kedua dengan batch size dinamiis dengan 2 varian(only bacthing) itu kan kak ada notes, experimen ke dua penting untuk determine kenapa kita menggunakan contoh N=10, kalo begitu lebih bagus lakukan experimen 2 untuk mendapatkan batching terbagus dan setelah itu experimen 1 dengan batching yang paling optimal?

untuk channel kayaknya 100 channel tidak optimal sama sekali di laptop saya, jadi nnti channelnay di 5, 10, 20, 30, 40, 50, karena channel sesuai dengan jumlah casenya jadi jumlah case akan mengikuti value ini juga. ini di lakukan begini karena ini salah satu fitur utamanya fabric yang beda dengan blockchain network biasa dimana satu ledger utama di partisi dengan channel jadi walaupun satu ledger terupdate tapi masing' participant atau node dalam blockchain network hanya bisa melihat ledger sesuai channel mereka.

noted untuk send rate saya  sweep 10, 25, 50, 75, 100 sampai ke titik jenuh sistemnya, nnti nilai yang di sweet akan di sesuaikan.

jadi untuk konfirmasi DVnya Throughput, Max Latency(min, max, avg dan p95), CPU Utilization, Memory Usage, success dan failure rate, ledger growth atau ukuran storage dan  audit reconstruction time
untuk independent variablenya: 
experiement 1: channels/case number, send rate, transaction type
experiement 2: batch size, channels/case number, send rate, transaction type 
fried_tofu — 17/09/2026 16:07
kak boleh dgn discord untuk discuss ini kak? aku sekaligus mau tanya untuk mempresentasikan hasil experimennya
dan mungkin kalo dari kakak ada poin dari saya yang kurang jelas bisa saya bantu jelaskan kakk
kaiaraia
OP
 — 17/09/2026 16:50
Boleh. Kamu bisanya kapan ?
fried_tofu — 17/09/2026 16:53
kalo weekday aku boleh malam kak, kalo weekend bisa kapan saja
malam dari jam 6 untuk weekday
kalo weekend boleh di jam 10/11 kak?
kaiaraia
OP
 — 17/09/2026 16:56
Malam ini jam 18.30, bisa ngga?
Weekend ini sy ngga bisa soalnya
fried_tofu — 17/09/2026 16:56
bisaa kak
okey kak bisa malam ini saja
fried_tofu — 17/09/2026 18:31
malam kakk, aku udah di discord ya kakk
kaiaraia
OP
 — 17/09/2026 18:37
Oke, wait ya
fried_tofu — 17/09/2026 18:40
okkeyy kak

```

---

## Appendix B — Discord call transcript, 17 Sep 2026 18:30 WIB (cleaned, Bahasa Indonesia)

Reproduced from `claude/GLEIPNIR_Bimbingan_Transkrip_2026-09-17.md` (project doc). Speaker attribution is inferred; **(?)** marks uncertain attribution; `[tidak jelas]` marks inaudible words; `[hening …]` marks verified silence. Timestamps are relative to each recording part. The uncorrected timestamped ASR output is in `GLEIPNIR_Bimbingan_Transkrip_2026-09-17_RAW_ASR.txt` for line-level verification.

### GLEIPNIR — Transkrip Diskusi Bimbingan dengan Dosen Pembimbing

**Sumber:** tiga rekaman (`Jalan Petojo Melintang No. 23` bagian 1–3), total ≈ 90 menit (24:40 + 22:55 + 42:42).
**Peserta:** **N** = Netsakh (penulis); **D** = Dosen pembimbing (dipanggil "Kak" oleh N; memanggil N "Netsak").
**Bahasa:** Bahasa Indonesia percakapan dengan istilah teknis Inggris.

**Catatan transkripsi.** Transkripsi dibuat dengan Whisper (large-v3-turbo) lalu dikoreksi manual terhadap konteks GLEIPNIR. Istilah teknis yang salah dengar dinormalisasi (mis. *bed/bate size → batch size*, *senred → send rate*, *channel account → channel count*, *Panadao → Parallel-Anchored*, *Encore → anchor*, *experience → experiment*). Atribusi pembicara diinferensi dari isi dan gaya bicara (D memakai "saya/kamu", N memakai "aku/Kak"); bagian yang atribusinya tidak pasti diberi tanda **(?)**. Kata yang tidak terdengar jelas ditandai `[tidak jelas]`. Jeda hening panjang (bukan ucapan yang hilang; diverifikasi dari level audio ≈ −45 dB) ditandai `[hening …]`. Cap waktu `mm:ss` relatif terhadap awal masing-masing bagian rekaman.

---

#### Bagian 1 (24:40) — Batch size, channel count, dan variabel independen

**[00:00] N:** …nah, ledger-nya lebih kecil.
**D:** Apanya yang lebih kecil?
**N:** Ledger.
**D:** Oh, ledger. Oke, oke.
**N:** Tapi untuk *audit reconstruction*-nya itu lebih lambat. Jadinya ada kayak *window time*-nya lebih panjang sebelum log-nya ter-*anchor* ke blockchain.

**[00:26] D:** Oh, jadi problemnya lebih ke ini ya — dia lamanya karena prosesnya, gitu?
**N:** Iya.
**D:** Latency-nya karena proses, bukan karena mungkin CPU atau apa gitu?
**N:** Enggak, bukan.
**D:** Oke, oke.

**[00:52] N:** Nah, kalau yang batch kecil, itu *anchoring*-nya lebih sering, terus audit-nya bisa lebih cepat, tapi overhead-nya lebih besar.
**D:** Oke, jadi *reverse*-nya dari yang batch besar ya, kalau dibandingin sama batch yang kecil, contohnya gitu? Atau…
**N:** Iya betul, kayak gitu.
**D:** Oke. Jadi kita cari *baseline* yang paling optimal di antara dua itu ya?
**N:** Betul.
**D:** Oke. Kata-katanya jangan "mencari yang terbaik" lagi.
**N:** Oke, jadi cari *baseline*-nya, katanya. *Baseline value* dari batch sizing-nya, gitu.
**D:** Betul.
**N:** Oke. Berarti itu udah *clear*.

**[01:46] N:** Sama buat itu sih, yang channel-nya. Kayaknya iya — aku baca juga, ternyata betul, dia per channel. Kalau ikutin *recommended*-nya, satu channel kan satu CPU. Nah jadi palingan itu. Kayaknya 50 udah lumayan banyak channel, jadi mungkin mulai dari 5 sih. 5 sampai… dinaikin sampai dia mulai ada kurvanya, di mana efisiensinya lebih kepotong karena CPU-nya nggak cukup.
**D:** Iya, bisa kayak gitu.
**N:** Oke. Jadi palingan itu — kalau contohnya di 50 masih kurang, kayaknya grafiknya masih oke, mungkin masih naik sesuai dengan scalability-nya, jadi dinaikin terus kalau dia masih boleh, gitu.
**D:** Iya. Cuman sekarang tuh ada masalah yang bisa muncul sih, Netsak.
**N:** Gimana tuh, Kak?
**D:** Terkait jumlah *run* yang bisa jadi itu meningkat ya.
**N:** Oh gitu ya.
**D:** Iya, di eksperimennya. Eksperimen pertama gitu kan. Misalkan kamu mau ngambil 4 varian nih. 4 varian, 6 level channel, 5 send rate-nya, 4 transaction type, 5 repetisi, gitu misalkan.
**N:** Iya.
**D:** Itu kan kalau di… 2000-an lah ya. 2000-an *run* gitu.
**N:** Kebanyakan, ya. Jadi banyak banget ya *independent variable*-nya.
**D:** Iya. Dan itu membutuhkan waktu yang berbulan-bulan gitu. Jadinya kamu perlu cari tahu dulu nih, jumlah *run*-nya itu berapa yang sesuai dengan *resource* kamu sekarang.
**N:** Oke, oke. Itu sih yang aku agak bingung juga. Kalau *independent variable*-nya kan jadinya nanti… itu yang bakal dicari, yang efeknya ke *dependent variable*-nya kan. Nah jadi contoh mulai satu-satu, terus nanti berarti grafiknya jadi banyak banget. Kalau contoh tadi, kalau nggak salah *dependent variable*-nya ada 6 atau 7 mungkin — throughput, max latency, CPU, dan teman-temannya. Jadi mendingan gimana ya, Kak, buat milih… gimana istilahnya, buat cari *independent variable* yang bakal di-*measure*?

`[hening ± 00:05:08–00:05:57]`

**[05:57] D:** Kamu udah cari tahu belum, dari variabel-variabel itu yang berpengaruh apa? Kan biasanya ada variabel yang memang pengaruhnya minim. Misalkan… berat badan itu bisa naik [analogi; kalimat tidak lengkap terdengar]. Nah, faktor yang benar-benar nentuin itu bagus atau enggaknya, atau faktor yang benar-benar kaitannya sama itu, apa gitu? Udah dicari tahu belum?
**N:** Kalau aku coba di sistemnya masih belum sih.
**D:** Coba di sistemnya masih belum. Kalau yang secara paper atau literaturnya gimana? Kalau paper-nya yang ngefek gitu — jadi yang berdampak ke ini ya, ke…
**N:** Send rate ke throughput, max latency, dan teman-temannya gitu ya. Sebenarnya itu tergantung ini sih. Aku kepikirnya malahan *independent variable*-nya itu mungkin satu atau dua doang: di send rate dengan di variannya. Eh, tiga sih: send rate, varian, sama… Aku kepikirnya kayak gini sih, Kak. Nanti contoh hasilnya, aku *share screen* aja ya.

**[08:02] N:** Nah, ini salah satu dari yang Kakak sempat kirim kemarin. Sebenarnya itu yang TPS — maksud aku, dia ada TPS yang buat *create evidence*. Aku kepikir dia sama kayak yang ini: dia *performance* cuma buat salah satu function-nya. Jadi masing-masing tabelnya ini untuk function yang spesifik. Jadi aku pikir dia buat TPS itu perlu masing-masing function yang ada di sistem aku juga. Tapi enggak ya — dia per *transaction type* gitu.
**D:** Terus, terus, lanjutin dulu.
**N:** Oh iya. Nah, terus makanya kemarin aku nge-proposal-nya, aku pikir yang jadi nanti hasil tabelnya itu — di eksperimen, di *independent variable*-nya — sebenarnya yang utama itu TPS. Jadi cuma itu yang diubah, terus nanti bakal kelihatan hasilnya. Soalnya ini kan semua datanya bakal didapat dari Hyperledger Caliper waktu di-*run*. Jadi tinggal dicoba di antara beberapa TPS, gitu.
**D:** TPS ini maksudnya ke *independent variable* ya?
**N:** Iya, *transaction per second*-nya. Kayaknya dia sama aja dengan send rate sih. Jadi send rate-nya dibikin kayak 100 per second gitu. Kalau aku lihat di paper lain, dia kemarin… begitu juga sih, sebentar. Mereka pakai… [10:24] ya, seperti ini: send rate mereka pilih salah satu, contoh salah satu *operation type*-nya, terus nanti itu yang bakal di-*running*, terus dilihat grafiknya gimana dari *operation* itu.

**[10:47] D:** Oke, kita coba lihat lagi. [11:08] TPS itu kan dia satuan ya. Yang saya tahu, itu bukan variabel gitu. Jadi TPS itu kayak kilometer per jam, gitu kan. Yang jadi variabel, kecepatan itu kan.
**N:** Kecepatan mobil maksudnya ya — kilometer per jam gitu, atau batas kecepatan jalan sekian kilometer per jam gitu. Jadi dia beda dengan send rate ya? Send rate itu kayak… itu udah rata-ratanya?
**D:** Send rate itu lebih ke… jadi dia lebih ke kecepatan transaksi dari data yang kamu kirim, dan ini udah kamu atur, gitu. Kalau throughput kan sebenarnya berapa sih yang berhasil di-*commit*, gitu. Yang ini yang akan kamu ukur — throughput ini.
**N:** Oke. Mungkin TPS ini masuknya ke throughput kali ya, yang di paper itu. Yang di paper ini atau yang di paper aku, Kak?
**D:** Oh, yang ini ya? Iya. Coba nanti dibaca lagi ya.
**N:** Oke. Jadi sebenarnya TPS itu nggak sama dengan send rate, gitu.
**D:** Iya.
**N:** Oke, oke. Hmm.

**[12:52] N:** Jadi kan itu sebenarnya… jadi kalau dibikin *independent variable*-nya: batch size, channel atau case number-nya, send rate, sama transaction type. Itu — eh, bukan send rate…
**D:** Oh, send rate ya. Send rate dibikin send rate, soalnya di-setting dari kita ya?
**N:** Iya. Oh iya, berarti tambah TPS-nya.

**[13:52] N:** Jadi paling eksperimennya kan tetap 2. Yang batch size buat cari *value* yang *baseline*-nya, dari *value* yang *high* dengan yang *low* — kalau di-setting batch size yang *high* dengan *low*. Terus pakai *value* itu. Nanti kalau kita udah dapat, contoh, N-nya — N-nya contoh 10 — nanti itu bakal dipakai di eksperimen utama. Jadi nanti kalau ditanya "ini batch size-nya kenapa dipakai ini", bisa dibilang itu dapat dari eksperimen sebelumnya.
**N:** Buat *independent variable*-nya, dia channel atau case, soalnya case-nya itu sesuai dengan jumlah channel-nya sih. Jadi masing-masing case itu kepisah per channel. Soalnya itu salah satu kegunaannya pakai Hyperledger sih: kalau blockchain yang biasa kan semuanya *public*, jadi antara node nggak ada pemisahan dari ledger yang mereka terima — masing-masing bisa lihat ledger seutuhnya. Tapi kalau di Hyperledger, dia kepisah pakai channel, kayak *subnetting* gitu. Jadi dari satu ledger, atau satu database, dia ter-partisi. Contoh channel satu cuma boleh lihat sebagian dari ledger utamanya. Jadi case-nya disesuaikan sama itu, makanya disamain *value*-nya.
**N:** Send rate nanti juga — kalau buat send rate, dibikin sama kayak batch size, jadi kita cari *baseline*-nya, atau gimana ya?
**D:** Send rate-nya ya… send rate-nya itu perlu kamu konfigurasi sih. Itu dicoba-coba aja ya.
**N:** Oke. Kalau buat transaction type, kita perlu bikin eksperimen per transaction type nggak? Soalnya kan ada beberapa, kayak *create evidence* dan lain-lainnya. Itu per transaction type kita *run* eksperimen satunya?
**D (?):** Ya.

`[hening ± 00:16:48–00:17:25]`

**[17:25] D:** Kamu untuk *draft* paper-nya udah dicicil belum?
**N:** Ehm… masih belum sih, Kak. Soalnya sebelum aku *revise* lagi metodologinya, aku mau coba pastiin sistemnya udah final, biar nanti metodologinya — yang Bab 3 itu — bakal *based on* sistemnya.
**D:** Oke. Untuk yang tadi pertanyaannya — transaction type-nya itu perlu dibikin apa enggak — sebenarnya enggak wajib sih. Maksudnya enggak wajib untuk jadi faktor di eksperimen satu, gitu ya.
**N:** Yang eksperimen itu dengan batch size atau nggak, Kak? Batch size itu yang masuk ke eksperimen satu tadi, bukan ya?
**D:** Oh iya, sorry, berarti ini ketukar *numbering*-nya. Jadi yang eksperimen satu itu yang kita cari *baseline* batch size-nya kan. Nah itu nggak perlu, itu nggak perlu — itu opsional, transaction type-nya.
**N:** Nah untuk eksperimen 2, yang kita udah dapat *baseline*-nya, itu opsional juga buat transaction type-nya, atau harus?

`[hening ± 00:19:00–00:19:50]`

**[19:52] D:** Batch size itu sebenarnya kan dicari, bukan sih?
**N:** Iya, batch size dicari.
**D:** Kalau misalkan nambahin transaction type… iya, tapi itu kayaknya tidak membantu untuk menjawab pertanyaan sama sekali sih.
**N:** Iya sih. Seharusnya dia per transaction type-nya sama aja sih *value*-nya.
**D:** Better kamu pilih satu batch size aja untuk dipakai di [eksperimen] 2.
**N:** Oke, jadi transaction type-nya itu kayaknya nggak usah. Jadi nanti buat *script*-nya, dia kayak nge-*run* semua — dia kayak *randomize*, nge-*run* terserah transaksi apa, yang penting dia *running*. Atau berpatokan ke satu transaksi aja, contoh kayak *create evidence*, atau *view evidence* — kalau user nge-*view* kan kebuat log-nya — atau *transfer evidence*.

`[hening ± 00:21:38–00:22:43]`

**[22:44] D:** Kamu ada dua *experience* ya?
**N:** Iya. *Experiments*.
**D:** *Experiments*, iya. Oh, sorry, saya loncat-loncat.
**N:** Iya, nggak apa-apa.
**D:** Terkait dengan transaction type itu ya. Yang pertama tadi, terkait dengan yang *baseline* yang besar dan kecil, benar nggak? Iya. Kalau si transaction type itu baiknya dia selalu ada, tapi di sini dia bukan sebagai variabel — *dependent* atau *independent* — ya.
**N:** Oh gitu. Dia lebih ke apa itu, Kak?
**D:** Ke kayak… itu kan nanti ada *script* yang ngirim ke — apa ya sifatnya — ke smart contract-nya, gitu?
**N:** Iya.
**D:** Terus proporsinya tetap tuh. Jadi dia tuh bagian dari *workload*.
**N:** Gitu. Oke, oke. Nah kalau yang kedua, itu tadi yang nggak harus ada gitu ya? Kalau misalkan dia ada juga, dia nggak akan menjawab pertanyaan, gitu tadi.
**D:** Iya.
**N:** Oke, jadi dia nanti ada di *script*-nya ya. Nah itu dia… ah, sebentar, sorry, sebentar, agak ada yang nelpon.

*(bagian 1 berakhir)*

---

#### Bagian 2 (22:55) — Transaction type sebagai workload, script reusable, kalibrasi channel

**[00:00] D:** …tapi jangan di-*note* di paper-nya — untuk paper-nya apa ya bahasanya — disilangkan ke seluruh eksperimen gitu ya. Cukup di satu…
**N:** Di satu apa aja, Kak?
**D:** Di satu titik operation, misalkan di satu *node* aja, gitu.
**N:** Oh, di satu *node* aja ya.
**D:** …aja ya, karena itu nanti akan membantu menjawab pertanyaan, misalkan nih: di bagian operation mana sih yang paling mahal? Atau apakah *anchor* itu membantu semua operation-nya, atau hanya sebagian? Nah itu nanti akan terjawab dengan si — apa namanya — transaction type ini.
**N:** Jadi dia tetap perlu transaction type yang lain juga ya, nggak boleh cuma satu doang, biar bisa lihat kalau efeknya cuma untuk satu transaction type, atau buat satu operation, atau buat semua operation-nya.

`[hening ± 00:01:15–00:02:17]`

**[02:17] D:** Oh, itu dijalankan untuk semua sih.
**N:** Semua?
**D:** Masing-masing diuji.
**N:** Oke. Tapi — oke, masing-masing semuanya diuji. Jadi nanti dia bakal tetap dipisahin kayak di paper ini ya? Oke, berarti itu… tapi dia tetap nggak jatuh sebagai *independent variable*, lebih ke ngelihat kalau hasilnya konsisten buat masing-masing operation gitu?
**D:** Betul.
**N:** Oke, jadi dia bukan di… oke, oke. Berarti itu udah.

**[03:06] N:** Terus, tadi pertanyaan apa yang belum terjawab itu — *script* ya?
**D:** Iya, *script*-nya. *Script*-nya itu dia perlu *reusable*. Jadi nanti kalau orang nyoba, terus ngejalanin *script*-nya lagi, *result*-nya bisa kayak sama gitu. Kalau contoh mereka pakai hardware yang sama atau *environment*-nya sama, seharusnya nanti hasilnya sama.
**N:** Sama itu, nanti *script*-nya dibikin ini nggak, Kak: orangnya bisa masukin sendiri *value* yang dia mau tes? Jadi contoh kalau di eksperimennya aku nge-*run*, bisa di-set gitu untuk evidence-nya ada berapa, *concurrent case*-nya ada berapa, ukuran file per evidence-nya ada berapa megabyte. Itu perlu dibikin kayak gitu, Kak, jadi bisa di-set sendiri? Bisa jadi nanti tampak buat *script*-nya banyak *input box* buat masing-masing *value* atau variabelnya.
**D:** Bisa sih dibikin kayak gitu.
**N:** Oke, oke. Terus nanti itu dijalanin ini ya — *sweep test* dulu. Sebelum dijalanin *workload* yang besar, dijalanin dulu *workload* yang kecil, itu buat lihat efeknya ke sistem gimana.
**D:** Betul, betul. Atau bisa juga randomisasi bertingkat, gitu. Misalkan yang pertama itu milih jenis operasinya, terus kemudian milih target operasinya — kayak misalkan evidence-nya mana, case-nya mana, gitu.
**N:** Oh gitu.
**D:** Itu juga bisa kayak gitu sih.
**N:** Oke, oke. Jadi itu maksudnya evidence yang mana, case yang mana, gitu. Jadi dia bisa ngetes masing-masing channel gitu, harusnya sih ya. Oke.
**D:** Oke, oke. Nah tapi kalau mau skenario yang seperti itu tadi, kamu pastiin *seed*-nya tuh tetap. Jadi supaya misalkan kamu mau dua atau tiga varian atau empat varian itu, urutan transaksinya tuh sama persis, gitu.
**N:** Oke.
**D:** Kalau kamu mau pakai yang cara kamu tadi juga boleh aja sih, silakan.

**[06:50] N:** Oke. Nanti buat hasilnya, formatnya aku boleh bikin kayak gini, Kak, yang di paper ini?
**D:** Kayak gimana tuh? Kayak tabel-tabel gini ya?
**N:** Iya, formatnya pokoknya kayak gini sih hasil akhirnya. Atau…
**D:** Boleh.
**N:** Oke. Jadi sebenarnya *independent variable*-nya cuma itu ya? Ini berarti di *independent variable* ditambahin TPS ya, Kak? Yang lain, yang ini… itu yang eksperimen berapa? Buat semua — buat kedua eksperimennya sih, atau enggak? Soalnya kayak contoh ya, di eksperimen yang satu, yang mencari *baseline*, kita tinggal nge-set. Jadi dijalanin TPS 100 buat… terus ini kayak yang di atas ini, nanti batch size-nya jadi dari kecil ke besar, terus TPS-nya dari kecil ke besar juga. Jadi bisa dibikin kayak gitu, atau dia kayaknya beda ya?

`[hening ± 00:08:18–00:08:35]`

**[08:35] N:** Terus nanti mungkin di bawah sini… nggak bisa ya? Itu sih, aku agak bingung buat tabelnya bakal gimana — yang di X axis itu apa, yang di Y axis-nya apa. Eh, sebentar, sebentar. Oke.

`[hening ± 00:08:57–00:09:26]`

**[09:26] N:** Gimana, Kak? Eksperimen 2 tadi apa?
**D:** Eksperimen 2 itu dia sudah pakai batch size yang *baseline*, terus nanti itu yang bakal melihat di antara varian-variannya mana yang — kalau dibandingin — ke scalability. Dijalanin scalability test. Paling bagus buat nge-uji scalability test-nya itu yang dinaikin *workload*. Jadi *workload*-nya pakai TPS, TPS count-nya.

`[hening ± 00:10:06–00:12:02 — level audio rendah; tidak ada ucapan yang dapat dikenali]`

**[12:02] D:** Sebelum masuk ke eksperimen 1 dan eksperimen 2, itu kayaknya kamu butuh fase atau tahap **kalibrasi** dulu deh.
**N:** Kalibrasi yang mana tuh?
**D:** Karena gini. Kalau misalkan tadi itu — kemarin saya bilang 100 channel, saya sambil baca —
**N:** Oh yang itu ya? Yang 100 channel?
**D:** Iya. Nah itu ternyata saya kemungkinan ada salah ya di sini. Karena bisa jadi sistemnya itu kemungkinan dia baru menunjukkan ada tanda-tanda atau karakteristik… kalau 100 itu dia masih bisa oke gitu, tapi ternyata lebih dari 100 dia baru menunjukkan — ibaratnya — grafiknya turun gitu ya, atau mulai horizontal.
**N:** Oke.
**D:** Jadi kalau misalkan sudah ditentuin 100 di awal, jadinya semua batch size-nya akan kelihatan sama bagusnya. Throughput-nya akan mentok di send rate-nya. Jadi dia tidak akan bisa memilih N-nya berdasarkan data apa pun.
**N:** Buat channel-nya itu harus lebih kecil lah *value*-nya, atau sesuai gitu — kayaknya perlu disesuaiin ya. Jadi mungkin kayak itu juga, Kak: kayak eksperimen satu, kita cari *baseline*-nya kan — hal yang sama juga buat channel-nya, kita cari *baseline*-nya gitu. Jadi kita mulai dari *value* yang kecil sama yang besar, terus kita lihat paling — bukan optimal, tapi paling… oke. Paling oke-nya gimana?

`[hening ± 00:14:41–00:15:55 — level audio rendah]`

**[15:55] D (?):** …channel-nya itu kayaknya bisa lebih… bisa di lebih kecil sih.
**N:** Lebih kecil ya, atau dinaikin dikit gitu, tapi jangan yang terlalu besar juga. Jadi mungkin channel-nya di nilai tengah lah — tengah-tengahnya di mana gitu. Jadi nilai tengah itu yang perlu dicari ya. Oke.
**N:** Oke, tapi Kak, itu kan aku kepikirnya channel-nya itu bakal sesuai dengan *number of case*-nya. Atau itu nggak boleh disamain ya?
**D:** Berarti channel-nya itu sesuai dengan jumlah case-nya, maksudnya?
**N:** Iya. Jadi dia kan efeknya ke 4 variannya. Jadi kalau… jadi nggak apa-apa?
**D:** Itu nggak apa-apa. Oke. Cuma kalau misalkan pertanyaannya "boleh dipecah apa enggak" — boleh sih.
**N:** Dipecah gimana maksudnya, Kak?
**D:** Dipecahnya itu: case-nya ini dilihat sebagai *data*, versus channel sebagai *infra*-nya.
**N:** Oke, oke. Jadi kayak lebih ke acuan gitu ya? Oke. Jadi channel-nya perlu… berarti dia bakal ada 3 eksperimen ya? Atau buat nge-*calibrate* itu — yang buat nge-*calibrate* channel itu — nggak perlu di-*state* di eksperimennya, atau perlu ya?
**D:** Itu perlu sih, karena itu kan kamu lakukan.
**N:** Oke, jadi itu perlu ditambahin aja, sama kayak batching-nya itu?
**D:** Betul.
**N:** Oke. Jadi eksperimennya nanti tiga.
**D:** Iya.
**N:** Jadi kayaknya buat eksperimen yang… jadi eksperimen satu itu — contoh eksperimen satu itu yang ngecari batch size *baseline* — itu di-*run* aja di satu varian aja bisa nggak, Kak? Di varian yang… oh, dia perlu dua-dua variannya ya, yang ada batching?
**D:** [19:31] …besar dan kecil tadi? Yang buat batch size itu?
**N:** Itu perlu dijalankan di varian Anchoring sama Anchoring Parallel, atau boleh di Anchoring doang?
**D:** Oh, I see. Kemarin itu ada 4 ya?
**N:** Iya. Jadi ada yang Standard, ada yang…
**D:** Ya, ada yang Standard, ada yang Parallel, sama yang Anchor. 3 berarti?
**N:** Oh iya — Parallel-Anchored. Sama Parallel-Anchored. Anchor yang kepakai 2 ya.

`[hening ± 00:20:18–00:22:01]`

**[22:01] D:** Semuanya di-*run* di semua varian sih. Nggak perlu, maksudnya — kalau kalibrasi itu cukup dilakukan di satu varian aja. Bahkan kamu pilih Parallel-Anchored gitu, katanya paling kompleks. …Parallel aja ya. Itu cukup dua varian aja — misalkan Anchoring sama Parallel-Anchored.
**N:** Oke. Nah berarti buat yang parallel itu, dibikin yang buat channel count itu dibikin di Parallel aja ya.

*(bagian 2 berakhir)*

---

#### Bagian 3 (42:42) — Struktur tiga eksperimen, tabel hasil, timeline conference

**[00:00] N:** …eksperimen 2 baru yang 4 [varian], sama tambah satu lagi yang sebelum eksperimen 2. Jadi nanti eksperimennya ada 3. Yang satu lagi itu yang buat channel-nya. Oke, buat channel-nya dia bikin di Parallel doang. Oke, itu buat channel… Tadi, sorry Kak, yang eksperimen 1, dia di Anchor doang boleh kan? Atau di Anchor sama yang Parallel-Anchored?
**D:** Dua — Anchor dan Parallel-Anchored.
**N:** Oke, oke. Itu, oke. Soalnya kalau yang di varian yang Standard, yang *baseline*-nya, dia sebenarnya nggak pakai banyak channel. Dia channel-nya dibikin *default* satu doang, biar dia kayak blockchain biasa.
**D:** Oke.
**N:** Berarti… jadi itu udah nggak jadi *independent variable* ya, yang batch size [dan] channel? Nggak ya? Udah lebih ke kayak sama… operation-nya gitu. Yang operation yang *send*.
**D:** Dia tetap, dia tetap. Tapi dia *value*-nya enggak…
**N:** Ini kan Kak, dia tetap statis gitu, soalnya kan udah dapat yang *baseline*-nya?
**D:** Iya ya, karena udah dapat *baseline*-nya buat channel sama yang apa — jadi tinggal pakai *value* itu terus. Iya, oke.
**N:** Hmm. Tapi dia kalau buat channel count — itu kan sebenarnya channel count itu dia ikut sama case-nya. Itu nanti, jadi semua case-nya — jadi buat semua eksperimennya case-nya sama gitu, tapi nanti yang bedanya itu *workload* di TPS-nya. Itu nggak apa-apa ya?
**D:** Seharusnya nggak apa-apa sih. Jumlah case itu bisa sama, cuma kalau jumlah channel itu bisa beda.
**N:** Oh, jumlah channel-nya beda. Nggak pakai acuan dari itu ya? Dari… bentar. Jadi itu cari *baseline*-nya biar — contoh — channel count-nya contoh di 50 *baseline*-nya, soalnya kalau di 55 itu grafiknya bukan naik tapi mulai turun, kayak dia mulai bentuk parabola. Nah jadi kita jadi *max*-nya, nanti untuk di eksperimen kita mulai dari contoh 10, 20, 30, 40 sampai di 50, gitu?
**D:** Iya.
**N:** Oh gitu ya. Kalau buat batch size-nya begitu juga nggak, Kak? Batch size ya? Atau nggak?
**D:** Nggak.
**N:** Jadi contoh di batch size-nya, grafiknya bentuknya parabola juga, atau paling tidaknya dia naik tapi habis itu mulai menuju horizontal setelah *value* contoh 80 lah. Jadi karena itu, *baseline*-nya dibikin di 80 — *value*-nya contoh dari 20 sampai ke 80.
**D:** Kalau batch size itu polanya mirip dengan channel sih, [tapi] nilainya tuh nggak berlaku untuk semua varian gitu ya. Karena ada dua varian yang nggak punya konsep batch size itu.
**N:** Iya. Yang punya kan si Anchor dan si Parallel-Anchored doang ya?
**D:** Iya, iya.
**N:** Oh jadi dia beda ya sebenarnya. Yang ada dampak dengan channel itu semuanya, kecuali Standard. Oke.

`[hening ± 00:05:31–00:05:52]`

**[05:52] N:** Jadi batch size-nya tetap sama ya, pakai *baseline*-nya — contoh *baseline*-nya 20, ya udah, semuanya tetap 20 buat batching. Nah tapi buat channel, itu yang bakal dibikin *baseline*-nya jadi *max*. Terus *value*-nya nanti buat di eksperimen mendekat berarah ke *baseline*-nya itu. Contohnya kita dapat di eksperimennya channel count yang paling bagus itu di 80 sebelum kurvanya mulai turun, atau gimana. Jadi nanti dia 10, 20, 40, 80 gitu. Yang batch size itu sama ya, misal dipakai 20 ya.
**D:** Itu bisa sih. Tapi kalau yang channel — yang dibikin biasanya jadi maksimal gitu ya — jangan dikunci di nilai maksimum sih. Jadi mulai dari bawah ya. Soalnya nanti kalau sudah mentok, yang diukur itu bukan lagi perbedaan arsitekturnya, tapi *host*-nya kehabisan CPU-nya lah.
**N:** Oke, oke. Oh, jadi bukan mulai dari paling bawah — atau dari paling bawah ke atas — tapi dari bawah, dengan atasnya diambil di tengahnya.
**D:** Betul.
**N:** Median berarti ya. Oke, jadi buat channel-nya ambil median. Kalau misalkan dari 5 sampai 50, ya berarti kamu ambilnya di… oke, jadi buat semuanya case-nya jadi 25 case. Oke, jadi udah sih buat channel sama batch-nya, udah oke di situ. Nah nanti kan ini udah dapat *value* paling bagusnya di antara itu. Nanti untuk yang ngebandingin scalability-nya — sekarang kan udah di eksperimen yang paling akhir, yang bakal eksperimen scalability. Nah rata-rata itu, kalau aku cek eksperimen yang scalability, mereka pakai TPS sih. TPS-nya dijelasin nggak — itu throughput atau apa gitu? Sebentar.

`[hening ± 00:08:58–00:13:47 — N mencari paper; audio ≈ −47 dB]`

**[13:47] N:** Entar, Kak. Sorry, sorry. Aku lagi cari paper-nya, Kak. Entar. Yang paper scalability-nya.

**[14:48] N:** Oh iya, Kak, TPS itu throughput-nya. Iya kan?
**D:** Iya.
**N:** Jadi berarti throughput itu seharusnya di *independent variable*… Oh, tapi tetap buat nge-*measure* throughput-nya tetap pakai *transaction*. Kayak ini, Kak, sorry — ini kayak ini sih: itu persentase, nah dia tetap transaksinya dari 10, 25, 50 dan seterusnya. Dia pengen melihat itu perbedaannya di mana, naik-turunnya di mana. Oke. Terus nanti yang throughput ini — ini yang di-*measure* dengan Caliper kan?
**D:** Iya.
**N:** Berarti kalau buat throughput dia *transactions*. Tapi tadi kalau buat latency, dia *peers*-nya ada berapa node-nya. Jadi beda ya sebenarnya dari yang ini. Beda kayaknya. …ini ya, oke, hmm.
**N:** Iya, kalau di paper tadi dia send rate *transaction*.
**D:** Ya udah, itu juga bisa sih.
**N:** Oke. Tapi itu udah bisa dipakai buat nge-*measure* semuanya? Jadi tabelnya nanti kayak gini — maksudnya nge-*measure* scalability. Jadi ini diganti jadi send rate atau tidak ya, terus nanti kita akan dapat throughput-nya, ini CPU utilization dan seterusnya. Tapi ini contoh untuk varian 1.

**[18:31] D:** Di dua paper tadi itu *mention* latency juga nggak?
**N:** Gimana, Kak?
**D:** Di dua paper yang tadi itu, untuk mengukur skalabilitasnya, mereka masukin latency nggak ya?
**N:** Ada sih, latency.
**D:** Nah, kamu latency bisa masukin tuh. Yang pertama kamu bisa kurva throughput kan — lewat tabel sama kurvanya. [Latency] bersoal sih, apalagi kalau di beban yang tinggi.
**N:** Beban yang tinggi itu contoh transaksi yang tinggi ya?
**D:** Iya.
**N:** Oke. Jadi nanti nggak perlu — dia perlu semua ini tetap ya? Perlu semua ini ya? Yang di tabel itu ya — yang di atas ini? Atau cuma perlu throughput sama latency. Terus nanti kan ini send rate-nya jadi *workload*-nya. Jadi lebih besar send rate-nya, lebih besar *workload*-nya — dia bisa dibilang gitu nggak, Kak?
**D:** Oke. Bisa sih. Tabelnya dipakai di bagian… bisa dipakai tabelnya, strukturnya. Kayak send rate itu dari 100–200 udah cukup. Oke, nah tapi max latency, terus dalam kurung *min–max* itu — [tidak jelas] — itu *better*. Bisa sih.
**N:** Oh jadi ini jadi 1, 2, 3, 4 — 4 kolom ya?
**D:** Iya. Nah latency-nya satu aja. Itu kan ternyata di satu kolom, yang empat tadi tuh udah ada latency kan?
**N:** Oh iya, ini udah latency ya. Oke, oke. Ini nggak usah. Oke.
**D:** CPU utilization tetap. Terus yang *success* and *failure rate* itu, satunya beda sih: yang satu jumlah, yang satu persentase.
**N:** Jadi disamain aja, salah satu aja. Sukses aja ya? Sukses itu di apa ya, gimana ya enaknya ya… [22:42 — nama disebut, tidak jelas]
**D:** …dan juga… yang *success* sama *failure* itu dihitung jumlahnya aja.
**N:** Oh jadi dua-duanya jumlah ya. Dari yang *rate* itu persen — oh jadi yang *failure rate*. Oke. Jadi soalnya dia contoh dari 100 yang dikirim itu berapa gitu — yang rata-rata per second-nya berapa yang sukses gitu ya?
**D:** Iya.
**N:** Terus *rate*-nya yang persen ya?
**D:** Betul.
**N:** Oke. Seharusnya itu aja ya.
**D:** Terus di situ ada kolom yang belum ada satuannya. Nah throughput kan TPS, latency *second*, CPU %, memory MB.
**N:** Oh iya, masing-masing ini ya, satuan/unit-nya. Oke. Ini bukan yang ini.

**[24:50] N:** Jadi tadi dia send… memory usage. Gimana, Kak?
**D:** Sebenarnya secara keseluruhan masih separuh menjawab pertanyaan tentang skalabilitasnya. Tapi tidak apa-apa. Itu bisa ditambah.
**N:** Oke, kalau dia lebih banyak, nanti *running*-nya bakal lebih lama ya buat eksperimennya, kalau ditambah.
**D:** Paling nyebutnya — kalau melihat ada send rate dan sebagainya — ini mengukur skalabilitas terhadap **beban**, gitu sih. Sama skalabilitas terhadap **case**, gitu.
**N:** Oke, oke. Jadi nanti ada dua tabel tuh, kebayang nggak? Jadi dia ada scalability untuk *workload* sama scalability untuk case, karena masing-masing case itu ini ya — channel-nya, masing-masing channel-nya.
**D:** Iya.
**N:** Oh oke, oke. Terus nanti tinggal dibikin grafiknya ya?
**D:** Betul.
**N:** Jadi berarti nanti dia ada 8 tabel, 8 grafik ya? Atau mungkin bisa ditimpa ya, Kak? Jadi nanti dibikin satu grafik buat *workload*, satu grafik buat… oh nggak bisa ya? Nggak bisa kayaknya. Kebanyakan *line*-nya soalnya.
**D:** Kamu satu grafik tapi garisnya bisa banyak gitu kan?
**N:** Iya, tapi kayaknya kebanyakan *line*-nya. Iya sih, tetap dipisahin. Aku pikirnya dia kayak gini, kelihatan kan — kalau yang satu Ethereum yang satu [Fabric]. Atau boleh sih dibikin kayak gini, tapi nanti ini dibikin varian 1, varian 2, varian 3, per throughput contoh gitu. Bisa ya, Kak?
**D:** Bisa.
**N:** Oke. Jadi paling buat sekarang aku coba langsung bikin aja dulu buat sistemnya, terus kalau udah oke aku langsung *update* ke paper-nya — *draft*-nya — biar bisa langsung dikirim ya, yang *updated* metodologinya. Soalnya itu metodologinya kayaknya banyak yang beda dengan sekarang sih.
**D:** Nggak apa-apa. Diagramnya nanti tolong diperbaiki ya.
**N:** Oke. Perbaikinya di itu ya, Kak — di apa namanya, di unit-nya ya? Sama di… itu kan ada kayak… oh, bikinnya *program diagram* sih di *draft* paper. Di *draft* paper-nya, oh aku belum ada bab ini sih, belum ada Bab 4. Tapi… oh, di Bab 3? Aku bilang datanya — presentasinya dalam diagramnya maksudnya? Oh, diagram yang ini ya, yang *experiment flow*.
**D:** Oh iya, iya. Coba. Itu perlu di-*update* dulu.
**N:** Oke, oke.
**D:** Jadi saya nanti bacanya lihat diagram sambil lihat penjelasan dari paragraf Bab 1, 2, 3. Kalau misalkan kamu sudah selesai — bukan selesai sih — kamu lagi nge-[proses] di Bab 4 gitu, nggak apa-apa.
**N:** Oke. Itu kan Kak, tadi ada total 3 eksperimen, jadi nanti masing-masing eksperimen itu beda ini ya — beda *flowchart*-nya?
**D:** Iya, boleh.
**N:** Oke, oke, sip. Oke, itu sih, itu aja.

**[29:48] N:** Itu Kak, buat di metodologi juga, aku perlu taruh spesifikasi laptop hardware-nya?
**D:** Nggak usah. Itu kalau kamu [tidak jelas]… eh, nggak perlu, nggak perlu.
**N:** Nggak perlu ya. Oke, oke.
**D:** Itu buat catatan pribadi aja.
**N:** Oh, gitu.
**D:** Iya, karena kalau di paper — coba deh kalau baca paper — itu ada nggak yang *mention* laptopnya?
**N:** Hardware ya? Hardware nggak sih. Yang *mention* hardware, mereka nggak sih. Paling nggak mereka *mention*… sebenarnya software juga mereka nggak *mention* ya?
**D:** Kadang nggak *mention* ya.
**N:** Oh berarti itu mungkin yang tabel software itu aku boleh keluarin aja juga ya?
**D:** Boleh.
**N:** Oke. Software stack-nya. Apa lagi ya?
**D:** Oh, atau kalau kamu *mention* juga nggak apa-apa sih. Software atau hardware-nya.
**N:** Dua-duanya ya?
**D:** Iya.
**N:** Oke, oke.

**[31:05] N:** Selain itu, ini untuk *flow*-nya gimana ya, Kak? Jadi nanti *submission* di Oktober awal atau Oktober pertengahan ya?
**D:** Iya, kalau bisa itu. Kamu deadline-nya tanggal berapa sih? Januari ya?
**N:** Oh, buat *enrichment* ya? *Enrichment*, sorry — iya, tesis, kalau nggak salah. Iya.
**D:** Januari itu udah final. Kalau bisa tuh berarti setidaknya Oktober atau November lah kamu udah bisa *submit* ke *conference*.
**N:** Nah, habis *submit* ke *conference* itu aku masih ada kayak — gimana ya — katanya nge-*defense* paper aku?
**D:** Oh, ada, ada. Itu nanti kemungkinan ada dua: kamu secara online, atau kamu secara offline yang ekspo [tidak jelas] itu.
**N:** Oh gitu. Itu buat *defense* paper-nya. Itu *defense* kan — kalau buat masukin ke *conference* itu juga ada *defense* juga kan, ke mereka?
**D:** Cuma, *flow*-nya tuh gini: ketika kamu *submit* paper ke *conference*, kita nunggu dulu tuh *review*-nya, setidaknya satu bulan lah setelah *submit*. Habis itu mereka kasih notifikasi *accepted* atau *reject*. Dua-duanya itu nanti ada status revisi lah. Cuman kalau udah *rejected*, ya udah kita cari *conference* lain.
**N:** Oh gitu, oke.
**D:** Ya, tapi sambil memperhatikan notulensi revisi dari konferensi yang tadi itu.
**N:** Oh, *note*-nya ya, oke.
**D:** Terus, sebelum itu — misalkan kamu *acceptance* nih — kita perlu memperbaiki paper-nya, setelah itu kamu *submit*. Terus nanti semoga di November itu ada *conference* yang kerja sama dengan BINUS, supaya kamu nggak keluar biaya.
**N:** Oke.
**D:** Nah, soalnya kalau misalkan *conference* itu nggak kerja sama dengan BINUS, kamu perlu [bayar] biaya.
**N:** Oke. *Conference*-nya di ini ya, di… nggak apa-apa. *Conference*-nya perlu yang… ada standar nggak, Kak, dari BINUS?
**D:** …ada yang terindeks Scopus.
**N:** Oke, itu ada *guidelines*-nya ya?
**D:** Ada, nanti saya coba sambil cari ya, di sekitar November itu apa gitu. Cuman kalau akhir tahun itu — November — itu udah agak jarang. Paling-paling ikut yang Desember atau Januari.
**N:** Oke. Itu *rate acceptance*-nya gimana ya, Kak?
**D:** Tergantung dari konferensinya sih. Ada yang 50%, ada yang 65%.
**N:** Oke, oke. Sama apa lagi, Kak, tadi?
**D:** Terus setelah kamu revisi kan, nah di situ kamu *resubmit*. Terus ada biaya gitu ya — oke, kalau misalkan nggak ada biaya berarti tinggal administrasi dari saya, nanti ada dokumen yang perlu di-*submit*. Terus habis itu kamu tampil di *conference*-nya. Nah, *conference* yang di Indo itu sifatnya ada dua: online — eh salah — *on-site*, atau *hybrid*.
**N:** Oh gitu.
**D:** *Hybrid* itu kamu bisa pilih online atau *on-site*.
**N:** Oke, oke.
**D:** Biasanya kalau di *conference*, pertanyaannya itu nggak terlalu susah sih.
**N:** Biasa di *conference*, orang-orang itu — orang-orang *conference* juga ya? Bukan kayak penguji gitu?
**D:** Betul.
**N:** Kayak seminar gitu ya.
**D:** Seminar kan kita nggak *submit* paper ya. Tapi kalau *conference* itu kan *submit* paper. Biasanya satu *conference* itu 100–200 paper dalam waktu 2 atau 3 hari, jadi itu padat banget waktunya.
**N:** Oh oke, oke.
**D:** Kamu hanya akan presentasi di jam yang memang kamu dijadwalin itu aja.
**N:** Oke. Nah makanya pertanyaannya itu nggak yang terlalu banyak harusnya ya. Oke. Setelah *conference*?
**D:** Nah, setelah *conference* kemudian kamu melengkapi administrasi aja sih. Terus bersiapan untuk *defense* — *defense* artikel ini ya. Sebenarnya nggak yang terlalu apa ya *defense*-nya.
**N:** Kayak itu nggak, Kak — kayak kelas *research methodology* gitu: presentasi seperti biasa, bikin PPT, terus Q&A dengan dosen?
**D:** Itu nanti kalau perlu bikin poster. Ada Q&A sama dosen juga.
**N:** Itu Q&A-nya — dosen pengujinya — semua dosen di… seberapa… gimana ya, Kak?
**D:** Satu doang.
**N:** Oh, gitu. Terus dosennya bukan dosen pembimbing?
**D:** Bukan. Yang penting kamu paham dengan apa yang kamu bikin sih.
**N:** Oke sih, oke. Terus habis itu tinggal ini ya, nyelesain dokumentasi lain. Oke. Dikasih waktu sampai semester berikutnya ya? Itu kan yang tertera di situ kan, Januari.
**D:** Oh, kalau di ini ya — di-*extend* ya. Bukan di-*extend* sih, tapi emang ada waktu khusus untuk penilaian artikel ini ya. Itu lebih panjang daripada tesis yang lain.
**N:** Oh, soalnya karena harus tunggu itu, Kak — harus tunggu *conference*?
**D:** Betul, betul.
**N:** Kalau gitu, itu terhitung aku tetap perlu ini ya — perlu tambah SKS ya?
**D:** Oh, nggak perlu.
**N:** Oh gitu.
**D:** Biasanya ini sampai Maret ya, kalau nggak ada perubahan.
**N:** Oke, sampai Maret ya?
**D:** Oh ya, sampai… antara awal Maret atau akhir Februari.
**N:** Oke.
**D:** Soalnya kan kalau kamu melihat tuh di *scoring* ada tahap 1, ada tahap 3, ada *defense*… Nah itu nanti *scoring* yang tahap 3 ini nunggu *final paper* kamu statusnya apa. Nilai kamu sesuai dengan status itu.
**N:** Oh, nilai aku sesuai dengan status aku — kalau dia *accepted* atau enggak, ke *conference*. Terus dapat nilai buat yang ini, yang *scoring* artikel ilmiah ketiga. Oke. Terus berarti *defense*, terus *research report*. Oke, itu aja sih.

**[40:10] N:** Paling ini — karena udah ada, variabelnya udah jelas, bisa langsung aku selesain ini secepatnya. Soalnya itu agak bingung juga buat variabelnya, soalnya mungkin variannya kebanyakan ya.
**D:** Iya.
**N:** Kak, buat GitHub-nya — repo-nya perlu di-*upload* ya, sistemnya?
**D:** GitHub-nya siapa nih?
**N:** Ini kan sistemnya ada — sistemnya sama *script*-nya — itu nanti di-*upload* ke GitHub ya, buat *accessibility* gitu?
**D:** Bisa aja sih. Coba. Itu nanti aja deh.
**N:** Oke. Itu paling akhir aja, nggak apa-apa ya?
**D:** Iya, nggak apa-apa.
**N:** Oke. Itu aja sih, Kak. Kakak masih ada pertanyaan nggak buat sistemnya, atau gimana gitu?
**D:** Enggak sih, nggak ada.
**N:** Oke. Oke, sip. *Thank you*, Kak. Udah lumayan malam.
**D:** Udah lumayan malam ya. Oke ya, nggak apa-apa.
**N:** Maaf ganggu ya, Kak.
**D:** Nggak apa-apa. Itu tolong dicicil ya.
**N:** Oh iya, Kak. Udah mau selesai — udah selesai sih buat Agustus. Oke.
**D (?):** Gimana [nama, tidak jelas — "Karin/Karina"]? [tidak jelas]
**N:** Oke, oke. Udah. Eh, *thank you* ya, Kak. Malam ya.

*(rekaman berakhir)*

---


---

## Appendix C — References mentioned in the chat (identified 22 Sep 2026)

| Link as sent | Identified as | Relevance |
|---|---|---|
| sciencedirect.com/…/S277248592500064X `[CHAT 05/08]` | M. Ajwalia and P. Shah, "Performance comparison of permissioned and permissionless blockchain by varying workload transaction," *BenchCouncil Transactions on Benchmarks, Standards and Evaluations*, 2025. Fabric vs Ethereum with Caliper; workloads 100–1000 TPS; throughput, latency, resource utilization, success rate. | Template for the workload-sweep (send-rate) design and the DV set. |
| mdpi.com/1424-8220/22/3/915 `[CHAT 05/08]` | D. Khan, L. T. Jung, M. A. Hashmani, and M. K. Cheong, "Empirical Performance Analysis of Hyperledger LTS for Small and Medium Enterprises," *Sensors*, vol. 22, no. 3, 915, 2022. Fabric LTS with Caliper; workload up to 1000 tx and up to 20 nodes; throughput, latency, success rate. | Precedent for per-operation tables and node/workload scaling curves. |
| arxiv.org/pdf/1703.04057 `[CHAT 05/08]` | T. T. A. Dinh, J. Wang, G. Chen, R. Liu, B. C. Ooi, and K.-L. Tan, "BLOCKBENCH: A Framework for Analyzing Private Blockchains," *Proc. ACM SIGMOD*, 2017 (arXiv:1703.04057). | Canonical private-blockchain benchmarking methodology (throughput, latency, scalability, fault tolerance). |
| doi.org/10.1109/ICRITO61523.2024.10522188 `[CHAT 24/08]` | ICRITO 2024 (IEEE). Most likely "Exploring Hyperledger Caliper Benchmarking Tool to Measure the Performance of Blockchain Based Solutions" — **verify title/authors against the PDF N obtained** before citing. | Caliper methodology reference. |
| Fabric documentation claim `[CHAT 10/09; AUDIO P1 01:46]` | Hyperledger Fabric v2.5 docs, "Performance considerations": *"In general, ensure that there is a CPU core available for each channel that is running at maximum load."* and *"if the load in each channel is not highly-correlated … the number of channels can exceed the number of CPU cores."* Also: a peer on a single channel cannot be driven beyond ~65–70% CPU due to internal serialization; multiple channels let the peer use more of its resources. | Verified 22 Sep 2026. Cite this page for the E2 core-bound and for the multi-channel throughput rationale. |

Sources: [Ajwalia & Shah 2025](https://www.sciencedirect.com/science/article/pii/S277248592500064X) · [Khan et al. 2022](https://www.mdpi.com/1424-8220/22/3/915) · [Dinh et al. 2017](https://arxiv.org/abs/1703.04057) · [ICRITO 2024 candidate](https://www.researchgate.net/publication/380584096_Exploring_Hyperledger_Caliper_Benchmarking_Tool_to_Measure_the_Performance_of_Blockchain_Based_Solutions) · [Fabric 2.5 Performance considerations](https://hyperledger-fabric.readthedocs.io/en/release-2.5/performance.html)
