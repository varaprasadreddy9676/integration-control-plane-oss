'use strict';

const { ObjectId } = require('mongodb');
const { redactBase64 } = require('../../src/utils/payload-sanitizer');

describe('redactBase64', () => {
  it('keeps Dates and ObjectIds intact instead of turning them into {}', () => {
    const finishedAt = new Date('2026-10-21T10:00:00Z');
    const id = new ObjectId();

    const out = redactBase64({ finishedAt, integrationConfigId: id, nested: { at: finishedAt } });

    expect(out.finishedAt).toBeInstanceOf(Date);
    expect(out.finishedAt.getTime()).toBe(finishedAt.getTime());
    expect(out.integrationConfigId).toBe(id);
    expect(out.nested.at).toBeInstanceOf(Date);
  });

  it('still walks plain objects and arrays', () => {
    const out = redactBase64({ list: [{ name: 'a' }], meta: { ok: true } });
    expect(out).toEqual({ list: [{ name: 'a' }], meta: { ok: true } });
  });
});
