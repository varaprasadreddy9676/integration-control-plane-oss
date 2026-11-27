# Redesign progress

Tracks the implementation of [redesign-plan.md](redesign-plan.md) against
[redesign-direction.md](redesign-direction.md). Update after each verified increment.

Branch: `ui/ledger` · Last updated: 2026-11-27 (round 21)

## Phase 0 — freeze, delete, fix · **done**

| Task | State | Evidence |
|---|---|---|
| 0.1 Land the visual contract | done | `6f8cc6e15` |
| 0.2 Delete dead weight (shadcn 53 files, medics-refresh, orphan header, spotlight, `lib/utils`) | done | `abbc699f1`, −7,658 lines |
| 0.3 Fix landmines (`__KEEP_*` identifiers, dead compare route, stale `vite.config.js`, metrics baseline) | done | `b1ade7443` |

## Phase 1 — spine

| Task | State | Notes |
|---|---|---|
| 1.1 Five theme packs + token layer | **done (v1)** | `f6f3ec58d`. Ledger, Graphite, Cobalt, Midnight, Contrast. Packs are unbuilt Astryx themes injected at runtime; no per-pack build artifacts. |
| 1.1a Restore the console type scale | **done** | `--console-type-*` was referenced but never defined (titles inherited 14px); defined once in the theme foundations. |
| 1.1b Colour audit of the override sheet | **done** | 0 hardcoded hex values left in `design-system/theme/*.css`; the auto-refresh pill and the dashboard manage-link were tokenised. |
| 1.2 Primitives (`design-system/primitives`) | **v1 done** | `1c2a03b68`: Panel, MetricStrip/Metric, Toolbar, ContextRail, SectionHeading + 5 tests. Adopted by the Appearance screen. `LegacyButton/Typography/Space` remain for route code. |
| 1.3 Shell rebuild (Rail, TopBar, palette upgrade) | **not started** | Current shell patched for pack compatibility (rail foreground token + scoped CSS); the failed-delivery pill is now a quiet status action and the avatar follows the accent. |
| 1.4 Appearance settings | **partial** | `/settings/appearance` + one-click top-bar switcher: five packs, mode, density, **corners**, and **branding** (product name, workspace wordmark, logo URL). Live previews via nested themes, computed AA badge; branding is organisation-wide and stored on the existing `ui_config` document. All axes are in place: pack, mode, density, corners, action colour, branding. |

## Phase 2 — pilot · **in progress**

| Task | State | Notes |
|---|---|---|
| 2.1a Dashboard KPI row → divided metric strip | **done** | `01be458a3`. One surface, hairline dividers, uppercase labels, mono figures, colour on the failing value only; the odd last metric spans the row on phones. `Metric` gained icon / drill-down button / muted placeholder states. |
| 2.1b Direction is a filter, not a tab | **done** | Eight tabs → five views (Overview/Errors/Latency/Deliveries/Logs). Direction lives only in the filter; narrowing to a direction adds a contextual `<direction> performance` view that owns the direction panel. `TAB_SCOPE_OVERRIDES` removed; query gating follows the new keys; the direction panels stop repeating the global KPI strip. |
| 2.1c Dashboard overview on Panel | **done** | The six AntD cards became two `Panel`s with title/description; the decorative "Aggregated by Day" and "24-Hour Cycle" pills are gone (the aggregation is stated in the description). The ranked needs-attention list already exists in the Deliveries view. |
| 2.2a Integration detail: vertical section navigator | **done** | Nine-item horizontal tab strip → a 196px vertical navigator beside one panel (horizontal scroll below 1080px). Same ARIA contract, same visited-panel retention and disabled-section fallback; keyboard support added (arrows/Home/End). Dead `integration-sections-*` selectors removed from the legacy sheets. |
| 2.2b Integration detail: context rail | **done** | A 288px rail beside the form with live state: Status (active/draft, last updated, event), Recent runs (last five deliveries from the logs API, with a link to filtered logs) and Connection (host, method, auth). Stacks below the form under 1400px; the page header stays full width. |

## Phase 3 — families · **started**

| Task | State | Notes |
|---|---|---|
| 3.1a Delivery Logs status summary | **done** | The five coloured count pills became one filter row: a 6px dot carries the colour, label and figure stay neutral, the active filter is a quiet surface. Shared with Event Audit. |
| 3.1b Admin / settings / versions / scheduled / templates Card → Panel | **partial** | Delegated and reviewed: 3 admin screens, the event-source form, 3 version surfaces and the scheduled failures empty state and the template detail form. Alert-center and system-logs cards were all skipped (hoverable, selection styles, body overrides) — evidence that surface conversion has reached its limit and the next step is a denser table/list anatomy rather than more Panel swaps. Remaining cards were skipped with reasons (body style overrides, selection styling, positioning classes) — the backlog for the next primitive gaps. `Panel` accepts a placement-only `style` prop. |
| 3.x Remaining families | partial | system logs and alert center now use the shared metric strip; flow builder's blue banner became a quiet note. Still: logs layout, resources detail, canvas, auth screens. |

## Branding (generic-product requirement)

The console no longer hardcodes "MEDICS" or "Integration Gateway". Branding
resolves from the organisation's `ui_config.branding`, then deployment env
(`VITE_APP_NAME` / `VITE_WORKSPACE_NAME` / `VITE_LOGO_URL`), then generic
defaults, and drives the rail, login, mobile header and document title. See
[BRANDING.md](../guides/BRANDING.md).

## UI-pattern inventory (round 13)

A static audit of every feature and shared component found the remaining
deviations from the direction, by category: 30 informational callouts, 12
lists that render a Card per item, 0 AntD Tags (already gone), 48 files still
importing AntD Card, and the top-15 inline-style files. It is the backlog for
the next rounds; the first two fixes landed this round:

- Templates: card grid -> rows (Template / Category / Event / Status /
  Actions), and the category icons that misused status colours are gone.
- Eight static info callouts removed (system-status, signing, raw JSON,
  form alerts, review drawer, lifecycle panel, template detail) — net -105
  lines. Behavioural warnings were left alone.

Landed after the inventory: role cards -> rows, the four nested-card sections on
integration detail (condition rules, lifecycle rules, pre-delivery checks,
scheduling templates) and the dashboard's empty-period banner — all using a
new `RowList`/`Row` primitive for divided, repeatable items.

Still open: 44 AntD Card imports, a handful of contextual notices in admin
screens, and the canvas/auth families. The flow-builder inspector and inbound
channel forms are now callout-free.

## Performance budget (measured, round 12)

Delegated audit of the production build (Node 24, Vite 5):

| Fact | Value |
|---|---|
| Entry JS | **1,464 kB raw / 450 kB gzip** (was 1,771 kB before the lazy palette + vendor chunks) |
| Entry CSS | **522 kB raw / 94 kB gzip** |
| Shared table chunk (`use-mobile`) | 194 kB raw — AntD Table/Pagination/Checkbox/Radio |
| Dashboard export (`jspdf` + `html2canvas` + canvg) | 772 kB raw, client-side |
| Dashboard chart chunk (Recharts `BarChart`) | 379 kB raw |
| Files importing `LegacyAntdControls` | **150 of 251** feature files |
| Files importing design-system primitives | **12** |
| AntD `Card` users | 48 files |

Ranked reductions (backlog, not started): lazy CommandPalette + vendor
manualChunks (~450-700 kB off entry), replace the client-side PDF export
(~772 kB), lazy-load non-default dashboard tabs (~379 kB deferred), purge
unused Astryx/AntD CSS (~150-250 kB), migrate ModernTable to an Astryx table
(~194 kB shared).

## Charts and final token pass (round 19)

- Charts resolved their palette from the base theme, so every pack rendered the
  same blue/green/amber. `useChartTheme()` now resolves from the active pack
  (verified: #17191C ledger, #2563EB cobalt, #ECEDEE ledger dark, #6D28D9 under
  a violet accent). Arbitrary categories use a neutral ink ramp; status series
  keep explicit status colours.
- Segmented labels 4.18:1 -> primary ink.
- Cobalt selected rail label 2.5:1 -> 7.5:1 (it was white in both modes).
- React Flow attribution forced to the secondary ink.
- Admin storage loses its remaining static callouts.

## Five-pack audit of the new screens (round 18)

60 combinations (6 screens x 5 packs x 2 modes), measured in the browser:

| Finding | State |
|---|---|
| Text contrast in the requested categories | **0 failures** |
| AntD switch label white on a light accent in dark mode (1.17-2.54:1) | **fixed** — follows the accent on-colour (16-21:1) |
| Count badges on canvas nodes (same cause) | **fixed** — label is the page background |
| React Flow attribution 2.1-2.9:1 | **fixed** — secondary ink |
| Contrast pack: sign-in halves identical white/black | **fixed** — 2.5% ink wash on the hero |
| Blue segmented labels in cobalt light (4.18:1) | open, one pack |

Fully clean in the strict scan: ledger, graphite and midnight in light mode.

## Table migration spike (round 18)

Delegated feasibility study for replacing Ant Design's Table with the design
system's. Verdict: **pilot, don't assume**.

| Feature ModernTable needs | Astryx support | Migration risk |
|---|---|---|
| sorting, custom cells, sticky header | native | low |
| row selection | native, but state ownership is ours | medium |
| resizable columns | via hook, per-screen validation | medium-high |
| mobile card mode | none — custom rendering | **high** |
| expandable rows | separate plugin model | **high** |

The shared 194 kB chunk will **not** disappear entirely: pagination, checkboxes
and radios remain in use elsewhere. Recommended pilot: the outbound list on
`/integrations` (it exercises sorting, selection, pagination, resizing, sticky
header and mobile mode in one screen), with a bundle and axe comparison before
any further migration.

## Surface anatomy (round 18)

- Ant Design Card aligned to Panel at the theme level (16px body, 44px header,
  transparent header, 14px/600 title, same hairline) — the ~40 remaining Card
  call sites now read as the same surface.
- `bordered` removed from all 17 Descriptions: a framed table inside a panel
  was a table inside a card.

## Removed with this redesign

Eight historical UI reports lived at the repository root
(`SCREEN_UI_UX_REVIEW.md`, `PRODUCTION_UI_UX_COMPLETE.md`,
`DASHBOARD_SHELL_IMPROVEMENTS.md`, `SIDEBAR_IMPROVEMENTS.md`,
`PORTAL_UI_IMPROVEMENTS.md`, `PORTAL_TESTING_REPORT.md`,
`ACCESSIBILITY_IMPROVEMENTS.md`, `IMPROVEMENTS.md`), plus `console-design.md`,
`ui-overhaul-report.md`, `ui-consistency-agent-brief.md` and
`design-system-gaps.md` under `docs/`. They described UI work this branch
replaced; they were removed rather than left to compete with the current
contract. The prototype that fixed the direction (`docs/design/redesign/*.html`)
was removed for the same reason — the running console is the reference.

## Accessibility, 47 routes (round 17)

94 runs (47 routes x ledger/light + contrast/dark), axe 4.14.1:

| Rule | Impact | Nodes | State |
|---|---|---|---|
| `label` (filter comboboxes) | critical | 28 | **fixed** (named by what they filter) |
| `aria-allowed-attr` (`#actionType` and siblings) | critical | 24 | **fixed** (Form.Item passed aria-required to a div) |
| `button-name` (switches in table cells) | critical | 10 | **fixed** |
| `color-contrast` (empty-state and disabled labels) | serious | 19 | partially exempt; remaining are disabled states |
| `aria-progressbar-name` / `svg-img-alt` (storage bars, chart paths) | serious | 12 | progress **fixed**; chart paths are a Recharts artefact |
| `aria-hidden-focus` (rc-table measure row) | serious | 14 | framework artefact |
| `nested-interactive` (AntD collapse header) | serious | 4 | framework artefact |

The earlier 6-route audit only looked at the shell and five screens; expanding
to all 47 surfaced the long tail. Framework artefacts (measure row, collapse
header, Recharts paths) are documented rather than patched.

## CSS budget (round 17)

Entry CSS is 522 kB raw / 94 kB gzip. The weight is the framework:
`astryx.css` 314 kB, `product-foundations.css` 126 kB, `global.css` 41 kB.
A dead-selector scan found 14 unused custom classes (~25 kB raw) left behind
by earlier conversions; they are safe to remove in a dedicated pass, but the
real reduction needs the AntD-to-Astryx table migration, not micro-cleanup.

## Full-route contrast sweep (round 16)

188 runs (47 routes x 4 pack/modes), 1,184 measurements:

| Result | Value |
|---|---|
| Routes fully clean | **42 / 47** |
| Active failures | 12, on 4 routes (plus marketing `/docs`) |
| Root causes | Ant Design's unmapped `colorTextDescription` (8) and `--color-on-warning` set to ink on dark-amber fills (3) |
| Fixed | both; captions now 4.76-6.34:1, warning tags 8.82:1 |
| Remaining | disabled Save button (WCAG-exempt) and one `<code>` in the marketing docs page |

## Five-pack contrast sweep (round 15)

740 computed-style measurements (5 packs x 2 modes x 5 routes). 27 failures,
all fixed:

| Finding | Fix | Now |
|---|---|---|
| Sidebar failed-delivery count: white on the dark-mode error tint (2.03-2.77:1) | token chip: error fill + page-background label, and the rail's `color: inherit !important` rule narrowed | **7.8-12.4:1** |
| Cobalt blue meta tag at 4.4999:1 | info tint mixed at 8% instead of 10% | **4.65:1** |

Layout geometry was identical across packs (0 differences measured). Dark mode
is clean in all five packs; light mode is clean in all five.

## Accessibility (axe 4.14.1, WCAG 2 A/AA)

Audited five packs × six routes after the appearance work. Started at 63
violation instances across 5 rules; now:

| Route | Before | After |
|---|---|---|
| /settings/appearance | aria-allowed-attr, label | **none** |
| /integrations | label ×4, button-name, aria-hidden-focus | aria-hidden-focus only |
| /integrations/:id | color-contrast ×3, label | **none** |
| /dashboard | label ×3 | **none** |
| /alert-center | label ×3 | **none** |
| /events | label ×4 | **none** |
| /logs | label | aria-hidden-focus only |

Fixes: `aria-checked` instead of `aria-pressed` on the theme radios; names on
every active switch, organisation switcher and filter combobox; row-selection
checkboxes named through ModernTable; breadcrumb links moved off Ant Design's
description grey (2.6-3.4:1 → secondary ink); `--color-text-success` deepened
so status badges clear 4.5:1 (now 5.86-6.33:1). The remaining
`aria-hidden-focus` is rc-table's measure row and needs an AntD patch.

## Delegation

Two external agent CLIs are used for bounded, mechanical work: `codex exec`
(shell) and `agy --print`. Both are given a directory-scoped brief, a
"skip and report" rule, and must run tsc/tests/lint themselves. Every
delegated diff is reviewed and the full suite + capture rerun before it is
committed. The first round produced 4 tests, 3 admin conversions and 1
settings conversion; the agents' skip lists are the backlog for primitive
gaps (for example `Panel` had no placement prop until a skip reason asked for
one).

## Phase 3 — families (original heading, superseded above)

## Phase 4 — cutover / a11y / perf · **not started**

## Verification (current)

- `npx tsc --noEmit` — pass
- `npm test` — 156 files / 618 tests pass
- `npm run lint` — biome + `ui:ratchet` + `astryx theme --check` pass
- `npm run build` — pass (pre-existing chunk-size advisory)
- `npm run capture:review` — **289 screenshots across 47 routes, 0 issues**, 71
  non-fatal warnings (AntD/React warnings, unchanged class of noise). The
  harness now checks both the metric strip and the legacy KPI cards.
- Contrast: every pack audited for 7 pairs (text, action, status) — all pass; the
  appearance screen recomputes text/action contrast per pack and only shows AA
  when both hold.

## Known leftovers

1. `useDesignTokens` still imports the parallel TS token table (`design-system/tokens/*`).
   Consolidation is Task 1.1c and touches ~80 files.
2. `main.tsx` still imports the generated `medics-theme.css`; the provider no longer
   needs it for the default pack. Remove with the token consolidation.
3. The Dashboard uses a bespoke header; every other route uses `PageHeader`. The one
   page-template family (Task 1.3) replaces both.
4. Accent picking, corner radius and organisation-level defaults are designed but not built.
5. Legacy AntD remains the behaviour layer for Table/Select/DatePicker/Form behind the
   documented boundary.
