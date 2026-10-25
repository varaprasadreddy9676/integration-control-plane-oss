# Workflow canvas — design specification

The visual workflow canvas for configuring, testing and monitoring an
integration's deliveries. This document is the complete specification: an agent
or engineer should be able to rebuild the design exactly from it, and then build
it into the console.

- **Design artifact (live):** https://claude.ai/artifact/7A4PTZKGGt7XBDQEb6VtuV
- **Exact source of every screen:** [`source/`](source/). These `.dc.html` files
  are the artifact's own files, and they are authoritative for every pixel value
  in this document. They use the Design Component format (an `<x-dc>` template
  plus a `class Component extends DCLogic` logic block); `{{ hole }}` values come
  from `renderVals()`. Read them as HTML/CSS with a small amount of templating.
- **Backend this design draws:** [`docs/architecture/pipeline-stages.md`](../../architecture/pipeline-stages.md)
  and `backend/src/stages/` on branch `feature/pipeline-stages`.

Contents:

1. [What the canvas is (and is not)](#1-what-the-canvas-is-and-is-not)
2. [Product rules the canvas must draw](#2-product-rules-the-canvas-must-draw)
3. [Screens in the artifact](#3-screens-in-the-artifact)
4. [Application layout](#4-application-layout)
5. [Design tokens](#5-design-tokens)
6. [Components](#6-components)
7. [Canvas geometry: the standard flow](#7-canvas-geometry-the-standard-flow)
8. [Screen-by-screen specification](#8-screen-by-screen-specification)
9. [Motion](#9-motion)
10. [Interaction behaviour for the real product](#10-interaction-behaviour-for-the-real-product)
11. [Building it into the console](#11-building-it-into-the-console)
12. [Acceptance checklist](#12-acceptance-checklist)

---

## 1. What the canvas is (and is not)

**It is** a projection of an integration's delivery pipeline: the event, the
request transform, the stages at their hooks, the send, the reliability policy and
the outcomes, drawn top to bottom. Selecting a step opens its configuration in an
inspector; switching to Executions shows the path one real delivery took.

**It is not** a free-form graph editor like n8n. Users never draw links. Branches
come from where a step runs (its hook) and what it may do (its effect), so every
branch on the canvas can really happen and every branch that can happen is drawn.
That is the core advantage and must be preserved:

| Differentiator | How the design shows it |
|----------------|-------------------------|
| Links can't be wrong | No link tool. Steps are added at valid insertion points only (the blue `+`), and step types that can't run there are shown disabled with the reason. |
| Branches tell the truth | The retry loop goes back to the top of the attempt, because a retry re-runs everything. A rejected answer leads to On failure. Skipped is neutral. |
| Live traffic per branch | Every connector label carries its 24-hour count (`Yes · 1,184`, `Rejected · 9`). |
| Change impact before save | Footer of the inspector: "Saving applies this to new deliveries. 41 scheduled checks already waiting keep the version they started with." |
| Outcomes read from code | The inspector's Outcomes list is read from the script (`return …` → continue, `fail(…)` → failure); the canvas draws one branch per outcome. |
| Honest data source | Every run is labelled Production data, Sample or Stand-in answers. |

---

## 2. Product rules the canvas must draw

These are the engine's real rules (from `backend/src/stages/` and
`backend/src/processor/delivery-engine.js`). If the engine changes, change the
canvas, not the other way round.

### 2.1 Where stages live

- A **delivery** is one send that gets its own delivery log.
- An integration that sends once keeps its stages on itself: `integration.stages`,
  `integration.send`.
- An integration with actions sends once per action, so each action keeps its own:
  `actions[i].stages`, `actions[i].send`. One action = one group on the canvas.
- Protocols: HTTP, HL7 (`kind: 'HL7_MLLP'`), and `kind: 'COMMUNICATION'` with
  channel EMAIL, SMS, WHATSAPP or PUSH. They all draw the same way.
- Inbound proxy integrations and scheduled jobs have no canvas (no stages).
- Stage IDs are unique across the whole integration.
- Frontend mirror: `frontend/src/features/stages/deliveryTargets.ts`
  (`deliveriesOf`, `protocolOf`, `requestParts`). Backend: `backend/src/stages/targets.js`.

### 2.2 The pipeline, top to bottom

| Band (label on canvas) | What runs | Node types |
|------------------------|-----------|------------|
| EVENT | the trigger: event type | Trigger |
| PREPARE | the request transform (builds the message) | Transform |
| BEFORE SEND | `before_send` stages, in order | HTTP request, Script, URL check; a stage with effect `gate` is drawn as a Gate |
| SEND | the delivery itself (target, auth: not a stage) | Send |
| — (right column) | the reliability policy (retries) | Retry policy |
| AFTER THE RESPONSE | `after_response` stages, in order | Script / Mapping; gate effect drawn as a Gate |
| LATER | `after_delivery` stages (scheduled checks) | Schedule |
| (right column) | `on_failure` stages | Notify (any runner, shown with the bell icon) |
| OUTCOME | terminal outcomes | Delivered, Skipped, Delivery failed |

### 2.3 Branches and their labels

| From | Outcome | To | Label (configure) | Notes |
|------|---------|----|-------------------|-------|
| Before-send gate | continue | next step down | `Yes` | A gate's `return {…}` |
| Before-send gate | `skip()` | Skipped (right) | `No` | Skipped is **neutral**; it never runs On failure. |
| Before-send gate | `fail()` | Delivery failed → On failure | (not drawn in the sample) | |
| Before-send gate | `fail(…, { retryDelivery: true })` with `allowDeliveryRetry` | Retry policy | | |
| Send | any answer | after-response stages | `Answered` | |
| Send | 5xx, 429, timeout, network error | Retry policy (right) | `Error` | 4xx fails at once (no retry). |
| Retry policy | attempt left | **top of the attempt** (Transform) | `Retry · new attempt` | Dashed, routed outside on the right. A retry re-runs the transform and every before-send stage (consent is checked again). |
| Retry policy | retries used up | On failure | `Exhausted` | Delivery status ABANDONED. |
| After-response gate | continue | Later | `Accepted` | |
| After-response gate | `fail()` | On failure | `Rejected` | Never resent unless the stage allows a resend (`allowDeliveryRetry`). |
| Later (schedule) | status with `done: true` | Delivered | `Read or delivered` | Checks observe only; they never change the delivery's outcome. |
| On failure | — | Delivery failed | (none) | |

An after-response stage runs only when there is an answer. In a timeout there is
no answer, so it is drawn **not taken**.

### 2.4 Change scope (drafts)

- Edits are a draft until **Save changes**.
- Saving applies to new deliveries. Scheduled checks already waiting keep their
  pinned definition (they can be moved with re-pin).
- Switching a stage off pauses its waiting checks; removing it cancels them.
- `stagesPaused` is one switch for all of an integration's stages.

### 2.5 What a stage sees

`delivery.request = { protocol, target, method, body }` and
`delivery.response = { protocol, ok, status, code, message, providerMessageId, headers, body }`.
`status` is the HTTP status (null otherwise); `code` is the answer's own code
(`200`, `SENT`, an HL7 ACK code such as `AA`). Inspector copy and starter scripts
use these names.

---

## 3. Screens in the artifact

All app screens are 1440 × 1024. The system board is 1440 × 1840. Board positions
are in [`source/canvas.json`](source/canvas.json).

| # | File | Theme | Mode | Shows |
|---|------|-------|------|-------|
| 1 | `Main.dc.html` | light | Configure | Selected after-response gate with inspector (Configure tab), unsaved draft, 24 h counts |
| 2 | `Execution.dc.html` | dark | Executions | A delivered run: path in mint, not-taken steps on a quiet dashed surface, Runs tab of the schedule step, trace drawer open |
| 3 | `Failure.dc.html` | light | Executions | Timeout ×3, retries exhausted, On failure ran; Send selected with cause, actions, attempts, cURL |
| 4 | `AddStep.dc.html` | light | Configure | Insertion preview (ghost step), valid `+` points, node library popover, "where a step can go" panel |
| 5 | `LargeWorkflow.dc.html` | dark | Configure | 3 actions as groups (one collapsed), outline with search, minimap, compact nodes at 55%, validation callout |
| 6 | `Motion.dc.html` | light | interactive | Selection, insertion, execution trace, save-failed and recovery |
| 7 | `System.dc.html` | light + dark | — | Node anatomy, types in both themes, states, connectors, tokens |
| — | `Node.dc.html`, `AppNav.dc.html`, `AppHeader.dc.html` | both | — | Shared components (imported by every screen) |

---

## 4. Application layout

```
┌────────┬───────────────────────────────────────────────────────────────┐
│        │ Integration header (1224 × 108)                                │
│  Nav   ├──────────────────────────────────────────┬────────────────────┤
│ 216 px │ Canvas (flex)                            │ Inspector 400 px   │
│        │  top bar · tool palette · minimap        │  (when a step is   │
│        │                                          │   selected)        │
│        ├──────────────────────────────────────────┤                    │
│        │ Bottom drawer: 40 px collapsed, 180 open │                    │
└────────┴──────────────────────────────────────────┴────────────────────┘
```

- Root: `display: flex`, 1440 × 1024, background = canvas colour, `overflow: hidden`.
- Nav: 216 px wide, full height (collapsible to an icon rail in the product).
- Right column: header (108 px), then a row with the canvas `main` (flex 1,
  `border-right: 1px solid border`) and the inspector `aside` (400 px).
- With the inspector closed (screen 4), the canvas takes the full 1224 px.
- Canvas background: canvas colour plus a dot grid,
  `background-image: radial-gradient(<dot> 1px, transparent 1px); background-size: 16px 16px; background-position: 8px 8px`.

---

## 5. Design tokens

### 5.1 Typography

Fonts (Google Fonts):
`https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap`

- UI: `'Instrument Sans', ui-sans-serif, system-ui, sans-serif`
- Mono (identifiers, counts, code, timings, endpoints): `'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace`

| Role | Size / line | Weight | Other |
|------|-------------|--------|-------|
| System board H1 | 40 / 46 | 600 | letter-spacing −0.025em |
| Section heading | 22 / 28 | 600 | |
| Integration title (header) | 19 / 24 | 600 | −0.015em |
| Inspector title | 17 / 22 | 600 | −0.01em |
| Node title | 14 / 20 | 600 | ellipsis |
| Body / buttons / tabs | 13.5 / 20 | 400–600 | |
| Field labels | 12.5 | 600 | |
| Helper text | 12 / 17 | 400 | ink-2 |
| Eyebrow (node, inspector) | 11 / 14 | 500 | uppercase, letter-spacing 0.04em, ink-3 |
| Band labels on canvas | mono 12 / 16 | 400 | uppercase, letter-spacing 0.06em, ink-3 |
| Node summary | mono 11.5 / 16 | 400 | ink-2, ellipsis |
| Connector label | mono 11.5 | 400 | pill |
| Code block | mono 12 / 19 (inspector), 11.5 / 18 (cURL) | 400 | |

### 5.2 Colour — light

| Token | Value | Use |
|-------|-------|-----|
| canvas | `#F5F3EE` | canvas, page |
| dot | `#D6D0C4` | dot grid |
| surface | `#FFFFFF` | nodes, panels, header |
| surface-sunk | `#F7F6F2` | code blocks, inspector footer `#FBFAF7` |
| border | `#E2DED5` | hairlines (header `#E7E3DB`) |
| border-strong | `#C9C3B7` (node ports), `#D9D4CA` (inputs), `#CFC9BE` (dashed) | |
| ink | `#16171B` | text |
| ink-2 | `#45464D` | secondary text |
| ink-3 | `#66676E` | tertiary text (≥ 4.5:1 on white) |
| nav | `#1C1D21` | navigation background (text `#F1EEE7` / `#C9C6BF`, muted `#A8A6A0`, lines `#2E3035`) |
| accent (cobalt) | `#2B59E6` | selection, primary action, focus (soft `rgba(43,89,230,0.14)`, tint bg `#E8EEFD`, selected field bg `#F4F7FF`) |
| success | `#1E7A4C` | done; label pill bg `#E6F2EA`, text `#1E6B44` |
| danger | `#B42318` | failed; pill bg `#FBE9E7`, text `#9E1F15`; callout bg `#FDF3F1`, border `#F2C9C3` |
| warning | `#8F5400` | issues, unsaved; retry pill bg `#FDF0DC`, text `#7A4700`; retry line `#B4570B` |
| neutral | `#5D5E66` | skipped; pill bg `#EEEDEA`, text `#4D4E55` |
| connector | `#9C9688` | configured connectors |
| path (light execution) | `#45464D` | taken path |

### 5.3 Colour — dark

| Token | Value |
|-------|-------|
| canvas | `#131416`, dot `#2A2C30` |
| surface | `#1C1E21`; panels `#16181B`; deep code `#101113`; nav `#0F1012` |
| border | `#2E3136` (panel lines `#2A2D32`, inner `#24272B`), strong `#40444B` / `#3A3E44` |
| ink | `#EDEAE3`, ink-2 `#C2BFB7`, ink-3 `#97958F` (band labels `#8E8C86`) |
| accent (mint) | `#43D3B4`, soft `rgba(67,211,180,0.16)`, text on mint `#0B1F1A`; path labels bg `rgba(67,211,180,0.14)`, text `#8BE8D3` |
| success | `#5FD394` (chip bg `rgba(95,211,148,0.12)`, text `#8EE3B3`) |
| danger | `#F47C70` (soft `rgba(244,124,112,0.16)`) |
| warning | `#EDB95A` |
| neutral | `#97958F` |
| connector (unvisited) | `#3A3D43` dashed `4 4`; configured `#5A5E66` |
| not-taken label | text `#8E8C86`, border `#2E3136`, no fill (light: text `#66676E`, border `#E2DED5`) |
| not-taken surface | `#17191C`, dashed border `#3A3E44` (light: `#F8F7F3`, `#D3CDC1`) |

### 5.4 Type tints (icon tile only)

The tile background is the tint mixed at 10 % (light) or 16 % (dark):
`background: color-mix(in oklab, <tint> 10%, transparent)`; the icon stroke is the tint.

| kind | light | dark |
|------|-------|------|
| trigger | `#6A4BD6` | `#A893F5` |
| transform | `#4D5562` | `#A9B0BC` |
| http | `#2B59E6` | `#7EA2FF` |
| script | `#3D4451` | `#B5BCC8` |
| gate | `#9A5A00` | `#EDB95A` |
| send | `#1F4FD1` | `#86A8FF` |
| retry | `#B4570B` | `#F2A35E` |
| schedule | `#11756A` | `#4FD1C2` |
| notify | `#B2345E` | `#F28BAE` |
| done | `#1E7A4C` | `#5FD394` |
| skipped | `#5D5E66` | `#97958F` |
| failedEnd | `#B42318` | `#F47C70` |
| group | `#4D5562` | `#A9B0BC` |

### 5.5 Space, shape, elevation

- Spacing scale: 4 8 12 16 20 24 32 48.
- Radii: 6 control (segmented items, small buttons), 7–8 fields and buttons,
  9 top-bar controls, 10 nodes and minimap, 12 panels, groups and popovers,
  14 system-board panels, 999 pills.
- Elevation: e0 = border only; e1 (node) = `0 1px 2px rgba(22,23,27,0.06), 0 1px 1px rgba(22,23,27,0.04)` (dark `0 1px 2px rgba(0,0,0,0.4)`);
  e2 (popover) = `0 12px 32px rgba(22,23,27,0.12), 0 2px 6px rgba(22,23,27,0.06)`.
- Touch targets ≥ 36 px in dense tool chrome, 44 px for primary nav and org switcher.

### 5.6 Motion tokens

| Token | Value | Use |
|-------|-------|-----|
| `dur.hover` | 140 ms | hover and press colour changes |
| `dur.select` | 160 ms | node selection border/halo, status colour |
| `dur.insert` | 180 ms | ghost step appearing, popover entering |
| `dur.panel` | 220–240 ms | inspector slide and fade (`translateX(12–24px)` → 0, opacity 0 → 1) |
| `dur.settle` | 280 ms | steps making room, inserted step settling (`scale(.97)` → 1) |
| `dur.trace` | 320 ms | a connector being traced (`scaleY(0)` → 1 from the top) |
| `ease.enter` | `cubic-bezier(.2,0,0,1)` | everything entering or changing |
| `ease.exit` | `cubic-bezier(.4,0,1,1)` | leaving (exit ≈ 60–70 % of enter) |

- The only repeating animation is the running dot pulse (`opacity 1 → .35 → 1`, 1.4 s).
- `prefers-reduced-motion: reduce`: all durations 0, no pulse; every state also
  has a word (Running, Done, Saving…, Saved, Save failed).

---

## 6. Components

### 6.1 Node — `source/Node.dc.html`

Props: `kind` (table in 5.4), `eyebrow`, `title`, `summary`, `state`
(`'' | ok | failed | running | skipped | unvisited | off | issue | edited`),
`meta` (status text override, such as `212 ms`, `×3`, `READ`), `selected`
(boolean), `compact` (boolean), `theme` (`light | dark`).

Full node: 256 × 80, `box-sizing: border-box`, radius 10,
`padding: 12px 14px 0 14px`, `display: flex; gap: 12px; align-items: flex-start`,
background surface, border `1px solid border`, shadow e1. The root carries
`title="<full name>"`.

- **Icon tile:** 32 × 32, radius 8, tinted (5.4), 18 px stroke icon (stroke-width 1.75, round caps).
- **Text column:** flex 1, min-width 0, gap 2, three rows:
  1. **Eyebrow** (type · where it runs), one line, ellipsis.
  2. **Title.** One line, 14 / 20. Past **24 characters** (19 in compact) it wraps to
     **two lines** (14 / 18, clamped at 2) and is never cut short to make room.
  3. **Summary row** (mono 11.5): the summary (one line, ellipsis) and, at the end of
     the same row, the **status**. When the title is two lines there is no room for
     the summary, so the row is dropped and the status moves to the end of the
     eyebrow row.
- **Status:** dot (7 px) + word + metric, mono 11.5 / 14, weight 500, `gap: 6px`,
  `flex: 0 0 auto`; coloured by state. Hollow dot for skipped, off and not taken.
- **Ports:** 8 px circles, `border: 1.5px solid border-strong`, surface fill, centred
  at `top: -5px` and `bottom: -5px`. Trigger has no top port; done, skipped and
  failedEnd have no bottom port. (Dashed on a not-taken node.)

Compact (low zoom): 208 × 44, padding `0 26px 0 12px`, centred, 24 × 24 tile, title
only (13 / 16, bold; two lines past 19 characters, clamped), status as a dot at
`right: 12px` with `aria-label` and `role="img"`.

State styles:

| state | surface / border | shadow / other | status word (default) |
|-------|------------------|----------------|-----------------------|
| default | surface, `1px solid border` | e1 | — |
| selected (prop) | `1px solid accent` | `0 0 0 1px accent, 0 0 0 5px accent-soft` | — |
| running | `1px solid accent` | dot pulses | Running |
| ok (production) | default | — | `meta` or Done (success) |
| passed (test) | default | — | `meta` or Passed (success); never shown as Done |
| failed | `1px solid danger` | `0 0 0 3px danger-soft` | `meta` or Failed |
| skipped | `1px dashed border-strong` | hollow dot | Skipped (neutral) |
| off | `1px dashed border-strong` | hollow dot | Off |
| issue | default | — | `meta` or `1 issue` (warning) |
| edited | default | — | Edited (accent) |
| not taken (`unvisited`) | **quiet surface** (`#F8F7F3` / `#17191C`), `1px dashed` quiet border (`#D3CDC1` / `#3A3E44`) | no shadow; neutral icon tile at 8 %; title and summary in ink-3; **no opacity** | Not taken (hollow dot) |
| keyboard focus | — | `outline: 2px solid ink; outline-offset: 3px` on the wrapper | — |

Transitions: `box-shadow`, `border-color` and `background-color` 160 ms `ease.enter`.

Icons (24 × 24 viewBox, `fill="none" stroke="currentColor"`):

| kind | path data |
|------|-----------|
| trigger | `M13 2 4 14h7l-1 8 9-12h-7l1-8z` |
| transform | braces: `M8 3H6a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2 2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h2` + mirrored `M16 3h2a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2 2 2 0 0 0-2 2v4a2 2 0 0 1-2 2h-2` |
| http | globe: `circle 12,12 r9` + `M3 12h18` + `M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18z` |
| script | `m16 18 6-6-6-6` + `m8 6-6 6 6 6` |
| gate | `M12 3 21 12 12 21 3 12z` + `M12 8v4` + `M12 16h.01` |
| send | `M22 2 11 13` + `M22 2 15 22l-4-9-9-4z` |
| retry | `M3 12a9 9 0 1 0 3-6.7L3 8` + `M3 3v5h5` |
| schedule | `circle r9` + `M12 7v5l3 2` |
| notify | `M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9` + `M10.3 21a1.94 1.94 0 0 0 3.4 0` |
| done | `circle r9` + `m8 12 3 3 5-6` |
| skipped | `circle r9` + `M8 12h8` |
| failedEnd | `circle r9` + `m9 9 6 6` + `m15 9-6 6` |
| group | four `rect` 7 × 7 rx 1.5 at (3,3) (14,3) (3,14) (14,14) |

### 6.2 Navigation — `source/AppNav.dc.html`

Props: `theme`, `active` (`integrations | events | templates | scheduled | logs | settings`).

- 216 × 1024, flex column, background nav colour, `border-right: 1px solid` nav line.
- Brand row: padding `18px 16px 14px`; 28 × 28 mark (radius 7, `#F1EEE7` fill,
  three-node glyph in `#1B1C20`); "Integration Gateway" 14 / 18 / 600 `#F1EEE7`.
- Org switcher `button`: margin `0 12px 14px`, height 44, radius 8, border nav line;
  "Demo Clinic" 13 / 500 and mono 11 "org 500 · production" muted; up/down chevron.
- Items (`<a>`): height 36, padding `0 10px`, radius 7, gap 10, 18 px icon,
  13.5 px. Inactive `#C9C6BF` / 500. Active `#FFFFFF` / 600 with background
  `rgba(255,255,255,0.10)` (dark: `rgba(67,211,180,0.14)`). No left-border indicator.
  Order: Integrations, Event catalog, Templates, Scheduled jobs, Delivery logs.
- Bottom (after a flex spacer, top border): Settings and a "Collapse" button.

### 6.3 Integration header — `source/AppHeader.dc.html`

Props: `theme`, `title`, `subtitle`, `env`, `saveState`
(`unsaved | saving | saved | failed | clean`), `saveText`, `runState`
(`ok | failed | none`), `runText`.

- 1224 × 108, surface background, bottom border.
- Row 1 (padding `14px 24px 0 16px`), left: back button (36 × 36, bordered);
  title (19 / 24); **Enabled** switch pill (real `<input type="checkbox">` in a
  `<label>`, 24 px tall, track 24 × 14 in accent, thumb 10 px); run status
  (7 px dot + text, 12 px). The switch is configuration and the run dot is the
  latest execution: never merged into one indicator.
- Row 1, right: save state (`role="status"`, dot + text; a spinner while saving),
  History and Test (ghost buttons, 36 tall, radius 8), **Save changes** (primary,
  accent fill). With `mode="executions"` (read-only history) the save state is
  hidden and the primary button is **Edit workflow** (pencil icon), the way back
  into configuration; Save changes never appears over a past run.
- Save state colours: unsaved warning dot + ink-2 text; saving spinner + ink-3;
  saved success; failed danger.
- Subtitle row: subtitle · env badge (mono 11, bordered, radius 4).
- Row 2: section tabs (`<a>`, 34 tall, gap 22): Overview, Connection,
  **Workflow** (active: ink, 600, 2 px ink underline), Reliability, Activity.

### 6.4 Connector

One `<svg>` per connector, absolutely positioned in the canvas host. Straight
segment: 8 px thick box along the line. Bent connector: one svg covering the
bounding box. `fill: none; stroke-linecap: round; stroke-linejoin: round;
overflow: visible`. Filled arrowhead via a per-svg `<marker>`
(`markerWidth=5 markerHeight=5 refX=2 refY=2`, path `M0 0 L4 2 L0 4 Z`,
`fill: context-stroke`) with an id unique in the file. The path stops 3–4 px
short of the tip so the head sits on the end.

| Variant | Stroke | Width | Dash |
|---------|--------|-------|------|
| configured (light) | `#9C9688` | 1.5 | — |
| configured retry loop (light) | `#9C9688` | 1.5 | `5 5` |
| taken (light execution) | `#45464D` | 2 | — |
| taken (dark execution) | `#43D3B4` | 2 | — |
| led to failure | `#B42318` | 2 | — |
| retry taken | `#B4570B` | 2 | `6 4` |
| not taken (light) | `#CFC9BE` | 1.5 | `4 4`, no head |
| not taken (dark) | `#3A3D43` | 1.5 | `4 4`, no head |
| insertion preview | `#2B59E6` | 1.5 | `4 4` |

### 6.5 Connector label

`height: 20px; padding: 0 7px; display: flex; align-items: center;
border-radius: 999px; font: mono 11.5px; white-space: nowrap`. Placed 12 px to
the right of a vertical segment (centred on its middle), or 28 px above a
horizontal one, at the branch's source end, 8 px or more clear of every line
and node. Count after a middle dot: `Yes · 1,184`. Variants: success, neutral
(`No`), warning (`Error`, `Retry`), danger (`Rejected`, `Exhausted`),
plain (white, bordered: `Answered`), and unvisited (5.3).

### 6.6 Canvas chrome

- **Top bar:** absolute `left 16 / right 16 / top 12`, `justify-content: space-between`.
  - Left: mode segmented control (white, bordered, radius 9, padding 3; items 28
    tall, radius 6; active = ink fill with white text, mint in dark), then the
    search field (196 wide, 36 tall, "Search steps", `⌘K` hint) in Configure, or the
    run picker in Executions (‹ select › plus a "Production data" badge with a
    shield icon).
  - Right: zoom group (− 82% +), Fit, Tidy layout. Execution screens: Fit only.
  - Width budget: the top bar must fit 792 px (canvas width with the inspector
    open). Extra chips go into the bottom bar or the drawer header.
- **Tool palette:** vertical, absolute `left 16, top 300`, white, radius 10,
  padding 4, 36 × 36 buttons: Select (active: tint bg, accent icon), Pan,
  Add a step, divider, Undo, Redo.
- **Minimap:** 132 × 120 at `right 16, top 60`; small 34 × 7 bars for nodes, the
  selected one in accent; viewport frame `1.5px solid accent`, fill
  `rgba(accent, .05)`. It sits top-right so it never covers the bottom rows.
- **Bottom bar (collapsed drawer):** 40 tall, white, top border: "Execution
  trace", last delivery summary with status dot, connector-count note
  ("Connector counts: last 24 h, production"), Open button.
- **Drawer (open):** 180 tall; tabs Trace / Logs / Payloads (40 tall header)
  with the outcome chip at the right; Trace is a grid of `210px | 1fr | 72–96px`:
  step name, timeline bar (14 tall, radius 3), duration.

### 6.7 Inspector

400 wide, white, flex column.

- **Header:** padding `18px 20px 0`; 36 × 36 tinted tile, eyebrow, title (17 px),
  ⋯ button; tabs Configure / Test / Runs (36 tall, gap 20, active ink 600 with a
  2 px underline; Runs carries a count pill).
- **Body:** scrolls; padding `16px 20px 20px`; gap 18 between field groups.
- **Footer:** surface-sunk, top border; the change-scope sentence, then two
  buttons (Discard edits; Test this step, primary ink).
- Entering: `insp-in` 220 ms (`translateX(12px)`, opacity 0 → none).

---

## 7. Canvas geometry: the standard flow

All canvas content sits in one **host** element whose coordinates are fixed
(below), scaled by `transform: scale(z)` with `transform-origin: 0 0`, which is how
the zoom percentage is shown. Host size: 920 × 996.

### 7.1 Grid

- Row `r` top = `40 + r × 120`; node height 76 for connector maths (the node box
  is 80); centre y = top + 38; bottom = top + 76.
- Main column: `left 200`, width 256, right edge 456, centre x **328**.
- Right column: `left 560`, right edge 816, centre x **688**; its "thirds" on a
  top or bottom edge are x 645 and x 731.
- Retry strip: x **876**.
- Band labels: `left 64`, top = row top + 4. The BEFORE SEND group also has a
  1 px bracket line at `left 56, top 308, height 168`.

| Row | top | Main column | Right column |
|-----|-----|-------------|--------------|
| 0 | 40 | Trigger · Appointment confirmed | — |
| 1 | 160 | Transform · Build the reminder | — |
| 2 | 280 | HTTP · Check patient consent | — |
| 3 | 400 | Gate · Consent granted? | Skipped |
| 4 | 520 | Send · Send WhatsApp message | Retry up to 3 attempts |
| 5 | 640 | Gate (script) · Read the provider reply | — |
| 6 | 760 | Schedule · Check delivery status | Notify the front desk |
| 7 | 880 | Done · Delivered | Delivery failed |

Band labels: EVENT (row 0), PREPARE (1), BEFORE SEND (2), SEND (4),
AFTER THE RESPONSE (5, width 120 so it wraps to two lines), LATER (6), OUTCOME (7).

### 7.2 Connectors (host coordinates)

| # | From → to | Geometry |
|---|-----------|----------|
| 1–7 | main column, row r → r+1 | vertical at x 328, from `top(r)+76` to `top(r+1)`; svg `left 324, top top(r)+76, 8 × 43`, path `M 4 0 L 4 40` |
| 8 | Gate → Skipped | horizontal y 438, x 456 → 559; svg `left 456 top 434, 103 × 8`, path `M 0 4 L 100 4` |
| 9 | Send → Retry | horizontal y 558, x 456 → 559; svg `left 456 top 554` |
| 10 | Retry → top of attempt | (816,558) → (876,558) → (876,198) → (457,198); svg `left 453 top 194, 427 × 368`, path `M 363 364 L 423 364 L 423 4 L 7 4`, dashed |
| 11 | Retry → Notify (Exhausted) | vertical x 731, 596 → 759; svg `left 727 top 596, 8 × 163`, path `M 4 0 L 4 160` |
| 12 | Reply gate → Notify (Rejected) | (456,678) → (645,678) → (645,759); svg `left 452 top 674, 197 × 89`, path `M 4 4 L 193 4 L 193 82` |
| 13 | Notify → Delivery failed | vertical x 688, 836 → 879; svg `left 684 top 836` |

### 7.3 Labels (host coordinates, configure screen)

| Text | left, top | Variant |
|------|-----------|---------|
| `Yes · 1,184` | 340, 488 | success |
| `Answered · 1,177` | 340, 608 | plain |
| `Accepted · 1,168` | 340, 728 | success |
| `Read or delivered · 1,142` | 340, 848 | plain |
| `No · 41` | 476, 410 | neutral |
| `Error · 7` | 470, 530 | warning |
| `Retry · new attempt · 6` | 576, 170 | warning |
| `Exhausted · 1` | 743, 668 | danger |
| `Rejected · 9` | 500, 650 | danger |

The counts are consistent: 1,225 events = 1,184 yes + 41 no; 1,184 sends =
1,177 answered + 7 errors; 1,177 = 1,168 accepted + 9 rejected.

### 7.4 Placement per screen

| Screen | Host offset in canvas | Scale (zoom label) | Why |
|--------|-----------------------|--------------------|-----|
| 1 Configure | left 35, top 44 | 0.82 (82%) | inspector open, drawer collapsed |
| 2 Execution | left 60, top 50 | 0.68 | drawer open (180) |
| 3 Failure | left 60, top 50 | 0.68 | drawer open |
| 4 Add step | left 70, top 44 | 0.82 | no inspector; rows shifted by the insertion (8.4) |

---

## 8. Screen-by-screen specification

Exact markup: the matching file in `source/`. This section lists what each screen
must contain, so it can be checked or rebuilt.

### 8.1 Screen 1 — Configure (light)

- Header: `saveState unsaved`, "2 unsaved changes"; run "Last delivery: delivered · 2 min ago".
- Top bar: Configure active; search; zoom 82%; Fit; Tidy layout.
- Nodes (all light):

| Row/col | kind | eyebrow | title | summary | state |
|---------|------|---------|-------|---------|-------|
| 0 main | trigger | Event | Appointment confirmed | APPOINTMENT_CONFIRMED | |
| 1 main | transform | Transform | Build the reminder | script · 14 lines | |
| 2 main | http | HTTP request · Before send | Check patient consent | GET consent-api/patients/{id} | |
| 3 main | gate | Gate · Before send | Consent granted? | skip() when consent is false | |
| 4 main | send | Send | Send WhatsApp message | POST api.qikchat.in/v1/messages | |
| 5 main | script | Gate · After the response | Read the provider reply | fail() when accepted is false | edited, **selected** |
| 6 main | schedule | HTTP request · Later | Check delivery status | at 30 s · 5 m · 1 h · 24 h | |
| 7 main | done | Outcome | Delivered | checks end at READ | |
| 3 right | skipped | Outcome | Skipped | no consent · nothing sent | |
| 4 right | retry | Reliability | Retry up to 3 attempts | 5xx · 429 · timeout; 4xx fails | |
| 6 right | notify | Script · On failure | Notify the front desk | email desk@democlinic.example | |
| 7 right | failedEnd | Outcome | Delivery failed | failed or abandoned | |

- Labels: 7.3. Connectors: 7.2, all "configured" (10 dashed).
- Inspector (Configure tab), top to bottom:
  1. Eyebrow "Script gate · After the response", title "Read the provider reply";
     tabs Configure (active) / Test / Runs `1,177`.
  2. **Name** text input: "Read the provider reply".
  3. **What it may do**: radio cards. *Decide* (selected; accent border, `#F4F7FF`):
     "Can turn an accepted send into a failure. Runs on every attempt, right after
     the provider answers." *Record only*: "Never changes the delivery."
  4. **Script** with an "Edited" marker; code block:
     ```js
     // ctx.delivery.response: what the provider answered
     const reply = ctx.delivery.response.body;
     if (reply.accepted) {
       return { status: 'ACCEPTED',
                data: { messageId: reply.data[0].id } };
     }
     return fail('Provider rejected: ' + reply.reason);
     ```
  5. **Outcomes** ("Read from the script. The canvas draws one branch for each."):
     Accepted (success dot) → "continues to Later"; Rejected (danger dot) →
     "fails · runs On failure"; checkbox row "Allow a resend when it says so" /
     "Off: a rejected message is never sent twice".
  6. Two columns: **If the script errors** (select: Fail the delivery / Ignore);
     **Time limit** "3 s".
  7. **What is recorded**: "Full request and response, masked: `to` `phone`".
  8. Footer: "**Draft.** Saving applies this to new deliveries. 41 scheduled checks
     already waiting keep the version they started with." Buttons: Discard edits;
     Test this step.
- Bottom bar: "Execution trace · Last delivery 14:02:11 · delivered · 9 steps · 1.4 s",
  "Connector counts: last 24 h, production", Open.

### 8.2 Screen 2 — Execution (dark)

- Header: `saveState clean` "All changes saved"; run ok.
- Top bar: Executions active; run picker "Delivery 6adc…2df · today 14:02:09";
  "Production data" badge; Fit.
- Header `mode="executions"`: Edit workflow, no Save changes; run "Last delivery:
  accepted · 3 min ago" (the delivery was accepted; checks are still waiting or
  have finished: the latest outcome is not the same as the enabled switch).
- Taken path (mint connectors 1–7, labels `Yes`, `Answered · 200`, `Accepted`,
  `READ · checks end`); everything else dashed `#3A3D43` with not-taken labels
  `No`, `Error`, `Retry · new attempt`, `Exhausted`, `Rejected`.
- Node states and metas: trigger ok `14:02:09`; transform ok `6 ms`; consent ok
  `212 ms`; gate ok `3 ms` (summary "consent: true → continue"); send ok `640 ms`
  (eyebrow "Send · attempt 1", summary "POST api.qikchat.in → 200"); reply ok
  `4 ms` (summary "ACCEPTED · messageId wa-8f2c…"); schedule ok `READ`, **selected**
  (summary "3 checks · READ at the 1 h check"); delivered ok `Done` (summary "read 14:31 ·
  seen at 15:02"). Right column all `unvisited` (status "Not taken", summary "not taken" /
  "not needed").
- Drawer open (216 px; the flow is drawn at 64 %): Trace tab; outcome chip "Delivered · 1 attempt · sent in 0.9 s"; two scales:
  Check patient consent 212 ms; Consent granted? 3 ms; Send WhatsApp message 640 ms
  (bar `#7EA2FF`); Read the provider reply 4 ms, on a 0 – 900 ms scale (sending
  14:02:09.4 → 14:02:10.3); then a second scale, 0 – 1 h, for the scheduled checks
  (after the accepted send at 14:02:10): three ticks at 14:02:40, 14:07:10 and 15:02:10.
- Inspector, "Runs · this delivery" tab: "Checks after the accepted send ·
  30 s · 5 m · 1 h · 24 h"; vertical timeline: Check 1 · SENT (14:02:40 · +30 s),
  Check 2 · DELIVERED (14:07:10 · +5 m), Check 3 · READ · finished (15:02:10 · +1 h)
  with the request as cURL (API key masked `••••••••`), the response JSON with
  `"to": "•••••3210"`, `"readAt": "14:31:05"`, and "Decided READ (read at 14:31:05,
  seen by this check), done: nothing more to wait for. The 24 h check was not needed."

### 8.3 Screen 3 — Failure investigation (light)

- Scenario: the provider timed out (no answer) on all 3 attempts; retries ran out;
  the delivery was ABANDONED; On failure notified the front desk.
- Header `mode="executions"` (Edit workflow, no Save changes); run failed "Last delivery: failed · 4 min ago".
- Connectors: 1–4 taken (`#45464D`, 2 px); Send → Retry danger with
  `Timeout ×3`; retry loop taken (`#B4570B` dashed `6 4`) with
  `Retry · 2 new attempts`; Exhausted danger; Notify → Delivery failed danger;
  everything else not taken (`#CFC9BE` dashed). Labels `Yes ×3`, `Answered`
  (not-taken style, `#66676E`), `Exhausted`.
- Node states: trigger ok `14:02:09`; transform ok `×3` (eyebrow "Transform · 3 attempts");
  consent ok `×3` ("consent: true, each attempt"); gate ok `×3`; **Send failed `Timeout`,
  selected** (eyebrow "Send · attempt 3 of 3", summary "no answer within 10 s"); reply,
  schedule, delivered, skipped `unvisited` ("not reached: no answer" / "not reached" /
  "not taken"); retry failed `Exhausted` ("retried 2× · then gave up"); notify ok
  `1.1 s` ("emailed desk@democlinic.example"); delivery failed failed `Abandoned`
  ("ABANDONED after 3 attempts").
- Drawer: chip "Abandoned · 3 attempts · 2 m 01 s"; rows Attempt 1–3 · send
  (danger bars, dashed backoff lines in `#B4570B`), Notify the front desk 1.1 s,
  note "dashed: backoff 30 s, then 60 s".
- Inspector ("Runs · this delivery"):
  1. Cause callout (danger soft): "The provider never answered" / "All 3 attempts
     timed out after 10 s, so the delivery was abandoned and the front desk was
     notified. A timed-out send may still have reached Qikchat: check before sending
     again." Chips: `ETIMEDOUT`, `ABANDONED`, `7 others in the last hour`.
  2. **What you can do**: primary "Check status, then replay" ("asks Qikchat
     first"); secondary "See the 7 others", "Adjust time limit".
  3. **Attempts** ("each one re-ran the stages before send"): three rows with
     time and "timeout · 10.0 s"; attempt 3 highlighted.
  4. Request (attempt 3) as cURL, masked; Response: dashed box "No response: the
     connection was closed after 10,000 ms."

### 8.4 Screen 4 — Add a step (light, no inspector)

- The user chose the insertion point between "Consent granted?" and "Send".
- Rows shift: row 4 is the **ghost step**, and Send, Reply and Schedule move to
  rows 5, 6 and 7 (Delivered, Retry, Notify and Delivery failed are off screen,
  below). Skipped stays at row 3 right.
- Ghost: 256 × 80, `1.5px dashed accent`, `rgba(43,89,230,0.05)`, text `#1F45B8`,
  dashed tile with "+", "New step" / "Before send · after the consent gate";
  enters with `ghost-in` 220 ms. Connectors into and out of it: accent, dashed `4 4`.
- BEFORE SEND label and bracket in accent (bracket 2 px, height 288).
- `+` buttons (24 px circles, `1.5px solid accent`, white) on every other valid
  connector: transform → consent, consent → gate, send → reply, reply → schedule.
  Each has an `aria-label` naming the position.
- Top bar: Configure; hint pill "Adding a step · the blue + marks every place
  one can go" with `Esc`.
- **Library popover** (`role="dialog"`, 380 wide, at canvas `left 468, top 260`,
  radius 12, e2, enters with `pop-in` 180 ms):
  - "Add a step · Before send" / "Runs on every attempt, after the message is built
    and before it is sent. A step here can skip, fail or retry the delivery."
  - Search (focused, accent border): "Search steps and templates".
  - STEPS: Script (highlighted, ↵ hint) "JavaScript that decides, or only records";
    HTTP request "Call an API and keep values for later steps"; URL check "Make sure
    the links in the message open"; disabled (60 % opacity, dashed tile) "Map an
    answer to a status" / "Only after the response: there is no answer yet here".
  - TEMPLATES: disabled "Qikchat delivery status" / "Runs Later · add it from the
    Later group".
  - Footer hints: `↑↓ choose`, `↵ add`, `esc close`.
- **"Where a step can go"** panel (right 24, top 72, 300 wide): Before send — skip,
  fail or retry; sees the message. After the response — turn an accepted send into a
  failure. Later — scheduled checks; observe only. On failure — once the delivery has
  finally failed. Then: "Nothing goes between Send and its answer: retries are set on
  the Reliability tab." and "Branches come from where a step runs, so a link can never
  be wrong. A new step starts as a draft and runs only after you save."

### 8.5 Screen 5 — Larger integration (dark)

- Header: title "Visit completed", subtitle "3 actions · Demo Clinic / org 500",
  run "Last delivery: 3 of 3 actions delivered · 6 min ago".
- Outline panel (264 wide, left of the canvas): "Outline · 14 steps"; search with
  value `desk`, "2 found"; tree: trigger; section "1 · EMAIL THE PATIENT" (Find the
  patient email, Send email, Check the mail server accepted it, **Tell the front
  desk** = current and highlighted match, "on failure"); "2 · SEND ORDER TO RIS"
  (Check the order is complete with "1 issue", Send ORM to RIS, Check the ACK);
  "3 · NOTIFY THE PORTAL · COLLAPSED" (Alert the help desk on failure, match).
  Footer: Collapse all / Expand all.
- Canvas (host at left 40, top 64, no scale; compact nodes stand for 55 %):
  - Trigger compact at (336, 0), ok.
  - Fan-out: line down from the trigger, a horizontal at y 84 from x 140 to 740,
    arrows down into each group; order marks `1st`, `2nd`, `3rd`.
  - Group 1 "Email the patient" (Email · 4): section at (10, 116), 260 × 352,
    radius 12; header 44 tall with protocol icon, name, count, collapse button
    (`aria-expanded="true"`). Compact nodes at x 36, y 180 / 252 / 324 / 396:
    Find the patient email; Send email; Check accepted; Tell the front desk
    (selected, reached by a dashed connector labelled "if it fails" in danger).
  - Group 2 "Send order to RIS" (HL7 · 1 issue, in warning): (310, 116),
    260 × 280. Nodes: Check the order is complete (state issue), Send ORM to RIS,
    Check the ACK. Validation callout below the group: "Check the order is complete
    uses `stages.lookup.output.mrn`, but no earlier step has that output."
  - Group 3 "Notify the portal" collapsed: (610, 116), 260 × 96, dashed border,
    expand button (`aria-expanded="false"`), summary "All 4 steps healthy · 1 match inside".
- Top bar: Configure; note "Each action is its own delivery, sent in order, with
  its own stages"; zoom 55% with "names and status only".
- Minimap bottom-right 176 × 112 (groups as outlines; group 2 outlined in warning).

### 8.6 Screen 6 — Motion prototype

See 9.2.

### 8.7 Screen 7 — System board

Sections, in order: header (title "A precision instrument for deliveries", the
principle, and four goals: Trace / Explain / Edit / Diagnose); Node anatomy (node
at 1.4× with the six numbered parts); Node types (eight kinds, light row and dark
row, same component); States (twelve cards: default, selected, keyboard focus,
edited, running, done, failed, issue, skipped, not taken, off, low zoom);
Connectors (rules and legend with the five line variants and label pills); Tokens
(type, light colour, dark colour, space / shape / motion).

---

## 9. Motion

### 9.1 Rules

- Motion explains a relationship or acknowledges an action; nothing decorative.
- Never recentre, rezoom or move nodes unless the user asked (Fit, Tidy layout,
  inserting a step). Tidy layout animates nodes to their new positions (280 ms) and
  offers "Undo layout".
- Execution: trace the active connector (320 ms), show the running node (pulse),
  then settle to a static outcome. Large workflows: trace only the connector being
  entered; never animate more than one connector and one node at a time.
- Validation: the error appears beside its node (callout) and the node takes the
  failed or issue style; the save indicator names the count.
- Saving: Saving… (spinner) → Saved, or → Save failed with the reason, which
  brings the user to the step.

### 9.2 The prototype — `source/Motion.dc.html`

Layout: left scenario panel (340 wide, white): title "Motion that explains", four
scenario buttons, Reset, and the timing table. Canvas area: five nodes in a column
at host (120, 90), pitch 112, node 256 × 72. The save indicator and Save changes
are top-right; a live region announces each state top-left. Inspector: absolute,
right, 360 wide.

State: `selected`, `insert` (`none | preview | settled`), `running`, `done[]`,
`tracing`, `testShown` (the test-results layer), `save` (`unsaved | saving | saved | failed`),
`error`, `proposal` (a fix is being reviewed), `announce`,
`reduced` (from `matchMedia('(prefers-reduced-motion: reduce)')`).

Steps: `event, consent, send, reply, delivered`; after insertion,
`event, consent, new, send, reply, delivered` ("Check quiet hours", Script · Before send).

| Scenario | Sequence |
|----------|----------|
| 1 Select | `selected = id` → node border and halo transition (160 ms); inspector `translateX(24px)` → 0 and opacity 0 → 1 (240 ms). Clicking any node selects it; Close hides it. |
| 2 Add | `insert = preview`: ghost appears at row 2 (`m-ghost` 180 ms), rows ≥ 2 move down one pitch (`top` 280 ms). After 1,100 ms, `insert = settled`: the ghost becomes "Check quiet hours" with `m-settle` (280 ms, `scale(.97)` → 1); save becomes unsaved. |
| 3 Run | `testShown = true`: a banner reads "Showing test results from sample data. Nothing was sent, and an edit clears them." with **Clear**. For each step `i` at `i × 560 ms`: trace connector `i-1` (`scaleY` 0 → 1, 320 ms) and mark the step running (pulse); at `+420 ms` mark it **Passed** (never "Done": that word is for production runs). The traced connectors stay accent as the static outcome; announce "Test finished · every step passed on the sample". Test results are history: **any edit, insertion, save or Clear removes them** (`dropTest()`), so a validation error is never shown beside stale Passed steps. |
| 4 Fail and recover | Save first clears any test results, then Saving… (800 ms) → Save failed: "1 step has an error"; "Read the provider reply" takes the failed style and an inline alert (`role="alert"`) appears beside it: "1 error. The script returns `status: 'ok '`: a status is letters, digits and _ only." with **Review the fix**. Review shows the proposed change as a diff (`- return { status: 'ok ' };` / `+ return { status: 'OK' };`) with **Apply change** and **Cancel**, and "Applying changes the draft only. Saving is a separate step." Apply clears the error and leaves the draft unsaved ("Change applied to the draft · not saved yet"); the user then saves: Saving… (700 ms) → Saved, "applies to new deliveries". Saving again while the error stands stays Failed ("fix the error first"). |
| Reset | All back to the initial state. |

With reduced motion, all delays are 0, nothing pulses, and the announcement text
carries every state.

---

## 10. Interaction behaviour for the real product

The artifact is static except for the motion prototype. The product must also do
the following.

- **Selection:** click or Enter on a focused node opens the inspector. The canvas
  keeps its zoom and position; if the node would be covered by the inspector, pan by
  the minimum needed (never recentre). Switching nodes keeps the inspector open and
  the canvas still.
- **Keyboard:** Tab reaches the top bar, then the nodes in reading order (rows top
  to bottom, main column before the right). Arrow keys move between connected
  nodes. `⌘K` opens search. `N` (or the `+` buttons) adds a step. Delete removes the
  selected stage with an Undo toast. `⌘Z` / `⇧⌘Z` undo and redo every edit in the
  draft.
- **Add a step:** only at valid insertion points (after the transform, between
  stages of one hook, after the last stage of a hook; On failure and Later have their
  own `+`). The library filters runners by hook (from `GET /stages/runners`, field
  `hooks`) and templates by hook; others are shown disabled with the reason. Adding
  creates the stage via the same rules as the Delivery tab (`defaultStage`).
- **Reorder:** drag within a hook group only, with snapping guides and a live
  connector preview; elsewhere the drop target is refused before release. Keyboard
  alternative: Move up / Move down in the node menu.
- **Duplicate, disable, delete:** node ⋯ menu; deletion is reversible until save.
- **Groups:** an integration with actions shows one group per action; groups
  collapse to a summary line (health and search matches inside).
- **Semantic zoom:** at 60 % and below, nodes switch to compact (name and status);
  connector labels hide their counts below 50 %.
- **Minimap:** shown when the flow exceeds the viewport; dragging its frame pans.
- **Executions mode:** pick a delivery (prev / next, or from the logs); taken path
  emphasised, unvisited dimmed but visible; counts replaced by run facts (attempt,
  timings, ×N). Selecting a failed step opens its Runs tab with the cause first,
  then actions, attempts, request (cURL) and response.
- **Data source label:** Production data (real delivery), Sample (Test with a
  sample), Stand-in answers (test HTTP stubbed). Always visible in Executions and
  Test.
- **Save:** Save changes runs server validation (`POST /stages/validate` per
  delivery, then the integration save). Errors map to nodes by path
  (`actions[1].stages[0].name` → that node) and show beside them.

---

## 11. Building it into the console

### 11.1 Where it goes

- The canvas replaces (or sits beside, behind a toggle) the Delivery tab's list:
  `frontend/src/features/stages/components/delivery-tab/DeliveryTab.tsx`. Keep the
  list view as the accessible fallback.
- Data: the integration form (`stages`, `send`, `actions[i].stages`,
  `actions[i].send`, `stagesPaused`); deliveries from `deliveriesOf(values)`.
- Inspector Configure tab: reuse `StageEditorDrawer` content
  (`SchemaForm`, runner `configSchema`). Test tab: `StageTestPanel` (sample uses
  `sampleRequest` / `sampleResponse`). Runs tab: `StageRunsList` / `StageRunView`
  (cURL already built by `buildStageCurl`).
- Executions mode: `getDeliveryStages(logId)` gives stage runs and states for one
  delivery; the delivery log gives transform, send, attempts and status.

### 11.2 What the backend provides for the design

All of it is built (see "Reading the pipeline" and "Check status, then replay" in
`docs/architecture/pipeline-stages.md`). The canvas names branches from recorded facts.

| Needed by the design | Endpoint | Notes |
|----------------------|----------|-------|
| 24 h counts per branch (`Yes · 1,184` etc.) | `GET /stages/flow-stats?integrationId&hours=24` | Per delivery target (integration or action). See the label table below. |
| "41 scheduled checks keep their version" | `POST /stages/save-impact` | `totals.keepOldVersion`; per stage `change`, `paused`, `resumed`, `cancelled`. Call it with the draft when the user opens Save. |
| Outcomes read from a script | `POST /stages/outcomes` | `statuses` (with `done`), `skips`, `fails` (`retryDelivery`), `dynamicStatus`. For a runner that does not describe itself `known` is false: draw one unlabelled branch. |
| "Check status, then replay" | `POST /stages/deliveries/:id/check-and-replay` | The delivery's check needs `verification.resendWhen`. 409 `PROVIDER_HAS_MESSAGE` (show the status, offer nothing else), 409 `UNVERIFIED` (offer "Send anyway" which repeats the call with `acceptUnverified`), 409 `NOT_REPLAYABLE`. Needs `stages:replay`. |
| "7 others in the last hour" | `GET /logs/:id/similar-failures?minutes=60` | `count`, `capped` (count stops at 1,000), `sample` (log ids for "See the 7 others"), `matchedOn` (`errorCode` or `errorCategory`; null means nothing to match on, hide the chip). |
| Tidy layout / saved positions | not needed | the layout is computed from the pipeline; there are no free positions to save |

**Connector labels from `flow-stats`** (per delivery target; `stage` = the stage's entry):

| Label | Computed as |
|-------|-------------|
| `Yes` (before-send gate) | `stage.ok` |
| `No` → Skipped | `stage.skipped` |
| gate `fail()` | `stage.rejected` |
| `Answered` | no count: the log does not record which attempts were answered, so draw the label without a number |
| `Error` → Retry policy | `deliveries.retries` (attempts after the first) |
| `Retry · new attempt` | `deliveries.retries` |
| `Exhausted` | `deliveries.byStatus.ABANDONED` |
| `Accepted` (after-response gate) | `stage.ok` |
| `Rejected` | `stage.rejected` |
| `Read or delivered` (Later) | `stage.latest[word]` for each word whose `done` is true in `/outcomes` |
| Later, still waiting | `stage.latest[word]` for the other words |

Stage counts are **runs**: a gate runs again on every retry attempt, so its counts can exceed
`deliveries.total` (the canvas says "runs" in tooltips, and shows `×N` only in Executions). A
stage that errors (`errored`) or runs out of time (`timedOut`) is its own count; the
canvas shows it on the stage, never inside a branch label.

### 11.3 Layout algorithm (computed, not stored)

1. Rows in pipeline order (2.2); one row per stage, in stage order within a hook.
2. Main column: event, transform, before-send stages, send, after-response stages,
   Later stages, Delivered.
3. Right column: the alternative of the row it leaves (Skipped beside the first
   before-send gate with a skip; Retry beside Send; On failure stages and Delivery
   failed at the bottom).
4. Connectors from 2.3; the retry loop always routes on the retry strip to the
   transform's right edge.
5. With actions: one group per action, in action order, side by side (column pitch
   300 at compact size), with the trigger above and a fan-out.

---

### 11.4 What is built, and where it differs from the artifact

The canvas is in the console: **Delivery tab → Diagram**. The **List** (each step by name, in order) is the default and
the plain way in; the choice is remembered. Code: `frontend/src/features/stages/canvas/`.

| File | What it does |
|------|--------------|
| `model.ts` | Pure: nodes, connectors, labels, bands and insertion points from the stages (sections 7 and 11.3), compact variant, `insertStage`. Tested in `workflow-canvas-model.test.ts`. |
| `facts.ts`, `execution.ts` | Connector counts from recorded facts (11.2); one real delivery drawn over the flow. |
| `useCanvasData.ts`, `useExecution.ts` | Runner labels, outcomes (`/stages/outcomes`), 24 h counts, save impact; recent deliveries and one in full. |
| `WorkflowCanvas.tsx`, `CanvasNode.tsx`, `Connectors.tsx`, `Minimap.tsx`, `useViewport.ts`, `canvas.css` | The canvas, nodes (6.1), connectors (6.4), minimap, zoom and pan, the spec's light and dark tokens. |
| `Inspector.tsx`, `FailurePanel.tsx`, `ExecutionBar.tsx` | The inspector (the stage editor is the Delivery tab's own, `StageEditor`), the failure investigation with "Check status, then replay", the run picker and trace drawer. |

Differences from the artifact, and why:

- **No app nav or integration header drawn**: the canvas lives inside the console's own page, which already has them. The mode switch, search, zoom, Fit and **Full screen** (the canvas over the whole window) are the canvas top bar.
- **The failure bus.** Failures from the main column (a gate's `fail()`, a rejected answer, a send that is refused) join one vertical lane at x 546 and enter On failure from its left. The artifact draws only the sample's single rejected-answer connector; with several sources, one shared lane stays readable. `Retry` from a gate (`retryDelivery`) uses its own lane at x 534. A send also has a drawn `Refused: not retried` branch (a 4xx fails at once).
- **Adding a step** puts the step in the draft at once and opens it, instead of a ghost preview.
- **Reordering** is Move up / Move down in the step's ⋯ menu (inside its hook), not drag and drop.
- **Many deliveries:** each action's group has a ▾ / ▸ title that folds it into one step (name, stage count, how many are off). With more than three actions all but the first start folded; Executions always opens the delivery it shows. There is no separate outline panel: search, zoom and the minimap are the way around a large flow.
- **A check can be marked for "Check status, then replay":** the stage editor of a later check has *Ask this before sending again* (the status words that mean the provider does not have the message, stored as `verification.resendWhen`).
- **Not built:** Pan tool and `N` to add (dragging the canvas pans it; the `+` tool shows every insertion point).
- **Read-only pages** (viewing an integration) show the canvas and Executions; settings are not editable there. The Delivery tab is not inside the page's disabled `<fieldset>`, which would make every canvas button unclickable.
- The font is Instrument Sans (added to the console's font import); everything else in the console keeps Inter.

## 12. Acceptance checklist

- [ ] Every screen in section 3 matches its `source/` file (spacing, colours, copy).
- [ ] Light and dark use the same components; only tokens differ.
- [ ] Every branch drawn exists in the engine (2.3), and every possible branch is drawn.
- [ ] Retry loops return to the top of the attempt; rejected answers lead to On
      failure; Skipped is neutral; scheduled checks never change the outcome.
- [ ] Status is never colour alone (dot + word + metric).
- [ ] Unvisited branches are dimmed, never red.
- [ ] The selected node stays visible when the inspector opens; zoom and position
      never change on their own.
- [ ] Keyboard: every node and action reachable, focus visible, no hover-only controls.
- [ ] Contrast ≥ 4.5:1 for text (including 11 px eyebrows and mono summaries).
- [ ] Reduced motion: no animation, every state in words.
- [ ] The top bar fits 792 px with the inspector open.
- [ ] Data source (Production / Sample / Stand-in) always labelled.
- [ ] Change scope sentence shown with every unsaved edit.

---

### 11.5 Acceptance check of the built canvas (against section 12)

Checked on the running console (light and dark) with seeded data:

- **Measurements match the spec:** node 256 × 80, radius 10, padding 12 / 14, gap 12; icon tile 32 / radius 8; eyebrow 11 / 14 / 500 uppercase 0.04em; title 14 / 20 / 600; summary mono 11.5 / 16; ports 8 px at −5; connector label 20 high, padding 0 7, mono 11.5; band labels 12 / 16 at 0.06em; inspector 400 wide with the spec's paddings; dot grid 16.
- **Contrast:** every text and background pair in the tokens is at least 4.5:1 in both themes (lowest: warning retry status 4.87 light, ink-3 on the canvas 5.08 light). Translucent dark pills measured over the canvas and over a node.
- **Top bar at 792 px with the inspector open:** fits on one row, nothing wraps. Below 880 px of canvas the words give way to icons (Edit workflow, Full screen) and the picker shortens.
- **Keyboard only:** Tab reaches the top bar, then every step in reading order (rows top to bottom, main column before the right); arrows move along connected steps; Enter opens a step, Enter again moves into its inspector, Escape returns to the step and a second Escape closes it; focus is visible on every step; the `+` points appear on focus.
- **Reduced motion:** every canvas transition and animation drops to ~0 and the running pulse does not loop; every state has a word.
- **Narrow screens:** below 760 px of canvas the inspector covers the canvas instead of sitting beside it and the top bar may take two rows. Pinch to zoom is not built (use − / + / Fit); dragging pans.
- **Not compared pixel by pixel** with the artifact (the numbers above are compared; the screens were not overlaid).
- **The console's own page does not shrink to a phone width** (the integration page overflows horizontally on a 375 px viewport, with or without the canvas), so the canvas was checked in a 360 px container.

## Revision log

- **Built into the console** (section 11.4): canvas, inspector, Executions, failure investigation, save impact, add and edit steps, undo and redo, search, minimap, light and dark.

**Applied (review round 1, artifact version 10, sources in `source/`):**
- One consistent timeline: event 14:02:09, sent 14:02:10 (0.9 s), checks 14:02:40 / 14:07:10 / 15:02:10, read at 14:31:05; failure run 14:02:09 → 14:04:10 (attempts at 14:02:09, 14:02:49, 14:03:59; backoff 30 s then 60 s). The execution trace uses two scales: sending (ms) and scheduled checks (up to 1 h).
- Node: the status moved from beside the title to the summary row, so the title has the full width. Titles over 24 characters (19 compact) wrap to two lines and the summary gives way (the status then sits in the eyebrow row). The root carries `title=` with the full name. **This supersedes 6.1's text-column padding and status position.**
- Not taken: no opacity. Quiet surface (`#F8F7F3` light / `#17191C` dark), dashed border (`#D3CDC1` / `#3A3E44`), neutral icon tile, title in ink-3, status word "Not taken" with a hollow dot. Unvisited labels use `#66676E` (light) and `#8E8C86` (dark) for ≥ 4.5:1. **Supersedes the 42 % opacity rule in 6.1, 8.2, 8.3.**
- Header `mode` prop: `executions` hides the save state and shows **Edit workflow** (pencil icon) instead of Save changes. Screens 2 and 3 use it.
- Node gains a `passed` state ("Passed", success) for test results, distinct from production `ok` ("Done").

**Applied (review round 2, artifact version 15; each screen was opened and checked rendered):**
- Motion prototype: test results are their own labelled layer (Passed, banner, Clear) that any edit or save clears; "Fix it" became **Review the fix**, a diff the user applies to the draft before saving separately.
- System board: the "Not taken" card describes the quiet surface; new cards for long names (two lines) and Passed (test); the anatomy labels follow the new status position; the board is 2080 px tall.
- Sections 6.1, 6.3, 8.2, 8.3 and 9.2 of this document now describe the revised design directly.
- Found by rendering: the motion prototype's node status moved into the eyebrow row (it collided with long eyebrows), the diff lines are separate blocks, the banner has its own space; the Execution drawer is 216 px with the flow at 64 % so both trace scales fit; the Add-step header agrees with the other screens ("accepted · 3 min ago").

**Open:**
- Nothing from the review remains. The canvas is a design only; none of it is built into the console yet (see section 11 for the plan and the missing backend pieces).
