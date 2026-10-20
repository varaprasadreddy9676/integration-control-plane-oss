# Feature Permissions Summary

The gateway uses a shared feature and operation model across the frontend and backend.

## Operations

- `read`: view and list records
- `write`: create and edit records
- `delete`: remove records
- `execute`: run, test, retry, or manually trigger an operation
- `configure`: change settings and configuration
- `export`: export records

## Current Features

`DASHBOARD`, `INTEGRATIONS`, `LOGS`, `EVENTS`, `EXECUTION_LOGS`, `DLQ`,
`SCHEDULED_JOBS`, `LOOKUP_TABLES`, `TEMPLATES`, `USERS`, `ANALYTICS`,
`SETTINGS`, `SYSTEM_HEALTH`, `AUDIT_LOGS`, `API_KEYS`, `ALERTS`, and
`DAILY_REPORTS`.

## Role Model

- `SUPER_ADMIN`: global access across organizations.
- `ADMIN` and `ORG_ADMIN`: full organization-scoped administration.
- `INTEGRATION_EDITOR`: integration authoring, testing, lookups, and templates without user administration.
- `VIEWER`: read-only operational access.
- `ORG_USER`: limited organization-scoped read access.

## Usage

```javascript
const { requireFeature } = require('../middleware/feature-permission');
const { FEATURES, OPERATIONS } = require('../rbac/features');

router.post(
  '/integrations/:id/test',
  auth,
  requireFeature(FEATURES.INTEGRATIONS, OPERATIONS.EXECUTE),
  runIntegrationTest
);
```

Use the same feature and operation constants in frontend guards. MCP clients do
not bypass this model: they call the authenticated backend API and receive the
same tenant scoping, validation, audit, and authorization behavior.
