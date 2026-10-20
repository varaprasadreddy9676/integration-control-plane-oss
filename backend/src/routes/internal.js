/**
 * Internal Routes
 *
 * Lightweight endpoints used by transform scripts (via the http helper) to
 * support cross-event logic such as deduplication and coalescing.
 *
 * These routes are mounted WITHOUT authentication because they are only
 * reachable from within the same process (transform scripts call
 * http://localhost:<port>/internal/...).  Never expose these routes to the
 * public internet.
 */

const express = require('express');
const router = express.Router();
const mongodb = require('../mongodb');
const { log } = require('../logger');

/**
 * GET /internal/event-coalesce
 *
 * Check whether a companion event of a given type was recently processed for
 * the same patient.  Used by OP_VISIT_CREATED transforms to detect whether a
 * COUPLE_REGISTERED event already handled the same registration session.
 *
 * Query params:
 *   orgId        {number}  required
 *   eventType    {string}  required  — the companion event type to look for
 *   patientMrn   {string}  required  — patient MRN to match
 *   withinSeconds {number} optional  — look-back window (default 120)
 *
 * Response:
 *   { exists: boolean }
 */
router.get('/event-coalesce', async (req, res) => {
  try {
    const { orgId, eventType, patientMrn, withinSeconds = 120 } = req.query;

    if (!orgId || !eventType || !patientMrn) {
      return res.status(400).json({ error: 'orgId, eventType, and patientMrn are required' });
    }

    const db = await mongodb.getDbSafe();
    const since = new Date(Date.now() - Number(withinSeconds) * 1000);

    // eventKey contains the full JSON payload, so the MRN will appear as a
    // plain string value inside it (e.g. "mrn":"BNH00045" or "mrn": "BNH00045").
    // A simple regex on the eventKey is sufficient and avoids parsing the JSON.
    const mrnPattern = new RegExp(patientMrn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

    const doc = await db.collection('processed_events').findOne({
      eventType,
      orgId: Number(orgId),
      processedAt: { $gte: since },
      eventKey: mrnPattern,
    });

    log('debug', '[internal/event-coalesce]', {
      orgId,
      eventType,
      patientMrn,
      withinSeconds,
      found: !!doc,
    });

    return res.json({ exists: !!doc });
  } catch (err) {
    log('warn', '[internal/event-coalesce] error', { error: err.message });
    // Return false on error — don't block delivery
    return res.json({ exists: false });
  }
});

module.exports = router;
