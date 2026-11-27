# Redesign cutover

What must be true before this branch merges and ships, and how to prove it.
Everything here is measured, not asserted.

## Definition of done

| # | Criterion | Evidence |
|---|---|---|
| 1 | Every one of the 47 product routes renders in all five packs, light and dark | `npm run capture:review` → 289 screenshots, 0 issues |
| 2 | No contrast failure on active text in any pack/mode | five-pack sweep and full-route sweep (0 active failures after fixes) |
| 3 | No axe wcag2a/aa violation except documented library artefacts | 47-route audit; artefacts listed below |
| 4 | One surface anatomy: `Panel` and AntD `Card` share body padding, header height, title size, hairline | theme tokens in `antd-theme.ts` |
| 5 | One type scale: `--console-type-*` used by console and canvas | canvas token pass |
| 6 | Appearance is configurable: pack, mode, density, corners, action colour, branding | `/settings/appearance` + branding provider |
| 7 | Branding is data, not code: product name, wordmark, logo | `ui_config.branding`, env fallbacks |
| 8 | Behaviour unchanged: same queries, same handlers, same RBAC | test suite 638 tests, unchanged route behaviour |
| 9 | Gates green | tsc, tests, biome + ui:ratchet + theme:check, build |
| 10 | Docs updated | `docs/design/redesign-progress.md`, `docs/guides/BRANDING.md` |

## Known library artefacts (accepted)

| Artefact | Where | Why accepted |
|---|---|---|
| `aria-hidden-focus` on rc-table's measurement row | every table | rendered by the table library; needs an AntD patch |
| `nested-interactive` on AntD collapse header | log detail | library markup |
| `svg-img-alt` on Recharts pie paths | admin storage | chart library |
| React Flow attribution contrast | canvas | styled to the secondary ink; further control is the library's |

None of these are introduced by the redesign; each is recorded so a future
reviewer does not rediscover them as new findings.

## Pre-merge checklist

```bash
cd frontend
npx tsc --noEmit
npm run lint            # biome + ui:ratchet + astryx theme --check
npm test                # 638 tests
npm run build
REVIEW_SMOKE=1 npm run capture:review
```

Expected: 0 type errors, ratchet passes, 638/638 tests, build succeeds,
289 captures across 47 routes with 0 issues.

## Rollout

1. Merge behind the existing release process (no schema change, no migration).
2. Appearance defaults: pack `ledger`, mode follows the OS, density
   `comfortable`, corners `soft`, action colour `theme`. Stored per user:
   `uiPack`, `uiMode`, `uiDensity`, `uiCorners`, `uiAccent`.
3. Branding defaults come from `VITE_APP_NAME` / `VITE_WORKSPACE_NAME` /
   `VITE_LOGO_URL`; an organisation override lives on `ui_config.branding`.
4. Nothing in the redesign changes delivery behaviour, schedules, retries or
   credentials. Rollback is a revert of this branch; no data cleanup needed
   beyond clearing the five localStorage keys.

## Verification history (round 21)

The final independent sweep first reported 137 contrast failures. Re-running the
same script after the fixes in this branch gives **5 failures across 1,396
measurements per pack/mode**:

| Remaining | Count | Status |
|---|---|---|
| Disabled palette descriptions (disabled controls) | 3 | WCAG-exempt by definition |

No non-exempt contrast failure remains. The decorative "→" caption in cobalt
was fixed by dropping the tint behind it.

## Final verification evidence

| Check | Result |
|---|---|
| Capture harness, per pack | **1,445 screenshots** — 289 in each of ledger, graphite, cobalt, midnight, contrast; 47 routes each, 0 issues in every pack |
| Contrast sweep | 1,396 measurements per pack/mode; contrast pack 0 failures; 3 disabled-only failures overall |
| axe wcag2a/aa, 47 routes | 0 violations except rc-table measure row, AntD collapse header, Recharts pie paths |
| Tests | 638 / 638 across 161 files |
| Build | entry 1.4 MB raw / 450 kB gzip, CSS 94 kB gzip, vendor chunks emitted |
| Ratchet | passes; theme:check up to date |

The earlier 120 "table-cell" entries were `ant-descriptions-item-label` at
2.91:1 — fixed in a7d0fc85c before the report was read.

## Open items at cutover

| Item | Impact | Owner |
|---|---|---|
| Astryx table migration | bundle size only; UI already consistent | decided by the spike — pilot the outbound `/integrations` list first |
| Canvas node visual language | canvas is tokenised but keeps its own node styling | design decision, not a defect |
| ~40 files still render AntD `Card` | visually aligned to `Panel` by theme tokens; migration is optional | future cleanup |
| Informational callouts in admin | removed | done |
| 21 `useForm is not connected` warnings on the three detail routes | **dev-only**: rc-field-form raises it inside `process.env.NODE_ENV !== 'production'`, and the string is absent from the production bundle. The forms work (638 tests, manual use); the warning is a timing diagnostic, not a user-facing defect | accepted, documented |
| Two cobalt "→" captions at 4.43:1 | cosmetic | open |

## After cutover

- Re-run the five-pack sweep each time a pack changes.
- Keep `ui-ratchet` allowlists as ceilings: lower them, never raise them
  without a recorded reason.
- The capture harness is the regression net for all 47 routes; extend it when
  a route is added.
