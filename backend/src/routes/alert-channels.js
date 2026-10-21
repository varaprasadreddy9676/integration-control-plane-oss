'use strict';

/**
 * Alert channels: where an organization's alerts go.
 *
 *   GET    /alert-channels/plugins      available channel types and their settings
 *   GET    /alert-channels              this org's channels (secrets masked)
 *   POST   /alert-channels              { type, name, enabled, events, config }
 *   PUT    /alert-channels/:id
 *   DELETE /alert-channels/:id
 *   POST   /alert-channels/:id/test     send a sample alert now
 */

const express = require('express');
const { logError } = require('../logger');
const channels = require('../data/alert-channels');
const plugins = require('../services/notifications/plugins');
const { ALERT_EVENTS } = require('../services/notifications/alert-events');
const { testChannel } = require('../services/notifications/alert-dispatcher');
const { requirePermission } = require('../middleware/permission');
const { auditAlertChannel } = require('../middleware/audit');

const router = express.Router();

const requireOrg = (req, res, next) => (req.orgId ? next() : res.status(400).json({ error: 'orgId is required' }));

function handle(scope, fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (error) {
      if (error instanceof channels.AlertChannelError) return res.status(400).json({ error: error.message });
      logError(error, { scope });
      res.status(500).json({ error: 'Something went wrong with alert channels' });
    }
  };
}

router.get('/plugins', (_req, res) => {
  res.json({ plugins: plugins.listPlugins(), events: ALERT_EVENTS });
});

router.get(
  '/',
  requireOrg,
  requirePermission('org:view'),
  handle('GET /alert-channels', async (req, res) => {
    res.json({ channels: await channels.listChannels(req.orgId) });
  })
);

router.post(
  '/',
  requireOrg,
  requirePermission('org:edit'),
  handle('POST /alert-channels', async (req, res) => {
    const created = await channels.createChannel(req.orgId, req.body || {});
    await auditAlertChannel.changed(req, 'CREATED', created.id, { before: null, after: created });
    res.status(201).json(created);
  })
);

router.put(
  '/:id',
  requireOrg,
  requirePermission('org:edit'),
  handle('PUT /alert-channels/:id', async (req, res) => {
    const updated = await channels.updateChannel(req.orgId, req.params.id, req.body || {});
    if (!updated) return res.status(404).json({ error: 'Alert channel not found' });
    await auditAlertChannel.changed(req, 'UPDATED', updated.id, { after: updated });
    res.json(updated);
  })
);

router.delete(
  '/:id',
  requireOrg,
  requirePermission('org:edit'),
  handle('DELETE /alert-channels/:id', async (req, res) => {
    const deleted = await channels.deleteChannel(req.orgId, req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Alert channel not found' });
    await auditAlertChannel.changed(req, 'DELETED', req.params.id, { before: { id: req.params.id }, after: null });
    res.status(204).end();
  })
);

router.post(
  '/:id/test',
  requireOrg,
  requirePermission('org:edit'),
  handle('POST /alert-channels/:id/test', async (req, res) => {
    const result = await testChannel(req.orgId, req.params.id);
    if (!result) return res.status(404).json({ error: 'Alert channel not found' });
    res.json(result);
  })
);

module.exports = router;
