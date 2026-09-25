# GLEIPNIR — Design Brief: Assets & UX

**For:** Claude Design · **From:** the GLEIPNIR thesis authors (BINUS, Cyber Security) · **Status:** brief for design, 2026-09-25

GLEIPNIR is a blockchain-based chain-of-custody system on Hyperledger Fabric 2.5 with four architecture variants
(Standard, Anchoring, Parallel, Parallel-Anchored). It has two interfaces that both need designing:

- **Web app**: the evidence library (React SPA) used by investigators, lead investigators and admins.
- **Desktop app, "GLEIPNIR Bench"**: the Windows tkinter app the authors use to run the thesis experiments E0–E3.

Please design **every asset** listed here (brand, icons, badges, illustrations, chart/table styles, print layout) plus the
UX improvements marked *(proposal)*. Each section ends with a checklist; the master checklist is at the end.

## Contents
- [1. Product context, users & hard rules](#1-product-context-users--hard-rules)
- [2. Design system foundations (shared)](#2-design-system-foundations-shared)
- [3. Brand assets](#3-brand-assets)
- [4. Web app — layout, navigation & library screens](#4-web-app--layout-navigation--library-screens)
- [5. Web app — evidence, reports, lead & admin screens](#5-web-app--evidence-reports-lead--admin-screens)
- [6. Desktop app (GLEIPNIR Bench)](#6-desktop-app-gleipnir-bench)
- [7. Data visualisation (tables & charts for the thesis)](#7-data-visualisation-tables--charts-for-the-thesis)
- [8. UX flows, states & accessibility (both UIs)](#8-ux-flows-states--accessibility-both-uis)
- [Master deliverables checklist](#master-deliverables-checklist)

---

## 1. Product context, users & hard rules

### 1.1 How to use this brief

This brief covers every visual asset and UX pattern for the two GLEIPNIR interfaces. **Read this section first.** It sets the product context, the users, the tone and the non-negotiable rules. The later sections cover foundations (tokens), web assets, desktop assets, data visualisation, and copy. If a later section conflicts with a hard rule in §1.5, the hard rule wins.

#### 1.1.1 What you are asked to deliver

1. **Design tokens** as `tokens.json` (the source of truth) and `tokens.css` (CSS custom properties on `:root`, with a dark set, a light set, and a print override). Token names follow the foundations section, for example `--color-variant-standard` and `--color-success`.
2. **Brand assets**: wordmark, mark, app icon, favicon set.
3. **Web assets** for the evidence-library SPA (`frontend/`): icons, badges (operation type, status, Merkle verification, role), empty-state and error illustrations, login art, and the look of the printable court report.
4. **Desktop assets** for the benchmark app (`orchestration/benchapp.pyw`, Tkinter/ttk on Windows): toolbar and tab icons, the circled "?" hover-help icon, status glyphs for the Run panel, and the window/taskbar icon.
5. **Data-visualisation specs** for the thesis figures rendered by `orchestration/report.py` (matplotlib): the variant palette, line styles, markers, axis/label typography, and table styling.
6. **UX specifications** (annotated screens, states, interaction notes) for every page and tab named in the later sections.

Every asset needs these fields: what it is, where it appears (real page/tab/component name), why it exists, its states/variants, its size and format, its constraints, and its priority.

#### 1.1.2 Priorities

| Priority | Meaning | Rule of thumb |
|---|---|---|
| **P0** | Must-have. The UI is broken, misleading or unprofessional without it. | Ship P0s first, as one consistent set. |
| **P1** | Should-have. Clear usability or credibility gain. | Deliver after the P0 set is complete. |
| **P2** | Nice-to-have. Polish. | Only if time allows. Never at the expense of a P0/P1. |

#### 1.1.3 Asset IDs

- Prefixes: `brand-` (identity), `web-` (evidence-library SPA), `desk-` (benchmark desktop app), `viz-` (charts, figures, tables), `sys-` (cross-cutting system deliverables such as tokens and manifests).
- After the prefix, use kebab-case: `web-icon-download`, `web-badge-op-transfer`, `desk-icon-run`, `brand-app-icon`, `viz-line-style-parallel-anchored`.
- An ID is permanent once issued. Do not rename it. If an asset is dropped, mark it "withdrawn" and keep the ID.

#### 1.1.4 File naming

`gleipnir-<id>@<scale>.<ext>`

- `<id>` is the asset ID without changes, for example `gleipnir-web-icon-download@1x.svg`.
- `<scale>`: `1x`, `2x` (bitmaps). Use `1x` for vector files too, so every name has the same shape.
- Where one ID has several pixel sizes (desktop icons), put the size before the scale: `gleipnir-desk-icon-run-16@1x.png`, `gleipnir-desk-icon-run-16@2x.png`.
- Lowercase only. No spaces. No version numbers in file names (version control handles that).

#### 1.1.5 Delivery folder layout

```
gleipnir-design/
├── tokens.json                 # source of truth (colour, type, space, radius, elevation, motion)
├── tokens.css                  # :root custom properties; dark + light + @media print sets
├── MANIFEST.md                 # one row per delivered file: ID, file, priority, notes (proposal)
├── brand/                      # wordmark, mark, app icon master (SVG), favicon set
├── web/
│   ├── icons/                  # SVG, 24×24 grid, currentColor strokes
│   ├── illustrations/          # SVG empty/error/login illustrations
│   └── badges/                 # SVG badge specs + an HTML/CSS reference sheet
├── desktop/
│   ├── icons/                  # PNG @1x at 16, 20, 24 px + @2x (32, 40, 48 px)
│   └── app-icon.ico            # multi-resolution: 16, 20, 24, 32, 40, 48, 64, 256
└── viz/                        # matplotlib style spec (palette hex, line styles, markers, fonts) + sample figures
```

#### 1.1.6 Deliverable format constraints (summary; full rules in §1.5)

- **Web:** SVG icons and illustrations. The files must work when served from the same origin, with no remote references (§1.5.4). Icons use `currentColor` so they follow token themes.
- **Desktop:** Tk 8.6 cannot render SVG natively. Deliver PNGs with a transparent background at every listed size. Also deliver the SVG masters so the icons can be re-exported.
- **Figures:** hex values for matplotlib, and a style spec that the authors can copy into `report.py`. Every figure must still read correctly in greyscale print (§1.5.6).

### 1.2 Product context

#### 1.2.1 What GLEIPNIR is

GLEIPNIR is a **blockchain-based chain-of-custody (B-CoC) system** built on **Hyperledger Fabric 2.5 LTS** and run locally in Docker. Two authors from BINUS (Cyber Security) built it for their undergraduate thesis. It exists to **measure a trade-off**: what does Merkle anchoring buy in latency and ledger storage, and what does it cost in verification/audit latency, compared with writing every audit event on-chain?

To answer that, it runs **four architecture variants** on one Fabric substrate. The chaincode interface, the client API and the Caliper workloads are identical across all four. **Only the way audit events reach the ledger changes:**

| Variant (exact name) | Write path in one line |
|---|---|
| **Standard** | One shared channel; one transaction per audit event. The comparison baseline. |
| **Anchoring** | One channel, plus an off-chain Merkle batcher and receipt store. Only the Merkle root goes on-chain. |
| **Parallel** | One Fabric channel per case. |
| **Parallel-Anchored** | One channel per case with per-case Merkle batching. An off-chain anchor-client commits the per-case roots to a dedicated **anchor channel**. |

The chaincode has exactly four operations: `CreateEvidence`, `TransferCustody`, `AccessLog` and `DisposeEvidence`. Their operation-type tags are `CREATE`, `TRANSFER`, `ACCESS` and `DISPOSE`. `DisposeEvidence` is a terminal status change to **`DISPOSED`**; **nothing is deleted**. Evidence files are always stored off-chain. Only records and proofs go on-chain. Each evidence file's integrity proof is an ni-URI (RFC 6920) hash.

#### 1.2.2 Brand metaphor: the fetter Gleipnir (proposal)

In Norse myth, **Gleipnir** is the fetter the dwarves forged to bind the wolf **Fenrir**. It was made from impossible things (the sound of a cat's footfall, the roots of a mountain, and so on). It was as thin and soft as a silk ribbon, yet it could not be broken, where iron chains had failed.

We suggest this as the core brand metaphor: **an unbreakable binding = an unbroken chain of custody.** Ways to use it:

- **The mark:** a single continuous ribbon or cord that loops or knots, with no break in the line. Links or knots can echo Merkle-tree nodes or a chain of custody records. Keep it abstract and geometric. It should read as a forensic tool, not fantasy art.
- **The idea of "thin but unbreakable":** light strokes and quiet surfaces, with structural strength. This fits a system whose strength comes from cryptographic structure, not visual weight.
- **Avoid:** wolves, runes, Viking ornament, gore, "epic" fantasy styling, and anything playful or mythic that would weaken credibility in court or in a thesis defence. A small, optional nod (a ribbon-knot motif on the login screen or the empty states) is the upper limit.
- The product name is always set as **GLEIPNIR** (all caps) in the wordmark and UI chrome. The existing window and tab titles already use it: the browser `<title>` is `GLEIPNIR`, and the desktop window title is `GLEIPNIR Bench — E0 · E1 · E2 · E3`.

#### 1.2.3 The two interfaces

| | **(1) Web app: the evidence library** | **(2) Desktop app: the benchmark console** |
|---|---|---|
| Code | `frontend/` (React 18, react-router v6, Vite, TypeScript, served by nginx; UI kit in `frontend/src/components/ui`: `Badge`, `Modal`, `Stepper`, `Tabs`, `Timeline`; styles in `frontend/src/styles.css`) | `orchestration/benchapp.pyw` (Python 3.11, Tkinter/ttk, Windows); logic in `benchcore.py`; hover texts in `benchhelp.py`; charts from `orchestration/report.py` (matplotlib) |
| Job | Manage digital evidence under chain of custody: log in, cases, ingest with real file upload, evidence detail with the custody audit trail and a Merkle verification badge, preview/download/export, search, lead dashboard, admin users and case admin, printable chain-of-custody court report | Run the thesis experiments and read the results: E0 (smoke + ramp), E1 (batch size), E2 (channels), E3 (E3a send rate / E3b cases / per-operation), Custom test, History & results with CSV export, live Run panel, suggested baselines, backup/restore of the authors' test data |
| Talks to | **Only** the API gateway (`/api/v1/...` through the same-origin nginx proxy). Never to Fabric directly. | The host shell: `orchestration/experiment.py` and the Docker stack |
| Navigation (real labels) | Sidebar: **Ingest evidence**, **My cases**, **Search**; lead-only **Dashboard** (`/lead/dashboard`); admin-only **Users** (`/admin/users`), **Case admin** (`/admin/cases`). The CoC report is rendered **outside** the app shell, with a **Print / save as PDF** button. | Notebook tabs: **Settings & Baselines**, **E0 initial test**, **E1 batch size**, **E2 channels**, **E3 main**, **Custom test**, **History & results**. A **Run** panel beside them (**Cancel**, "verbose Caliper output", "show raw log"). Tab header hint: "(hover the ? icons for details)". |
| Current look | Dark theme by default (`--bg`, `--panel`, `--card`, `--line`, `--text`, `--muted`, `--accent`, `--ok`, `--bad`), with a light `@media print` reset | Stock ttk. Pale-yellow tooltip. The "?" icon is drawn on a canvas in Segoe UI 8 bold. |
| Removed, do NOT design | The old operator dashboard (`DashboardPage`, the admin run-request console) was **removed in M27**. The web app does not run benchmarks. | n/a |

#### 1.2.4 Users and personas

**Web app**: three system roles. The wire values are `admin` | `lead` | `investigator`, and the display labels come from `frontend/src/roles.ts`. Separately, per-case roles are **Viewer**, **Contributor** and **Case Lead**.

| Persona | Display label | Goals | Key screens | Design implications |
|---|---|---|---|---|
| Investigator | **Investigator** | Ingest exhibits correctly, see who touched what and when, prove an exhibit is unaltered, export for a report | Ingest evidence, My cases, case detail, evidence detail (evidence card, custody audit trail, Merkle badge), Search | Opening evidence detail writes an `ACCESS` (view) event to the trail automatically, so the UI must never hide that viewing is logged. Verification state must be readable at a glance. |
| Lead investigator | **Lead Investigator** | Oversee a case team, monitor custody activity, produce the court report | Dashboard (`/lead/dashboard`), case detail, CoC report | Needs overview density: activity feeds and per-case status. The court report must look fit for a courtroom. |
| System administrator | **System Administrator** | Manage accounts (deactivate, never delete), create cases, grant roster access, categorise | Users, Case admin | Destructive-looking actions are rare and deliberate. `CasesAdminPage` still uses raw inputs and tables (see U4). Design kit-consistent versions (proposal). |

**Desktop app**:

| Persona | Goals | Design implications |
|---|---|---|
| The two thesis authors, as benchmark operators | Configure and launch long experiment campaigns, watch a run live, catch failures early, accept suggested **baseline** values, export CSVs, back up and restore their hand-built test data | Expert users working under time pressure. Runs are long and costly, so a run that is running, failed, cancelled or finished must be obvious from across the room. Destructive operations (ledger reset, restore) need unmistakable warning states. The "?" help must be discoverable without cluttering the layout. |

**Secondary audience (never logs in):**

| Audience | What they see | Design implications |
|---|---|---|
| Thesis supervisor, examiners, readers of the paper and conference audience | Screenshots of both UIs, matplotlib figures and result tables in the paper, the printed CoC court report | Everything must survive greyscale printing, reduction to column width and projector washout. Terminology must match the paper exactly (§1.5.1). Figures follow the supervisor's table and graph rules (§1.5.3). |

#### 1.2.5 Tone

**Forensic, trustworthy, calm, precise, academic.**

- **Forensic:** exact values, explicit units, explicit time zone, visible provenance. Show the evidence, not an adjective. "VERIFIED" with a hash beats "Looks good!"
- **Trustworthy:** stable, consistent, no dark patterns, and no decoration that could be read as hiding something. Colour always has a text or icon backup.
- **Calm:** restrained palette and low-saturation surfaces. Reserve strong colour for status (`--color-success`, `--color-danger`, `--color-warning`) and for the four variant colours in charts. No celebratory animation, no confetti, no playful mascots.
- **Precise:** tabular numerals and monospaced hashes/IDs (the SPA already has a `.mono` class). Align decimals. Never truncate a hash without an accessible full value.
- **Academic:** figures and tables look like a well-typeset paper. They are not marketing dashboards.

### 1.3 What the evidence and the numbers look like

These are real value shapes the designs must accommodate:

- **Identifiers:** evidence IDs (UUIDv4), library case IDs `CASE-<uuid>`, Parallel-variant channel routing keys `case-NNN` (a different namespace; never show them as the same thing), Fabric tx IDs, ni-URI hashes (`ni:///sha-256;...`), Merkle roots and sibling paths (hex).
- **Operation types:** `CREATE`, `TRANSFER`, `ACCESS`, `DISPOSE`. **Status** includes `DISPOSED` (a terminal state, not a deletion).
- **Merkle badge** (`MerkleBadge.tsx`): currently renders `Merkle: VERIFIED` or `Merkle: MISMATCH`. The design must also cover a pending/not-yet-anchored state and a not-applicable state (the Standard and Parallel variants store per-event records on-chain) (proposal).
- **Regime labels** (benchmark output): **smoke** (E0 functional check only, stored under `results/e0/`), **steady** (≥ 10³ cumulative write events per channel; the only regime reported as performance), **sub-floor** (below the steady floor). All three must be visually distinct, and smoke data must never be styled like benchmark data.
- **Failure classes:** `MVCC_READ_CONFLICT`, `ENDORSEMENT_POLICY_FAILURE`, `TIMEOUT`, `HTTP_4XX`, `HTTP_5XX`, `OTHER`.
- **Experiment grids** (from `benchmark/sweeps.yaml`): batch sizes 10, 25, 50, 100, 200; channel counts 5–50; send rates 10–200 tx/s; case counts 5–50; 3 repetitions per cell (mean ± SD).

### 1.4 Out of scope for design

- The removed web operator dashboard, and any web page that starts or configures benchmark runs.
- Any "on-chain file storage" affordance. Evidence files are always off-chain.
- Any hardening UI for the receipt store (signatures, replication or hash chains on receipts). Its weaker guarantee is a measured finding of the thesis and must not be visually "fixed".
- Public-chain anchoring, OpenTimestamps, CASE/UCO export, IoT ingestion, cross-channel evidence transfer. Do not draw affordances for these.
- Mythic or fantasy illustration beyond the restrained metaphor in §1.2.2.

### 1.5 Hard rules

These rules are **binding** for every asset, label, mock-up, sample figure and placeholder string, including lorem-style filler. A mock-up that breaks one of them cannot go into the thesis screenshots.

#### 1.5.1 Terminology

| Rule | Correct | Never |
|---|---|---|
| Cross-channel root sink | **anchor channel** (or **audit channel**) | "system channel", anywhere: labels, tooltips, diagrams, file names |
| Calibrated constants | **baseline** (baseline batch size, baseline channel count, baseline send rate) | "optimal", "best", "ideal", "recommended optimum" |
| Load dimension | **send rate** = the CONFIGURED input (offered load) | "TPS" as a noun for the input; "rate" alone where ambiguous |
| Output dimension | **throughput** = the MEASURED output (successful-only) | "TPS" as a noun for the output |
| Units | **TPS** or **tx/s** only as a unit after a number or in a column header, e.g. "Throughput (TPS)", "50 tx/s" | "the TPS was…", "TPS test" |
| Operation dimension | **transaction type** / **operation type** | "TPS type", "tx kind" |
| Variant names | Exactly **Standard**, **Anchoring**, **Parallel**, **Parallel-Anchored** (with the hyphen and this capitalisation, in this order in legends and tables) | "Anchored", "Anchoring Parallel", "Parallel Anchoring", "PA" in user-facing copy (abbreviations are allowed only in space-constrained chart ticks, with a key) |
| Disposal | **DisposeEvidence** / **DISPOSED** / "Dispose"; nothing is deleted | "Remove", "Delete", "Destroy", a trash-can icon for disposal |
| Accounts | **Deactivate** (users are never deleted) | "Delete user" |
| Reference schema | Describe the evidence card as an "evidence card" / "Codex Entry-inspired record" | The word **lockb0x** in any form, anywhere, including file names, layer names and comments in delivered files |
| Stack | "Blockchain-Based", "on Hyperledger Fabric 2.5 LTS" | Any other platform label on diagrams |
| Regimes | **smoke**, **steady**, **sub-floor** | Styling or captioning smoke or sub-floor data as steady-state performance |

#### 1.5.2 Copy

- Use sentence case for UI labels, matching the existing labels ("Ingest evidence", "My cases", "Case admin"). The product name is **GLEIPNIR**.
- Keep the real labels from the code exactly as written. Where you propose new copy, mark it **(proposal)**.
- Error messages state what happened, why if known, and what to do next. Show failure classes by their exact code (`MVCC_READ_CONFLICT`), with a plain-language gloss beside it.
- Wherever viewing or generating something writes to the trail (evidence detail view, preview, download, export, CoC report), say so in plain words, e.g. "Opening this exhibit is recorded in its custody trail." (proposal).
- No marketing voice, no exclamation marks, no emoji.

#### 1.5.3 Data display

- **Timestamps:** always `YYYY-MM-DD HH:mm:ss UTC`, e.g. `2026-07-21 08:02:54 UTC`. The web app does this through `formatTs()` (`frontend/src/lib/format.ts`). The full ISO value, milliseconds included, goes in a tooltip (`title`). Empty values show an em dash (—). Never use per-locale date strings or relative-only times ("3 min ago" may appear only next to the absolute timestamp). Desktop tables follow the same format. The existing column header already reads "started (UTC)".
- **Units in every column header and axis label:** Throughput (TPS), Send rate (tx/s), Latency (s), CPU (%), Memory (MB), Ledger size (MB), Byte per log (B), Failure rate (%), Audit reconstruction time (s), Anchoring delay (s), Verification latency (s), Batch size (events), Channels (count), Wall (min).
- **Repetitions:** values from r = 3 repetitions are shown as **mean ± SD**, e.g. `48.7 ± 1.2`.
- **Latency in result tables:** **one column**, average with (min–max) in parentheses, e.g. `0.84 (0.31–2.10)`. p95, p50 and p99 go in the text or an appendix table. Supervisor guidance §3.7.
- **Success/failure:** success as a **count**, failure as a **count**, plus **failure rate (%)**.
- **Throughput:** successful-only. For Parallel and Parallel-Anchored, show both per-channel and aggregate throughput.
- **Storage:** show compression as the reduction in log-**payload** bytes vs Standard, **with** the off-chain receipt-store bytes shown alongside. Never present it as a clean 1/N of total ledger size.
- **Anchored-variant REST latency** is enqueue latency. Label it as such.
- **Anchoring delay:** report forced batches separately from regular ones.
- **Graphs:** a separate chart per metric, one line per variant (supervisor guidance §3.7). Show latency next to the throughput curve. Mark the saturation point (successful throughput < 0.9 × configured send rate).
- **Numbers:** tabular (monospaced-width) numerals and consistent decimals per column. Put hashes and IDs in a monospace face. When you truncate one visually, the full value must stay selectable and copyable.
- **Colour is never the only carrier of meaning.** Each variant has a colour **and** a line style **and** a marker. Each status has a colour **and** an icon **and** a text label.
- **CSV export (desktop):** there is an option "decimal comma (; separated — Indonesian Excel)". Previews must show that numbers keep their format when it is on.

#### 1.5.4 CSP and self-hosting (web)

The SPA is served by nginx with this Content-Security-Policy (from `frontend/nginx.conf`, quoted exactly):

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; frame-src blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; connect-src 'self'
```

It also sends `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`. What this means for design:

- **Everything is self-hosted.** No Google Fonts, no icon CDNs, no remote images, no remote CSS. Fonts fall under `default-src 'self'`, so they must ship as local WOFF2 files with licences that allow self-hosting and redistribution (SIL OFL or similar). If you name a typeface, name one we can bundle.
- **Images** can come from same-origin files, `data:` URIs or `blob:` URLs only. SVG icons must be self-contained: no external `<use href>` to other origins, no embedded remote fonts, no `<script>` inside SVG.
- **No inline scripts**, so no designs that depend on inline JS snippets or third-party widgets (analytics, chat, embeds).
- **Evidence preview** uses `blob:` in an iframe/img/video/audio. Preview frames must be designed as same-page panels. The app can never be framed and never opens `target="_blank"` popups.
- **Styles:** inline styles are allowed (Recharts needs them). Deliver design tokens as CSS custom properties in `tokens.css` all the same.
- **Desktop and figures:** Tkinter has no web fonts. Design for **Segoe UI** (the UI face already used) and a system monospace such as Consolas. For matplotlib figures, name a font available on Windows and in the WSL/Ubuntu build, or one we can bundle. Say which.

#### 1.5.5 Accessibility baseline

Target **WCAG 2.2 AA** for the web app and the same contrast rules for the desktop app. These rules come from `docs/audit/ux-review.md` (U1–U4) plus the standard baseline:

| Ref | Requirement | Source / status in code |
|---|---|---|
| **U1** | One fixed, timezone-explicit timestamp format, `YYYY-MM-DD HH:mm:ss UTC`, with the exact ISO value in a `title` tooltip and an em dash for empty values. Designs must never introduce another date format. | Fixed via `formatTs()` in all render sites, including `AuditTrailTimeline`, `SessionTrail` and `CoCReportPage` |
| **U2** | UI-kit keyboard/AT behaviour is part of the design, not an afterthought: **Tabs** use a roving `tabIndex` plus Arrow/Home/End keys, with activation following focus (WAI-ARIA tablist). **Stepper** marks the active step with `aria-current="step"`. **Modal** moves focus in on open, restores it to the opener on close, and has `aria-labelledby` pointing to its title. There is deliberately **no focus trap** (ARCHITECTURE §5). Designs must show focused, active and disabled states for every kit component. | Fixed |
| **U3** | Design only styles that map to real components. Do not re-introduce patterns from the retired single-page demo (`.scopes`, `.token`). `.chip` / `.chip.active` are still in use (category chips, flag chips). | Fixed |
| **U4** | `CasesAdminPage` predates the UI kit and uses raw inputs, tables and buttons. Designs should show a kit-consistent version (`Tabs`, `Badge`, `Modal`) (proposal). (`DashboardPage` from U4 has since been removed. Do not design it.) | Documented debt |
| A1 | Contrast: text ≥ 4.5:1 (≥ 3:1 for large text). Non-text UI (borders of inputs, icons that carry meaning, focus rings, chart lines against the plot background) ≥ 3:1. Must hold in the dark theme, the light/print theme and greyscale. | Baseline |
| A2 | Visible keyboard focus on every interactive element: at least 2 px and ≥ 3:1 against adjacent colours. (The login input currently uses `outline: none` plus a 3 px translucent `--accent` box-shadow. The replacement ring must still meet 3:1.) | Baseline |
| A3 | Status is never shown by colour alone: icon, text and colour together (Merkle VERIFIED/MISMATCH, operation-type badges, regime labels, run state). | Baseline |
| A4 | Targets at least 24 × 24 CSS px (WCAG 2.5.8). Prefer 32 px for primary actions. | Baseline |
| A5 | Respect `prefers-reduced-motion`. Motion is optional and functional only (e.g. a progress indicator). | Baseline |
| A6 | Icons that carry meaning get an accessible name (label text or `aria-label`). Decorative icons and illustrations are `aria-hidden`. On the desktop, every "?" icon is backed by a text tooltip from `benchhelp.py`. | Baseline |
| A7 | Layout holds at 200 % zoom and on a 1366 × 768 laptop screen (the authors' hardware class). The desktop app must stay usable at Windows 125 % and 150 % scaling, hence the @2x PNGs. | Baseline |

#### 1.5.6 Print

- The **Chain-of-Custody court report** (`CoCReportPage`) prints through the browser's print-to-PDF ("Print / save as PDF"). There is no PDF library. The existing `@media print` reset turns the page light (white background, dark text, `--line` #999). It hides `.no-print`, the top bar, the sidebar, the footer and all buttons, and keeps cards together (`break-inside: avoid`). Design the report as a **printed legal document first**: A4 and US Letter, black-and-white safe, with the page header/footer carrying the case ID, the generation timestamp (UTC) and page X of Y (proposal). No dark backgrounds, no colour-only meaning, no content that depends on hover.
- Generating the report writes one `ACCESS` (`coc-report`) event per exhibit. The printed report should state this (proposal).
- **Thesis figures and tables** must read in greyscale at single-column width (about 8.5 cm) and at double-column width (about 17.5 cm). Deliver them as vector PDF/SVG where possible, plus PNG at 300 dpi. Variant lines differ in line style and marker as well as colour.
- **Screenshots of either UI** that go into the paper should come from the light theme or a print-safe capture mode (proposal), so they do not become black blocks on paper.

### 1.6 Assets in this section

These cover the whole brief. The per-UI assets are defined in the later sections.

| ID | Category | Where used | Purpose | Variants / states | Size & format | Priority |
|---|---|---|---|---|---|---|
| sys-tokens-json | System / tokens | Source for `tokens.css`, the SPA (`frontend/src/styles.css`), the desktop app (Tk colour constants) and `report.py` (matplotlib palette) | One source of truth for colour, type, spacing, radius, elevation and motion tokens across both UIs and the figures | Dark theme, light theme, print override, greyscale-check annotations | JSON (W3C Design Tokens format), `tokens.json` at the delivery root | P0 |
| sys-tokens-css | System / tokens | Imported by the SPA, replacing the hard-coded `:root` values (`--bg`, `--panel`, `--card`, `--line`, `--text`, `--muted`, `--accent`, `--ok`, `--bad`) | Makes the tokens usable under the CSP (self-hosted CSS, no remote references) | `:root` (dark default), `[data-theme="light"]` (proposal), `@media print` | CSS custom properties, `tokens.css` | P0 |
| sys-terminology-sheet | System / copy | Reference for the designer, the authors and every mock-up | One-page do/don't list of the §1.5.1 terms (anchor channel, baseline, send rate vs throughput, variant names, DISPOSED, no lockb0x) so no mock-up breaks a rule | Single sheet, printable | PDF or SVG, A4, plus Markdown source | P0 |
| sys-data-format-spec | System / data display | Tables and charts in both UIs and the thesis figures | Specimen sheet of the §1.5.3 rules: timestamp `YYYY-MM-DD HH:mm:ss UTC` with ISO tooltip, units in headers, mean ± SD, one latency column avg (min–max), failure counts plus rate (%), hash/ID monospace and truncation | Web table, desktop Treeview, printed table | SVG or PDF specimen, A4 | P0 |
| sys-a11y-contrast-report | System / accessibility | Delivered with the tokens | Proves every foreground/background token pair in dark, light and print meets A1/A2 (≥ 4.5:1 text, ≥ 3:1 non-text and focus) and that the variant palette separates in greyscale | Dark, light, print, greyscale simulation, deuteranopia/protanopia simulation | Markdown or PDF table, one row per token pair | P1 |
| sys-delivery-manifest | System / delivery | `MANIFEST.md` at the delivery root | Maps every delivered file to its asset ID, priority and status, so the authors can check nothing is missing | One row per file, status delivered/withdrawn | Markdown table (proposal) | P1 |
| brand-metaphor-moodboard | Brand / direction | Early review with the authors before the mark is drawn | Tests the Gleipnir fetter metaphor (continuous ribbon or knot = unbroken chain of custody) against the forensic/academic tone before committing to it | 2–3 directions (abstract ribbon, knot/link, Merkle-node lattice) | One PDF or PNG board, 1920 × 1080 | P2 |

### Checklist

- [ ] sys-tokens-json — source-of-truth design tokens (dark, light, print) for web, desktop and figures
- [ ] sys-tokens-css — CSS custom-property build of the tokens, self-hosted and CSP-safe, replacing the hard-coded `:root` values
- [ ] sys-terminology-sheet — one-page do/don't list of the binding terminology rules
- [ ] sys-data-format-spec — specimen sheet for timestamps, units, mean ± SD, avg (min–max) latency, failure counts/rate, hashes
- [ ] sys-a11y-contrast-report — contrast and greyscale/colour-blind check of every token pair and the variant palette
- [ ] sys-delivery-manifest — `MANIFEST.md` mapping every delivered file to its ID, priority and status (proposal)
- [ ] brand-metaphor-moodboard — 2–3 directions testing the Gleipnir fetter metaphor against the forensic tone

---

## 2. Design system foundations (shared)

This section sets the shared visual language for both UIs: the **web app** (`frontend/`, React evidence library + printable chain-of-custody court report) and the **desktop app** (`orchestration/benchapp.pyw`, Tk/ttk on Windows, with matplotlib charts from `orchestration/report.py`). Every later section refers to the token names defined here. This is the only section of the brief that gives raw hex values.

### 2.0 What exists today (read from the code)

| Where | Current value | Used for | Problem |
|---|---|---|---|
| `frontend/src/styles.css :root` | `--bg #0f1720`, `--panel #17212b`, `--card #1e2a37`, `--line #2b3a49`, `--text #e6edf3`, `--muted #8ba0b3`, `--accent #4f86c6`, `--ok #4caf50`, `--bad #e05d44` | The web app is dark only. A light palette exists only under `@media print` (`--line #999`, `--text #111`, `--muted #444`). | There is no light screen theme. The screen and print palettes are different systems. |
| `styles.css` (hard-coded) | `#223449` (`.chip.active`, `.sidebar a.active`, `.clickable:hover`), `#5f96d6` (`.login-submit:hover`), `rgba(79,134,198,0.22)` (login focus glow), `#c9a227` (`.op-access`, `.badge.tone-warn`), `#6cae75` (`.op-create`), `#4f86c6` (`.op-transfer`) | Selected, hover, focus, operation-type and warning colours | These literals are not tokens. `.op-dispose` uses `--bad` (red), so a legitimate terminal custody action looks like an error. |
| `styles.css` | `font: 14px/1.5 system-ui, sans-serif`, `.mono { font-family: ui-monospace, monospace }` | All text | No brand font and no tabular numerals. |
| `styles.css` | radii 4 / 6 / 7 / 8 / 12 / 999 px; shadows `0 18px 48px rgba(0,0,0,.45)` (login), `0 12px 40px rgba(0,0,0,.5)` (`.modal`) | Inputs, buttons, cards, login, pills | 7 px is a stray value. The shadows were tuned for dark backgrounds only. |
| `styles.css` | `button:disabled { opacity: 0.45 }` | Disabled state | Opacity-only disabled state, and there is no `:focus-visible` style anywhere except the login input glow. |
| `benchapp.pyw` | `#b00` (dirty or unsaved status, `e3_warn`, log tag `err`), `#060` (saved status), `#a60` (`p_warn`, log tag `warn`), `#777` (hints, provenance, log path), `#555` (notes, floor hint), `#036` (read-only baseline values), `#ffffe8` (tooltip background), `#000000` (help icon) | Status text, hints, the tooltip and the help icon | `#777` on the native vista background `#F0F0F0` is **3.9 : 1, which fails WCAG AA** for text. |
| `benchapp.pyw` | `("Segoe UI", 9)` (tooltip), `("Segoe UI", 10, "bold")` (tab headline), `("Segoe UI", 8, "bold")` (help "?"), `("Consolas", 9)` (log and preview dialogs), `ttk.Style().theme_use("vista")` | Fonts and theme | No named-font map; the sizes are scattered literals. |
| `benchapp.pyw` | `#3a78c2` | Cited in the brief | Not found in the current code. Treat it as retired and do not reuse it. |
| `report.py` | matplotlib default colour cycle; `marker="o"` for every variant; `label=v` (the raw slug, e.g. `parallel-anchored`); `y = x (send rate)` line in `grey`, dotted; saturation `axvline` dotted 0.8 with **no colour set**, so it takes the next cycle colour; E1 reference lines `"--"` 1 px; `grid alpha 0.3`; `figsize (6.4, 4.2)`; `dpi 130`; legend `fontsize 8` | Charts | Colour follows cycle order, not the variant. A chart without Standard therefore shifts every colour. All markers are identical, so the charts do not survive grayscale print. |

### 2.1 Principles

1. **One palette, two renderers.** The same hex values reach CSS custom properties (web), ttk styles and Tk literals (desktop), and matplotlib (charts). Every value has exactly one source: `tokens.json`.
2. **Variant colour belongs to the four variants.** The four variant hues are the only chromatic series colours in charts. Semantic colours (success, warning, error, info) never appear as chart series, and variant colours never signal status.
3. **Colour is never the only channel.** Every variant has a colour, a marker shape, a line style and a bar hatch. Every status has a colour, an icon and a text label. Every regime has a colour, a border style and a text label.
4. **Light is the default theme on both UIs.** The desktop's native vista theme, the printed court report and the thesis figures are all light. Dark is an opt-in web theme (§2.9).
5. **The data vocabulary is fixed.** Variant names are exactly **Standard**, **Anchoring**, **Parallel** and **Parallel-Anchored**. Regimes are **smoke**, **steady** and **sub-floor**. Run statuses are **complete**, **failed** and **running**. Send rate is the configured input; throughput is the measured output. "TPS" and "tx/s" appear only as units. Timestamps use `YYYY-MM-DD HH:mm:ss UTC`. Aggregates are shown as mean ± SD.

### 2.2 Colour tokens (light theme, the default)

All contrast ratios below are WCAG 2.x relative-luminance ratios. The thresholds are 4.5 : 1 for body text, 3 : 1 for large text (≥ 18.66 px bold or ≥ 24 px) and for non-text UI or graphics (1.4.11). "Page" means `--color-surface-page` (`#F7F8FA`). "Desk" means the native vista window background `#F0F0F0`, which Tk draws and we do not control.

#### 2.2.1 Brand

| Token | Hex | Use | Contrast (ratio : 1) |
|---|---|---|---|
| `--color-brand-primary` | `#2F3E9E` | Primary buttons, active nav indicator, links, the GLEIPNIR wordmark, info, focus ring | 9.1 on white · 8.0 on desk · white text on it 9.1 |
| `--color-brand-primary-hover` | `#26327F` | Hover state of primary actions | 11.3 with white text |
| `--color-brand-primary-active` | `#1E2866` | Pressed state of primary actions | 13.4 with white text |
| `--color-brand-primary-tint` | `#EEF0FA` | Selected rows and nav items, info backgrounds | Background only |
| `--color-brand-secondary` | `#475467` | Secondary buttons (outline), secondary emphasis, the wordmark subtitle | 7.7 on white |
| `--color-on-brand` | `#FFFFFF` | Text and icons on brand-primary fills | See above |

The brand primary is an indigo, chosen to be clearly distinct from the cyan-blue of `--color-variant-standard`. The brand secondary is a neutral slate, deliberately without a hue, so that the variants own all chromatic colour in charts.

#### 2.2.2 Neutrals

| Token | Hex | Contrast on white (ratio : 1) | Use |
|---|---|---|---|
| `--color-neutral-0` | `#FFFFFF` | — | Panels, inputs |
| `--color-neutral-50` | `#F7F8FA` | — | Page background |
| `--color-neutral-100` | `#EEF0F3` | — | Hover background, sunken areas, disabled fill |
| `--color-neutral-200` | `#DDE1E7` | 1.3 | Subtle dividers, pressed background |
| `--color-neutral-300` | `#C4CAD3` | 1.7 | Decorative rules, chart grid (dark end) |
| `--color-neutral-400` | `#98A1AE` | 2.6 | Disabled text and icons (exempt from contrast rules) |
| `--color-neutral-450` | `#8A94A2` | 3.1 | Form-control borders (meets 1.4.11) |
| `--color-neutral-500` | `#626C7A` | 5.3 (5.0 page, 4.7 desk) | Muted text, hints, timestamps (replaces desktop `#777`) |
| `--color-neutral-600` | `#525C6B` | 6.8 (6.5 desk) | Secondary text, notes (replaces desktop `#555`), chart axes |
| `--color-neutral-700` | `#3A4350` | 10.3 | Strong secondary text |
| `--color-neutral-800` | `#252C36` | 14.1 | Steady regime chip fill, DISPOSED operation colour |
| `--color-neutral-900` | `#151A21` | 17.5 (15.3 desk) | Primary text, help icon, tooltip text |

#### 2.2.3 Surfaces, text and borders (semantic aliases)

| Token | Maps to | Notes |
|---|---|---|
| `--color-surface-page` | neutral-50 `#F7F8FA` | Web body background. On desktop the window uses the native `#F0F0F0` (alias `--color-desk-surface`), which we do not recolour. |
| `--color-surface-panel` | neutral-0 `#FFFFFF` | Sidebar, top bar, form panels |
| `--color-surface-raised` | neutral-0 `#FFFFFF` + `--shadow-1` | Cards (`.card`) |
| `--color-surface-sunken` | neutral-100 `#EEF0F3` | Code and hash wells, `.preview-text`, read-only fields |
| `--color-surface-overlay` | `rgba(21,26,33,0.45)` | Modal backdrop (`.modal-overlay`) |
| `--color-tooltip-bg` | `#FFFFE8` | Hover-help tooltip on both UIs (keeps the desktop's current value). Text is neutral-900 at 17 : 1. |
| `--color-tooltip-border` | neutral-900 `#151A21` | 1 px solid. On desktop this is the current `relief="solid"`. |
| `--color-text-primary` | neutral-900 | Body text, table values |
| `--color-text-secondary` | neutral-600 | Labels, notes, card sub-headings (`.card h4`) |
| `--color-text-muted` | neutral-500 | Hints (`.hint`), timestamps (`.ts`), provenance, the "(hover the ? icons for details)" line |
| `--color-text-disabled` | neutral-400 | Disabled labels |
| `--color-text-link` | brand-primary | Links. Underlined on hover and focus, and always underlined in running prose. |
| `--color-border-subtle` | neutral-200 | Card borders and dividers (replaces `--line`) |
| `--color-border-control` | neutral-450 `#8A94A2` | Inputs, selects, textareas, checkboxes, secondary button outline (3.1 : 1) |
| `--color-border-strong` | neutral-600 | Table header underline, print borders (replaces print `#999`) |

#### 2.2.4 Semantic

| Token set | fg / ink | tint (background) | border | Contrast (ratio : 1) | Use |
|---|---|---|---|---|---|
| `--color-success` · `-tint` · `-border` | `#1B7339` | `#E8F5EC` | `#1B7339` | 5.9 white · 5.2 desk · 5.4 on tint | Saved state (replaces `#060`), run **complete**, Merkle **verified** |
| `--color-warning` · `-tint` · `-border` | `#8A5A00` | `#FFF4DB` | `#B7791F` (3.6) | 5.9 white · 5.2 desk · 5.4 on tint | Log `warn` (replaces `#a60`), `p_warn`, **sub-floor** regime, Merkle root **pending** |
| `--color-error` · `-tint` · `-border` | `#B42318` | `#FDECEA` | `#B42318` | 6.6 white · 5.8 desk · 5.7 on tint | Unsaved or dirty state and `e3_warn` (replace `#b00`), log `err`, run **failed**, Merkle **mismatch**, form errors (`.err`) |
| `--color-info` · `-tint` · `-border` | `#2F3E9E` (= brand-primary) | `#EEF0FA` | `#2F3E9E` | 9.1 white · 8.0 on tint | Run **running**, informational banners, read-only baseline values (replaces `#036`) |

Known collision: `--color-warning` and `--color-variant-anchoring-ink` share the amber hue family. This is acceptable only because warnings always carry the warning-triangle icon and text, and never appear in charts or legends, while variants always carry their marker glyph. Do not place an Anchoring badge inside a warning banner.

#### 2.2.5 Focus ring

| Token | Value | Notes |
|---|---|---|
| `--color-focus-ring` | `#2F3E9E` | 9.1 : 1 on white, 8.0 on desk |
| `--focus-ring` | `outline: 2px solid var(--color-focus-ring); outline-offset: 2px;` | Applied on `:focus-visible` only, never on mouse click |
| `--focus-ring-halo` | `box-shadow: 0 0 0 4px var(--color-surface-panel)` | Keeps the ring legible on tinted and brand fills |

On desktop the vista theme draws its native dotted focus rectangle. Keep it; do not suppress `takefocus`.

#### 2.2.6 Variant identity colours (Okabe-Ito based), P0

Each variant has four colour roles plus three non-colour encodings:

- **base**: the Okabe-Ito hue, used for fills, legend swatches, marker faces and areas.
- **strong**: the chart line, marker edge and badge border colour, ≥ 3 : 1 on white.
- **ink**: text on white or on the tint, ≥ 4.5 : 1 on white and ≥ 4.5 : 1 on desk.
- **tint**: a background wash.

| Variant (exact label) | Token prefix | base | strong | ink | tint | Marker | Line style | Bar hatch | Grayscale luminance (relative, 0–1) |
|---|---|---|---|---|---|---|---|---|---|
| **Standard** | `--color-variant-standard` | `#0072B2` (5.2) | `#0072B2` (5.2) | `#0072B2` (5.2 white / 4.6 desk) | `#E5F1F8` | ● circle, **filled** | solid `-` | none | 0.15 |
| **Anchoring** | `--color-variant-anchoring` | `#E69F00` (2.2, fill only) | `#B07A00` (3.7) | `#8A5E00` (5.7 / 5.0) | `#FDF3E0` | ■ square, **hollow** | dashed `(0,(6,3))` | `//` | 0.42 |
| **Parallel** | `--color-variant-parallel` | `#009E73` (3.4) | `#009E73` (3.4) | `#00785A` (5.5 / 4.8) | `#E0F4EE` | ▲ triangle-up, **filled** | dotted `(0,(1.5,1.5))`, round caps | `..` | 0.26 |
| **Parallel-Anchored** | `--color-variant-parallel-anchored` | `#CC79A7` (3.1) | `#B35C8E` (4.3) | `#9E4A7B` (5.7 / 5.0) | `#F7EAF1` | ◆ diamond, **hollow** | dash-dot `(0,(6,2,1.5,2))` | `xx` | 0.29 |

Token names are `--color-variant-<slug>`, `-strong`, `-ink` and `-tint`. For example: `--color-variant-parallel-anchored-strong`.

**The encoding is a mnemonic, so the legend is learnable:**
- Filled marker means one on-chain record per event (Standard, Parallel). Hollow marker means Merkle-anchored (Anchoring, Parallel-Anchored).
- Blunt shape (circle, square) means a single channel. Pointed shape (triangle, diamond) means one channel per case.
- Solid and dotted lines are the non-anchored pair; dashed and dash-dot are the anchored pair.

**Rules:**
- **Map colour by variant name, never by cycle order.** `report.py` currently relies on matplotlib's cycle, so a chart that omits Standard recolours the rest. This is a (proposal) code change, specified in §2.10.4.
- Parallel and Parallel-Anchored have near-equal gray luminance (0.26 vs 0.29). In grayscale print the marker shape and line style carry the distinction, so neither may be dropped.
- Legend and axis labels use the exact display names above, never the slugs `standard`, `parallel-anchored` (a (proposal) change to `label=v` in `report.py`).
- Marker size is 6 pt, and 5.5 pt for the diamond. Hollow markers use a white face and a 1.5 pt strong-colour edge. Line width is 1.8 pt. Error bars (± SD) use the strong colour at 1 pt with `capsize 3`.

#### 2.2.7 Regime status (smoke / steady / sub-floor), P0

| Regime (exact label) | Token prefix | fg | bg | border | Extra cue | Meaning |
|---|---|---|---|---|---|---|
| **steady** | `--color-regime-steady` | `#FFFFFF` | neutral-800 `#252C36` | none | Solid fill (14.1 : 1) | The only regime whose numbers are reportable, so it gets the heaviest visual weight |
| **sub-floor** | `--color-regime-subfloor` | warning `#8A5A00` | warning-tint `#FFF4DB` | `#B7791F` 1 px solid | 45° hatch `sys-pattern-subfloor-hatch` (web); "▿ sub-floor" text prefix (desktop, since Tk labels cannot hatch) | Below the steady floor; shown but never mixed into steady tables |
| **smoke** | `--color-regime-smoke` | neutral-600 `#525C6B` | transparent | neutral-500 1 px **dashed** | Smoke icon (web); text only (desktop) | E0 functional check, results under `results/e0/` |

#### 2.2.8 Run status (complete / failed / running), P0

| Status (exact label from `experiment.py`) | Token | Colour | Icon (see §2.6) | Notes |
|---|---|---|---|---|
| **complete** | `--color-run-complete` → success | `#1B7339` | check-circle | — |
| **failed** | `--color-run-failed` → error | `#B42318` | x-circle | `experiment.py` also logs cancelled runs as `failed`. A separate **cancelled** state is (proposal) and would use neutral-500 with a stop-square icon. |
| **running** | `--color-run-running` → info | `#2F3E9E` | Spinner (§2.8), or `ttk.Progressbar` indeterminate on desktop | — |
| **queued** (proposal) | `--color-run-queued` → neutral-500 | `#626C7A` | clock | For a planned run that Resume has not yet reached |

#### 2.2.9 Operation-type colours (web audit trail; desktop per-operation tables use text only)

The operation tags in the code are CREATE, TRANSFER, ACCESS and DISPOSE. The legacy tag `REMOVE` still appears twice in `frontend/src`; display it as DISPOSE.

| Operation tag | Token | Hex | Change from today |
|---|---|---|---|
| CREATE | `--color-op-create` | `#1B7339` | Was `#6cae75`, which is too light on white |
| TRANSFER | `--color-op-transfer` | `#2F3E9E` | Was `#4f86c6` |
| ACCESS | `--color-op-access` | `#525C6B` | (proposal) Was gold `#c9a227`. ACCESS is the most frequent event, so it gets the lowest salience, and the change also avoids the Anchoring and warning hues. |
| DISPOSE (status **DISPOSED**) | `--color-op-dispose` | `#252C36` | (proposal) Was `--bad` red. Disposal is a terminal, legitimate custody transition and nothing is deleted, so it must not look like an error. |

Rule: charts never colour by operation type. In per-operation charts the operation type is the axis or facet, and the variant keeps its colour.

#### 2.2.10 Merkle verification states (web badge semantics; the badge art itself lives in the web section)

| State | Token alias | Maps to |
|---|---|---|
| verified | `--color-verify-ok` | success |
| mismatch | `--color-verify-bad` | error |
| pending (root not yet committed) | `--color-verify-pending` | warning (today `.badge.pending` uses muted) |
| n/a (Standard or Parallel: per-event record on-chain, no Merkle branch) | `--color-verify-na` | neutral-500 |

#### 2.2.11 Chart support colours (`viz`)

| Token | Hex | Use |
|---|---|---|
| `--viz-bg` | `#FFFFFF` | Figure and axes face, always white, including when the web dark theme is on (charts are exported as PNGs) |
| `--viz-grid` | `#E5E7EB` | Major grid, 0.8 pt (replaces `alpha 0.3`) |
| `--viz-axis` | neutral-600 `#525C6B` | Spines, ticks, tick labels |
| `--viz-text` | neutral-900 | Title and axis labels |
| `--viz-reference` | neutral-500 `#626C7A` | The `y = x (send rate)` diagonal on E3a throughput: dotted, 1 pt |
| `--viz-saturation` | the variant's **strong** colour | Saturation marker `axvline` (throughput < 0.9 × configured send rate): dotted, 1 pt, with a small "sat." label in the variant ink (today it has no colour) |
| `--viz-variant-reference` | the variant's **strong** colour | E1 "(reference)" horizontal lines for Standard and Parallel: long-dash `(0,(8,4))`, 1 pt, legend label "`<Variant> (reference)`" |

### 2.3 Typography

#### 2.3.1 Web

| Role | Family | Licence | Hosting |
|---|---|---|---|
| Sans (UI and body) | **Inter** (variable, `wght` 400–700) | SIL OFL 1.1 | Self-hosted `woff2`, Latin + Latin-Extended subset, `font-display: swap` |
| Mono (hashes, IDs, tx IDs, JSON, run IDs) | **JetBrains Mono** (400, 600) | SIL OFL 1.1 | Self-hosted `woff2` |

- Fallback stacks are `Inter, "Segoe UI", system-ui, sans-serif` and `"JetBrains Mono", Consolas, ui-monospace, monospace`.
- CSP constraint (`frontend/nginx.conf`): `default-src 'self'` with no `font-src` override, so **fonts must be served from the app's own origin**. Google Fonts and other CDNs would be blocked. Ship the OFL licence text with the font files.

| Token | Size / line height (px) | Weight | Use |
|---|---|---|---|
| `--text-display` | 28 / 36 | 700, letter-spacing 0.2em, uppercase | GLEIPNIR wordmark on login (`.login-brand`) |
| `--text-h1` | 22 / 30 | 600 | Page title |
| `--text-h2` | 18 / 26 | 600 | Section title, court-report headings |
| `--text-h3` | 15 / 22 | 600 | Card heading (`.card h3`) |
| `--text-body` | 14 / 22 | 400 | Default text (the current base 14 px is kept) |
| `--text-body-strong` | 14 / 22 | 600 | Emphasis, table header |
| `--text-sm` | 13 / 20 | 400 | Tabs (`.tab`), dense tables |
| `--text-caption` | 12 / 16 | 400 or 500 | Labels, hints, badges, pills |
| `--text-micro` | 11 / 16 | 500, uppercase, letter-spacing 0.08em | `.nav-title`, `.ts` timestamps |
| `--text-mono` | 13 / 20 | 400 | Hashes, evidence IDs, `CASE-<uuid>` |
| `--text-mono-sm` | 12 / 16 | 400 | Inline hashes in tables, `.mono.small` |
| Print (court report) | body 10.5 pt, h1 16 pt, h2 13 pt, mono 9 pt | — | `@media print` |

**Data typography rules (both UIs):**
- Use `font-variant-numeric: tabular-nums` in every table and metric cell.
- Right-align numbers.
- Put units in every column header, e.g. "Throughput (tx/s)", "Send rate (tx/s)", "Latency p95 (ms)", "Ledger size (MB)".
- Write aggregates as `123.4 ± 5.6`, with a thin space around ± if possible.
- Write timestamps as `YYYY-MM-DD HH:mm:ss UTC` in tabular sans, not mono.
- Truncate long hashes in the middle, `a1b2c3d4…9f8e7d6c`, with a copy action. In detail views, show the full hash with `word-break: break-all`.

#### 2.3.2 Desktop (Tk/ttk)

Tk can only use fonts that are **installed on Windows** or registered to the process before `tk.Tk()` is created. It cannot load a font file from a path.

| Tk named font / style | Family, size (pt), weight | Replaces |
|---|---|---|
| `TkDefaultFont` (all ttk widgets) | Segoe UI 9 | Implicit default |
| `TkHeadingFont`, `Treeview.Heading` | Segoe UI 9 bold | — |
| `Headline.TLabel` (tab headline) | Segoe UI 10 bold | `("Segoe UI", 10, "bold")` |
| `Title.TLabel` (proposal: dialog and section titles) | Segoe UI Semibold 12 | — |
| `TkFixedFont`, log, preview dialogs | Consolas 9 | `("Consolas", 9)` |
| Tooltip (`Tip`) | Segoe UI 9 | `("Segoe UI", 9)` |
| Help "?" glyph | Segoe UI 8 bold | `("Segoe UI", 8, "bold")` |

- **Default: use Segoe UI and Consolas.** Both ship with every supported Windows version and need no bundling.
- Optional bundle (P2, proposal): Inter and JetBrains Mono for exact parity with the web. Register them per process with `ctypes.windll.gdi32.AddFontResourceExW(path, 0x10 /*FR_PRIVATE*/, 0)` *before* `tk.Tk()`, then fall back to Segoe UI or Consolas if registration fails. Only adopt this if the authors want pixel parity; it adds font files to `orchestration/`.
- DPI (proposal, if not already done): call `ctypes.windll.shcore.SetProcessDpiAwareness(1)` before `tk.Tk()`, or text is bitmap-scaled and blurry at 125–150 %. Tk sizes are points (positive), so they scale. Canvas and image sizes are pixels and must be multiplied by `root.tk.call('tk', 'scaling') / 1.333`.

#### 2.3.3 Charts (matplotlib)

| Setting | Value |
|---|---|
| Font family | `Segoe UI`, then `DejaVu Sans` |
| Title | 11 pt semibold |
| Axis labels | 10 pt (with units, e.g. "Send rate (tx/s)") |
| Ticks | 9 pt |
| Legend | 8 pt (as today), frameless, placed outside the plot area when there are more than 4 entries |
| Screen export | `figsize (6.4, 4.2)` in at `dpi 130`, which is 832 × 546 px PNG (current) |
| Thesis print export (proposal) | Same figure size at `dpi 300` PNG, plus an SVG export |

### 2.4 Spacing, sizing, radii, borders, elevation

**Spacing scale.** The base unit is 4 px, and all padding, gaps and margins snap to this scale. Tk padding is in pixels.

| Token | Value (px) | Typical use |
|---|---|---|
| `--space-0` | 0 | — |
| `--space-0-5` | 2 | Icon to text inside badges |
| `--space-1` | 4 | Tight gaps, `padx=4` (desktop) |
| `--space-2` | 8 | Default gap, `btn-row` gap, `padx=8` |
| `--space-3` | 12 | Form field spacing, badge horizontal padding |
| `--space-4` | 16 | Card padding (was 14), page gutter on mobile |
| `--space-5` | 20 | — |
| `--space-6` | 24 | Section gap, page padding (was 18) |
| `--space-8` | 32 | Page sections |
| `--space-10` | 40 | Login card padding |
| `--space-12` | 48 | — |
| `--space-16` | 64 | Empty-state spacing |

- Desktop: `ttk.LabelFrame(padding=6)` becomes `padding=8` (`--space-2`), and grid `padx=4/8` stays on the scale.

**Control sizes.**

| Control | Web height (px) | Desktop |
|---|---|---|
| Button | 32, small 26 | Native vista |
| Input | 32 | Native |
| Table row | 36, compact 32 | `Treeview rowheight` 22 × scaling |
| Minimum hit target | 24 × 24 (WCAG 2.5.8); icon-only buttons are 32 × 32 | — |

**Radii.**

| Token | Value (px) | Use |
|---|---|---|
| `--radius-sm` | 4 | Inputs, selects, textarea, checkboxes |
| `--radius-md` | 6 | Buttons, chips, tabs, badges, nav items |
| `--radius-lg` | 8 | Cards, notes, preview frames |
| `--radius-xl` | 12 | Login card, modal |
| `--radius-pill` | 999 | Pills, status dots, stepper and timeline dots |

The stray 7 px radius is retired. Desktop stays native and square: ttk vista cannot round corners.

**Borders.** `--border-width` is 1 px everywhere. Emphasis uses a 2 px `--border-width-strong` (the active tab underline, selected-row indicator bar = 3 px). There are no double borders.

**Elevation.** Light theme values are listed below. Print shows no shadows, only borders.

| Token | Value | Use |
|---|---|---|
| `--shadow-0` | none | Flat panels, sidebar |
| `--shadow-1` | `0 1px 2px rgba(21,26,33,0.08)` | Cards |
| `--shadow-2` | `0 4px 12px rgba(21,26,33,0.12)` | Dropdowns, popovers, web tooltip |
| `--shadow-3` | `0 12px 40px rgba(21,26,33,0.24)` | Modal, login card |

Desktop has no shadows (Tk cannot draw them). Elevation there means a 1 px neutral-900 border, as the tooltip already does.

**Z-index (web).** `--z-sticky` 10, `--z-dropdown` 100, `--z-overlay` 1000, `--z-modal` 1010, `--z-tooltip` 1100, `--z-toast` 1200 (proposal).

### 2.5 Layout (web; brief)

- Breakpoints are `--bp-sm` 640, `--bp-md` 960 and `--bp-lg` 1280 px.
- Sidebar width is 208 px (was 190). Below 960 px it collapses to a top drawer (proposal).
- Maximum content width is 1280 px. The court report keeps its 820 px width (`.report-page`).
- The page gutter is 16 px at phone width, and there is no horizontal page scroll. Wide tables scroll inside their own container.

### 2.6 Iconography

**Style (both UIs).**
- Outline style with round caps and round joins.
- Rectangle corners use a 2 px radius at the 24 px size.
- Angles are 45° or 90° only.
- One weight: a 1.5 px stroke at 24 px and 20 px, and 1.25 px at 16 px (the stroke is re-drawn per size, not scaled).
- Filled forms are reserved for status glyphs (check-circle, x-circle, warning triangle), for the variant markers (§2.2.6), and for the hover state of the help icon.

**Grid.**

| Size (px) | Live area (px) | Padding (px) | Used for |
|---|---|---|---|
| 16 | 14 × 14 | 1 | Inline with 12–14 px text, table cells, badges, desktop toolbar |
| 20 | 16 × 16 | 2 | Buttons, nav items, desktop buttons |
| 24 | 20 × 20 | 2 | Page headers, empty states |

- Keylines: a circle of 20 px diameter, a square of 18 px and landscape and portrait rectangles of 20 × 16 px, all within the 24 px grid.

**Colour.** Icons inherit `currentColor` on web. Rest state is `--color-text-secondary`, active is `--color-text-primary` or `--color-brand-primary`, and disabled is `--color-text-disabled`. Icons never use the variant colours except in the variant markers.

**Formats.**
- Web: one inline SVG sprite (`sprite.svg` with `<symbol>`s), served from `'self'` and compatible with the CSP. No icon-font or runtime icon-library dependency. A public outline set (e.g. Lucide, ISC licence) may be used as a *drawing reference* for generic glyphs. Domain glyphs (Merkle tree, anchor channel, custody transfer, channel-per-case, receipt) are custom-drawn to the same grid.
- Desktop: **PNG only**, because Tk 8.6 `PhotoImage` does not read SVG. Deliver each icon at 16, 20 and 24 px @1× and at @1.5× and @2× (24, 30, 32, 36, 40, 48 px), transparent background.
- **Tk cannot recolour images**, so each desktop state (rest, disabled) is a separate PNG, wired with `ttk.Button(image=(img, "disabled", img_dis))`.

**Help icon (the circled "?"), both UIs.** This is the circled black "?" that `help_icon()` draws today.

| Property | Spec |
|---|---|
| Geometry | Circle inset 1 px, stroke 1 px at 16 px (1.25 px at 20 px); "?" drawn as a **path** on web, glyph Segoe UI 8 bold on desktop canvas; optical centre nudged 0.5 px up |
| Colour, rest | Outline and glyph `--color-help-icon` = neutral-900 `#151A21` (reads as black; 15.3 : 1 on desk) on a transparent background (desktop: the canvas takes the frame background, as today) |
| Colour, hover and focus | Filled neutral-900 disc with a white "?" (proposal) |
| Web behaviour | A real `<button type="button" aria-label="Help: <topic>">` that opens a tooltip on hover **and** focus and closes on Esc. The tooltip is linked with `aria-describedby`. |
| Desktop behaviour | `cursor="question_arrow"` (current). Add `takefocus=1` plus Enter/Leave and FocusIn/FocusOut bindings (proposal). |
| Sizes | 16 px inline with labels, 20 px beside section headings |
| Tooltip | `--color-tooltip-bg`, 1 px `--color-tooltip-border`, padding 6 × 8 px, `--text-caption` (web) or Segoe UI 9 (desktop), maximum width 360 px (web) or `wraplength` 420 px (desktop, proposal); offset +14 / +16 px from the pointer (current) |

### 2.7 Interaction states

These are the states for web components. The desktop column says what ttk vista can honour.

| State | Web treatment | Desktop (ttk vista) |
|---|---|---|
| **Hover** | Primary: bg `--color-brand-primary-hover`. Secondary, ghost, nav, table row: bg `--color-neutral-100`. Link: underline. Cursor pointer. Transition per §2.8. | Native hover. `Treeview` rows have no hover, which is acceptable. |
| **Focus-visible** | `--focus-ring` (2 px, offset 2 px, `--color-focus-ring`) on every interactive element. Inputs also get the border colour `--color-brand-primary`. There is never `outline: none` without a replacement. | Native dotted focus rectangle. The help icon becomes focusable (proposal). |
| **Active / pressed** | Primary: bg `--color-brand-primary-active`. Others: bg `--color-neutral-200`. No scale or translate. | Native |
| **Disabled** | bg `--color-neutral-100`, text and icon `--color-text-disabled`, border `--color-border-subtle`, `cursor: not-allowed`, `aria-disabled`. This replaces `opacity: 0.45` so the text colour is predictable. | `style.map("TButton", foreground=[("disabled", "#98A1AE")])`. The disabled icon is a separate PNG. |
| **Selected** | Nav item, tab, table row or chip: bg `--color-brand-primary-tint`, text `--color-text-primary`, plus a 3 px left bar (nav, row) or a 2 px bottom border (tab) in `--color-brand-primary`. `aria-selected` / `aria-current` is set. Replaces `#223449`. | `style.map("Treeview", background=[("selected", "#2F3E9E")], foreground=[("selected", "#FFFFFF")])`. Notebook tabs stay native. |
| **Loading** | Button: keeps its width, label becomes "Working…" with a 16 px spinner, `aria-busy="true"`. Section: skeleton blocks in `--color-neutral-100`. Long jobs: text status plus spinner, never a spinner alone. | `ttk.Progressbar(mode="indeterminate")` plus the status text (current "`<label>: running…`") and `cursor="watch"` on the window. |
| **Invalid / error** | Border `--color-error`, message below in `--color-error` with the x-circle icon, `aria-invalid`, `aria-describedby`. | `Error.TLabel` below the field |
| **Read-only** | bg `--color-surface-sunken`, no border change, text stays `--color-text-primary` | `Baseline.TLabel` (brand ink) |
| **Dirty / unsaved** (desktop Settings & Baselines) | — | Status label in `--color-error` with "unsaved" (current `#b00`), and in `--color-success` with "saved" (current `#060`) |

### 2.8 Motion (minimal)

| Token | Value | Use |
|---|---|---|
| `--motion-fast` | 120 ms `cubic-bezier(0.2,0,0,1)` | Hover and focus colour and background, border |
| `--motion-base` | 180 ms, same curve | Modal and overlay fade, dropdown open, tooltip fade-in (after a 300 ms hover delay) |
| Spinner | 0.8 s linear rotation | Loading |
| Data | none | Tables, charts, metric values and timelines never animate |

- `@media (prefers-reduced-motion: reduce)` sets all transitions to 0 ms and replaces the spinner rotation with a static glyph plus "Loading…" text.
- Desktop has no custom animation. Only the native indeterminate `Progressbar` and live log appends move.

### 2.9 Themes

**Light (default, P0, both UIs).** Uses all tokens above.

**Dark (P1, web only, opt-in).**
- Selected by `prefers-color-scheme: dark` unless the user overrides it with the (proposal) theme toggle, which sets `[data-theme]`.
- Build it from the current dark palette so the authors' look is kept.
- The print stylesheet always forces light.
- Charts stay white-background PNGs in both themes: give them a `--radius-lg` white card frame in dark mode.
- Desktop gets no dark mode. The vista theme cannot be darkened without replacing every native element; this is P2 and explicitly not recommended.

| Token | Dark value | Contrast (ratio : 1) |
|---|---|---|
| surface-page | `#0F1720` | — |
| surface-panel | `#17212B` | — |
| surface-raised | `#1E2A37` | — |
| surface-sunken | `#131C26` | — |
| border-subtle | `#2B3A49` | — |
| border-control | `#51647A` | 3.1 on `#1E2A37` |
| text-primary | `#E6EDF3` | 13.4 on raised |
| text-secondary / muted | `#8BA0B3` | 5.4 on raised |
| brand-primary (on dark) | `#8FA2FF` | 7.5 on page; button text `#0F1720` |
| selected-bg | `#223449` | — |
| success | `#4CAF50` | 6.5 |
| warning | `#E0B43C` | 8.9 |
| error | `#F07A68` | 6.3 |
| info | `#8FA2FF` | 7.5 |
| variant Standard | `#56B4E9` (Okabe-Ito sky blue; base, strong and ink) | 7.8 |
| variant Anchoring | `#E69F00` | 8.0 |
| variant Parallel | `#2FC193` | 7.0 |
| variant Parallel-Anchored | `#DD8FBB` | 7.1 |
| regime steady chip | bg `#E6EDF3`, fg `#0F1720` (inverted) | — |
| shadows | `rgba(0,0,0,0.45)` family (current values) | — |

### 2.10 Design-token deliverables

#### 2.10.1 `tokens.json` (single source of truth)

- Proposed path: `design/tokens/tokens.json`.
- Format: W3C Design Tokens Community Group (`$value`, `$type`, `$description`).
- Groups: `color.brand.*`, `color.neutral.*`, `color.surface.*`, `color.text.*`, `color.border.*`, `color.semantic.{success|warning|error|info}.{fg|tint|border}`, `color.focus`, `color.variant.{standard|anchoring|parallel|parallel-anchored}.{base|strong|ink|tint|dark}`, `color.regime.*`, `color.run.*`, `color.op.*`, `color.verify.*`, `viz.*`, `font.*`, `text.*`, `space.*`, `radius.*`, `shadow.*`, `motion.*`, `z.*`.
- Non-colour variant encodings are included as custom `$type`s: `variant.<slug>.marker` (`"o"|"s"|"^"|"D"`), `.markerFill` (`"filled"|"hollow"`), `.lineStyle` (dash array), `.hatch` (`""|"//"|".."|"xx"`), `.label` (exact display name).
- Theme values: `$extensions.gleipnir.dark` on each token that changes in dark mode.
- Keep it hand-synced. There is no token build-tool dependency. A tiny (proposal, P2) check script compares `tokens.css` and `benchtheme.py` literals against the JSON.

#### 2.10.2 `tokens.css` (web)

- Proposed path: `frontend/src/tokens.css`, imported first by `styles.css`.
- Contents: every token as a `:root` custom property, the dark overrides under `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {…} }` and `:root[data-theme="dark"] {…}`, the print overrides under `@media print`, and the `@font-face` blocks for Inter and JetBrains Mono.
- Legacy aliases (proposal) for one milestone so the migration is a no-op diff:

| Legacy variable | Becomes |
|---|---|
| `--bg` | `var(--color-surface-page)` |
| `--panel` | `--color-surface-panel` |
| `--card` | `--color-surface-raised` |
| `--line` | `--color-border-subtle` |
| `--text` | `--color-text-primary` |
| `--muted` | `--color-text-secondary` |
| `--accent` | `--color-brand-primary` |
| `--ok` | `--color-success` |
| `--bad` | `--color-error` |

- Literal replacements: `#223449` → `--color-selected-bg`, `#5f96d6` → `--color-brand-primary-hover`, `#c9a227` → `--color-warning`, `#6cae75` / `#4f86c6` → `--color-op-*`.

#### 2.10.3 ttk style mapping table (desktop)

Proposed module: `orchestration/benchtheme.py`, one `apply(root)` called in `main()` after `theme_use("vista")`. Today's scattered literals become named styles.

| ttk style / Tk target | Option (state) | Token | Value | Replaces |
|---|---|---|---|---|
| `"."` root | `font` | font.ui | Segoe UI 9 | Implicit |
| `"."` root | `foreground` | text-primary | `#151A21` | Implicit black |
| `Headline.TLabel` | `font` | text.headline | Segoe UI 10 bold | `font=("Segoe UI",10,"bold")` |
| `Title.TLabel` (proposal) | `font` | text.title | Segoe UI Semibold 12 | — |
| `Hint.TLabel` | `foreground` | text-muted | `#626C7A` | `#777` (fails AA) |
| `Note.TLabel` | `foreground` | text-secondary | `#525C6B` | `#555` |
| `Baseline.TLabel` | `foreground` | info / brand-primary | `#2F3E9E` | `#036` |
| `Error.TLabel` | `foreground` | error | `#B42318` | `#b00` (`status_lbl` dirty, `e3_warn`) |
| `Saved.TLabel` | `foreground` | success | `#1B7339` | `#060` |
| `Warn.TLabel` | `foreground` | warning | `#8A5A00` | `#a60` (`p_warn`) |
| `Regime.Steady.TLabel` (proposal) | `background` / `foreground` | regime-steady | `#252C36` / `#FFFFFF` | — |
| `Regime.SubFloor.TLabel` (proposal) | `background` / `foreground` | regime-subfloor | `#FFF4DB` / `#8A5A00` | — |
| `Regime.Smoke.TLabel` (proposal) | `foreground` | regime-smoke | `#525C6B` | — |
| `TLabelframe.Label` | `font` / `foreground` | text-secondary | Segoe UI 9 bold / `#525C6B` | Native |
| `TLabelframe` | `padding` | space-2 | 8 | `padding=6` |
| `Treeview` | `font`, `rowheight` | font.ui | Segoe UI 9, 22 × scaling | Native |
| `Treeview` | `background` / `foreground` (`selected`) | brand-primary / on-brand | `#2F3E9E` / `#FFFFFF` | Native blue |
| `Treeview.Heading` | `font` | font.heading | Segoe UI 9 bold | Native |
| `Treeview` tags `complete` / `failed` / `running` (proposal) | `foreground` | run-* | `#1B7339` / `#B42318` / `#2F3E9E` | — |
| `Treeview` tags `smoke` / `sub-floor` (proposal) | `foreground` | regime-* | `#525C6B` / `#8A5A00` | — |
| `TButton` | `foreground` (`disabled`) | text-disabled | `#98A1AE` | Native |
| `Primary.TButton` (proposal) | `font` | font.ui bold | Segoe UI 9 bold, plus `default="active"` | Vista ignores `background` on TButton, so primary emphasis is weight, icon and default ring, not fill |
| `TNotebook.Tab` | `padding` | space | `[12, 4]` | Native |
| `TProgressbar` | — | — | Native vista green (cannot be recoloured in vista; leave it) | — |
| `ScrolledText` log | `font` / `bg` / `fg` | font.mono / neutral-0 / text-primary | Consolas 9 / `#FFFFFF` / `#151A21` | `font=("Consolas",9)` |
| log tag `err` | `foreground` | error | `#B42318` | `#b00` |
| log tag `warn` | `foreground` | warning | `#8A5A00` | `#a60` |
| log tags `ok` / `muted` (proposal) | `foreground` | success / text-muted | `#1B7339` / `#626C7A` | — |
| `Tip` tooltip `tk.Label` | `background` / `font` / border | tooltip-bg / font.ui / tooltip-border | `#FFFFE8` / Segoe UI 9 / 1 px solid | Same values, now named |
| `help_icon` Canvas | `outline`, `fill`; `size` | help-icon | `#151A21`; 16 × scaling | `#000000`; fixed 16 |
| Variant checkboxes (`variant_boxes`) (proposal) | `image`, `compound="left"` | variant marker PNGs | `viz-variant-marker-set` | Text only |

#### 2.10.4 matplotlib style (charts)

- Proposed files: `orchestration/gleipnir.mplstyle`, which holds fonts, sizes, grid, spines and dpi from §2.2.11 and §2.3.3, plus a `VARIANT_STYLE` dict in `report.py`.
- `VARIANT_STYLE = {slug: {label, color(strong), mfc(base or "white"), mec(strong), marker, ls, hatch}}` is looked up **by variant name**. It replaces reliance on the colour cycle and `marker="o"`.
- The saturation `axvline` and the E1 reference `axhline` take the variant strong colour.

### 2.11 Assets

| ID | Category | Where used | Purpose | Variants / states | Size & format | Priority |
|---|---|---|---|---|---|---|
| sys-color-palette-sheet | Foundation specimen | Handed to both UI sections; appendix of the design brief | Visual reference of every colour token with hex and contrast ratio | Light; dark (web); print | 1 board, 1600 × 2400 px PNG + source file | P0 |
| sys-contrast-audit | Foundation QA | Design review, thesis appendix (accessibility claim) | Every fg/bg pair used, with its ratio : 1 and pass/fail against 4.5 : 1 / 3 : 1, including against desk `#F0F0F0` | Light, dark, print | Markdown table or CSV | P0 |
| sys-tokens-json | Token deliverable | `design/tokens/tokens.json` (proposal) | Single source for colour, type, space, radius, shadow, motion and variant encodings | Light + `$extensions.gleipnir.dark` | JSON (W3C DTCG) | P0 |
| sys-tokens-css | Token deliverable | `frontend/src/tokens.css` (proposal), imported by `styles.css` | Web custom properties, `@font-face`, legacy aliases | `:root`, print override | CSS, < 10 KB | P0 |
| sys-tokens-css-dark | Token deliverable | Same file, dark blocks | Opt-in dark theme built from the current dark palette | `prefers-color-scheme`, `[data-theme="dark"]`, `[data-theme="light"]` guard | CSS | P1 |
| sys-ttk-style-map | Token deliverable | `orchestration/benchtheme.py` (proposal) and the §2.10.3 table | Named ttk styles and Tk font map replacing `#b00 #060 #a60 #777 #555 #036` literals | Per style and state as tabled | Markdown table + Python spec | P0 |
| sys-legacy-token-map | Migration aid | Frontend and desktop refactor | Maps every current literal or variable to its new token | — | Markdown table (in §2.0 / §2.10.2) | P1 |
| sys-font-web-bundle | Typography | `frontend/public/fonts/` (proposal) | Self-hosted Inter (400–700 variable) + JetBrains Mono (400, 600), CSP-compatible | Latin + Latin-Ext subsets; OFL licence files | woff2, < 150 KB total | P0 |
| sys-font-desktop-bundle | Typography | `orchestration/fonts/` (proposal) | Optional private registration of Inter / JetBrains Mono for Tk parity | Fallback to Segoe UI / Consolas | TTF + registration snippet | P2 |
| sys-type-scale-sheet | Foundation specimen | Both UIs | Type ramp: display to micro, mono, print, desktop Tk map, chart sizes | Web, desktop, chart, print | 1 board, 1600 × 1800 px PNG | P0 |
| sys-spacing-radius-sheet | Foundation specimen | Both UIs | 4 px scale, control heights, radii | — | 1 board, 1600 × 1000 px PNG | P1 |
| sys-elevation-sheet | Foundation specimen | Web | `--shadow-0..3` on light and dark; desktop border equivalent | Light, dark, print (none) | 1 board PNG | P1 |
| sys-state-matrix | Foundation specimen | Both UIs | Hover, focus-visible, active, disabled, selected, loading, invalid, read-only for button (primary, secondary, ghost, icon), input, tab, nav item, table row, chip, help icon | Web light, web dark, desktop vista | 1 board, 2000 × 1600 px PNG | P0 |
| sys-focus-ring-spec | Interaction | Every web interactive element | 2 px ring, 2 px offset, halo on tinted fills | On white, page, brand fill, tint, dark | Annotated PNG + CSS snippet | P0 |
| sys-icon-grid-template | Iconography | All icon work in both UIs | Keylines, live area and stroke rules for 16/20/24 | 16 (1.25 px stroke), 20 and 24 (1.5 px stroke) | SVG template + PNG | P0 |
| sys-icon-help | Iconography | Every desktop `help_icon()` and every web field help | Circled black "?" hover-help trigger | Rest (outline), hover and focus (filled disc, white ?), disabled | Web SVG symbol 16/20; desktop PNG 16/20/24 @1×, @1.5×, @2× | P0 |
| sys-tooltip-style | Component foundation | Desktop `Tip`, web help tooltip | Shared tooltip look: `#FFFFE8` bg, 1 px neutral-900 border, caption text | Web (with `--shadow-2`), desktop (border only) | Annotated PNG + CSS / Tk spec | P0 |
| sys-spinner | Loading | Web buttons and sections | Indeterminate loading glyph | 16, 20 px; brand, on-brand (white); reduced-motion static | SVG + CSS keyframes | P1 |
| sys-pattern-subfloor-hatch | Pattern | Web sub-floor regime chip and table-row marker; chart sub-floor band (proposal) | Non-colour cue marking below-floor data | Light (warning on tint), dark, print (black 45° lines) | 8 × 8 px SVG pattern + CSS `repeating-linear-gradient` | P1 |
| sys-regime-swatches | Status foundation | Web tables, desktop History & results tab, chart annotations | Reference look for **smoke**, **steady**, **sub-floor** | Web chip; desktop `Regime.*.TLabel`; print; dark | 1 board PNG + token spec | P0 |
| sys-run-status-swatches | Status foundation | Desktop History & results tab, live Run panel; web (if run status appears) | Reference look for **complete**, **failed**, **running**, queued (proposal), cancelled (proposal) | Web chip; desktop Treeview tag; icon 16 px | 1 board PNG + token spec | P0 |
| sys-status-glyph-set | Iconography | Run status, Merkle verification, banners, log | check-circle, x-circle, warning-triangle, info-circle, clock, stop-square | 16/20 px; filled; semantic colours; disabled | Web SVG symbols; desktop PNG @1×, @1.5×, @2× per colour | P0 |
| viz-variant-key-standard | Data-vis identity | Chart legends, desktop variant checkboxes, web variant label (if shown), thesis figures | Legend key: swatch + ● filled circle + solid line | Colour; grayscale; dark (`#56B4E9`) | SVG 48 × 16, PNG 16/24/32 px | P0 |
| viz-variant-key-anchoring | Data-vis identity | Same as above | Legend key: ■ hollow square + dashed line, base `#E69F00`, strong `#B07A00` | Colour; grayscale; dark | SVG 48 × 16, PNG 16/24/32 px | P0 |
| viz-variant-key-parallel | Data-vis identity | Same as above | Legend key: ▲ filled triangle + dotted line | Colour; grayscale; dark (`#2FC193`) | SVG 48 × 16, PNG 16/24/32 px | P0 |
| viz-variant-key-parallel-anchored | Data-vis identity | Same as above | Legend key: ◆ hollow diamond + dash-dot line | Colour; grayscale; dark (`#DD8FBB`) | SVG 48 × 16, PNG 16/24/32 px | P0 |
| viz-variant-marker-set | Data-vis identity | Desktop `variant_boxes` checkboxes (proposal), tables, web badges | Stand-alone markers for the four variants | Rest, disabled (neutral-400) | SVG 12/16 px; PNG 16/20 @1×, @1.5×, @2× | P0 |
| viz-bar-hatch-set | Data-vis identity | Per-operation and E3b bar charts | Bar fills: none, `//`, `..`, `xx` per variant | Colour, grayscale | SVG patterns + matplotlib hatch spec | P1 |
| viz-mpl-style | Chart deliverable | `orchestration/gleipnir.mplstyle` + `VARIANT_STYLE` in `report.py` (proposal) | Charts follow the tokens, variants mapped by name, display labels exact | Screen (130 dpi) and print (300 dpi + SVG, proposal) | `.mplstyle` + Python dict spec | P0 |
| viz-reference-line-spec | Chart deliverable | E3a `y = x (send rate)`, saturation markers, E1 "(reference)" lines, ± SD error bars | Consistent styling of non-series lines | Colour, grayscale | Annotated PNG spec | P1 |
| viz-grayscale-proof | QA specimen | Thesis print check | All four variants on one sample E3a chart and one bar chart, printed in grayscale, showing they remain distinguishable | Colour, grayscale, deuteranopia and protanopia simulations | 832 × 546 px PNG ×4 + 300 dpi PNG | P0 |
| sys-motion-spec | Interaction | Web | Durations, easing, reduced-motion behaviour; desktop "no custom motion" rule | Default, reduced-motion | Markdown spec | P1 |

### Checklist

- [ ] sys-color-palette-sheet — Board of every colour token with hex and contrast ratio, in light, dark and print.
- [ ] sys-contrast-audit — Table of every fg/bg pair with its ratio, including the desktop `#F0F0F0` background.
- [ ] sys-tokens-json — W3C DTCG `tokens.json`: the single source of truth, including variant marker, line, hatch and label.
- [ ] sys-tokens-css — Web `tokens.css` with custom properties, `@font-face`, print overrides and legacy aliases.
- [ ] sys-tokens-css-dark — Opt-in dark theme blocks built from the current dark palette.
- [ ] sys-ttk-style-map — Named ttk styles and Tk font map replacing the desktop colour literals (`#777` fails AA).
- [ ] sys-legacy-token-map — Table mapping each current literal or variable to its new token, for the migration.
- [ ] sys-font-web-bundle — Self-hosted Inter + JetBrains Mono `woff2` with OFL licences, CSP-safe.
- [ ] sys-font-desktop-bundle — Optional private Tk font registration for parity (P2).
- [ ] sys-type-scale-sheet — Type ramp for web, desktop Tk, charts and print.
- [ ] sys-spacing-radius-sheet — 4 px spacing scale, control heights, radii.
- [ ] sys-elevation-sheet — `--shadow-0..3` with the border-only desktop and print equivalents.
- [ ] sys-state-matrix — All interaction states for every control type, on web light, web dark and desktop vista.
- [ ] sys-focus-ring-spec — 2 px `--color-focus-ring` with 2 px offset and halo, on every surface.
- [ ] sys-icon-grid-template — 16/20/24 keylines, live areas and stroke rules.
- [ ] sys-icon-help — Circled black "?" in rest and hover/focus states; SVG for web, PNG at three densities for desktop.
- [ ] sys-tooltip-style — Shared `#FFFFE8` tooltip for desktop `Tip` and web help.
- [ ] sys-spinner — Loading glyph with a reduced-motion static variant.
- [ ] sys-pattern-subfloor-hatch — 45° hatch cue for the sub-floor regime.
- [ ] sys-regime-swatches — smoke (dashed outline), steady (solid dark), sub-floor (amber and hatch) looks.
- [ ] sys-run-status-swatches — complete, failed and running looks, plus the queued and cancelled proposals.
- [ ] sys-status-glyph-set — check, x, warning, info, clock and stop glyphs, in semantic colours.
- [ ] viz-variant-key-standard — `#0072B2`, filled circle, solid line.
- [ ] viz-variant-key-anchoring — `#E69F00` / `#B07A00`, hollow square, dashed line.
- [ ] viz-variant-key-parallel — `#009E73`, filled triangle, dotted line.
- [ ] viz-variant-key-parallel-anchored — `#CC79A7` / `#B35C8E`, hollow diamond, dash-dot line.
- [ ] viz-variant-marker-set — Stand-alone variant markers for desktop checkboxes, tables and badges.
- [ ] viz-bar-hatch-set — Per-variant bar hatches (none, `//`, `..`, `xx`).
- [ ] viz-mpl-style — `gleipnir.mplstyle` + the name-keyed `VARIANT_STYLE` for `report.py`.
- [ ] viz-reference-line-spec — Styling for the `y = x (send rate)` line, saturation markers, E1 "(reference)" lines and ± SD error bars.
- [ ] viz-grayscale-proof — Grayscale and colour-blindness proof that the four variants stay distinguishable.
- [ ] sys-motion-spec — Motion durations and easing, reduced-motion rules, and the no-motion rule for desktop.

---

## 3. Brand assets

### 3.1 What exists today (audit of the code)

| Surface | File | What the brand looks like today |
|---|---|---|
| Browser tab | `frontend/index.html` | `<title>GLEIPNIR</title>`. No `<link rel="icon">`, no `theme-color`, no manifest. The browser shows its default blank-page icon. |
| Static asset folder | `frontend/public/` | **Does not exist.** Vite copies `public/` to the root of `dist/`, and nginx serves it through `location / { try_files $uri … }`, so creating the folder is enough. Nothing else has to be wired up. |
| Login page | `frontend/src/auth/LoginPage.tsx` | Text only: `.login-brand` "GLEIPNIR" (700 weight, `letter-spacing: 4px`, 20px, centred), then `.login-sub` "Evidence library · sign in to continue", and outside the card `.login-foot` "Talks only to the API gateway · Hyperledger Fabric 2.5 LTS · localhost thesis demo". |
| Top bar (every signed-in page) | `frontend/src/components/Layout/TopBar.tsx` | Text only: `.brand` "GLEIPNIR" (700, `letter-spacing: 2px`, 14px), then `.tagline` "evidence library", then the `whoami` pill and **Sign out**. |
| Sidebar | `frontend/src/components/Layout/Sidebar.tsx` | No brand. Nav groups **Library / Lead / Administration** only. |
| Court report | `frontend/src/pages/investigator/CoCReportPage.tsx` | Rendered outside the app shell, so it has no top bar. The only header is the `<h2>` "Chain-of-Custody Report" inside a `.card`. `@media print` hides `.topbar`, `.sidebar`, `.foot` and every `button`, so **the printed report carries no product identity at all**. |
| Desktop window | `orchestration/benchapp.pyw` | `root.title("GLEIPNIR Bench — E0 · E1 · E2 · E3")`. There is **no `iconbitmap` or `iconphoto` call**, so the title bar, the taskbar and Alt-Tab show the stock Tk/Python icon. Dialogs are titled "GLEIPNIR Bench", "Run {exp}?", "Plan preview (nothing was run)", "Back up now" and "Restore my test data". |
| CSP | `frontend/nginx.conf` | `img-src 'self' blob: data:`, `default-src 'self'` (no `manifest-src`, so the manifest falls back to `'self'`), and `font-src` is unset, so it falls back to `'self'`. Every brand file must be same-origin. No CDN and no remote webfont. |

Product names as the code uses them: **GLEIPNIR** (always upper case in UI strings), the descriptor **evidence library** for the web app, and **GLEIPNIR Bench** for the desktop app.

### 3.2 Token dependencies

Brand assets use these tokens, which the Foundations section must define (hex values live only there). The current `styles.css` equivalent is given so the implementer can map them.

| Token | Role in brand assets | Current CSS equivalent |
|---|---|---|
| `--color-brand-primary` | Mark colour on light grounds and plate colour of the web icon | `--accent` |
| `--color-brand-ink` | Darkest brand neutral: plate of the desktop icon, wordmark on light | none (proposal) |
| `--color-brand-on-dark` | Mark and wordmark on the dark app shell | `--text` |
| `--color-bg` | Dark app canvas behind the top bar and login card | `--bg` / `--panel` |
| `--color-print-ink` | Pure black for every print asset | `@media print` `--text` |
| `--color-paper` | White print ground | `@media print` `--bg` |

**Hard colour constraint.** The brand is **variant-neutral** and **status-neutral**. The mark must never use `--color-variant-standard`, `--color-variant-anchoring`, `--color-variant-parallel`, `--color-variant-parallel-anchored`, `--color-success`, `--color-warning` or `--color-danger`. The mark sits next to the Merkle verification badge and the op-coloured audit trail. If it used a variant or status hue, it would read as data ("this is the Anchoring variant", "this is verified").

### 3.3 Brand idea and copy guardrails

**Idea.** In Norse myth, Gleipnir is the fetter that bound Fenrir. It was forged from six impossible things and was "smooth and soft as a silken ribbon", yet the wolf could not break it. The brand maps this to chain of custody: a **thin, continuous, unbroken line** that is light to carry but shows any break.

**Copy rules for every brand asset (tagline, seal ring text, social card, about box):**
- Allowed: "tamper-evident", "chain-of-custody record", "evidence library", "thesis prototype", "Merkle-anchored".
- **Forbidden:** "tamper-proof", "unbreakable", "immutable evidence", "court-certified", "official". The anchored variants' receipt store is deliberately *not* hardened, and that is a stated thesis finding. Brand copy must not claim more integrity than the design delivers.
- Variant names appear exactly as Standard, Anchoring, Parallel, Parallel-Anchored, and only if needed. No brand asset needs them.
- Say "anchor channel", never the retired Fabric term. No brand asset needs either.
- No third-party marks inside any brand asset: no Hyperledger, Fabric, Caliper, Docker, Python or BINUS logos, and no police, court or state emblems. Plain-text mentions like the existing `.login-foot` line stay as text.

### 3.4 Logo mark: three concept directions

Deliverable: **brand-concept-board**, one board showing all three directions at 256px, 32px and 16px, on dark (`--color-bg`) and on white (`--color-paper`), plus a one-colour print proof. The authors pick one direction. Recommendation: **A as the primary mark and C only for the print seal.**

#### Direction A: "Silk Fetter" (recommended)

- A single continuous ribbon of constant stroke, with no start or end visible, forming a closed loop. The loop may trace a stylised **G** or a flat Möbius-like band with one over-under crossing.
- Why: it is the literal myth object, it reads as "an unbroken chain", and it stays one shape at 16px.
- Construction: constant stroke on a 24-unit grid, stroke weight 3 units at master size. Exactly one crossing, where the gap cut must survive at 16px: at least 1px at 16px and at least 2px at 32px.
- Risk: it can read as a generic "infinity" or recycling loop. Mitigate with the G-form terminal and an asymmetric crossing.

#### Direction B: "Custody Link"

- Two interlocked chain links drawn as rounded rectangles. The second link is slightly narrower, echoing a hand-off (TransferCustody). Optionally a small square notch in one link suggests a block.
- Why: "chain of custody" is understood instantly by non-technical examiners.
- Risk: the generic "link / URL" icon. It collides with any hyperlink or "copy link" UI icon the web app may use. If chosen, the in-app link icon must be redesigned away from it.

#### Direction C: "Merkle Seal"

- A circular seal. Inside, a minimal binary Merkle tree (1 root, 2 nodes, 4 leaves) whose leaves are bound by one ribbon arc running up to the root.
- Why: it shows the thesis's core mechanism (Merkle-root anchoring) and has a natural "seal" shape for the court report.
- Risk: at app scale it competes with the Merkle verification badge (`MerkleBadge.tsx`, states ok / bad / pending / n.a.). A user could mistake the logo for a verification result. **Therefore C is not used as the in-app mark.** It feeds only `brand-print-seal` (§3.9).

**Constraints for every direction:**
- Square viewBox.
- Pure geometry: no gradients, no drop shadows, no bevels, no 3-D blocks, no padlock or shield clichés.
- Must work as a one-colour silhouette.
- Must stay recognisable at 16×16 px.

### 3.5 Wordmark and lockups

**Wordmark "GLEIPNIR"**
- Upper case, tracked wide, matching the current CSS spirit: `letter-spacing` 2px at 14px (≈0.14em) and 4px at 20px (0.2em). Deliver it at about +0.16em.
- Weight equivalent to 600–700.
- Draw it from, or adjust it from, an **SIL-OFL-licensed** sans so the licence can go in the repo. Deliver it with **outlined paths**, so no font file is shipped and CSP `font-src` is not touched.
- The I-P-N-I-R rhythm has two I's. Optically balance the I's so the word does not look gappy. Optional (proposal): a subtle continuous-stroke ligature between the two I's as a nod to the fetter. It must stay legible.

**Descriptors (set in the UI sans, not outlined, so they stay translatable text):**
- Web: "evidence library". This is the existing `.tagline` and `.login-sub` wording.
- Desktop: "Bench". This is the existing "GLEIPNIR Bench" window title.

**Lockups**

| Lockup | Composition | Used in |
|---|---|---|
| Horizontal | Mark left, wordmark right. Mark height = 1.4 × wordmark cap height. Gap = 0.5 × mark height. | `TopBar` `.brand`, report header, README |
| Horizontal + descriptor | Horizontal lockup, then a thin divider (1px `--color-brand-on-dark` at 40% opacity), then the descriptor in the UI sans | `TopBar` (replaces `.brand` + `.tagline`), desktop About |
| Stacked | Mark centred above the wordmark, descriptor below. Mark height = 3 × cap height. | `LoginPage` `.login-brand` + `.login-sub` block, splash, social card |

#### Colour versions (each for the mark, the wordmark and all three lockups)

| Version | Ground | Mark / wordmark colour |
|---|---|---|
| Full colour on dark (primary, since the web app is dark) | `--color-bg` | Mark `--color-brand-primary`, wordmark `--color-brand-on-dark` |
| Full colour on light | `--color-paper` | Mark `--color-brand-primary`, wordmark `--color-brand-ink` |
| Monochrome black | Any light ground, print | 100% `--color-print-ink` |
| Reversed white | Any dark or photo ground | 100% white |
| `currentColor` (in-app SVG) | Inherits CSS `color` | `fill="currentColor"`, so the top bar and login can theme it without extra files |

#### Minimum size and clear space

| Item | Min on screen (px) | Min in print (mm) | Clear space (all sides) |
|---|---|---|---|
| Mark alone | 16 (use the pixel-fitted 16 master, not a downscale) | 5 | 0.25 × mark height |
| Horizontal lockup | 96 wide | 25 wide | 0.5 × mark height |
| Horizontal + descriptor | 160 wide | 40 wide | 0.5 × mark height |
| Stacked lockup | 72 wide | 20 wide | 0.5 × mark height |
| Wordmark alone | 64 wide (cap height at least 8px) | 18 wide | 1 × cap height |

**Misuse sheet** (part of the brand guide): do not stretch, recolour with a variant or status token, add effects, rotate, outline the ribbon, place it on busy imagery without the reversed version, or re-typeset the wordmark in a live font.

### 3.6 Web favicon set (frontend)

Placement (proposal): create `frontend/public/` and put the files at its root, so they are served from `/`. Add this to the `<head>` of `frontend/index.html` (proposal):

```html
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta name="theme-color" content="(value of --color-bg)">
<!-- P2 only: <link rel="manifest" href="/site.webmanifest"> -->
```

All files are same-origin, so they pass the CSP as it is (`img-src 'self'`, and the manifest falls back to `default-src 'self'`). **No nginx change is needed.**

- `favicon.svg` embeds `<style>@media (prefers-color-scheme: dark){…}</style>`. It swaps to the reversed mark on dark browser chrome and keeps `--color-brand-primary` on light. It must contain no `<script>`, no external `href`, no raster and no text elements.
- `favicon.ico` is the fallback for browsers that ignore SVG favicons. It contains the 16/32/48 pixel-fitted frames.
- `apple-touch-icon.png` must be **opaque**, with the mark on a `--color-bg` plate and about 15% safe inset. iOS adds its own rounded corners, so the file has square corners and no transparency.
- PWA icons (192/512 + maskable 512) are **P2**. This is a localhost thesis demo and nobody installs it. Produce them only if the authors want a home-screen icon for demo tablets. Maskable safe zone: keep the mark inside the central 80% circle.

### 3.7 Desktop app icon (GLEIPNIR Bench, `orchestration/benchapp.pyw`)

**Differentiation from the web icon.** The same mark is used, so both products read as one family. The **plate differs**: the web icon uses `--color-bg` or transparent with the mark in `--color-brand-primary`, while Bench uses a solid `--color-brand-ink` rounded-square plate with the mark in `--color-brand-on-dark`. At 32px and larger, Bench adds a small **three-bar "bench" badge** in the bottom-right quadrant. The badge must not use variant colours, only `--color-brand-on-dark`. At 16–24px the badge is dropped, because the plate colour alone separates the two when the browser tab and the Bench window share a taskbar.

**ICO frames and where Windows uses them**

| Frame (px) | Used by (Windows 11) | Drawing |
|---|---|---|
| 16 | Title bar at 100% scaling, small icon lists | Pixel-fitted master, no badge |
| 20 | Title bar at 125% | Pixel-fitted, no badge |
| 24 | Title bar at 150%, taskbar at 100% | Pixel-fitted, no badge |
| 32 | Title bar at 200%, taskbar at 125–150%, Alt-Tab | Badge on |
| 40 | Taskbar at 175% | Badge on |
| 48 | Taskbar at 200%, desktop "Medium icons" | Badge on |
| 64 | Explorer tiles and large Alt-Tab at high DPI | Badge on |
| 256 | Desktop shortcut "Large / Extra large icons", Explorer thumbnails. Stored PNG-compressed inside the ICO. | Full-detail master, badge on |

**Implementation notes for the authors** (proposal; code is not part of the design deliverable):
- `root.iconbitmap(default=".../gleipnir-bench.ico")` sets the icon for the root window **and every dialog** ("Run {exp}?", "Plan preview (nothing was run)", "Back up now", "Restore my test data"), because they are Toplevels.
- `root.iconphoto(True, PhotoImage(file=…256.png), PhotoImage(file=…32.png), PhotoImage(file=…16.png))` is the cross-platform fallback. Tk 8.6 reads PNG with alpha natively, and the app already uses `tk.PhotoImage` for History charts.
- Under `pythonw.exe`, Windows groups the taskbar button under the **Python** icon unless the process sets an AppUserModelID first: `ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("Gleipnir.Bench")` before `tk.Tk()`. The file already uses `ctypes.windll` for `SetThreadExecutionState`.
- The desktop shortcut is a user-created `.lnk` targeting `pyw -3.11 benchapp.pyw`, with "Change Icon…" pointing at the same `.ico`. Ship the `.ico` at a stable path, for example `orchestration/assets/gleipnir-bench.ico` (proposal).

### 3.8 Splash and About (proposal)

- **desk-about-dialog-art** (P2): the Bench app has no About today. Proposal: a Help → About dialog with the stacked lockup at 64px mark height, "GLEIPNIR Bench", the git SHA (the thesis cites commits by SHA), the pinned stack line, and "Thesis prototype, not for operational evidence handling". Background `--color-brand-ink`, reversed lockup.
- **desk-splash** (P2): recommend **not building one** unless start-up (matplotlib import plus reading `sweeps.yaml`) measurably exceeds about 1.5 s. If it is built: 480×280 px borderless Toplevel, reversed stacked lockup centred, a one-line status in the UI sans ("Loading sweeps.yaml…"), no progress animation.
- **web**: no splash. The login page *is* the brand moment and uses the stacked lockup (`web-` pages need nothing else).

### 3.9 Court-report print header and seal

The report is printed from the browser (**Print / save as PDF**) on office laser printers and is likely to be photocopied or scanned. Today it prints with no identity.

**brand-print-header** (proposal): a header band at the top of the first `.card`, above the `<h2>`:
- Monochrome horizontal lockup at 8 mm mark height on the left.
- The title "Chain-of-Custody Report" and case id stay live text; they are not part of the asset.
- A 0.5 pt rule below.

**brand-print-seal**: based on Direction C, a **one-colour black** circular seal, 20 mm in diameter (min 16 mm), top right of the header.
- Ring text, outlined: "GLEIPNIR · CHAIN-OF-CUSTODY RECORD · THESIS PROTOTYPE".
- Centre: the Merkle-tree-plus-ribbon glyph.
- It must **not** resemble a notary, court, police or state seal, and must not use the words certified, official or verified. The per-exhibit Merkle verification status is live data on the report, not a brand claim.

Print constraints for both assets:
- 100% `--color-print-ink` on `--color-paper`. No tints, no halftones, no greys: grey dithers badly on laser printers and disappears on photocopies.
- Minimum line weight 0.5 pt, minimum gap 0.3 mm, minimum ring-text cap height 1.4 mm.
- Must be a **foreground** image (`<img src="/brand/print-seal.svg">` or inline SVG), **not** a CSS `background-image`. Browsers skip background graphics in print by default, and the existing `@media print` block already strips backgrounds.
- The header must not be inside `.no-print`. It must render in both screen and print; on screen it sits on the dark `.card`, so an on-dark variant with `currentColor` is needed.
- Must survive A4 and Letter, portrait, at the browser's default margins inside the 820px `.report-page` column.

### 3.10 Social and preview image (proposal)

- **brand-social-card** (P2): 1200×630 PNG for the GitHub repository's social preview and the title slide of the thesis defence. Stacked lockup on `--color-brand-ink`, the line "Chain of custody on Hyperledger Fabric 2.5: four architecture variants, benchmarked", and optionally the four variant names in plain text **without** variant colours. Never add Open Graph meta tags to the app: it runs on localhost, and a card there serves no one.
- **brand-readme-banner** (P2): 1280×320 PNG/SVG, horizontal lockup plus descriptor, for the top of `README.md`. Light and dark variants via `<picture>` with `prefers-color-scheme`.

### 3.11 Thesis and paper figure watermark: recommend none

The matplotlib charts from `orchestration/report.py` (E0–E3, per-operation tables) go into the thesis and paper. **Do not watermark them.** A watermark:
- adds non-data ink on top of mean ± SD error bars and throughput curves,
- can be mistaken for a plotted series,
- breaks the university template and journal figure rules,
- makes the charts look like marketing rather than measurement.

Figure identity comes from the caption and from the provenance in `run.json` (git SHA, `sweeps.yaml` SHA). Record the decision as `brand-figure-watermark`: not produced.

### 3.12 Master files, export pipeline and naming

- **Masters**: `brand/src/*.svg` (proposal, repo root). Each master is a hand-edited, SVGO-optimised SVG: square viewBox, integer coordinates on the 24-unit grid, all text outlined, no `<script>`, no `<foreignObject>`, no external refs, no embedded raster, a `<title>` for accessibility, and no hard-coded size (viewBox only).
- **Pixel-fitted masters**: separate hand-hinted 16 and 32 px SVG or PNG masters. Do not auto-downscale from 256.
- **Exports**:
  - PNGs are 8-bit RGBA sRGB, with no colour profile beyond sRGB.
  - ICO files are built from the pixel-fitted PNGs, with frames at or below 64 stored as BMP and 256 stored as PNG inside the ICO.
- **Destinations** (proposal):
  - Web root files go to `frontend/public/`: `favicon.ico`, `favicon.svg`, `apple-touch-icon.png`, `icon-192.png`, `icon-512.png`, `icon-512-maskable.png`, `site.webmanifest`.
  - Components go to `frontend/src/assets/brand/` (`mark.svg`, `lockup-horizontal.svg`, `lockup-stacked.svg`, `print-header.svg`, `print-seal.svg`). Vite emits them under `/assets/` with hashed names, which fall under `img-src 'self'`.
  - Desktop files go to `orchestration/assets/`: `gleipnir-bench.ico`, `gleipnir-bench-256.png`, `-48.png`, `-32.png`, `-16.png`.
- **Accessibility**: in-app lockups get `alt="GLEIPNIR"`, or `aria-label` when inline. The visible "evidence library" text stays live text. The mark alone is `alt=""` when the wordmark text is adjacent.

### 3.13 Asset table

| ID | Category | Where used | Purpose | Variants / states | Size & format | Priority |
|---|---|---|---|---|---|---|
| brand-concept-board | Exploration | Author decision only | Choose the logo direction (A Silk Fetter, B Custody Link, C Merkle Seal) | 3 directions × {dark, light, mono} × {256, 32, 16 px} | 1 board, 1920×1080 PNG + SVG per concept | P0 |
| brand-mark | Logo mark | Top bar, login, favicons, desktop icon, report header | Primary identity; the unbroken custody line | Full colour on dark / on light, `currentColor` | SVG master (24-unit square viewBox) + PNG 16/32/64/128/256/512 | P0 |
| brand-mark-16 | Logo mark (pixel-fitted) | `favicon.ico` 16, Bench ICO 16/20/24 | Crisp at the smallest sizes | Dark plate, light plate, transparent | Hand-hinted 16×16 and 24×24 PNG + SVG | P0 |
| brand-mark-mono-black | Logo mark | Print, photocopies, faxed reports | One-colour black silhouette | Single state | SVG + PNG 512 | P0 |
| brand-mark-reversed | Logo mark | Dark grounds, Bench plate, social card | One-colour white silhouette | Single state | SVG + PNG 512 | P0 |
| brand-wordmark | Wordmark | Top bar `.brand`, login `.login-brand`, lockups | "GLEIPNIR" in outlined, tracked caps | On dark, on light, mono black, reversed, `currentColor` | SVG (outlined paths) + PNG at 2× | P0 |
| brand-lockup-horizontal | Lockup | `TopBar` (replaces `.brand` text), report header, README | Mark + wordmark on one line | 4 colour versions + `currentColor` | SVG; screen min 96 px wide | P0 |
| brand-lockup-horizontal-descriptor | Lockup | `TopBar` (replaces `.brand` + `.tagline`), desktop About | Lockup + "evidence library" or "Bench" (live text) | Web / desktop descriptor × 4 colour versions | SVG (mark + wordmark) + CSS text; min 160 px wide | P1 |
| brand-lockup-stacked | Lockup | `LoginPage` (replaces `.login-brand` + `.login-sub`), splash, social card | Centred identity for entry screens | 4 colour versions + `currentColor` | SVG; min 72 px wide | P1 |
| brand-clearspace-guide | Guideline | Designer and implementer handoff | Minimum sizes, clear space, misuse sheet | Single sheet | 1 page, PDF + PNG | P1 |
| brand-favicon-svg | Favicon | Browser tabs, bookmarks (`/favicon.svg`) | Tab identity; adapts to dark browser chrome | Light / dark via embedded `prefers-color-scheme` | SVG ≤ 2 KB, no script | P0 |
| brand-favicon-ico | Favicon | Browser fallback (`/favicon.ico`) | Tab identity where SVG favicons are unsupported | Frames 16, 32, 48 | ICO | P0 |
| brand-apple-touch-icon | Favicon | iOS/iPadOS home screen, Safari pinned tab (`/apple-touch-icon.png`) | Demo tablets | Opaque `--color-bg` plate | 180×180 PNG, opaque, square corners | P1 |
| brand-pwa-icon-192 | PWA icon (proposal) | `site.webmanifest` | Android / desktop install | `purpose: any` | 192×192 PNG | P2 |
| brand-pwa-icon-512 | PWA icon (proposal) | `site.webmanifest`, install splash | Android / desktop install | `purpose: any` | 512×512 PNG | P2 |
| brand-pwa-icon-512-maskable | PWA icon (proposal) | `site.webmanifest` | Adaptive icon masks | `purpose: maskable`, mark inside the 80% safe circle | 512×512 PNG | P2 |
| brand-webmanifest | Config (proposal) | `/site.webmanifest` | Name "GLEIPNIR", short_name "GLEIPNIR", theme/background from `--color-bg` | Single | JSON | P2 |
| desk-app-icon-ico | App icon | Bench title bar and every dialog (`iconbitmap(default=…)`), taskbar, Alt-Tab, desktop shortcut `.lnk` | Replace the stock Python/Tk icon | Frames 16/20/24 (no badge) and 32/40/48/64/256 (with the bench badge) on a `--color-brand-ink` plate | Multi-frame ICO (256 PNG-compressed) | P0 |
| desk-app-icon-png | App icon | `root.iconphoto(True, …)` fallback | Tk photo icon | 256, 48, 32, 16 | RGBA PNG ×4 | P0 |
| desk-badge-bench | Icon modifier | Bench icon frames ≥ 32 px, About dialog | Tell Bench apart from the web tab in the taskbar | On `--color-brand-ink` only | SVG component on a 24-unit grid | P1 |
| brand-print-header | Print mark (proposal) | `CoCReportPage` first card, above "Chain-of-Custody Report", screen + print | Identity on the printed and PDF court report | Print (`--color-print-ink` on `--color-paper`), on-screen (`currentColor` on the dark `.card`) | SVG; 8 mm mark height; foreground image, not a CSS background | P1 |
| brand-print-seal | Print mark | `CoCReportPage` header, top right | Tamper-evident-record identity that survives laser printing and photocopying; no official-seal connotation | Mono black only; ring text "GLEIPNIR · CHAIN-OF-CUSTODY RECORD · THESIS PROTOTYPE" | SVG, 20 mm diameter (min 16 mm), line weight ≥ 0.5 pt | P1 |
| desk-about-dialog-art | About (proposal) | Bench Help → About | Name, git SHA, pinned stack, prototype disclaimer | Reversed on `--color-brand-ink` | 64 px mark, PNG for Tk + SVG master | P2 |
| desk-splash | Splash (proposal) | Bench start-up, only if start-up exceeds about 1.5 s | Covers matplotlib import time | Reversed stacked lockup + one status line | 480×280 PNG | P2 |
| brand-social-card | Social (proposal) | GitHub repo social preview, defence title slide | Project identity outside the app | Dark only | 1200×630 PNG | P2 |
| brand-readme-banner | Social (proposal) | Top of `README.md` | Repo identity | Light / dark via `<picture>` | 1280×320 PNG + SVG | P2 |
| brand-figure-watermark | Decision | Thesis and paper figures from `report.py` | Recorded decision: **not produced** (non-data ink, template rules, could be mistaken for a series) | None | None | Not produced |

### Checklist

- [ ] brand-concept-board — three directions (Silk Fetter, Custody Link, Merkle Seal) at 256/32/16 px, dark/light/mono
- [ ] brand-mark — primary mark, SVG master + PNG exports, full colour and `currentColor`
- [ ] brand-mark-16 — hand-hinted 16/24 px masters for favicon and title bar
- [ ] brand-mark-mono-black — one-colour black silhouette for print
- [ ] brand-mark-reversed — one-colour white silhouette for dark grounds
- [ ] brand-wordmark — outlined, tracked "GLEIPNIR" in all colour versions
- [ ] brand-lockup-horizontal — mark + wordmark for the top bar, report header and README
- [ ] brand-lockup-horizontal-descriptor — lockup + "evidence library" / "Bench"
- [ ] brand-lockup-stacked — centred lockup for the login page, splash and social card
- [ ] brand-clearspace-guide — minimum sizes, clear space and misuse sheet
- [ ] brand-favicon-svg — `/favicon.svg` with a dark-chrome media query
- [ ] brand-favicon-ico — `/favicon.ico` with frames 16/32/48
- [ ] brand-apple-touch-icon — 180 px opaque PNG
- [ ] brand-pwa-icon-192 — PWA icon (proposal, P2)
- [ ] brand-pwa-icon-512 — PWA icon (proposal, P2)
- [ ] brand-pwa-icon-512-maskable — maskable PWA icon (proposal, P2)
- [ ] brand-webmanifest — `site.webmanifest` (proposal, P2)
- [ ] desk-app-icon-ico — Bench ICO with frames 16/20/24/32/40/48/64/256
- [ ] desk-app-icon-png — Bench PNGs 256/48/32/16 for `iconphoto`
- [ ] desk-badge-bench — three-bar modifier for Bench icon frames of 32 px and up
- [ ] brand-print-header — monochrome report header lockup (proposal)
- [ ] brand-print-seal — 20 mm black seal for the Chain-of-Custody Report
- [ ] desk-about-dialog-art — Bench About dialog art (proposal, P2)
- [ ] desk-splash — Bench splash, only if start-up is slow (proposal, P2)
- [ ] brand-social-card — 1200×630 repo and defence card (proposal, P2)
- [ ] brand-readme-banner — README header banner (proposal, P2)
- [ ] brand-figure-watermark — decision recorded: not produced

---

## 4. Web app: layout, navigation & library screens

Scope: the authenticated SPA shell, the login page, and the library screens an investigator uses every day: My cases, Case detail, Ingest, Search, Not found and Not authorized. Evidence detail, the CoC report, the lead dashboard and the admin pages have their own sections. This section only covers how the navigation reaches them. The current code is `frontend/src/App.tsx`, `components/Layout/{TopBar,Sidebar}.tsx`, `auth/*`, `components/ui/{Badge,Modal,Stepper,Tabs,Timeline}.tsx`, `pages/investigator/{MyCasesPage,CaseDetailPage,IngestPage,SearchPage}.tsx` and `pages/shared/*`.

Colour tokens used below (all defined in the Foundations section): `--color-bg`, `--color-surface-panel`, `--color-surface-card`, `--color-border`, `--color-text`, `--color-text-muted`, `--color-accent`, `--color-success`, `--color-warning`, `--color-danger`, `--color-overlay`, `--color-focus-ring`, and the semantic sets `--color-role-*`, `--color-case-role-*`, `--color-case-status-*`, `--color-evidence-status-*`, `--color-flag-*`, `--color-category-*`. Today's CSS maps to them like this: `--bg`→`--color-bg`, `--panel`→`--color-surface-panel`, `--card`→`--color-surface-card`, `--line`→`--color-border`, `--muted`→`--color-text-muted`, `--accent`→`--color-accent`, `--ok`→`--color-success`, `--bad`→`--color-danger`. The hard-coded `#c9a227` is `--color-warning`, and the hard-coded hover/active fill `#223449` is `--color-accent` at 15% alpha.

### 4.1 Global constraints that shape every asset

- **The CSP decides how assets are delivered.** nginx sends `default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; font-src` (inherits `'self'`). That rules out icon CDNs and Google Fonts at runtime. Icons ship as **inline SVG React components** or a **self-hosted SVG sprite**. Fonts, if any, are self-hosted WOFF2. Illustrations are inline SVG or same-origin files.
- **No new runtime dependencies.** `package.json` lists only react, react-dom and react-router-dom. Deliver icons as raw SVG source, not as an icon-font package.
- **Icon grammar comes from the one icon in the code.** `LoginPage.tsx`'s `EyeIcon` uses a 24×24 viewBox, `fill="none"`, `stroke="currentColor"`, `strokeWidth 1.8` and round caps and joins. Every `web-icon-*` must follow it: 24 px grid, 2 px padding, 1.8 px stroke that inherits colour, no fills except small dots. Render sizes are 16 px (inline, table, chip), 20 px (buttons, sidebar) and 24 px (headers, stepper).
- **Dark first, print light.** The app is dark (`--color-bg`). `@media print` swaps to a white page and hides `.topbar`, `.sidebar`, `.foot` and all buttons, so no asset may carry meaning only through colour.
- **Timestamps** are always `YYYY-MM-DD HH:mm:ss UTC` (`lib/format.ts formatTs`), with the raw ISO in a `title` tooltip. Missing values render as an em dash "—".
- **Identifiers** (evidence ids, `CASE-<uuid>`, ni-URI proofs, txIds) are monospace and may wrap with `word-break: break-all`.
- **Current state of the kit:** no icons (text glyphs `▸ ▾ × ✕ ✓ →` stand in), no avatars, no toasts, no illustrations, no responsive breakpoints. Everything that replaces those is marked (proposal).

### 4.2 App shell

**Structure (`App.tsx Shell`):** a column-flex `.app` with **TopBar** (full width), then `.body` (**Sidebar** 190 px, fixed, plus `main.content` padded 18 px), then a **footer** strip. `RequireAuth` wraps the shell. The CoC report route `/cases/:caseId/report` sits **outside** the shell (no chrome) and is covered in its own section.

**Routes and guards**

| Path | Page | Guard | Nav entry |
|---|---|---|---|
| `/login` | LoginPage | none (redirects away if signed in) | none |
| `/` | redirects to `/cases` | RequireAuth | none |
| `/ingest` | IngestPage | RequireAuth | Library › Ingest evidence |
| `/cases` | MyCasesPage | RequireAuth | Library › My cases |
| `/cases/:caseId` | CaseDetailPage | RequireAuth (server 404s non-participants) | none (highlights My cases, proposal) |
| `/evidence/:evidenceId` | EvidenceDetailPage | RequireAuth | none |
| `/search` | SearchPage | RequireAuth | Library › Search |
| `/lead/dashboard` | LeadDashboardPage | RequireRole lead, admin | Lead › Dashboard (lead only in the code; admin reaches it by URL) |
| `/admin/users` | UsersPage | RequireRole admin | Administration › Users |
| `/admin/cases` | CasesAdminPage | RequireRole admin | Administration › Case admin |
| `/unauthorized` | UnauthorizedPage | RequireAuth | none |
| `*` | NotFoundPage | RequireAuth | none |

#### 4.2.1 TopBar (`.topbar`)

- **Left:** the wordmark "GLEIPNIR" (bold, letter-spacing 2 px) and the muted tagline "evidence library". Needs `web-topbar-brand-lockup`: the brand wordmark plus a small mark, 24 px tall, and clicking it goes to `/cases` (proposal; it is not a link today). It reuses the `brand-*` wordmark and mark from the Brand section.
- **Right (`.whoami`):** a pill "`{name || username} · {role}`" followed by a "Sign out" button.
  - Today the pill prints the **wire value** (`admin` / `lead` / `investigator`). Proposal: show `ROLE_LABELS` (System Administrator / Lead Investigator / Investigator) as `web-badge-role-*`, next to `web-avatar-initials`.
  - Proposal: turn the pill into a user menu (`web-icon-chevron-down`) holding the full name, username and role badge, plus "Sign out" with `web-icon-sign-out`.
- **States**
  - Signed-in: always shown.
  - Signing out: the button is disabled with `web-spinner-inline` (proposal; there is no busy state today). Logout never fails visibly, because a dead server session is cleared locally.
  - Session dropped: any 401 clears the session and RequireAuth bounces to `/login`.

#### 4.2.2 Sidebar (`.sidebar`, role-aware)

Groups have uppercase 11 px muted titles. Links are muted by default, `--color-text` on hover, and the active link gets an `--color-accent` 15% fill. Proposal for the active item: a 3 px `--color-accent` left rail plus the icon tinted `--color-accent`.

| Group title | Label (exact) | Route | Visible to | Icon asset |
|---|---|---|---|---|
| Library | Ingest evidence | `/ingest` | all | `web-icon-nav-ingest` (tray with an up arrow) |
| Library | My cases | `/cases` (`end`) | all | `web-icon-nav-cases` (case folder) |
| Library | Search | `/search` | all | `web-icon-nav-search` (magnifier) |
| Lead | Dashboard | `/lead/dashboard` | `lead` only | `web-icon-nav-lead-dashboard` (gauge / 2×2 tiles) |
| Administration | Users | `/admin/users` | `admin` only | `web-icon-nav-users` (two heads) |
| Administration | Case admin | `/admin/cases` | `admin` only | `web-icon-nav-case-admin` (folder with a gear) |

- **Role-dependent rendering**
  - Investigator sees Library only.
  - Lead sees Library and Lead.
  - Admin sees Library and Administration. The route allows admins onto `/lead/dashboard`, but the Sidebar does not link it. Proposal: show the Lead group to admins too.
- **Responsive (proposal):** below 900 px the sidebar becomes an off-canvas drawer opened by `web-icon-menu` in the TopBar. Below 600 px the TopBar hides the tagline. Content keeps a 16 px side gutter with no horizontal page scroll, and wide tables scroll inside their card.
- **Collapsed rail (proposal, P2):** a 56 px icon-only rail with a tooltip per item, toggled by `web-icon-sidebar-collapse`.
- **Counts (proposal, P2):** a numeric badge on "My cases" showing open cases, using the `web-count-badge` style.

#### 4.2.3 Footer (`.foot`)

The static string is "Talks only to the API gateway · Hyperledger Fabric 2.5 LTS · localhost thesis demo". Keep it verbatim and muted at 12 px. There is also a matching `.login-foot` on the login page. No asset is needed. Proposal P2: a small `web-icon-shield-gateway` glyph before it.

#### 4.2.4 Shell-level states

- **Restoring session** (RequireAuth, `!ready`): today it shows the text "Restoring session…". Proposal: a centred `web-spinner` (32 px) with the text under it, in the content area with the shell hidden.
- **Unauthenticated:** redirect to `/login` with `state.from`, so the user returns to the deep link after signing in.
- **Session expired mid-use (proposal):** because a 401 silently returns the user to login, add a dismissible `web-alert-inline` (info) on the login card: "Your session ended — sign in again." Use `web-icon-clock`.

### 4.3 Login (`/login`, `auth/LoginPage.tsx`)

**Audience:** everyone. **Purpose:** exchange username and password for a session token, stored in sessionStorage so it dies with the tab.

**Layout:** a full-viewport `.login-wrap` with a radial-gradient backdrop, a centred 372 px card with 12 px radius and a deep shadow, and the footer line below it.

**Elements, in order**
1. `.login-brand` "GLEIPNIR": 20 px, letter-spacing 4 px, centred. Proposal: put `brand-mark` (48 px) above it.
2. Subtitle "Evidence library · sign in to continue".
3. Field "Username": autofocus, no autocapitalise, no spellcheck.
4. Field "Password", with an eye toggle inside the field on the right. Its aria-label and title switch between "Show password" and "Hide password", and it is not a tab stop. It uses `web-icon-eye` / `web-icon-eye-off`, which replace the inline `EyeIcon`.
5. Primary button "Sign in" at full width. It reads "Signing in…" while busy.
6. Error line under the button (`.err.login-err`, centred).

**States and copy (exact)**

| State | Trigger | UI |
|---|---|---|
| Idle, empty | first load | Sign in disabled until both fields are non-empty |
| Busy | submit | button disabled, label "Signing in…", plus `web-spinner-inline` (proposal) |
| 401 | bad credentials | "Invalid username or password." |
| 429 | throttle | "Too many failed attempts — wait a moment and try again." Use `web-icon-clock` (proposal) |
| 503 | login not configured | "User login is not configured on this gateway." |
| Network | anything else | "Could not reach the gateway. Is the network up?" Use `web-icon-offline` (proposal) |
| Already signed in | `ready && user` | immediate redirect to `from`, or `/cases` |

- **Error rendering:** proposal to show errors as `web-alert-inline` (error) with `web-icon-alert`, not as bare red text.
- **Assets:** `web-login-backdrop` is a subtle, low-contrast motif behind the card. Proposal: a thin braided or ribbon line pattern that alludes to the Gleipnir fetter, at no more than 6% opacity on `--color-bg`, as an SVG no larger than 8 KB. `web-icon-eye`, `web-icon-eye-off`, `web-icon-alert` and `web-spinner-inline` are also used here.
- **Accessibility:** a visible `--color-focus-ring` on inputs; today the focus colour is accent-bordered. The error is linked to the form with `aria-live="polite"` (proposal).

### 4.4 My cases (`/cases`, `MyCasesPage.tsx`)

**Audience:** all roles. The list is scoped server-side: participants see their own cases and admins see every case. **Purpose:** the home page, which lists cases, filters them and opens one. Leads and admins also create cases here.

**Layout**
- **Filter card:** the heading "My cases" on the left and the "New case" button on the right. The button only renders for `admin` and `lead`.
- **Filter row:**
  - Search text input labelled "search", placeholder "name / description". It uses `web-icon-search` as a leading glyph (proposal).
  - Select "status" with the options `any`, `OPEN`, `CLOSED`, `ARCHIVED`.
  - Button "Filter" with `web-icon-filter` (proposal). It refreshes, but both inputs also refetch on change.
  - An inline error line below the row.
- **Results card:** table `.runs`. Rows are `.clickable` with a hover fill. The case name is a link to the case.

**Columns (current → proposed header with unit)**

| Current | Proposed header | Cell |
|---|---|---|
| name | Name | link, `--color-accent` |
| status | Status | `web-pill-case-status-{open,closed,archived}` (today OPEN is green `.pill.active` and the others are neutral) |
| my role | My role | `web-badge-case-role-{viewer,contributor,lead}` (Case Lead uses the warn tone, the others muted) or "—" |
| created by | Created by | username. Proposal: add `web-avatar-initials` at 20 px |
| updated | Updated (UTC) | `YYYY-MM-DD HH:mm:ss UTC`, muted, 11 px |

- **Sorting (proposal, P1):** clickable headers with `web-icon-sort` (neutral), `web-icon-sort-asc` and `web-icon-sort-desc`. The default is Updated (UTC), descending.
- **Row affordance (proposal):** a trailing `web-icon-chevron-right`, and the whole row is clickable (today only the name link is).

**States**
- **Loading.** Today it wrongly shows the empty message while the fetch is in flight. Proposal: 5 × `web-skeleton-row`.
- **Empty (no cases):** "No cases yet. A lead or admin grants case access." with `web-illus-empty-cases` (an empty case folder on a shelf, 160×120). For lead and admin, proposal to add a "New case" CTA.
- **Empty after filter (proposal):** "No cases match the filters." with `web-illus-no-results` and a "Clear filters" link.
- **Error:** the inline `.err` text in the format `"{status}: {body}"` from `useErr`. Proposal: `web-alert-inline` (error).

**Modal "New case"** (`web-modal-chrome`)
- **Fields:** "name" (required), "description", and, for **admin only**, "lead (username, optional)" with placeholder "hand the case to a lead".
- **Lead-only hint:** "You will be added to the roster as the case lead."
- **Buttons:** "Create case" (primary; disabled while name is empty) and "Cancel" (secondary).
- **Errors:** inline error inside the modal.
- **Success:** the modal closes and the list refreshes. Proposal: `web-toast` (success) "Case created" with a link to the new case.
- **Icons:** `web-icon-add` on the "New case" button.

### 4.5 Case detail (`/cases/:caseId`, `CaseDetailPage.tsx`)

**Audience:** case participants and admins. **Purpose:** one case's workspace, with three tabs: Overview (description, report, Categories, Team), Evidence and Activity.

**Header card**
- The case name (h3) sits on the left and the status pill on the right: `web-pill-case-status-*`.
- **Meta line:**
  - `CASE-<uuid>` in mono 11 px. Proposal: add `web-icon-copy` with the tooltip "Copy case id", then a `web-toast` "Copied".
  - "created by {user}" (proposal: with `web-avatar-initials` at 16 px).
  - The created timestamp in UTC.
- **Tabs (`.tabs`)**
  - Labels: "Overview", "Evidence ({n})", "Activity".
  - Styling: a 2 px `--color-accent` underline on the active tab; muted text that brightens to `--color-text` on hover.
  - Keyboard: roving tabIndex, and Arrow keys, Home and End move between tabs.
  - Proposal: a 16 px leading icon per tab (`web-icon-tab-overview`, `web-icon-tab-evidence`, `web-icon-tab-activity`), and the count moved into a `web-count-badge` pill: "Evidence [12]".
  - The code already supports a `hidden` flag for role-gated tabs.

**Page states**

| State | Trigger | UI (current copy) | Asset |
|---|---|---|---|
| Loading | first fetch | "Loading case…" | `web-skeleton-case-header` + `web-skeleton-row` (proposal) |
| Not found / not participant | 404 | "Case not found — or you are not a participant." | `web-illus-not-found-case` (a folder with a question mark) and a "Back to my cases" link (proposal) |
| Other error | anything else | raw error string | `web-alert-inline` (error) |

#### 4.5.1 Overview tab

- **Description:** shown as text, or the muted "No description." when empty.
- **Report button:** "CoC report (print / CSV)" links to `/cases/:id/report`. It uses `web-icon-report` (a document with a seal/ribbon). Everyone who can see the case sees it.
- **Disclosure sections:**
  - The toggles use the text glyphs `▸` / `▾`, which become `web-icon-chevron-disclosure` (rotating 90°, 150 ms).
  - The headers read "Categories ({n})" and "Team ({n})".
  - Both are collapsed by default and carry `aria-expanded`.

**Categories section**
- **Chips:** one chip per category name. Proposal: every chip carries a leading 16 px category icon: `web-chip-category` combined with `web-icon-cat-*`.
- **Delete control:** a trailing `×` on each chip with the title "Delete category (refused while evidence references it)". It shows only when the viewer can manage the case, and uses `web-icon-remove-chip`.
- **Empty:** "None yet — the case lead defines the taxonomy."
- **Add preset** (manager only): the muted label "add preset:" followed by chips "+ {Preset}" for each missing preset. Proposal: use the dashed-outline `web-chip-category` variant "add", with `web-icon-add` at 12 px. The presets, in this exact order, are **Image, Video, Audio, Text, Document, PDF, Spreadsheet, Archive, Other**.
- **Custom:** a text input (placeholder "new category name"; Enter submits) and the button "Add category", disabled while the input is blank.
- **Errors:** inline error, e.g. a 409 when deleting a referenced category. Proposal: a `web-modal-confirm` before delete, because today delete fires immediately.

**Category icon set** (`web-icon-cat-*`, one per preset, plus custom)

| Preset | Asset | Glyph idea | Token |
|---|---|---|---|
| Image | `web-icon-cat-image` | picture frame with mountain | `--color-category-image` |
| Video | `web-icon-cat-video` | film frame / play | `--color-category-video` |
| Audio | `web-icon-cat-audio` | waveform | `--color-category-audio` |
| Text | `web-icon-cat-text` | lines of text | `--color-category-text` |
| Document | `web-icon-cat-document` | page with folded corner | `--color-category-document` |
| PDF | `web-icon-cat-pdf` | page with "PDF" tab | `--color-category-pdf` |
| Spreadsheet | `web-icon-cat-spreadsheet` | grid page | `--color-category-spreadsheet` |
| Archive | `web-icon-cat-archive` | zipped box | `--color-category-archive` |
| Other | `web-icon-cat-other` | three dots in a page | `--color-category-other` |
| custom (any lead-defined name) | `web-icon-cat-custom` | tag | `--color-category-custom` |

Chip colour is a tint only. The label text is always present, so meaning never depends on hue.

**Team section (participants roster)**
- **Add participant** (manager only): a button with `web-icon-user-add`. It lazily loads the user directory.
- **Each row:**
  - `userId`. Proposal: preceded by `web-avatar-initials` at 24 px.
  - The case role badge: `web-badge-case-role-*` with the labels **Viewer**, **Contributor** and **Case Lead**.
  - Manager only: a role `<select>` (aria-label "role of {user}") and a "Remove" button. Proposal: `web-icon-remove-user` and a confirm modal, because today removal is immediate.
- **Empty:** "No participants yet."
- **Manager hint (exact):** "Viewer = view/export · Contributor = + add evidence & annotations · Case Lead = everything incl. removal & this roster. A case keeps at least one lead." Proposal: render it as `web-roles-legend`, three badge-plus-text rows.
- **Errors:** inline error, e.g. the server refusing to remove the last lead.
- **Role gate:** the viewer can manage the team and categories if their global role is `admin` or their case role is `lead`. Everyone else gets a read-only view with no controls, not disabled controls.

**Modal "Add participant"**
- **"user" select:** placeholder "— pick a user —". Options read `username — Name (role)`. The list excludes current participants and, when the chosen role is Case Lead, includes only global-lead users.
- **Empty hints (exact):** "No global-lead users are available to add." / "Every active user is already on this roster."
- **"role in case" select:** Viewer / Contributor / Case Lead. Switching to Case Lead clears a user who is not a lead.
- **Buttons:** "Grant access" (disabled until a user is picked) and "Cancel". Inline error.
- **Proposal:** a `web-toast` (success) "{user} added as {Case role}".

#### 4.5.2 Evidence tab (evidence roster)

**Filter bar**
- Text filter, placeholder "filter: id, item, filename", with `web-icon-search`.
- Select "any category" plus the case categories. Proposal: an icon in the options list via a custom listbox, P2.
- Select "any flag" / "High priority" / "Processed" / "Needs lead review", with `web-icon-flag`.
- Select "any status" / "ACTIVE" / "DISPOSED".
- Button "Export CSV ({n})", disabled when 0 rows match. It uses `web-icon-export-csv`.
  - The export is client-side and covers exactly the filtered rows.
  - Proposal: a `web-toast` "Exported {n} rows".
- Proposal: `web-icon-close` as a "Clear filters" button when any filter is set.

**Table columns (current → proposed header with unit)**

| Current | Proposed header | Cell / asset |
|---|---|---|
| item | Item | `ITEM-NNN` label or "—" |
| evidence | Evidence ID | mono link to `/evidence/:id` |
| file | File | original filename. Proposal: leading `web-icon-cat-*` resolved from the category or MIME family |
| category | Category | `web-chip-category` (compact, 20 px) or "—" |
| flag | Flag | `web-badge-flag-high-priority` (danger), `web-badge-flag-processed` (success), `web-badge-flag-needs-lead-review` (warning), or "—" |
| size | Size (B / KiB / MiB) | auto-scaled, 1 decimal |
| uploaded by | Uploaded by | username (+ avatar 20 px, proposal) |
| status | Status | `web-pill-evidence-status-active` / `web-pill-evidence-status-disposed`. The legacy `REMOVED` value renders the same as DISPOSED; nothing is deleted |

**States**
- **Empty (no evidence):** "Nothing assigned to this case yet." with `web-illus-empty-evidence` (an empty evidence bag). Proposal: an "Ingest evidence" CTA for contributors, leads and admins.
- **Filtered empty:** "No evidence matches the filters." with `web-illus-no-results`.
- **Sorting:** proposal P1, using the `web-icon-sort*` set as on My cases.

**Where flags and notes live:** the flag chooser (chips) and the "Examiner notes" tab are on **Evidence detail** (another section). On Case detail, flags appear as this column and filter. Notes and flag changes appear only as Activity events (`NOTE_ADDED`, `FLAG_CHANGED`). Proposal P2: a note-count glyph (`web-icon-note` plus a number) in the roster.

#### 4.5.3 Activity tab (case audit log)

**Timeline (`components/ui/Timeline`)**
- A vertical rail with a 23 px dot per event. The dot tone comes from `lib/activity.ts`.
- Each row holds the sentence, an optional evidence-id link (mono) and the timestamp (UTC, muted 11 px, ISO tooltip).
- The dot `marker` slot is empty today. Proposal: a 14 px event glyph inside the dot.

**States**
- Loading: "Loading activity…". Proposal: `web-skeleton-timeline`.
- Empty: "No activity yet." with `web-illus-empty-activity` (P2).
- A fetch error falls back to the empty state today. Proposal: `web-alert-inline` (error).

**Event types, their tones and the marker glyphs needed** (`web-icon-activity-*`)

| Type | Rendered sentence (from `activityLine`) | Tone | Glyph asset |
|---|---|---|---|
| CASE_CREATED | "{actor} created the case" | success | `web-icon-activity-case-created` |
| CASE_UPDATED | "{actor} updated the case (status X)" | accent | `web-icon-activity-case-updated` |
| PARTICIPANT_ADDED | "{actor} added {user} as {role}" | accent | `web-icon-user-add` (reuse) |
| PARTICIPANT_REMOVED | "{actor} removed {user} from the team" | muted | `web-icon-remove-user` (reuse) |
| PARTICIPANT_ROLE_CHANGED | "{actor} changed {user}'s role: a → b" | accent | `web-icon-activity-role-changed` |
| CATEGORY_CREATED / RENAMED / DELETED | "…added / renamed / deleted category …" | accent / accent / muted | `web-icon-cat-custom` (reuse) plus overlay +/✎/× (`web-icon-activity-category`) |
| EVIDENCE_ADDED / ASSIGNED | "…added evidence ITEM-NNN" / "…assigned evidence to the case" | success | `web-icon-activity-evidence-in` |
| EVIDENCE_UNASSIGNED | "…unassigned evidence from the case" | muted | `web-icon-activity-evidence-out` |
| EVIDENCE_REMOVED | "…removed evidence ITEM-NNN" | muted | `web-icon-activity-evidence-disposed` |
| EVIDENCE_DETAILS_UPDATED | "…updated evidence details (fields)" | accent | `web-icon-edit` (reuse) |
| FLAG_CHANGED | "…flagged evidence: X" / "…cleared the evidence flag" | accent | `web-icon-flag` (reuse) |
| NOTE_ADDED | "…added an examiner note" | muted | `web-icon-note` (reuse) |
| unknown | "{actor}: {TYPE}" | accent | `web-icon-activity-generic` |

- **EVIDENCE_REMOVED copy (proposal):** this event means "left the case roster" and fires when evidence becomes DISPOSED. Change the copy to "{actor} disposed evidence ITEM-NNN (left the case roster)". Nothing is deleted.
- **Filter chips (proposal P2):** filter the timeline by All / Team / Categories / Evidence / Flags & notes.

### 4.6 Ingest evidence (`/ingest`, `IngestPage.tsx`)

**Audience:** anyone with a writable case (Contributor, Case Lead, or admin), and any user for the uncategorized bucket. **Purpose:** a forensic ingest wizard. The browser hashes the file locally (SHA-256, RFC 6920 ni-URI) **before** upload. After upload it compares that hash with the server's `integrityProof`. Binaries are stored off-chain and the CREATE event goes to the ledger.

**Layout:** `.page-narrow` (max 560 px), one card, the title "Ingest evidence", then the Stepper, the step body and the button row (Back / Next / Submit).

#### 4.6.1 Stepper (`components/ui/Stepper`)

**Steps (exact labels):**
1. "Case & category"
2. "Metadata"
3. "File & hash"
4. "Review & submit"

**Step states and assets**

| State | Current rendering | Proposed asset |
|---|---|---|
| upcoming | numbered dot, muted border | `web-stepper-dot` (upcoming) showing the number |
| active | accent border and number, `aria-current="step"` | `web-stepper-dot` (active) showing the step icon: `web-icon-step-case` (folder + tag), `web-icon-step-metadata` (form/list), `web-icon-step-file-hash` (file + fingerprint), `web-icon-step-review` (checklist) |
| done | success border with "✓" | `web-stepper-dot` (done) showing `web-icon-check` |
| error (proposal) | none | `web-stepper-dot` (error) with `web-icon-alert`, `--color-danger`. Use it when hashing fails on step 3 |

- **Connectors:** a 1 px `--color-border` line between steps. Proposal: `--color-success` once the preceding step is done.
- **Narrow layout:** below 600 px, labels hide except on the active step (proposal).
- **Step navigation:** you can only move between steps with the Back and Next buttons. Clicking a completed step to jump back is a P2 proposal.

#### 4.6.2 Step bodies

**Step 1, Case & category**
- **Select "case":**
  - The first option is exactly "— uncategorized (visible to you and admins only) —".
  - The other options are the writable cases, shown as "{name} ({status})".
  - Proposal: a custom listbox with `web-pill-case-status-*` and `web-badge-case-role-*` per option.
- **Select "category":** appears only once a case is picked. Options are "— none —" plus the case categories. Proposal: render them as selectable `web-chip-category` tiles with `web-icon-cat-*` (a 3-column grid of 88×64 tiles).
- **Hint when a case has no categories:** "This case has no categories yet — the case lead defines them."
- **No writable cases (proposal):** show the hint "You are a Viewer on all your cases — only uncategorized ingest is available."

**Step 2, Metadata**
- "item label": auto-suggested as the next `ITEM-NNN` in the case, placeholder "ITEM-001".
- "seizure date & time": native `datetime-local`. Proposal: the helper text "entered in local time; stored as UTC".
- "acquisition location / source": placeholder `e.g. "Suspect’s bedroom, desk"`. It uses `web-icon-location` (P2).
- "handed over by (optional)": placeholder "who passed this to you".
- "evidence id (optional — generated if blank)": placeholder "ev-exhibit-001".
- None of these fields is required. Next is always enabled on this step.

**Step 3, File & hash**
- **Current UI:** a native `<input type="file">` labelled "file".
- **Upload dropzone (proposal):** `web-upload-dropzone` is a dashed 2 px `--color-border` box, 100% × 180 px, with `web-illus-dropzone` (48–64 px art: an evidence bag or tray with an up arrow), the text "Drop a file here or browse", and a keyboard-focusable "Browse" button. It has five states:
  - **idle**
  - **drag-over:** `--color-accent` border and 8% tint
  - **reading/hashing:** a progress bar
  - **hashed:** `--color-success` border, a filename/size row and `web-icon-cat-*` for the type
  - **error:** `--color-danger` border
- **Hash progress:** "Hashing locally… {pct}%" becomes `web-progress-bar` (determinate, 4 px, `--color-accent`), with the percentage shown to the right.
- **Result:** a kv row "local SHA-256" showing the ni-URI in mono small. Proposal: `web-icon-fingerprint` before it and `web-icon-copy` after it.
- **Hash error:** "local hashing failed: {message}" as `web-alert-inline` (error). The Stepper goes to its error state.
- **Explanatory hint (exact):** "The hash is computed in your browser before upload; after the server stores the bytes, its proof is compared against this value." Proposal: `web-icon-info`.
- **Disabled:** Next is disabled until a file is chosen and hashing has either finished or failed.
- **Replace file (proposal):** a "Choose another file" link with `web-icon-close` on the file row.

**Step 4, Review & submit**
- **Key–value list:** case (or "uncategorized"), category, item, seized, location, handed over by, file ("{name} ({size} bytes)"), local proof (mono).
- **Review timestamp:** today "seized" prints the raw `datetime-local` string. Proposal: format it as `YYYY-MM-DD HH:mm:ss UTC`.
- **File size:** proposal to show the unit, "Size (bytes)".
- **Hint (exact):** "Submitting stores the bytes off-chain and writes the CREATE event to the ledger; every later view/download/export is auto-logged under your username." Proposal: `web-icon-info`, and a `web-badge-op-create` chip, which is defined in the Evidence-detail section.
- **Buttons:**
  - "Back" (secondary)
  - "Submit" (primary): it reads "Ingesting…" while busy (proposal: plus `web-spinner-inline`), and is disabled with no file or while busy.
  - Proposal: "Edit" links per kv group that jump back to the step.
- **Errors:** inline `"{status}: {body}"`, for example a 403 on a case you cannot write to, or 413.

#### 4.6.3 Result screen

**Title and badge**
- The title is "Ingested ✓". Proposal: `web-illus-ingest-success` (80 px, a sealed evidence bag with a check).
- **Integrity badge:**
  - Match: `web-badge-integrity-verified` (success) "integrity verified end-to-end", with the note "local SHA-256 matches the server-computed proof". It uses `web-icon-shield-check`.
  - Mismatch: `web-badge-integrity-mismatch` (danger) "INTEGRITY MISMATCH", with the note "the server-computed proof differs from the local hash — do not rely on this exhibit until investigated". It uses `web-icon-shield-alert`, and the result card gets a `--color-danger` border (proposal).
  - Hash failed earlier: no badge. Proposal: `web-badge-integrity-unverified` (muted) "not verified locally".

**Key–value list**
- evidenceId, item, server proof, local proof and txId, each mono. Proposal: `web-icon-copy` on each.
- "write path": shown when batched, with the copy "batched (anchoring) — commits at the batch boundary". Proposal: a `web-badge-write-path-batched` with `web-icon-clock`. That value appears only on the Anchoring and Parallel-Anchored variants.

**Actions**
- Link "Open evidence detail →". Proposal: a primary button with `web-icon-arrow-right`.
- Proposal: "Ingest another" (secondary, `web-icon-add`), which resets the wizard.

### 4.7 Search (`/search`, `SearchPage.tsx`)

**Audience:** all roles. Results are scoped server-side to the caller's cases; admins see everything. **Layout:** two stacked filter cards, each followed by its results card.

**Evidence search card**
- **Heading:** "Evidence search".
- **Filters:**
  - "text": placeholder "id / filename", with `web-icon-search`.
  - "type": free text, placeholder "image/". Proposal: replace it with MIME-family chips reusing `web-chip-category` and `web-icon-cat-*` for Image, Video, Audio, Text, Document, PDF, Spreadsheet, Archive and Other.
  - "uploader": free text. Proposal: a user picker with avatars.
  - "from" and "to": native date inputs. Proposal: label them "from (UTC date)" and "to (UTC date)".
  - Button "Search" with `web-icon-search`. Proposal: Enter submits.
- **Results columns (proposed headers):**
  - Item
  - Evidence ID (mono link)
  - File
  - Type (MIME)
  - Case: a mono link truncated to 13 characters plus "…"; proposal: show the case **name** with the id in a tooltip. When there is no case, the muted word "uncategorized" appears; proposal: `web-badge-uncategorized`.
  - Uploaded by
  - Status (`web-pill-evidence-status-*`)

**Case search card**
- **Heading:** "Case search". One "text" field (placeholder "name / description") and a "Search" button.
- **Result columns:** Name (link), Status, Created by.
- **Status inconsistency:** Status is plain text today. Proposal: `web-pill-case-status-*`, the same pill as My cases.

**States (each card independently)**

| State | Current | Proposal |
|---|---|---|
| Before first search | nothing rendered | `web-illus-search-idle` (magnifier over a file stack, P2) and the text "Search evidence you have access to." |
| Loading | nothing | `web-spinner-inline` in the button, `web-skeleton-row` × 3 |
| Empty | "No evidence matched." / "No cases matched." | plus `web-illus-no-results` |
| Error | inline `"{status}: {body}"` | `web-alert-inline` (error) |

Proposal P2: highlight the matched substring in the file and name columns.

### 4.8 Not found & not authorized

- **NotFoundPage (`*`):** a narrow card with the title "Page not found" and the link "Back to my cases". Proposal:
  - `web-illus-not-found` (160×120; a broken or loose fetter link, on-brand with Gleipnir, drawn in outline).
  - A muted line: "The address may be mistyped, or the item was never in your library."
  - The link rendered as a button with `web-icon-arrow-left`.
- **UnauthorizedPage (`/unauthorized`):** a narrow card with the title "Not authorized" and the text "This page requires the admin role.", plus the link "Back to my cases".
  - **Copy bug:** a non-lead investigator who opens `/lead/dashboard` also lands here and is told it needs the admin role. Proposal: take the required roles from route state, e.g. "This page requires the Lead Investigator or System Administrator role."
  - **Illustration:** `web-illus-forbidden` (160×120; a padlock on a case folder).
- **Per-resource not-found (Case detail 404 in §4.5):** proposal to reuse `web-illus-not-found-case`. The server returns 404, not 403, for non-participants, so the copy must keep the ambiguity: "Case not found — or you are not a participant."

### 4.9 Shared interaction components used by these screens

- **Modal (`web-modal-chrome`)**
  - A full-screen overlay (`--color-overlay` at about 65%) with a panel aligned 10vh from the top, max width 460 px, card background and a deep shadow.
  - The header holds the h3 title and a close button with the text glyph "✕" (aria-label "Close"), which becomes `web-icon-close`.
  - Escape and a click on the overlay close it. Focus moves into the panel and returns to the opener on close.
  - Proposal variants: default, and `web-modal-confirm` for destructive actions (remove participant, delete category) with `web-icon-alert-triangle`, a `--color-danger` primary button and the copy "Remove {user} from this case?" / "Delete category {name}?".
  - Proposal: a 180 ms fade and 8 px rise, disabled under `prefers-reduced-motion`.
- **Inline alert (`web-alert-inline`, P0).** It replaces the bare `.err` text. Variants: error (`--color-danger`, `web-icon-alert`), warning (`--color-warning`, `web-icon-alert-triangle`), info (`--color-accent`, `web-icon-info`) and success (`--color-success`, `web-icon-check-circle`). It has a 12 px text size, a leading 16 px icon, an optional dismiss (`web-icon-close`) and `aria-live="polite"`. It must preserve the `"{status}: {body}"` detail, for example in a monospace sub-line.
- **Toast (`web-toast`, proposal, P1).** There are no toasts today.
  - Position: bottom right on desktop, bottom centre on mobile. Size 320 px wide, auto-dismiss after 4 s, pausable on hover.
  - Variants: success, info, warning, error, with the same icons as the inline alert.
  - Uses: Case created, Participant added or removed, Role changed, Category added or deleted, CSV exported, Copied to clipboard.
  - Toasts never replace an inline error for a failed form submit.
- **Badges and pills**

| Asset | Label (exact) | Tone / token |
|---|---|---|
| `web-badge-role-admin` | System Administrator | `--color-role-admin` |
| `web-badge-role-lead` | Lead Investigator | `--color-role-lead` |
| `web-badge-role-investigator` | Investigator | `--color-role-investigator` |
| `web-badge-case-role-viewer` | Viewer | `--color-case-role-viewer` (muted today) |
| `web-badge-case-role-contributor` | Contributor | `--color-case-role-contributor` (muted today; proposal: accent) |
| `web-badge-case-role-lead` | Case Lead | `--color-case-role-lead` (warning today) |
| `web-pill-case-status-open` | OPEN | `--color-case-status-open` (success outline) |
| `web-pill-case-status-closed` | CLOSED | `--color-case-status-closed` (neutral outline) |
| `web-pill-case-status-archived` | ARCHIVED | `--color-case-status-archived` (muted, dashed outline, proposal) |
| `web-pill-evidence-status-active` | ACTIVE | `--color-evidence-status-active` |
| `web-pill-evidence-status-disposed` | DISPOSED | `--color-evidence-status-disposed` |
| `web-badge-flag-high-priority` | High priority | `--color-flag-high-priority` (danger) |
| `web-badge-flag-processed` | Processed | `--color-flag-processed` (success) |
| `web-badge-flag-needs-lead-review` | Needs lead review | `--color-flag-needs-lead-review` (warning) |

  - Global-role badges are filled tints with 6 px corners.
  - Case-role badges are outline badges, so they never read as global roles.
  - Status pills are fully rounded, 12 px text, uppercase (the wire values).
  - Every pill and badge carries a 12 px glyph (proposal) so meaning survives print and colour-blind viewing: `web-icon-status-open` (open circle), `web-icon-status-closed` (circle with a bar), `web-icon-status-archived` (box), `web-icon-status-disposed` (sealed bin). Role badges get `web-icon-role-admin` (key), `web-icon-role-lead` (star) and `web-icon-role-investigator` (magnifier-person).
- **Avatars (`web-avatar-initials`, proposal).** A circle showing one or two initials from `name`, or from `username` if there is no name. The background is chosen deterministically from 8 `--color-avatar-1..8` tokens by a hash of the username. Sizes are 16, 20, 24 and 32 px. An optional 2 px ring in the `--color-role-*` of the global role appears on the TopBar variant only. The fallback when there is no name is `web-icon-user`. Avatars carry no photo; there is no upload.
- **Buttons (styling handed to the Foundations and components section).** The states used here are primary, secondary (`.small`), destructive (proposal), icon-only (with tooltip and aria-label), disabled and busy (`web-spinner-inline` plus a label change: "Signing in…", "Ingesting…").
- **Loading primitives.** `web-spinner` (32 px) and `web-spinner-inline` (14 px) respect `prefers-reduced-motion` by showing a static ellipsis. `web-skeleton-row`, `web-skeleton-case-header` and `web-skeleton-timeline` pulse on `--color-surface-panel`.
- **Count badge (`web-count-badge`).** A small numeric pill used in tab labels ("Evidence 12") and optionally in the sidebar.

### 4.10 Role-dependent visibility matrix (these screens)

| Element | Investigator | Lead (global) | Admin | Depends on case role |
|---|---|---|---|---|
| Sidebar: Library group | yes | yes | yes | none |
| Sidebar: Lead › Dashboard | no | yes | no (route allowed; proposal: show) | none |
| Sidebar: Administration | no | no | yes | none |
| My cases: "New case" | no | yes (becomes Case Lead) | yes (+ "lead (username, optional)") | none |
| Case detail: CoC report button | yes | yes | yes | any participant |
| Categories: delete ×, add preset, add custom | only as Case Lead | only as Case Lead | yes | Case Lead |
| Team: Add participant, role select, Remove, legend | only as Case Lead | only as Case Lead | yes | Case Lead |
| Evidence tab filters and Export CSV | yes | yes | yes | any participant (Viewer included) |
| Ingest: case appears in the list | Contributor / Case Lead cases | same | all cases | Contributor+ |
| Ingest: uncategorized option | yes | yes | yes | none |

Rule for designs: a control the user cannot use is **not rendered**, rather than shown disabled. The exception is button-level disabled states inside a flow the user is allowed to use: Next, Submit, Create case, Grant access, Add category and Export CSV at 0 rows.

### 4.11 Consolidated asset table (this section)

| ID | Category | Where used | Purpose | Variants / states | Size & format | Priority |
|---|---|---|---|---|---|---|
| web-topbar-brand-lockup | Brand lockup | TopBar left | App identity; link home | default, hover (proposal link) | 24 px tall, inline SVG + text | P0 |
| web-login-backdrop | Illustration / pattern | Login background | Branded, quiet backdrop | dark only; hidden in print | full-bleed SVG ≤ 8 KB, ≤ 6% opacity | P2 |
| web-icon-nav-ingest | Nav icon | Sidebar "Ingest evidence" | Wayfinding | default, hover, active (accent) | 20 px, SVG 24 grid, stroke 1.8 | P0 |
| web-icon-nav-cases | Nav icon | Sidebar "My cases" | Wayfinding | default, hover, active | 20 px SVG | P0 |
| web-icon-nav-search | Nav icon | Sidebar "Search" | Wayfinding | default, hover, active | 20 px SVG | P0 |
| web-icon-nav-lead-dashboard | Nav icon | Sidebar Lead › "Dashboard" | Wayfinding (lead) | default, hover, active | 20 px SVG | P0 |
| web-icon-nav-users | Nav icon | Sidebar Admin › "Users" | Wayfinding (admin) | default, hover, active | 20 px SVG | P0 |
| web-icon-nav-case-admin | Nav icon | Sidebar Admin › "Case admin" | Wayfinding (admin) | default, hover, active | 20 px SVG | P0 |
| web-icon-menu | Action icon | TopBar, below 900 px (proposal) | Open the nav drawer | default, open | 20 px SVG | P1 |
| web-icon-sidebar-collapse | Action icon | Sidebar foot (proposal) | Collapse to rail | collapsed, expanded | 16 px SVG | P2 |
| web-icon-sign-out | Action icon | TopBar user menu | Sign out | default, busy | 16 px SVG | P1 |
| web-icon-chevron-down | Action icon | TopBar user menu (proposal) | Menu affordance | closed, open (rotated) | 16 px SVG | P2 |
| web-avatar-initials | Avatar | TopBar, Team roster, My cases created by, modal options | Identify people at a glance | 16/20/24/32 px; 8 colours; role ring; no-name fallback | SVG/CSS circle | P1 |
| web-icon-user | Icon | Avatar fallback | Anonymous person | none | 16 px SVG | P2 |
| web-badge-role-admin | Role badge | TopBar, user pickers | Global role System Administrator | default, print | 20 px tall, CSS + 12 px glyph | P0 |
| web-badge-role-lead | Role badge | TopBar, user pickers | Global role Lead Investigator | default, print | 20 px tall | P0 |
| web-badge-role-investigator | Role badge | TopBar, user pickers | Global role Investigator | default, print | 20 px tall | P0 |
| web-icon-role-admin | Glyph | Inside the admin badge | Non-colour role cue | none | 12 px SVG | P1 |
| web-icon-role-lead | Glyph | Inside the lead badge | Non-colour role cue | none | 12 px SVG | P1 |
| web-icon-role-investigator | Glyph | Inside the investigator badge | Non-colour role cue | none | 12 px SVG | P1 |
| web-badge-case-role-viewer | Case-role badge | My cases "My role", Team roster | Case role Viewer | default | 20 px tall, outline | P0 |
| web-badge-case-role-contributor | Case-role badge | My cases, Team roster | Case role Contributor | default | 20 px tall, outline | P0 |
| web-badge-case-role-lead | Case-role badge | My cases, Team roster | Case role Case Lead | default | 20 px tall, outline | P0 |
| web-roles-legend | Composite | Team section (managers) | Explain Viewer/Contributor/Case Lead rights | none | 3 rows, CSS | P2 |
| web-pill-case-status-open | Status pill | My cases, Case header, Search, Ingest options | Case OPEN | default, print | 20 px tall, fully rounded | P0 |
| web-pill-case-status-closed | Status pill | same | Case CLOSED | default, print | 20 px tall | P0 |
| web-pill-case-status-archived | Status pill | same | Case ARCHIVED | default, print (dashed) | 20 px tall | P0 |
| web-icon-status-open | Glyph | Case status pill | Non-colour cue | none | 12 px SVG | P1 |
| web-icon-status-closed | Glyph | Case status pill | Non-colour cue | none | 12 px SVG | P1 |
| web-icon-status-archived | Glyph | Case status pill | Non-colour cue | none | 12 px SVG | P1 |
| web-pill-evidence-status-active | Status pill | Evidence roster, Search | Evidence ACTIVE | default, print | 20 px tall | P0 |
| web-pill-evidence-status-disposed | Status pill | Evidence roster, Search | Evidence DISPOSED (and legacy REMOVED) | default, print | 20 px tall | P0 |
| web-icon-status-disposed | Glyph | DISPOSED pill | Non-colour cue; nothing deleted | none | 12 px SVG | P1 |
| web-badge-flag-high-priority | Flag badge | Evidence roster Flag column | Flag High priority | default, print | 20 px tall + `web-icon-flag` | P0 |
| web-badge-flag-processed | Flag badge | Evidence roster | Flag Processed | default, print | 20 px tall | P0 |
| web-badge-flag-needs-lead-review | Flag badge | Evidence roster | Flag Needs lead review | default, print | 20 px tall | P0 |
| web-icon-flag | Action icon | Flag filter, flag badges, FLAG_CHANGED marker | Flag concept | default, filled when set | 16 px SVG | P0 |
| web-icon-note | Action icon | NOTE_ADDED marker, roster note count (proposal) | Examiner note concept | default | 16 px SVG | P1 |
| web-chip-category | Chip | Categories section, roster Category column, Ingest step 1 tiles, Search type filter | Category label | default, selected, add (dashed "+"), removable (×), compact 20 px, tile 88×64 | CSS + icon slot | P0 |
| web-icon-cat-image | Category icon | Category chip/tile, file column | Preset Image | default, selected | 16/24 px SVG | P0 |
| web-icon-cat-video | Category icon | same | Preset Video | default, selected | 16/24 px SVG | P0 |
| web-icon-cat-audio | Category icon | same | Preset Audio | default, selected | 16/24 px SVG | P0 |
| web-icon-cat-text | Category icon | same | Preset Text | default, selected | 16/24 px SVG | P0 |
| web-icon-cat-document | Category icon | same | Preset Document | default, selected | 16/24 px SVG | P0 |
| web-icon-cat-pdf | Category icon | same | Preset PDF | default, selected | 16/24 px SVG | P1 |
| web-icon-cat-spreadsheet | Category icon | same | Preset Spreadsheet | default, selected | 16/24 px SVG | P1 |
| web-icon-cat-archive | Category icon | same | Preset Archive | default, selected | 16/24 px SVG | P1 |
| web-icon-cat-other | Category icon | same | Preset Other | default, selected | 16/24 px SVG | P1 |
| web-icon-cat-custom | Category icon | Custom categories, CATEGORY_* markers | Lead-defined category | default, selected | 16/24 px SVG | P0 |
| web-icon-remove-chip | Action icon | Category chip × | Delete category (manager) | default, hover (danger) | 12 px SVG | P0 |
| web-icon-add | Action icon | "New case", "+ preset", "Ingest another" | Create / add | default, disabled | 16 px SVG | P0 |
| web-icon-edit | Action icon | EVIDENCE_DETAILS_UPDATED marker, review "Edit" links (proposal) | Edit concept | default | 16 px SVG | P1 |
| web-icon-close | Action icon | Modal close, alert dismiss, clear filters, replace file | Close / clear | default, hover, focus | 16 px SVG | P0 |
| web-icon-copy | Action icon | Case id, evidence id, proofs, txId (proposal) | Copy to clipboard | default, copied (becomes check, 1.5 s) | 16 px SVG | P1 |
| web-icon-search | Action icon | Search fields and buttons, roster filter | Search | default | 16 px SVG | P0 |
| web-icon-filter | Action icon | My cases "Filter", roster filter bar | Filter | default, active (filters applied) | 16 px SVG | P1 |
| web-icon-sort | Action icon | Sortable table headers (proposal) | Unsorted column | default, hover | 12 px SVG | P1 |
| web-icon-sort-asc | Action icon | Sortable table headers | Ascending | active | 12 px SVG | P1 |
| web-icon-sort-desc | Action icon | Sortable table headers | Descending | active | 12 px SVG | P1 |
| web-icon-chevron-right | Action icon | Table row affordance (proposal) | "Opens detail" | default, row hover | 16 px SVG | P2 |
| web-icon-chevron-disclosure | Action icon | Overview "Categories" / "Team" toggles | Expand/collapse (replaces ▸/▾) | collapsed, expanded (90° rotation) | 16 px SVG | P0 |
| web-icon-arrow-right | Action icon | "Open evidence detail →" | Forward navigation | default | 16 px SVG | P1 |
| web-icon-arrow-left | Action icon | "Back to my cases" (404 / forbidden) | Back navigation | default | 16 px SVG | P1 |
| web-icon-report | Action icon | "CoC report (print / CSV)" | Open the court report | default | 16 px SVG | P0 |
| web-icon-export-csv | Action icon | "Export CSV ({n})" | Client-side CSV export | default, disabled (0 rows) | 16 px SVG | P0 |
| web-icon-user-add | Action icon | "Add participant", PARTICIPANT_ADDED marker | Grant case access | default, disabled | 16 px SVG | P0 |
| web-icon-remove-user | Action icon | Team "Remove", PARTICIPANT_REMOVED marker | Revoke case access | default, hover (danger) | 16 px SVG | P0 |
| web-icon-eye | Action icon | Login password toggle | Show password | default, hover | 18 px SVG | P0 |
| web-icon-eye-off | Action icon | Login password toggle | Hide password | default, hover | 18 px SVG | P0 |
| web-icon-alert | Status icon | Error alerts, Stepper error dot | Error | none | 16 px SVG | P0 |
| web-icon-alert-triangle | Status icon | Warning alerts, confirm modal | Warning / destructive | none | 16/24 px SVG | P1 |
| web-icon-info | Status icon | Info alerts, Ingest hints | Explanatory | none | 16 px SVG | P1 |
| web-icon-check | Status icon | Stepper done dot, copied state | Done | none | 14/16 px SVG | P0 |
| web-icon-check-circle | Status icon | Success alerts and toasts | Success | none | 16 px SVG | P1 |
| web-icon-clock | Status icon | 429 login error, session-ended notice, batched write path | Time / wait | none | 16 px SVG | P1 |
| web-icon-offline | Status icon | Login "Could not reach the gateway" | Network down | none | 16 px SVG | P2 |
| web-icon-location | Field icon | Ingest "acquisition location / source" | Field cue | none | 16 px SVG | P2 |
| web-icon-fingerprint | Field icon | Ingest "local SHA-256", step-3 icon source | Hash / integrity | none | 16/24 px SVG | P1 |
| web-icon-shield-check | Status icon | "integrity verified end-to-end" badge | End-to-end match | none | 16 px SVG | P0 |
| web-icon-shield-alert | Status icon | "INTEGRITY MISMATCH" badge | Mismatch | none | 16 px SVG | P0 |
| web-icon-shield-gateway | Glyph | Footer line (proposal) | "Talks only to the API gateway" cue | none | 12 px SVG | P2 |
| web-badge-integrity-verified | Status badge | Ingest result | Local hash equals server proof | default, print | 24 px tall + icon | P0 |
| web-badge-integrity-mismatch | Status badge | Ingest result | Local hash differs from server proof | default, print; card danger border | 24 px tall + icon | P0 |
| web-badge-integrity-unverified | Status badge | Ingest result when local hash failed (proposal) | Not verified locally | default | 24 px tall | P1 |
| web-badge-write-path-batched | Status badge | Ingest result "write path" | Batched write, commits at the batch boundary | default | 20 px tall + `web-icon-clock` | P1 |
| web-badge-uncategorized | Badge | Search "Case" column, ingest review | No case assigned | default | 20 px tall, muted | P2 |
| web-count-badge | Badge | Tab "Evidence (n)", sidebar (proposal) | Counts | default, active-tab | 16 px tall numeric pill | P1 |
| web-tabs | Component style | Case detail tabs | Tab strip | default, hover, active (2 px accent underline), focus-visible | CSS, 36 px tall | P0 |
| web-icon-tab-overview | Tab icon | "Overview" tab | Tab cue | default, active | 16 px SVG | P2 |
| web-icon-tab-evidence | Tab icon | "Evidence (n)" tab | Tab cue | default, active | 16 px SVG | P2 |
| web-icon-tab-activity | Tab icon | "Activity" tab | Tab cue | default, active | 16 px SVG | P2 |
| web-stepper-dot | Component | Ingest Stepper | Step state marker | upcoming (number), active (step icon), done (check), error | 24 px circle, CSS + SVG slot | P0 |
| web-icon-step-case | Stepper icon | Step 1 "Case & category" | Step cue | active, done | 14 px SVG in a 24 px dot | P1 |
| web-icon-step-metadata | Stepper icon | Step 2 "Metadata" | Step cue | active, done | 14 px SVG | P1 |
| web-icon-step-file-hash | Stepper icon | Step 3 "File & hash" | Step cue | active, done | 14 px SVG | P1 |
| web-icon-step-review | Stepper icon | Step 4 "Review & submit" | Step cue | active, done | 14 px SVG | P1 |
| web-upload-dropzone | Component | Ingest step 3 (proposal; replaces the native file input) | Choose a file for local hashing | idle, drag-over, hashing (progress), hashed, error, focus-visible | 100% × 180 px, CSS dashed border | P0 |
| web-illus-dropzone | Illustration | Inside the dropzone | Invite drop / browse | idle, drag-over (accent) | 64 px SVG | P1 |
| web-progress-bar | Component | "Hashing locally… {pct}%" | Determinate progress | 0–100%, complete (success), error (danger) | 4 px tall, CSS | P0 |
| web-illus-ingest-success | Illustration | Ingest result "Ingested ✓" | Confirmation moment | verified, mismatch (danger variant) | 80 px SVG | P2 |
| web-illus-empty-cases | Illustration | My cases empty state | "No cases yet…" | default | 160×120 SVG | P1 |
| web-illus-empty-evidence | Illustration | Case › Evidence empty | "Nothing assigned to this case yet." | default | 160×120 SVG | P1 |
| web-illus-empty-activity | Illustration | Case › Activity empty | "No activity yet." | default | 120×90 SVG | P2 |
| web-illus-no-results | Illustration | Filtered-empty on My cases, roster, Search | "No … matched / matches the filters." | default | 120×90 SVG | P1 |
| web-illus-search-idle | Illustration | Search, before the first query (proposal) | Prompt to search | default | 120×90 SVG | P2 |
| web-illus-not-found | Illustration | NotFoundPage | "Page not found" | default | 160×120 SVG | P1 |
| web-illus-not-found-case | Illustration | Case detail 404 | "Case not found — or you are not a participant." | default | 160×120 SVG | P1 |
| web-illus-forbidden | Illustration | UnauthorizedPage | "Not authorized" | default | 160×120 SVG | P1 |
| web-alert-inline | Component | Every form/page error (replaces `.err`), session-ended notice | Inline feedback with status detail | error, warning, info, success; dismissible | full width, 12 px text + 16 px icon | P0 |
| web-toast | Component | Case created, participant/role/category changes, CSV exported, copied (proposal) | Transient confirmation | success, info, warning, error; hover-pause | 320 px wide, bottom right | P1 |
| web-modal-chrome | Component | "New case", "Add participant" | Dialog frame | open, closing; focus-visible close | max 460 px, overlay `--color-overlay` | P0 |
| web-modal-confirm | Component | Remove participant, delete category (proposal) | Guard destructive actions | default, busy | max 400 px | P1 |
| web-spinner | Loader | "Restoring session…", page loads | Blocking wait | animated, reduced-motion static | 32 px SVG/CSS | P0 |
| web-spinner-inline | Loader | Buttons: "Signing in…", "Ingesting…", Search | Busy button | animated, reduced-motion static | 14 px SVG/CSS | P0 |
| web-skeleton-row | Loader | My cases, roster, Search results | Table loading | pulsing, reduced-motion static | row height 32 px, CSS | P1 |
| web-skeleton-case-header | Loader | Case detail "Loading case…" | Header loading | pulsing | card width, CSS | P2 |
| web-skeleton-timeline | Loader | Activity "Loading activity…" | Timeline loading | pulsing | 3 × timeline rows, CSS | P2 |
| web-icon-activity-case-created | Timeline marker | Activity CASE_CREATED | Event glyph in the dot | success tone | 14 px SVG in a 23 px dot | P1 |
| web-icon-activity-case-updated | Timeline marker | Activity CASE_UPDATED | Event glyph | accent tone | 14 px SVG | P1 |
| web-icon-activity-role-changed | Timeline marker | Activity PARTICIPANT_ROLE_CHANGED | Event glyph | accent tone | 14 px SVG | P1 |
| web-icon-activity-category | Timeline marker | Activity CATEGORY_CREATED / RENAMED / DELETED | Event glyph with +/✎/× overlay | 3 sub-variants | 14 px SVG | P2 |
| web-icon-activity-evidence-in | Timeline marker | Activity EVIDENCE_ADDED / EVIDENCE_ASSIGNED | Event glyph | success tone | 14 px SVG | P1 |
| web-icon-activity-evidence-out | Timeline marker | Activity EVIDENCE_UNASSIGNED | Event glyph | muted tone | 14 px SVG | P1 |
| web-icon-activity-evidence-disposed | Timeline marker | Activity EVIDENCE_REMOVED (left the roster on DISPOSED) | Event glyph | muted tone | 14 px SVG | P1 |
| web-icon-activity-generic | Timeline marker | Unknown activity types | Fallback glyph | accent tone | 14 px SVG | P2 |

### Checklist

- [ ] web-topbar-brand-lockup: TopBar wordmark and mark lockup that links home
- [ ] web-login-backdrop: quiet fetter-motif backdrop behind the login card
- [ ] web-icon-nav-ingest: sidebar icon for "Ingest evidence"
- [ ] web-icon-nav-cases: sidebar icon for "My cases"
- [ ] web-icon-nav-search: sidebar icon for "Search"
- [ ] web-icon-nav-lead-dashboard: sidebar icon for Lead › "Dashboard"
- [ ] web-icon-nav-users: sidebar icon for Administration › "Users"
- [ ] web-icon-nav-case-admin: sidebar icon for Administration › "Case admin"
- [ ] web-icon-menu: hamburger that opens the nav drawer below 900 px
- [ ] web-icon-sidebar-collapse: collapse the sidebar to an icon rail
- [ ] web-icon-sign-out: sign-out action in the user menu
- [ ] web-icon-chevron-down: user-menu disclosure
- [ ] web-avatar-initials: initials avatar with deterministic colour and optional role ring
- [ ] web-icon-user: anonymous-person avatar fallback
- [ ] web-badge-role-admin: "System Administrator" global-role badge
- [ ] web-badge-role-lead: "Lead Investigator" global-role badge
- [ ] web-badge-role-investigator: "Investigator" global-role badge
- [ ] web-icon-role-admin: key glyph inside the admin badge
- [ ] web-icon-role-lead: star glyph inside the lead badge
- [ ] web-icon-role-investigator: magnifier-person glyph inside the investigator badge
- [ ] web-badge-case-role-viewer: "Viewer" case-role outline badge
- [ ] web-badge-case-role-contributor: "Contributor" case-role outline badge
- [ ] web-badge-case-role-lead: "Case Lead" case-role outline badge
- [ ] web-roles-legend: Viewer / Contributor / Case Lead rights legend in the Team section
- [ ] web-pill-case-status-open: OPEN case status pill
- [ ] web-pill-case-status-closed: CLOSED case status pill
- [ ] web-pill-case-status-archived: ARCHIVED case status pill (dashed)
- [ ] web-icon-status-open: non-colour glyph for OPEN
- [ ] web-icon-status-closed: non-colour glyph for CLOSED
- [ ] web-icon-status-archived: non-colour glyph for ARCHIVED
- [ ] web-pill-evidence-status-active: ACTIVE evidence status pill
- [ ] web-pill-evidence-status-disposed: DISPOSED evidence status pill (also legacy REMOVED)
- [ ] web-icon-status-disposed: non-colour glyph for DISPOSED (nothing deleted)
- [ ] web-badge-flag-high-priority: "High priority" flag badge
- [ ] web-badge-flag-processed: "Processed" flag badge
- [ ] web-badge-flag-needs-lead-review: "Needs lead review" flag badge
- [ ] web-icon-flag: flag concept icon (filter, badges, FLAG_CHANGED)
- [ ] web-icon-note: examiner-note concept icon (NOTE_ADDED, roster count)
- [ ] web-chip-category: category chip in default, selected, add, removable, compact and tile forms
- [ ] web-icon-cat-image: Image preset category icon
- [ ] web-icon-cat-video: Video preset category icon
- [ ] web-icon-cat-audio: Audio preset category icon
- [ ] web-icon-cat-text: Text preset category icon
- [ ] web-icon-cat-document: Document preset category icon
- [ ] web-icon-cat-pdf: PDF preset category icon
- [ ] web-icon-cat-spreadsheet: Spreadsheet preset category icon
- [ ] web-icon-cat-archive: Archive preset category icon
- [ ] web-icon-cat-other: Other preset category icon
- [ ] web-icon-cat-custom: tag icon for lead-defined custom categories
- [ ] web-icon-remove-chip: × on category chips (delete category)
- [ ] web-icon-add: add / create action
- [ ] web-icon-edit: edit action and EVIDENCE_DETAILS_UPDATED marker
- [ ] web-icon-close: close / clear / dismiss
- [ ] web-icon-copy: copy ids, proofs and txIds to the clipboard
- [ ] web-icon-search: search fields and buttons
- [ ] web-icon-filter: filter action and "filters applied" state
- [ ] web-icon-sort: unsorted sortable column header
- [ ] web-icon-sort-asc: ascending sort indicator
- [ ] web-icon-sort-desc: descending sort indicator
- [ ] web-icon-chevron-right: table-row "opens detail" affordance
- [ ] web-icon-chevron-disclosure: Categories / Team expand-collapse toggle
- [ ] web-icon-arrow-right: "Open evidence detail →"
- [ ] web-icon-arrow-left: "Back to my cases"
- [ ] web-icon-report: "CoC report (print / CSV)" button icon
- [ ] web-icon-export-csv: "Export CSV ({n})" button icon
- [ ] web-icon-user-add: "Add participant" and PARTICIPANT_ADDED marker
- [ ] web-icon-remove-user: team "Remove" and PARTICIPANT_REMOVED marker
- [ ] web-icon-eye: show-password toggle
- [ ] web-icon-eye-off: hide-password toggle
- [ ] web-icon-alert: error status icon and Stepper error dot
- [ ] web-icon-alert-triangle: warning and destructive-confirm icon
- [ ] web-icon-info: info alerts and Ingest hints
- [ ] web-icon-check: Stepper done dot and copied state
- [ ] web-icon-check-circle: success alerts and toasts
- [ ] web-icon-clock: throttle, session-ended and batched-write-path cue
- [ ] web-icon-offline: gateway-unreachable login error
- [ ] web-icon-location: acquisition-location field cue
- [ ] web-icon-fingerprint: local SHA-256 / hash cue
- [ ] web-icon-shield-check: integrity-verified glyph
- [ ] web-icon-shield-alert: integrity-mismatch glyph
- [ ] web-icon-shield-gateway: footer "talks only to the API gateway" glyph
- [ ] web-badge-integrity-verified: "integrity verified end-to-end" badge
- [ ] web-badge-integrity-mismatch: "INTEGRITY MISMATCH" badge
- [ ] web-badge-integrity-unverified: "not verified locally" badge
- [ ] web-badge-write-path-batched: "batched (anchoring) — commits at the batch boundary" badge
- [ ] web-badge-uncategorized: "uncategorized" (no case) badge
- [ ] web-count-badge: numeric count pill for tabs and nav
- [ ] web-tabs: Case detail tab-strip styling
- [ ] web-icon-tab-overview: Overview tab icon
- [ ] web-icon-tab-evidence: Evidence tab icon
- [ ] web-icon-tab-activity: Activity tab icon
- [ ] web-stepper-dot: Ingest step marker (upcoming, active, done, error)
- [ ] web-icon-step-case: step 1 "Case & category" icon
- [ ] web-icon-step-metadata: step 2 "Metadata" icon
- [ ] web-icon-step-file-hash: step 3 "File & hash" icon
- [ ] web-icon-step-review: step 4 "Review & submit" icon
- [ ] web-upload-dropzone: drag-and-drop file area for Ingest step 3
- [ ] web-illus-dropzone: art inside the upload dropzone
- [ ] web-progress-bar: "Hashing locally… {pct}%" determinate bar
- [ ] web-illus-ingest-success: "Ingested ✓" confirmation illustration
- [ ] web-illus-empty-cases: My cases empty-state illustration
- [ ] web-illus-empty-evidence: Case evidence-roster empty-state illustration
- [ ] web-illus-empty-activity: Case activity empty-state illustration
- [ ] web-illus-no-results: filtered / search no-results illustration
- [ ] web-illus-search-idle: Search pre-query illustration
- [ ] web-illus-not-found: "Page not found" illustration
- [ ] web-illus-not-found-case: "Case not found — or you are not a participant." illustration
- [ ] web-illus-forbidden: "Not authorized" illustration
- [ ] web-alert-inline: inline alert in error, warning, info and success forms
- [ ] web-toast: transient confirmation toast
- [ ] web-modal-chrome: dialog overlay, panel and header with close
- [ ] web-modal-confirm: destructive-action confirm dialog
- [ ] web-spinner: 32 px blocking loader
- [ ] web-spinner-inline: 14 px in-button busy loader
- [ ] web-skeleton-row: table-row loading skeleton
- [ ] web-skeleton-case-header: Case header loading skeleton
- [ ] web-skeleton-timeline: Activity timeline loading skeleton
- [ ] web-icon-activity-case-created: CASE_CREATED timeline marker
- [ ] web-icon-activity-case-updated: CASE_UPDATED timeline marker
- [ ] web-icon-activity-role-changed: PARTICIPANT_ROLE_CHANGED timeline marker
- [ ] web-icon-activity-category: CATEGORY_CREATED / RENAMED / DELETED marker
- [ ] web-icon-activity-evidence-in: EVIDENCE_ADDED / EVIDENCE_ASSIGNED marker
- [ ] web-icon-activity-evidence-out: EVIDENCE_UNASSIGNED marker
- [ ] web-icon-activity-evidence-disposed: EVIDENCE_REMOVED (left the roster on DISPOSED) marker
- [ ] web-icon-activity-generic: fallback marker for unknown activity types

---

## 5. Web app — evidence, reports, lead & admin screens

This section covers the evidence-facing and management screens of the React SPA (`frontend/src`), with each screen described as it is built today. Anything that does not exist in code yet is marked **(proposal)**. Colours are given as foundation tokens. The token names assumed here are `--color-surface`, `--color-surface-raised`, `--color-border`, `--color-text`, `--color-text-muted`, `--color-accent`, `--color-success`, `--color-warning`, `--color-danger`, `--color-op-create`, `--color-op-transfer`, `--color-op-access`, `--color-op-dispose`, `--color-print-ink` and `--color-print-rule`. If the foundations section names any of these differently, use its name for the same role.

**Terminology the designs must use (taken from the code):**

- Operation types on the ledger: `CREATE`, `TRANSFER`, `ACCESS`, `DISPOSE`. `DISPOSE` is written by `DisposeEvidence`.
- Evidence head status: `ACTIVE` or `DISPOSED`. `DISPOSED` is a terminal status. Nothing is deleted.
- Legacy values: status `REMOVED` and op tag `REMOVE`. These appear on ledgers written before M26 and mean the same thing as `DISPOSED` / `DISPOSE`.
- Case status: `OPEN`, `CLOSED`, `ARCHIVED`.
- Global roles: System Administrator, Lead Investigator, Investigator.
- Case roles: Case Lead, Contributor, Viewer.
- Timestamps are always shown as `YYYY-MM-DD HH:mm:ss UTC` (`lib/format.ts → formatTs`), with the raw ISO value in a `title` tooltip.

---

### 5.1 Evidence detail — `/evidence/:evidenceId`

**Purpose.** This is the single page for one exhibit. It shows the item's forensic metadata, the on-chain head record (the "evidence card"), the full chain-of-custody trail, Merkle verification for the anchored variants, an inline preview, and the actions examiners can take.

**Audience.**
- Investigators, Contributors and Case Leads on the case roster.
- System Administrators. They can see metadata and the trail, but download and preview are hidden when they are not on the roster.
- The uploader of an uncategorized item.

**Side effect the design must make visible.** Opening the page writes an on-chain `ACCESS(view)` event under the signed-in username. Download, preview and export each write their own `ACCESS` event, after which the page refreshes only the trail. The designs should never suggest that reading is invisible.

#### 5.1.1 Layout (as built)

The page is a single `.card` with three parts:

1. **Header row (`row-between`)**
   - Evidence ID in monospace (a UUIDv4) on the left.
   - On the right: the Merkle badge, then the flag badge if a flag is set.
2. **Action row (`btn-row`)**
   - `Download`, shown only when `canDownload` is true.
   - `Export (record + trail)`, which downloads `<evidenceId>-export.json`.
   - When download is hidden, a hint is shown instead: *"Blob content is participant-only — join the case roster to download (metadata and the trail stay visible)."*
   - The error line (`.err`) and the not-found / 403 message sit under this row.
3. **Tabs (`components/ui/Tabs`):** `Overview`, `Chain of custody (N)`, `Examiner notes`.

**Overview tab**
- **Metadata `dl.kv`** with these labels: item, file, type (MIME), category, seized, location, handed over by, uploaded by, case. The case value is a monospace link to `/cases/:id`, or the muted word "uncategorized".
- **Preview block** (see 5.1.5).
- **Flag chips.** Shown only to users who can write (see 5.1.6).
- **EvidenceCard** (see 5.1.2).

**Chain of custody tab**
- `Verify latest` button (small).
- AuditTrailTimeline.
- SessionTrail ("Events this session (N)").
- Two side-by-side form cards, shown only to users who can write:
  - **Transfer custody.** Fields: `new custodian`, `reason` (default "handoff"). Button: `Transfer`, disabled until a custodian is entered.
  - **Log manual access.** Field: `action` (default "inspect"). Button: `Log access`. Hint: *"Actor is always your username (server-attributed). Views, downloads, and exports are logged automatically."*

**Examiner notes tab**
- An append-only list of notes. Each shows the author in bold, the timestamp and the body.
- A textarea labelled *"add note (immutable once posted)"* and a `Post note` button.
- Read-only viewers see *"Notes are read-only for your case role."*
- Empty state: *"No examiner notes yet."*

**Page-level states**

| State | Current copy | Design need |
|---|---|---|
| Loading | none (blank card) | web-skeleton-evidence-detail **(proposal)** |
| 404 | "No on-chain record (unknown id, no access, or an anchoring-variant write whose batch has not closed yet)." | web-illus-evidence-not-found |
| 403 | "You do not have access to this evidence (not a participant of its case)." | web-illus-no-access |
| Admin outside the roster | Download and preview hidden, hint shown | web-icon-lock beside the hint |
| DISPOSED | only the status pill changes | web-banner-disposed **(proposal)**, see 5.1.8 |

**Layout proposal.**
- Desktop (≥ 1024 px): two columns. The left column is 8/12 wide and holds the tabs. The right column is a 4/12 sticky "integrity rail" holding the Merkle badge, integrity proof (ni-URI), custodian, status, and the Download / Export / CoC report actions.
- Mobile: a single column, with the rail collapsed above the tabs.
- Add a file-type icon (5.3) at 24 px before the evidence label in the header, and show the human label (`indexRow.label`) as the H1 with the UUID underneath in monospace. Today the UUID is the heading.

#### 5.1.2 EvidenceCard (`components/EvidenceCard.tsx`)

This is the on-chain head record, laid out as a signed "evidence card" in the Codex-Entry style.

- **Header:** monospace ID on the left, status pill on the right. The pill uses the `active` class when the status is `ACTIVE`, and `removed` when it is `DISPOSED` or the legacy `REMOVED`.
- **`dl` rows:** version, custodian, org, storage (monospace location), integrity_proof (monospace, small; an RFC 6920 `ni:///sha-256;…` URI), anchor (tx_hash), previous_id. Missing values show "—".
- **Empty state:** "No evidence loaded."

**Design needs**
- A card frame with a subtle "certificate" treatment: a thin double rule and a corner seal glyph. The seal is `brand-seal-mark`, reused here at 20 px, muted.
- Long hashes must wrap cleanly (`word-break: break-all`). A copy button sits beside `integrity_proof` and `anchor`: web-icon-copy **(proposal)**, with a "Copied" toast state.
- The integrity_proof value gets web-icon-hash; the anchor value gets web-icon-anchor.

#### 5.1.3 Chain-of-custody timeline (`AuditTrailTimeline` + `ui/Timeline`)

This is a vertical rail with one item per on-chain event.

- **Dot.** Each item has a coloured dot (`tl-dot tone-*`) whose marker glyph comes from `OP_MARK`: CREATE `+`, TRANSFER `⇄`, ACCESS `◉`, DISPOSE `×`.
- **Dot tone** comes from `OP_TONE`: CREATE ok, TRANSFER accent, ACCESS muted, DISPOSE danger.
- **Row.** The op label (`.op.op-<op>`, bold 12 px) is followed by the actor and the formatted timestamp.
- **Detail line**, muted and small:
  - TRANSFER: `to <newCustodian> — <reason>`
  - ACCESS: `<action>`, for example `view`, `download`, `export`, `coc-report`, `inspect`
  - DISPOSE: `<reason>`
- **Legacy tag.** The pre-M26 tag `REMOVE` is normalised to `DISPOSE` before rendering.
- **Empty state:** "No audit events."
- **Header:** "Chain of custody (N)".

**Design needs**
- Replace the text glyphs with SVG markers: `web-marker-op-*`. The ACCESS marker should vary by the `detail.action` sub-type as a small secondary glyph. These are `web-icon-access-view`, `-download`, `-export` and `-report`, all **(proposal)**.
- Legacy rows get a small "legacy REMOVE" subtag (`web-badge-op-legacy-removed`) so a court reader understands why the raw ledger says `REMOVE`. This is a **(proposal)**; today the rewrite happens silently.
- Density: roughly 40 px per row. Traces of 50 or more ACCESS rows are common, because every view is logged. Propose a **"Collapse consecutive ACCESS(view) by same actor"** toggle **(proposal)**. It is a presentation-only grouping and must show a count, for example "×7".
- Timestamps are right-aligned in tabular numerals, and the ISO tooltip is kept.

**SessionTrail** ("Events this session (N)")
- A grid of rows: op label, monospace eventId, timestamp, and a per-row `Verify` button that appears only on anchored variants.
- Hint: *"Write responses captured client-side; in batched variants these live off-chain (receipts + anchored roots), not in the on-chain trail."*
- Design it as a lighter sub-card, visually distinct from the ledger trail. A dashed border works well, because these rows are not ledger rows.

#### 5.1.4 Merkle verification badge + verify flow (`MerkleBadge.tsx`)

| State | Current label | Trigger | Tone | Tooltip / meaning |
|---|---|---|---|---|
| `na` | `Merkle: N/A` | Standard or Parallel variant (no receipts) | `--color-text-muted`, outline | "Verification applies to Anchoring variants" |
| `pending` | `Merkle: …` | request in flight | muted, outline + spinner **(proposal)** | — |
| `notyet` | `Merkle: not yet anchored` | 404 `missing-receipt` / `missing-anchor-root` | `--color-warning` outline **(proposal; today muted)** | "Receipt or root not anchored yet — the batch may not have closed. Not a tamper signal." |
| ok | `Merkle: VERIFIED (x.x ms)` | 200 `ok:true` | `--color-success`, filled 15 % | tooltip shows the verification latency in ms |
| mismatch | `Merkle: MISMATCH` | 200 `ok:false`, `reason: root-mismatch` | `--color-danger`, filled 15 % | tamper signal |

**Hard rule (F49).** Pending and not-yet-anchored must never look like a mismatch. Only `MISMATCH` may use red and an alert icon. `not yet anchored` uses a clock icon. `N/A` uses a neutral dash-circle icon. Make N/A clearly "not applicable to this variant", never "failed". Proposed tooltip wording for N/A: *"Standard and Parallel write each event directly on-chain — there is no Merkle receipt to verify."*

**Verify buttons**
- `Verify latest` (Chain of custody tab) is disabled unless the anchored variant is active and at least one session event exists. Its disabled title reads *"Write an event this session first — verification is per event"*.
- Each SessionTrail row has its own `Verify`.
- Icon: `web-icon-verify` (shield with check).
- States: default, hover, focus-ring, disabled with tooltip, busy (spinner inside the button).

**Proposal: result popover.** Show a result popover (`web-popover-verify-steps`) that renders `steps.fetchMs / recomputeMs / compareRootMs` as a three-segment horizontal bar with a column header "time (ms)". This makes the RQ2 verification latency visible.

**Known code gap to design around.** `settings.tsx` holds the variant (default `standard`), and nothing calls `setVariant` any more now that the operator dashboard has been removed. As a result the badge currently always shows `N/A`. Design every state anyway. Also propose a read-only **variant chip** (`web-chip-variant-indicator`) in the evidence header, which reads the active variant from the gateway and uses `--color-variant-standard`, `--color-variant-anchoring`, `--color-variant-parallel` and `--color-variant-parallel-anchored` (all **proposal**).

#### 5.1.5 Inline preview (`EvidencePreview`)

`previewKind(mime)` decides the renderer:

| Kind | MIME rule | Renderer | Asset / chrome |
|---|---|---|---|
| image | `image/*` | `<img class="preview-media">` from a blob: URL | checkerboard backdrop for transparency **(proposal)** |
| video | `video/*` | `<video controls>` | native controls; poster frame web-preview-poster-video **(proposal)** |
| audio | `audio/*` | `<audio controls>` | waveform-style placeholder web-preview-poster-audio **(proposal)** |
| pdf | `application/pdf` | `<iframe sandbox="" referrerPolicy="no-referrer" class="preview-frame">` | frame chrome + "sandboxed" pill web-badge-sandboxed |
| text | `text/*`, `application/json`, `application/xml` | `<pre class="preview-text">` limited to the first 64 KiB | truncation banner: "showing the first 64 KiB — download for the full file" |
| none | everything else (.dd, .mem, .bin, .pcap, .zip, .docx, .eml …) | nothing rendered | web-empty-preview-unsupported **(proposal)**: big file-type icon plus "No inline preview for this type — download to examine" |

**Flow**
1. Heading "Preview".
2. A `Load preview` button (small), with the hint *"logged on the chain as a download access"*.
3. While loading, the button reads `Loading…`.
4. The media is rendered.

The preview is never loaded automatically. The explicit click is the consent to log a download. Keep this, and give the button web-icon-preview (eye) plus a small chain-link glyph meaning "this will be logged".

**Security constraints the design must not break**
- The PDF preview stays inside an empty `sandbox=""` iframe. No custom PDF.js viewer, and no toolbar that requires scripts.
- CSP (`nginx.conf`) allows images, media and frames only from `self`/`blob:`/`data:`. Every preview asset must be inline SVG or a same-origin file. No external fonts, and no CDN icons.
- Label the sandboxed frame with a small `sandboxed` pill so examiners understand why PDF links inside are inert.

#### 5.1.6 Flags

`EvidenceFlag` is a single value, or none.

| Wire value | Label | Badge tone (header / lead dashboard) | Chip |
|---|---|---|---|
| `HIGH_PRIORITY` | High priority | danger → `--color-danger` | toggle chip |
| `NEEDS_LEAD_REVIEW` | Needs lead review (lead dashboard shows "Needs review") | warn → `--color-warning` | toggle chip |
| `PROCESSED` | Processed | ok → `--color-success` | toggle chip |

Chips (`.chip`, `.chip.active`) act as a radio group. Clicking the active chip clears the flag. Each chip has five states: default, hover, active (accent border, raised fill), focus, and busy **(proposal)**. Each flag gets its own glyph: web-icon-flag-high-priority (flag with exclamation), web-icon-flag-needs-review (flag with eye), web-icon-flag-processed (flag with check). Flag changes are off-chain (case activity `FLAG_CHANGED`), so do not use chain or ledger glyphs on them.

**Label inconsistency to resolve.** The same flag reads "Needs lead review" on evidence detail and "Needs review" on the lead dashboard. Standardise on **Needs lead review** **(proposal)**.

#### 5.1.7 Evidence status badges

| Status | Where | Current style | Design |
|---|---|---|---|
| `ACTIVE` | EvidenceCard, Case detail table, Search table | `pill active` (green outline) | web-badge-status-active: `--color-success` outline, dot glyph |
| `DISPOSED` | same | `pill removed` (red outline) | web-badge-status-disposed: `--color-text-muted` fill + strike-through-free label + archive-box glyph. **Not red**, because disposal is a lawful terminal transition and not an error (proposal: move off the danger tone; keep `--color-op-dispose` only for the op marker) |
| `REMOVED` (legacy) | same, treated as disposed | `pill removed` | web-badge-status-removed-legacy: the DISPOSED badge plus a "legacy" micro-tag |

#### 5.1.8 Disposed state + Dispose action

**Built today.** The chaincode sets the status to `DISPOSED` ("nothing is deleted, no further mutation permitted"). `readActiveHead` refuses further writes. The client has `disposeEvidence(id, reason)` (`DELETE /evidence/:id` with a `reason` body), **but no screen calls it**.

**Disposed-state UI (proposal)**
- A full-width `web-banner-disposed` sits under the header: archive icon plus *"DISPOSED on `<ts>` by `<actor>` — `<reason>`. The record and full custody trail are retained; no further custody events can be written."*
- The Transfer custody and Log manual access cards are replaced by a disabled placeholder with the same explanation.
- Download and Export stay available. Retention is the point.
- The EvidenceCard gets a diagonal `web-watermark-disposed` at 6 % opacity. It must print.

**Dispose action (proposal, P1).**
- A danger-outline `Dispose evidence…` button, placed last in the action row. Visible to the Case Lead and System Administrator only; permission rules must be confirmed with the authors.
- It opens `web-modal-dispose-confirm`: a required reason textarea and a typed confirmation of the evidence label.
- Copy: *"Disposal is a terminal, on-chain status change to DISPOSED. The evidence record, file and custody trail are kept; nothing is deleted."*
- Never use a trash-can icon or the word "delete". Use web-icon-dispose (sealed archive box).

#### 5.1.9 Forms on this page

For **Transfer custody**, **Log manual access** and **Post note**:
- Labels are lowercase inline (`label > input`), and errors appear as `.err` text under the form.
- Every form needs: default, focus, filled, disabled submit, busy **(proposal)**, error, and success. Success is currently implicit (a new SessionTrail row). Propose a toast `web-toast-event-written` showing the op badge and eventId, plus "queued for anchoring" when `batched: true`.
- **Proposal:** make `new custodian` a user picker (same component as the lead roster picker) instead of free text. It stays free text on the wire.

---

### 5.2 Operation-type badges

These badges are used in the AuditTrailTimeline, SessionTrail, CoC report and CSV legend.

| ID | Op | Label | Colour token | Marker glyph (proposal SVG, replaces text glyph) |
|---|---|---|---|---|
| web-badge-op-create | CREATE | `CREATE` | `--color-op-create` | plus-in-circle (current `+`) |
| web-badge-op-transfer | TRANSFER | `TRANSFER` | `--color-op-transfer` | two opposing arrows / hand-off (current `⇄`) |
| web-badge-op-access | ACCESS | `ACCESS` | `--color-op-access` | eye (current `◉`) |
| web-badge-op-dispose | DISPOSE | `DISPOSE` | `--color-op-dispose` | sealed archive box (current `×`) |
| web-badge-op-legacy-removed | REMOVE (pre-M26) | `DISPOSE` + micro-tag `legacy REMOVE` | `--color-op-dispose` at 60 % | same as dispose, with a small clock |

**Variants for each badge**
- text-only: today's `.op` bold coloured text
- filled chip: 15 % tint with a 1 px border, like `.badge.tone-*`
- timeline dot (16 px circle with the glyph inside)
- print: outline only, in `--color-print-ink`, with the glyph kept so the badge reads in black and white

Colour alone must never carry the meaning. The glyph and the text label are always present.

**Code note.** `.op-*` colours are hardcoded hex values today (`#6cae75`, `#4f86c6`, `#c9a227`). Map them to the op tokens.

---

### 5.3 File-type icon set (evidence types)

**Where used**
- Evidence detail header (24 px)
- Case detail evidence table and Search results (16 px)
- Ingest drop-zone confirmation (48 px)
- CoC report exhibit headers (16 px, print)
- Unsupported-preview empty state (64 px)

**Resolution order (proposal).** Resolve from the sniffed `mimeType` (the gateway's S20 content sniffing) first, then fall back to the `originalFilename` extension. The icon is decorative. The MIME string stays visible in the `type` row.

**Style**
- 24 px grid, 1.5 px stroke, a "document with folded corner" base silhouette.
- A type glyph inside, plus an optional 3–4 letter extension tag at the bottom.
- The tag is a filled strip in a category tint:
  - forensic acquisitions (disk, memory, bin, pcap): `--color-accent`
  - media (image, audio, video): `--color-op-transfer`
  - documents (pdf, docx, txt, csv, json, xml, html, eml): `--color-text-muted`
  - archive: `--color-warning`
- Monochrome variant for print.

| ID | Extensions | MIME (sniffed) | Glyph concept | Preview kind |
|---|---|---|---|---|
| web-filetype-disk-image | .dd, .img, .raw, .e01 | application/octet-stream | hard-disk platter / drive | none |
| web-filetype-memory-dump | .mem, .dmp, .vmem | application/octet-stream | RAM stick | none |
| web-filetype-binary | .bin, .exe, .elf | application/octet-stream | `0101` hex block | none |
| web-filetype-pcap | .pcap, .pcapng | application/vnd.tcpdump.pcap | network nodes / packet waveform | none |
| web-filetype-text | .txt, .log | text/plain | ruled lines | text |
| web-filetype-pdf | .pdf | application/pdf | PDF tag + page | pdf |
| web-filetype-image | .png, .jpg, .jpeg, .gif, .webp | image/* | mountain + sun | image |
| web-filetype-audio | .wav, .mp3, .m4a | audio/* | waveform | audio |
| web-filetype-video | .mp4, .mov, .webm | video/* | film frame + play | video |
| web-filetype-csv | .csv | text/csv | grid table | text |
| web-filetype-archive | .zip, .7z, .tar, .gz | application/zip | zipper | none |
| web-filetype-docx | .docx, .doc | application/vnd.openxmlformats-officedocument.wordprocessingml.document | paragraph lines + "W"-free generic doc tag (no vendor logos) | none |
| web-filetype-json | .json | application/json | `{ }` | text |
| web-filetype-xml | .xml | application/xml | `< />` | text |
| web-filetype-email | .eml, .msg | message/rfc822 | envelope | none |
| web-filetype-html | .html, .htm | text/html | globe + `</>` | text (shown as source text, never rendered) |
| web-filetype-unknown | anything else | anything else | blank page + `?` | none |

**Constraints**
- No vendor or brand logos (no Word or Acrobat marks).
- Inline SVG only (CSP).
- Each icon carries `aria-hidden="true"`, with an adjacent visible or `sr-only` text label giving the type.
- Sizes 16, 24, 48 and 64 px, optically adjusted at 16 px.

---

### 5.4 Chain-of-Custody court report — `/cases/:caseId/report`

**Purpose.** A printable, court-presentation CoC report for a whole case. The browser's print-to-PDF is the PDF path; there is no PDF library.

**Audience.** Case participants (a 404 for non-participants), prosecutors, and the court.

**Side effect.** Fetching the report writes one `ACCESS(coc-report)` per exhibit.

**Shell.** Rendered **outside** the app shell: no sidebar or top bar. Route guard: `RequireAuth`. Container `.report-page`, max-width 820 px, centred, 24 px padding.

#### 5.4.1 Structure (as built)

1. **Toolbar card (`.no-print`)**
   - `Print / save as PDF` (`window.print()`)
   - `Download CSV` (saves `coc-<caseId>.csv`)
   - `← back to case` link
   - error line
2. **Report header card**
   - H2 "Chain-of-Custody Report".
   - `dl.kv` with: case (name plus monospace caseId), status, description (only when present), generated (formatTs, ISO in the title), participants (`username (Case role label)`, comma-joined).
   - Hint: *"Trails reflect the ledger at the moment of assembly; generating this report appended one ACCESS(coc-report) event per exhibit, which will appear in subsequent reports."*
3. **One card per exhibit**
   - H3: the label, or the evidenceId.
   - `dl.kv` with: evidence id, file (with MIME), category, integrity proof (ni-URI), seized, location, handed over by, uploaded (`<uploadedAt> by <uploadedBy>`), status.
   - An embedded AuditTrailTimeline.
4. **Empty state:** "No evidence in this case."
5. **Loading:** "Assembling report…"
6. **Error:** "Case not found — or you are not a participant."

**CSV columns (gateway, as built):** `caseId, caseName, evidenceLabel, evidenceId, originalFilename, category, integrityProof, eventId, op, actor, ts, detail`. `ts` is raw ISO.

**Print CSS (as built, `@media print`)**
- Tokens are remapped to white paper and dark ink.
- `.no-print`, `.topbar`, `.sidebar`, `.foot` and **all `button`s** are hidden.
- `.card { break-inside: avoid; border-color: #999 }`.

#### 5.4.2 Gaps and proposals (the design deliverable)

| Element | Status | Spec |
|---|---|---|
| Letterhead band | **(proposal)** P0 | `brand-report-letterhead`: GLEIPNIR wordmark at left, the report title, "Case `<name>` · `<caseId>`" at right, and a 1 px `--color-print-rule` under it. Repeats on each page via `position: running()`/`@page` header where supported; otherwise shown on the first page only. |
| Report seal | **(proposal)** P1 | `brand-seal-mark`: circular emblem (a knotted ribbon, after the fetter Gleipnir, inside a ring with the text "CHAIN OF CUSTODY · LEDGER-BACKED"). 64 px on the header card, 20 px mono in the EvidenceCard. It is **decorative only**: it must not look like an official government or court seal, and it carries no jurisdiction wording. |
| Report metadata block | partly built | Add: "Generated by `<username>`", "Ledger snapshot at `<generatedAt>`", and "Architecture variant: `<Standard/Anchoring/Parallel/Parallel-Anchored>`" **(proposal)**. All timestamps use formatTs. |
| Exhibit summary table | **(proposal)** P0 | Printed before the per-exhibit pages. Columns: `# | Exhibit label | Evidence ID | File type | Status | Custody events (count) | Current custodian`. The file-type column shows web-filetype-* at 12 px mono. |
| Per-exhibit trail as a table | **(proposal)** P0 | For print, replace the timeline with a table. Columns: `# | Timestamp (UTC) | Operation | Actor | Detail | Event ID`. The op badge is print-outline. The monospace eventId is truncated to 12 characters with the full value in a footnote-sized line. The timeline stays on screen. |
| Integrity proof block | built as a kv row | Give it its own full-width monospace box (web-report-hash-box) with a hash icon, wrapping at any character. |
| Disposed exhibit | **(proposal)** | The status cell uses web-badge-status-disposed in outline, and the DISPOSE event reason is echoed in the exhibit header. The watermark prints at 6 %. |
| Attestation / signature block | **(proposal)** P1 | `web-report-attestation-block` at the end: "I attest that this report was generated from the GLEIPNIR ledger at the time shown." Two signature lines (Case Lead; Receiving officer), each with Name / Signature / Date (`YYYY-MM-DD`), plus a blank "Court exhibit no." box. Kept together with `break-inside: avoid`. |
| Page numbers and footer | **(proposal)** P0 | `@page { margin: 18mm 16mm 20mm; @bottom-right { content: "Page " counter(page) " of " counter(pages) } @bottom-left { content: "<caseId> · generated <ts> UTC" } }`. Chromium-based browsers support `@page` margin boxes. For other browsers, fall back to a static footer line on the last page only. |
| Screen vs print | **(proposal)** | On screen, show an A4-proportion "paper" preview: white sheet, drop shadow, on `--color-surface`. The dark app theme must not show through. |
| Print typography | **(proposal)** | 10.5 pt body, 9 pt tables, monospace 8.5 pt for hashes, black ink only, no tinted fills (they fail on B/W laser printers). Links print as plain text. |
| Toolbar icons | P1 | web-icon-print, web-icon-csv, web-icon-back. |
| Loading | P2 | web-skeleton-report: grey placeholder lines, plus a note that ACCESS events are being written. |

The CSV the toolbar downloads uses raw ISO `ts`. Propose that the CSV header documents the unit as `ts (ISO 8601 UTC)`; this needs a gateway change, flagged only as a **(proposal)**.

---

### 5.5 Lead dashboard — `/lead/dashboard`

**Purpose.** The home page for a Lead Investigator: the cases they lead, their teams, flagged evidence, and merged recent activity.

**Audience.** The `lead` role; `admin` can reach it by URL and sees all cases. Route guard: `RequireRole(['lead','admin'])`.

#### 5.5.1 Layout (as built)

A two-column `.demo`: a left `col` with three cards, and a right `col wide` with one card.

**Left column**

1. **My cases (N).**
   - A list of case links, each with a case-status pill (`pill active` only when `OPEN`) and a right-aligned `CoC report` link.
   - Empty state: "You lead no cases yet."
2. **My team.**
   - One block per led case, up to 10 cases.
   - Block header: the case name (H4 link) and an `Add member` button.
   - Each roster row: the username; a case-role badge (Case Lead uses the warn tone, others muted); a role `<select>` (Viewer / Contributor / Case Lead) that changes immediately on change; and a `Remove` button.
   - Hint: "A case keeps at least one lead; removals are server-checked."
   - Empty states: "No led cases — no roster to manage.", "No participants yet."
3. **Flagged evidence (N).**
   - Label links with a flag badge: High priority (danger) or Needs review (warn).
   - Empty state: "Nothing awaiting review."

**Right column**

- **Recent team activity.** A Timeline of up to 20 events merged from the per-case feeds, newest first.
- Each row: case name (small), activity sentence (`lib/activity.ts`), and timestamp.
- Dot tone comes from `activityTone`. There is no marker glyph today.

**Add member modal (`ui/Modal`)**
- Title: "Add member — `<case>`".
- Fields:
  - `user` select: "— pick a user —", then options formatted `username — name (role)`.
  - `role in case` select. Picking Case Lead filters the user list to global leads.
- Hints: "No global-lead users are available to add." / "Every active user is already on this roster."
- Buttons: `Grant access` (disabled until a user is picked), `Cancel`.

#### 5.5.2 Design needs and proposals

- **KPI strip (proposal, P1).** Four tiles above the columns:
  - Led cases
  - Open cases
  - Flagged — Needs lead review
  - Flagged — High priority
  
  Counts only, no trend arrows. Each tile links to the filtered list.
- **Activity type icons.** One glyph per `CaseActivityType`, rendered as the Timeline `marker`; today the dot is empty. Table below.
- **Roster row.** Add an avatar initial (`web-avatar-initial`, a 24 px circle using the first letter of the username in `--color-surface-raised`). Show a confirm popover before **Remove** (`web-popover-confirm-remove`, **proposal**); today removal happens in one click. Show an inline "saved" tick after a role change (**proposal**).
- **Last-lead guard.** When the row is the only Case Lead, disable Remove and the role select, with the tooltip "A case keeps at least one lead" (**proposal**; today the server rejects the request and the error shows).
- **Flagged list.** Show the file-type icon at 16 px, the case name, and the flag age (`FLAG_CHANGED` ts) (**proposal**).
- **Density.** Rows are 36 px, and the right column scrolls independently on desktop.

| ID | Activity type(s) | Glyph | Tone (from `activityTone`) |
|---|---|---|---|
| web-icon-activity-case-created | CASE_CREATED | folder + plus | `--color-success` |
| web-icon-activity-case-updated | CASE_UPDATED | folder + pencil | `--color-accent` |
| web-icon-activity-participant-added | PARTICIPANT_ADDED | person + plus | `--color-accent` |
| web-icon-activity-participant-removed | PARTICIPANT_REMOVED | person + minus | `--color-text-muted` |
| web-icon-activity-role-changed | PARTICIPANT_ROLE_CHANGED | person + swap arrows | `--color-accent` |
| web-icon-activity-category | CATEGORY_CREATED / RENAMED / DELETED | tag (with +, pencil, − modifiers) | accent / accent / muted |
| web-icon-activity-evidence-added | EVIDENCE_ADDED | document + plus | `--color-success` |
| web-icon-activity-evidence-assigned | EVIDENCE_ASSIGNED / UNASSIGNED | document → folder (reversed for unassign) | ok / muted |
| web-icon-activity-evidence-removed | EVIDENCE_REMOVED (off-chain index removal; not a ledger delete) | document + minus | `--color-text-muted` |
| web-icon-activity-details-updated | EVIDENCE_DETAILS_UPDATED | document + pencil | `--color-accent` |
| web-icon-activity-flag-changed | FLAG_CHANGED | flag | `--color-accent` |
| web-icon-activity-note-added | NOTE_ADDED | speech bubble | `--color-text-muted` |
| web-icon-activity-generic | unknown future types | dot | `--color-accent` |

---

### 5.6 Admin — Users — `/admin/users`

**Purpose.** Create users, assign global roles, activate or deactivate accounts, and reset passwords. Users are **deactivated, never deleted**: on-chain audit actors must keep resolving to a real username.

**Audience.** `admin` only (`RequireRole(['admin'])`).

#### 5.6.1 Layout (as built)

**Users card**
- Header "Users (N)" with a `New user` button.
- Table `.runs` with columns: `username` (mono) | `name` | `role` (badge) | `active` (pill).
- Rows are clickable and open the edit modal.
- Footer hint: "Deactivate rather than delete: on-chain audit actors must keep resolving."

**Role badges** (`ROLE_TONE`)

| Role | Label | Tone |
|---|---|---|
| admin | System Administrator | accent |
| lead | Lead Investigator | warn |
| investigator | Investigator | muted |

**Active pill:** `active` uses `pill active` (green); `inactive` uses `pill removed` (red). Proposal: make inactive neutral and muted rather than red, with a paused/slashed-person glyph.

**Create user modal**
- Fields: username, password (type=password), name (placeholder "defaults to username"), role select.
- Buttons: `Create` (disabled until username and password are filled), `Cancel`.

**Edit modal ("Edit: `<username>`")**
- A current-role badge.
- An `assign role` select, disabled when editing yourself.
- `Apply role`, disabled when editing yourself or when the role is unchanged.
- `Deactivate` / `Reactivate`, disabled when editing yourself.
- A `new password` field and a `Reset password` button, disabled when the field is empty. There is no success feedback today.
- Error line.

#### 5.6.2 Proposals

- **Split reset password into its own modal** (`web-modal-reset-password`, P1):
  - Two fields: new password, confirm.
  - A show/hide toggle (web-icon-eye / web-icon-eye-off).
  - A strength hint that makes no policy claims.
  - Success state: "Password reset for `<username>`. They will use it at next login."
  - The trigger in the edit modal becomes a key-icon button, `Reset password…`.
- **Deactivate confirm** (`web-modal-deactivate-confirm`, P1). Copy: *"`<username>` will no longer be able to sign in. Their name stays on every custody event they recorded."* The Reactivate variant is non-destructive and needs no confirmation.
- **Self-row lock.** A lock icon with the tooltip "You cannot change your own role or status" in place of silently disabled controls.
- **Table additions:** created (`YYYY-MM-DD HH:mm:ss UTC`) and a row-hover affordance (chevron). Inactive rows are dimmed to 60 % opacity.
- **Filter chips:** All / Active / Inactive, plus a role filter. Search by username.
- **Empty state:** web-empty-no-users (only the admin exists).

---

### 5.7 Admin — Cases — `/admin/cases`

**Purpose.** Create cases, change case status, manage the participant roster, and assign or unassign evidence to a case (one case per evidence item).

**Audience.** `admin` only.

#### 5.7.1 Layout (as built)

**Left column**

- **Create case** form: name, description, and a `Create` button (disabled until a name is entered). The new case opens automatically after creation.
- **All cases (N)** table: `name | status`. The status pill is `active` only for `OPEN`. Rows are clickable.

**Right column (wide)**

- **Empty state:** "Select a case to manage its roster and evidence."
- **Case header card:** name, status pill, monospace caseId (`CASE-<uuid>`).
  - Buttons `Mark OPEN` / `Mark CLOSED` / `Mark ARCHIVED`, excluding the current status.
  - An "investigator view →" link.
- **Participants (N):** rows show `username · viewer|contributor|lead` as raw lowercase text, plus `Remove`.
  - Add row: a free-text `username` input, a `role` select (viewer / contributor / case lead), and a `Grant` button.
- **Evidence (N):** rows show the evidenceId link (mono), the filename (muted), and `Unassign`.
  - Add row: a free-text `evidence id` input and an `Assign to case` button.
  - Hint: "One case per evidence item — assigning something already categorized elsewhere is refused."

#### 5.7.2 Proposals

- **Case status badges.** Three distinct badges replace the "OPEN = green, everything else plain" pill:
  - `web-badge-case-open`: `--color-success` outline, open-folder glyph.
  - `web-badge-case-closed`: `--color-text-muted`, closed-folder glyph.
  - `web-badge-case-archived`: `--color-text-muted` fill, archive-box glyph.
- **Status transition control.** A segmented control, OPEN → CLOSED → ARCHIVED, with confirmation for ARCHIVED (`web-modal-case-status-confirm`).
- **Consistency fix.** Render participants with the case-role badges and labels used on the lead dashboard (Case Lead / Contributor / Viewer). Today they are raw wire strings. Replace the free-text username with the shared user picker.
- **Evidence rows:** file-type icon, label, status badge (ACTIVE/DISPOSED), and a flag badge if set. Replace the free-text evidence-id input with a search-as-you-type picker over uncategorized evidence (**proposal**). Unassign asks for inline confirmation.
- **All-cases table columns:** `name | status | participants (count) | evidence (count) | created (UTC)`, with a filter by status.
- **Case identifier note.** Show `CASE-<uuid>` with a copy button. Never show the Parallel channel key `case-NNN` here: the library case ID and the channel routing key are deliberately separate.

---

### 5.8 Shared components used by these screens

| Component | File | States to design |
|---|---|---|
| Badge (`tone-accent/ok/warn/danger/muted`) | `components/ui/Badge.tsx` | 5 tones × {screen, print-outline} × {with icon, text-only} |
| Pill (`.pill`, `.active`, `.removed`) | `styles.css` | to be retired in favour of Badge + status icons **(proposal)** |
| Tabs | `components/ui/Tabs.tsx` | default, hover, active (underline `--color-accent`), focus, with count suffix "(N)" |
| Modal | `components/ui/Modal.tsx` | title, ✕ close (web-icon-close), overlay 60 % `--color-surface`; focus moves in on open and returns on close; Escape and overlay-click close; destructive variant (danger primary button) **(proposal)** |
| Timeline | `components/ui/Timeline.tsx` | dot tones × marker glyph; connector line `--color-border`; compact/print variants |
| Buttons | global | primary, secondary (`.small`), danger **(proposal)**, disabled with tooltip, busy |
| Error line `.err` / hint `.hint` / muted `.muted` | global | error gets web-icon-alert; hint gets web-icon-info **(proposal)** |
| Toast | **(proposal)** | success / info / error; used for event-written, copied, password reset |

---

### 5.9 Consolidated asset table

| ID | Category | Where used | Purpose | Variants / states | Size & format | Priority |
|---|---|---|---|---|---|---|
| web-badge-merkle-na | badge | Evidence detail header, SessionTrail | Merkle state: variant has no receipts (Standard, Parallel) | screen, print; tooltip | 20 px tall, inline SVG icon + CSS | P0 |
| web-badge-merkle-pending | badge | Evidence detail | verify request in flight | spinner animated / reduced-motion static | 20 px, SVG + CSS | P0 |
| web-badge-merkle-notyet | badge | Evidence detail | batch not closed / root not anchored; not a tamper signal | clock icon, `--color-warning` outline | 20 px, SVG + CSS | P0 |
| web-badge-merkle-verified | badge | Evidence detail | branch recomputed, root matches | with latency "(x.x ms)" / without | 20 px, SVG + CSS | P0 |
| web-badge-merkle-mismatch | badge | Evidence detail | root mismatch, tamper signal | alert icon, `--color-danger` | 20 px, SVG + CSS | P0 |
| web-icon-verify | icon | Verify latest, SessionTrail Verify | trigger Merkle verification | default, hover, disabled, busy | 16 px SVG | P0 |
| web-popover-verify-steps | component | Evidence detail | show fetch / recompute / compare-root time (ms) | ok / mismatch | 280 px wide, HTML/CSS | P2 (proposal) |
| web-chip-variant-indicator | chip | Evidence detail header | show the active variant (Standard/Anchoring/Parallel/Parallel-Anchored) | 4 variants via `--color-variant-*` | 20 px, CSS | P1 (proposal) |
| web-badge-op-create | badge | Timeline, SessionTrail, report | CREATE op | text / chip / dot / print | 18 px, SVG + CSS | P0 |
| web-badge-op-transfer | badge | same | TRANSFER op | text / chip / dot / print | 18 px, SVG + CSS | P0 |
| web-badge-op-access | badge | same | ACCESS op | text / chip / dot / print | 18 px, SVG + CSS | P0 |
| web-badge-op-dispose | badge | same | DISPOSE op (DisposeEvidence) | text / chip / dot / print | 18 px, SVG + CSS | P0 |
| web-badge-op-legacy-removed | badge | same | pre-M26 `REMOVE` rows shown as DISPOSE + legacy tag | chip / print | 18 px, SVG + CSS | P1 (proposal) |
| web-marker-op-create | timeline marker | AuditTrailTimeline dot | replaces `+` | screen / print | 16 px SVG | P0 |
| web-marker-op-transfer | timeline marker | same | replaces `⇄` | screen / print | 16 px SVG | P0 |
| web-marker-op-access | timeline marker | same | replaces `◉` | screen / print | 16 px SVG | P0 |
| web-marker-op-dispose | timeline marker | same | replaces `×` | screen / print | 16 px SVG | P0 |
| web-icon-access-view | icon | ACCESS detail line | sub-type: view | — | 12 px SVG | P2 (proposal) |
| web-icon-access-download | icon | ACCESS detail line | sub-type: download | — | 12 px SVG | P2 (proposal) |
| web-icon-access-export | icon | ACCESS detail line | sub-type: export | — | 12 px SVG | P2 (proposal) |
| web-icon-access-report | icon | ACCESS detail line | sub-type: coc-report | — | 12 px SVG | P2 (proposal) |
| web-toggle-collapse-access | control | AuditTrailTimeline | group consecutive ACCESS(view) rows with a count | on / off | CSS | P2 (proposal) |
| web-badge-status-active | badge | EvidenceCard, Case detail, Search, report | evidence status ACTIVE | screen / print | 20 px, SVG + CSS | P0 |
| web-badge-status-disposed | badge | same | evidence status DISPOSED (terminal, retained) | screen / print | 20 px, SVG + CSS | P0 |
| web-badge-status-removed-legacy | badge | same | legacy REMOVED status = disposed | screen / print | 20 px, SVG + CSS | P1 |
| web-banner-disposed | banner | Evidence detail | explain DISPOSED: retained, no further custody writes | screen / print | full width, HTML/CSS + 20 px SVG | P1 (proposal) |
| web-watermark-disposed | decoration | EvidenceCard, report exhibit | disposed marker that survives printing | 6 % opacity | SVG, scalable | P2 (proposal) |
| web-icon-dispose | icon | Dispose button, banner, op marker | sealed archive box (never a trash can) | default / danger | 16/20 px SVG | P1 (proposal) |
| web-modal-dispose-confirm | modal | Evidence detail | confirm DisposeEvidence with required reason | default / typed-confirm valid / busy / error | 480 px, HTML/CSS | P1 (proposal) |
| web-badge-flag-high-priority | badge | Evidence header, lead dashboard | flag HIGH_PRIORITY | chip / badge / print | 20 px, SVG + CSS | P0 |
| web-badge-flag-needs-review | badge | same | flag NEEDS_LEAD_REVIEW (label "Needs lead review") | chip / badge / print | 20 px, SVG + CSS | P0 |
| web-badge-flag-processed | badge | same | flag PROCESSED | chip / badge / print | 20 px, SVG + CSS | P0 |
| web-icon-flag-high-priority | icon | flag chips and badges | glyph for high priority | — | 14 px SVG | P1 |
| web-icon-flag-needs-review | icon | flag chips and badges | glyph for needs lead review | — | 14 px SVG | P1 |
| web-icon-flag-processed | icon | flag chips and badges | glyph for processed | — | 14 px SVG | P1 |
| web-chip-flag | control | Evidence Overview "Flag" | single-select toggle chip | default / hover / active / focus / busy | 28 px, CSS | P0 |
| web-filetype-disk-image | file-type icon | evidence header, tables, ingest, report, empty preview | .dd/.img/.raw/.e01 | 16/24/48/64; colour / mono | SVG | P0 |
| web-filetype-memory-dump | file-type icon | same | .mem/.dmp/.vmem | same | SVG | P0 |
| web-filetype-binary | file-type icon | same | .bin/.exe/.elf | same | SVG | P0 |
| web-filetype-pcap | file-type icon | same | .pcap/.pcapng | same | SVG | P0 |
| web-filetype-text | file-type icon | same | .txt/.log | same | SVG | P0 |
| web-filetype-pdf | file-type icon | same | .pdf | same | SVG | P0 |
| web-filetype-image | file-type icon | same | .png/.jpg/… | same | SVG | P0 |
| web-filetype-audio | file-type icon | same | .wav/… | same | SVG | P0 |
| web-filetype-video | file-type icon | same | .mp4/… | same | SVG | P0 |
| web-filetype-csv | file-type icon | same | .csv | same | SVG | P0 |
| web-filetype-archive | file-type icon | same | .zip/.7z/.tar/.gz | same | SVG | P0 |
| web-filetype-docx | file-type icon | same | .docx/.doc (no vendor logo) | same | SVG | P0 |
| web-filetype-json | file-type icon | same | .json | same | SVG | P0 |
| web-filetype-xml | file-type icon | same | .xml | same | SVG | P0 |
| web-filetype-email | file-type icon | same | .eml/.msg | same | SVG | P0 |
| web-filetype-html | file-type icon | same | .html/.htm (shown as source, never rendered) | same | SVG | P0 |
| web-filetype-unknown | file-type icon | same | fallback | same | SVG | P0 |
| web-icon-preview | icon | Load preview button | opt-in preview (logged as download) | default / busy | 16 px SVG | P0 |
| web-badge-sandboxed | badge | PDF preview frame | say the PDF runs in an empty sandbox | — | 18 px, CSS | P1 |
| web-preview-frame | component | Evidence Overview | chrome around image/video/audio/pdf/text preview | per kind; text truncated banner | max 100 % × 70vh, CSS | P0 |
| web-preview-poster-video | placeholder | video preview before load | poster frame | — | 16:9 SVG | P2 (proposal) |
| web-preview-poster-audio | placeholder | audio preview before load | waveform placeholder | — | 320×48 SVG | P2 (proposal) |
| web-empty-preview-unsupported | empty state | Evidence Overview | no inline preview for this type; download to examine | with 64 px file-type icon | 320 px, SVG + copy | P1 (proposal) |
| web-icon-download | icon | Download button | download evidence blob (logged) | default / disabled | 16 px SVG | P0 |
| web-icon-export | icon | Export (record + trail) | JSON export bundle (logged) | default | 16 px SVG | P0 |
| web-icon-report | icon | CoC report links (lead dashboard, case) | open court report | default | 16 px SVG | P0 |
| web-icon-transfer | icon | Transfer custody form | custody hand-off | default / disabled | 16 px SVG | P0 |
| web-icon-access-log | icon | Log manual access form | manual ACCESS | default | 16 px SVG | P1 |
| web-icon-note | icon | Examiner notes tab, Post note | append-only note | default | 16 px SVG | P1 |
| web-icon-lock | icon | participant-only hint, self-row lock | access is restricted | — | 14 px SVG | P1 |
| web-icon-copy | icon | IDs, integrity_proof, anchor, caseId | copy to clipboard | default / copied | 14 px SVG | P1 (proposal) |
| web-icon-hash | icon | integrity_proof rows, report hash box | marks an ni-URI hash | — | 14 px SVG | P1 |
| web-icon-anchor | icon | EvidenceCard anchor row | marks the anchor tx_hash | — | 14 px SVG | P2 |
| web-card-evidence | component | Overview tab | Codex-Entry-style signed evidence card | active / disposed / empty | CSS + 20 px seal | P0 |
| web-toast-event-written | component | after Transfer / Log access / Post note | confirm write; "queued for anchoring" when batched | success / batched / error | 360 px, CSS | P1 (proposal) |
| web-sessiontrail-card | component | Chain of custody tab | client-captured events this session (dashed, not ledger) | with / without Verify | CSS | P1 |
| web-skeleton-evidence-detail | loader | Evidence detail | loading skeleton | reduced-motion | CSS | P2 (proposal) |
| web-illus-evidence-not-found | illustration | Evidence detail 404 | no on-chain record / batch not closed | — | 160 px SVG | P1 |
| web-illus-no-access | illustration | Evidence detail 403 | not a participant of the case | — | 160 px SVG | P1 |
| web-empty-no-audit-events | empty state | AuditTrailTimeline | "No audit events." | — | 96 px SVG + copy | P2 |
| web-empty-no-notes | empty state | Examiner notes | "No examiner notes yet." | — | 96 px SVG + copy | P2 |
| brand-report-letterhead | print asset | CoC report header | wordmark + title + case line | screen / print | 820 px wide, SVG | P0 (proposal) |
| brand-seal-mark | brand mark | report header (64 px), EvidenceCard (20 px) | decorative custody seal (not an official seal) | colour / mono | SVG | P1 (proposal) |
| web-report-summary-table | print component | CoC report | exhibit overview table | screen / print | CSS table | P0 (proposal) |
| web-report-trail-table | print component | CoC report per exhibit | print table replacing the timeline | screen hidden / print shown | CSS table | P0 (proposal) |
| web-report-hash-box | print component | CoC report per exhibit | full-width integrity-proof box | screen / print | CSS | P1 (proposal) |
| web-report-attestation-block | print component | CoC report end | attestation + two signature lines + exhibit no. box | print | CSS, break-inside avoid | P1 (proposal) |
| web-report-page-footer | print CSS | every printed page | "Page n of N" + caseId + generated ts | @page margin boxes / fallback | CSS | P0 (proposal) |
| web-report-paper-preview | layout | report screen view | A4 paper sheet on dark surface | screen only | CSS | P1 (proposal) |
| web-icon-print | icon | report toolbar | Print / save as PDF | default | 16 px SVG | P1 |
| web-icon-csv | icon | report toolbar | Download CSV | default | 16 px SVG | P1 |
| web-icon-back | icon | report toolbar, admin links | back to case | default | 16 px SVG | P2 |
| web-skeleton-report | loader | report "Assembling report…" | loading state | — | CSS | P2 (proposal) |
| web-kpi-tile | component | Lead dashboard | led / open / needs lead review / high priority counts | default / zero / link hover | 160×72, CSS | P1 (proposal) |
| web-icon-activity-case-created | icon | activity timeline | CASE_CREATED | tone ok | 14 px SVG | P1 |
| web-icon-activity-case-updated | icon | activity timeline | CASE_UPDATED | tone accent | 14 px SVG | P1 |
| web-icon-activity-participant-added | icon | activity timeline | PARTICIPANT_ADDED | tone accent | 14 px SVG | P1 |
| web-icon-activity-participant-removed | icon | activity timeline | PARTICIPANT_REMOVED | tone muted | 14 px SVG | P1 |
| web-icon-activity-role-changed | icon | activity timeline | PARTICIPANT_ROLE_CHANGED | tone accent | 14 px SVG | P1 |
| web-icon-activity-category | icon | activity timeline | CATEGORY_CREATED/RENAMED/DELETED | +, pencil, − modifiers | 14 px SVG | P1 |
| web-icon-activity-evidence-added | icon | activity timeline | EVIDENCE_ADDED | tone ok | 14 px SVG | P1 |
| web-icon-activity-evidence-assigned | icon | activity timeline | EVIDENCE_ASSIGNED / UNASSIGNED | ok / muted (reversed) | 14 px SVG | P1 |
| web-icon-activity-evidence-removed | icon | activity timeline | EVIDENCE_REMOVED (off-chain index only) | tone muted | 14 px SVG | P1 |
| web-icon-activity-details-updated | icon | activity timeline | EVIDENCE_DETAILS_UPDATED | tone accent | 14 px SVG | P1 |
| web-icon-activity-flag-changed | icon | activity timeline | FLAG_CHANGED | tone accent | 14 px SVG | P1 |
| web-icon-activity-note-added | icon | activity timeline | NOTE_ADDED | tone muted | 14 px SVG | P1 |
| web-icon-activity-generic | icon | activity timeline | unknown future types | tone accent | 14 px SVG | P2 |
| web-avatar-initial | component | roster rows, users table | initial avatar | 24 / 32 px; inactive dimmed | CSS | P2 (proposal) |
| web-icon-add-member | icon | Add member button, Grant | add participant | default / disabled | 16 px SVG | P1 |
| web-icon-remove-member | icon | roster Remove | remove participant | default / disabled (last lead) | 16 px SVG | P1 |
| web-popover-confirm-remove | component | lead roster, admin participants | confirm participant removal | default / busy | 240 px, CSS | P1 (proposal) |
| web-modal-add-member | modal | Lead dashboard | user picker + role in case | empty list hints; lead-only filter | 440 px, CSS | P0 |
| web-empty-no-led-cases | empty state | Lead dashboard | "You lead no cases yet." | — | 96 px SVG + copy | P2 |
| web-empty-no-flagged | empty state | Lead dashboard | "Nothing awaiting review." | — | 96 px SVG + copy | P2 |
| web-empty-no-activity | empty state | Lead dashboard | "No recent activity." | — | 96 px SVG + copy | P2 |
| web-badge-role-admin | badge | Users table, edit modal, pickers | System Administrator | screen | 20 px, CSS | P0 |
| web-badge-role-lead | badge | same | Lead Investigator | screen | 20 px, CSS | P0 |
| web-badge-role-investigator | badge | same | Investigator | screen | 20 px, CSS | P0 |
| web-badge-caserole-lead | badge | rosters, report participants | Case Lead | screen / print | 20 px, CSS | P0 |
| web-badge-caserole-contributor | badge | same | Contributor | screen / print | 20 px, CSS | P0 |
| web-badge-caserole-viewer | badge | same | Viewer | screen / print | 20 px, CSS | P0 |
| web-badge-user-active | badge | Users table | account active | — | 20 px, CSS | P0 |
| web-badge-user-inactive | badge | Users table | account deactivated (neutral, not red) | — | 20 px, CSS | P0 |
| web-icon-user-add | icon | New user button | create user | — | 16 px SVG | P1 |
| web-icon-key-reset | icon | Reset password… | password reset | — | 16 px SVG | P1 |
| web-icon-deactivate | icon | Deactivate / Reactivate | toggle account | deactivate / reactivate | 16 px SVG | P1 |
| web-icon-eye | icon | password show toggle | show password | — | 16 px SVG | P2 |
| web-icon-eye-off | icon | password show toggle | hide password | — | 16 px SVG | P2 |
| web-modal-create-user | modal | Users | create user form | default / invalid / error | 440 px, CSS | P0 |
| web-modal-edit-user | modal | Users | role + status + reset entry | self-locked / normal | 440 px, CSS | P0 |
| web-modal-reset-password | modal | Users | dedicated reset with confirm field | default / mismatch / success / error | 400 px, CSS | P1 (proposal) |
| web-modal-deactivate-confirm | modal | Users | confirm deactivation (actors keep resolving) | default / busy | 400 px, CSS | P1 (proposal) |
| web-empty-no-users | empty state | Users | only the admin exists | — | 96 px SVG + copy | P2 |
| web-badge-case-open | badge | Cases admin, lead dashboard, case pages, report | case OPEN | screen / print | 20 px, SVG + CSS | P0 |
| web-badge-case-closed | badge | same | case CLOSED | screen / print | 20 px, SVG + CSS | P0 |
| web-badge-case-archived | badge | same | case ARCHIVED | screen / print | 20 px, SVG + CSS | P0 |
| web-control-case-status | control | Cases admin header | OPEN → CLOSED → ARCHIVED segmented control | current / hover / disabled | CSS | P1 (proposal) |
| web-modal-case-status-confirm | modal | Cases admin | confirm archive | default / busy | 400 px, CSS | P2 (proposal) |
| web-icon-case-create | icon | Create case | new case | — | 16 px SVG | P1 |
| web-icon-assign | icon | Assign to case | attach evidence to case | — | 16 px SVG | P1 |
| web-icon-unassign | icon | Unassign | detach evidence (off-chain index) | — | 16 px SVG | P1 |
| web-picker-user | component | Add member modal, Cases admin Grant, Transfer custody | shared user search/select | empty / filtered to leads / no results | CSS | P1 (proposal) |
| web-picker-evidence | component | Cases admin assign | search uncategorized evidence | empty / results / refused | CSS | P2 (proposal) |
| web-empty-select-case | empty state | Cases admin right column | "Select a case to manage its roster and evidence." | — | 96 px SVG + copy | P2 |
| web-icon-close | icon | Modal ✕ | close dialog | hover / focus | 16 px SVG | P0 |
| web-icon-alert | icon | `.err` lines | error marker | — | 14 px SVG | P1 (proposal) |
| web-icon-info | icon | `.hint` lines | hint marker | — | 14 px SVG | P2 (proposal) |

### Checklist

- [ ] web-badge-merkle-na — Merkle N/A (Standard, Parallel; no receipts)
- [ ] web-badge-merkle-pending — verification in flight
- [ ] web-badge-merkle-notyet — not yet anchored, not a tamper signal
- [ ] web-badge-merkle-verified — root matches, latency in ms
- [ ] web-badge-merkle-mismatch — root mismatch, tamper signal
- [ ] web-icon-verify — Verify latest / per-event Verify
- [ ] web-popover-verify-steps — fetch/recompute/compare-root ms breakdown (proposal)
- [ ] web-chip-variant-indicator — active variant chip (proposal)
- [ ] web-badge-op-create — CREATE op badge
- [ ] web-badge-op-transfer — TRANSFER op badge
- [ ] web-badge-op-access — ACCESS op badge
- [ ] web-badge-op-dispose — DISPOSE op badge
- [ ] web-badge-op-legacy-removed — legacy REMOVE shown as DISPOSE (proposal)
- [ ] web-marker-op-create — timeline marker replacing "+"
- [ ] web-marker-op-transfer — timeline marker replacing "⇄"
- [ ] web-marker-op-access — timeline marker replacing "◉"
- [ ] web-marker-op-dispose — timeline marker replacing "×"
- [ ] web-icon-access-view — ACCESS sub-type view (proposal)
- [ ] web-icon-access-download — ACCESS sub-type download (proposal)
- [ ] web-icon-access-export — ACCESS sub-type export (proposal)
- [ ] web-icon-access-report — ACCESS sub-type coc-report (proposal)
- [ ] web-toggle-collapse-access — group repeated ACCESS(view) rows (proposal)
- [ ] web-badge-status-active — evidence ACTIVE
- [ ] web-badge-status-disposed — evidence DISPOSED (retained, neutral tone)
- [ ] web-badge-status-removed-legacy — legacy REMOVED status
- [ ] web-banner-disposed — disposed explanation banner (proposal)
- [ ] web-watermark-disposed — printable disposed watermark (proposal)
- [ ] web-icon-dispose — sealed archive box, never a trash can (proposal)
- [ ] web-modal-dispose-confirm — DisposeEvidence confirm with reason (proposal)
- [ ] web-badge-flag-high-priority — High priority flag
- [ ] web-badge-flag-needs-review — Needs lead review flag
- [ ] web-badge-flag-processed — Processed flag
- [ ] web-icon-flag-high-priority — flag glyph
- [ ] web-icon-flag-needs-review — flag glyph
- [ ] web-icon-flag-processed — flag glyph
- [ ] web-chip-flag — single-select flag toggle chip
- [ ] web-filetype-disk-image — .dd/.img/.raw/.e01
- [ ] web-filetype-memory-dump — .mem/.dmp/.vmem
- [ ] web-filetype-binary — .bin/.exe/.elf
- [ ] web-filetype-pcap — .pcap/.pcapng
- [ ] web-filetype-text — .txt/.log
- [ ] web-filetype-pdf — .pdf
- [ ] web-filetype-image — .png/.jpg/…
- [ ] web-filetype-audio — .wav/…
- [ ] web-filetype-video — .mp4/…
- [ ] web-filetype-csv — .csv
- [ ] web-filetype-archive — .zip/.7z/.tar/.gz
- [ ] web-filetype-docx — .docx/.doc, no vendor logo
- [ ] web-filetype-json — .json
- [ ] web-filetype-xml — .xml
- [ ] web-filetype-email — .eml/.msg
- [ ] web-filetype-html — .html (source only)
- [ ] web-filetype-unknown — fallback
- [ ] web-icon-preview — opt-in Load preview
- [ ] web-badge-sandboxed — PDF sandbox indicator
- [ ] web-preview-frame — preview chrome per kind + 64 KiB truncation banner
- [ ] web-preview-poster-video — video poster (proposal)
- [ ] web-preview-poster-audio — audio waveform placeholder (proposal)
- [ ] web-empty-preview-unsupported — no inline preview state (proposal)
- [ ] web-icon-download — Download
- [ ] web-icon-export — Export (record + trail)
- [ ] web-icon-report — CoC report link
- [ ] web-icon-transfer — Transfer custody
- [ ] web-icon-access-log — Log manual access
- [ ] web-icon-note — Examiner notes
- [ ] web-icon-lock — restricted / self-locked
- [ ] web-icon-copy — copy ID/hash (proposal)
- [ ] web-icon-hash — ni-URI marker
- [ ] web-icon-anchor — anchor tx_hash marker
- [ ] web-card-evidence — Codex-Entry-style evidence card
- [ ] web-toast-event-written — write confirmation toast (proposal)
- [ ] web-sessiontrail-card — "Events this session" sub-card
- [ ] web-skeleton-evidence-detail — loading skeleton (proposal)
- [ ] web-illus-evidence-not-found — 404 illustration
- [ ] web-illus-no-access — 403 illustration
- [ ] web-empty-no-audit-events — empty trail
- [ ] web-empty-no-notes — empty notes
- [ ] brand-report-letterhead — report letterhead (proposal)
- [ ] brand-seal-mark — decorative custody seal (proposal)
- [ ] web-report-summary-table — exhibit summary table (proposal)
- [ ] web-report-trail-table — print trail table (proposal)
- [ ] web-report-hash-box — integrity-proof box (proposal)
- [ ] web-report-attestation-block — attestation + signatures (proposal)
- [ ] web-report-page-footer — page n of N + case + generated ts (proposal)
- [ ] web-report-paper-preview — on-screen A4 sheet (proposal)
- [ ] web-icon-print — Print / save as PDF
- [ ] web-icon-csv — Download CSV
- [ ] web-icon-back — back to case
- [ ] web-skeleton-report — report loading (proposal)
- [ ] web-kpi-tile — lead KPI tile (proposal)
- [ ] web-icon-activity-case-created — CASE_CREATED
- [ ] web-icon-activity-case-updated — CASE_UPDATED
- [ ] web-icon-activity-participant-added — PARTICIPANT_ADDED
- [ ] web-icon-activity-participant-removed — PARTICIPANT_REMOVED
- [ ] web-icon-activity-role-changed — PARTICIPANT_ROLE_CHANGED
- [ ] web-icon-activity-category — CATEGORY_* events
- [ ] web-icon-activity-evidence-added — EVIDENCE_ADDED
- [ ] web-icon-activity-evidence-assigned — EVIDENCE_ASSIGNED/UNASSIGNED
- [ ] web-icon-activity-evidence-removed — EVIDENCE_REMOVED (off-chain index)
- [ ] web-icon-activity-details-updated — EVIDENCE_DETAILS_UPDATED
- [ ] web-icon-activity-flag-changed — FLAG_CHANGED
- [ ] web-icon-activity-note-added — NOTE_ADDED
- [ ] web-icon-activity-generic — unknown activity types
- [ ] web-avatar-initial — initial avatar (proposal)
- [ ] web-icon-add-member — add participant
- [ ] web-icon-remove-member — remove participant
- [ ] web-popover-confirm-remove — removal confirm (proposal)
- [ ] web-modal-add-member — lead Add member modal
- [ ] web-empty-no-led-cases — no led cases
- [ ] web-empty-no-flagged — nothing awaiting review
- [ ] web-empty-no-activity — no recent activity
- [ ] web-badge-role-admin — System Administrator
- [ ] web-badge-role-lead — Lead Investigator
- [ ] web-badge-role-investigator — Investigator
- [ ] web-badge-caserole-lead — Case Lead
- [ ] web-badge-caserole-contributor — Contributor
- [ ] web-badge-caserole-viewer — Viewer
- [ ] web-badge-user-active — account active
- [ ] web-badge-user-inactive — account deactivated (neutral)
- [ ] web-icon-user-add — New user
- [ ] web-icon-key-reset — Reset password…
- [ ] web-icon-deactivate — Deactivate / Reactivate
- [ ] web-icon-eye — show password
- [ ] web-icon-eye-off — hide password
- [ ] web-modal-create-user — Create user modal
- [ ] web-modal-edit-user — Edit user modal
- [ ] web-modal-reset-password — dedicated reset modal (proposal)
- [ ] web-modal-deactivate-confirm — deactivation confirm (proposal)
- [ ] web-empty-no-users — only-admin empty state
- [ ] web-badge-case-open — case OPEN
- [ ] web-badge-case-closed — case CLOSED
- [ ] web-badge-case-archived — case ARCHIVED
- [ ] web-control-case-status — status segmented control (proposal)
- [ ] web-modal-case-status-confirm — archive confirm (proposal)
- [ ] web-icon-case-create — Create case
- [ ] web-icon-assign — Assign to case
- [ ] web-icon-unassign — Unassign
- [ ] web-picker-user — shared user picker (proposal)
- [ ] web-picker-evidence — uncategorized evidence picker (proposal)
- [ ] web-empty-select-case — Cases admin empty right column
- [ ] web-icon-close — modal close
- [ ] web-icon-alert — error line marker (proposal)
- [ ] web-icon-info — hint line marker (proposal)

---

## 6. Desktop app (GLEIPNIR Bench)

GLEIPNIR Bench is the authors' Windows desktop app for running the thesis experiments. It is one file, `orchestration/benchapp.pyw`, and it runs on Python 3.11 with tkinter/ttk. Double-clicking the file opens it without a console (`pyw -3.11 orchestration\benchapp.pyw`). The hover texts live in `orchestration/benchhelp.py`, all logic that is not a widget lives in `orchestration/benchcore.py`, and the charts come from `orchestration/report.py` through matplotlib. The app edits `benchmark/sweeps.yaml` in place. It previews and runs `experiment.py --exp <e0|ramp|e1|e2|e3a|e3b|ops|cell>` inside the WSL `Ubuntu-22.04` distro, shows progress and per-round results while a run is going, keeps a history with CSV/table/chart exports, suggests baselines, and backs up and restores the authors' manual-test data.

The people using it are the two thesis authors, on one laptop, sometimes during campaigns that run for hours. The design goals are:

1. Always show what is running and what is at risk: the ledger gets reset and `sweeps.yaml` may be uncommitted.
2. Make the E0 → E1 → E2 → E3 order and the baseline hand-off obvious.
3. Keep every number honest: units, what was configured vs what was measured, and the regime label.

Anything marked **(proposal)** does not exist in the code today.

---

### 6.1 Tk 8.6 platform constraints (binding on every desktop asset)

| Constraint | What it means for the design |
|---|---|
| **Images = `tk.PhotoImage` only** | PNG (Tk 8.6 reads PNG natively, alpha included) or GIF. **No SVG** and no icon fonts. Deliver every raster at each size you need, because PhotoImage can only scale by whole numbers (`zoom`/`subsample`) and has no smooth resampling. Use PNG-32 with alpha, sRGB, and no embedded colour profile. |
| **Window icon** | `root.iconbitmap(default="gleipnir-bench.ico")` on Windows (the `default=` form also covers every `Toplevel` dialog). `iconphoto(True, png16, png32, …)` is the fallback. Today the default Tk feather icon shows **(proposal: set it)**. Taskbar grouping under `pythonw.exe` also needs `SetCurrentProcessExplicitAppUserModelID("Gleipnir.Bench")` **(proposal)**, otherwise the taskbar shows the Python icon. |
| **ttk theme** | `main()` calls `ttk.Style().theme_use("vista")`. Under vista, Windows draws buttons, checkbuttons, radiobuttons, progress bars, notebook tabs and Treeview headings through uxtheme, so their **background and foreground colours are ignored**. What can be themed under vista: `ttk.Label` foreground, `tk.Label`/`tk.Canvas`/`tk.Text` colours, Treeview row tags (check that tag backgrounds render on the authors' Tk 8.6.12/8.6.13 build), and images on buttons, tabs and labels. **Every P0 asset must work under vista.** A `clam`-based custom skin **(proposal, P1)** would unlock coloured progress bars, headings, zebra rows and accent buttons. Specify both and label them "vista" / "clam skin". |
| **Fonts** | Only fonts installed on Windows 11. Use **Segoe UI** for UI text (9 pt body, 10 pt bold tab header line, 8 pt bold inside the help icon), **Consolas 9** for the plan text, the raw log and the confirm dialogs, and **Segoe UI Symbol** for glyphs the code already uses (⚠ · → Δ ×). No bundled or web fonts. |
| **DPI scaling** | The app does **not** declare DPI awareness today, so Windows bitmap-stretches it at 125/150 % and it looks blurry. Proposal: call `ctypes.windll.shcore.SetProcessDpiAwareness(1)` before `tk.Tk()`, then pick the asset set from `root.winfo_fpixels("1i") / 96`. **Deliver every icon at 16 / 24 / 32 px (@1x / @1.5x / @2x)**. Markers go at 12 / 18 / 24 px. Name files `<id>-16.png`, `<id>-24.png`, `<id>-32.png`. |
| **Canvas-drawn elements** | The help "?" icon is drawn on a `tk.Canvas` today (vector, so it scales for free). Canvas specs (stroke width, font, size) count as deliverables, alongside the PNG fallbacks. |
| **Native message boxes** | `messagebox.showinfo/showwarning/showerror/askyesno` use the Windows system icons and buttons. **They cannot be restyled.** Only the title and body text are designable. A styled replacement is a `Toplevel` **(proposal, P2)**. |
| **Colours** | Use the foundation tokens below. The current code hard-codes: a dark green (committed), a dark red (uncommitted, E3 placeholder warning, log errors), an amber/brown (run warning line, log warnings), a dark blue (read-only baseline values), two greys (hints, provenance), a pale yellow tooltip with a 1 px black border, and a pure black help icon. Every one of these maps to a token. |

**Tokens this section uses** (defined in the foundations section; if foundations names them differently, map them 1:1):
`--color-surface`, `--color-surface-raised`, `--color-border`, `--color-text`, `--color-text-muted`, `--color-text-subtle`, `--color-accent`, `--color-focus`, `--color-selection`, `--color-success`, `--color-warning`, `--color-danger`, `--color-info`, `--color-readonly-value`, `--color-tooltip-bg`, `--color-tooltip-border`, `--color-tooltip-text`, `--color-table-zebra`, `--color-log-error`, `--color-log-warn`, `--color-log-marker`, `--color-variant-standard`, `--color-variant-anchoring`, `--color-variant-parallel`, `--color-variant-parallel-anchored`, `--color-regime-smoke`, `--color-regime-steady`, `--color-regime-sub-floor`.

---

### 6.2 Window chrome and overall layout

- **Title:** `GLEIPNIR Bench — E0 · E1 · E2 · E3`. **Default geometry:** 1440 × 920. There is no minimum size today; proposal: `minsize(1280, 800)`.
- **Icon:** `desk-app-icon` (.ico). Every dialog inherits it.
- **Structure, top to bottom:**
  1. **Top status bar** (`ttk.Frame`, padding 4): status text on the left, four buttons on the right.
  2. **Vertical `ttk.PanedWindow`** with a draggable sash:
     - **Notebook** (weight 3) with 7 tabs: `Settings & Baselines` · `E0 initial test` · `E1 batch size` · `E2 channels` · `E3 main` · `Custom test` · `History & results`.
     - **Run panel** (`ttk.LabelFrame` titled `Run`, weight 2). It is **always visible**, whatever tab is selected.
- Switching tabs calls `refresh_all()` (provenance, placeholder warning, status bar, suggestions, history).
- Closing is guarded (see 6.7).
- While an experiment runs, the laptop is kept awake (`SetThreadExecutionState`). Nothing in the UI shows this today. **Proposal:** a small `desk-status-keep-awake` indicator in the Run panel.

---

### 6.3 Top status bar

Today this is one `ttk.Label` built from three segments joined by `   ·   `. The whole label turns `--color-danger` when the file is dirty and `--color-success` when it is clean.

| Segment | Real text | State → token / icon |
|---|---|---|
| sweeps.yaml commit state | `⚠ sweeps.yaml has UNCOMMITTED changes — run.json cites its SHA: commit before a campaign` / `sweeps.yaml committed` | uncommitted → `--color-danger` + `desk-status-uncommitted`; committed → `--color-success` + `desk-status-committed` |
| Unsaved input boxes | `N unsaved change(s)` / `no unsaved changes` / on bad input the parse error, e.g. `'Caliper workers': not a valid int` | unsaved → `--color-warning` + `desk-status-unsaved`; clean → `--color-text-muted` + `desk-status-saved`; invalid → `--color-danger` + `desk-status-invalid-input` |
| Ledger origin | `ledger holds: test data` / `ledger holds: benchmark:<exp>@<YYYYMMDD-HHMMSS>` | test data → `desk-status-ledger-test-data` (`--color-success`); benchmark → `desk-status-ledger-benchmark` (`--color-warning`, meaning "your manual-test trails are not on the ledger; Restore to get them back") |

**Proposal (P1):** split this into three separate chip labels, each with its own 16 px icon and colour, so a clean commit state is not coloured red just because the ledger holds benchmark data, or the other way round. Today the whole line takes the commit-state colour.

**Buttons on the right**, left to right as rendered (packed `side="right"` in reverse order). Each has a hover tooltip from `BUTTON_HELP`:
`Save changes` (`desk-icon-save`) · `Revert (reload file)` (`desk-icon-revert`) · `Back up now` (`desk-icon-backup`) · `Restore my test data…` (`desk-icon-restore`).

---

### 6.4 Shared tab anatomy

- **Tab header line** (every tab, from `TAB_HELP[title]`): a bold one-liner in Segoe UI 10 bold, then a **help icon** whose tooltip is the long detail text, then the muted hint `(hover the ? icons for details)` in `--color-text-subtle`.
- **Field rows** (`fields()`): label with unit, `ttk.Entry` (width 26), then a help icon, in a `ttk.LabelFrame`. Each `sweeps.yaml` value is editable in **exactly one** tab.
- **Read-only boxes** (`readonly()`): label, then the value in `--color-readonly-value`, then a help icon. The footer reads `(edit in Settings & Baselines, or via “Use as baseline”)` in `--color-text-subtle`. **Proposal:** a `desk-status-readonly` lock glyph before each value.
- **Variant checkboxes** (`variant_boxes()`): `ttk.Checkbutton`, all ticked by default. In E0, E3 and Custom test the labels today are the raw ids (`standard`, `anchoring`, `parallel`, `parallel-anchored`). **Proposal (P0 copy fix):** show the exact names **Standard, Anchoring, Parallel, Parallel-Anchored**, each with a `desk-variant-*` marker (`compound="left"` image on the Checkbutton). E1 already uses proper names, plus `(reference line)` suffixes.
- **Repetitions box:** `repetitions (blank = sweeps.yaml r)` plus a small Entry (width 6).
- **Action row** (`actions()`): `Preview plan` (`desk-icon-preview`) · `Run…` (`desk-icon-run`) · `Resume…` (`desk-icon-resume`), each with a tooltip, then an optional muted note.
- **Suggestion panel** (`suggestion()`, used by E0, E1 and E2): a LabelFrame containing a Treeview (7 rows, right-aligned), a **verdict line** (wraps at 1250 px, default text `no results yet`), and a button row that is rebuilt every time suggestions refresh. **Proposal:** give the panel a left accent bar or a `desk-icon-suggestion` glyph in its title so it reads as "the app suggests, you decide".
- **Help icon** (`help_icon()`): today a 16 px Canvas, 1 px black circle, black bold "?" in Segoe UI 8, background matched to the frame so it looks transparent, cursor `question_arrow`. See `desk-help-icon`.
- **Tooltip** (`Tip`): an undecorated `Toplevel` at pointer +14/+16. Label background is pale yellow, 1 px solid border, padding 8×6, Segoe UI 9, left-justified. The texts are pre-wrapped at about 100 characters with `\n`. Column-heading tooltips (`heading_tips`) use the same class and follow the column under the pointer. Proposals: clamp the tooltip inside the screen (today it can run off the right edge), delay it by about 400 ms, and use tokens (`desk-tooltip-style`).

---

### 6.5 Tabs, screen by screen

#### 6.5.1 Settings & Baselines
- Header: *"Controlled workload (set once, identical for every variant) + the baselines carried into E3."* plus a help icon.
- **LabelFrame `Controlled workload (identical for every variant)`.** Fourteen rows, each with a help icon, labels exactly as in `FIELDS`: `seed (trace PRNG — same sequence for all variants)`, `Caliper workers`, `repetitions r (results = mean ± SD)`, `evidence items per case (n)`, `write events per case per round (n)`, `trace rounds per run at one send rate (n)`, `TransferCustody weight (relative)`, `AccessLog weight (relative)`, `fraction of evidence disposed (0–1)`, `evidence file size (B) — off-chain; only its hash goes on-chain`, `cases reconstructed for audit time (n)`, `batcher flush timeout (ms, 0 = size-only)`, `CPU/memory monitor interval (s)`, `steady floor (write events per channel) — methodology rule`.
- **LabelFrame `Baselines — calibrated in E0/E1/E2, held fixed in E3`**. In code the title continues with a terminology reminder; proposal: keep it to the text above. Four rows: `send rate (tx/s) — from E0`, `batch size (events) — from E1`, `cases (= channels on Parallel variants) — E2 median`, `max cases / channels — E2 top of healthy range`. A fourth column shows the **provenance note** read from the YAML comment tag: `PLACEHOLDER until E0|E1|E2` / `set from <exp> <YYYY-MM-DD>` / `set by hand <YYYY-MM-DD>`, in `--color-text-subtle` today. **Proposal (P0):** a provenance badge per row: `desk-status-placeholder` (`--color-warning`), `desk-status-set-from` (`--color-success`), `desk-status-set-by-hand` (`--color-info`).
- **Floor hint line** (live): `nominal N write events per case per run (floor F). The seeded trace scatters channels around it — Preview shows the real least-loaded channel.`
- Footer note: `Save writes benchmark/sweeps.yaml in place (comments kept). Hand-edited baselines are tagged “set by hand <date>”; suggested ones “set from <exp> <date>”.`

#### 6.5.2 E0 initial test
- Header: *"Goal: check everything works on all 4 variants, then find roughly where each variant saturates."*
- **LabelFrame `step`**, two radio buttons with tooltips:
  - `smoke test — functional correctness only (label smoke)`
  - `ramp — short send-rate ramp to locate saturation`

  **Proposal:** regime marker `desk-regime-smoke` next to the first and `desk-regime-sub-floor` next to the second.
- **`smoke test` fields:** smoke cases, evidence per case, logs per case min/max, smoke send rate (tx/s).
- **`ramp` fields:** `ramp events per case per send rate (n)`, `send-rate grid (tx/s) — ramp + E3a` (comma-separated list).
- `variants` checkboxes (all four).
- Read-only box **`ramp cases (provisional until E2)`**: `baseline.channels`.
- Action row, with note `1 repetition by design. Results are labelled smoke / sub-floor, never steady.`
- **Suggestion panel `Suggested baseline send rate (from the ramp)`.**
  - Columns: `variant` · `saturation (tx/s)` (or `not reached`) · `suggested (tx/s)`.
  - Verdict: `suggested baseline send rate = N tx/s (the lowest variant's suggestion, since E1/E2/E3b run every variant at it — confirm with D) · trimmed grid [..] · <notes>`.
  - Buttons: **`Use N tx/s as baseline…`** (`desk-icon-use-baseline`) and **`Use trimmed grid as send-rate grid…`** (`desk-icon-use-trimmed-grid`). Neither has a tooltip today; proposal: add them.

#### 6.5.3 E1 batch size
- Header: *"Goal: choose the baseline batch size for the anchored variants (calibration, reported in the paper)."*
- **`independent variable`:** `batch-size grid (events per batch)`.
- **`variants`:** `Anchoring`, `Parallel-Anchored`, `Standard (reference line)`, `Parallel (reference line)`. **Proposal:** the reference-line rows use `desk-variant-reference-line` (a dashed-line glyph) next to the variant marker.
- Read-only **`held fixed`:** baseline send rate and cases.
- Repetitions box; action row.
- **Suggestion panel `Suggested baseline batch size (methodology §4.1)`.**
  - Columns: `variant`, `batch`, `reps`, `throughput (TPS)`, `Δ to next (%)`, `on-chain B/event`, `Δ to next (%) ` (a duplicate label, kept unique by a trailing space), `audit s/case`, `audit ratio`, `qualifies` (`yes`/blank).
  - **Proposal (P0 copy):** unit-complete, unambiguous headers: `batch (events)`, `reps (n)`, `throughput (TPS, mean)`, `Δ throughput to next (%)`, `on-chain (B/event)`, `Δ on-chain to next (%)`, `audit (s/case)`, `audit ratio (×)`, `qualifies`. Render `qualifies` with `desk-mark-yes` instead of text.
  - Verdict: `suggested baseline batch size = N (per variant: {...}; the variants DISAGREE — the larger level is taken) · … · thresholds: confirm with D`.
  - Button: **`Use N as baseline batch size…`**.

#### 6.5.4 E2 channels
- Header: *"Goal: find how many cases/channels Parallel handles on this host before it stops scaling."*
- **`independent variable (Parallel only; cases = channels)`:** `channel = case grid (n)`.
- Read-only **`held fixed`:** baseline send rate.
- Repetitions box. Action-row note: `host: N logical cores seen by Windows (WSL figure is in each run.json)`.
- **Suggestion panel `Suggested cases/channels (methodology §4.2: median of the healthy range)`.**
  - Columns: `channels`, `reps`, `throughput (TPS)`, `× previous`, `failure (%)`, `CPU (%)`, `CPU budget (%)`, `memory (MB)`, `healthy`, `reason`.
  - **Proposal:** `channels (n)`, `reps (n)`, `throughput × previous (ratio)`, and `healthy` shown as `desk-mark-yes` / `desk-mark-no`. Also tint the first unhealthy row with `--color-warning` at low alpha.
  - Verdict: `healthy range [..] → suggested cases/channels = N (median), max = M (top) · … · thresholds: confirm with D`.
  - Button: **`Use N / max M as baselines…`**.

#### 6.5.5 E3 main
- Header: *"Goal: the paper's main experiment — compare the 4 architectures' scalability, baselines fixed."*
- **`experiment` radio buttons**, each with a tooltip:
  - `E3a — scalability vs send rate (one round per send rate)`
  - `E3b — scalability vs cases (Parallel: one channel per case)`
  - `per-operation breakdown (writes and reads in separate tables)`
- **`E3b grid`:** `case grid (n, trimmed to ≤ max cases)`.
- `variants` (all four).
- Read-only **`held fixed — the baselines from E0/E1/E2`:** the four baselines plus the send-rate grid.
- **Placeholder warning line** in `--color-danger`, shown only while any baseline tag is `PLACEHOLDER…`: `⚠ still PLACEHOLDER (run E0/E1/E2 and confirm the suggestions first): <labels>`. **Proposal:** a `desk-banner-placeholder` treatment (warning icon + tinted strip).
- Repetitions box. Action-row note: `Supervisor gate: the variable table + three flowcharts go to D before E3 runs.`

#### 6.5.6 Custom test
- Intro line (muted): `One ad-hoc cell (experiment.py --exp cell): a probe, not an E1–E3 datapoint — results go to results/cell/ and the CSV only. Blank = the sweeps.yaml value.`
- **`independent variables`**, each with a help icon: `send rate(s), tx/s (several → one round each)`, `batch size (events, anchored variants)`, `cases (= channels on Parallel variants)`.
- **`controlled workload overrides (recorded in run.json; own results dir)`:** 12 rows, labelled `--flag  (help)` from `experiment.CONTROL_FLAGS`: `--seed`, `--workers`, `--rounds`, `--events-per-case`, `--evidence-per-case`, `--transfer-weight`, `--access-weight`, `--dispose-fraction`, `--payload-bytes`, `--audit-cases`, `--flush-timeout-ms`, `--monitor-interval`. Each has an Entry (width 10) and a help icon.
- `variants` checkboxes.
- Option checkboxes with tooltips:
  - `reuse the running ledger (ONE run only)`. **Proposal:** a `desk-icon-warning` next to it, because it skips reset and backup.
  - `no resource monitor`
  - `no audit reconstruction`
- Repetitions box; action row.
- **Proposal:** a "probe" badge (`desk-badge-probe`) in the tab header so custom results are never mistaken for E-series data.

#### 6.5.7 History & results
- Header: *"Every run so far, its per-round results, and the exports for Excel."*
- **Toolbar**, left to right:
  - `experiment` label
  - Combobox (read-only, width 8): `all`, `e0`, `ramp`, `e1`, `e2`, `e3a`, `e3b`, `ops`, `cell`
  - `Refresh` (`desk-icon-refresh`; no tooltip, proposal: add one)
  - checkbox `decimal comma (; separated — Indonesian Excel)` with tooltip
  - `Export per-round CSV…` (`desk-icon-export-csv`)
  - `Export summary tables…` (`desk-icon-export-tables`)
  - `Generate tables + charts` (`desk-icon-generate-charts`)
  - `Open results folder` (`desk-icon-open-folder`)
- **Horizontal split:**
  - **Left, runs list** (Treeview, newest first): `runId` (330 px), `status`, `regime`, `started (UTC)`, `wall (min)`.
    - `status` is `complete` / `failed`. Proposal: `desk-status-run-complete` / `desk-status-run-failed` icons in the cell via Treeview row image, plus a `failed` row tint.
    - `regime` is `smoke` / `steady` / `sub-floor`. Proposal: the matching `desk-regime-*` marker.
    - `started (UTC)` is shown as `YYYY-MM-DD HH:mm:ss`. **Proposal (P0 copy):** append ` UTC` to match the timestamp rule.
    - Proposal headers: `run id`, `status`, `regime`, `started (UTC)`, `wall (min)`.
  - **Right, inner Notebook:**
    - **`per-round results`:** the same 14 columns as the live table minus `run` (see 6.6). Empty or mismatched attempt → a single row `no results for this attempt (failed, cancelled or re-run since)`. Proposal: `desk-empty-no-results`.
    - **`charts`:** a Listbox (6 rows) of **full PNG paths** under `docs/results/<exp>/<exp>-<metric>.png`, and a `tk.Label` showing the selected PNG (charts are 832 × 546 px from matplotlib at 6.4 × 4.2 in and 130 dpi; subsampled by 2 when wider than 1000 px).
      - Proposal: list the metric name (e.g. `throughput (TPS)`) instead of the path.
      - Empty-state art (`desk-empty-no-chart`).
      - A `viz-bench-chart-theme` so the matplotlib lines use `--color-variant-*` with exact variant names in the legend. Today they use matplotlib's default colour cycle and the raw ids.
      - The E1 reference lines are dashed; the E3a `y = x (send rate)` diagonal and the saturation verticals are dotted.
- Proposal: tab icons on the inner notebook, `desk-tab-per-round` and `desk-tab-charts`.

---

### 6.6 Run panel (always visible)

| Row | Widgets (real) | States / copy |
|---|---|---|
| 1 | Overall `ttk.Progressbar` (360 px), status text `p_text`; on the right `verbose Caliper output` checkbox and the **`Cancel`** button (disabled when idle) | `idle` · `preview: running…` · `backup-before-<exp>: running…` · `backup: running…` · `restore: running…` · `stack-up: running…` · `<exp>: running…` · `run i/n · P % done · elapsed hh:mm:ss · ETA …` · `cancel requested — the current step finishes, nothing further is started` · `cancelling (SIGINT)… if it is still running after 30 s, click Force stop` · `force-stopping (SIGKILL)…` · `cancelled` · `cancelled before start` · `cancelled — backup kept, restarting the stack (no run was started)` · `<tag> finished (exit N)` |
| 2 | Round/Caliper `ttk.Progressbar` (360 px, max = the round's tx count, value = Caliper submitted), text `p_now` | `<runId> · regime <smoke/steady/sub-floor> · round j/m <label> @ R tx/s · Caliper submitted S · succ A · fail B · unfinished U` |
| 3 | Warning line (`--color-warning`, wraps at 1350 px) | `! <text>` from experiment.py `!` lines, e.g. sub-floor channel warnings. Proposal: `desk-icon-warning` instead of `!`. |
| 4 | **Live results table** (Treeview, 6 rows high, auto-scrolls to the newest row) | Columns + widths: `run` 230 · `round` 80 · `send rate (tx/s)` · `throughput (TPS)` · `latency min (s)` · `latency max (s)` · `latency avg (s)` · `latency p95 (s)` · `CPU (%)` · `memory (MB)` · `success (n)` · `failure (n)` · `failure rate (%)` · `on-chain (B/event)` · `off-chain (B/event)`. Every heading has a hover tooltip (`COLUMN_HELP`). A row appears when its round is `done`. **CPU, memory and on-chain/off-chain (B/event) stay blank until the run is collected**, then fill in with the same per-run storage value repeated on each row. Numbers are right-aligned; `run`/`round` are left-aligned. |
| 5 | `show raw log` checkbox + muted path `log: benchmark/results/benchapp-logs/<YYYYMMDD-HHMMSS>-<label>.log` | Log hidden by default |
| 6 | Raw log `ScrolledText`, Consolas 9, 10 lines, capped at 5000 lines | Tags: `err` → `--color-log-error`, `warn` → `--color-log-warn`. Proposal: `--color-log-marker` for `@@…` marker lines and for plan/run header lines. |

Design notes:
- The two progress bars are identical today and unlabelled. **Proposal (P0):** label them `overall` / `this round (Caliper)`.
- Under the clam skin **(proposal)**, colour the overall bar `--color-accent` and the round bar `--color-info`. Show an **indeterminate** animation during preview, backup, restore and stack-up; today the bars just sit at 0.
- Cancel changes to **`Force stop`** after the first click during an experiment. Proposal: a `--color-danger` treatment and the `desk-icon-force-stop` glyph.
- The **supervisor columns** order must not change: it matches the per-round CSV export and the paper's tables. `send rate` is the configured input and `throughput` is the measured output, and they should look different. **Proposal:** a thin divider, or a heading-group caption `configured | measured` above the columns.
- Proposal: prefix each live row with the variant marker (`desk-variant-*` as the Treeview row image) and apply zebra rows (`desk-table-style`).

---

### 6.7 Dialogs and message boxes

| Dialog | Trigger | Content (real) | Buttons |
|---|---|---|---|
| **Confirm run** (`Toplevel`, modal, title `Run <exp>?`) | `Run…`/`Resume…` after a successful dry-run preview with todo > 0 | Read-only Consolas text (130 × 24): the **plan lines**, then **wipe warning** (`EVERY run resets the ledger (orderer/peer ledgers, receipt store, verify metrics). The manual-test custody trails on the ledger are erased; accounts, cases and evidence files are not touched.`), then **backup location** (`Before the first run the app backs up ALL gleipnir_* volumes to <repo>\backups\<YYYYMMDD-HHMMSS>` + `and [Restore my test data] puts them back afterwards.`), then `Baselines used:` with each value and its `[provenance]`, then `⚠ benchmark/sweeps.yaml has uncommitted changes — commit it so run.json's SHA is citable.` if dirty. The reuse-ledger variant replaces the wipe text with `REUSE the running ledger: no reset and no backup…`. **Checkbox** (only when the ledger already holds benchmark data and this is not a reuse run): `skip the backup — the ledger already holds benchmark data (<origin>); your test data is in an earlier backup` | `Cancel`, `Start` (right-aligned) |
| **Plan preview** (`Toplevel`, non-modal, title `Plan preview (nothing was run)`) | `Preview plan` | Consolas text (130 × 26): run list, regimes, sub-floor warnings, ETA | Window close only. Proposal: a `Close` button + `Run…` shortcut |
| **Restore picker** (`Toplevel`, modal, title `Restore my test data`) | `Restore my test data…` | Warning paragraph `Every gleipnir_* volume and network/compose/.env are REPLACED by the backup; the stack is stopped and started again (no channels are re-created). Benchmark results on disk are kept.`; Listbox (110 × 10), one row per complete backup: `<YYYYMMDD-HHMMSS>   <reason>   variant=<v>   ledger held: <origin>   <N> MB`; the newest backup whose ledger held test data is preselected | `Cancel`, `Restore` |
| Unsaved changes (askyesno) | Preview/Run/Resume/Use-as-baseline with dirty inputs | `experiment.py reads benchmark/sweeps.yaml.` / `Save these N change(s) first?` + `  path = value` list | Yes / No |
| Use as baseline (askyesno) | any `Use … as baseline…` / `Use trimmed grid…` | `Write into benchmark/sweeps.yaml?` + `  path: old  →  new` + `Tagged “set from <exp> <date>”.` + a reminder that the value is a baseline and the thresholds are still to be confirmed with D | Yes / No |
| Back up now (askyesno) | `Back up now` | `The stack stops for about a minute while every gleipnir_* volume is copied to backups/<ts>, then starts again. Continue?` | Yes / No |
| Quit (askyesno) | Window close while busy | `A benchmark process is running. Cancel it and quit? (Resume it later from the same tab.)` | Yes / No |
| Please wait (warning) | Close during backup/restore/stack-up | `A backup, restore or stack restart is in progress — closing now could leave the stack stopped. Wait for it to finish.` | OK |
| Busy (warning) | any action while busy | `A benchmark process is already running.` / `A benchmark is using benchmark/sweeps.yaml right now — save after it ends (run.json must cite the values the run actually used).` / `…apply after it ends.` | OK |
| Busy (error) | skip-backup/reuse path finds another experiment.py | `Another experiment.py is running in WSL.` | OK |
| Nothing to run (info) | Resume with everything complete | `Every run of this plan is already complete (Resume skips them).` | OK |
| Finished (info) | experiment exit 0 | `<exp> complete. Results: History & results tab; per-round CSV benchmark/results/<exp>/<exp>-results.csv. [Restore my test data] brings your manual-test ledger back.` | OK |
| `<exp> stopped (exit N)` (error) | experiment exit ≠ 0 | last 20 log lines + `Fix the cause, then Resume from the same tab.` | OK |
| Preview failed / Backup failed — nothing was run / Restore failed / Stack did not come back up (error) | the matching step fails | last 20 log lines | OK |
| Restored (info) | restore OK | `Restored <ts> (<reason>).` | OK |
| No backups (info) | Restore with none | `No complete backup in backups/ yet.` | OK |
| Not saved / Not written / Invalid input (error) | validation or file-changed-on-disk | e.g. `'<label>': not a valid int`, `benchmark/sweeps.yaml changed on disk since it was loaded — Reload first` | OK |
| Pick an experiment / CSV only / No results / Written / Exported / Not exported (info/error) | History exports | e.g. `Choose one experiment in the filter first.`, `<exp> has no aggregated tables/charts (smoke, ramp and custom tests stay out of the paper's tables).`, `mean ± SD tables + charts in <dir>`, `<path>` / `no complete <exp> runs yet`, `… Is the file open in Excel?` | OK |
| GLEIPNIR Bench (error) | any uncaught Tk callback exception | `<ExceptionName>: <message>` | OK |
| Native file pickers | CSV export (`<exp>-results.csv`, filter `CSV (Excel)`), summary-table folder (`Folder for the <exp> summary tables`) | Windows common dialogs; cannot be styled | — |

Proposals for the dialogs:
- **Confirm run (P1):**
  - A header strip with `desk-icon-warning` and the one-line summary "N runs · ledger will be reset · backup to …".
  - The wipe paragraph visually separated from the plan, on a `--color-warning` tint.
  - The skip-backup checkbox styled as a deliberate opt-out.
  - `Start` as the accent button with `desk-icon-run`.
  - No Enter-key default on `Start`; `Esc` = Cancel.
- **Restore picker (P1):** replace the Listbox with a Treeview. Columns: `backup (UTC)` shown as `YYYY-MM-DD HH:mm:ss UTC` (the folder name stays as it is; today it uses local time, so the display must convert), `reason`, `variant`, `ledger held`, `size (MB)`. Put a `desk-status-ledger-test-data` / `desk-status-ledger-benchmark` icon on each row.

---

### 6.8 State catalogue

| State | Where it shows | Visual treatment (existing → proposal) |
|---|---|---|
| **Idle** | `p_text` = `idle`, Cancel disabled, bars at 0 | `desk-status-idle` (proposal) |
| **Preview running** | `preview: running…`, Cancel enabled | indeterminate bar + `desk-icon-preview` (proposal) |
| **Plan preview shown** | Plan preview dialog | — |
| **Awaiting confirmation** | Confirm-run dialog (modal) | — |
| **Backup running** | `backup-before-<exp>: running…` / `backup: running…`, Cancel enabled (stops only what comes next) | `desk-status-backup-running` + indeterminate bar |
| **Backup cancelled** | `cancelled — backup kept, restarting the stack (no run was started)` → stack-up | `desk-status-cancelling` then `desk-status-stack-restarting` |
| **Backup failed** | error box → automatic stack-up | `desk-status-run-failed` |
| **Experiment running** | `run i/n · P % done · elapsed · ETA` + round line + live rows; laptop kept awake | `desk-status-run-running` (animated GIF frames, P2) + `desk-status-keep-awake` |
| **Cancelling** | `cancelling (SIGINT)…`, button becomes `Force stop` | `desk-status-cancelling`, button in `--color-danger` |
| **Force-stopping** | `force-stopping (SIGKILL)…` | `desk-icon-force-stop` |
| **Finished** | `exp finished (exit 0)`, Finished info box, suggestions + history refreshed, ledger origin now `benchmark:…` | `desk-status-run-complete`; the status bar ledger segment switches to `desk-status-ledger-benchmark` |
| **Failed / stopped** | `<exp> stopped (exit N)` error box; the runlog row is `failed` | `desk-status-run-failed`; History row tinted |
| **Restore running** | `restore: running…`, **Cancel disabled** (half-replaced volumes are worse than waiting) | `desk-status-restore-running` + indeterminate bar |
| **Restored / restore failed** | info / error box; ledger origin reset to the backup's origin | `desk-status-ledger-test-data` |
| **Stack restarting** | `stack-up: running…`; on failure `Stack did not come back up` | `desk-status-stack-restarting` |
| **Placeholder baselines** | E3 red warning line; provenance `PLACEHOLDER until …` in Settings | `desk-status-placeholder` + `desk-banner-placeholder` |
| **Uncommitted sweeps.yaml** | status bar in `--color-danger`; line in the confirm dialog | `desk-status-uncommitted` |
| **Unsaved / invalid input** | status bar segment; dialogs on action | `desk-status-unsaved` / `desk-status-invalid-input` (proposal: Entry border in `--color-danger` needs the clam skin) |
| **Ledger holds test data / benchmark data** | status bar; skip-backup option; restore preselection | `desk-status-ledger-test-data` / `desk-status-ledger-benchmark` |
| **No results yet** | suggestion verdict `no results yet` with an empty tree; History per-round `no results for this attempt…`; charts list empty | `desk-empty-no-results`, `desk-empty-no-chart` |
| **No backups** | info box | `desk-empty-no-backups` (P2, if the picker is redesigned) |
| **Busy refusal** | Busy warnings | native box |

---

### 6.9 UX flows

1. **Preview only:**
   1. On any E-tab or Custom test, click `Preview plan`.
   2. If inputs differ from the file, the *Unsaved changes* dialog appears (Yes saves; No aborts).
   3. The Run panel shows `preview: running…`, then the *Plan preview (nothing was run)* window opens. Nothing is reset.
2. **Run (the main path):**
   1. Click `Run…`. The *Unsaved changes* check runs, then a dry-run preview.
   2. If todo = 0 → *Nothing to run*.
   3. Otherwise the **Confirm run** dialog shows the plan, the wipe warning, the backup path, the baselines with provenance, the uncommitted warning, and optionally the skip-backup checkbox.
   4. Click `Start`. The **backup** step stops the stack and copies every `gleipnir_*` volume plus `.env` to `backups/<ts>/`, verified by `@@backup-ok`.
   5. The ledger origin becomes `benchmark:<exp>@<ts>` and the **experiment** runs (`--wipe`, keep-awake on).
   6. **Live results:** a row per finished round; CPU/memory/B-per-event fill in when the run is collected; the overall bar advances per run.
   7. The *Finished* box appears, suggestions and History refresh.
   8. Click `Restore my test data…`. The picker preselects the newest backup whose ledger held test data. Click `Restore` → *Restored*, and the ledger origin goes back to `test data`.
3. **Baseline suggestion:**
   1. After a ramp, E1 or E2 run completes, the suggestion table and verdict fill in on that tab.
   2. Click `Use … as baseline…`. If a run is active → *Busy*. If inputs are unsaved → *Unsaved changes*.
   3. The *Use as baseline* confirm shows `old → new` and the tag.
   4. `sweeps.yaml` is written in place and the provenance becomes `set from <exp> <date>`. The status bar turns **uncommitted** (red) until the authors commit outside the app.
   5. The E3 placeholder warning clears once all four baselines are set.
4. **Cancel / resume:**
   1. First `Cancel` during a run sends SIGINT to the app's own process group; the button becomes `Force stop`.
   2. A click ≥ 30 s later sends SIGKILL.
   3. The run is logged `failed` → *`<exp> stopped (exit N)`* → `Resume…` on the same tab. Resume previews with `--resume`, confirms (remaining runs only), backs up (or skips if the ledger already holds benchmark data), and continues.
   4. During Preview or backup, Cancel only stops what comes next (a finished backup is kept, then the stack restarts).
   5. During restore or stack-up, Cancel is unavailable.
   6. Closing the window mid-run asks *Quit*, then cancels.
5. **Experiment order E0 → E1 → E2 → E3:**
   1. The E0 smoke test checks function (label `smoke`).
   2. The E0 ramp suggests the baseline send rate and a trimmed grid.
   3. E1 (at that send rate and the provisional case count) suggests the batch size.
   4. E2 suggests cases (median of the healthy range) and max cases.
   5. E3a / E3b / per-operation breakdown run with all baselines fixed, and only after the supervisor gate (variable table + three flowcharts to D).

   **Proposal (P1):** a step indicator in each E-tab header (`desk-step-indicator`: E0 ● E1 ○ E2 ○ E3 ○). A step is marked done when its baseline tag is `set from …`.
6. **Custom test with reuse ledger:** tick `reuse the running ledger (ONE run only)`. The confirm dialog shows the REUSE text; there is no backup; a busy-check guards the run; the ledger origin is not changed.

---

### 6.10 Visual styles (specs, not files)

- **`desk-tooltip-style`:**
  - Background `--color-tooltip-bg`, 1 px border `--color-tooltip-border`, text `--color-tooltip-text`, Segoe UI 9, padding 8 × 6, max width about 640 px.
  - Offset +14/+16 from the pointer, flipped left/up near screen edges (proposal), 400 ms delay (proposal).
  - The same style serves column-heading tooltips.
- **`desk-help-icon`:**
  - A circle with a centred "?". Stroke and glyph in `--color-text`, fill transparent (the frame background shows through).
  - Sizes 16/24/32; stroke 1 px at 16, 1.5 at 24, 2 at 32; glyph Segoe UI bold 8/11/14 pt.
  - Hover state: stroke and glyph in `--color-accent`. Cursor `question_arrow`.
  - Deliver as a Canvas spec plus PNG fallbacks (normal/hover).
- **`desk-progress-style`:** vista uses the native green, which cannot be recoloured. Clam skin (proposal): trough `--color-border`, bar `--color-accent` (overall) / `--color-info` (round), height 10 px, indeterminate mode for non-experiment steps.
- **`desk-table-style`:**
  - Treeview rows 22 px at @1x. Headings Segoe UI 9 semibold (clam) or native (vista).
  - Numeric columns right-aligned with tabular digits (Segoe UI has tabular figures by default).
  - Zebra rows with `--color-table-zebra` on odd rows (tags `odd`/`even`, proposal); selection `--color-selection`.
  - Row tints: `failed` → `--color-danger` at low alpha, `sub-floor` → `--color-regime-sub-floor` at low alpha, unhealthy E2 level → `--color-warning` at low alpha.
  - Empty cells stay blank (never `0`).
- **`desk-log-style`:** Consolas 9 on `--color-surface-raised`; `err` → `--color-log-error`, `warn` → `--color-log-warn`, marker/plan lines → `--color-log-marker` (proposal).
- **`desk-suggestion-panel-style`:** a LabelFrame with a left accent bar (clam) or a `desk-icon-suggestion` glyph in its title (vista); verdict text `--color-text`; action buttons with `desk-icon-use-baseline` / `desk-icon-use-trimmed-grid`.
- **`desk-banner-placeholder`:** a full-width strip with `desk-icon-warning`, text in `--color-danger`, background `--color-warning` at low alpha (a `tk.Frame`/`tk.Label`, so it works under vista).
- **Variant markers** `desk-variant-*`: shape plus colour, never colour alone.
  - Standard: filled circle, `--color-variant-standard`
  - Anchoring: filled diamond, `--color-variant-anchoring`
  - Parallel: two vertical bars, `--color-variant-parallel`
  - Parallel-Anchored: two bars + diamond, `--color-variant-parallel-anchored`
  - `desk-variant-reference-line`: a short dashed horizontal line in `--color-text-muted`, used for E1 reference-line rows.
- **Regime markers** `desk-regime-*`: small pill-shaped PNGs with text, where the text *is* the label: `smoke` (`--color-regime-smoke`), `steady` (`--color-regime-steady`), `sub-floor` (`--color-regime-sub-floor`).

---

### 6.11 Consolidated desktop asset table

All icons are PNG-32 with alpha at 16/24/32 px (@1x/@1.5x/@2x) unless the row says otherwise. They are loaded through `tk.PhotoImage`, attached with `compound="left"` on ttk Buttons, Checkbuttons, Labels and Notebook tabs, and must work under the native **vista** theme. The stroke style must match the web icon set (see the web section) so both apps read as one family.

| ID | Category | Where used | Purpose | Variants / states | Size & format | Priority |
|---|---|---|---|---|---|---|
| desk-app-icon | App icon | Window title bar, taskbar, Alt-Tab, every dialog (`iconbitmap(default=…)`) | Replaces the Tk feather; identifies GLEIPNIR Bench as a sibling of the web app (derived from brand-app-icon) | Default; (proposal, P2) `busy` overlay variant swapped in during runs | Multi-resolution `.ico` (16, 20, 24, 32, 40, 48, 64, 96, 256) + PNG set 16–256 for `iconphoto`; must read at 16 px | P0 |
| desk-tab-settings | Tab icon (proposal) | Notebook tab `Settings & Baselines` | Wayfinding | selected / unselected (native) | 16/24/32 PNG | P2 |
| desk-tab-e0 | Tab icon (proposal) | `E0 initial test` | Step identity (smoke + ramp) | selected / unselected | 16/24/32 PNG | P2 |
| desk-tab-e1 | Tab icon (proposal) | `E1 batch size` | Step identity | selected / unselected | 16/24/32 PNG | P2 |
| desk-tab-e2 | Tab icon (proposal) | `E2 channels` | Step identity | selected / unselected | 16/24/32 PNG | P2 |
| desk-tab-e3 | Tab icon (proposal) | `E3 main` | Step identity | selected / unselected | 16/24/32 PNG | P2 |
| desk-tab-custom | Tab icon (proposal) | `Custom test` | Marks ad-hoc probe | selected / unselected | 16/24/32 PNG | P2 |
| desk-tab-history | Tab icon (proposal) | `History & results` | Wayfinding | selected / unselected | 16/24/32 PNG | P2 |
| desk-tab-per-round | Tab icon (proposal) | History inner tab `per-round results` | Table view | selected / unselected | 16/24/32 PNG | P2 |
| desk-tab-charts | Tab icon (proposal) | History inner tab `charts` | Chart view | selected / unselected | 16/24/32 PNG | P2 |
| desk-icon-preview | Button icon | `Preview plan` (all E-tabs + Custom test) | Dry-run, changes nothing: use a "look" metaphor, not "play" | normal / disabled | 16/24/32 PNG | P0 |
| desk-icon-run | Button icon | `Run…`, confirm-run `Start` | Start an experiment (destructive: resets ledger after backup) | normal / disabled | 16/24/32 PNG | P0 |
| desk-icon-resume | Button icon | `Resume…` | Continue skipping completed runs, distinct from Run | normal / disabled | 16/24/32 PNG | P0 |
| desk-icon-cancel | Button icon | Run panel `Cancel`, dialog `Cancel` | Stop / abort | normal / disabled | 16/24/32 PNG | P0 |
| desk-icon-force-stop | Button icon | Run panel after first cancel (`Force stop`) | Escalated SIGKILL: must look more severe than Cancel | normal / disabled | 16/24/32 PNG, `--color-danger` glyph | P0 |
| desk-icon-save | Button icon | `Save changes` (status bar) | Write inputs to sweeps.yaml | normal / disabled | 16/24/32 PNG | P1 |
| desk-icon-revert | Button icon | `Revert (reload file)` | Discard edits, reload file | normal / disabled | 16/24/32 PNG | P1 |
| desk-icon-backup | Button icon | `Back up now` | Copy all volumes to backups/ | normal / disabled | 16/24/32 PNG | P0 |
| desk-icon-restore | Button icon | `Restore my test data…`, restore-picker `Restore` | Bring the manual-test ledger back | normal / disabled | 16/24/32 PNG | P0 |
| desk-icon-export-csv | Button icon | `Export per-round CSV…` | Excel export | normal / disabled | 16/24/32 PNG | P1 |
| desk-icon-export-tables | Button icon | `Export summary tables…` | mean ± SD tables | normal / disabled | 16/24/32 PNG | P1 |
| desk-icon-generate-charts | Button icon | `Generate tables + charts` | Build charts into docs/results | normal / disabled | 16/24/32 PNG | P1 |
| desk-icon-open-folder | Button icon | `Open results folder` | Opens benchmark/results in Explorer | normal | 16/24/32 PNG | P1 |
| desk-icon-refresh | Button icon | History `Refresh` | Reload runlog | normal | 16/24/32 PNG | P1 |
| desk-icon-use-baseline | Button icon | `Use N tx/s as baseline…`, `Use N as baseline batch size…`, `Use N / max M as baselines…` | Accept a suggestion into sweeps.yaml | normal / disabled | 16/24/32 PNG | P0 |
| desk-icon-use-trimmed-grid | Button icon | `Use trimmed grid as send-rate grid…` | Accept the trimmed send-rate grid (not a baseline) | normal / disabled | 16/24/32 PNG | P1 |
| desk-icon-suggestion | Panel glyph (proposal) | Suggestion panel titles (E0/E1/E2) | Marks "the app suggests, you confirm" | — | 16/24/32 PNG | P2 |
| desk-icon-warning | Status glyph | Status bar uncommitted segment, E3 placeholder line, run warning line, reuse-ledger checkbox, confirm-run header | Replaces the text `⚠` / `!` with a consistent glyph | `--color-warning` / `--color-danger` tints | 16/24/32 PNG | P0 |
| desk-icon-log | Toggle icon (proposal) | `show raw log` checkbox | Log toggle affordance | on / off | 16/24/32 PNG | P2 |
| desk-icon-verbose | Toggle icon (proposal) | `verbose Caliper output` checkbox | Verbose toggle affordance | on / off | 16/24/32 PNG | P2 |
| desk-status-committed | Status icon | Status bar | sweeps.yaml committed (citable SHA) | — (`--color-success`) | 16/24/32 PNG | P0 |
| desk-status-uncommitted | Status icon | Status bar, confirm-run dialog | sweeps.yaml has uncommitted changes | — (`--color-danger`) | 16/24/32 PNG | P0 |
| desk-status-unsaved | Status icon | Status bar | N unsaved input changes | — (`--color-warning`) | 16/24/32 PNG | P1 |
| desk-status-saved | Status icon | Status bar | No unsaved changes | — (`--color-text-muted`) | 16/24/32 PNG | P2 |
| desk-status-invalid-input | Status icon | Status bar | A box does not parse as int/float/list | — (`--color-danger`) | 16/24/32 PNG | P1 |
| desk-status-ledger-test-data | Status icon | Status bar, restore picker rows | Ledger holds the authors' manual-test data | — (`--color-success`) | 16/24/32 PNG | P0 |
| desk-status-ledger-benchmark | Status icon | Status bar, restore picker rows, skip-backup option | Ledger holds benchmark data; test trails need Restore | — (`--color-warning`) | 16/24/32 PNG | P0 |
| desk-status-placeholder | Provenance badge | Settings baseline rows, confirm-run baselines | Baseline still `PLACEHOLDER until E0/E1/E2` | — (`--color-warning`) | 16/24/32 PNG | P0 |
| desk-status-set-from | Provenance badge | Settings baseline rows | Baseline `set from <exp> <date>` | — (`--color-success`) | 16/24/32 PNG | P1 |
| desk-status-set-by-hand | Provenance badge | Settings baseline rows | Baseline `set by hand <date>` | — (`--color-info`) | 16/24/32 PNG | P1 |
| desk-status-readonly | Field glyph (proposal) | Read-only "held fixed" boxes | Signals edit elsewhere | — | 12/18/24 PNG | P2 |
| desk-status-idle | Run state icon (proposal) | Run panel status | Idle | — | 16/24/32 PNG | P2 |
| desk-status-run-running | Run state icon | Run panel, History (proposal) | Experiment running | static PNG; (P2) 8-frame animated set cycled with `after()` | 16/24/32 PNG (+ frames) | P1 |
| desk-status-run-complete | Run state icon | History `status` = `complete`, Finished state | Run completed | — (`--color-success`) | 16/24/32 PNG | P0 |
| desk-status-run-failed | Run state icon | History `status` = `failed`, stopped/failed state | Run failed or cancelled | — (`--color-danger`) | 16/24/32 PNG | P0 |
| desk-status-cancelling | Run state icon (proposal) | Run panel while cancelling | SIGINT sent, waiting | — (`--color-warning`) | 16/24/32 PNG | P1 |
| desk-status-backup-running | Run state icon (proposal) | Run panel during backup | Stack stopped, copying volumes | — | 16/24/32 PNG | P1 |
| desk-status-restore-running | Run state icon (proposal) | Run panel during restore | Volumes being replaced; do not close | — | 16/24/32 PNG | P1 |
| desk-status-stack-restarting | Run state icon (proposal) | Run panel during stack-up | Stack coming back up | — | 16/24/32 PNG | P1 |
| desk-status-keep-awake | Run state icon (proposal) | Run panel while an experiment runs | Laptop kept awake | on | 16/24/32 PNG | P2 |
| desk-regime-smoke | Regime marker | History `regime`, round line, E0 step radio (proposal) | Label `smoke`: functional only, never results | — (`--color-regime-smoke`) | pill PNG 16/24/32 px high, width to fit text | P0 |
| desk-regime-steady | Regime marker | History `regime`, round line | Label `steady`: the only reportable regime | — (`--color-regime-steady`) | pill PNG 16/24/32 px high | P0 |
| desk-regime-sub-floor | Regime marker | History `regime`, round line, ramp radio (proposal) | Label `sub-floor`: below the steady floor | — (`--color-regime-sub-floor`) | pill PNG 16/24/32 px high | P0 |
| desk-mark-yes | Table mark | E1 `qualifies`, E2 `healthy` | Replaces the text `yes` | — (`--color-success`) | 12/18/24 PNG | P1 |
| desk-mark-no | Table mark | E2 `healthy` (unhealthy level) | Replaces blank | — (`--color-danger`) | 12/18/24 PNG | P1 |
| desk-variant-standard | Variant marker | Variant checkboxes, live/History rows (proposal) | Standard (circle) | selected / unselected | 12/18/24 PNG | P0 |
| desk-variant-anchoring | Variant marker | same | Anchoring (diamond) | selected / unselected | 12/18/24 PNG | P0 |
| desk-variant-parallel | Variant marker | same | Parallel (two bars) | selected / unselected | 12/18/24 PNG | P0 |
| desk-variant-parallel-anchored | Variant marker | same | Parallel-Anchored (bars + diamond) | selected / unselected | 12/18/24 PNG | P0 |
| desk-variant-reference-line | Variant marker | E1 `Standard (reference line)` / `Parallel (reference line)` | Reference line, not a swept series | — | 12/18/24 PNG | P1 |
| desk-badge-probe | Badge (proposal) | Custom test header, History rows with exp `cell` | "probe, not an E1–E3 datapoint" | — | pill PNG 16/24/32 px high | P2 |
| desk-step-indicator | Header element (proposal) | E0–E3 tab headers | Shows E0 → E1 → E2 → E3 progress from baseline tags | per step: pending / done / current | Canvas spec + 12/18/24 PNG dots | P1 |
| desk-help-icon | Help icon | Every tab header, field row, Custom test factor | Hover help trigger (circled black "?") | normal / hover | Canvas spec + 16/24/32 PNG; transparent background | P0 |
| desk-tooltip-style | Style spec | All `Tip` tooltips and heading tips | Consistent hover help | — | spec (tokens, padding, font, max width, delay) | P0 |
| desk-progress-style | Style spec | Run panel overall + round bars | Readable progress; indeterminate for non-run steps | determinate / indeterminate; vista (native) / clam skin | spec + labels `overall` / `this round (Caliper)` | P1 |
| desk-table-style | Style spec | Live table, History runs + per-round, suggestion tables | Zebra, alignment, row tints, empty cells | normal / selected / failed / sub-floor / unhealthy | spec (row height 22 px @1x, tokens) | P1 |
| desk-log-style | Style spec | Raw log, plan text, confirm-run text | Monospace log with severity colours | err / warn / marker / normal | spec (Consolas 9, tokens) | P1 |
| desk-suggestion-panel-style | Style spec | E0/E1/E2 suggestion panels | "Suggested, you confirm" framing; unit-complete headers | empty (`no results yet`) / filled | spec | P1 |
| desk-banner-placeholder | Banner spec | E3 main placeholder line | Blocks-in-spirit warning until baselines are set | shown / hidden | spec (tk.Frame + desk-icon-warning) | P1 |
| desk-dialog-confirm-run | Dialog spec | `Run <exp>?` | Plan + wipe + backup + baselines + skip-backup in a clear hierarchy | normal / reuse-ledger / skip-backup available / uncommitted warning | spec at 1040 × 520 px @1x | P1 |
| desk-dialog-restore-picker | Dialog spec | `Restore my test data` | Treeview picker with origin icons and UTC timestamps | test-data row / benchmark row / preselected | spec at 900 × 360 px @1x | P1 |
| desk-dialog-plan-preview | Dialog spec | `Plan preview (nothing was run)` | Read-only plan with Close + Run… | — | spec | P2 |
| desk-empty-no-results | Empty-state art | Suggestion tables (`no results yet`), History per-round (`no results for this attempt…`) | Friendly empty state | — | 96/144/192 PNG, monochrome `--color-text-subtle` | P2 |
| desk-empty-no-chart | Empty-state art | History `charts` tab before generation | Explains "Generate tables + charts" | — | 96/144/192 PNG | P2 |
| desk-empty-no-backups | Empty-state art | Restore picker (if redesigned) | No complete backup yet | — | 96/144/192 PNG | P2 |
| viz-bench-chart-theme | Chart theme | `report.py` charts shown in History `charts` tab and written to docs/results | Variant colours from `--color-variant-*`, exact variant names in legends, dashed reference lines, dotted y = x and saturation lines, units on axes | light only (PNG for the paper) | matplotlib rcParams/style spec; output PNG 832 × 546 px at 130 dpi | P1 |

**Copy changes needed alongside the assets (proposals):**
1. Show the exact variant names in the E0/E3/Custom checkboxes and in chart legends.
2. Timestamps in History and the restore picker as `YYYY-MM-DD HH:mm:ss UTC`.
3. Unit-complete E1/E2 suggestion headers (and split the duplicate `Δ to next (%)`).
4. Label the two progress bars.
5. Add tooltips to `Refresh`, `Use … as baseline…`, `Use trimmed grid…`, `verbose Caliper output`, `show raw log` and the variant checkboxes.
6. Keep "baseline" wording and drop the parenthetical terminology reminder from the Baselines frame title.

### Checklist
- [ ] desk-app-icon — multi-resolution .ico + PNG set replacing the Tk feather
- [ ] desk-tab-settings — tab icon, Settings & Baselines (proposal)
- [ ] desk-tab-e0 — tab icon, E0 initial test (proposal)
- [ ] desk-tab-e1 — tab icon, E1 batch size (proposal)
- [ ] desk-tab-e2 — tab icon, E2 channels (proposal)
- [ ] desk-tab-e3 — tab icon, E3 main (proposal)
- [ ] desk-tab-custom — tab icon, Custom test (proposal)
- [ ] desk-tab-history — tab icon, History & results (proposal)
- [ ] desk-tab-per-round — inner tab icon, per-round results (proposal)
- [ ] desk-tab-charts — inner tab icon, charts (proposal)
- [ ] desk-icon-preview — Preview plan (dry-run) button icon
- [ ] desk-icon-run — Run… / Start button icon
- [ ] desk-icon-resume — Resume… button icon
- [ ] desk-icon-cancel — Cancel button icon
- [ ] desk-icon-force-stop — Force stop (SIGKILL) button icon
- [ ] desk-icon-save — Save changes button icon
- [ ] desk-icon-revert — Revert (reload file) button icon
- [ ] desk-icon-backup — Back up now button icon
- [ ] desk-icon-restore — Restore my test data… button icon
- [ ] desk-icon-export-csv — Export per-round CSV… button icon
- [ ] desk-icon-export-tables — Export summary tables… button icon
- [ ] desk-icon-generate-charts — Generate tables + charts button icon
- [ ] desk-icon-open-folder — Open results folder button icon
- [ ] desk-icon-refresh — History Refresh button icon
- [ ] desk-icon-use-baseline — Use … as baseline… button icon
- [ ] desk-icon-use-trimmed-grid — Use trimmed grid as send-rate grid… button icon
- [ ] desk-icon-suggestion — suggestion panel title glyph (proposal)
- [ ] desk-icon-warning — warning glyph replacing ⚠ and !
- [ ] desk-icon-log — show raw log toggle icon (proposal)
- [ ] desk-icon-verbose — verbose Caliper output toggle icon (proposal)
- [ ] desk-status-committed — sweeps.yaml committed
- [ ] desk-status-uncommitted — sweeps.yaml has uncommitted changes
- [ ] desk-status-unsaved — N unsaved input changes
- [ ] desk-status-saved — no unsaved changes
- [ ] desk-status-invalid-input — an input does not parse
- [ ] desk-status-ledger-test-data — ledger holds manual-test data
- [ ] desk-status-ledger-benchmark — ledger holds benchmark data
- [ ] desk-status-placeholder — baseline still PLACEHOLDER
- [ ] desk-status-set-from — baseline set from an experiment
- [ ] desk-status-set-by-hand — baseline set by hand
- [ ] desk-status-readonly — read-only "held fixed" value glyph (proposal)
- [ ] desk-status-idle — Run panel idle (proposal)
- [ ] desk-status-run-running — experiment running (static + optional animation frames)
- [ ] desk-status-run-complete — run complete
- [ ] desk-status-run-failed — run failed or cancelled
- [ ] desk-status-cancelling — SIGINT sent, waiting (proposal)
- [ ] desk-status-backup-running — backup in progress (proposal)
- [ ] desk-status-restore-running — restore in progress (proposal)
- [ ] desk-status-stack-restarting — stack coming back up (proposal)
- [ ] desk-status-keep-awake — laptop kept awake during a run (proposal)
- [ ] desk-regime-smoke — smoke regime pill
- [ ] desk-regime-steady — steady regime pill
- [ ] desk-regime-sub-floor — sub-floor regime pill
- [ ] desk-mark-yes — qualifies / healthy mark
- [ ] desk-mark-no — unhealthy mark
- [ ] desk-variant-standard — Standard marker (circle)
- [ ] desk-variant-anchoring — Anchoring marker (diamond)
- [ ] desk-variant-parallel — Parallel marker (two bars)
- [ ] desk-variant-parallel-anchored — Parallel-Anchored marker (bars + diamond)
- [ ] desk-variant-reference-line — E1 reference-line marker
- [ ] desk-badge-probe — Custom test "probe" badge (proposal)
- [ ] desk-step-indicator — E0 → E1 → E2 → E3 progress indicator (proposal)
- [ ] desk-help-icon — circled "?" hover-help icon (Canvas spec + PNG)
- [ ] desk-tooltip-style — tooltip style spec
- [ ] desk-progress-style — progress bar style spec (vista / clam skin)
- [ ] desk-table-style — Treeview zebra / alignment / row-tint spec
- [ ] desk-log-style — raw log / plan text style spec
- [ ] desk-suggestion-panel-style — suggestion panel framing spec
- [ ] desk-banner-placeholder — E3 placeholder-baselines banner spec
- [ ] desk-dialog-confirm-run — confirm run dialog spec
- [ ] desk-dialog-restore-picker — restore picker dialog spec
- [ ] desk-dialog-plan-preview — plan preview dialog spec
- [ ] desk-empty-no-results — no results empty-state art
- [ ] desk-empty-no-chart — no charts empty-state art
- [ ] desk-empty-no-backups — no backups empty-state art
- [ ] viz-bench-chart-theme — matplotlib chart theme for History charts and docs/results PNGs

---

## 7. Data visualisation (tables & charts for the thesis)

This section covers how the benchmark results look in three places: the desktop app (History & results tab), the files `report.py` writes (Markdown, CSV and PNG), and the finished thesis and paper figures and tables. `orchestration/report.py` is the **only** code that draws charts and aggregates tables. The desktop app calls `REP.build(...)` and shows what that writes, so every chart rule below is a rule for `report.py`'s `charts()` function. Anything the code does not do yet is marked **(proposal)**.

### 7.1 Sources of truth and what exists today

| Item | Current behaviour (code) | Location |
|---|---|---|
| Experiments with aggregated tables and charts | `EXPS = ["e1", "e2", "e3a", "e3b", "ops"]`. `ops` gets **tables only, no charts**. | `report.py` |
| Experiments with only the per-round CSV | `e0`, `ramp`, `cell`. The app says "CSV only". | `report.py`, `benchapp.pyw` |
| Chart files | One PNG per metric: `docs/results/<exp>/<exp>-<metricKey>.png` | `charts()` |
| Current figure setup | `figsize=(6.4, 4.2)`, `dpi=130`, PNG only, default matplotlib colour cycle, `marker="o"` for **every** variant, `capsize=3`, `grid(True, alpha=0.3)`, `legend(fontsize=8)`, title `"<exp>: <header>"` | `charts()` |
| Series | One line per variant, in `VARIANT_ORDER` = standard, anchoring, parallel, parallel-anchored. Legend labels are the lowercase slugs. | `charts()` |
| Error bars | SD over repetitions (`statistics.stdev`, n − 1). The code sets SD = 0.0 when n < 2. | `aggregate()` |
| E1 reference | `axhline(..., linestyle="--", linewidth=1)` in the next colour from the cycle, labelled `"<slug> (reference)"` | `charts()` |
| E3a overlays | Throughput chart only: `y = x (send rate)` as a grey dotted line, plus one dotted `axvline` per variant at the saturation send rate (lw 0.8, colour from the cycle) | `charts()` |
| Tables | `<name>.csv` (means, then an `SD` column for each metric) and `<name>.md` (one `## <variant>` section per variant, with latency as one column: `avg (min–max), p95`) | `write_tables()` |
| Per-round export | `benchmark/results/<exp>/<exp>-results.csv`, one row per (run, round). UTF-8 with BOM. Optional `;` separator with decimal comma. | `export_rounds()` |

**Two P0 defects the design must fix. Both are part of `viz-variant-encoding`.**
1. Colours come from the default cycle, so a variant's colour depends on which variants are present. In E1 the first series is Anchoring, which takes the colour Standard gets in E3a. Style each variant explicitly by name and never rely on the cycle.
2. Legends and Markdown headings print slugs (`parallel-anchored`). They must print the exact display names **Standard, Anchoring, Parallel, Parallel-Anchored**. The CSV keeps the slugs, because there they are machine keys (see 7.10).

### 7.2 Chart inventory

`CHART_METRICS` are the 15 entries of `METRICS` minus send rate, latency min, latency max, success and failure. That leaves **10 charts per experiment**, in this order:

| # | Metric key | Y-axis label (with unit) | Decimals | Variants that have data | Caption note (mandatory) |
|---|---|---|---|---|---|
| 1 | `throughputTps` | throughput (TPS) | 1 | all present | Successful transactions only. For Parallel variants, the aggregate over all channels (per-channel figures are in the CSV). |
| 2 | `latencyAvgS` | latency avg (s) | 3 | all | Caliper submit-to-commit. For Anchoring and Parallel-Anchored the write latency is **enqueue latency**, and the caption must say so. |
| 3 | `latencyP95S` | latency p95 (s) | 3 | all | Mean of the per-round p95 from the per-transaction logs. Same enqueue note as row 2. |
| 4 | `cpuPct` | CPU (%, sum of container averages) | 1 | all | Summed over the `all` container group. |
| 5 | `memMb` | memory (MB, sum of container averages) | 0 | all | Same as row 4. |
| 6 | `failureRatePct` | failure rate (%) | 2 | all | failure ÷ (success + failure) |
| 7 | `onChainBytesPerEvent` | on-chain storage (B/event) | 1 | all | OLS slope over checkpoints t0..tN. The denominator is every ledger write event, including the untimed seeding. Any storage reduction is in log-payload bytes vs Standard, never 1/N of total ledger size. |
| 8 | `offChainBytesPerEvent` | off-chain storage (B/event) | 1 | Anchoring, Parallel-Anchored | Receipt store only. The other variants are "n/a" (they are not drawn). |
| 9 | `auditSPerCase` | audit time per case (s) | 3 | all | Fetch every evidence trail of a case, verify every event's Merkle branch, read each distinct root once. |
| 10 | `anchoringDelayS` | anchoring delay (s) | 3 | Anchoring, Parallel-Anchored | Event enqueue → root committed (mean). Forced batches are reported separately and are not in this chart. |

The current code labels rows 4, 5, 7 and 8 as `CPU (%, sum of container avgs)`, `memory (MB, sum of container avgs)`, `on-chain bytes/event (B)` and `off-chain bytes/event (B)`. Unifying those labels with the app's `on-chain (B/event)` column is a **(proposal)**. Pick one wording and use it in app columns, tables and charts alike.

| Experiment | X axis (label) | X values (from `sweeps.yaml`) | Series | Overlays |
|---|---|---|---|---|
| E1 | batch size (events) | 10, 25, 50, 100, 200 | Anchoring, Parallel-Anchored | Standard (reference) and Parallel (reference) as horizontal lines (`viz-refline-e1`) |
| E2 | channels (n) | 5, 10, 20, 30, 40, 50 | Parallel only | Healthy range, baseline and CPU budget **(proposal)** |
| E3a | send rate (tx/s) | 10, 25, 50, 75, 100, 150, 200 (one point per round) | all four | y = x, saturation markers, y = 0.9 x and latency knee **(proposal)** |
| E3b | cases (n) | 5 … 50, trimmed to ≤ `baseline.channels_max` | all four | none |
| ops | operation type | write: create, transfer, access, dispose. read: read-evidence, read-trail, verify-event | all four | Tables only. Bar charts are a **(proposal)**, P2. |

Rule from the supervisor guidance (§3.7/§5.2): **one metric per chart, one line per variant.** Never plot two metrics on one axes and never use a twin y-axis. A multi-panel figure is allowed only when every panel still holds a single metric (`viz-fig-panel-pair`).

### 7.3 Variant encoding (`viz-variant-encoding`, P0)

Each variant is told apart by **colour, marker shape, marker fill and line style together**, so every chart still reads when printed in grayscale. Hollow markers always mean an anchored variant. On latency charts that doubles as the reminder that those values are enqueue latency.

| Variant (display name) | Slug (CSV and code) | Colour token | Marker | Marker fill | Line style (matplotlib dash tuple) |
|---|---|---|---|---|---|
| Standard | `standard` | `--color-variant-standard` | `o` circle | filled | solid `"-"` |
| Anchoring | `anchoring` | `--color-variant-anchoring` | `s` square | hollow (face `--color-chart-surface`) | dashed `(0, (5, 2))` |
| Parallel | `parallel` | `--color-variant-parallel` | `^` triangle up | filled | dash-dot `(0, (5, 1.5, 1.2, 1.5))` |
| Parallel-Anchored | `parallel-anchored` | `--color-variant-parallel-anchored` | `D` diamond (drawn at 0.9 × marker size) | hollow | dash-dot-dot `(0, (5, 1.5, 1.2, 1.5, 1.2, 1.5))` |

Other rules:
- **The dotted pattern `(0, (1, 1.5))` is reserved for annotation lines** (y = x, saturation, thresholds). No variant series may use it.
- Constraints on the colour tokens, which the foundations section binds: they must be a colour-blind-safe qualitative set (Okabe–Ito family or equivalent) and must pass deuteranopia, protanopia and tritanopia simulation. Their hues must stay clearly apart from the status tokens (`--color-success`, `--color-danger`, `--color-warning`) so a variant line is never read as a status. The same four tokens are used in the web app's variant badges and the desktop app, so a variant has one colour across every UI.
- Chart-only tokens this section uses: `--color-chart-ink` (axes, ticks, text), `--color-chart-grid`, `--color-chart-reference` (neutral grey for y = x and thresholds) and `--color-chart-surface` (plot background, always white). **(proposal: add these to the foundations section if they are not already there.)**
- Legend order is fixed: Standard, Anchoring, Parallel, Parallel-Anchored, then reference lines, then annotation entries. A legend shows only what is actually drawn on that chart.

### 7.4 Matplotlib style spec

#### 7.4.1 Base rcParams (`viz-style-base`, P0)

Apply the base params once with `plt.rcParams.update(GLEIPNIR_RC)` or as a `gleipnir.mplstyle` file, then layer a size preset (7.4.2) on top. Colour values are filled in from the foundations tokens when the style is built, and hex never appears in this spec.

```python
from cycler import cycler

GLEIPNIR_RC = {
    # type: serif to match the thesis/paper body text
    "font.family": "serif",
    "font.serif": ["Times New Roman", "Nimbus Roman", "STIXGeneral", "DejaVu Serif"],
    "mathtext.fontset": "stix",
    # sizes are overridden by the size preset (7.4.2)
    "font.size": 9, "axes.labelsize": 9, "axes.titlesize": 9,
    "xtick.labelsize": 8, "ytick.labelsize": 8, "legend.fontsize": 8,
    # ink
    "text.color": TOK["--color-chart-ink"], "axes.labelcolor": TOK["--color-chart-ink"],
    "axes.edgecolor": TOK["--color-chart-ink"],
    "xtick.color": TOK["--color-chart-ink"], "ytick.color": TOK["--color-chart-ink"],
    "figure.facecolor": TOK["--color-chart-surface"], "axes.facecolor": TOK["--color-chart-surface"],
    "savefig.facecolor": TOK["--color-chart-surface"],
    # frame
    "axes.linewidth": 0.8, "axes.spines.top": False, "axes.spines.right": False,
    "xtick.direction": "out", "ytick.direction": "out",
    "xtick.major.size": 3, "ytick.major.size": 3, "xtick.major.width": 0.8, "ytick.major.width": 0.8,
    "xtick.minor.visible": False, "ytick.minor.visible": False,
    # grid: y only, hairline, behind data
    "axes.grid": True, "axes.grid.axis": "y", "axes.axisbelow": True,
    "grid.color": TOK["--color-chart-grid"], "grid.linewidth": 0.4, "grid.linestyle": "-",
    # data marks (per-variant overrides in VARIANT_STYLE)
    "lines.linewidth": 1.4, "lines.markersize": 4.5, "lines.markeredgewidth": 0.9,
    "errorbar.capsize": 2.5,
    # legend: frameless, long handles so dash patterns are visible
    "legend.frameon": False, "legend.handlelength": 2.8, "legend.columnspacing": 1.2,
    "legend.borderaxespad": 0.3, "legend.handletextpad": 0.5,
    # numbers
    "axes.formatter.use_mathtext": True, "axes.formatter.limits": (-3, 5),
    "axes.xmargin": 0.04, "axes.ymargin": 0.05,
    # export (7.4.3)
    "savefig.dpi": 300, "savefig.bbox": "tight", "savefig.pad_inches": 0.02,
    "pdf.fonttype": 42, "ps.fonttype": 42,      # TrueType embedding; Type 3 fonts are rejected by paper checkers
    "svg.fonttype": "none",                     # text stays text in SVG
    "svg.hashsalt": "gleipnir",                 # deterministic SVG ids (diff-able, citable by git SHA)
    # safety net only: series are styled explicitly by variant, never by cycle position
    "axes.prop_cycle": cycler(color=[TOK["--color-chart-ink"]]),
}

VARIANT_STYLE = {   # the single source for colour/marker/line per variant (7.3)
    "standard":          dict(label="Standard",          color=TOK["--color-variant-standard"],
                              marker="o", mfc="full",   ls="-"),
    "anchoring":         dict(label="Anchoring",         color=TOK["--color-variant-anchoring"],
                              marker="s", mfc="hollow", ls=(0, (5, 2))),
    "parallel":          dict(label="Parallel",          color=TOK["--color-variant-parallel"],
                              marker="^", mfc="full",   ls=(0, (5, 1.5, 1.2, 1.5))),
    "parallel-anchored": dict(label="Parallel-Anchored", color=TOK["--color-variant-parallel-anchored"],
                              marker="D", mfc="hollow", ls=(0, (5, 1.5, 1.2, 1.5, 1.2, 1.5)), ms_scale=0.9),
}
```

Z-order for every chart:

| Layer | zorder |
|---|---|
| Grid | 0 |
| Shaded bands | 1 |
| Reference and annotation lines | 2 |
| Error bars | 3 |
| Series lines | 4 |
| Markers | 5 |
| Saturation rings | 6 |

#### 7.4.2 Size presets (`viz-style-thesis`, `viz-style-paper`, `viz-style-screen`)

| Preset | Use | figsize (in) | Base / label / tick / legend (pt) | Series lw | Marker size | Legend columns | Title in figure |
|---|---|---|---|---|---|---|---|
| `thesis-full` | Thesis figure spanning the A4 text block (~140 mm with BINUS margins; confirm against the template) | 5.5 × 3.4 | 10 / 10 / 9 / 9 | 1.5 | 5 | 4 | no (the caption carries it) |
| `thesis-half` | Two subfigures side by side, (a) and (b) | 2.7 × 2.2 | 8 / 8 / 7 / 7 | 1.2 | 4 | 2 | no; subfigure letter only |
| `paper-column` | Two-column conference paper (IEEE-style, venue TBC), one column 88.9 mm | 3.5 × 2.4 | 8 / 8 / 7 / 7 | 1.2 | 4 | 2 | no |
| `paper-full` | Figure spanning both columns (`figure*`), e.g. `viz-fig-panel-pair` | 7.16 × 2.6 | 8 / 8 / 7 / 7 | 1.2 | 4 | 4 (shared) | no |
| `screen` | Desktop app charts tab (current size) | 6.4 × 4.2 at **130 dpi** = 832 × 546 px | 10 / 10 / 9 / 8, **sans-serif** (`Segoe UI`, `DejaVu Sans`) | 1.5 | 5 | 4 | yes: `E3a · throughput (TPS) vs send rate (tx/s)` |

Font sizes are **final printed sizes**. Never draw at one size and scale the image in Word or LaTeX. Export at the preset size and insert at 100 %.

#### 7.4.3 Export (`viz-export-files`, P0)

- Formats: `screen` → PNG at 130 dpi, for the app only. `thesis-*` and `paper-*` → **PDF** (vector, primary for LaTeX), **SVG** (vector, for Word and editing) and **PNG at 300 dpi** (fallback for Word). DPI 300 is the minimum for any raster that goes into the paper or thesis.
- File names keep the current stem and add the preset **(proposal)**: `docs/results/<exp>/<exp>-<metricKey>.png` (screen, unchanged), `docs/results/<exp>/print/<exp>-<metricKey>-<preset>.{pdf,svg,png}`.
- Deterministic output **(proposal)**: `savefig(..., metadata={"Creator": "GLEIPNIR report.py", "CreationDate": None})` for PDF and `svg.hashsalt` fixed, so re-rendering unchanged data gives byte-identical files and a figure can be cited by commit SHA.
- Fonts are embedded (TrueType 42). Never outline text in PDFs, and never rasterise vector figures.

#### 7.4.4 Grayscale and colour-blind safety (P0 acceptance test)

Every figure must pass all four checks before it goes into the thesis:
1. Rendered in grayscale (`convert -colorspace Gray` or a print preview), each variant can still be told apart by **marker shape, marker fill and line style alone**.
2. Deuteranopia, protanopia and tritanopia simulations: no two variant lines become indistinguishable where they come close.
3. No meaning is carried by colour alone. Reference lines get inline text labels (7.6.2) and saturation lines are explained in the legend and caption.
4. Line handles in the legend are ≥ 2.8 em, so dash patterns are visible at 7 pt.

### 7.5 Axis conventions

- **Label format:** `quantity (unit)`, lowercase except acronyms (CPU, TPS, OLS), exactly as in `METRICS` and `X_LABEL`. Examples: `send rate (tx/s)`, `throughput (TPS)`, `latency p95 (s)`, `batch size (events)`, `channels (n)`, `cases (n)`. Every axis carries a unit, and counts use `(n)`.
- **Terminology:** the configured input is always "send rate (tx/s)" and the measured output is always "throughput (TPS)". "TPS" and "tx/s" appear only inside the unit parentheses.
- **One unit per metric, everywhere.** Latency is always seconds with 3 decimals, never ms on one chart and s on another. Storage is always B/event.
- **X ticks** sit exactly on the grid levels that were run (`FixedLocator`), with plain integer labels and no minor ticks.
  - E1 uses a **log x axis** **(proposal; current code is linear)**, because 10…200 bunches the small levels. Labels still read `10 25 50 100 200` via `ScalarFormatter`, and the axis label becomes `batch size (events, log scale)`.
  - E2, E3a and E3b stay linear.
- **Y ranges:** every metric here is a ratio-scale quantity, so the y axis starts at **0**. Exceptions:
  - `failure rate (%)` runs from 0 to `max(1.0, 1.1 × max value)`, so an all-zero series does not sit on the top edge.
  - Latency may switch to a log y axis only if a chart spans more than 2 decades, and the label then says `(s, log scale)` **(proposal)**.
- **Y tick density:** `MaxNLocator(nbins=5, steps=[1, 2, 2.5, 5, 10])`. Tick decimals follow the `METRICS` decimals, or fewer. Thousands are separated with a thin space in thesis figures (`12 400`) **(proposal)**. No scientific notation below 10⁵.
- **E3a throughput chart:** both axes start at 0 and end at the same maximum (the top send rate), so the y = x line runs at 45°. The aspect ratio is not locked.
- **Language:** labels are English, matching the code. A Bahasa Indonesia and decimal-comma variant of the figures is **(proposal, P2)**: the CSV already has `--decimal-comma`, and the figures would need `axes.formatter.use_locale` plus translated labels.

### 7.6 Error bars, reference lines, saturation markers and other overlays

#### 7.6.1 Error bars (`viz-errorbar-sd`, P0)

- Error bars show **±1 SD** (sample SD, n − 1) over the repetitions of that cell, normally r = 3. They are never standard error or confidence intervals unless changed with the supervisor.
- E3a points are per round: the SD is across the 3 repetitions at that send rate.
- Drawing: vertical only, same colour as the series, `elinewidth 0.8`, `capsize 2.5`, `capthick 0.8`, drawn under the markers.
- **When n < 2, draw no bar.** Today the code passes SD = 0.0, which draws a flat cap. **(proposal)** Pass `None` instead, and add "n = 1 (no SD)" to the caption.
- Caption wording: "Error bars: ±1 SD over r = 3 repetitions."
- **Dodge (`viz-dodge-offset`, proposal, P1):** when two or more series share an x value, shift each variant horizontally by a fixed **point** offset (Standard −4.5 pt, Anchoring −1.5 pt, Parallel +1.5 pt, Parallel-Anchored +4.5 pt) with `matplotlib.transforms.ScaledTranslation`. This works the same on linear and log axes. It is drawing-only and the data values do not change. The caption says "points offset horizontally for legibility".

#### 7.6.2 E1 reference lines (`viz-refline-e1`, P0)

- Standard and Parallel are run at the same point with no batch size (`levels.reference: true`). Each is drawn as a **horizontal line across the full x range** at its mean.
- Styling: the variant's own colour token and line style, **no markers**, lw 1.0, zorder 2.
- The line is labelled **inline** at its right end, inside the axes: `Standard (reference)` or `Parallel (reference)`, 7–8 pt, in the variant colour with a 2 px `--color-chart-surface` halo (`patheffects.withStroke`). It also gets a legend entry.
- Variant: a ±1 SD band around the reference mean, `fill_between` in the variant colour at alpha 0.12 **(proposal, P2)**.
- This replaces today's rendering, which draws every reference dashed in whatever colour the cycle gives next, so Standard and Parallel references can only be told apart by legend order.

#### 7.6.3 E3a identity line and threshold (`viz-refline-identity` P0, `viz-refline-threshold` P1 proposal)

- **y = x:** from 0 to the top send rate, `--color-chart-reference`, dotted `(0, (1, 1.5))`, lw 0.9. Legend: `y = x (throughput = send rate)`. It appears on the **throughput chart only**.
- **y = 0.9 x (proposal):** the saturation rule made visible. `--color-chart-reference`, sparse dots `(0, (1, 3))`, lw 0.7. Legend: `y = 0.9 × send rate (saturation threshold)`.

#### 7.6.4 Saturation markers (`viz-marker-saturation`, P0)

- **Rule (from the code, do not restate it differently):** per variant, saturation is the first send rate at which mean successful throughput < 0.9 × the configured send rate.
- **Drawing:** a vertical dotted line `(0, (1, 1.5))`, lw 0.8, in the **variant colour**, alpha 0.8, at x = the saturation send rate. When two variants saturate at the same rate, the lines take the dodge offsets from 7.6.1 so both stay visible.
- **(proposal)** Add a hollow ring (`marker="o"`, ms 9, `mfc="none"`, variant colour, zorder 6) around that variant's saturation data point.
- No on-plot text. One legend entry: dotted line glyph in `--color-chart-ink`, labelled `saturation (throughput < 0.9 × send rate)`. The caption names each variant's saturation send rate (from `e3a-saturation.json`), or states "no saturation within the grid".
- Appears on: the throughput chart (current), plus **(proposal)** the latency p95 chart, so the latency knee can be read against it.

#### 7.6.5 Latency knee (`viz-marker-latency-knee`, proposal, P1)

- Knee = the first send rate at which p95 ≥ 2 × the p95 at the lowest send rate (`saturation_flags`). Today it exists only as the `latency-knee` table flag.
- Drawing: a downward caret `v` (ms 6) in the variant colour, placed 6 pt above that variant's p95 point on the **latency p95 chart**. Legend: `latency knee (p95 ≥ 2 × p95 at lowest send rate)`.

#### 7.6.6 E2 healthy range, baseline and CPU budget (`viz-band-e2-healthy`, `viz-refline-cpu-budget`, proposal, P1)

- **Healthy band:** `axvspan` from the lowest healthy level to `channels_max`, `--color-success` at alpha 0.08, drawn behind everything, with legend entry `healthy range (§4.2)`. It appears on the throughput, failure rate and CPU charts.
- **Baseline marker:** a vertical solid line, lw 0.8, `--color-chart-ink`, at `baseline.channels`, labelled inline at the top `baseline (median of healthy range)`. The word is always "baseline". The top of the range is labelled `channels_max`.
- **CPU budget (CPU chart only):** a horizontal line at 0.9 × cores × 100 %, `--color-warning`, dash `(0, (4, 2))`, labelled inline `CPU budget (0.9 × cores × 100 %)`. `cores` comes from `run.json`, and the caption states the core count.

#### 7.6.7 E1 baseline and audit bound (`viz-marker-e1-baseline`, proposal, P2)

- A vertical line at the suggested `baseline.batch_size`, drawn only after the authors confirm it, labelled `baseline batch size`.
- On the audit chart, a horizontal dashed line at 1.5 × the audit time at the smallest level, labelled `audit bound (1.5 × smallest level)`.

#### 7.6.8 Regime watermark (`viz-watermark-regime`, proposal, P1)

- Paper and thesis figures use **steady** data only. If a chart is ever rendered from `sub-floor` data (e.g. an ad-hoc cell), or from anything under `results/e0/` (`smoke`), it carries a diagonal watermark `SUB-FLOOR — not a benchmark result` or `SMOKE — functional check only`: `--color-text-muted`, alpha 0.15, 24 pt.
- The same label goes into the screen caption strip.

### 7.7 Captions and footers

**Figure caption (`viz-caption-figure`, P0).** The caption goes below the figure and is the only title in print:

> Figure N. {metric, with unit} versus {x quantity} for {variants}, E{x}, steady regime; mean ± SD over r = 3 repetitions (error bars: ±1 SD). {Experiment note} {Metric note from 7.2}

Experiment notes:

| Experiment | Note |
|---|---|
| E1 | "Horizontal lines: Standard and Parallel reference runs at the same send rate (no batching)." |
| E2 | "Parallel only; Parallel-Anchored inherits the channel count; Standard and Anchoring are single-channel." |
| E3a | "Dotted grey line: y = x. Dotted vertical lines: saturation send rate per variant (throughput < 0.9 × send rate): Standard {x} tx/s, …" |
| E3b | "Parallel variants route one case per channel, so the case count is the channel count." |

**Table caption (`viz-caption-table`, P0).** The caption goes above the table. The table note goes below it and repeats the `report.py` preamble: "mean ± SD over repetitions; throughput is successful-only; latency avg/min/max are Caliper's, p95 from per-transaction logs (mean of per-round p95)." Add "one row per round; storage, audit time and anchoring delay are measured once per run and repeat on every row of a run" for E3a and ops.

**Provenance footer (`viz-footer-provenance`, proposal, P1).** Screen PNGs only, never print figures. One line at the bottom-left, 7 pt, `--color-text-muted`:

`GLEIPNIR · e3a · steady · n = 3 reps · git 7dc7f49 · generated 2026-09-25 14:03:11 UTC`

### 7.8 Tables for the thesis and paper (`viz-table-booktabs`, P0)

**Structure**
- Booktabs style: exactly three horizontal rules (`\toprule`, `\midrule` under the header, `\bottomrule`), plus `\cmidrule` or `\midrule` between variant groups. **No vertical rules, no cell shading, no zebra striping.**
  - Word equivalent: top border 1.5 pt, header-bottom border 0.75 pt, bottom border 1.5 pt, no other borders.
- Layout, following the supervisor's table and `write_tables`: X levels run down the rows, grouped by variant in `VARIANT_ORDER`. Each group opens with a spanning row holding the variant display name in italics (`\multicolumn{…}{l}{\textit{Parallel-Anchored}}`).
- **Header:** two lines, name then unit in parentheses, so every column header carries its unit.
- **Column order**, from `METRICS`, with latency merged:

  `{X} (unit)` · `reps (n)` · `send rate (tx/s)` (omitted in E3a, where X is the send rate) · `throughput (TPS)` · `latency (s): avg (min–max), p95` · `CPU (%)` · `memory (MB)` · `success (n)` · `failure (n)` · `failure rate (%)` · `on-chain (B/event)` · `off-chain (B/event)` · `audit time per case (s)` · `anchoring delay (s)` · `flag` (E3a only)

**Cells**
- **Mean ± SD (`viz-cell-mean-sd`):** `12.3 ± 0.4`, where the mean and SD have the same number of decimals as `METRICS`. When n < 2, show the mean only. Set with `siunitx` `S` columns and `separate-uncertainty = true` so the ± aligns (for example `S[table-format=3.1(2)]`), and decimal-align every numeric column.
- **Latency cell (`viz-cell-latency`):** `0.412 (0.101–1.873), p95 0.960`. That is avg, then (min–max) with an en dash, then p95, all in seconds to 3 decimals, and **means only**. The SDs live in the CSV, and the table note says so.
- **Missing vs not applicable (`viz-cell-missing`, proposal, P1):** the code prints `-` for both. In print, use `n/a` for not applicable by design (off-chain storage and anchoring delay for Standard and Parallel) and `—` for a measurement that is missing. Add a table note defining both.
- **E3a flags (`viz-flag-e3a`, P1):** in the Markdown and CSV the `flag` column holds `saturated` and/or `latency-knee`. In print, replace the column with superscript marks on the throughput cell (`†` saturated, `‡` latency knee) and a table note, **(proposal)**.
- **E1 reference rows:** the code prints `ref (reference)` in the X cell. In print, put the reference rows in their own group at the bottom, headed `\textit{Reference (no batching)}`, with the X cell `n/a` and the variant named in the row, `Standard (reference)` **(proposal)**.
- **No highlighting of the highest or lowest value** (no bold, no colour). The tables report and do not rank. The words "baseline" or "calibrated" may label a row; no ranking words.
- **Size:** use `\footnotesize` in the paper and `\small` in the thesis. A table wider than the column uses `table*` in the paper, or **splits (`viz-table-split-cost`, proposal, P1)**:
  - Table A, performance: throughput through failure rate.
  - Table B, cost: on-chain and off-chain storage, audit time per case, anchoring delay.
  - Both are keyed by the same X and variant rows.
- **Ops (`viz-table-ops`, P0):** always **two** tables, `ops-writes` (create, transfer, access, dispose) and `ops-reads` (read-evidence, read-trail, verify-event), never merged. Reads cut no block, so read latency is not transaction latency. The X header is `operation type`.
- **Run-level metrics in per-round tables** (E3a, ops): the storage, audit and anchoring columns repeat per round. In print, move them into a small companion table keyed by variant, **(proposal)**, P1.

### 7.9 Markdown tables (`viz-table-markdown`, P0, exists)

`docs/results/<exp>/<name>.md` is the working-copy table the authors paste from:
- The title is `# <exp> — <name>`, followed by the preamble note (7.7).
- One `## <variant>` section per variant, containing a pipe table with the headers above and `---` alignment rows.

Required changes: the section headings use display names (`## Parallel-Anchored`), and the alignment row right-aligns numeric columns (`---:`) **(proposal)**.

### 7.10 CSV (`viz-csv-rounds`, `viz-csv-summary`, P0, exist): data only

- **No styling of any kind.**
  - No merged cells, no blank spacer rows, no "±" strings, no units inside cells.
  - Mean and SD sit in **separate numeric columns**. The summary CSV puts all means first, then the `<header> SD` columns.
  - Missing values are empty cells.
  - Exactly one header row, and **the unit goes in each header** (`throughput (TPS)`, `on-chain bytes/event (B, per run)`).
- **Encoding:** UTF-8 with BOM, so Excel opens it directly. The `decimal comma (; separated — Indonesian Excel)` checkbox switches to `;` separators with decimal commas.
- **Variant values stay as slugs** (`parallel-anchored`), because the CSV is machine-readable. The display names belong to charts and tables only.
- **Per-round export** (`benchmark/results/<exp>/<exp>-results.csv`): the column order is fixed by `EXPORT_COLUMNS`. The metrics come first in the supervisor's order, then the extras:
  - measured send rate, per-channel throughput, p50/p99
  - the fabric and off-chain resource groups, and the six failure classes `MVCC_READ_CONFLICT (n)` … `OTHER (n)`
  - the run-level storage, audit and anchoring columns, marked `per run`
  - regime, reference run, controls, seed, trace hash, git commit, `started at (UTC)`, `run wall time (s)`

  Rows are in numeric level order, so an Excel line chart does not zig-zag.
- **Summary** (`docs/results/<exp>/<exp>.csv`, `ops-writes.csv`, `ops-reads.csv`) and `e3a-saturation.json` (`viz-json-saturation`, data only) feed the captions.
- Figures are always regenerated from the manifests by `report.py`, never redrawn by hand from an edited CSV.

### 7.11 In-app presentation (desktop app, History & results tab)

#### 7.11.1 Current layout (read from `benchapp.pyw`)

- **Toolbar**, left to right:
  - `experiment` combobox (`all`, `e0`, `ramp`, `e1`, `e2`, `e3a`, `e3b`, `ops`, `cell`)
  - `Refresh`
  - `decimal comma (; separated — Indonesian Excel)` checkbox
  - `Export per-round CSV…`, `Export summary tables…`, `Generate tables + charts`, `Open results folder`

  The buttons carry circled "?" hover tips from `benchhelp.BUTTON_HELP`.
- **Left pane:** the runs `Treeview` with columns `runId`, `status`, `regime`, `started (UTC)` and `wall (min)`.
- **Right pane:** a `ttk.Notebook` with two tabs, **per-round results** and **charts**.
- **charts tab:**
  - A 6-row `Listbox` of **absolute PNG paths**, `docs/results/<exp>/<exp>-*.png`. It is filled only after `Generate tables + charts` runs in the current session, and sorted by file name.
  - Below it, a `Label` shows the selected PNG at native size, halved (`subsample(2)`) if it is wider than 1000 px.
- **Messages:** "CSV only" for e0, ramp and cell; "Written: mean ± SD tables + charts in …" after generation.

#### 7.11.2 Target design (`viz-app-chart-viewer`, P0; details proposal unless stated)

Everything here works with tkinter/ttk and needs no new dependency. Tk's `PhotoImage` can only scale by integer factors, which is why the `screen` preset renders at the display size (832 × 546 px) and nothing is rescaled.

| Region | Spec |
|---|---|
| **Chart list** (`viz-app-chart-list`, P1), left, ~220 px | Replaces the raw path list. One entry per chart in **`CHART_METRICS` order**, not file-name order, showing the axis label (`throughput (TPS)`, `latency p95 (s)` …). Grouped under a header row for the experiment (`E3a · send rate (tx/s)`). The full file path goes in the hover tip (existing `Tip` class). Up/Down moves between charts (native `<<ListboxSelect>>`), Enter opens the file. |
| **Preview**, centre | `--color-chart-surface` background, image centred at 100 %, never stretched. The app is light-only, and charts are always on white. |
| **Caption strip** below the preview | 9 pt, `--color-text-muted`: `E3a · throughput (TPS) vs send rate (tx/s) · mean ± SD, n = 3 · steady · generated 2026-09-25 14:03:11 UTC`. When n = 1: `n = 1 (no SD)`. |
| **Action row** (`viz-app-chart-toolbar`, P1) | `Open image` (`os.startfile`), `Open folder`, `Copy path`, and **(P2)** `Export for print…`, which writes the PDF/SVG/PNG-300 set for a chosen preset (`thesis-full`, `thesis-half`, `paper-column`, `paper-full`). |
| **Auto-populate** | When the tab opens with an experiment selected, list the chart files already on disk instead of waiting for a Generate click. |
| **Stale banner** (`viz-app-chart-stale`, P2) | If any complete manifest of the experiment is newer than its PNGs: a `--color-warning` bar reading "Charts are older than the newest run — Generate tables + charts to refresh." |

#### 7.11.3 Empty states (`viz-app-chart-empty`, P1)

These show inside the preview area, centred, 10 pt, `--color-text-muted`:

| Condition | Text |
|---|---|
| experiment = `all` | "Choose one experiment (E1, E2, E3a or E3b) to see its charts." |
| `e0`, `ramp`, `cell` | "CSV only — smoke, ramp and custom tests stay out of the paper's tables and charts." (existing message text) |
| `ops` | "The per-operation breakdown has tables only (writes and reads, separately), no charts." |
| no complete runs | "No complete runs yet for {exp}." |
| matplotlib missing | "Charts skipped: matplotlib not installed (pip install matplotlib). The tables were written." |
| not generated yet | "No charts yet — click Generate tables + charts." |

#### 7.11.4 Per-round results table (`viz-app-results-tree`, P1)

- **Columns:** `LIVE_COLS[1:]`: `round`, `send rate (tx/s)`, `throughput (TPS)`, `latency min (s)`, `latency max (s)`, `latency avg (s)`, `latency p95 (s)`, `CPU (%)`, `memory (MB)`, `success (n)`, `failure (n)`, `failure rate (%)`, `on-chain (B/event)`, `off-chain (B/event)`. Every header has a unit and a hover tip (`COLUMN_HELP`).
- Numeric columns are right-aligned, `run` and `round` left-aligned (current). Decimals follow `METRICS` **(proposal: apply them in the app's `fmt()` too)**.
- **Row tags (proposal):** Treeview can only style whole rows, not single cells.
  - Alternate rows on a subtle surface token.
  - Rows with `failure (n)` > 0 tinted with a subtle `--color-warning` background.
  - Rows from non-steady regimes show the regime in italics in the `round` cell (`r1 · sub-floor`).
- **Headings:** consistent with the charts and tables (7.2 label unification).

### 7.12 Figure sets

| Figure set | Files (`docs/results/<exp>/`) | Series shown | Special overlays |
|---|---|---|---|
| `viz-figset-e1` | `e1-throughputTps`, `e1-latencyAvgS`, `e1-latencyP95S`, `e1-cpuPct`, `e1-memMb`, `e1-failureRatePct`, `e1-onChainBytesPerEvent`, `e1-offChainBytesPerEvent`, `e1-auditSPerCase`, `e1-anchoringDelayS` | Anchoring, Parallel-Anchored | `viz-refline-e1` on every chart where the reference has data (not on off-chain storage or anchoring delay); log x (proposal); `viz-marker-e1-baseline` (proposal) |
| `viz-figset-e2` | same 10 keys with prefix `e2-` (off-chain storage and anchoring delay produce no file, since Parallel has none) | Parallel | `viz-band-e2-healthy`, `viz-refline-cpu-budget` (proposal) |
| `viz-figset-e3a` | same 10 keys with prefix `e3a-` | all four | `viz-refline-identity`, `viz-marker-saturation` (throughput); `viz-refline-threshold`, `viz-marker-latency-knee` (proposal) |
| `viz-figset-e3b` | same 10 keys with prefix `e3b-` | all four | none |
| `viz-fig-ops-bars` (proposal, P2) | `ops-writes-<metricKey>`, `ops-reads-<metricKey>` | grouped bars: x = operation type, one bar per variant (variant colour; hatch for anchored variants: `//` Anchoring, `xx` Parallel-Anchored, for grayscale), ±1 SD whiskers | writes and reads always in separate figures |
| `viz-fig-panel-pair` (proposal, P1) | `<exp>-pair-<keyA>-<keyB>` | 1 × 2 panels, one metric each (e.g. throughput, latency p95), shared legend strip on top, panels labelled (a) and (b) | `paper-full` preset |

### 7.13 Asset table

| ID | Category | Where used | Purpose | Variants / states | Size & format | Priority |
|---|---|---|---|---|---|---|
| viz-style-base | Style spec | Every chart that `report.py` `charts()` renders | Shared rcParams: serif type, hairline y-grid, frameless legend, TrueType embedding, deterministic export. Colours come only from tokens. | — | Python dict / `gleipnir.mplstyle` (text) | P0 |
| viz-style-thesis | Size preset | Thesis figures | Final-size type at A4 text-block width | `thesis-full`, `thesis-half` | 5.5 × 3.4 in; 2.7 × 2.2 in; PDF + SVG + PNG 300 dpi | P0 |
| viz-style-paper | Size preset | Two-column conference paper | Final-size type at column and full width | `paper-column`, `paper-full` | 3.5 × 2.4 in; 7.16 × 2.6 in; PDF + SVG + PNG 300 dpi | P1 |
| viz-style-screen | Size preset | Desktop app charts tab | On-screen PNG that needs no rescaling in Tk | with title + caption strip | 6.4 × 4.2 in at 130 dpi = 832 × 546 px PNG, sans-serif | P0 |
| viz-variant-encoding | Encoding spec | All charts, legends, app, tables | Variant = colour token + marker + fill + line style; display names instead of slugs; styled by name, never by cycle position | 4 variants × {series, reference}; hollow = anchored | spec table (7.3) | P0 |
| viz-chart-line | Chart template | E1, E2, E3a, E3b | One metric vs X, one line per variant, y from 0, ticks on grid levels | with / without error bars (n ≥ 2 / n = 1); linear / log x | per preset; PDF/SVG/PNG | P0 |
| viz-legend-variant | Legend | Above every chart's plot area | Variant key in fixed order; only entries that are drawn | 4 columns (full/screen), 2 columns (column/half) | `loc="lower center"`, `bbox_to_anchor=(0.5, 1.0)`, frameless | P0 |
| viz-legend-strip | Legend (proposal) | Thesis page with several subfigures; `viz-fig-panel-pair` | One shared variant key instead of one per panel | horizontal | 5.5 × 0.3 in PDF/SVG | P2 |
| viz-errorbar-sd | Overlay | Every series point | ±1 SD over repetitions | n ≥ 2: bar with caps; n < 2: no bar (proposal: SD None) | elinewidth 0.8, capsize 2.5, variant colour | P0 |
| viz-dodge-offset | Overlay (proposal) | Charts with ≥ 2 series at the same x | Keeps error bars from overlapping; drawing-only | −4.5 / −1.5 / +1.5 / +4.5 pt | `ScaledTranslation` | P1 |
| viz-refline-e1 | Overlay | All E1 charts | Standard and Parallel reference (no batching) at the same point | line only; line + ±1 SD band (proposal) | full-width horizontal, lw 1.0, variant colour and style, inline label | P0 |
| viz-refline-identity | Overlay | E3a throughput chart | y = x: throughput equals send rate | — | dotted, lw 0.9, `--color-chart-reference` | P0 |
| viz-refline-threshold | Overlay (proposal) | E3a throughput chart | y = 0.9 × send rate: the saturation rule made visible | — | sparse dots, lw 0.7, `--color-chart-reference` | P1 |
| viz-marker-saturation | Overlay | E3a throughput (+ p95, proposal) | First send rate with throughput < 0.9 × send rate, per variant | none / one per variant; coincident rates dodged; ring on the point (proposal) | dotted vertical, lw 0.8, variant colour | P0 |
| viz-marker-latency-knee | Overlay (proposal) | E3a latency p95 chart | First send rate with p95 ≥ 2 × p95 at the lowest rate | none / one per variant | caret `v`, ms 6, variant colour | P1 |
| viz-band-e2-healthy | Overlay (proposal) | E2 throughput, failure rate, CPU charts | Healthy range (§4.2), baseline (median), `channels_max` | band + two labelled lines | `axvspan` `--color-success` alpha 0.08 | P1 |
| viz-refline-cpu-budget | Overlay (proposal) | E2 CPU chart | 0.9 × cores × 100 % budget | — | dashed, `--color-warning`, inline label | P1 |
| viz-marker-e1-baseline | Overlay (proposal) | E1 charts; E1 audit chart | Confirmed baseline batch size; audit bound 1.5 × smallest level | before / after author confirmation (hidden before) | vertical / horizontal line, inline label | P2 |
| viz-watermark-regime | Overlay (proposal) | Any chart from non-steady data | Keeps smoke and sub-floor data from passing as benchmark results | `SMOKE`, `SUB-FLOOR` | diagonal text, 24 pt, alpha 0.15 | P1 |
| viz-figset-e1 | Figure set | Thesis/paper E1 figures; app | 10 metric charts for batch-size calibration | screen / thesis / paper | `docs/results/e1/e1-<key>.*` | P0 |
| viz-figset-e2 | Figure set | Thesis/paper E2 figures; app | Channel-count calibration charts (Parallel) | screen / thesis / paper | `docs/results/e2/e2-<key>.*` | P0 |
| viz-figset-e3a | Figure set | Thesis/paper E3a figures; app | Scalability vs send rate, all four variants | screen / thesis / paper | `docs/results/e3a/e3a-<key>.*` | P0 |
| viz-figset-e3b | Figure set | Thesis/paper E3b figures; app | Scalability vs cases, all four variants | screen / thesis / paper | `docs/results/e3b/e3b-<key>.*` | P0 |
| viz-fig-ops-bars | Figure (proposal) | Thesis per-operation section | Per-operation-type comparison; writes and reads in separate figures | writes / reads; hatch per anchored variant | grouped bars, per preset | P2 |
| viz-fig-panel-pair | Figure (proposal) | Paper (`figure*`) | Two metrics side by side, one metric per axes, shared legend | (a)/(b) panels | 7.16 × 2.6 in PDF/SVG | P1 |
| viz-caption-figure | Text template | Under every print figure | Carries the title, mean ± SD, n, and the metric's mandatory note (enqueue latency, OLS, compression rule) | per experiment / per metric | text | P0 |
| viz-caption-table | Text template | Above/below every print table | Caption above, preamble note below | per-round note for E3a/ops | text | P0 |
| viz-footer-provenance | Text (proposal) | Screen PNGs only | Experiment, regime, n, git SHA, `YYYY-MM-DD HH:mm:ss UTC` | — | 7 pt, `--color-text-muted` | P1 |
| viz-table-booktabs | Table style | Thesis + paper result tables | Three-rule, no verticals, units in headers, decimal-aligned, variant groups | LaTeX (booktabs + siunitx) / Word borders | `\footnotesize` paper, `\small` thesis | P0 |
| viz-table-split-cost | Table layout (proposal) | Paper | Performance table vs cost (storage, audit, anchoring) table | A / B | two tables, same row keys | P1 |
| viz-table-ops | Table layout | Per-operation results | Writes and reads always separate | `ops-writes`, `ops-reads` | booktabs; `.md` + `.csv` | P0 |
| viz-cell-mean-sd | Cell format | All print and Markdown tables | `mean ± SD` at `METRICS` decimals; mean only when n < 2 | n ≥ 2 / n < 2 | siunitx `separate-uncertainty` | P0 |
| viz-cell-latency | Cell format | Latency column | `avg (min–max), p95` in s, 3 decimals, means only | with / without p95 | en dash, text | P0 |
| viz-cell-missing | Cell format (proposal) | All print tables | Tells "not applicable" apart from "missing" | `n/a`, `—` | text + table note | P1 |
| viz-flag-e3a | Cell format | E3a tables | Marks `saturated` / `latency-knee` rows | text flag (Markdown/CSV); `†`/`‡` in print (proposal) | text | P1 |
| viz-table-markdown | Generated table | `docs/results/<exp>/<name>.md` | Working copy for pasting; one section per variant | display-name headings, right-aligned numbers (proposal) | Markdown | P0 |
| viz-csv-rounds | Data export | `benchmark/results/<exp>/<exp>-results.csv`; `Export per-round CSV…` | Every (run, round) with units in headers, controls, provenance | `,` / `;` + decimal comma | UTF-8 BOM CSV, unstyled | P0 |
| viz-csv-summary | Data export | `docs/results/<exp>/<name>.csv`; `Export summary tables…` | Means + separate SD columns per (variant, X) | `,` / `;` + decimal comma | UTF-8 BOM CSV, unstyled | P0 |
| viz-json-saturation | Data export | `docs/results/e3a/e3a-saturation.json` | Per-variant saturation and knee send rates that feed the captions | — | JSON | P0 |
| viz-export-files | Export spec | `docs/results/<exp>/` and `print/` (proposal) | Naming, formats, TrueType embedding, deterministic metadata | screen PNG; print PDF/SVG/PNG-300 | as 7.4.3 | P0 |
| viz-number-format | Format spec | Axes, tables, app | Decimals per `METRICS`; one unit per metric; thin-space thousands (proposal); no sci-notation < 10⁵ | — | spec | P0 |
| viz-app-chart-viewer | Desktop view | History & results › charts | Shows the generated charts next to the run list | populated / empty / stale | ttk frame; 832 × 546 px preview | P0 |
| viz-app-chart-list | Desktop control (proposal) | charts tab, left | Metric names in `CHART_METRICS` order, grouped by experiment, path as hover tip | selected / hover / disabled | `Listbox`, ~220 px | P1 |
| viz-app-chart-toolbar | Desktop control (proposal) | charts tab, below preview | Open image, Open folder, Copy path, Export for print… | enabled / disabled (no selection) | ttk buttons | P1 |
| viz-app-chart-empty | Desktop state | charts tab preview | Explains why no chart is shown | 6 texts (7.11.3) | 10 pt, `--color-text-muted` | P1 |
| viz-app-chart-stale | Desktop state (proposal) | charts tab, top | Warns that charts predate the newest run | shown / hidden | bar in `--color-warning` | P2 |
| viz-app-results-tree | Desktop table | History & results › per-round results | Per-round numbers with units in headers | alternating rows, failure-row tint, regime marker (proposal) | ttk `Treeview` | P1 |

### Checklist

- [ ] viz-style-base — shared matplotlib rcParams (serif, y-grid, frameless legend, TrueType 42, deterministic SVG)
- [ ] viz-style-thesis — `thesis-full` 5.5 × 3.4 in and `thesis-half` 2.7 × 2.2 in presets, PDF/SVG/PNG 300 dpi
- [ ] viz-style-paper — `paper-column` 3.5 × 2.4 in and `paper-full` 7.16 × 2.6 in presets
- [ ] viz-style-screen — 6.4 × 4.2 in at 130 dpi PNG for the desktop charts tab, with title
- [ ] viz-variant-encoding — colour token + marker + fill + line style per variant; display names; no reliance on the colour cycle
- [ ] viz-chart-line — one-metric-per-chart line template, y from 0, ticks on grid levels
- [ ] viz-legend-variant — frameless legend above the plot area in fixed variant order
- [ ] viz-legend-strip — standalone shared legend for multi-panel pages (proposal)
- [ ] viz-errorbar-sd — ±1 SD error bars over repetitions, no bar when n < 2
- [ ] viz-dodge-offset — point-based horizontal offset for overlapping series (proposal)
- [ ] viz-refline-e1 — Standard and Parallel reference lines on E1 charts, variant-styled, labelled inline
- [ ] viz-refline-identity — E3a y = x line on the throughput chart
- [ ] viz-refline-threshold — E3a y = 0.9 × send rate saturation threshold line (proposal)
- [ ] viz-marker-saturation — dotted vertical saturation line per variant on E3a charts
- [ ] viz-marker-latency-knee — p95 knee caret on the E3a latency p95 chart (proposal)
- [ ] viz-band-e2-healthy — E2 healthy range band plus baseline (median) and `channels_max` markers (proposal)
- [ ] viz-refline-cpu-budget — E2 CPU budget line at 0.9 × cores × 100 % (proposal)
- [ ] viz-marker-e1-baseline — confirmed baseline batch size and audit-bound lines on E1 (proposal)
- [ ] viz-watermark-regime — SMOKE / SUB-FLOOR watermark for non-steady data (proposal)
- [ ] viz-figset-e1 — 10 E1 metric charts (Anchoring, Parallel-Anchored + references)
- [ ] viz-figset-e2 — E2 metric charts (Parallel)
- [ ] viz-figset-e3a — 10 E3a metric charts, all four variants, saturation overlays
- [ ] viz-figset-e3b — 10 E3b metric charts, all four variants
- [ ] viz-fig-ops-bars — grouped bar charts per operation type, writes and reads separate (proposal)
- [ ] viz-fig-panel-pair — two-panel, one-metric-per-axes paper figure (proposal)
- [ ] viz-caption-figure — figure caption template with the mandatory metric notes
- [ ] viz-caption-table — table caption and note template
- [ ] viz-footer-provenance — screen-PNG provenance footer with a UTC timestamp (proposal)
- [ ] viz-table-booktabs — three-rule, unit-headed, decimal-aligned result tables
- [ ] viz-table-split-cost — performance vs cost table split for the paper (proposal)
- [ ] viz-table-ops — separate writes and reads per-operation tables
- [ ] viz-cell-mean-sd — `mean ± SD` cell format at `METRICS` decimals
- [ ] viz-cell-latency — `avg (min–max), p95` combined latency cell
- [ ] viz-cell-missing — `n/a` vs `—` distinction (proposal)
- [ ] viz-flag-e3a — saturated / latency-knee flags (`†`/`‡` in print, proposal)
- [ ] viz-table-markdown — per-variant Markdown tables from `report.py`
- [ ] viz-csv-rounds — unstyled per-round CSV export with units in headers
- [ ] viz-csv-summary — unstyled summary CSV with separate SD columns
- [ ] viz-json-saturation — `e3a-saturation.json` feeding the captions
- [ ] viz-export-files — file naming, PDF/SVG/PNG-300 export and deterministic metadata
- [ ] viz-number-format — decimals, units and tick-number rules
- [ ] viz-app-chart-viewer — History & results › charts tab layout
- [ ] viz-app-chart-list — metric-named chart list in `CHART_METRICS` order (proposal)
- [ ] viz-app-chart-toolbar — Open image / Open folder / Copy path / Export for print actions (proposal)
- [ ] viz-app-chart-empty — six empty-state messages for the charts tab
- [ ] viz-app-chart-stale — "charts older than newest run" banner (proposal)
- [ ] viz-app-results-tree — per-round results Treeview styling

---

## 8. UX flows, states & accessibility (both UIs)

This section sets out how people move through the web library (`frontend/`) and the desktop bench app (`orchestration/benchapp.pyw`). For every journey it covers what the user must understand at each step, where they can do damage, which confirmations are required, and what feedback they get. It also covers accessibility, responsive layout, printing and internationalisation. Labels in quotes are the real strings from the code. Anything that does not exist yet is marked **(proposal)**.

Colour tokens follow the foundations section. This section also relies on these tokens, which foundations must define: `--color-success`, `--color-warning`, `--color-danger`, `--color-info`, `--color-pending`, `--color-text`, `--color-text-muted`, `--color-surface`, `--color-surface-raised`, `--color-border`, `--color-focus-ring`, `--color-audit-logged` **(proposal token)**, `--color-print-ink`, `--color-print-rule`.

---

### 8.1 Cross-cutting UX principles

1. **Reading an exhibit writes to the ledger.** In this app, opening, previewing, downloading or exporting an exhibit, and generating a report, each append an on-chain `ACCESS` event under the signed-in username. Wherever that happens the UI must say so *before* the click, in words and with an icon (`web-icon-auto-logged`). The wording is that the action is recorded, not that it is audited.
2. **The UI must never add audit events of its own.** Defect F79 (`docs/audit/audit-log-live-verification.md`) was caused by a refresh after a download that re-read `GET /evidence/:id` and so logged a `view` nobody performed. Design rule: after any action that logs itself, refresh the trail only (`GET /evidence/:id/audit`, which is never logged). The design must not add any of the following on links to `/evidence/:id`, `/cases/:id/report`, or buttons that hit `/download`, `/export` or `/coc-report`:
   - hover prefetch or link preloading
   - "peek" popovers
   - auto-refresh timers
   - background revalidation
3. **Nothing on the chain is deleted.** `DisposeEvidence` is a terminal status change to `DISPOSED` with op tag `DISPOSE`. Users are deactivated, never deleted ("Deactivate rather than delete: on-chain audit actors must keep resolving."). Copy, icons and dialogs must never say "delete" or "remove" about evidence or users. Show a bin icon only where something off-chain really goes away, such as a case category.
4. **Status is never shown by colour alone.** Every status carries an icon or glyph plus a text label (see §8.7.5).
5. **One time format everywhere: `YYYY-MM-DD HH:mm:ss UTC`**, with the full ISO value (including milliseconds) in a tooltip or `title`. This is `formatTs()` in `frontend/src/lib/format.ts`. Timestamps are never shown in the viewer's locale.
6. **Confirmation strength matches the damage.** Four tiers, used throughout this section:

| Tier | When | Pattern | Asset |
|---|---|---|---|
| T0: none | Reversible, or only adds to a record with no side effects (post a note, set a flag, filter) | Inline result only | — |
| T1: notice | Action writes to the audit trail as a side effect (download, export, preview, CoC report) | Always-visible inline notice next to the control. No dialog, because a dialog on every read would train people to click through | `web-notice-auto-logged` |
| T2: confirm | Changes someone's access, or writes a permanent custody event (transfer custody, remove participant, change a role, deactivate a user, Mark CLOSED/ARCHIVED, unassign evidence, delete a category) | Modal that states the consequence in one sentence. Default focus on **Cancel**. Action button carries a verb ("Remove rizky from case") | `web-dialog-confirm-destructive` |
| T3: typed confirm | Irreversible and terminal (DisposeEvidence) | Modal with a required reason and the item label typed back; button disabled until both are filled | `web-dialog-dispose-evidence` |

On the desktop, T2/T3 apply to ledger resets (every Run…), Restore my test data…, Back up now (stops the stack), Use as baseline, and Force stop.

---

### 8.2 Web actions that write to the audit trail

This table is the source of truth for every `web-notice-auto-logged` placement.

| UI trigger (real label) | Page / route | Gateway route | Written on-chain | Current cue in code | Required cue |
|---|---|---|---|---|---|
| Opening the page | Evidence detail `/evidence/:evidenceId` | `GET /evidence/:id` | `ACCESS(view)`, 1 per page load | Code comment only; nothing shown to the user | Persistent header notice: "Opening this page was recorded on the chain as a view by *username* at *ts*." Link to the matching trail entry **(proposal)** |
| "Download" | Evidence detail, header | `GET /evidence/:id/download` | `ACCESS(download)` | None | Auto-logged icon on the button, plus a post-action toast naming the event |
| "Load preview" | Evidence detail, Overview → Preview | `GET /evidence/:id/download` | `ACCESS(download)` (a preview is recorded as a download) | Hint "logged on the chain as a download access" | Keep the hint; add the icon; toast after load |
| "Export (record + trail)" | Evidence detail, header | `GET /evidence/:id/export` | `ACCESS(export)` | None | Icon + toast. The exported JSON does not include its own export event; say so in the toast |
| "CoC report" / "CoC report (print / CSV)" | Case detail; Lead dashboard → My cases | `GET /cases/:id/coc-report` | 1 `ACCESS(coc-report)` **per exhibit in the case** | Hint on the report page only, *after* the fact: "generating this report appended one ACCESS(coc-report) event per exhibit…" | Before navigating, a T1 notice with the count: "Generates N access events (one per exhibit)" **(proposal)** |
| "Download CSV" | CoC report page | `GET /cases/:id/coc-report?format=csv` | **Another** `ACCESS(coc-report)` per exhibit (same route) | None | Icon + notice with the count. See open question Q1 |
| "Log access" (manual) | Evidence detail → Chain of custody tab | `POST /evidence/:id/access` | `ACCESS(<typed action>)` | Hint "Actor is always your username (server-attributed)…" | Keep. This is an intentional write (T0) |
| "Transfer" | Evidence detail → Chain of custody tab | `POST /evidence/:id/transfer` | `TRANSFER` (permanent) | None | T2 confirm **(proposal)** |

**Not auto-logged** (no cue, and must stay that way): the trail read (`GET /evidence/:id/audit`), notes, flags, search, case list and detail, case activity, the Case detail **"Export CSV (N)"** (built in the browser from the index rows, no ledger write), and all admin pages.

**Admins see less than investigators.** An admin outside a case gets `view`/`export` (both logged) but not blob download (403). The Download button is hidden and the page shows the hint "Blob content is participant-only — join the case roster to download (metadata and the trail stay visible)."

**Rate limit.** The auto-logging routes are limited per session. Over the limit the gateway returns 429 "too many evidence reads — slow down". This needs a designed error state: `web-state-rate-limited`.

---

### 8.3 Web journeys

Roles are global `investigator | lead | admin`, and per-case `viewer | contributor | lead`. The sidebar groups are "Library" (Ingest evidence, My cases, Search), "Lead" (Dashboard, leads only), and "Administration" (Users, Case admin, admins only).

#### J-W1 Investigator: sign in → My cases → ingest → view evidence and trail → download/export → CoC report

| # | Step (route) | User must understand | Risk and confirmation | Feedback | Empty / loading / error | Undo |
|---|---|---|---|---|---|---|
| 1 | **Sign in** `/login`: "Username", "Password", eye toggle, "Sign in" | This is a local thesis demo that talks only to the API gateway | Brute force is throttled server-side | Button reads "Signing in…" | Errors (real strings): "Invalid username or password." / "Too many failed attempts — wait a moment and try again." / "User login is not configured on this gateway." / "Could not reach the gateway. Is the network up?" Each needs an error icon and `role="alert"` | — |
| 2 | Redirect to `from` or `/cases` | Deep links survive sign-in | — | — | If the session was dropped by a 401 (gateway restart or deactivation), the user currently lands on `/login` without explanation. **(proposal)** add a banner: "Your session ended — sign in again." (`web-state-session-ended`) | — |
| 3 | **My cases** `/cases`: search, status filter (any/OPEN/CLOSED/ARCHIVED), "Filter". Table columns: name · status · my role · created by · updated | Only cases they are on the roster of are listed. An admin sees all cases with an empty "my role" (correct) | — | — | Empty: "No cases yet. A lead or admin grants case access." → `web-empty-cases`. Loading: nothing today → **(proposal)** table skeleton. Error: inline `.err` | — |
| 4 | **Case detail** `/cases/:caseId`: sections (Categories, Team), Evidence tab with filters (category / flag / status ACTIVE·DISPOSED) and "Export CSV (N)", activity feed | The case activity log (who added, flagged or noted what) is separate from the on-chain custody trail | "×" on a category chip deletes the category ("refused while evidence references it"). No confirm today → **T2 (proposal)** | — | "Loading case…", "No description.", "Nothing assigned to this case yet.", "No evidence matches the filters.", "Loading activity…", "No activity yet." | Deleting a category cannot be undone; the user re-adds it with a new id |
| 5 | **Ingest** `/ingest`: stepper "Case & category" → "Metadata" → "File & hash" → "Review & submit" | (a) Only cases where they are contributor or lead are listed. "— uncategorized (visible to you and admins only) —" is a real choice. (b) The file is hashed locally before upload. (c) Submitting writes a permanent `CREATE` event, and every later view, download or export is logged | Submit is permanent; there is no delete. The review step is the confirmation; **(proposal)** add a checkbox: "I confirm these details are correct — the CREATE event cannot be edited" | Hashing: "Hashing locally… N%" → `web-progress-hash`. Submit: button reads "Ingesting…". **(proposal)** add an upload progress bar and elapsed time for large files (`web-progress-upload`) | Hash failure: "local hashing failed: …". Upload errors inline. No categories: "This case has no categories yet — the case lead defines them." | None after submit. Before submit: "Back" keeps every field |
| 6 | **Ingest result** "Ingested ✓" | End-to-end integrity: "integrity verified end-to-end" (ok) or "INTEGRITY MISMATCH … do not rely on this exhibit until investigated" (danger). On anchored variants: "batched (anchoring) — commits at the batch boundary" | Mismatch is the one outcome that must interrupt the user → `web-banner-integrity-mismatch` (icon + label + next step) | `web-banner-integrity-verified` | — | **(proposal)** "Ingest another" button that keeps the case and category |
| 7 | **Evidence detail** `/evidence/:id`: header id, Merkle badge, flag badge; "Download", "Export (record + trail)"; tabs "Overview" / "Chain of custody (N)" / "Examiner notes" | **Opening the page already logged a `view`** (§8.2). The Merkle badge has four states: "Merkle: N/A" (non-anchoring variants), "Merkle: …", "Merkle: not yet anchored" (not a tamper signal), "Merkle: VERIFIED" / "Merkle: MISMATCH" | Leaving the page and coming back logs another `view`. Tell the user this in the auto-log notice | — | Not found: "No on-chain record (unknown id, no access, or an anchoring-variant write whose batch has not closed yet)." Forbidden: "You do not have access to this evidence (not a participant of its case)." Notes: "Loading notes…", "No examiner notes yet.", "Notes are read-only for your case role." Trail empty: "No audit events." | — |
| 8 | Overview → Preview: "Load preview" (image/video/audio/pdf/text) | A preview counts as a download | T1 | "Loading…"; text preview capped: "showing the first 64 KiB — download for the full file" | Unsupported MIME: no preview block. **(proposal)** show "No inline preview for this file type — Download to inspect" | — |
| 9 | Overview → Flag chips "High priority" / "Processed" / "Needs lead review" (toggle) | Flags go to the case activity log, not the chain | T0 | Badge updates | Inline flag error | Click again to clear |
| 10 | Chain of custody → "Verify latest" (anchored variants only), "Transfer custody", "Log manual access" | Verification is per event and only works on events written in this session ("Write an event this session first — verification is per event") | **Transfer** is permanent and changes the custodian → **T2 (proposal)**: "Transfer custody of ITEM-001 to *name*? This writes a permanent TRANSFER event." | New events appear in the session trail with a batched flag | — | None. A second transfer can hand the item back |
| 11 | **Download / Export** | Each writes one `ACCESS` event; the trail refreshes without adding a `view` | T1 | **(proposal)** toast "Download recorded on the chain — ACCESS(download) by *user* at *ts*" plus the browser's own download | 403 off-case admin (button hidden); 429 rate limit; network error | None: an access event cannot be retracted. The copy must not imply otherwise |
| 12 | **Examiner notes** "Post note" | "add note (immutable once posted)" | Permanent → **(proposal)** a light T2 inline confirm ("Post — cannot be edited") | Note appears | — | None |
| 13 | **CoC report** `/cases/:caseId/report`, outside the app shell: "Print / save as PDF", "Download CSV", "← back to case" | Opening it logged one `ACCESS(coc-report)` per exhibit. Trails are as of assembly time, so the next report will include this one's events | T1 **before** navigating (proposal); on the page the existing hint stays | "Assembling report…" → **(proposal)** skeleton + count of exhibits | "Case not found — or you are not a participant." · "No evidence in this case." | None |

#### J-W2 Lead: roster, flags, activity, report (`/lead/dashboard`; admins can reach it by URL)

| # | Step | Must understand | Risk and confirmation | Feedback | States |
|---|---|---|---|---|---|
| 1 | "My cases (N)", each with a "CoC report" link | Leads see the cases they lead | The CoC report link logs events → T1 icon on the link | — | "You lead no cases yet." |
| 2 | **"My team"** per case: role `<select>` per member (aria-label "role of *user* in *case*"), "Remove", "Add member" | "A case keeps at least one lead; removals are server-checked." Case-lead can only go to global leads | **Changing a role applies immediately on select change**, with no confirm. Removing takes access away at once → **T2 for both (proposal)**; for role change show from → to | Roster reloads | "No led cases — no roster to manage." · "No participants yet." · server refusal inline (e.g. last lead) |
| 3 | Add member modal "Add member — *case*": user picker, "role in case", "Grant access" / "Cancel" | Candidates are active users not already on the roster | Gives access to all case evidence → the button label names the grant | Modal closes, roster reloads | "No global-lead users are available to add." / "Every active user is already on this roster." |
| 4 | **"Flagged evidence (N)"**: links with "High priority" / "Needs review" badges | Clicking an item **opens evidence detail and logs a view** | T1 icon on these links | — | "Nothing awaiting review." |
| 5 | **"Recent team activity"**: merged timeline, 20 newest across up to 10 led cases | This is the case activity log, not the chain | — | — | "No recent activity." **(proposal)** state that only 10 cases × 10 events are merged, so the feed is never mistaken for a complete log |
| 6 | Report → same as J-W1 step 13 | | | | |

**Undo:** re-add the member or re-select the old role. The case activity log keeps both changes, so the history stays readable.

#### J-W3 Admin: users (`/admin/users`) and case administration (`/admin/cases`)

| # | Step | Must understand | Risk and confirmation | Feedback / states | Undo |
|---|---|---|---|---|---|
| 1 | "Users (N)" table (username · name · role · active) → click row → "Edit: *username*" modal | Users are never deleted | Rows are clickable `<tr>` elements with no keyboard access → must become buttons/links (§8.7.3) | — | — |
| 2 | "New user" → "Create user" modal: username, password, name, role → "Create" | — | T0 | Inline error | Deactivate |
| 3 | Edit: "Apply role", "Deactivate" / "Reactivate", "Reset password" | Your own role and active status are locked (buttons disabled) | Deactivate ends the person's sessions and access → **T2 (proposal)**. Reset password → T2 (proposal). Apply role → T2 when it lowers privileges (proposal) | **(proposal)** success toast; today only errors are shown, so a successful reset gives no feedback | Reactivate. Role can be changed back |
| 4 | Case admin: "Create case", "All cases (N)", then per case: "Mark OPEN/CLOSED/ARCHIVED", "Participants (N)" → "Grant" / "Remove", "Evidence (N)" → "Assign to case" / "Unassign", "investigator view →" | "One case per evidence item — assigning something already categorized elsewhere is refused." | Mark ARCHIVED, Remove and Unassign → **T2 (proposal)** | "Select a case to manage its roster and evidence." Today the page uses raw inputs, not the UI kit (ux-review U4) → redesign with the kit | Status can be changed back; re-grant; re-assign |

#### J-W4 Dispose evidence (proposal: no UI today)

`api.ts` has `disposeEvidence(id, reason)` but no page calls it. If the authors add it (Q3):

1. It lives on Evidence detail → Chain of custody. Only case leads and admins see it.
2. `web-dialog-dispose-evidence` (T3):
   - Title: "Dispose ITEM-001?"
   - Body: "DisposeEvidence writes a terminal DISPOSE event and sets the status to DISPOSED. Nothing is deleted — the record, its file and its full trail stay readable. No further custody transfers are possible."
   - Required "reason" field, plus the item label typed back.
   - The button stays "Dispose" (not "Delete"), styled with `--color-danger`.
3. Afterwards:
   - status pill `DISPOSED` gets the × glyph
   - the timeline shows a `DISPOSE` entry
   - transfer and manual access are disabled with a reason tooltip: "Evidence is DISPOSED — terminal"
4. Undo: none. The dialog says so.

#### J-W5 Guard pages

- `/unauthorized` (`web-page-unauthorized`) and `*` (`web-page-not-found`): an illustration, the real message, and a link back to "My cases".
- Session ended: see J-W1 step 2.

---

### 8.4 Desktop journeys (GLEIPNIR Bench, window title "GLEIPNIR Bench — E0 · E1 · E2 · E3")

**Window layout (real):**
- Top bar: status line on the left. On the right: "Restore my test data…", "Back up now", "Revert (reload file)", "Save changes".
- Notebook tabs: "Settings & Baselines", "E0 initial test", "E1 batch size", "E2 channels", "E3 main", "Custom test", "History & results".
- A resizable "Run" panel underneath containing:
  - overall and per-round progress bars
  - "Cancel" / "Force stop"
  - "verbose Caliper output"
  - a live results table
  - "show raw log"
- Every experiment tab has three buttons: "Preview plan", "Run…" and "Resume…".

**Status line (real):**
- "⚠ sweeps.yaml has UNCOMMITTED changes — run.json cites its SHA: commit before a campaign" in red, or "sweeps.yaml committed" in green
- "N unsaved change(s)"
- "ledger holds: test data | benchmark …"

Only the dirty state has an icon today. The clean state needs one too (✓), so the status is not shown by colour alone.

#### J-D1 The campaign: settings → E0 smoke → ramp → baseline send rate → E1 → baseline batch size → E2 → baseline cases → E3a / E3b / ops → history → export CSV → restore test data

| # | Step (real labels) | Must understand | Risk and confirmation | Feedback | Empty / loading / error | Undo |
|---|---|---|---|---|---|---|
| 1 | **Settings & Baselines**: controlled workload fields, the 4 baselines with provenance tags `[set from <exp> <date>]` / `[set by hand <date>]`; "Save changes" | Every value lives in exactly one input box, bound to `benchmark/sweeps.yaml`. The thesis cites that file's git SHA, so commit it before a campaign. Baselines read "PLACEHOLDER" until measured | Save while a run is active is refused: "A benchmark is using benchmark/sweeps.yaml right now — save after it ends…". Invalid input: "Invalid input". Unsaved edits before a Run: askyesno "Unsaved changes" | Status line shows the unsaved count; floor hint "nominal N write events per case per run (floor F)…" | Parse errors in the status line | "Revert (reload file)" discards unsaved edits. After saving: git history only |
| 2 | **E0 initial test**, step "smoke test — functional correctness only (label smoke)"; variant checkboxes; "Preview plan" | Checks function, not speed. 1 repetition. Results labelled `smoke` and kept apart from benchmark data | None for Preview: "Changes nothing." | Preview → "Plan preview (nothing was run)" dialog with run list, regimes, sub-floor warnings and ETA | "Preview failed" shows the last 20 log lines | — |
| 3 | "Run…" → **confirm dialog "Run e0?"**: plan text, reset warning, backup destination, "Baselines used" with provenance, uncommitted warning, optional "skip the backup — the ledger already holds benchmark data (…)"; "Start" / "Cancel" | **Every run resets the ledger.** The manual-test custody trails are erased; accounts, cases and evidence files are not touched. The app backs up all `gleipnir_*` volumes first | **T2 dialog. This is the main destructive gate.** Redesign (`desk-dialog-confirm-run`): the plan text above, then a consequence block with `--color-danger` + warning icon, then the backup path, then baselines. Default focus on **Cancel**. The skip-backup checkbox is off by default and says where the test data is kept | Backup phase: "backup-before-e0". Stack stops about 1 min. "Backup failed — nothing was run" if it fails | Busy: "A benchmark process is already running." / "Another experiment.py is running in WSL." / "Nothing to run" (all complete) | **Restore my test data…** (step 12) |
| 4 | **Run in progress**, Run panel | Progress and ETA are estimates from earlier runs' medians | Closing the window: askyesno "Quit": "A benchmark process is running. Cancel it and quit? (Resume it later from the same tab.)" During backup/restore: "Please wait" (closing is refused) | Overall: "run i/n · x % done · elapsed … · ETA …". Round: "*runId* · regime … · round j/m *label* @ R tx/s · Caliper submitted … · succ … · fail … · unfinished …". Warnings "! …" in `--color-warning`. One live row per finished round (CPU, memory and bytes per event fill in after collection) | Error lines tagged `err`/`warn` in the raw log; the log path is shown | Cancel → Resume |
| 5 | Run ends | Where the results are | — | Modal "Finished": "*exp* complete. Results: History & results tab; per-round CSV…" **(proposal)**: a non-modal banner plus Windows taskbar flash or notification (`desk-notify-finished`), because campaigns run for hours with nobody watching | "*exp* stopped (exit N)" with the log tail. "Stack did not come back up" | Resume |
| 6 | **E0, step "ramp — short send-rate ramp to locate saturation"** → Run… (same gate) | Sweeps the *configured* send rate. Saturation = successful throughput < 0.9 × send rate. Label `sub-floor` | As step 3 | As step 4 | — | — |
| 7 | **Suggestion table "Suggested baseline send rate (from the ramp)"** (columns: variant · saturation (tx/s) · suggested (tx/s)) → "Use N tx/s as baseline…" / "Use trimmed grid as send-rate grid…" | This is a *suggested baseline* from the methodology rule, never "best". Writing it changes every later experiment | askyesno "Use as baseline": "Write into benchmark/sweeps.yaml? …". Refused during a run | The provenance tag updates and the status line shows sweeps.yaml as uncommitted | Empty table → `desk-empty-suggestion`: "Run the ramp to get a suggestion" **(proposal copy)** | Type the old value back (then tagged `[set by hand <date>]`), or git |
| 8 | **E1 batch size**: batch-size grid; variants Anchoring, Parallel-Anchored, "Standard (reference line)", "Parallel (reference line)"; "held fixed" (baseline send rate, channels) → Run… → "Suggested baseline batch size (methodology §4.1)" → "Use N as baseline batch size…" | One grid for both anchored variants. Standard and Parallel are batch-size-free reference rows, shown as `ref` | As 3 and 7 | As 4 | — | As 7 |
| 9 | **E2 channels**: "independent variable (Parallel only; cases = channels)"; host core note → Run… → "Suggested cases/channels (methodology §4.2: median of the healthy range)" → "Use C / max M as baselines…" | Baseline = the **median** of the healthy range, never its maximum. `channels_max` caps E3b | As 3 and 7 | As 4 | — | As 7 |
| 10 | **E3 main**: radio "E3a — scalability vs send rate…", "E3b — scalability vs cases…", "per-operation breakdown…"; E3b grid; variants; "held fixed — the baselines from E0/E1/E2"; red warning while any baseline is a placeholder; note "Supervisor gate: the variable table + three flowcharts go to D before E3 runs." | E3 uses all three accepted baselines | **(proposal)** Block Run… while any baseline is a PLACEHOLDER, or require an extra "Run anyway" checkbox. The warning keeps its icon | As 4 | Placeholder warning banner `desk-banner-placeholder-baseline` | — |
| 11 | **History & results**: experiment filter, "Refresh", "decimal comma (; separated — Indonesian Excel)", "Export per-round CSV…", "Export summary tables…", "Generate tables + charts", "Open results folder". Runs list: runId · status · regime · started (UTC) · wall (min). Right side: "per-round results" / "charts" | CSV = one row per run × round. Summary tables = mean ± SD (E1–E3 only). The smoke / sub-floor / steady label is part of every row | Export fails if the file is open: "Not exported … Is the file open in Excel?" | "Exported" with the path; "Written" (tables + charts) | "Pick an experiment" (choose one first); "CSV only" (e0/ramp/cell have no aggregated tables); "No results" | Re-export overwrites |
| 12 | **"Restore my test data…"** → dialog "Restore my test data": "Every gleipnir_* volume and network/compose/.env are REPLACED by the backup; the stack is stopped and started again…". List rows: `<timestamp>  reason  variant=…  ledger held: …  N MB`, pre-selected to the newest test-data backup → "Restore" / "Cancel" | Restore replaces the **whole** current state, including accounts or cases created since the backup. Benchmark results on disk are kept | **T3-level risk; today it is only a list + button.** **(proposal)** `desk-dialog-restore`: a summary card of the chosen backup (date, reason, what it held), a "Replaces everything since *date*" line with `--color-danger`, focus on Cancel. **(proposal)** offer "Back up current state first" | Cancel is **not available** during a restore (on purpose). "Restored *name* (*reason*)." / "Restore failed" with the log tail | "No backups": "No complete backup in backups/ yet." | Only through another backup; see the proposal above |

#### J-D2 Cancel, force stop, resume

- **Cancel** during Preview or backup: "cancel requested — the current step finishes, nothing further is started". A finished backup is kept and the stack restarted.
- **Cancel** during a run: sends SIGINT. The button becomes "Force stop" with "cancelling (SIGINT)… if it is still running after 30 s, click Force stop". Force stop sends SIGKILL (T2 proposal: confirm "Force stop may leave containers mid-transaction; the run is logged failed").
  - **(proposal)** Show a 30-second countdown on the button instead of making users time it.
- **Resume…**: same flow as Run, but completed runs are skipped. A plan with nothing left stops before the backup.
- The laptop is kept awake while a run is active. **(proposal)** Show this in the Run panel ("sleep blocked while running").

#### J-D3 Back up now

askyesno "Back up now": "The stack stops for about a minute while every gleipnir_* volume is copied to backups/<ts>, then starts again. Continue?". The backup appears in Restore once its `backup.json` is written. Folder timestamps follow the app's naming; anything shown to the user uses `YYYY-MM-DD HH:mm:ss UTC`.

#### J-D4 Custom test

The tab says "One ad-hoc cell (experiment.py --exp cell): a probe, not an E1–E3 datapoint…". It has "independent variables" (send rates, batch size, cases), "controlled workload overrides (recorded in run.json; own results dir)", and a "reuse the running ledger" option: no reset, no backup, and the benchmark's transactions are added to the manual-test ledger.

The reuse option **pollutes the authors' test trails** and must be a T2 checkbox with its own warning icon (`desk-toggle-reuse-ledger`). The confirm dialog already switches to the text "REUSE the running ledger: no reset and no backup…".

---

### 8.5 State catalogue (design every state for every data region)

| State | Web pattern | Desktop pattern |
|---|---|---|
| Loading | Today: plain text ("Loading case…", "Loading notes…", "Loading activity…", "Assembling report…"). **(proposal)** skeletons shaped like the content (`web-state-loading-skeleton`) with `aria-busy="true"`. After 10 s add "Still working — the ledger may be under load." | Progress bars; "idle" text when nothing is running |
| Empty | Illustration plus the real sentence, plus a primary next action where one exists (e.g. "New case" for leads and admins) | Empty tree + one-line hint on what fills it |
| Error (recoverable) | `.err` block with error icon, `role="alert"`, plain cause + next step. Never only a red border | `messagebox.showerror` + last 20 log lines. **(proposal)** a "Copy log" button |
| Forbidden / not found | Distinct copy for 403 vs 404 (see J-W1 step 7); never blame the user | — |
| Pending / not yet anchored | "Merkle: not yet anchored" in `--color-pending` + clock icon. **Must not look like an error** (F49) | — |
| Integrity mismatch | Only red-level alert in the library: danger icon + "INTEGRITY MISMATCH" / "Merkle: MISMATCH" + next step | — |
| Busy (action refused) | Disabled button + tooltip giving the reason (e.g. "Write an event this session first — verification is per event") | Buttons stay enabled and answer with "Busy" dialogs. **(proposal)** disable them with a tooltip naming the running job |
| Success | **(proposal)** toast (`web-toast`), 5 s, pausable on hover/focus, never the only record of a ledger write (the trail updates too) | Status line + "Finished"/"Exported"/"Written" dialogs |
| Offline / gateway down | "Could not reach the gateway. Is the network up?" → reuse as a page-level banner **(proposal)** | "Stack did not come back up" |
| Rate limited (429) | `web-state-rate-limited`: "Too many evidence reads — wait a moment." Disable auto-logged buttons for the `Retry-After` period | — |

---

### 8.6 Feedback: progress, ETA, toasts

- **Web progress:** local hashing gives a percentage (existing). Upload gives bytes and % **(proposal)**. The CoC report gives an exhibit count while assembling **(proposal)**. No indeterminate spinner may run longer than 10 s without a text update.
- **Web toasts (proposal):**
  - Bottom-right, stacked, max 3.
  - `role="status"` (success/info) or `role="alert"` (error).
  - Every toast about a ledger write names the op and actor, e.g. "ACCESS(export) recorded — dara · 2026-09-25 04:55:32 UTC".
  - No toast for page-load `view` events; the persistent header notice covers those.
- **Desktop ETA:** keep the real format "run i/n · x % done · elapsed … · ETA …".
  - **(proposal)** show "ETA — (no history yet)" before any run exists.
  - **(proposal)** give an ETA range when there are fewer than 3 past runs.
- **Units:** the live table and History columns carry units in the header ("send rate (tx/s)", "throughput (TPS)", "latency p95 (s)", "CPU (%)", "memory (MB)", "failure rate (%)", "on-chain (B/event)"). Keep them in any redesign. The send rate column is labelled as configured and the throughput column as measured (hover help already says so).

---

### 8.7 Accessibility (WCAG 2.1 AA)

#### 8.7.1 Contrast
- Text contrast ≥ 4.5:1 (≥ 3:1 for ≥ 18.66 px bold or 24 px). Component boundaries and focus ring ≥ 3:1 against adjacent colours. Check both the dark app theme and the print palette.
- **Web:** check `--color-text-muted` on `--color-surface-raised` (cards) specifically; `.hint`/`.muted` text carries critical auto-log warnings. Consider promoting those warnings to `--color-audit-logged` with an icon.
- **Desktop:** hard-coded greys `#777` / `#555` and orange `#a60` on the default ttk background are likely below 4.5:1 at 9 pt. The design must give tkinter-safe colour values (hex) for muted text, warnings (`#a60`), dirty status (`#b00`) and ok status (`#060`), each checked against the ttk default background and against Windows High Contrast.

#### 8.7.2 Focus
- Visible focus indicator on every interactive element: `sys-focus-ring`, 2 px `--color-focus-ring` outline, 2 px offset, never removed. On the desktop, the ttk focus dash must be visible on the chosen theme.
- Focus order follows reading order: TopBar → Sidebar → main content → footer. **(proposal)** "Skip to main content" link (`web-skip-link`) as the first tab stop.

#### 8.7.3 Keyboard: gaps found in code and required fixes

| Where | Issue | Requirement |
|---|---|---|
| `UsersPage`, `CasesAdminPage` | Rows are `<tr onClick>`, not focusable | Username / case name becomes a `<button>` or link inside the row; Enter/Space opens |
| `LoginPage` eye toggle | `tabIndex={-1}`, so keyboard users cannot reveal the password | Make it a tab stop; keep `aria-label` "Show password"/"Hide password"; add `aria-pressed` |
| Flag chips (Evidence detail) | Toggle buttons without state | `aria-pressed` + a ✓ glyph when active (not colour/border only) |
| Category "×" chip | Only a `title` | `aria-label="Delete category *name*"` + T2 confirm |
| Lead roster role `<select>` | Applies on change: keyboard arrow browsing fires writes | Change + explicit "Apply" button, or T2 confirm before writing |
| Modal overlay click closes | Unsaved form input lost on a stray click | Overlay click closes only when the form is pristine; Escape keeps working |
| Desktop hover-only help (`Tip`, circled "?" icons) | Not reachable by keyboard; tooltips vanish | Show the tip on focus too; F1 opens help for the focused field; "?" icons in the Tab order or duplicated in a help pane **(proposal)** |
| Desktop variant checkboxes (E0, E3) | Show raw ids `standard`, `parallel-anchored` | Labels must be exactly Standard, Anchoring, Parallel, Parallel-Anchored |
| Desktop dialogs | "Start"/"Restore" packed rightmost, no default | Default = Cancel; Escape = Cancel; Enter only activates the focused button |

#### 8.7.4 ARIA for the UI kit (per `docs/audit/ux-review.md` U2)
- **Tabs:** `role="tablist"` / `tab` / `aria-selected`, roving `tabIndex` (only the active tab is a tab stop), Arrow/Home/End with activation following focus. Must also have `aria-controls` → `role="tabpanel"` with `aria-labelledby` **(proposal: panels are not marked today)**. The tab label "Chain of custody (N)" keeps the count in its accessible name.
- **Stepper:** `<ol>`; `aria-current="step"` on the active step; completed steps add visually-hidden text "completed" (the ✓ glyph alone is not enough). The step change moves focus to the new step's heading **(proposal)**.
- **Modal:** `role="dialog"`, `aria-modal="true"`, `aria-labelledby` → title, focus moves to the panel on open and back to the opener on close. **No focus trap, by design** (ARCHITECTURE §5). Keep that decision; the design must not assume a trap. Close button `aria-label="Close"`.
- **Live regions:** hashing progress `role="progressbar"` with `aria-valuenow`; toasts as in §8.6; Merkle badge changes announced politely.
- **Timeline:** `<ol>` with each entry reading "*OP* by *actor* at *ts* — *detail*"; the marker glyphs (+ ⇄ ◉ ×) are `aria-hidden`.

#### 8.7.5 Status is never colour-only: required pairs

| Status | Glyph / icon | Label | Token |
|---|---|---|---|
| CREATE | + | CREATE | `--color-success` |
| TRANSFER | ⇄ | TRANSFER | `--color-info` |
| ACCESS | ◉ | ACCESS + action (view/download/export/coc-report/typed) | `--color-text-muted` |
| DISPOSE / DISPOSED | × | DISPOSE / DISPOSED | `--color-danger` |
| ACTIVE | ● | ACTIVE | `--color-success` |
| Merkle: VERIFIED | check-shield | "Merkle: VERIFIED (x ms)" | `--color-success` |
| Merkle: MISMATCH | alert-shield | "Merkle: MISMATCH" | `--color-danger` |
| Merkle: not yet anchored | clock | "Merkle: not yet anchored" | `--color-pending` |
| Merkle: N/A | dash | "Merkle: N/A" | `--color-text-muted` |
| Flags | flame / check / eye | High priority / Processed / Needs lead review | `--color-danger` / `--color-success` / `--color-warning` |
| Case OPEN/CLOSED/ARCHIVED | open-folder / closed-folder / archive-box | text as-is | — |
| Regime | beaker / gauge / dotted-gauge | smoke / steady / sub-floor | `--color-info` / `--color-success` / `--color-warning` |
| sweeps.yaml | ✓ / ⚠ | committed / UNCOMMITTED | `--color-success` / `--color-danger` |
| Run status | ✓ / ✕ / ◐ | complete / failed / incomplete | `--color-success` / `--color-danger` / `--color-warning` |

#### 8.7.6 Motion
- Respect `prefers-reduced-motion: reduce`: no toast slide-ins, skeleton shimmer or progress-bar easing; use instant state changes and a static skeleton.
- No flashing content. The desktop app has no animation beyond progress bars; keep it that way.

#### 8.7.7 Forms and text
- Every input has a visible label (existing pattern: lowercase `<label>` text wraps the input). Required fields are marked in text, not only with a star.
- Errors are tied to fields with `aria-describedby`.
- Text resizes to 200 % without loss of content. The desktop respects Windows scaling at 100–200 % (tkinter DPI awareness).

---

### 8.8 Responsive rules (web)

The web app is designed for desktop first: the primary target is 1280–1920 px on a lab laptop. It must stay usable down to 360 px for reading, because a lead may check a trail on a tablet. Today there are no breakpoints except print. `.demo` is a fixed `340px 1fr` grid, `.page-narrow` is max 560 px, and `.report-page` is max 820 px.

| Breakpoint | Layout |
|---|---|
| ≥ 1280 px | Sidebar always visible; two-column pages (Lead dashboard, Case admin) side by side; content max width 1440 px |
| 1024–1279 px | Sidebar narrows to icons + tooltips **(proposal)**; two columns keep the 340 px left column |
| 768–1023 px | Two-column pages stack (left column first); sidebar becomes a top "Menu" drawer **(proposal)** |
| < 768 px | Single column. **Tables become cards** (`web-table-card-collapse`): each row turns into a card with the primary field (item label / case name / username) as the heading and the rest as a key–value list; status pills stay visible. The filter bar wraps; `.filter-bar input` drops its 220 px min width. Ingest wizard: step labels hide and only numbered dots plus "Step 2 of 4 — Metadata" show |
| Any width | No horizontal page scroll. Mono ids (`evidenceId`, `CASE-<uuid>`, integrity proofs `ni:///sha-256;…`, txIds) wrap with `overflow-wrap: anywhere` and carry a copy button **(proposal)**. Touch targets ≥ 44 × 44 px below 1024 px |

---

### 8.9 Print: the Chain-of-Custody court report

- The route `/cases/:caseId/report` renders outside the app shell. "Print / save as PDF" uses the browser's print function; there is no PDF library, by design.
- Existing print CSS:
  - light palette
  - hides `.no-print`, the top bar, sidebar, footer and **all buttons**
  - cards use `break-inside: avoid`
- Requirements for the designer:
  1. A4 and US Letter portrait, 15–20 mm margins, black on white (`--color-print-ink`, `--color-print-rule`). No reliance on colour: op glyphs + labels print in greyscale.
  2. `web-print-report-header` on every page: "Chain-of-Custody Report", case name + `CASE-…` id, "generated YYYY-MM-DD HH:mm:ss UTC". `web-print-report-footer`: "Page x of y" and the report's generated timestamp. The x/y counter and repeated headers are a proposal and depend on browser print support; if a page counter is not possible, fall back to a table `<thead>` repeated on every page.
  3. One exhibit per block. Each exhibit starts on a new page if its trail would split its header from the first event. Long trails may break between events, never inside one.
  4. **Every timestamp formatted** the same way. `seizedAt` and `uploadedAt` currently print as raw ISO (the report uses `formatTs` only for "generated"), and must be fixed. Seizure time must say it is UTC (see §8.10).
  5. The on-screen hint about the report's own `ACCESS(coc-report)` events **prints as a footnote**, so the court copy says that producing it added N events.
  6. **(proposal)** Signature/attestation block `web-print-signature-block` (examiner name, role, date, signature line). Authors to decide (Q6).
  7. Hash values and ids print in the monospace face, wrapped, never truncated.

---

### 8.10 Internationalisation and time

- **Language:** the UI is English only. Users are Indonesian investigators and a Jakarta-based supervisor, so write plain English: short sentences, no idioms, and keep domain terms (custody, exhibit, dispose). Keep strings in components simple enough to extract later; no translation layer is requested **(do not build)**.
- **Time:** every displayed timestamp is `YYYY-MM-DD HH:mm:ss UTC`, never the viewer's locale; the full ISO goes in the tooltip.
  - Risk to design for: the Ingest "seizure date & time" field is a browser `datetime-local`, i.e. **the examiner's local time (WIB, UTC+7)**. It is converted to UTC on submit, but the Review step echoes the raw local string, and Evidence detail shows the stored ISO.
  - **(proposal)** Label the field "seizure date & time (your local time — stored as UTC)" and show the converted UTC value live under it and on the Review step.
- **Numbers:** the UI uses a dot as the decimal separator. The desktop's "decimal comma (; separated — Indonesian Excel)" option applies to **export only**. CSVs are UTF-8 with a BOM.
- **Desktop time:** History "started (UTC)" must use the same format; `backups/<timestamp>` folder names can stay filesystem-safe but must be *shown* formatted.

---

### 8.11 Assets for this section

| ID | Category | Where used | Purpose | Variants / states | Size & format | Priority |
|---|---|---|---|---|---|---|
| web-icon-auto-logged | Icon | Next to "Download", "Load preview", "Export (record + trail)", "CoC report" links/buttons, "Download CSV", flagged-evidence links, evidence-detail header notice | Marks every control whose use appends an on-chain ACCESS event | default, hover, disabled; `--color-audit-logged` | 16 & 20 px, SVG, 1.5 px stroke, `currentColor` | P0 |
| web-notice-auto-logged | Inline notice component | Evidence detail header ("Opening this page was recorded…"), preview hint, report page, pre-report T1 notice | Tells the user a read writes to the audit trail, before or right after it happens | compact (one line under a button), banner (page header), with event link | Component spec; icon + text; min height 32 px | P0 |
| web-dialog-confirm-destructive | Modal pattern | Transfer custody, remove participant, role change, deactivate user, reset password, Mark CLOSED/ARCHIVED, unassign, delete category, post note (light) | T2 confirmation with one-sentence consequence | neutral, danger; focus on Cancel; with/without from→to diff | Uses UI-kit Modal; max 460 px wide | P0 |
| web-dialog-dispose-evidence | Modal pattern (proposal) | Evidence detail → Chain of custody (leads/admins) | T3 typed confirmation for DisposeEvidence; states nothing is deleted | empty, reason filled, label matched (enabled), submitting, error | Modal 520 px; danger button | P1 |
| web-toast | Feedback component (proposal) | Global, bottom-right | Success/info/error after actions; names the ledger op and actor | success, info, warning, error; with/without action link; reduced-motion variant | 360 px wide, SVG icons, `role=status/alert` | P0 |
| web-banner-integrity-verified | Status banner | Ingest result | End-to-end hash match | default | Full card width, icon + label | P0 |
| web-banner-integrity-mismatch | Status banner | Ingest result | Server proof ≠ local hash; must interrupt | default (danger) | Full card width, icon + label + next step | P0 |
| web-progress-hash | Progress component | Ingest step 3 "File & hash" | Local hashing % | 0–99 %, done, failed | Bar + % text, `role=progressbar` | P0 |
| web-progress-upload | Progress component (proposal) | Ingest step 4 submit | Upload bytes + % for large files | uploading, server-processing, done, error | Bar + text | P1 |
| web-state-loading-skeleton | Loading pattern (proposal) | Case list, case detail, evidence detail, trail, report, lead dashboard | Content-shaped placeholders instead of "Loading…" text | table, card, timeline, kv-list; static (reduced motion) | CSS/SVG | P1 |
| web-empty-cases | Empty-state illustration | My cases | "No cases yet. A lead or admin grants case access." | with/without "New case" CTA | 160 px, SVG, 2 tones | P1 |
| web-empty-evidence | Empty-state illustration | Case detail → Evidence, "No evidence in this case." (report) | Nothing assigned yet | no evidence / no filter match | 160 px, SVG | P1 |
| web-empty-trail | Empty-state illustration | "No audit events." | Trail empty (e.g. not yet anchored) | default | 120 px, SVG | P2 |
| web-empty-search | Empty-state illustration | Search "No evidence matched." / "No cases matched." | No results | evidence, cases | 120 px, SVG | P2 |
| web-empty-activity | Empty-state illustration | Case activity, lead "Recent team activity", "Nothing awaiting review." | Quiet state | activity, flagged | 120 px, SVG | P2 |
| web-state-error-inline | Error component | Every `.err` site, login errors | Icon + message + next step; `role=alert` | field-level, section-level, page-level | Component spec | P0 |
| web-state-rate-limited | Error state | Evidence detail, report (429) | "Too many evidence reads — slow down" with wait time | counting down, ready | Inline banner | P1 |
| web-state-session-ended | Banner (proposal) | Login page after a 401 | Explains why the user was signed out | expired, deactivated | Login card banner | P1 |
| web-page-unauthorized | Page illustration | `/unauthorized` | Role-gated route refused | default | 240 px SVG | P2 |
| web-page-not-found | Page illustration | `*` route | Unknown route | default | 240 px SVG | P2 |
| web-skip-link | A11y component (proposal) | First tab stop in the app shell | Skip to main content | hidden, focused | Text link, focus-visible only | P0 |
| web-table-card-collapse | Responsive pattern | All `table.runs` tables < 768 px | Table rows become cards on small screens | card, card-with-status, card-clickable | Component spec | P1 |
| web-print-report-header | Print asset | CoC report, every printed page | Case name/id, generated UTC timestamp | first page (full), continuation (compact) | A4/Letter, greyscale, CSS | P0 |
| web-print-report-footer | Print asset | CoC report, every printed page | Page x of y, generated timestamp, auto-log footnote | default | A4/Letter, greyscale | P0 |
| web-print-signature-block | Print asset (proposal) | CoC report last page | Examiner attestation lines | empty lines, pre-filled name/role | A4 width, greyscale | P2 |
| sys-focus-ring | A11y token spec | Both UIs, every interactive element | Visible keyboard focus | on light, on dark, on danger button; ttk variant | 2 px `--color-focus-ring` + 2 px offset; ttk hex equivalent | P0 |
| sys-status-pairs | Icon + label set | Both UIs (trail, pills, badges, regimes, run status, sweeps status) | Guarantees status is never colour-only (§8.7.5) | every status in §8.7.5 | 12/16 px SVG + tkinter PNG at 16/20/24 px | P0 |
| sys-motion-spec | Motion spec | Web toasts, skeletons, progress bars | Durations/easing + reduced-motion fallbacks | normal, reduced | Spec page | P1 |
| sys-journey-map-web | UX documentation | Handed to authors / thesis appendix | J-W1…J-W5 flows as diagrams, with auto-log points marked | investigator, lead, admin | SVG/PDF, A4 landscape | P2 |
| sys-journey-map-desktop | UX documentation | Handed to authors | J-D1…J-D4 campaign flow with destructive gates marked | campaign, cancel/resume, backup/restore | SVG/PDF, A4 landscape | P2 |
| desk-dialog-confirm-run | Dialog layout | "Run…"/"Resume…" confirm ("Run *exp*?") | Plan + ledger-reset consequence + backup path + baselines + skip-backup option | reset, reuse-ledger, uncommitted-sweeps warning, skip-backup visible | tkinter Toplevel, ~900 × 600 px, warning icon 24 px PNG | P0 |
| desk-dialog-restore | Dialog layout | "Restore my test data…" | Choose a backup; state that everything since that date is replaced | list, selected-summary, no backups, restoring (non-cancellable) | Toplevel ~760 × 480 px | P0 |
| desk-dialog-use-baseline | Dialog layout | "Use N tx/s as baseline…", "Use N as baseline batch size…", "Use C / max M as baselines…", "Use trimmed grid…" | Old → new value, provenance tag to be written, "never optimal" wording | single value, pair (channels/max), grid | Toplevel ~520 × 280 px | P1 |
| desk-progress-run | Progress component | Run panel (overall + round bars, text lines) | Run i/n, % done, elapsed, ETA; round j/m, Caliper counts | idle, preview, backup, running, cancelling, force-stop, restore, done, failed | ttk.Progressbar style + 16 px state icons | P0 |
| desk-status-bar | Status component | Top bar | sweeps.yaml committed/UNCOMMITTED, unsaved count, "ledger holds" | clean ✓, dirty ⚠, unsaved, ledger=test data / benchmark | Label with 16 px icons | P0 |
| desk-banner-placeholder-baseline | Warning banner | E3 main (and E1/E2 "held fixed" boxes) | A baseline is still PLACEHOLDER | warning, blocking (proposal) | Full tab width, icon + text | P0 |
| desk-toggle-reuse-ledger | Control + warning | Custom test "reuse the running ledger" | Makes clear that benchmark tx will mix into the test ledger | off, on (warning shown) | Checkbutton + 16 px warning icon | P1 |
| desk-empty-suggestion | Empty state | E0/E1/E2 suggestion tables | "Run the ramp/E1/E2 to get a suggestion" | per experiment | Text + 32 px icon PNG | P1 |
| desk-empty-history | Empty state | History & results | No runs yet / no runs for the filter | all, filtered | Text + 32 px icon PNG | P2 |
| desk-notify-finished | Notification (proposal) | End of Run / failure | Taskbar flash + Windows notification for long unattended campaigns | complete, failed, needs attention | Windows toast, app icon 256 px ICO | P1 |
| desk-campaign-strip | Progress strip (proposal) | Above the notebook | Shows E0 → ramp → E1 → E2 → E3 with which baselines are accepted | per step: not run, run, baseline accepted, placeholder | Horizontal strip, 20 px icons | P1 |

---

### Open questions for the authors

1. **CoC report CSV double-logging:** "Download CSV" re-calls `/coc-report`, which writes a *second* `ACCESS(coc-report)` per exhibit. Keep it (and label it), or should the CSV come from the report already loaded?
2. **Page-load `view` warning:** should opening Evidence detail show the notice *after* the fact (proposed), or should links to Evidence detail warn *before* navigation (heavier, but more honest)?
3. **Dispose UI:** should the web app expose DisposeEvidence at all (the API has it, no page uses it)? If so, who may do it: case lead, admin, or both?
4. **Transfer custody confirmation:** is a T2 confirm acceptable, or is transfer frequent enough in the demo that it would get in the way?
5. **Lead roster role `<select>`:** switch to explicit "Apply" (proposed) or keep instant apply with a confirm?
6. **Court report:** add an examiner signature/attestation block? Which paper size is standard for your examiners: A4 or Letter?
7. **Seizure time:** should examiners enter it in local time (WIB) with UTC conversion shown, or directly in UTC?
8. **Restore:** should "Restore my test data…" first take an automatic backup of the current state, so a restore itself can be undone?
9. **E3 gate:** block Run… while any baseline is a PLACEHOLDER, or only warn (current)?
10. **Desktop notifications:** are Windows notifications / taskbar flash acceptable on the lab laptop during long campaigns?
11. **Responsive scope:** is tablet/phone reading of trails a real use case, or can the web app declare a 1024 px minimum?
12. **Toasts vs inline:** do you want toasts at all, or only inline confirmations next to the action (fewer moving parts)?

### Checklist

- [ ] web-icon-auto-logged — icon on every control that writes an on-chain ACCESS event
- [ ] web-notice-auto-logged — inline/banner notice that a read writes to the audit trail
- [ ] web-dialog-confirm-destructive — T2 consequence confirm modal pattern
- [ ] web-dialog-dispose-evidence — T3 typed confirm for DisposeEvidence (proposal)
- [ ] web-toast — success/info/error toasts naming op and actor (proposal)
- [ ] web-banner-integrity-verified — ingest end-to-end hash match banner
- [ ] web-banner-integrity-mismatch — ingest hash mismatch banner
- [ ] web-progress-hash — local hashing progress bar
- [ ] web-progress-upload — upload progress bar (proposal)
- [ ] web-state-loading-skeleton — content-shaped loading placeholders (proposal)
- [ ] web-empty-cases — My cases empty state
- [ ] web-empty-evidence — case/report no-evidence empty state
- [ ] web-empty-trail — "No audit events." empty state
- [ ] web-empty-search — search no-results empty state
- [ ] web-empty-activity — activity / flagged empty state
- [ ] web-state-error-inline — icon + message + next-step error block
- [ ] web-state-rate-limited — 429 auto-log rate-limit state
- [ ] web-state-session-ended — signed-out explanation banner (proposal)
- [ ] web-page-unauthorized — `/unauthorized` illustration
- [ ] web-page-not-found — 404 route illustration
- [ ] web-skip-link — skip to main content (proposal)
- [ ] web-table-card-collapse — tables become cards below 768 px
- [ ] web-print-report-header — CoC report print header
- [ ] web-print-report-footer — CoC report print footer with page x of y
- [ ] web-print-signature-block — examiner attestation block (proposal)
- [ ] sys-focus-ring — visible focus indicator spec for both UIs
- [ ] sys-status-pairs — icon + label pairs so status is never colour-only
- [ ] sys-motion-spec — motion and reduced-motion spec
- [ ] sys-journey-map-web — web journey diagrams with auto-log points
- [ ] sys-journey-map-desktop — desktop campaign diagram with destructive gates
- [ ] desk-dialog-confirm-run — Run/Resume confirm dialog with ledger-reset consequence
- [ ] desk-dialog-restore — Restore my test data dialog
- [ ] desk-dialog-use-baseline — Use as baseline confirm dialog
- [ ] desk-progress-run — Run panel progress, ETA and state icons
- [ ] desk-status-bar — sweeps.yaml / unsaved / ledger-holds status line
- [ ] desk-banner-placeholder-baseline — PLACEHOLDER baseline warning
- [ ] desk-toggle-reuse-ledger — reuse-the-running-ledger control with warning
- [ ] desk-empty-suggestion — empty suggestion table state
- [ ] desk-empty-history — empty History state
- [ ] desk-notify-finished — end-of-run Windows notification (proposal)
- [ ] desk-campaign-strip — E0→E3 campaign progress strip (proposal)

---

## Master deliverables checklist

498 items across all sections (P0 = must-have, P1 = should, P2 = nice-to-have).


### 1. Product context, users & hard rules

- [ ] sys-tokens-json — source-of-truth design tokens (dark, light, print) for web, desktop and figures
- [ ] sys-tokens-css — CSS custom-property build of the tokens, self-hosted and CSP-safe, replacing the hard-coded `:root` values
- [ ] sys-terminology-sheet — one-page do/don't list of the binding terminology rules
- [ ] sys-data-format-spec — specimen sheet for timestamps, units, mean ± SD, avg (min–max) latency, failure counts/rate, hashes
- [ ] sys-a11y-contrast-report — contrast and greyscale/colour-blind check of every token pair and the variant palette
- [ ] sys-delivery-manifest — `MANIFEST.md` mapping every delivered file to its ID, priority and status (proposal)
- [ ] brand-metaphor-moodboard — 2–3 directions testing the Gleipnir fetter metaphor against the forensic tone

### 2. Design system foundations (shared)

- [ ] sys-color-palette-sheet — Board of every colour token with hex and contrast ratio, in light, dark and print.
- [ ] sys-contrast-audit — Table of every fg/bg pair with its ratio, including the desktop `#F0F0F0` background.
- [ ] sys-tokens-json — W3C DTCG `tokens.json`: the single source of truth, including variant marker, line, hatch and label.
- [ ] sys-tokens-css — Web `tokens.css` with custom properties, `@font-face`, print overrides and legacy aliases.
- [ ] sys-tokens-css-dark — Opt-in dark theme blocks built from the current dark palette.
- [ ] sys-ttk-style-map — Named ttk styles and Tk font map replacing the desktop colour literals (`#777` fails AA).
- [ ] sys-legacy-token-map — Table mapping each current literal or variable to its new token, for the migration.
- [ ] sys-font-web-bundle — Self-hosted Inter + JetBrains Mono `woff2` with OFL licences, CSP-safe.
- [ ] sys-font-desktop-bundle — Optional private Tk font registration for parity (P2).
- [ ] sys-type-scale-sheet — Type ramp for web, desktop Tk, charts and print.
- [ ] sys-spacing-radius-sheet — 4 px spacing scale, control heights, radii.
- [ ] sys-elevation-sheet — `--shadow-0..3` with the border-only desktop and print equivalents.
- [ ] sys-state-matrix — All interaction states for every control type, on web light, web dark and desktop vista.
- [ ] sys-focus-ring-spec — 2 px `--color-focus-ring` with 2 px offset and halo, on every surface.
- [ ] sys-icon-grid-template — 16/20/24 keylines, live areas and stroke rules.
- [ ] sys-icon-help — Circled black "?" in rest and hover/focus states; SVG for web, PNG at three densities for desktop.
- [ ] sys-tooltip-style — Shared `#FFFFE8` tooltip for desktop `Tip` and web help.
- [ ] sys-spinner — Loading glyph with a reduced-motion static variant.
- [ ] sys-pattern-subfloor-hatch — 45° hatch cue for the sub-floor regime.
- [ ] sys-regime-swatches — smoke (dashed outline), steady (solid dark), sub-floor (amber and hatch) looks.
- [ ] sys-run-status-swatches — complete, failed and running looks, plus the queued and cancelled proposals.
- [ ] sys-status-glyph-set — check, x, warning, info, clock and stop glyphs, in semantic colours.
- [ ] viz-variant-key-standard — `#0072B2`, filled circle, solid line.
- [ ] viz-variant-key-anchoring — `#E69F00` / `#B07A00`, hollow square, dashed line.
- [ ] viz-variant-key-parallel — `#009E73`, filled triangle, dotted line.
- [ ] viz-variant-key-parallel-anchored — `#CC79A7` / `#B35C8E`, hollow diamond, dash-dot line.
- [ ] viz-variant-marker-set — Stand-alone variant markers for desktop checkboxes, tables and badges.
- [ ] viz-bar-hatch-set — Per-variant bar hatches (none, `//`, `..`, `xx`).
- [ ] viz-mpl-style — `gleipnir.mplstyle` + the name-keyed `VARIANT_STYLE` for `report.py`.
- [ ] viz-reference-line-spec — Styling for the `y = x (send rate)` line, saturation markers, E1 "(reference)" lines and ± SD error bars.
- [ ] viz-grayscale-proof — Grayscale and colour-blindness proof that the four variants stay distinguishable.
- [ ] sys-motion-spec — Motion durations and easing, reduced-motion rules, and the no-motion rule for desktop.

### 3. Brand assets

- [ ] brand-concept-board — three directions (Silk Fetter, Custody Link, Merkle Seal) at 256/32/16 px, dark/light/mono
- [ ] brand-mark — primary mark, SVG master + PNG exports, full colour and `currentColor`
- [ ] brand-mark-16 — hand-hinted 16/24 px masters for favicon and title bar
- [ ] brand-mark-mono-black — one-colour black silhouette for print
- [ ] brand-mark-reversed — one-colour white silhouette for dark grounds
- [ ] brand-wordmark — outlined, tracked "GLEIPNIR" in all colour versions
- [ ] brand-lockup-horizontal — mark + wordmark for the top bar, report header and README
- [ ] brand-lockup-horizontal-descriptor — lockup + "evidence library" / "Bench"
- [ ] brand-lockup-stacked — centred lockup for the login page, splash and social card
- [ ] brand-clearspace-guide — minimum sizes, clear space and misuse sheet
- [ ] brand-favicon-svg — `/favicon.svg` with a dark-chrome media query
- [ ] brand-favicon-ico — `/favicon.ico` with frames 16/32/48
- [ ] brand-apple-touch-icon — 180 px opaque PNG
- [ ] brand-pwa-icon-192 — PWA icon (proposal, P2)
- [ ] brand-pwa-icon-512 — PWA icon (proposal, P2)
- [ ] brand-pwa-icon-512-maskable — maskable PWA icon (proposal, P2)
- [ ] brand-webmanifest — `site.webmanifest` (proposal, P2)
- [ ] desk-app-icon-ico — Bench ICO with frames 16/20/24/32/40/48/64/256
- [ ] desk-app-icon-png — Bench PNGs 256/48/32/16 for `iconphoto`
- [ ] desk-badge-bench — three-bar modifier for Bench icon frames of 32 px and up
- [ ] brand-print-header — monochrome report header lockup (proposal)
- [ ] brand-print-seal — 20 mm black seal for the Chain-of-Custody Report
- [ ] desk-about-dialog-art — Bench About dialog art (proposal, P2)
- [ ] desk-splash — Bench splash, only if start-up is slow (proposal, P2)
- [ ] brand-social-card — 1200×630 repo and defence card (proposal, P2)
- [ ] brand-readme-banner — README header banner (proposal, P2)
- [ ] brand-figure-watermark — decision recorded: not produced

### 4. Web app — layout, navigation & library screens

- [ ] web-topbar-brand-lockup: TopBar wordmark and mark lockup that links home
- [ ] web-login-backdrop: quiet fetter-motif backdrop behind the login card
- [ ] web-icon-nav-ingest: sidebar icon for "Ingest evidence"
- [ ] web-icon-nav-cases: sidebar icon for "My cases"
- [ ] web-icon-nav-search: sidebar icon for "Search"
- [ ] web-icon-nav-lead-dashboard: sidebar icon for Lead › "Dashboard"
- [ ] web-icon-nav-users: sidebar icon for Administration › "Users"
- [ ] web-icon-nav-case-admin: sidebar icon for Administration › "Case admin"
- [ ] web-icon-menu: hamburger that opens the nav drawer below 900 px
- [ ] web-icon-sidebar-collapse: collapse the sidebar to an icon rail
- [ ] web-icon-sign-out: sign-out action in the user menu
- [ ] web-icon-chevron-down: user-menu disclosure
- [ ] web-avatar-initials: initials avatar with deterministic colour and optional role ring
- [ ] web-icon-user: anonymous-person avatar fallback
- [ ] web-badge-role-admin: "System Administrator" global-role badge
- [ ] web-badge-role-lead: "Lead Investigator" global-role badge
- [ ] web-badge-role-investigator: "Investigator" global-role badge
- [ ] web-icon-role-admin: key glyph inside the admin badge
- [ ] web-icon-role-lead: star glyph inside the lead badge
- [ ] web-icon-role-investigator: magnifier-person glyph inside the investigator badge
- [ ] web-badge-case-role-viewer: "Viewer" case-role outline badge
- [ ] web-badge-case-role-contributor: "Contributor" case-role outline badge
- [ ] web-badge-case-role-lead: "Case Lead" case-role outline badge
- [ ] web-roles-legend: Viewer / Contributor / Case Lead rights legend in the Team section
- [ ] web-pill-case-status-open: OPEN case status pill
- [ ] web-pill-case-status-closed: CLOSED case status pill
- [ ] web-pill-case-status-archived: ARCHIVED case status pill (dashed)
- [ ] web-icon-status-open: non-colour glyph for OPEN
- [ ] web-icon-status-closed: non-colour glyph for CLOSED
- [ ] web-icon-status-archived: non-colour glyph for ARCHIVED
- [ ] web-pill-evidence-status-active: ACTIVE evidence status pill
- [ ] web-pill-evidence-status-disposed: DISPOSED evidence status pill (also legacy REMOVED)
- [ ] web-icon-status-disposed: non-colour glyph for DISPOSED (nothing deleted)
- [ ] web-badge-flag-high-priority: "High priority" flag badge
- [ ] web-badge-flag-processed: "Processed" flag badge
- [ ] web-badge-flag-needs-lead-review: "Needs lead review" flag badge
- [ ] web-icon-flag: flag concept icon (filter, badges, FLAG_CHANGED)
- [ ] web-icon-note: examiner-note concept icon (NOTE_ADDED, roster count)
- [ ] web-chip-category: category chip in default, selected, add, removable, compact and tile forms
- [ ] web-icon-cat-image: Image preset category icon
- [ ] web-icon-cat-video: Video preset category icon
- [ ] web-icon-cat-audio: Audio preset category icon
- [ ] web-icon-cat-text: Text preset category icon
- [ ] web-icon-cat-document: Document preset category icon
- [ ] web-icon-cat-pdf: PDF preset category icon
- [ ] web-icon-cat-spreadsheet: Spreadsheet preset category icon
- [ ] web-icon-cat-archive: Archive preset category icon
- [ ] web-icon-cat-other: Other preset category icon
- [ ] web-icon-cat-custom: tag icon for lead-defined custom categories
- [ ] web-icon-remove-chip: × on category chips (delete category)
- [ ] web-icon-add: add / create action
- [ ] web-icon-edit: edit action and EVIDENCE_DETAILS_UPDATED marker
- [ ] web-icon-close: close / clear / dismiss
- [ ] web-icon-copy: copy ids, proofs and txIds to the clipboard
- [ ] web-icon-search: search fields and buttons
- [ ] web-icon-filter: filter action and "filters applied" state
- [ ] web-icon-sort: unsorted sortable column header
- [ ] web-icon-sort-asc: ascending sort indicator
- [ ] web-icon-sort-desc: descending sort indicator
- [ ] web-icon-chevron-right: table-row "opens detail" affordance
- [ ] web-icon-chevron-disclosure: Categories / Team expand-collapse toggle
- [ ] web-icon-arrow-right: "Open evidence detail →"
- [ ] web-icon-arrow-left: "Back to my cases"
- [ ] web-icon-report: "CoC report (print / CSV)" button icon
- [ ] web-icon-export-csv: "Export CSV ({n})" button icon
- [ ] web-icon-user-add: "Add participant" and PARTICIPANT_ADDED marker
- [ ] web-icon-remove-user: team "Remove" and PARTICIPANT_REMOVED marker
- [ ] web-icon-eye: show-password toggle
- [ ] web-icon-eye-off: hide-password toggle
- [ ] web-icon-alert: error status icon and Stepper error dot
- [ ] web-icon-alert-triangle: warning and destructive-confirm icon
- [ ] web-icon-info: info alerts and Ingest hints
- [ ] web-icon-check: Stepper done dot and copied state
- [ ] web-icon-check-circle: success alerts and toasts
- [ ] web-icon-clock: throttle, session-ended and batched-write-path cue
- [ ] web-icon-offline: gateway-unreachable login error
- [ ] web-icon-location: acquisition-location field cue
- [ ] web-icon-fingerprint: local SHA-256 / hash cue
- [ ] web-icon-shield-check: integrity-verified glyph
- [ ] web-icon-shield-alert: integrity-mismatch glyph
- [ ] web-icon-shield-gateway: footer "talks only to the API gateway" glyph
- [ ] web-badge-integrity-verified: "integrity verified end-to-end" badge
- [ ] web-badge-integrity-mismatch: "INTEGRITY MISMATCH" badge
- [ ] web-badge-integrity-unverified: "not verified locally" badge
- [ ] web-badge-write-path-batched: "batched (anchoring) — commits at the batch boundary" badge
- [ ] web-badge-uncategorized: "uncategorized" (no case) badge
- [ ] web-count-badge: numeric count pill for tabs and nav
- [ ] web-tabs: Case detail tab-strip styling
- [ ] web-icon-tab-overview: Overview tab icon
- [ ] web-icon-tab-evidence: Evidence tab icon
- [ ] web-icon-tab-activity: Activity tab icon
- [ ] web-stepper-dot: Ingest step marker (upcoming, active, done, error)
- [ ] web-icon-step-case: step 1 "Case & category" icon
- [ ] web-icon-step-metadata: step 2 "Metadata" icon
- [ ] web-icon-step-file-hash: step 3 "File & hash" icon
- [ ] web-icon-step-review: step 4 "Review & submit" icon
- [ ] web-upload-dropzone: drag-and-drop file area for Ingest step 3
- [ ] web-illus-dropzone: art inside the upload dropzone
- [ ] web-progress-bar: "Hashing locally… {pct}%" determinate bar
- [ ] web-illus-ingest-success: "Ingested ✓" confirmation illustration
- [ ] web-illus-empty-cases: My cases empty-state illustration
- [ ] web-illus-empty-evidence: Case evidence-roster empty-state illustration
- [ ] web-illus-empty-activity: Case activity empty-state illustration
- [ ] web-illus-no-results: filtered / search no-results illustration
- [ ] web-illus-search-idle: Search pre-query illustration
- [ ] web-illus-not-found: "Page not found" illustration
- [ ] web-illus-not-found-case: "Case not found — or you are not a participant." illustration
- [ ] web-illus-forbidden: "Not authorized" illustration
- [ ] web-alert-inline: inline alert in error, warning, info and success forms
- [ ] web-toast: transient confirmation toast
- [ ] web-modal-chrome: dialog overlay, panel and header with close
- [ ] web-modal-confirm: destructive-action confirm dialog
- [ ] web-spinner: 32 px blocking loader
- [ ] web-spinner-inline: 14 px in-button busy loader
- [ ] web-skeleton-row: table-row loading skeleton
- [ ] web-skeleton-case-header: Case header loading skeleton
- [ ] web-skeleton-timeline: Activity timeline loading skeleton
- [ ] web-icon-activity-case-created: CASE_CREATED timeline marker
- [ ] web-icon-activity-case-updated: CASE_UPDATED timeline marker
- [ ] web-icon-activity-role-changed: PARTICIPANT_ROLE_CHANGED timeline marker
- [ ] web-icon-activity-category: CATEGORY_CREATED / RENAMED / DELETED marker
- [ ] web-icon-activity-evidence-in: EVIDENCE_ADDED / EVIDENCE_ASSIGNED marker
- [ ] web-icon-activity-evidence-out: EVIDENCE_UNASSIGNED marker
- [ ] web-icon-activity-evidence-disposed: EVIDENCE_REMOVED (left the roster on DISPOSED) marker
- [ ] web-icon-activity-generic: fallback marker for unknown activity types

### 5. Web app — evidence, reports, lead & admin screens

- [ ] web-badge-merkle-na — Merkle N/A (Standard, Parallel; no receipts)
- [ ] web-badge-merkle-pending — verification in flight
- [ ] web-badge-merkle-notyet — not yet anchored, not a tamper signal
- [ ] web-badge-merkle-verified — root matches, latency in ms
- [ ] web-badge-merkle-mismatch — root mismatch, tamper signal
- [ ] web-icon-verify — Verify latest / per-event Verify
- [ ] web-popover-verify-steps — fetch/recompute/compare-root ms breakdown (proposal)
- [ ] web-chip-variant-indicator — active variant chip (proposal)
- [ ] web-badge-op-create — CREATE op badge
- [ ] web-badge-op-transfer — TRANSFER op badge
- [ ] web-badge-op-access — ACCESS op badge
- [ ] web-badge-op-dispose — DISPOSE op badge
- [ ] web-badge-op-legacy-removed — legacy REMOVE shown as DISPOSE (proposal)
- [ ] web-marker-op-create — timeline marker replacing "+"
- [ ] web-marker-op-transfer — timeline marker replacing "⇄"
- [ ] web-marker-op-access — timeline marker replacing "◉"
- [ ] web-marker-op-dispose — timeline marker replacing "×"
- [ ] web-icon-access-view — ACCESS sub-type view (proposal)
- [ ] web-icon-access-download — ACCESS sub-type download (proposal)
- [ ] web-icon-access-export — ACCESS sub-type export (proposal)
- [ ] web-icon-access-report — ACCESS sub-type coc-report (proposal)
- [ ] web-toggle-collapse-access — group repeated ACCESS(view) rows (proposal)
- [ ] web-badge-status-active — evidence ACTIVE
- [ ] web-badge-status-disposed — evidence DISPOSED (retained, neutral tone)
- [ ] web-badge-status-removed-legacy — legacy REMOVED status
- [ ] web-banner-disposed — disposed explanation banner (proposal)
- [ ] web-watermark-disposed — printable disposed watermark (proposal)
- [ ] web-icon-dispose — sealed archive box, never a trash can (proposal)
- [ ] web-modal-dispose-confirm — DisposeEvidence confirm with reason (proposal)
- [ ] web-badge-flag-high-priority — High priority flag
- [ ] web-badge-flag-needs-review — Needs lead review flag
- [ ] web-badge-flag-processed — Processed flag
- [ ] web-icon-flag-high-priority — flag glyph
- [ ] web-icon-flag-needs-review — flag glyph
- [ ] web-icon-flag-processed — flag glyph
- [ ] web-chip-flag — single-select flag toggle chip
- [ ] web-filetype-disk-image — .dd/.img/.raw/.e01
- [ ] web-filetype-memory-dump — .mem/.dmp/.vmem
- [ ] web-filetype-binary — .bin/.exe/.elf
- [ ] web-filetype-pcap — .pcap/.pcapng
- [ ] web-filetype-text — .txt/.log
- [ ] web-filetype-pdf — .pdf
- [ ] web-filetype-image — .png/.jpg/…
- [ ] web-filetype-audio — .wav/…
- [ ] web-filetype-video — .mp4/…
- [ ] web-filetype-csv — .csv
- [ ] web-filetype-archive — .zip/.7z/.tar/.gz
- [ ] web-filetype-docx — .docx/.doc, no vendor logo
- [ ] web-filetype-json — .json
- [ ] web-filetype-xml — .xml
- [ ] web-filetype-email — .eml/.msg
- [ ] web-filetype-html — .html (source only)
- [ ] web-filetype-unknown — fallback
- [ ] web-icon-preview — opt-in Load preview
- [ ] web-badge-sandboxed — PDF sandbox indicator
- [ ] web-preview-frame — preview chrome per kind + 64 KiB truncation banner
- [ ] web-preview-poster-video — video poster (proposal)
- [ ] web-preview-poster-audio — audio waveform placeholder (proposal)
- [ ] web-empty-preview-unsupported — no inline preview state (proposal)
- [ ] web-icon-download — Download
- [ ] web-icon-export — Export (record + trail)
- [ ] web-icon-report — CoC report link
- [ ] web-icon-transfer — Transfer custody
- [ ] web-icon-access-log — Log manual access
- [ ] web-icon-note — Examiner notes
- [ ] web-icon-lock — restricted / self-locked
- [ ] web-icon-copy — copy ID/hash (proposal)
- [ ] web-icon-hash — ni-URI marker
- [ ] web-icon-anchor — anchor tx_hash marker
- [ ] web-card-evidence — Codex-Entry-style evidence card
- [ ] web-toast-event-written — write confirmation toast (proposal)
- [ ] web-sessiontrail-card — "Events this session" sub-card
- [ ] web-skeleton-evidence-detail — loading skeleton (proposal)
- [ ] web-illus-evidence-not-found — 404 illustration
- [ ] web-illus-no-access — 403 illustration
- [ ] web-empty-no-audit-events — empty trail
- [ ] web-empty-no-notes — empty notes
- [ ] brand-report-letterhead — report letterhead (proposal)
- [ ] brand-seal-mark — decorative custody seal (proposal)
- [ ] web-report-summary-table — exhibit summary table (proposal)
- [ ] web-report-trail-table — print trail table (proposal)
- [ ] web-report-hash-box — integrity-proof box (proposal)
- [ ] web-report-attestation-block — attestation + signatures (proposal)
- [ ] web-report-page-footer — page n of N + case + generated ts (proposal)
- [ ] web-report-paper-preview — on-screen A4 sheet (proposal)
- [ ] web-icon-print — Print / save as PDF
- [ ] web-icon-csv — Download CSV
- [ ] web-icon-back — back to case
- [ ] web-skeleton-report — report loading (proposal)
- [ ] web-kpi-tile — lead KPI tile (proposal)
- [ ] web-icon-activity-case-created — CASE_CREATED
- [ ] web-icon-activity-case-updated — CASE_UPDATED
- [ ] web-icon-activity-participant-added — PARTICIPANT_ADDED
- [ ] web-icon-activity-participant-removed — PARTICIPANT_REMOVED
- [ ] web-icon-activity-role-changed — PARTICIPANT_ROLE_CHANGED
- [ ] web-icon-activity-category — CATEGORY_* events
- [ ] web-icon-activity-evidence-added — EVIDENCE_ADDED
- [ ] web-icon-activity-evidence-assigned — EVIDENCE_ASSIGNED/UNASSIGNED
- [ ] web-icon-activity-evidence-removed — EVIDENCE_REMOVED (off-chain index)
- [ ] web-icon-activity-details-updated — EVIDENCE_DETAILS_UPDATED
- [ ] web-icon-activity-flag-changed — FLAG_CHANGED
- [ ] web-icon-activity-note-added — NOTE_ADDED
- [ ] web-icon-activity-generic — unknown activity types
- [ ] web-avatar-initial — initial avatar (proposal)
- [ ] web-icon-add-member — add participant
- [ ] web-icon-remove-member — remove participant
- [ ] web-popover-confirm-remove — removal confirm (proposal)
- [ ] web-modal-add-member — lead Add member modal
- [ ] web-empty-no-led-cases — no led cases
- [ ] web-empty-no-flagged — nothing awaiting review
- [ ] web-empty-no-activity — no recent activity
- [ ] web-badge-role-admin — System Administrator
- [ ] web-badge-role-lead — Lead Investigator
- [ ] web-badge-role-investigator — Investigator
- [ ] web-badge-caserole-lead — Case Lead
- [ ] web-badge-caserole-contributor — Contributor
- [ ] web-badge-caserole-viewer — Viewer
- [ ] web-badge-user-active — account active
- [ ] web-badge-user-inactive — account deactivated (neutral)
- [ ] web-icon-user-add — New user
- [ ] web-icon-key-reset — Reset password…
- [ ] web-icon-deactivate — Deactivate / Reactivate
- [ ] web-icon-eye — show password
- [ ] web-icon-eye-off — hide password
- [ ] web-modal-create-user — Create user modal
- [ ] web-modal-edit-user — Edit user modal
- [ ] web-modal-reset-password — dedicated reset modal (proposal)
- [ ] web-modal-deactivate-confirm — deactivation confirm (proposal)
- [ ] web-empty-no-users — only-admin empty state
- [ ] web-badge-case-open — case OPEN
- [ ] web-badge-case-closed — case CLOSED
- [ ] web-badge-case-archived — case ARCHIVED
- [ ] web-control-case-status — status segmented control (proposal)
- [ ] web-modal-case-status-confirm — archive confirm (proposal)
- [ ] web-icon-case-create — Create case
- [ ] web-icon-assign — Assign to case
- [ ] web-icon-unassign — Unassign
- [ ] web-picker-user — shared user picker (proposal)
- [ ] web-picker-evidence — uncategorized evidence picker (proposal)
- [ ] web-empty-select-case — Cases admin empty right column
- [ ] web-icon-close — modal close
- [ ] web-icon-alert — error line marker (proposal)
- [ ] web-icon-info — hint line marker (proposal)

### 6. Desktop app (GLEIPNIR Bench)

- [ ] desk-app-icon — multi-resolution .ico + PNG set replacing the Tk feather
- [ ] desk-tab-settings — tab icon, Settings & Baselines (proposal)
- [ ] desk-tab-e0 — tab icon, E0 initial test (proposal)
- [ ] desk-tab-e1 — tab icon, E1 batch size (proposal)
- [ ] desk-tab-e2 — tab icon, E2 channels (proposal)
- [ ] desk-tab-e3 — tab icon, E3 main (proposal)
- [ ] desk-tab-custom — tab icon, Custom test (proposal)
- [ ] desk-tab-history — tab icon, History & results (proposal)
- [ ] desk-tab-per-round — inner tab icon, per-round results (proposal)
- [ ] desk-tab-charts — inner tab icon, charts (proposal)
- [ ] desk-icon-preview — Preview plan (dry-run) button icon
- [ ] desk-icon-run — Run… / Start button icon
- [ ] desk-icon-resume — Resume… button icon
- [ ] desk-icon-cancel — Cancel button icon
- [ ] desk-icon-force-stop — Force stop (SIGKILL) button icon
- [ ] desk-icon-save — Save changes button icon
- [ ] desk-icon-revert — Revert (reload file) button icon
- [ ] desk-icon-backup — Back up now button icon
- [ ] desk-icon-restore — Restore my test data… button icon
- [ ] desk-icon-export-csv — Export per-round CSV… button icon
- [ ] desk-icon-export-tables — Export summary tables… button icon
- [ ] desk-icon-generate-charts — Generate tables + charts button icon
- [ ] desk-icon-open-folder — Open results folder button icon
- [ ] desk-icon-refresh — History Refresh button icon
- [ ] desk-icon-use-baseline — Use … as baseline… button icon
- [ ] desk-icon-use-trimmed-grid — Use trimmed grid as send-rate grid… button icon
- [ ] desk-icon-suggestion — suggestion panel title glyph (proposal)
- [ ] desk-icon-warning — warning glyph replacing ⚠ and !
- [ ] desk-icon-log — show raw log toggle icon (proposal)
- [ ] desk-icon-verbose — verbose Caliper output toggle icon (proposal)
- [ ] desk-status-committed — sweeps.yaml committed
- [ ] desk-status-uncommitted — sweeps.yaml has uncommitted changes
- [ ] desk-status-unsaved — N unsaved input changes
- [ ] desk-status-saved — no unsaved changes
- [ ] desk-status-invalid-input — an input does not parse
- [ ] desk-status-ledger-test-data — ledger holds manual-test data
- [ ] desk-status-ledger-benchmark — ledger holds benchmark data
- [ ] desk-status-placeholder — baseline still PLACEHOLDER
- [ ] desk-status-set-from — baseline set from an experiment
- [ ] desk-status-set-by-hand — baseline set by hand
- [ ] desk-status-readonly — read-only "held fixed" value glyph (proposal)
- [ ] desk-status-idle — Run panel idle (proposal)
- [ ] desk-status-run-running — experiment running (static + optional animation frames)
- [ ] desk-status-run-complete — run complete
- [ ] desk-status-run-failed — run failed or cancelled
- [ ] desk-status-cancelling — SIGINT sent, waiting (proposal)
- [ ] desk-status-backup-running — backup in progress (proposal)
- [ ] desk-status-restore-running — restore in progress (proposal)
- [ ] desk-status-stack-restarting — stack coming back up (proposal)
- [ ] desk-status-keep-awake — laptop kept awake during a run (proposal)
- [ ] desk-regime-smoke — smoke regime pill
- [ ] desk-regime-steady — steady regime pill
- [ ] desk-regime-sub-floor — sub-floor regime pill
- [ ] desk-mark-yes — qualifies / healthy mark
- [ ] desk-mark-no — unhealthy mark
- [ ] desk-variant-standard — Standard marker (circle)
- [ ] desk-variant-anchoring — Anchoring marker (diamond)
- [ ] desk-variant-parallel — Parallel marker (two bars)
- [ ] desk-variant-parallel-anchored — Parallel-Anchored marker (bars + diamond)
- [ ] desk-variant-reference-line — E1 reference-line marker
- [ ] desk-badge-probe — Custom test "probe" badge (proposal)
- [ ] desk-step-indicator — E0 → E1 → E2 → E3 progress indicator (proposal)
- [ ] desk-help-icon — circled "?" hover-help icon (Canvas spec + PNG)
- [ ] desk-tooltip-style — tooltip style spec
- [ ] desk-progress-style — progress bar style spec (vista / clam skin)
- [ ] desk-table-style — Treeview zebra / alignment / row-tint spec
- [ ] desk-log-style — raw log / plan text style spec
- [ ] desk-suggestion-panel-style — suggestion panel framing spec
- [ ] desk-banner-placeholder — E3 placeholder-baselines banner spec
- [ ] desk-dialog-confirm-run — confirm run dialog spec
- [ ] desk-dialog-restore-picker — restore picker dialog spec
- [ ] desk-dialog-plan-preview — plan preview dialog spec
- [ ] desk-empty-no-results — no results empty-state art
- [ ] desk-empty-no-chart — no charts empty-state art
- [ ] desk-empty-no-backups — no backups empty-state art
- [ ] viz-bench-chart-theme — matplotlib chart theme for History charts and docs/results PNGs

### 7. Data visualisation (tables & charts for the thesis)

- [ ] viz-style-base — shared matplotlib rcParams (serif, y-grid, frameless legend, TrueType 42, deterministic SVG)
- [ ] viz-style-thesis — `thesis-full` 5.5 × 3.4 in and `thesis-half` 2.7 × 2.2 in presets, PDF/SVG/PNG 300 dpi
- [ ] viz-style-paper — `paper-column` 3.5 × 2.4 in and `paper-full` 7.16 × 2.6 in presets
- [ ] viz-style-screen — 6.4 × 4.2 in at 130 dpi PNG for the desktop charts tab, with title
- [ ] viz-variant-encoding — colour token + marker + fill + line style per variant; display names; no reliance on the colour cycle
- [ ] viz-chart-line — one-metric-per-chart line template, y from 0, ticks on grid levels
- [ ] viz-legend-variant — frameless legend above the plot area in fixed variant order
- [ ] viz-legend-strip — standalone shared legend for multi-panel pages (proposal)
- [ ] viz-errorbar-sd — ±1 SD error bars over repetitions, no bar when n < 2
- [ ] viz-dodge-offset — point-based horizontal offset for overlapping series (proposal)
- [ ] viz-refline-e1 — Standard and Parallel reference lines on E1 charts, variant-styled, labelled inline
- [ ] viz-refline-identity — E3a y = x line on the throughput chart
- [ ] viz-refline-threshold — E3a y = 0.9 × send rate saturation threshold line (proposal)
- [ ] viz-marker-saturation — dotted vertical saturation line per variant on E3a charts
- [ ] viz-marker-latency-knee — p95 knee caret on the E3a latency p95 chart (proposal)
- [ ] viz-band-e2-healthy — E2 healthy range band plus baseline (median) and `channels_max` markers (proposal)
- [ ] viz-refline-cpu-budget — E2 CPU budget line at 0.9 × cores × 100 % (proposal)
- [ ] viz-marker-e1-baseline — confirmed baseline batch size and audit-bound lines on E1 (proposal)
- [ ] viz-watermark-regime — SMOKE / SUB-FLOOR watermark for non-steady data (proposal)
- [ ] viz-figset-e1 — 10 E1 metric charts (Anchoring, Parallel-Anchored + references)
- [ ] viz-figset-e2 — E2 metric charts (Parallel)
- [ ] viz-figset-e3a — 10 E3a metric charts, all four variants, saturation overlays
- [ ] viz-figset-e3b — 10 E3b metric charts, all four variants
- [ ] viz-fig-ops-bars — grouped bar charts per operation type, writes and reads separate (proposal)
- [ ] viz-fig-panel-pair — two-panel, one-metric-per-axes paper figure (proposal)
- [ ] viz-caption-figure — figure caption template with the mandatory metric notes
- [ ] viz-caption-table — table caption and note template
- [ ] viz-footer-provenance — screen-PNG provenance footer with a UTC timestamp (proposal)
- [ ] viz-table-booktabs — three-rule, unit-headed, decimal-aligned result tables
- [ ] viz-table-split-cost — performance vs cost table split for the paper (proposal)
- [ ] viz-table-ops — separate writes and reads per-operation tables
- [ ] viz-cell-mean-sd — `mean ± SD` cell format at `METRICS` decimals
- [ ] viz-cell-latency — `avg (min–max), p95` combined latency cell
- [ ] viz-cell-missing — `n/a` vs `—` distinction (proposal)
- [ ] viz-flag-e3a — saturated / latency-knee flags (`†`/`‡` in print, proposal)
- [ ] viz-table-markdown — per-variant Markdown tables from `report.py`
- [ ] viz-csv-rounds — unstyled per-round CSV export with units in headers
- [ ] viz-csv-summary — unstyled summary CSV with separate SD columns
- [ ] viz-json-saturation — `e3a-saturation.json` feeding the captions
- [ ] viz-export-files — file naming, PDF/SVG/PNG-300 export and deterministic metadata
- [ ] viz-number-format — decimals, units and tick-number rules
- [ ] viz-app-chart-viewer — History & results › charts tab layout
- [ ] viz-app-chart-list — metric-named chart list in `CHART_METRICS` order (proposal)
- [ ] viz-app-chart-toolbar — Open image / Open folder / Copy path / Export for print actions (proposal)
- [ ] viz-app-chart-empty — six empty-state messages for the charts tab
- [ ] viz-app-chart-stale — "charts older than newest run" banner (proposal)
- [ ] viz-app-results-tree — per-round results Treeview styling

### 8. UX flows, states & accessibility (both UIs)

- [ ] web-icon-auto-logged — icon on every control that writes an on-chain ACCESS event
- [ ] web-notice-auto-logged — inline/banner notice that a read writes to the audit trail
- [ ] web-dialog-confirm-destructive — T2 consequence confirm modal pattern
- [ ] web-dialog-dispose-evidence — T3 typed confirm for DisposeEvidence (proposal)
- [ ] web-toast — success/info/error toasts naming op and actor (proposal)
- [ ] web-banner-integrity-verified — ingest end-to-end hash match banner
- [ ] web-banner-integrity-mismatch — ingest hash mismatch banner
- [ ] web-progress-hash — local hashing progress bar
- [ ] web-progress-upload — upload progress bar (proposal)
- [ ] web-state-loading-skeleton — content-shaped loading placeholders (proposal)
- [ ] web-empty-cases — My cases empty state
- [ ] web-empty-evidence — case/report no-evidence empty state
- [ ] web-empty-trail — "No audit events." empty state
- [ ] web-empty-search — search no-results empty state
- [ ] web-empty-activity — activity / flagged empty state
- [ ] web-state-error-inline — icon + message + next-step error block
- [ ] web-state-rate-limited — 429 auto-log rate-limit state
- [ ] web-state-session-ended — signed-out explanation banner (proposal)
- [ ] web-page-unauthorized — `/unauthorized` illustration
- [ ] web-page-not-found — 404 route illustration
- [ ] web-skip-link — skip to main content (proposal)
- [ ] web-table-card-collapse — tables become cards below 768 px
- [ ] web-print-report-header — CoC report print header
- [ ] web-print-report-footer — CoC report print footer with page x of y
- [ ] web-print-signature-block — examiner attestation block (proposal)
- [ ] sys-focus-ring — visible focus indicator spec for both UIs
- [ ] sys-status-pairs — icon + label pairs so status is never colour-only
- [ ] sys-motion-spec — motion and reduced-motion spec
- [ ] sys-journey-map-web — web journey diagrams with auto-log points
- [ ] sys-journey-map-desktop — desktop campaign diagram with destructive gates
- [ ] desk-dialog-confirm-run — Run/Resume confirm dialog with ledger-reset consequence
- [ ] desk-dialog-restore — Restore my test data dialog
- [ ] desk-dialog-use-baseline — Use as baseline confirm dialog
- [ ] desk-progress-run — Run panel progress, ETA and state icons
- [ ] desk-status-bar — sweeps.yaml / unsaved / ledger-holds status line
- [ ] desk-banner-placeholder-baseline — PLACEHOLDER baseline warning
- [ ] desk-toggle-reuse-ledger — reuse-the-running-ledger control with warning
- [ ] desk-empty-suggestion — empty suggestion table state
- [ ] desk-empty-history — empty History state
- [ ] desk-notify-finished — end-of-run Windows notification (proposal)
- [ ] desk-campaign-strip — E0→E3 campaign progress strip (proposal)
