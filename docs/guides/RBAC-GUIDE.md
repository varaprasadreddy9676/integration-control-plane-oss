# RBAC System Guide

The Integration Gateway uses feature-based role access control across the web
console, REST API, and MCP server. Every operation remains organization-scoped
unless the caller is a global administrator.

## Operations

The standard operations are `read`, `write`, `delete`, `execute`, `configure`,
and `export`.

## Frontend

```tsx
import { PermissionGuard } from '../../components/common/PermissionGuard';
import { FEATURES, OPERATIONS } from '../../utils/permissions';

<PermissionGuard feature={FEATURES.INTEGRATIONS} operation={OPERATIONS.EXECUTE}>
  <Button>Run test</Button>
</PermissionGuard>;
```

Use `usePermissions()` for conditional actions and keep the backend check as
the authoritative enforcement point.

## Backend

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

For destructive actions, require all relevant operations explicitly:

```javascript
requireFeature(FEATURES.INTEGRATIONS, [OPERATIONS.READ, OPERATIONS.DELETE], {
  requireAll: true,
});
```

## Roles

- `SUPER_ADMIN`: global access across all organizations.
- `ADMIN` and `ORG_ADMIN`: full access within their organization.
- `INTEGRATION_EDITOR`: author, test, and operate integrations without user administration.
- `VIEWER`: read-only operational access.
- `ORG_USER`: limited organization-scoped read access.

## MCP Access

The MCP server does not have a separate authorization model. It uses API keys
or the configured authenticated client flow to call the backend, so tenant
scope, feature permissions, validation, audit logging, and approval controls
remain identical to the web console.

## Available Features

`DASHBOARD`, `INTEGRATIONS`, `LOGS`, `EVENTS`, `EXECUTION_LOGS`, `DLQ`,
`SCHEDULED_JOBS`, `LOOKUP_TABLES`, `TEMPLATES`, `USERS`, `ANALYTICS`,
`SETTINGS`, `SYSTEM_HEALTH`, `AUDIT_LOGS`, `API_KEYS`, `ALERTS`, and
`DAILY_REPORTS`.
