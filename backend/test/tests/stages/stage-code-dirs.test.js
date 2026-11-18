'use strict';

/**
 * A stage runner is an unprivileged user. If a directory above the backend's code is writable by every user
 * (and not sticky), that user could rename the code away and leave its own for the root service to run at
 * the next restart. The runtime refuses stages while that is true, and says what to run.
 */

jest.mock('../../../src/config', () => ({ security: {}, worker: {}, stages: {} }));

const { replaceableDirs } = require('../../../src/stages/runtime/code-dirs');

// A fake file system: path -> mode (stat's st_mode low bits).
const fsOf = (modes) => ({
  statSync: (dir) => {
    if (!(dir in modes)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    return { mode: 0o040000 | modes[dir] };
  },
});

describe('directories a runner could swap the backend code through', () => {
  it('finds none when every directory above the code is closed to other users', () => {
    const fs = fsOf({ '/data/app/backend/src': 0o755, '/data/app/backend': 0o755, '/data/app': 0o755, '/data': 0o755, '/': 0o755 });
    expect(replaceableDirs('/data/app/backend/src', fs)).toEqual([]);
  });

  it('finds the ones writable by everyone, naming each', () => {
    const fs = fsOf({ '/data/app/backend/src': 0o755, '/data/app/backend': 0o777, '/data/app': 0o777, '/data': 0o755, '/': 0o755 });
    expect(replaceableDirs('/data/app/backend/src', fs)).toEqual(['/data/app/backend', '/data/app']);
  });

  it('accepts a world-writable directory that is sticky (nobody can rename what they do not own)', () => {
    const fs = fsOf({ '/data/app/backend/src': 0o755, '/data/app/backend': 0o1777, '/data/app': 0o1777, '/data': 0o755, '/': 0o755 });
    expect(replaceableDirs('/data/app/backend/src', fs)).toEqual([]);
  });

  it('counts the code directory itself, and ignores a directory it cannot read', () => {
    const fs = fsOf({ '/data/app/backend/src': 0o777, '/data/app/backend': 0o755, '/data/app': 0o755, '/': 0o755 });
    expect(replaceableDirs('/data/app/backend/src', fs)).toEqual(['/data/app/backend/src']);
  });
});
