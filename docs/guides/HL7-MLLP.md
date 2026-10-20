# HL7 MLLP Guide

This guide explains the HL7 v2 support in Integration Gateway: outbound MLLP delivery, inbound MLLP listener, JSON to HL7 transformation, HL7 to JSON transformation, ACK/NACK behavior, and practical migration notes for teams moving flows out of Mirth.

## What Is Supported

| Capability | Status | Notes |
|------------|--------|-------|
| Build HL7 v2 messages from JSON | Supported | Use the `hl7` helper in script transformations. |
| Parse inbound HL7 into JSON-like payloads | Supported | Inbound listener stores raw HL7 plus parsed segment maps. |
| MLLP outbound client | Supported | Sends framed HL7 over TCP and waits for ACK. |
| MLLP inbound listener | Supported | Receives framed HL7 over TCP and returns AA, AE, or AR ACKs. |
| TLS and mTLS MLLP | Supported | Server/client certs can be configured with inline PEM or file paths. |
| Persistent outbound MLLP sockets | Supported | Optional keep-alive avoids reconnecting for every message. |
| Multi-worker listener lock | Supported | Optional Mongo-backed lease prevents duplicate listeners in clustered workers. |
| ACK parsing and logging | Supported | ACK code, reason, bytes, and message control IDs are logged. |
| Transformation scripts with async HTTP | Supported | `http`, `lookup`, and `hl7` are available together in the script sandbox. |
| Mirth-style visual channel builder | Not yet | Current approach is integration config plus script transformation. |

This can replace many Mirth channels where the flow is:

1. Receive JSON, HTTP, database, Kafka, or HL7 input.
2. Transform data into JSON or HL7.
3. Call external HTTP APIs, including token APIs.
4. Send HL7 over MLLP and validate ACK.
5. Log every step, retry failures, and move unrecoverable failures to DLQ.

It is not a full Mirth clone yet. Advanced visual mapping, channel replay UI, per-profile schema validation, and very specialized HL7 workflows may still need additional work.

## HL7 Helper API

Script transformations receive a built-in `hl7` object.

Common helpers:

| Helper | Purpose |
|--------|---------|
| `hl7.ormO01(input)` | Build an ORM O01 order message. |
| `hl7.oruR01(input)` | Build an ORU R01 result/report message. |
| `hl7.adtA08(input)` | Build an ADT A08 patient update message. |
| `hl7.buildMessage({ segments })` | Build a custom HL7 message from segment definitions. |
| `hl7.buildSegment(name, fields)` | Build one segment with HL7 escaping. |
| `hl7.parseMessage(rawHl7)` | Parse HL7 into message type, control ID, version, and segments. |
| `hl7.parseAck(rawHl7)` | Parse an HL7 ACK and expose `accepted`, `code`, and reason. |
| `hl7.buildAck(input)` | Build an AA, AE, or AR ACK. |
| `hl7.frameMllp(message)` | Wrap a message in MLLP framing. |
| `hl7.extractMllpFrames(buffer)` | Extract framed MLLP messages from TCP bytes. |
| `hl7.formatHl7DateTime(value)` | Format a JavaScript date/time as HL7 datetime. |

The builder escapes field delimiters automatically. The parser detects standard and custom delimiters from `MSH`.

## Outbound HL7 MLLP

Use an outbound integration in multi-action mode and set an action's delivery protocol to `HL7 MLLP`.

Required action config:

```json
{
  "kind": "HL7_MLLP",
  "name": "Send order to RIS",
  "hl7Config": {
    "host": "10.10.20.50",
    "port": 2575,
    "connectTimeoutMs": 5000,
    "ackTimeoutMs": 15000,
    "ackRequired": true,
    "keepAlive": true,
    "idleTimeoutMs": 60000
  },
  "transformationMode": "SCRIPT",
  "transformation": {
    "script": "return hl7.ormO01({ ... });"
  }
}
```

The action succeeds only when the receiver returns an accepting ACK (`AA` or `CA`). Application rejects (`AE` or `AR`) are logged as failed deliveries with response status `422` and are eligible for DLQ investigation. Network errors and ACK timeouts are logged separately.

### Outbound TLS And mTLS

Use `hl7Config.tls.enabled` when the receiver requires TLS/MLLP. For normal one-way TLS, configure the vendor CA and leave the client certificate fields empty. For mTLS, also provide the client certificate and private key.

```json
{
  "hl7Config": {
    "host": "ris.vendor.example",
    "port": 2576,
    "tls": {
      "enabled": true,
      "caPath": "/etc/integration-control-plane/vendor-ca.crt",
      "certPath": "/etc/integration-control-plane/client.crt",
      "keyPath": "/etc/integration-control-plane/client.key",
      "rejectUnauthorized": true,
      "servername": "ris.vendor.example"
    }
  }
}
```

`rejectUnauthorized` should stay `true` in production. Set it to `false` only for local testing with self-signed certificates.

### JSON To ORM O01

```js
return hl7.ormO01({
  sendingApp: 'HIS',
  sendingFacility: 'MAIN',
  receivingApp: 'RIS',
  receivingFacility: 'RAD',
  messageControlId: payload.order.id,
  patient: {
    id: payload.patient.mrn,
    name: [payload.patient.lastName, payload.patient.firstName],
    birthDate: payload.patient.dob,
    sex: payload.patient.sex,
    phone: payload.patient.phone
  },
  order: {
    orderId: payload.order.id,
    placerOrderNumber: payload.order.id,
    testId: payload.study.code,
    testName: payload.study.name,
    modality: payload.study.modality,
    priority: payload.order.priority,
    scheduledAt: payload.study.scheduledAt
  }
});
```

### Token Before Vendor API Before HL7

The script sandbox supports async HTTP and HL7 helpers together. This covers common "get token first, call another API, then build/send HL7" flows.

```js
const tokenResponse = await http.post('https://vendor.example.com/oauth/token', {
  client_id: 'client-id-from-secure-config',
  client_secret: 'client-secret-from-secure-config',
  grant_type: 'client_credentials'
});

const patientResponse = await http.get(
  `https://vendor.example.com/patients/${payload.patientId}`,
  {
    headers: {
      Authorization: `Bearer ${tokenResponse.data.access_token}`
    }
  }
);

return hl7.ormO01({
  sendingApp: 'GATEWAY',
  receivingApp: 'RIS',
  messageControlId: payload.orderId,
  patient: {
    id: patientResponse.mrn,
    name: [patientResponse.lastName, patientResponse.firstName],
    birthDate: patientResponse.dob,
    sex: patientResponse.sex
  },
  order: {
    orderId: payload.orderId,
    testId: payload.testCode,
    testName: payload.testName,
    modality: payload.modality
  }
});
```

## Inbound HL7 MLLP

Configure an event source with type `hl7_mllp`. External systems connect to the gateway over TCP/MLLP and send HL7 messages.

Example config:

```json
{
  "type": "hl7_mllp",
  "config": {
    "host": "0.0.0.0",
    "port": 2575,
    "idleTimeoutMs": 30000,
    "maxMessageBytes": 5242880,
    "duplicateWindowMs": 21600000,
    "listenerLockEnabled": true,
    "listenerLockTtlMs": 30000,
    "allowedSourceIps": ["10.10.20.50", "10.10.0.0/16"],
    "ackSendingApp": "INTEGRATION_GATEWAY",
    "ackSendingFacility": "MAIN",
    "messageTypeMapping": {
      "ORM^O01": "RIS_ORDER_CREATED",
      "ORU^R01": "RIS_REPORT_READY",
      "ADT^A08": "PATIENT_DEMOGRAPHICS_UPDATED"
    }
  }
}
```

TLS listener example:

```json
{
  "type": "hl7_mllp",
  "config": {
    "host": "0.0.0.0",
    "port": 2576,
    "tls": {
      "enabled": true,
      "keyPath": "/etc/integration-control-plane/hl7-listener.key",
      "certPath": "/etc/integration-control-plane/hl7-listener.crt",
      "caPath": "/etc/integration-control-plane/his-client-ca.crt",
      "requestCert": true,
      "rejectUnauthorized": true
    }
  }
}
```

When a message is received, the gateway emits a normal event:

```json
{
  "event_type": "RIS_ORDER_CREATED",
  "source": "hl7_mllp",
  "payload": {
    "rawHl7": "MSH|^~\\&|...",
    "messageType": {
      "code": "ORM",
      "trigger": "O01"
    },
    "messageControlId": "MSG-1001",
    "version": "2.3",
    "segments": {
      "PID": [
        {
          "fields": [
            { "value": "" },
            { "value": "" },
            { "value": "P-100" }
          ]
        }
      ]
    }
  }
}
```

Default event type is derived from the HL7 message type, for example `HL7_ORM_O01`. Use `messageTypeMapping` when you want business event names.

ACK behavior:

| Condition | ACK code | Meaning |
|-----------|----------|---------|
| Message parsed and handler completed | `AA` | Accepted |
| Message parsed but processing failed | `AE` | Application error |
| Message is malformed or too large | `AR` | Application reject |

Production safety behavior:

- `MSH-10` message control IDs are used for listener-level duplicate protection.
- A duplicate received while the original message is still processing gets `AE` with "Duplicate message already processing" and is not processed twice.
- A duplicate received after an earlier accepted message gets `AA` with "Duplicate message already processed" and is not processed again.
- `allowedSourceIps` is optional. When set, clients outside the exact IP/CIDR allowlist are rejected at the TCP listener.
- `duplicateWindowMs` controls how long recently accepted `MSH-10` values stay in the listener cache. The default is 6 hours.
- `listenerLockEnabled` should be enabled when more than one worker/process can start the same inbound listener. Only the lock owner binds the port and refreshes the lease.
- Inbound TLS supports server TLS and mTLS. For mTLS, set `tls.requestCert` and `tls.rejectUnauthorized` to `true` and configure `tls.caPath`.

## HL7 To JSON Transformation

Inbound HL7 events can be transformed using `hl7.parseMessage` or the already parsed `payload.segments`.

```js
const parsed = hl7.parseMessage(payload.rawHl7);
const pid = parsed.getFirst('PID');
const obr = parsed.getFirst('OBR');

return {
  messageType: `${parsed.messageType.code}^${parsed.messageType.trigger}`,
  messageControlId: parsed.messageControlId,
  patientId: pid?.fields[2]?.value,
  patientName: pid?.fields[4]?.value,
  orderId: obr?.fields[1]?.value,
  testCode: obr?.fields[3]?.repetitions?.[0]?.[0]?.[0],
  testName: obr?.fields[3]?.repetitions?.[0]?.[1]?.[0]
};
```

## Operations And Debugging

Outbound HL7 delivery logs include:

- MLLP target as `mllp://host:port`
- `httpMethod` value `HL7_MLLP`
- original payload
- generated HL7 request payload
- raw ACK response body
- ACK code and ACK message control ID
- request and response byte counts
- transformation and delivery execution steps

The Logs UI shows an HL7 panel for HL7 MLLP deliveries. It displays the message type, `MSH-10`, ACK code, ACK reason, raw request HL7, raw ACK, and field-level segment tables such as `PID-3`, `OBR-4`, and `OBX-5`.

The HL7 panel also includes a reusable delivery debug timeline, issue classification, field search, and edited-payload replay. Search supports practical values such as `MSH-10`, `PID-3`, accession numbers, order IDs, and ACK text.

Failed HL7 delivery logs can be retried from the Logs UI. The retry path uses the existing log replay endpoint and sends the original or edited source event payload through the current integration/action configuration again. For transformed protocols, the transformation runs again before delivery. Use force retry only when the receiver is healthy and you intentionally want to bypass the circuit breaker.

The debug timeline and replay editor are generic log-debug components, so the same UX can be reused for HTTP/API deliveries without building a second debugging pattern.

Inbound listener runtime status exposes:

- listener host and port
- running/listening state
- active TCP connections
- transport (`tcp` or `tls`)
- listener lock status when enabled
- received and rejected counters
- last message time
- last error

## Migration Notes From Mirth

Good first candidates:

- JSON to HL7 order interfaces.
- HL7 inbound listeners that route to HTTP APIs.
- Flows where transformation logic is currently JavaScript-heavy.
- Channels where debugging Mirth message history is the main bottleneck.

Keep in Mirth or migrate later:

- Channels depending on complex visual mapper behavior.
- Very custom HL7 profiles that need schema-level validation.
- Interfaces requiring channel replay tooling before cutover.

Recommended rollout:

1. Pick one low-risk Mirth channel.
2. Recreate the transformation in Integration Gateway.
3. Run both paths in parallel in a non-production environment.
4. Compare generated HL7, ACK behavior, and delivery logs.
5. Enable production with DLQ monitoring and clear rollback.

## Test Commands

Focused HL7 backend tests:

```bash
cd backend/test
./node_modules/.bin/jest tests/hl7-codec.test.js tests/hl7-mllp-client.test.js tests/hl7-mllp-event-source.test.js tests/hl7-event-source-config.test.js tests/hl7-listener-lock.test.js tests/transformer.test.js tests/delivery-engine.test.js --runInBand --forceExit
```

Frontend build:

```bash
cd frontend
npm run build
```
