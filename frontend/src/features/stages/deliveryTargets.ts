/**
 * Where stages live and what a stage sees of a delivery, as the server defines
 * them (backend stages/targets.js and stages/delivery-shape.js). Stages belong to
 * a delivery: an integration that sends once keeps them on itself, an
 * integration with actions keeps them on each action. Email, SMS, HL7 and HTTP
 * deliveries are all the same to stages.
 */

export type RequestPart = 'headers' | 'query' | 'fields';

/** One delivery that can have stages, as the console edits it. */
export interface DeliveryTarget {
  key: string;
  /** The action's name; null when the integration sends once. */
  label: string | null;
  /** Where its stages and Send step are in the form. */
  namePath: (string | number)[];
  protocol: string;
  /** Which delivery, for the server: null is the integration itself. */
  actionIndex: number | null;
}

interface DeliveryOwner {
  name?: string;
  kind?: string;
  communicationConfig?: { channel?: string };
  stages?: unknown[];
}

const LABELS: Record<string, string> = {
  http: 'HTTP',
  hl7: 'HL7',
  email: 'Email',
  sms: 'SMS',
  whatsapp: 'WhatsApp',
  push: 'Push',
};

export const protocolOf = (owner: DeliveryOwner = {}): string => {
  const kind = String(owner.kind || 'HTTP').toUpperCase();
  if (kind === 'COMMUNICATION') return String(owner.communicationConfig?.channel || 'message').toLowerCase();
  if (kind === 'HL7_MLLP') return 'hl7';
  return 'http';
};

export const protocolLabel = (protocol: string) => LABELS[protocol] || protocol.toUpperCase();

/** Only an HTTP request has headers and a query string; every delivery has a message with fields. */
export const requestParts = (protocol: string): RequestPart[] =>
  protocol === 'http' ? ['headers', 'query', 'fields'] : ['fields'];

/** The deliveries of an outbound integration form: the integration itself, or one per action. */
export const deliveriesOf = (values: { actions?: DeliveryOwner[] } = {}): DeliveryTarget[] => {
  const actions = Array.isArray(values.actions) ? values.actions : [];
  if (actions.length === 0)
    return [{ key: 'integration', label: null, namePath: [], protocol: 'http', actionIndex: null }];
  return actions.map((action, index) => ({
    key: `action-${index}`,
    label: action?.name || `Action ${index + 1}`,
    namePath: ['actions', index],
    protocol: protocolOf(action),
    actionIndex: index,
  }));
};

/** Every stage of an integration form, wherever it lives. */
export const stageCountOf = (values: { stages?: unknown[]; actions?: DeliveryOwner[] } = {}) =>
  (values.stages || []).length + (values.actions || []).reduce((sum, action) => sum + (action?.stages || []).length, 0);

/** A sample of what a stage sees as the request about to be sent. */
export const sampleRequest = (protocol: string, body: unknown) => ({
  protocol,
  target: null,
  method: protocol === 'http' ? 'POST' : null,
  body,
});

/**
 * A sample of what a stage sees as an accepted answer. `code` is an HTTP status
 * for HTTP (200), otherwise the answer's own code (SENT, AA...).
 */
export const sampleResponse = (protocol: string, code: string, body: unknown) => {
  const status = protocol === 'http' ? Number(code) || null : null;
  const ok = status === null || (status >= 200 && status < 300);
  return { protocol, ok, status, code, message: null, providerMessageId: null, headers: {}, body };
};
