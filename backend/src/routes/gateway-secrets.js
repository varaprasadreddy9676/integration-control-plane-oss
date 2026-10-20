'use strict';
const express = require('express');
const router = express.Router();
const { requirePermission } = require('../middleware/permission');
const { setSecret, listSecrets, deleteSecret } = require('../services/gateway-secrets');

// GET /gateway-secrets — list keys only, never values
router.get('/', requirePermission('scheduled:view'), async (req, res) => {
  try {
    const secrets = await listSecrets(req.orgId || null);
    res.json({ success: true, data: secrets });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /gateway-secrets — create or update a secret
router.post('/', requirePermission('scheduled:edit'), async (req, res) => {
  try {
    const { key, value } = req.body;
    if (!key || !value) return res.status(400).json({ success: false, error: 'key and value are required' });
    await setSecret(key, value, req.orgId || null);
    res.status(201).json({ success: true, data: { key } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /gateway-secrets/:key
router.delete('/:key', requirePermission('scheduled:edit'), async (req, res) => {
  try {
    await deleteSecret(req.params.key, req.orgId || null);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
