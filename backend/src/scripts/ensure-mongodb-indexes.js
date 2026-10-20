'use strict';

const mongodb = require('../mongodb');
const { log } = require('../logger');

async function main() {
  try {
    await mongodb.connect();
    await mongodb.ensureIndexes();
    log('info', 'MongoDB indexes ensured successfully');
  } catch (error) {
    log('error', 'Failed to ensure MongoDB indexes', { error: error.message });
    process.exitCode = 1;
  } finally {
    await mongodb.close().catch(() => {});
  }
}

main();
