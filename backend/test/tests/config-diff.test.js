'use strict';

const { diffConfigs, summarizePaths } = require('../../src/utils/config-diff');
const { SECRET_MASK } = require('../../src/utils/integration-secrets');

describe('diffConfigs', () => {
  it('reports added, removed and changed fields with dotted paths', () => {
    const before = { name: 'Orders', targetUrl: 'https://a.example', retryCount: 3, transformation: { mode: 'SIMPLE' } };
    const after = { name: 'Orders', targetUrl: 'https://b.example', transformation: { mode: 'SCRIPT', script: 'return 1;' }, timeoutMs: 5000 };

    expect(diffConfigs(before, after)).toEqual([
      { path: 'retryCount', kind: 'removed', before: 3, after: undefined },
      { path: 'targetUrl', kind: 'changed', before: 'https://a.example', after: 'https://b.example' },
      { path: 'timeoutMs', kind: 'added', before: undefined, after: 5000 },
      { path: 'transformation.mode', kind: 'changed', before: 'SIMPLE', after: 'SCRIPT' },
      { path: 'transformation.script', kind: 'added', before: undefined, after: 'return 1;' },
    ]);
  });

  it('compares arrays as a whole and treats equal dates as unchanged', () => {
    const at = new Date('2026-10-21T00:00:00Z');
    const changes = diffConfigs(
      { mappings: [{ from: 'a', to: 'b' }], at },
      { mappings: [{ from: 'a', to: 'c' }], at: new Date(at.getTime()) }
    );
    expect(changes).toEqual([
      { path: 'mappings', kind: 'changed', before: [{ from: 'a', to: 'b' }], after: [{ from: 'a', to: 'c' }] },
    ]);
  });

  it('masks secret values but still reports that they changed', () => {
    const changes = diffConfigs(
      { outgoingAuthConfig: { headerName: 'X-Key', apiKey: 'old-secret' } },
      { outgoingAuthConfig: { headerName: 'X-Key', apiKey: 'new-secret' } },
      { maskSecrets: true }
    );
    expect(changes).toEqual([
      { path: 'outgoingAuthConfig.apiKey', kind: 'changed', before: SECRET_MASK, after: SECRET_MASK, secret: true },
    ]);
  });
});

describe('diffConfigs masking whole objects', () => {
  it('masks secrets nested inside a value that changed as a whole', () => {
    const changes = diffConfigs(
      { outgoingAuthConfig: null },
      { outgoingAuthConfig: { headerName: 'X-Partner-Key', apiKey: 'partner-secret-123' } },
      { maskSecrets: true }
    );
    expect(JSON.stringify(changes)).not.toContain('partner-secret-123');
    expect(changes[0].after).toEqual({ headerName: 'X-Partner-Key', apiKey: SECRET_MASK });
  });

  it('masks secrets inside arrays of actions', () => {
    const changes = diffConfigs(
      { actions: [] },
      { actions: [{ communicationConfig: { smtp: { password: 'smtp-pass' } } }] },
      { maskSecrets: true }
    );
    expect(JSON.stringify(changes)).not.toContain('smtp-pass');
  });
});

describe('summarizePaths', () => {
  it('collapses changes to at most two path segments, unique and in order', () => {
    expect(summarizePaths(['targetUrl', 'transformation.script', 'transformation.mode', 'a.b.c.d'])).toEqual([
      'targetUrl',
      'transformation.script',
      'transformation.mode',
      'a.b',
    ]);
  });
});
