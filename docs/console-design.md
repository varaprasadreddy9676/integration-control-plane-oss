# Console Design Rules

This document is the product UI contract for the medics Integration Gateway console. Implementation progress and evidence belong in [ui-overhaul-progress.md](ui-overhaul-progress.md) and [ui-overhaul-report.md](ui-overhaul-report.md); this file is not a release diary.

## Design System

- Astryx is the source for components, type, spacing, color, radius, and theme behavior. Use the shared adapters in `src/components/common` only where legacy behavior has not yet reached parity.
- Keep one light/dark mode mechanism through the Astryx theme provider. Derive compatibility tokens from the same theme; do not create page-specific palettes.
- Use Inter for interface text and JetBrains Mono with tabular figures for identifiers, code, and operational numbers.
- Type scale: caption 12px, body 13px, control 14px, section 16px, title 20px, numeral 24px. Do not introduce per-component font-size values.
- Use 4px spacing increments, typically 8px within controls and 12-16px between related groups. Route content aligns to the shared 24px page gutter.
- Controls use 4px corners; genuinely framed tools and overlays use at most 8px. Page sections, rows, and tables do not float on decorative shadows.

## Page Structure

- All 46 product routes use `PageTemplate`; console routes use its shared `PageHeader`, title scale, and content gutter, while documentation and portal-launch states use the same frame without console navigation. The standalone login route is outside that product-route matrix but follows the same type, color, keyboard, and responsive rules.
- Keep the global shell to one organization selector, one search entry point, one Create menu, and the primary navigation. Do not repeat navigation in a Recent section.
- The shared top header uses one control height and centerline. Let search flex between the organization selector and utility actions; compact other labels at tablet/mobile widths before controls wrap or clip. Keep the labeled Logout button visible immediately after the account name on every viewport rather than only in a menu.
- Configuration pages are for configuration: do not add delivery statistics, logs, quotas, or redundant explanatory copy to them.
- Use rows and tables for dense operational records. Reserve cards for individually framed tools or discrete summaries, not nested card collections.
- Keep primary actions visually consistent and obvious. A page should have one clear primary action; secondary actions must not compete through equal emphasis.

## Language and Status

- Use concise, product-neutral language and sentence case. Say “step”, not “stage”, in user-facing copy.
- Metadata is neutral. Use status color once, for an actual lifecycle or health state; zero and unknown values are neutral. Direction alone does not make a trend good or bad.
- Status labels use the agreed vocabulary and sentence case. Do not encode status through uppercase chips or duplicate the same status color in a badge, icon, border, and number.
- Empty states explain what is absent and, when useful, give a recovery action. Permission denial is a neutral notice, not an error.

## Interaction and Accessibility

- Preserve visible keyboard focus, skip navigation, keyboard-operable menus/tabs, semantic labels, accessible names for icon-only controls, and reduced-motion preferences.
- Unsaved-change prompts remain predicate-based: prompt only when the current form differs from its saved state.
- Use motion as brief interaction feedback (150-250ms opacity or transform), never ambient animation. Empty/loading/error states use the shared `StatePanel` with a small monochrome glyph.
- Keep form defaults sensible and expose advanced options progressively where that reduces configuration burden without hiding required behavior.
- At narrow widths, controls and actions wrap deliberately, dense tables use their supported responsive mode, and no page may create horizontal document overflow.
- Delivery-log details open in a right-side drawer without dimming the retained table. Diagnostic code stays scrollable/selectable with line numbers, readable token colors, and copy actions that do not cover the first line; absent payloads use an explicit empty state.

## Verification

The active acceptance matrix, remaining design-system gaps, and measured migration status are tracked in `docs/ui-overhaul-progress.md`, `docs/design-system-gaps.md`, and the final `docs/ui-overhaul-report.md`. Do not treat a successful build or screenshot capture alone as visual acceptance; inspect representative light/dark and narrow/desktop states and record unresolved fixture or environment limits.
