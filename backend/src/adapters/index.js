/**
 * Event Source Adapters
 *
 * Export all event source adapters for easy importing
 */

const { EventSourceAdapter } = require('./EventSourceAdapter');
const { MysqlEventSource } = require('./MysqlEventSource');
const { Hl7MllpEventSource } = require('./Hl7MllpEventSource');
// Note: KafkaEventSource is NOT exported because it requires 'kafkajs' package
// which is not in dependencies. Add kafkajs to package.json before enabling.
// const { KafkaEventSource } = require('./KafkaEventSource');

module.exports = {
  EventSourceAdapter,
  MysqlEventSource,
  Hl7MllpEventSource,
  // KafkaEventSource - Uncomment when kafkajs dependency is added
};
