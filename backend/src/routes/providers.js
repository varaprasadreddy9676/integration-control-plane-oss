'use strict';

const express = require('express');
const auth = require('../middleware/auth');
const asyncHandler = require('../utils/async-handler');
const providers = require('../data/providers');

const router = express.Router();

router.use(auth.requireEntity);

// GET /providers — list all providers for the org
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const activeOnly = req.query.active === 'true';
    const items = await providers.listProviders(req.orgId, { activeOnly });
    res.json({ items });
  })
);

// POST /providers — create a new provider
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const item = await providers.createProvider(req.orgId, req.body || {}, {
      createdBy: req.user?.email || req.user?.id || 'system',
    });
    res.status(201).json({ item });
  })
);

// PUT /providers/:id — update a provider
router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const item = await providers.updateProvider(req.orgId, req.params.id, req.body || {});
    res.json({ item });
  })
);

// DELETE /providers/:id — delete a provider
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    await providers.deleteProvider(req.orgId, req.params.id);
    res.json({ success: true });
  })
);

module.exports = router;
