# Data Transformation

Every integration — outbound, inbound, or scheduled — can reshape the payload before it is sent, with a JavaScript script. An integration without one sends the payload as it is.

---

## Writing a Transformation

### Custom JavaScript

Write any JavaScript you need. The script runs in a secure sandbox:

```js
const fullName = `${payload.patient.firstName} ${payload.patient.lastName}`;
const ts = epoch(payload.appointment.scheduledAt);

return {
  name: fullName,
  phone: formatPhone(payload.patient.mobile, 91),
  scheduledEpoch: ts,
  source: "gateway",
};
```

**Script timeout:** 60 seconds
**Async/await:** Supported

---

## Script Utilities

These are available globally inside any transform script:

```js
// Date/Time
epoch(dateStr)                        // Parse to Unix timestamp (seconds)
datetime(date, time, timezone)        // Compose timestamp (default tz: +05:30)

// String
uppercase(str)
lowercase(str)
trim(str)

// Phone
formatPhone(phone, countryCode)       // Normalise phone (default country: 91)

// Object
get(obj, "path.to.field", default)    // Safe dot-notation getter
```

---

## HTTP Calls Inside Scripts

Scripts can make outbound HTTP requests using the `context.http` helper:

```js
const result = await context.http.get("https://api.example.com/lookup/123");
// result: { status: 200, data: { ... }, headers: { ... } }

const created = await context.http.post("https://api.example.com/items", {
  body: { name: payload.patientName }
});
```

**Available methods:** `get`, `post`, `put`, `patch`, `delete`, `getBuffer`
**Default timeout:** 30 seconds per call
**`getBuffer`** returns base64-encoded binary data and a `contentType` — useful for PDF or image APIs.

Non-2xx responses do not throw — they return the error response as the result, letting you handle failures in script logic.

---

## Lookup Tables

Lookup tables let you map a raw value to a human-readable or system-specific value without changing the script.

In a script, call `lookup(value, 'TABLE')` (see Lookup Tables), or rely on integration-level lookups configured separately.

**Fallback behaviour:** If a lookup returns null/undefined, the original source value is passed through unchanged.

---

## Response Transformation (Inbound Proxy)

For inbound integrations, a separate `responseTransformation` config reshapes what your backend returns before sending it back to the caller:

- Input: `{ data, status, headers }` from your backend
- Written as a script, like the request transformation
- Lookups work identically

---

## Secure Sandbox

All scripts run inside a hardened Node.js VM:

- **No `eval`** — code generation from strings is disabled
- **No `require`** — modules cannot be loaded
- **No `process`** — the Node process object is not accessible
- **Prototype pollution prevention** — `Object.prototype`, `Array.prototype`, and others are frozen before execution
- **`setTimeout` limit** — max 30 seconds (throws if exceeded)
- **Depth limit** — transformed output must not exceed 50 nested levels
- **Strict mode** — all scripts run with `'use strict'`

---

## Validation

Before saving a transformation script, the gateway does a basic syntax parse using the Function constructor. Scripts that fail to parse are rejected immediately with an error, before any event is processed.

---

## Configuration Reference

| Field | Type | Description |
|-------|------|-------------|
| `transformation.mode` | `SCRIPT` \| `NONE` | `SCRIPT` when there is a script; `NONE` sends the payload as it is |
| `transformation.script` | string | The JavaScript that reshapes the payload |
| `responseTransformation` | object | Same structure, applied to upstream response |


---

## Field mappings were removed

Earlier versions had a visual field-mapping mode (`SIMPLE`, with `mappings` and `staticFields`). It was removed: write the same reshaping as a script. A stored configuration that still has mappings fails its deliveries with a message saying so, instead of sending the payload unmapped.
