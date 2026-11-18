'use strict';

/**
 * What saving a draft would do to scheduled work already waiting: the canvas shows
 * it before Save ("41 scheduled checks keep their version"). It mirrors what a
 * save really does:
 *   edited stage     waiting checks keep the version they were scheduled with (they
 *                    can be moved to the new one afterwards, see re-pin)
 *   stage switched off   its waiting checks are paused
 *   stage switched on    its paused checks resume
 *   stage removed    its waiting checks are cancelled
 * A stage that was not edited can still have checks on an older version, left by an
 * earlier edit; they are counted too.
 *
 * Pure: `jobRows` is jobs.hashCounts, `hashOf(stage)` the definition hash.
 */

const { allStages } = require('./targets');

const WAITING = ['PENDING', 'PAUSED', 'HANDOVER'];

const sum = (rows, test) => rows.filter(test).reduce((total, row) => total + row.count, 0);

function describeStage(stageId, before, after, rows, hashOf) {
  const mine = rows.filter((row) => row.stageId === stageId);
  const waiting = mine.filter((row) => WAITING.includes(row.state));
  const base = { stageId, name: (after || before).name || stageId, hook: (after || before).hook };

  if (!before) return { ...base, change: 'added', keepOldVersion: 0, paused: 0, resumed: 0, cancelled: 0 };
  if (!after) return { ...base, change: 'removed', keepOldVersion: 0, paused: 0, resumed: 0, cancelled: sum(waiting, () => true) };

  const wasOn = before.enabled !== false;
  const isOn = after.enabled !== false;
  const edited = hashOf(before) !== hashOf(after);
  const change = wasOn && !isOn ? 'disabled' : !wasOn && isOn ? 'enabled' : edited ? 'edited' : 'unchanged';
  return {
    ...base,
    change,
    keepOldVersion: sum(waiting, (row) => row.definitionHash !== hashOf(after)),
    paused: change === 'disabled' ? sum(mine, (row) => row.state === 'PENDING') : 0,
    resumed: change === 'enabled' ? sum(mine, (row) => row.state === 'PAUSED') : 0,
    cancelled: 0,
  };
}

/** saveImpact(existing, draft, jobRows, hashOf) -> { stages: [per stage], totals } */
function saveImpact(existing, draft, jobRows, hashOf) {
  const byId = (integration) => new Map(allStages(integration || {}).map((stage) => [stage.id, stage]));
  const before = byId(existing);
  const after = byId(draft);
  const ids = [...new Set([...before.keys(), ...after.keys()])];
  const stages = ids.map((id) => describeStage(id, before.get(id), after.get(id), jobRows, hashOf));
  const total = (field) => stages.reduce((sum_, stage) => sum_ + stage[field], 0);
  return {
    stages: stages.filter((stage) => stage.change !== 'unchanged' || stage.keepOldVersion > 0),
    totals: { keepOldVersion: total('keepOldVersion'), paused: total('paused'), resumed: total('resumed'), cancelled: total('cancelled') },
  };
}

module.exports = { saveImpact };
