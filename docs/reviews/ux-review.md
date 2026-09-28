# UI/UX review — evidence-library SPA

Date: 2026-07-21 · Base commit: `ae711b2` · Method: source review of the UI kit and
the data-dense pages, plus live observation of the running SPA (localhost:8081) as an
admin session.

Scope: presentational and accessibility quality. No API shapes, routes or data flows were
changed. Findings are ranked; each is marked fixed / documented.

## Findings

### U1 — every timestamp rendered as a raw ISO string — **fixed**
Severity: high (readability of a forensic/court artifact)

There was no date-formatting helper anywhere in the SPA. Every timestamp — the cases list
`updated` column, case `createdAt`, the on-chain **chain-of-custody trail** (`e.ts`), the
session trail, examiner-note times, the case activity feed, the lead dashboard feed, and the
**CoC court report's** `generated` line — rendered the raw value, e.g.
`2026-07-21T08:02:54.455Z`. In a chain-of-custody system this is both hard to read and, in
the exported court report, unprofessional.

**Fix.** New `frontend/src/lib/format.ts` — `formatTs()` renders a fixed, timezone-explicit
`2026-07-21 08:02:54 UTC`. A *fixed UTC* format (not a per-machine locale string) is
deliberate: a forensic record must read identically for every examiner. The full original
ISO (milliseconds included) is preserved in a `title` tooltip at each call site for exact
precision. Applied across all eight render sites incl. `AuditTrailTimeline`, `SessionTrail`
and `CoCReportPage`. `formatTs` is defensive — em dash for empty, raw value for unparseable,
never throws in a render path. Unit-tested (`lib/format.test.ts`).

### U2 — UI-kit accessibility gaps — **fixed**
Severity: medium

The kit primitives were visually complete but keyboard/AT-incomplete:
- **Tabs** exposed `role="tablist"`/`role="tab"`/`aria-selected` but had no keyboard model —
  every tab was a tab stop and arrow keys did nothing.
  → roving `tabIndex` (only the active tab is a tab stop) + Arrow/Home/End navigation with
  activation following focus (WAI-ARIA tablist pattern). Tested.
- **Stepper** did not mark the active step for AT. → `aria-current="step"`. Tested.
- **Modal** set `aria-modal` but never moved focus into the dialog, never restored focus to
  the opener on close, and did not link its title. → focus-in on open, focus-restore on
  close, `aria-labelledby` to the title. The deliberate *no focus-trap* choice
  (ARCHITECTURE §5) is preserved — this is focus placement, not a trap.

### U3 — dead CSS from the retired single-page demo — **fixed**
Severity: low

`.scopes`, `.scopes button`, `.token`, `.token input` in `styles.css` were unreferenced
(leftovers from the pre-M14 single-page CoC demo). Removed. Care was taken to preserve
`.chip` / `.chip.active`, which were bundled into the same rules and ARE still used
(DashboardPage variant picker, category chips, flag chips).

### U4 — uneven UI-kit adoption — **documented, not changed**
Severity: low (consistency)

`pages/admin/CasesAdminPage.tsx` and `pages/admin/DashboardPage.tsx` predate the M21 kit and
use raw inputs/tables/buttons rather than `Tabs`/`Badge`/`Modal`. They are functional and
correct; the operator dashboard in particular is a benchmark console, not an
investigator-facing page. Converting them is cosmetic and carries regression risk for no
behavioural gain, so it is left as known, low-priority debt rather than churned now.

## Verified acceptable (no change)
- No `dangerouslySetInnerHTML`, `eval`, or `target="_blank"` anywhere (confirmed in the
  security pass); all user data renders through React escaping.
- `MyCasesPage` shows an empty `my role` for an admin viewing a case they do not
  participate in — correct (admins are not roster members; §12-8).
- Empty states exist where they matter (`AuditTrailTimeline` "No audit events.").

## Gates
frontend vitest 31/31 (was 24; +5 format, +2 tabs, +stepper aria assertion),
`tsc --noEmit` + `vite build` clean. Live: SPA renders, no console/CSP errors.
