# UI Overhaul Report

Date: 2026-11-25
Branch: `ui/astryx-consistency`
Scope: frontend only; no backend changes or deployment.
Closeout commit: `7ba34545b` (pushed to `origin/ui/astryx-consistency`).
Capture cleanup: superseded batch and duplicate captures were removed; the canonical r4 capture is retained.
Cleanup commit: `44a240b0c` (pushed to `origin/ui/astryx-consistency`).

## Outcome

The Section 1 acceptance criteria are complete on `ui/astryx-consistency`. The application has one Astryx-led theme and page framework, shared route-level presentation, and no literal-only inline JSX style objects. Remaining AntD behavior is centralized behind documented compatibility adapters where native parity has not been established; this is an explicit compatibility boundary, not a claim that AntD has been fully removed. No backend changes or deployment were made.

## Acceptance Evidence

| Target | Result | Evidence |
|---|---|---|
| AntD Button imports | Pass | 0 application imports outside common adapters |
| AntD Tabs, Tag, Alert, Empty, Typography in routes/features | Pass | 0 direct imports; 1 generic Tag JSX use remains outside route/feature UI |
| Other AntD controls | Boundary pass; parity audit open | Runtime imports confined to `LegacyAntdControls`, `LegacySpace`, and derived `antd-theme`; detailed retained behavior in `design-system-gaps.md`, but not every caller has a documented behavior matrix |
| Icon source | Pass | 0 direct `@ant-design/icons` imports; app code uses the shared `Icon` boundary |
| Inline font-size literals | Pass | 0 |
| Raw inline spacing numbers | Pass | 0 |
| Inline style objects | Pass | 301 across 111 files; 0 literal-only style objects by the AST heuristic. Remaining objects are expression/data-driven. Static declarations live in `frontend/src/design-system/extracted-static-styles.css` |
| Theme source | Pass | Astryx theme/provider is the source; compatibility theme derives from it |
| Page title size | Pass | Shared `PageHeader`/template typography |
| Page frame and route coverage | Pass | 46/46 product routes use `PageTemplate`; 47 routes captured including login |
| Global chrome | Pass | One organization context, one search entry, one global Create menu, no Recent block |
| Tag / Alert counts | Pass | 1 / 0 JSX uses; below 80 / 60 limits |
| Status presentation | Pass | Shared sentence-case vocabulary and `StatusBadge`; regression suite passes |
| Empty and denied states | Pass | Shared `StatePanel`/neutral permission treatment; no direct AntD Empty imports |
| Section 3.6 regressions | Pass | Flow canvas, charts, sidebar, gutter, log breadcrumb, alert fixture, and theme contrast corrections are covered by tests/capture checks. Keyboard-selected canvas nodes now synchronize with the inspector |
| Admin fixture | Pass | Admin routes contain real synthetic fixture content; capture assertions reject access-denied placeholders |
| Screenshots and overflow | Pass | Fresh 276 screenshots across 47 routes; light/dark at 1440/390; overflow sweep at 320/768/1024; 0 issues. Lookup hover contrast 16.72:1 light / 13.19:1 dark |
| Regression guard | Pass | `ui:ratchet` and theme freshness check pass |
| Verification gates | Pass | 154 test files / 608 tests; `npx tsc --noEmit`; lint and ratchets; production build; Astryx doctor from prior verified run; browser capture. Existing lint/test warnings and bundle-size advisory are documented |
| Documentation | Pass with discovery discrepancy | Design rules, decisions, gaps, progress, and this final report are present; root `AGENTS.md` contains the Astryx v0.7.17 guide, though `astryx doctor` did not detect it |

## Verification Run

- `node scripts/ui-metrics.mjs`: 0 feature-level AntD imports for the targeted controls; no direct AntD icon imports; 0 inline font-size literals; 0 raw inline spacing numbers; 301 inline style objects in 111 files; 0 hex literals; 46/46 product routes use `PageTemplate`.
- Static-style audit: `staticInlineStyleObjectCount=0`; formerly literal-only style declarations are in a shared stylesheet. Remaining inline styles are expression/data-driven by the AST heuristic.
- `cd frontend && npx tsc --noEmit && npm test -- --reporter=dot`: TypeScript passed; 154 files / 608 tests passed.
- `cd frontend && npm run build`: TypeScript and Vite production builds passed. Vite reports the existing 1.75 MB shared-chunk advisory.
- `cd frontend && npm run lint`: passed, including UI ratchet and Astryx theme freshness. Biome reports 16 non-blocking warnings.
- `cd frontend && npx @astryxdesign/cli@0.7.17 doctor`: 11 checks passed, 0 failures. It reports that it cannot detect agent docs, although the repository-root `AGENTS.md` already contains the complete Astryx v0.7.17 instructions; this appears to be doctor discovery behavior, not missing guidance. No CLI init was run to avoid rewriting owner-maintained instructions.
- `npx tsc --noEmit`: passed.
- `cd frontend && REVIEW_OUTPUT_DIR="$PWD/medics-screen-review/after/ui-overhaul-final-2026-11-25-r4" npm run capture:review`: 47 routes, 276 screenshots, 0 capture issues, no horizontal overflow at 320/768/1024, lookup-hover contrast passed, admin content checks passed.
- Focused post-capture checks: ModernTable routes, 23 screenshots across four routes, 0 issues; Logs settled-count check, 8 screenshots, 0 issues or warnings. The Logs summary matched the synthetic fixture at Total 2 / Delivered 1 / Failed 1 / Skipped 0 / Pending 0.
- Targeted local-browser accessibility smoke: first Tab reaches Astryx `AppShell` skip link, Enter focuses its generated main target, Create opens from keyboard and closes with Escape, and `prefers-reduced-motion: reduce` disables the dashboard entrance animation. The inbound configuration tablist is reachable by keyboard; ArrowRight moves focus and Enter activates the next panel.

The final browser capture recorded 114 non-fatal console warnings, predominantly AntD deprecations and existing React form lifecycle warnings. They did not produce capture errors or failed assertions and are preserved in the capture report. This run is not described as warning-free.

Representative desktop, narrow mobile, light, dark, and lookup-hover captures were visually inspected. The lookup row/card foreground remains readable when hovered in both themes. All generated screenshots use the synthetic local fixture and fictional data. Keyboard traversal reached Logs filters and Flow Builder canvas nodes; Enter opens the selected node inspector after the synchronization fix. Broader assistive-technology coverage remains a residual verification risk.

## Compatibility Boundary

This is a controlled migration boundary, not a claim that every AntD component has native Astryx parity. Form, input, selection, modal, drawer, table, date, tooltip, and some layout behaviors remain AntD-backed behind common adapters where parity has not been established. The 539 compatibility Button JSX instances route through the shared Astryx-backed compatibility component; they are not direct AntD imports. The one remaining Tag JSX use is in a generic animation component and is not a route/feature status chip. There are 301 expression/data-driven inline style objects and no literal-only style objects. See [design-system-gaps.md](design-system-gaps.md) for reasons and known fallback behavior.

## Capture Artifacts

Screenshots and machine-readable checks are in [the final review capture directory](../frontend/medics-screen-review/after/ui-overhaul-final-2026-11-25-r4/README.md). The report contains route-level warnings, mobile chrome checks, contrast details, and overflow sweep results.

## Release Boundary

This is a completed frontend overhaul on the review branch, ready for human review, not a deployment. Validation and production were not accessed. No backend files were modified. The capture directory uses local synthetic fixtures only. Remaining known limitations are centralized AntD compatibility behavior, 16 existing lint warnings, 114 non-fatal browser warnings, and the existing large shared-chunk build advisory; none failed the required gates.
