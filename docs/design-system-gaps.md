# Design System Gaps

This document is the local inventory of Ant Design controls that remain because Astryx does not yet provide equivalent behavior or accessibility. Do not use `npx astryx gap-report`; this inventory is maintained in-repository.

## Current status

The inventory was rechecked against the final application-source import scan on 2026-11-25. Feature and route code does not import Ant Design directly. Runtime compatibility is confined to `LegacyAntdControls`, `LegacySpace`, and the derived theme mapping in `design-system/theme/antd-theme.ts`. The wrappers preserve behavior where Astryx parity has not been proven; the rationale and known fallback behaviors are listed below.

The AST scan confirms there are no direct Ant Design component imports in application features; the remaining runtime dependency is behind the shared compatibility adapters and the single derived theme mapping. This is boundary centralization, not a claim that every AntD control has native Astryx parity. Consumer counts are intentionally omitted because they change as call sites migrate; `node scripts/ui-metrics.mjs` is the current count source.

| Component | Wrapper | Gap / reason | Status |
|---|---|---|---|
| Tabs | Native `TabList` via `RetainedTabs` for multi-panel forms and dynamic delivery details | Logs and Scheduled Job Detail use controlled Astryx tabs with stable panel IDs, retained visited panels, dynamic-tab fallback, disabled-step guards, and mobile wrapping where needed. | Migrated; 0 route/feature AntD imports |
| Typography | `LegacyTypography` | Remaining shared compatibility use is backed by Astryx `Text`, `Heading`, and `Button`; it preserves expandable paragraphs, copy actions, and status colors. | 0 route/feature AntD imports; adapter tests pass |
| Form | `LegacyAntdControls` | AntD form state, validation, and field composition are preserved behind the common boundary; no feature imports AntD Form directly. | Centralized compatibility; deeper field-by-field parity is not claimed |
| Input | `LegacyAntdControls` | Text, numeric, textarea, password, and addon behavior remain AntD-backed where caller parity is not established. | Centralized compatibility |
| Select | `LegacyAntdControls` | Searchable, async, multi-select, and keyboard behavior remain AntD-backed where caller parity is not established. | Centralized compatibility |
| Modal | `LegacyAntdControls` | Focus trap, escape handling, and unsaved-change guard behavior remain unchanged behind the boundary. | Centralized compatibility |
| Drawer | `LegacyAntdControls` | Responsive sizing, focus management, and nested overlays remain unchanged behind the boundary. | Centralized compatibility |
| Table | `ModernTable` / `LegacyAntdControls` | `ModernTable` is the app-facing table wrapper; advanced table behavior remains behind the common boundary. | Centralized compatibility |
| DatePicker | `LegacyAntdControls` | Timezone, range, and keyboard behavior remain AntD-backed where caller parity is not established. | Centralized compatibility |
| Tooltip / Popover | `LegacyAntdControls` | Accessible naming, focus/hover behavior, and dismissal remain AntD-backed behind the common boundary. | Centralized compatibility |
| Switch / Checkbox / Radio | `LegacyAntdControls` | Existing form-state integration and accessible labels are preserved behind the common boundary. | Centralized compatibility |
| Space | `LegacySpace` | Explicitly sized common horizontal/vertical stacks, alignment, and wrapping render through Astryx `Stack`; provider-default sizing, split layouts, two-axis gap arrays, baseline alignment, and AntD-specific item styling retain the AntD fallback. | Partially migrated; fallback retained for compatibility |
| Card / Row / Col / Collapse | `LegacyAntdControls` | Layout and container behavior is centralized; use Astryx `Section` for page sections and discrete `Card` items where appropriate. | Centralized compatibility; no direct route AntD imports |

## Exit criterion

Do not claim native Astryx parity for a control while its compatibility implementation remains. Any new AntD use must go through these shared adapters, have a documented reason, and pass the ratchet and wrapper tests.
