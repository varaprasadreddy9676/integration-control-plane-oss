export const defaultScript = `// Transform the incoming event payload
// Available: payload (the event data), context (eventType, tenantId, entityName)

const transformed = {
  entity_id: payload.patientRID,
  entity_name: payload.name,
  source: 'source-system',
  event_type: context.eventType
};

return transformed;`;
