# Export Contract

Exports are operational records, not a copy of the current browser table. Every data export must follow this contract.

## Product Rules

- The server is the source of the exported dataset. A client may request an explicit selection, but must not serialize a paginated or locally truncated table.
- An export applies the active server-side filters and includes every matching record in the authorized organization scope.
- Large or potentially slow exports use a background job and expose `QUEUED`, `PROCESSING`, `COMPLETED`, and `FAILED` status. The UI polls the status endpoint and downloads only after completion.
- Streaming exports write rows incrementally with backpressure and stop work after the client disconnects.
- CSV fields must escape quotes, line breaks, delimiters, and formula-like values beginning with optional whitespace followed by `=`, `+`, `-`, or `@`.
- Server responses provide `Content-Disposition` filenames. The browser preserves that filename rather than inventing a competing one.
- Configuration exports never include secrets unless an endpoint has an explicit, authorized sensitive-export contract. Normal integration exports remain masked.

## Current Coverage

| Surface | Export mode | Notes |
| --- | --- | --- |
| Delivery Logs | Background job | CSV, JSON, selected rows, full server-side filters |
| Alert Center | Background job | CSV and JSON; client always requests the job path |
| Event Audit | Background job | CSV |
| System Logs | Background job | CSV and JSON; client always requests the job path |
| Admin Audit Logs | Background job | CSV and trend CSV |
| System Audit Logs | Background job | CSV and JSON; full authorized history, owner-scoped artifacts |
| Delayed Deliveries | Streaming CSV | All historical matching rows; no browser-row limit |
| Rate Limits | Streaming CSV | Cursor batches with response backpressure; rate-counter lookup failures leave the configuration row exportable |
| Lookup Tables | Background job | Disk-backed streaming XLSX or CSV artifact; full server-side filters |
| Integration configuration | Server artifact | JSON and CSV endpoints; masked credentials |
| Bulk integration configuration | Server artifact | JSON; selection is resolved again on the server |

## Intentional Client Exports

- Dashboard image/PDF capture and a single editor's JSON download remain client-generated because they export a rendered view or unsaved local state, not a server dataset.

New data screens should reuse the existing client download/progress handler and choose a streaming response only when the record count is naturally bounded. Otherwise they should add a server export job before shipping.
