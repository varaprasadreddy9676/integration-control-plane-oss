'use strict';

const fs = require('fs');
const path = require('path');

const WORLD_WRITABLE = 0o002;
const STICKY = 0o1000;

/**
 * The directories, from `start` up to the root, that any user can rename entries in: writable by everyone and
 * not sticky. A stage runner is an unprivileged user; through such a directory it could move the backend's
 * code aside and leave its own for the (root) service to run at the next restart. A directory that cannot
 * be read is skipped: it cannot be written through either.
 */
function replaceableDirs(start, fileSystem = fs) {
  const found = [];
  let dir = start;
  for (;;) {
    try {
      const { mode } = fileSystem.statSync(dir);
      if (mode & WORLD_WRITABLE && !(mode & STICKY)) found.push(dir);
    } catch (_error) {
      // Not readable here: not writable through either.
    }
    const parent = path.dirname(dir);
    if (parent === dir) return found;
    dir = parent;
  }
}

/** Where the backend's code is, resolved through symlinks. */
const codeDir = () => fs.realpathSync(path.join(__dirname, '..', '..'));

module.exports = { replaceableDirs, codeDir };
