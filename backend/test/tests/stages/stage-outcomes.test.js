'use strict';

/**
 * What a stage can end with, read from its configuration: the script scanner
 * (comments and strings are never code; anything computed is "dynamic") and the
 * runners' own descriptions.
 */

const { scanScript, stageOutcomes } = require('../../../src/stages/outcomes');
const runners = require('../../../src/stages/runners');

const words = (result) => result.statuses.map((entry) => entry.status);

describe('scanning a script', () => {
  it('finds skip and fail calls, with their reasons and retry flags', () => {
    const result = scanScript(`
      if (!ctx.event.consent) return skip("no consent");
      if (ctx.delivery.response.status >= 500) return fail('provider down', { retryDelivery: true });
      if (bad) return fail(\`bad \${x}\`);
      return null;
    `);
    expect(result.skips).toEqual([{ reason: 'no consent' }]);
    expect(result.fails).toEqual([
      { reason: 'provider down', retryDelivery: true, retryStage: false },
      { reason: null, retryDelivery: false, retryStage: false },
    ]);
  });

  it('reads literal status words with the done flag of the same object', () => {
    const result = scanScript(`
      const r = await http({ url: 'https://x.test' });
      if (r.body.state === 'read') return { status: 'READ', done: true, data: {} };
      if (r.body.state === 'sent') return { status: "SENT", done: false };
      return { status: 'PENDING' };
    `);
    expect(result.statuses).toEqual([
      { status: 'READ', done: true },
      { status: 'SENT', done: false },
      { status: 'PENDING', done: false },
    ]);
    expect(result.dynamicStatus).toBe(false);
  });

  it('lists both alternatives of a ternary, including nested ones', () => {
    const result = scanScript(`return { status: r.ok ? 'DELIVERED' : r.late ? 'LATE' : 'FAILED', done: true };`);
    expect(words(result)).toEqual(['DELIVERED', 'LATE', 'FAILED']);
    expect(result.statuses.every((entry) => entry.done === true)).toBe(true);
    expect(result.dynamicStatus).toBe(false);
  });

  it('does not take the test of a ternary for a status, and ignores ?? and ?.', () => {
    const result = scanScript(`return { status: (ctx?.x ?? 'a') === 'a' ? 'YES' : 'NO' };`);
    expect(words(result)).toEqual(['YES', 'NO']);
  });

  it('marks a computed status as dynamic, keeping the literal alternatives it can see', () => {
    expect(scanScript(`return { status: r.body.state };`)).toMatchObject({ statuses: [], dynamicStatus: true });
    expect(scanScript(`return { status: r.ok ? 'OK' : r.body.state };`)).toMatchObject({ statuses: [{ status: 'OK' }], dynamicStatus: true });
    expect(scanScript('return { status: `S_${x}` };')).toMatchObject({ statuses: [], dynamicStatus: true });
  });

  it('ignores numbers (an HTTP-style status), comments and the insides of strings and regular expressions', () => {
    const result = scanScript(`
      // return skip("commented out");
      /* return fail("also commented") */
      const note = "call skip('in a string') or fail('x')";
      const re = /skip\\(/;
      const r = await http({ url: 'u', status: 200 });
      return { status: 'OK' };
    `);
    expect(result.skips).toEqual([]);
    expect(result.fails).toEqual([]);
    expect(words(result)).toEqual(['OK']);
  });

  it('does not take a method named skip or fail for the helpers', () => {
    expect(scanScript('list.skip(2); obj.fail("x"); return null;')).toMatchObject({ skips: [], fails: [] });
  });

  it('merges a word mentioned twice, and says "depends" when the mentions disagree on done', () => {
    const result = scanScript(`if (a) return { status: 'X', done: true }; return { status: 'X', done: false };`);
    expect(result.statuses).toEqual([{ status: 'X', done: null }]);
  });

  it('survives an empty or unbalanced script', () => {
    expect(scanScript('')).toEqual({ statuses: [], skips: [], fails: [], dynamicStatus: false });
    expect(scanScript(undefined)).toMatchObject({ statuses: [] });
    expect(() => scanScript(`return fail("x", { retryDelivery: true`)).not.toThrow();
    expect(() => scanScript(`return { status: 'A' `)).not.toThrow();
  });
});

describe('the runners describe themselves', () => {
  const stage = (type, config) => ({ id: 's', runner: { type, config } });

  it('a script is scanned', () => {
    expect(stageOutcomes(stage('script', { code: 'return skip("x");' }), runners)).toMatchObject({ known: true, skips: [{ reason: 'x' }] });
  });

  it('an http check lists its map, its fallback and which words end it; no fallback means other values pass through', () => {
    const config = { status: { from: 'state', map: { delivered: 'DELIVERED', read: 'READ' }, otherwise: 'PENDING' }, doneWhen: ['DELIVERED', 'READ'] };
    expect(stageOutcomes(stage('http', config), runners)).toMatchObject({
      statuses: [{ status: 'DELIVERED', done: true }, { status: 'READ', done: true }, { status: 'PENDING', done: false }],
      dynamicStatus: false,
    });
    expect(stageOutcomes(stage('http', { status: { from: 'state', map: { a: 'A' } } }), runners).dynamicStatus).toBe(true);
    expect(stageOutcomes(stage('http', {}), runners)).toMatchObject({ statuses: [], dynamicStatus: false });
  });

  it('the URL check passes or fails, with a retryable failure', () => {
    const result = stageOutcomes(stage('url-check', { checks: [] }), runners);
    expect(result.statuses).toEqual([{ status: 'PASS', done: false }]);
    expect(result.fails.map((entry) => entry.retryDelivery)).toEqual([true, false]);
  });

  it('a runner that does not describe itself is unknown, not empty', () => {
    expect(stageOutcomes(stage('nothing', {}), runners)).toMatchObject({ known: false, statuses: [] });
  });
});
