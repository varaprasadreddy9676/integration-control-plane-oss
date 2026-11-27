# Console redesign: direction and rules

Status: **implemented** on branch `ui/ledger`. This document replaced the former `console-design.md`
(removed) and supersedes the challenger note in
[console-design-challenger.md](../console-design-challenger.md). What shipped, and the evidence for
it, is in [redesign-progress.md](redesign-progress.md) and
[redesign-cutover.md](redesign-cutover.md). Nothing has been deployed.

Date: 2026-11-27 · Branch: `ui/ledger` · Owner decision: the agent decides, the owner reviews the pilot.

---

## 1. The problem this must solve

The last overhaul hit 20/20 acceptance targets and still reads as "generic and unfinished". The
diagnosis, in one line: **it changed the skin of an unchanged information architecture**, and it was
judged on countable absence (zero imports, zero literals, zero overflow) rather than on whether a
screen tells an operator what is happening.

Three complaints drove this direction:

1. It looks generic and unfinished — the visual language is the default indigo/blue SaaS admin.
2. The technical cost is unacceptable — 9,276 lines of hand-written theme CSS, 352 `.ant-*` rules,
   759 `!important`, 174 files still importing the AntD compatibility boundary.
3. The details are sloppy — three button styles on one screen, per-field Save buttons, dangling
   separators, empty panels, inconsistent emphasis.

Every decision below is aimed at one of those three, and each one has a way to check it.

## 2. The decision

**Ledger** — a light-first, near-monochrome operations console where **status is the only colour**.

> A monitoring product's colour has to mean state. The moment the primary action is blue, the
> navigation is indigo and the failures are red, colour stops carrying information. So: ink for
> actions, paper for surfaces, hairlines for structure, and chroma reserved for delivered / failed /
> skipped / warning. If something is red, it failed. If it is not red, it did not.

That single rule produces the distinctiveness the console lacked, without decoration:

- Primary buttons are **ink**, not brand-coloured. The only coloured pixels on a normal screen are
  status dots, one failed number, and the chart's one red annotation.
- The shell is **paper** (`#F6F5F1`), surfaces are **white**, and everything is separated by 1px
  hairlines. No shadows on page sections, no gradients, no floating cards.
- **Inter** carries text; **JetBrains Mono with tabular figures** carries every number, identifier,
  event name and HTTP code. That is the product's voice: precise, measured, not chatty.
- Density is an operator's density: 32px controls, 34–38px rows, a 24px page gutter, 4px spacing
  steps — but the *composition* fills the width with real content instead of one card in a void.

**Themes extend this rule; they do not break it.** Status colour is reserved everywhere: an accent may
colour an action, never a status. In Ledger the action is ink; the other packs use one accent whose
distance from delivered, failed and skipped is verified before it can be applied (§7).

Why not the "Signal" proposal (peridot green primary): in this product **green means delivered**. A
green primary button next to a green success badge makes the most important colour in the console
ambiguous, and its own document has to special-case it. Ink primary avoids the collision entirely and
is more distinctive than another accent colour.

## 3. Tokens

Names are semantic; values are the light / dark pair. No route may use a literal colour.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--paper` | `#F6F5F1` | `#0F1113` | Workspace behind content |
| `--surface` | `#FFFFFF` | `#17191C` | Panels, rows, inputs |
| `--surface-2` | `#FBFAF7` | `#1C1F23` | Table headers, hover |
| `--sunken` | `#EEECE4` | `#212529` | Tracks, inactive fills |
| `--ink` | `#17191C` | `#ECEDEE` | Text, primary button |
| `--ink-2` | `#5B6067` | `#A3A9AF` | Secondary text |
| `--ink-3` | `#878C92` | `#7D848B` | Labels, captions |
| `--line` | `#E4E2DB` | `#2A2E33` | Structure |
| `--line-strong` | `#CFCCC2` | `#3A3F45` | Control boundaries |
| `--data-1` | `#17191C` | `#CFD4D9` | The single data series |
| `--ok` / `--ok-bg` | `#0E7A4B` / `#E7F3ED` | `#6ECF9D` / `#16291F` | Delivered, healthy |
| `--warn` / `--warn-bg` | `#8A5A00` / `#FAF0DA` | `#E8B464` / `#2B2214` | Skipped, needs a decision |
| `--err` / `--err-bg` | `#B3261E` / `#FAE9E7` | `#F08A80` / `#2E1A18` | Failed, destructive |
| `--info` / `--info-bg` | `#2F4E8C` / `#E9EDF6` | `#9DB4E8` / `#1A202E` | Informational only |

Rules that follow from the palette:

- Status is **dot + sentence-case label**, coloured once. Never a coloured pill plus a coloured row
  plus a coloured number for the same fact.
- Trend deltas are neutral ink-3. Only a metric with a defined good direction may use colour, and
  always with a sign and a unit.
- Zero and unknown are neutral. No zero-count chips, no "Unknown" badges.
- One chart series is `--data-1`; failures are the only other chroma on a chart.

## 4. Type and space

| Role | Size / line | Weight | Face |
|---|---|---|---|
| Caption / label | 11/16, uppercase 0.06em | 500 | Inter |
| Body / table | 13/20 | 400 | Inter |
| Control | 13/20 | 500 | Inter |
| Section | 14–15/20 | 600 | Inter |
| Page title | 24/30, −0.02em | 600 | Inter |
| Metric | 30/34 | 500 | JetBrains Mono, tabular |

- One page-title size. No 16/18/20/24 variants, no per-route sizes.
- Numbers are mono and tabular; units sit beside the value in 13px ink-3.
- Spacing: 4/8/12/16/24/32/40. Control height 32 (34 in the header), row height 34–38, page gutter 24,
  panel padding 16, radius 6 (controls) / 8 (panels) — never 12+.

## 5. Structure

**Shell.** A 232px labelled rail on paper, full height, hairline right edge; the top bar belongs to the
content area, not the rail. One organisation switcher, one search, one Create menu, one status link
("3 failed"), one account menu. No page-level "New integration", no "Recent" block, no repeated
organisation.

**Page grammar.** Breadcrumb only on nested pages. Title, optional segmented *view* switch (max 3), one
meta line, actions on the right: at most one primary (ink), two secondary (outline). Filters never live
in the same row as views.

**Dashboard.** One screen, no tabs. Metric strip (Deliveries, Success rate, Failed, p95) → trend with a
single failure annotation → "Needs attention" ranked by failure count → outcome mix + provider table.
Every number on the strip is defined once and reused on the views it opens.

**Integration detail.** No tabs. One document of six sections (Delivery, Trigger, Target and
authentication, Transformation, Reliability, Follow-up) with a sticky context rail: last 24h, recent
runs, connection, versioning note. The page answers *what is this, is it healthy, what happened last,
what do I change* in the first viewport.

**Logs.** Master–detail: filterable list, inspector on the right at ≥1280px, full-width inspector on
phones. Counts are plain text in the toolbar; no five-pill row; no sort arrows until hover.

**Lists and settings.** One toolbar row; status dot + label; row actions as one inline action plus a
kebab; settings have a single sticky save bar, never per-field Save.

**States.** Empty, loading, error and denied are compositions (one sentence, one action, one small
glyph), not a void and not a stock "No data" illustration. Denied is neutral, not red.

## 6. Motion and interaction

Motion is a receipt, not decoration. Every animation must answer one of: *what changed*, *where did it
come from*, *what is alive right now*. If it answers none, it does not ship.

**Rules**

- Durations: 120ms micro (hover, press), 180ms enter, 240ms panel, 320ms overlay. Easing
  `cubic-bezier(0.2, 0, 0, 1)` in, `cubic-bezier(0.4, 0, 1, 1)` out.
- Animate **transform and opacity only** — never width, height, top or left. The palette, the
  segmented thumb and the timeline all move by transform.
- **One looping animation per view**, and only for something genuinely live: a delivery in flight, a
  step retrying. Nothing pulses to look busy.
- `prefers-reduced-motion` collapses every duration; state still changes by colour and label. Motion
  is never the only carrier of meaning.
- Keyboard parity: the chart and the timeline are focusable, arrow keys move the cursor, Escape closes
  overlays, focus rings never animate away.

**The interactions that earn their place**

| Where | Interaction | Why it is not decoration |
|---|---|---|
| Anywhere | `⌘K` palette, grouped, keyboard-driven | Operators live on the keyboard; one entry point replaces the duplicate search fields. |
| Trend | Crosshair + tooltip (delivered / failed / p95), click to pin, then **View logs** | Turns the chart into the entry point of the investigation it depicts. |
| Integration | 60-run latency strip; hover for the run, click to pin, **Open run** | The trace is the product's core object; a compact history reads faster than a table. |
| Provider table | Per-row sparkline | Tells a blip from a trend without a second chart. |
| Segmented controls | Sliding thumb | Confirms the active view in one movement instead of a repaint. |
| Live states | One pulsing ring on "Retrying" / "in flight" | Separates *in progress* from *stuck* at a glance. |
| Metrics | 460ms count-up on arrival, reduced-motion aware | Pulls the eye to the figure that changed on refresh; always settles on the true value. |
| Theme | View Transition crossfade | The switch reads as one surface changing rather than a flash. |

**Rejected on purpose:** parallax, 3D tilt, glow or gradient buttons, confetti, ambient loops, spring
bounces, counters that re-animate on every poll, glassmorphism panels. Each would either break the
"status is the only colour" rule or date the console within a year.

**Constraint that follows:** the count-up must never misrepresent a figure — it settles on the true
value, keeps the unit, and never animates a percentage without its denominator.

## 7. Themes and preferences

One fixed look is one opinion, and this console has three audiences: operators on call, integrators
building flows, and healthcare admins checking delivery. Appearance is therefore a preference — but a
bounded one.

**Principle.** A theme is a **token set**, never page CSS. Layout, hierarchy, type scale, spacing,
status vocabulary and motion are identical in every pack; only values change. A pack may retune a
status colour, never its meaning, its order, or the rule that status is the only chroma.

**Five packs**, each with a light and a dark variant:

| Pack | Character | Designed for |
|---|---|---|
| **Ledger** | Warm paper, ink actions, hairline structure | The default. Reading and reviewing. |
| **Graphite** | Cool neutral, tighter, no warmth | Long shifts on a terminal-adjacent screen. |
| **Cobalt** | The familiar enterprise blue, done without the noise | Teams migrating from the old console. |
| **Midnight** | Dark-first, luminous data on deep slate | NOC / on-call walls and low-light rooms. |
| **Contrast** | Pure black on white, 2px rules, no faint greys | Accessibility and projection. |

**Axes.** theme × mode (light / dark / system) × density (comfortable / compact) × corners (soft / sharp),
plus an action colour: theme default, blue, violet, teal, or custom. Forty combinations before the
custom accent, all sharing one layout.

**Guardrails, enforced rather than documented:**

- Every pack passes seven contrast pairs — primary, secondary and muted text; action on page; delivered,
  failed and skipped on surface — at 4.5:1 for text and 3:1 for UI. All ten theme × mode combinations
  pass today; the muted label was darkened in four packs to get there.
- The action colour must be **distinct from all three status colours** (RGB distance ≥ 80). A custom
  colour that drifts toward red is flagged as "needs attention" with the colliding status named, not
  silently accepted.
- The action's label colour is computed from its luminance, so a custom accent can never produce
  unreadable button text.
- The Contrast pack raises rule weight to 2px and removes faint greys instead of leaning on colour.
- Packs remain **semantic tokens only** — the 80-entry legacy alias layer is still deleted, and no pack
  may introduce a route-specific override.

**Scope.** The preference belongs to the user and is stored with the profile (localStorage in the
reference). An admin can publish an organisation default; individuals may override it. Appearance is
never stored in integration data, and never deployed per environment.

**What this refuses to do.** No free-form CSS, no per-page palettes, no user-supplied fonts, no
arbitrary radii per component. If a request needs one of those, it is a new pack with the same
guardrails — not an override.

## 8. What gets deleted

- The indigo rail, blue primary, and the pink "1 failed delivery" chrome button.
- Card shadows on page sections; gradient hero on login; decorative gradients anywhere.
- The "Manage Integrations →" pill beside page titles; chips beside titles; completion checkmarks on tabs.
- The nine-tab strips (dashboard, integration detail) and the "Layout: Classic | Steps" header toggle.
- Zero-count chips, sort arrows on every column, per-field Save buttons, "Unknown" chip soup.
- The 9,276-line override sheet, per the technical plan below.

## 9. Technical plan (this is where the last attempt failed)

**Astryx stays the component source; the override sheet does not.**

1. **Stop fighting AntD with CSS.** Keep AntD *only* where Astryx has no behavioural parity (Table,
   Select, DatePicker, Modal, Drawer). Theme those through `ConfigProvider` tokens — one mapping file.
   Cap the remaining compatibility stylesheet at **200 lines, zero `!important`**. Every migrated
   control deletes its `.ant-*` block in the same commit; `!important` and CSS line count become
   ratcheted, shrinking budgets.
2. **Build the primitives we actually use** in `src/design-system/primitives` (Button, Field, Table,
   StatusBadge, Panel, Toolbar, EmptyState, Inspector) against the tokens above. Routes import those,
   never a library.
3. **Delete the alias layer.** `legacyColorAliases` (80 `--color-*` → `--color-*` indirections) goes;
   tokens are semantic and used directly. Target: theme CSS < 1,500 lines.
4. **Fix the known landmines while in there:** `vite.config.js` shadowing `vite.config.ts`, the
   `__KEEP_` sentinel in route params/types/query strings, the stale `ui-metrics-baseline.json`, and
   the `/versions/:name/compare/...` dead end.

## 10. How this avoids the last failure

| Last failure | Countermeasure |
|---|---|
| Success was countable absence | Acceptance is **task-based**: on the dashboard, a person finds the failing provider and opens its logs in ≤10s; on an integration, they read health + last run + target without opening a tab. |
| No design direction | This document. Every screen decision traces to §2's rule, and the owner signs off once, on the pilot. |
| IA frozen as "do not revisit" | IA is in scope; the nine-tab strips are gone by design. |
| Verified on 2-row fixtures | Fixtures must include failures, long names, empty states, 200-row tables and both themes before a screen is reviewed. |
| Screenshots counted, not judged | A 5-point rubric per screen (hierarchy, first-viewport answer, density, one primary action, state composition), scored by the owner on three screens before any family migration. |

## 11. Phases and exit criteria

0. **Freeze** — no new CSS overrides, no new colour aliases. Exit: this doc approved.
1. **Contract** — prototype reviewed (this folder). Exit: direction signed off or revised once.
2. **Foundations** — tokens, primitives, shell rebuilt in-app; old chrome deleted. Exit: shell renders
   on every route with no AntD override needed for chrome; `!important` count falling.
3. **Pilot** — Dashboard + Integration detail for real, wired to the real APIs, behind a flag. Exit:
   task test passed, rubric scored ≥4/5, no visual regressions in the rest of the app.
4. **Families** — Logs, lists, settings/admin, flow builder, docs/login. Exit: each family passes the
   same rubric; CSS budget shrinks per family.
5. **Cleanup** — dead CSS gone, sentinel and config fixed, docs updated, capture harness extended with
   the task checks. Exit: budgets met, gates green.

## 12. Risks

- **Two directions in the tree** during the pilot. Mitigation: flag, one route at a time, no partial
  screens.
- **AntD parity gaps** on Table/Select/DatePicker could force more CSS than the 200-line cap.
  Mitigation: the cap is a ratchet, not a cliff — exceed it only with a recorded decision.
- **Taste is not measurable.** Mitigation: one human sign-off on three screens, early, instead of 311
  commits and a green dashboard.
- **Scope.** This is a full redesign; phases 2–4 are weeks, not hours. The pilot exists so the cost is
  visible before the family migration starts.

## 13. Reference material

The hand-written prototype that fixed this contract (`redesign/*.html`, its CSS/JS and fonts) has
been **removed**: the implemented console now *is* the reference. The 29 captures under
`docs/design/redesign/shots/live/` are taken from the running application and are the visual
evidence for every claim above.

Where to look instead:

- `docs/design/redesign-cutover.md` — the measured definition of done and the accepted exceptions.
- `docs/design/redesign-progress.md` — what shipped, round by round, with the fixes that came out of
  the audits.
- `docs/guides/BRANDING.md` — how a fork or an organisation changes product name, wordmark, logo,
  themes, density, corners and action colour.
