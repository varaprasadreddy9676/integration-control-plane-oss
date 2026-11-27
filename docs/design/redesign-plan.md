# Console Redesign — Implementation Plan

Status: **proposed (revision 2)** · Branch `medics` · Owner decision: agent decides, owner reviews the pilot.
Companion docs: [redesign-direction.md](redesign-direction.md) (visual contract) and
[redesign-cutover.md](redesign-cutover.md) (measured definition of done). The prototype that once
lived in `redesign/` has been removed; the implemented console replaces it.

> Scope: **frontend-only plus one small backend addition** (appearance preference storage). No API
> contract changes except the small additions in §9. Promotion stays behind `scripts/deploy.sh`.

### Revision 2 — corrections from a re-audit

1. **`design-system/tokens/*.ts` is NOT dead.** Revision 1 said "0 consumers → delete"; that was a
   malformed search. It is consumed by ~80 files through `useDesignTokens()`. The real problem is that
   tokens are defined in **three parallel places** (§2.2). The plan now says *consolidate*, not *delete*.
2. **The stages canvas was missed.** `features/stages/` is a 6,842-LOC custom canvas/editor and
   `features/flowBuilder/` is a 6,002-LOC React Flow canvas — two separate flow surfaces (~13k LOC)
   that need their own workstream and a primary/secondary decision.
3. **The landing page was under-counted.** `features/landing/` is a ~6.5k-LOC public marketing site
   with its own Tailwind scope, Lenis smooth-scroll and an `html.dark` theme hook. It is **out of scope
   for the console redesign** and tracked separately.
4. **A feature-flag utility already exists** (`utils/featureFlags.ts`, already gates the Flow Builder) —
   the migration flag should reuse it, not invent `?ui=v2`.
5. Additional dead code: `lib/utils.ts` (shadcn `cn`, only imported by the dead `components/ui`) and
   `components/dashboard/DashboardHeaderImproved.tsx` (orphaned duplicate of the live
   `features/dashboard/components/DashboardHeader.tsx`).

---

## 1. Goal

Replace the current three-way UI system (Astryx + AntD compatibility boundary + dead shadcn layer)
with a single token-driven system implementing the **Ledger** direction: five theme packs, one shared
component set, one page-template family, one motion language, and a per-user appearance preference —
shipped **behind a flag**, family by family, so the console is never broken for longer than one branch
is open.

Done means: every route renders from the new primitives, the theme picker works end-to-end, all five
packs pass the contrast/status checks, the token sources are consolidated, the CSS override sheet is at
or below budget, and the acceptance tasks in §8 pass on real data.

---

## 2. Current state (the analysis)

### 2.1 What the frontend actually is

| Area | Reality | Evidence |
|---|---|---|
| Source size | 585 `.ts`/`.tsx` files, ~108k LOC | `frontend/src` |
| Routes | 46 product routes + login + 2 docs + portal-launch + standalone status; **44 `*Route.tsx`, 34,204 LOC** | `app/App.tsx:935-984` |
| Shell | `App.tsx` (1,058) + `AppSidebar.tsx` (169) + Astryx `TopNav` + `CommandPalette.tsx` (213) | `app/`, `components/layout/` |
| Providers | `ThemeProvider` does mode+density via Astryx `theme` + AntD `ConfigProvider`, persisted to `localStorage` | `app/theme-provider.tsx` |
| Feature flags | `utils/featureFlags.ts` exists and already gates the Flow Builder | `app/App.tsx:335,941` |
| API client | `services/api.ts` = 307 exports, 4,683 LOC; `stages-api.ts` (280), `activity-tracker.ts` (450), `auth-api.ts` (85) | `services/` |
| Types | `mocks/types.ts` (591) is the de-facto shared API contract | `mocks/` |
| Tests | 155 files / **612 tests** (verified passing) | `src/tests/` |
| Harness | `capture-review.mjs` (47 routes), `review-fixture-server.mjs`, `ui-metrics.mjs`, `ui-ratchet.mjs` | `frontend/scripts/`, `scripts/` |

### 2.2 Token and theme sources — the core problem

Tokens are defined in **three parallel places**, and dark mode is resolved in two:

1. **Astryx theme** — `design-system/theme/medics-theme.ts` (182) → built to `medics-console.js` +
   `medics-theme.css`. This is the correct source; `useThemeColors()` already resolves colours from it
   via `resolveThemeTokens(medicsTheme, { mode })`.
2. **TS token constants** — `design-system/tokens/*.ts` (spacing, colors, typography, shadows, borders,
   breakpoints, transitions, animations, zIndex). Live: imported by `useDesignTokens()`, which ~80 files
   use. `useDesignTokens` also layers antd `theme.useToken()` and `useThemeColors()` — three lookups in
   one hook.
3. **CSS aliases** — `--color-*`, `--console-*`, `--ant-*` in `product-foundations.css` (5,872) and
   `global.css` (1,883), plus the 80-entry `legacyColorAliases` in `medics-theme.ts`.

Dark-mode mechanisms: Astryx `mode` (`app/theme-provider.tsx`, console) and `html.dark`
(`hooks/useTheme.tsx`, default **dark**, used only by the landing page). The landing and the console do
not share a theme mechanism.

### 2.3 Three UI systems — two are dead weight

1. **Astryx 0.7.17** — intended system (above).
2. **AntD** — the behaviour layer behind `LegacyAntdControls.ts` (66), `LegacyButton.tsx` (97),
   `LegacyTypography.tsx` (226), `LegacySpace.tsx` (93). **174 files** import `LegacyAntdControls`,
   **54** import `LegacyTypography`, **2** import `LegacySpace`. Skinned by 352 `.ant-*` rules and 759
   `!important`.
3. **shadcn/Radix** — `components/ui/*` (~40 files, **6,084 LOC**). **0 imports outside itself — dead.**

Dead or orphaned material (verified):

| Item | LOC | Status |
|---|---|---|
| `components/ui/*` (shadcn) | 6,084 | 0 consumers → delete |
| `lib/utils.ts` (shadcn `cn`) | 6 | only imported by `components/ui` → delete with it |
| `themes/medics-refresh/*` (abandoned 2nd theme) | ~600 | self-referencing → delete (proves multi-theme mechanism exists) |
| `components/dashboard/DashboardHeaderImproved.tsx` | 173 | orphaned duplicate of `features/dashboard/components/DashboardHeader.tsx` → delete |
| `design-system/spotlight.ts` | — | unused → delete |
| `design-system/delight.ts` | — | used (`dissolve`) → keep |
| `design-system/view-transition.ts` | — | used in 5 routes → keep |

### 2.4 The migration surface, grouped into families

Sorted by route-file LOC, grouped for §6 order:

- **Monitor** (12,430): Logs (2,802) + LogDetail (1,183), ScheduledJobs (2,518) + list (415),
  SystemLogs (1,250), AlertCenter (737), EventAudit (701), DLQ (20), SystemStatus (1,288),
  ScheduledIntegrations (1,119).
- **Integrations** (7,244 + `integration-history/` 477): IntegrationDetail (1,294) + Integrations (782)
  + Unified (160), InboundIntegrationDetail (2,424) + InboundIntegrations (881), Versions (827),
  IntegrationHistoryDrawer (300).
- **Canvas** (~12,844): `features/stages/` (6,842 — custom `WorkflowCanvas` 806 + `canvas.css` 908,
  `model` 749, `StageEditorDrawer` 612, plus Inspector/Node/Execution/Connectors) and
  `features/flowBuilder/` (6,002 — React Flow, feature-flagged).
- **Settings/Admin** (7,769): Settings (1,138), EventSource (1,240), OrgDirectory (1,855), Roles (543),
  AuditLogs (529), UserActivity (519), ApiKeys (497), TemplateDetail (490), UserManagement (438),
  Bulk (416), AdminRateLimits (647) + others.
- **Resources** (2,130): Templates (716), Lookups (651) + detail (263) + stats (213), EventCatalog (324),
  LookupGuide (650).
- **Dashboard** (1,425 route + 8 tab components under `features/dashboard/components/Dashboard*Tab.tsx`).
- **Auth** (571): Login (159 + `login.css` 262), PortalLaunch (150).
- **Landing** (~6,480): public marketing site — **separate track, out of scope here**.

### 2.5 Known landmines to fix in the same pass

- `__KEEP_` sentinel — 124 occurrences incl. the route param `/versions/:__KEEP_integrationName__`
  (`App.tsx:965`), a `useParams` destructure, a type field, and a query param
  `__KEEP___KEEP_integrationConfig__Id__` (`api.ts:2446`). The compare action targets
  `/versions/:name/compare/…`, which has no route.
- `vite.config.js` shadows `vite.config.ts`; `vite.config.d.ts` + `tsconfig*.tsbuildinfo` committed.
- `docs/ui-metrics-baseline.json` stale.
- `backend/src/bkp prod/` (empty stray dir); `data/store.js`/`queue.js` legacy file store.

---

## 3. Architecture decisions

1. **One token source: the Astryx theme packs.** Five packs (Ledger, Graphite, Cobalt, Midnight,
   Contrast) built as Astryx themes; `useThemeColors()` already resolves from them. **Consolidate** the
   TS `tokens/*` constants and the CSS aliases into the semantic tokens, and make `useDesignTokens()`
   read semantic values instead of mixing antd `useToken()` + TS constants + Astryx colours.
2. **One dark-mode mechanism.** Astryx `mode` via `AppearanceProvider`. The landing page's `html.dark`
   hook stays isolated to the landing (out of scope) or is brought onto the same provider later.
3. **AntD survives only behind ONE boundary**, for Table/Select/DatePicker/Form, themed by
   `ConfigProvider`. Everything else migrates to Astryx or a thin primitive. `product-foundations.css`
   is capped at **200 lines, zero `!important`** and shrinks per migrated control.
4. **Recharts stays** for the standard charts (`components/charts/*` wrappers + `chart-theme.ts`).
   Heatmap and Funnel are already custom SVG — restyle them to tokens. The dashboard trend may move to a
   small SVG (the prototype has one); decide at pilot time.
5. **One page-template family, six shapes** — Overview, List, Inspector, Configuration, Canvas,
   Standalone — via `PageTemplate` variants + per-family components (`MetricStrip`, `TrendChart`,
   `NeedsAttention`, `RunTimeline`, `MasterDetail`, `ConfigDocument`, `ContextRail`).
6. **Appearance is a first-class preference** (per user + org default). `ThemeProvider` grows into
   `AppearanceProvider` with pack/mode/density/corners/accent + the contrast checker.
7. **Migration is flag-gated and ratcheted** — reuse `utils/featureFlags.ts` (it already gates the Flow
   Builder); `ui-ratchet` gains two shrinking budgets (CSS lines, `!important` count).
8. **Canvas needs an explicit primary/secondary decision.** The classic tabbed form, the stages step
   editor, and the React Flow canvas cannot all be equal. Decide at Checkpoint 2 (§11); the winner is
   restyled, the others are gated or deprecated.

---

## 4. Target file layout

```
frontend/src/
  design-system/
    theme/                 # one folder per pack + registry
      ledger-theme.ts … contrast-theme.ts   (each -> a built .css)
      theme-registry.ts    # pack id -> { theme, css, tokens }
      chart-theme.ts       # keep, re-point to semantic tokens
      antd-theme.ts        # keep, becomes the single ConfigProvider mapping
    primitives/            # NEW: Button, Field, Table, StatusBadge, StatePanel,
                           # Panel, Toolbar, FilterBar, EmptyState, Inspector,
                           # Tabs, Dialog, Drawer, Tooltip, Toast
    tokens.css             # generated semantic tokens (one import)
    motion.ts              # motion tokens/helpers (replaces motion.css + delight)
  components/
    layout/                # Rail, TopBar, CommandPalette (upgraded)
    pages/                 # NEW: PageTemplate + the six page shapes
    charts/                # keep; add TrendChart + Sparkline
    dashboard/             # MetricStrip, NeedsAttention, RunTimeline
  app/
    appearance-provider.tsx   # replaces theme-provider.tsx
  features/<family>/routes/*.tsx
```

Consolidations (not deletions): `design-system/tokens/*.ts` and `useDesignTokens()` collapse into the
semantic token layer; `legacyColorAliases` is removed; `--color-*`/`--console-*` CSS aliases migrate to
semantic vars as their consumers move.

Deletions: `components/ui/*`, `lib/utils.ts`, `themes/medics-refresh/*`,
`components/dashboard/DashboardHeaderImproved.tsx`, `design-system/spotlight.ts`,
`components/common/LegacyButton.tsx`, `LegacyTypography.tsx`, `LegacySpace.tsx` (once callers migrate).

---

## 5. Dependency graph (build bottom-up)

```
tokens (5 packs) ──> theme-registry ──> antd-theme / chart-theme ──> AppearanceProvider
        │
        └──────────> primitives ──> page shapes ──> shell (Rail/TopBar/Palette)
                                            │
                                            └──> feature routes (per family)
```

Order: tokens → registry → primitives → page shapes → shell → pilot → families. Preferences sit beside
the registry; the canvas workstream is independent of the list/config families and can run in parallel
once primitives are frozen.

---

## 6. Task list

Sizing: S (1–2 files), M (3–5), L (6–8). Each family is one task with acceptance criteria.

### Phase 0 — Freeze, delete, fix

- [ ] **Task 0.1 — Land the visual contract** (S). Commit `redesign-direction.md` + the `redesign/`
  prototype to a branch. No app code.
- [ ] **Task 0.2 — Delete dead weight** (M). Remove `components/ui/*`, `lib/utils.ts`,
  `themes/medics-refresh/*`, `components/dashboard/DashboardHeaderImproved.tsx`,
  `design-system/spotlight.ts`; verify no imports break.
  - AC: `tsc --noEmit`, `npm test`, `npm run build`, `ui:ratchet` green.
- [ ] **Task 0.3 — Fix landmines** (S). Rename the `__KEEP_*` sentinels, fix the `/versions/:name/compare`
  dead end, delete the stale `vite.config.js`/`.d.ts`/`tsbuildinfo`, regenerate `ui-metrics-baseline.json`.
  - AC: `grep __KEEP_` → 0; build picks up `vite.config.ts`.

**Checkpoint 0** — gates green, dead code gone, no visual change. Human sign-off on the direction.

### Phase 1 — Spine

- [ ] **Task 1.1 — Token consolidation + five packs** (L). Build the five packs as Astryx themes;
  `theme-registry.ts`; `tokens.css`; collapse `tokens/*.ts` + `useDesignTokens()` into semantic reads;
  delete the alias layer; re-point `antd-theme.ts`/`chart-theme.ts`.
  - AC: `theme:check` passes ×5; the 7-pair contrast audit is green; the app renders identically under
    Ledger; `useDesignTokens` no longer imports the TS token table.
- [ ] **Task 1.2 — Primitives** (L, split per control). Button, Field, Panel, Toolbar, StatusBadge,
  StatePanel, EmptyState, Tabs, Inspector; replace `LegacyButton`/`LegacyTypography`/`LegacySpace`.
  - AC: per-control tests; legacy importers → 0; CSS budget drops in the same commit.
- [ ] **Task 1.3 — Shell** (L). `Rail.tsx` + `TopBar.tsx` + appearance popover + upgrade
  `CommandPalette.tsx`; render behind a `featureFlags` flag.
  - AC: new shell renders on every route under the flag with no overflow; keyboard parity; old shell
    still the default.
- [ ] **Task 1.4 — AppearanceProvider + settings screen** (M). Pack/mode/density/corners/accent + the
  Appearance route + the live contrast/distinctness checker.
  - AC: switching is instant, persisted, and flags accent/status collisions.

**Checkpoint 1** — new shell + picker work behind the flag; Ledger is default; old console untouched.

### Phase 2 — Pilot

- [ ] **Task 2.1 — Dashboard** (L). Rebuild `DashboardRoute.tsx` (and consolidate its 8 tab components)
  into `MetricStrip` + `TrendChart` (crosshair/pin/"view logs") + `NeedsAttention` + outcome mix +
  provider sparklines.
- [ ] **Task 2.2 — Integration detail** (L). `IntegrationDetailRoute.tsx` as a config document +
  `ContextRail` + `RunTimeline` (no nine tabs); `InboundIntegrationDetailRoute` same shape; fold in
  `IntegrationHistoryDrawer`; move "Classic/Steps" into the Delivery section.

**Checkpoint 2** — pilot screens meet the rubric (≥4/5) on real data. Decision gate: canvas
primary/secondary; landing scope; Recharts-vs-SVG; AntD Form; Astryx multi-theme approach.

### Phase 3 — Families (in §2.4 order)

Each family = one L task: apply the page shape, migrate controls, wire filters/status/empty states,
delete the family's CSS, capture + ratchet + task check.

- [ ] **Task 3.1 — Monitor** (logs, scheduled-jobs, system-logs, alert-center, event-audit, dlq,
  system-status, scheduled).
- [ ] **Task 3.2 — Integrations** (integrations, inbound-integrations, versions, integration-history).
- [ ] **Task 3.3 — Resources** (templates, lookups, event-catalog, lookup-guide).
- [ ] **Task 3.4 — Settings/Admin** (settings, event-source, admin orgs/roles/api-keys/audit/users/
  storage/rate-limits, bulk).
- [ ] **Task 3.5 — Canvas** (stages canvas + flowBuilder) — the hardest surface; restyle the chosen
  primary, gate/deprecate the other per Checkpoint 2.
- [ ] **Task 3.6 — Auth** (login, portal-launch). Landing is **out of scope** (separate track).

**Checkpoint 3** — all in-scope routes render from the new system under the flag.

### Phase 4 — Cutover, verification, non-visual hardening

- [ ] **Task 4.1 — Cutover** (M). New shell becomes default; old shell archived behind the flag.
- [ ] **Task 4.2 — CSS budget closeout** (M). Delete `product-foundations.css` overrides per migrated
  control to meet the 200-line/0-`!important` budget; retire the generated `extracted-static-styles.css` (still imported today) + remaining
  aliases.
- [ ] **Task 4.3 — Accessibility audit** (M). Axe + keyboard + screen-reader pass on the pilot + two
  families; contrast audit ×5 packs; reduced-motion check. Fix what it finds.
- [ ] **Task 4.4 — Performance budget** (M). Bundle/initial-JS budget for the five theme CSS files and
  the new primitives; keep the existing lazy-loading of chart/export libs; verify no regression vs the
  current 1.75 MB shared-chunk advisory.
- [ ] **Task 4.5 — Verification** (M). Full gates, full capture (5 packs × light/dark × 1440/390), task
  tests, keyboard walkthrough; update `redesign-direction.md` + this plan to reflect reality.

**Checkpoint 4** — done. Promotion is a separate, owner-authorized step via `scripts/deploy.sh`.

---

## 7. Parallelization

- Phase 0.2/0.3 and Phase 1.1/1.2 are independent — run in parallel.
- Family tasks 3.1–3.5 can run in parallel **after** primitives + page shapes are frozen (they share
  `components/pages/*` and `primitives/*`). Freeze the primitive props first.
- The appearance backend task (§9) and the canvas workstream are independent of the list/config
  families — parallel from the start.

---

## 8. Acceptance and verification

Acceptance is task-based, not count-based. The regression guard is `ui:ratchet` plus two new shrinking
budgets (CSS lines, `!important`).

- **Task tests** (human, real data): (1) dashboard — find the failing provider and open its filtered
  logs in ≤10s; (2) integration — read health, last run and target without opening a tab; (3) logs —
  filter to a failed delivery and read request/response in ≤15s; (4) appearance — switch packs and
  confirm statuses stay distinguishable and text stays ≥4.5:1.
- **Automated**: `npx tsc --noEmit` · `npm run lint` (ratchet) · `npx vitest run` · `npm run build` ·
  `npm run capture:review` (47 routes × 5 packs × light/dark × 1440/390 + 320/768/1024 overflow) · the
  contrast/distinctness audit (5 packs × 2 modes, 7 pairs + accent distance).
- **Visual**: owner scores the two pilot screens on the 5-point rubric before any family migration.

---

## 9. Data and API requirements

| Need | Source | Backend change |
|---|---|---|
| p95 latency + delivery/failure totals | `/analytics` (dashboard already uses it) | verify p95 exists |
| Provider sparkline (12 buckets) | `/analytics/provider-series` | **new** (small), or derive from `/analytics` |
| 60-run timeline | `/logs` (integration + `createdAt,status,latencyMs`) | none |
| Command-palette index | existing `CommandPalette` data sources | verify coverage |
| Per-user appearance | new `user.appearance` (or `ui_config`) | **new** `GET/PUT /me/appearance` |
| Org default appearance | `organizations.appearance` (or `ui_config`) | **new** admin `PUT /admin/orgs/:id/appearance` |

Backend additions are a single small preference document — trivial on Node 14, no migration beyond an
optional index. If org-default is descoped for v1, only `user.appearance` is required.

---

## 10. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Two systems live during migration | drift | flag-gated; families flip one at a time; ratchet only shrinks |
| Astryx lacks Table/Select/DatePicker/Form parity | 200-line cap breaks | single boundary + ConfigProvider tokens; exceed only with a recorded decision |
| Astryx can't switch themes at runtime | 5 build artifacts | verify `astryx docs theme` at Checkpoint 2; fallback = 5 built files switched at the `theme` prop |
| **Token consolidation touches ~80 files** | wide blast radius | do it in Task 1.1 behind the flag with `useDesignTokens` as a shim; verify per-file |
| Canvas restyle is hard + two implementations | weeks, drift | decide primary at Checkpoint 2; gate/deprecate the other; freeze canvas CSS early |
| Recharts bundle size | slow dashboard | keep lazy-loading; SVG trend as escape hatch |
| Fixture-only verification | empty screens ship | fixtures must include failures, long names, 200 rows, empty states |
| AntD Form replacement | weeks of regression | out of scope v1: keep behind the boundary, restyle via tokens |
| Custom accent breaks status | ambiguity | runtime distance check + warning naming the colliding status |
| Landing/console theme divergence | inconsistent product | landing explicitly descoped; revisit after console lands |

---

## 11. Open questions (answers needed at Checkpoint 2)

1. Astryx `0.7.17`: multiple runtime themes via the `theme` prop, or one build artifact per pack?
2. Canvas: which is primary — classic tabs, the stages step editor, or the React Flow canvas? (drives
   Task 3.5 and whether `flowBuilder` stays feature-flagged)
3. Landing page: keep its own theme indefinitely, or bring it onto the shared provider later?
4. Org-level appearance: `organizations` vs existing `ui_config`?
5. Dashboard trend: keep Recharts or use the prototype's SVG trend?
6. AntD `Form` acceptable behind the boundary for v1?
7. Should appearance also control the chart palette (categorical vs mono)?

---

## 12. Rough effort

| Phase | Estimate |
|---|---|
| 0 (freeze, delete, fix) | 0.5–1 day |
| 1 (spine: tokens + primitives + shell + appearance) | 4–6 days (token consolidation widens it) |
| 2 (pilot) | 2–3 days |
| 3 (six families incl. canvas) | 2–4 days each; canvas 4–6 |
| 4 (cutover, a11y, perf, verify) | 3 days |
| **Total** | **~4–5 weeks**, front-loaded on the spine and the canvas |

The spine and the canvas are the only parts that must be right once; the list/config families after
them are mechanical application of a frozen pattern — precisely where the last attempt drifted.
