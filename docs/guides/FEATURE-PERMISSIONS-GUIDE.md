# Feature-Based Permissions - Simple Guide

## Overview

Super simple RBAC system based on **Features** and **Operations**.

## Structure

### 1. Features (What you're accessing)
- `dashboard` - Analytics dashboard
- `integrations` - Integration configurations
- `logs` - Delivery logs
- `users` - User management
- `settings` - System settings
- etc.

### 2. Operations (What you're doing)
- `read` - View/List
- `write` - Create/Edit
- `delete` - Delete/Remove
- `execute` - Run/Test/Execute
- `configure` - Configure settings
- `export` - Export data

### 3. Roles (Simple feature mappings)
Each role is just a map of features → operations they can perform.

---

## Usage in Routes

### Protect a route
```javascript
const { requireFeature, FEATURES, OPERATIONS } = require('../middleware/feature-permission');
const { FEATURES } = require('../rbac/features');

// Single operation
router.get('/integrations',
  auth,
  requireFeature(FEATURES.INTEGRATIONS, 'read'),
  async (req, res) => { /* ... */ }
);

// Multiple operations (user needs at least ONE)
router.post('/integrations',
  auth,
  requireFeature(FEATURES.INTEGRATIONS, ['write', 'execute']),
  async (req, res) => { /* ... */ }
);

// Multiple operations (user needs ALL)
router.delete('/integrations/:id',
  auth,
  requireFeature(FEATURES.INTEGRATIONS, ['read', 'delete'], { requireAll: true }),
  async (req, res) => { /* ... */ }
);
```

### Admin-only Routes
```javascript
const { requireAdmin, requireSuperAdmin } = require('../middleware/feature-permission');

// Only ADMIN or SUPER_ADMIN
router.get('/admin/stats', auth, requireAdmin, async (req, res) => {
  // Admin-only endpoint
});

// Only SUPER_ADMIN
router.post('/admin/critical', auth, requireSuperAdmin, async (req, res) => {
  // Super admin only
});
```

---

## Adding a New Feature

1. **Add to FEATURES** in `src/rbac/features.js`:
```javascript
const FEATURES = {
  // ... existing features
  MY_NEW_FEATURE: 'my_new_feature'
};
```

2. **Map to Roles**:
```javascript
const ROLE_FEATURES = {
  SUPER_ADMIN: {
    features: {
      // ... existing features
      [FEATURES.MY_NEW_FEATURE]: ['read', 'write', 'delete']
    }
  },
  ORG_ADMIN: {
    features: {
      [FEATURES.MY_NEW_FEATURE]: ['read', 'write']
    }
  },
  VIEWER: {
    features: {
      [FEATURES.MY_NEW_FEATURE]: ['read']
    }
  }
};
```

3. **Use in Routes**:
```javascript
router.get('/my-feature',
  auth,
  requireFeature(FEATURES.MY_NEW_FEATURE, 'read'),
  async (req, res) => { /* ... */ }
);
```

**That's it!** No complex permission strings, no scattered logic.

---

## Role Hierarchy

```
SUPER_ADMIN
  └─ Full access to everything (all features, all operations)

ADMIN
  └─ Full access except super admin privileges

ORG_ADMIN
  └─ Full control within their organization

INTEGRATION_EDITOR
  └─ Can create/edit integrations

VIEWER
  └─ Read-only access

ORG_USER
  └─ Basic read access
```

---

## Frontend Integration

```javascript
// Get user features after login
const { user, features } = await api.get('/profile');

// Check permissions at the point where an operation is exposed.
const canRunTest = hasFeatureAccess(user, FEATURES.INTEGRATIONS, 'execute');
```

---

## Benefits

✅ **Simple** - Just features and operations, no complex permission strings
✅ **Consistent** - Same operations for all features
✅ **Easy to add** - New features take 2 minutes to add
✅ **Self-documenting** - Clear what each role can do
✅ **Type-safe** - Use constants, no string typos

---

## Migration from Old System

Old (Complex):
```javascript
requirePermission('integrations:view')
requirePermission('integrations:create')
requirePermission('integrations:delete')
```

New (Simple):
```javascript
requireFeature(FEATURES.INTEGRATIONS, 'read')
requireFeature(FEATURES.INTEGRATIONS, 'write')
requireFeature(FEATURES.INTEGRATIONS, 'delete')
```

**Much cleaner!**
