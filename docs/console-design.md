# Console Design

The console is an operational tool. Prioritise reading failures, comparing deliveries, and configuring integrations over decorative presentation.

## System Rules

- UI text: Inter, 13-14px for controls and rows, 15-16px for section headings, 20px for page titles. Use sentence case and zero letter spacing.
- Numbers and identifiers: tabular figures; JetBrains Mono for metrics, payloads, and identifiers. Keep units visible.
- Spacing: 4px increments, normally 8px within controls and 12-16px between groups. Size forms to their content.
- Corners: 4px controls, 8px genuinely framed tools and overlays. Circles remain appropriate for avatars and status dots.
- Elevation: none for page sections and rows; restrained shadow for menus and dialogs. No coloured glows or floating rows.
- Colour: metadata and zero/unknown metrics are neutral. Failure counts receive error colour only when nonzero. A trend's direction alone does not imply good or bad. Latency needs a configured threshold before it receives alarm colouring.
- Copy: concise state plus a useful recovery action. Do not repeat instructions, filters, or date windows in every panel.
- Motion: feedback only, 150-250ms transform/opacity where needed. Respect reduced motion. State panels use a small monochrome glyph, not illustration; the Lottie animations and the lottie-web dependency were removed rather than left half-wired.
- Preserve focus visibility, the skip link, leaf-only countdown timers, predicate-based unsaved-change guards, and error navigation on long forms.

## Verification Record

The September 9, 2026 pass covered the dashboard, populated and empty delivery logs, the delivery-detail drawer, outbound configuration, inbound configuration, and integration lists in light and dark themes against validation data for Org 33.

Implemented changes include neutral dashboard KPIs in a stable five-column desktop row; compact shared form controls; neutral metadata tags; denser tables and empty states; removal of redundant configuration explainers; and removal of the default-date active-filter strip. Error colour remains reserved for active failures, while open access and missing authentication retain warning colour.

Delivery-log cURL previews mask credential headers by default. This includes conventional authorization headers, custom authentication headers, and the gateway API key. Revealing credentials remains an explicit privileged action.

Local gates:

- `NODE_OPTIONS=--no-experimental-webstorage npx vitest run`: 39 files, 121 tests passed.
- `npx tsc --noEmit`: passed.
- `npm run build`: passed. Vite still reports existing chunks larger than 500 kB.
- Source-scoped graphify rebuild: 2,527 nodes, 3,763 edges, 259 communities.

Validation deployment completed from the verified bundle. Backup: `/var/www/html/integration-gateway.bak-ui-20260909-103159`. Production was not changed.

Known follow-up work is not a blocker for this UI pass: split the largest lazy chunks, remove legacy dead animation assets after confirming no downstream consumer, and clean existing Ant Design/jsdom deprecation warnings in the test output. Broader low-traffic administration screens should continue adopting these system rules as they are touched.
