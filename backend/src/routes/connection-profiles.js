'use strict';
const express = require('express');
const router = express.Router();
const { requirePermission } = require('../middleware/permission');
const {
  listProfiles,
  getProfile,
  createProfile,
  updateProfile,
  deleteProfile,
} = require('../services/connection-profiles');

// GET /connection-profiles
router.get('/', requirePermission('scheduled:view'), async (req, res) => {
  try {
    const profiles = await listProfiles(req.orgId || null);
    res.json({ success: true, data: profiles });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /connection-profiles/:id
router.get('/:id', requirePermission('scheduled:view'), async (req, res) => {
  try {
    const profile = await getProfile(req.params.id, req.orgId || null);
    if (!profile) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, data: profile });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /connection-profiles
router.post('/', requirePermission('scheduled:edit'), async (req, res) => {
  try {
    const { name, slug, type, config, secrets, description } = req.body;
    if (!name || !type) return res.status(400).json({ success: false, error: 'name and type are required' });
    const profile = await createProfile({ name, slug, type, config: config || {}, secrets: secrets || {}, orgId: req.orgId || null, description });
    res.status(201).json({ success: true, data: profile });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /connection-profiles/:id
router.put('/:id', requirePermission('scheduled:edit'), async (req, res) => {
  try {
    const updated = await updateProfile(req.params.id, req.body, req.orgId || null);
    if (!updated) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /connection-profiles/:id
router.delete('/:id', requirePermission('scheduled:edit'), async (req, res) => {
  try {
    await deleteProfile(req.params.id, req.orgId || null);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
