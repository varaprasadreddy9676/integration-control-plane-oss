'use strict';

const crypto = require('crypto');

const DEFAULT_SEPARATORS = Object.freeze({
  field: '|',
  component: '^',
  repetition: '~',
  escape: '\\',
  subcomponent: '&',
});

const MLLP_START = 0x0b;
const MLLP_END = 0x1c;
const CR = 0x0d;
const MAX_HL7_MESSAGE_BYTES = 5 * 1024 * 1024;

function getSeparators(separators = {}) {
  return { ...DEFAULT_SEPARATORS, ...(separators || {}) };
}

function normalizeString(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return formatHl7DateTime(value);
  return String(value);
}

function escapeValue(value, separators = DEFAULT_SEPARATORS) {
  const sep = getSeparators(separators);
  // split/join, not replaceAll: production runs Node 14, which lacks it.
  return normalizeString(value)
    .split(sep.escape)
    .join(`${sep.escape}E${sep.escape}`)
    .split(sep.field)
    .join(`${sep.escape}F${sep.escape}`)
    .split(sep.component)
    .join(`${sep.escape}S${sep.escape}`)
    .split(sep.repetition)
    .join(`${sep.escape}R${sep.escape}`)
    .split(sep.subcomponent)
    .join(`${sep.escape}T${sep.escape}`)
    .replace(/\r/g, `${sep.escape}X0D${sep.escape}`)
    .replace(/\n/g, `${sep.escape}X0A${sep.escape}`);
}

function unescapeValue(value, separators = DEFAULT_SEPARATORS) {
  const sep = getSeparators(separators);
  const tokenPattern = new RegExp(`${escapeRegExp(sep.escape)}(F|S|R|T|E|X0D|X0A)${escapeRegExp(sep.escape)}`, 'gi');
  return normalizeString(value).replace(tokenPattern, (_match, token) => {
    switch (String(token).toUpperCase()) {
      case 'F':
        return sep.field;
      case 'S':
        return sep.component;
      case 'R':
        return sep.repetition;
      case 'T':
        return sep.subcomponent;
      case 'E':
        return sep.escape;
      case 'X0D':
        return '\r';
      case 'X0A':
        return '\n';
      default:
        return _match;
    }
  });
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function validateSegmentName(name) {
  if (!/^[A-Z0-9]{2,4}$/.test(String(name || ''))) {
    throw new Error(`Invalid HL7 segment name: ${name}`);
  }
}

function formatComponent(value, separators) {
  const sep = getSeparators(separators);
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) {
    return value.map((part) => escapeValue(part, sep)).join(sep.subcomponent);
  }
  return escapeValue(value, sep);
}

function formatField(value, separators = DEFAULT_SEPARATORS) {
  const sep = getSeparators(separators);
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) {
    return value.map((component) => formatComponent(component, sep)).join(sep.component);
  }
  if (typeof value === 'object') {
    if (Array.isArray(value.repetitions)) {
      return value.repetitions.map((item) => formatField(item, sep)).join(sep.repetition);
    }
    if (Array.isArray(value.components)) {
      return value.components.map((component) => formatComponent(component, sep)).join(sep.component);
    }
    if (Object.prototype.hasOwnProperty.call(value, 'value')) {
      return formatField(value.value, sep);
    }
  }
  return escapeValue(value, sep);
}

function buildSegment(name, fields = [], options = {}) {
  const segmentName = String(name || '').toUpperCase();
  validateSegmentName(segmentName);
  if (!Array.isArray(fields)) {
    throw new Error(`HL7 segment ${segmentName} fields must be an array`);
  }
  const sep = getSeparators(options.separators);
  if (segmentName === 'MSH') {
    const [encodingCharacters = '^~\\&', ...rest] = fields;
    return [segmentName, normalizeString(encodingCharacters), ...rest.map((field) => formatField(field, sep))].join(
      sep.field
    );
  }
  return [segmentName, ...fields.map((field) => formatField(field, sep))].join(sep.field);
}

function ensureTrailingSegmentBreak(message) {
  return message.endsWith('\r') ? message : `${message}\r`;
}

function normalizeRawMessage(message) {
  const text = stripMllp(normalizeString(message)).replace(/\r?\n/g, '\r');
  return ensureTrailingSegmentBreak(text);
}

function buildMessage(input, options = {}) {
  if (typeof input === 'string') {
    const message = normalizeRawMessage(input);
    validateMessageSize(message);
    return message;
  }

  const segments = Array.isArray(input) ? input : input?.segments;
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new Error('HL7 message must contain at least one segment');
  }

  const message = segments
    .map((segment) => {
      if (typeof segment === 'string') return segment.replace(/\r+$/g, '');
      return buildSegment(segment.name || segment.segment, segment.fields || [], options);
    })
    .join('\r');

  const normalized = ensureTrailingSegmentBreak(message);
  validateMessageSize(normalized);
  return normalized;
}

function validateMessageSize(message) {
  if (!message || !String(message).trim()) {
    throw new Error('HL7 message is required');
  }
  if (Buffer.byteLength(message) > MAX_HL7_MESSAGE_BYTES) {
    throw new Error(`HL7 message exceeds ${MAX_HL7_MESSAGE_BYTES} bytes`);
  }
}

function parseField(raw, separators = DEFAULT_SEPARATORS) {
  const sep = getSeparators(separators);
  const repetitions = String(raw ?? '').split(sep.repetition).map((rep) => {
    const components = rep.split(sep.component).map((component) =>
      component.split(sep.subcomponent).map((subcomponent) => unescapeValue(subcomponent, sep))
    );
    return components;
  });
  const value = unescapeValue(raw, sep);
  return { raw: String(raw ?? ''), value, repetitions };
}

function detectSeparators(message) {
  const firstSegment = String(message || '').split('\r').find(Boolean) || '';
  if (!firstSegment.startsWith('MSH') || firstSegment.length < 4) {
    return DEFAULT_SEPARATORS;
  }

  const field = firstSegment[3] || DEFAULT_SEPARATORS.field;
  const encoding = firstSegment.split(field)[1] || '^~\\&';
  return {
    field,
    component: encoding[0] || DEFAULT_SEPARATORS.component,
    repetition: encoding[1] || DEFAULT_SEPARATORS.repetition,
    escape: encoding[2] || DEFAULT_SEPARATORS.escape,
    subcomponent: encoding[3] || DEFAULT_SEPARATORS.subcomponent,
  };
}

function parseMessage(rawMessage) {
  const message = stripMllp(rawMessage).replace(/\r?\n/g, '\r').trimEnd();
  if (!message) {
    throw new Error('HL7 message is empty');
  }

  const separators = detectSeparators(message);
  const rawSegments = message.split('\r').filter(Boolean);
  const segments = rawSegments.map((raw) => {
    const parts = raw.split(separators.field);
    const name = parts.shift();
    validateSegmentName(name);
    return {
      name,
      raw,
      fields: parts.map((field) => parseField(field, separators)),
    };
  });

  const msh = segments.find((segment) => segment.name === 'MSH');
  if (!msh) {
    throw new Error('HL7 message is missing required MSH segment');
  }

  const messageTypeField = String(msh.fields[7]?.raw || '')
    .split(separators.component)
    .map((part) => unescapeValue(part, separators));
  const messageType = {
    code: messageTypeField[0] || null,
    trigger: messageTypeField[1] || null,
  };

  const parsed = {
    raw: ensureTrailingSegmentBreak(message),
    separators,
    segments,
    messageType,
    messageControlId: msh.fields[8]?.value || null,
    version: msh.fields[10]?.value || null,
    getFirst(name) {
      return segments.find((segment) => segment.name === String(name || '').toUpperCase()) || null;
    },
    getAll(name) {
      return segments.filter((segment) => segment.name === String(name || '').toUpperCase());
    },
  };

  return parsed;
}

function parseAck(rawMessage) {
  const parsed = parseMessage(rawMessage);
  const msa = parsed.getFirst('MSA');
  if (!msa) {
    throw new Error('HL7 ACK is missing MSA segment');
  }

  const code = msa.fields[0]?.value || '';
  const messageControlId = msa.fields[1]?.value || null;
  const errorMessage = msa.fields[2]?.value || null;
  return {
    accepted: code === 'AA' || code === 'CA',
    code,
    messageControlId,
    errorMessage,
    parsed,
    raw: parsed.raw,
  };
}

function buildAck(input = {}) {
  const code = input.code || (input.accepted === false ? 'AE' : 'AA');
  const original = input.originalMessage ? parseMessage(input.originalMessage) : null;
  const originalMsh = original?.getFirst('MSH');
  const originalMessageType = original?.messageType || {};
  const trigger = input.triggerEvent || originalMessageType.trigger || '';
  const ackType = trigger ? ['ACK', trigger] : ['ACK'];

  return buildMessage({
    segments: [
      buildMsh(
        {
          sendingApp:
            input.sendingApp ||
            (originalMsh ? originalMsh.fields[3]?.value : null) ||
            'INTEGRATION_GATEWAY',
          sendingFacility: input.sendingFacility || (originalMsh ? originalMsh.fields[4]?.value : null) || '',
          receivingApp: input.receivingApp || (originalMsh ? originalMsh.fields[1]?.value : null) || '',
          receivingFacility: input.receivingFacility || (originalMsh ? originalMsh.fields[2]?.value : null) || '',
          messageControlId: input.ackMessageControlId || createMessageControlId('ACK'),
          hl7Version: input.hl7Version || original?.version || '2.3',
          processingId: input.processingId || 'P',
        },
        ackType[0],
        ackType[1] || ''
      ),
      {
        name: 'MSA',
        fields: [
          code,
          input.messageControlId || original?.messageControlId || '',
          input.text || input.errorMessage || '',
        ],
      },
    ],
  });
}

function stripMllp(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(normalizeString(value));
  if (buffer.length >= 3 && buffer[0] === MLLP_START) {
    const endIndex = buffer.lastIndexOf(Buffer.from([MLLP_END, CR]));
    if (endIndex !== -1) {
      return buffer.subarray(1, endIndex).toString('utf8');
    }
  }
  return buffer.toString('utf8');
}

function frameMllp(message) {
  const built = buildMessage(message);
  return Buffer.concat([Buffer.from([MLLP_START]), Buffer.from(built, 'utf8'), Buffer.from([MLLP_END, CR])]);
}

function extractMllpFrames(data) {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data || '');
  const frames = [];
  let cursor = 0;

  while (cursor < buffer.length) {
    const start = buffer.indexOf(MLLP_START, cursor);
    if (start === -1) break;
    const end = buffer.indexOf(Buffer.from([MLLP_END, CR]), start + 1);
    if (end === -1) break;
    frames.push(buffer.subarray(start + 1, end).toString('utf8'));
    cursor = end + 2;
  }

  return frames;
}

function pad(value, size = 2) {
  return String(value).padStart(size, '0');
}

function formatHl7DateTime(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid HL7 date/time value: ${value}`);
  }
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
}

function createMessageControlId(prefix = 'MSG') {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

function buildMsh(input = {}, messageType, triggerEvent) {
  const timestamp = input.timestamp ? formatHl7DateTime(input.timestamp) : formatHl7DateTime(new Date());
  return {
    name: 'MSH',
    fields: [
      '^~\\&',
      input.sendingApp || 'INTEGRATION_GATEWAY',
      input.sendingFacility || input.orgName || '',
      input.receivingApp || '',
      input.receivingFacility || '',
      timestamp,
      '',
      [messageType, triggerEvent],
      input.messageControlId || createMessageControlId(messageType),
      input.processingId || 'P',
      input.hl7Version || '2.3',
    ],
  };
}

function ormO01(input = {}) {
  const patient = input.patient || {};
  const order = input.order || {};
  return buildMessage({
    segments: [
      buildMsh(input, 'ORM', 'O01'),
      {
        name: 'PID',
        fields: [
          '',
          '',
          patient.id || patient.patientId || '',
          '',
          patient.nameComponents || patient.name || '',
          '',
          patient.birthDate || patient.dob || '',
          patient.sex || '',
          '',
          '',
          '',
          '',
          patient.phone ? { repetitions: [patient.phone, patient.email || ''] } : patient.email || '',
          '',
          '',
          '',
          '',
          patient.admissionId || '',
        ],
      },
      {
        name: 'ORC',
        fields: [
          input.orderControl || order.orderControl || 'NW',
          order.placerOrderNumber || order.orderId || '',
          order.fillerOrderNumber || '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          order.radiologistId || '',
        ],
      },
      {
        name: 'OBR',
        fields: [
          '',
          order.placerOrderNumber || order.orderId || '',
          order.fillerOrderNumber || order.centerId || '',
          [order.testId || order.testCode || '', order.testName || order.testDescription || ''],
          order.priority || '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          order.aeTitle || '',
          '',
          '',
          order.modality || '',
          '',
          order.medicoLegalCase || '',
          '',
          '',
          '',
          '',
          ['', order.reasonForStudy || ''],
          '',
          '',
          order.technicianId || '',
          '',
          order.scheduledAt || order.scheduledDateTime || '',
        ],
      },
      ...(order.studyInstanceUid ? [{ name: 'ZDS', fields: [order.studyInstanceUid] }] : []),
    ],
  });
}

function adtA08(input = {}) {
  const patient = input.patient || {};
  return buildMessage({
    segments: [
      buildMsh(input, 'ADT', 'A08'),
      {
        name: 'PID',
        fields: ['', '', patient.id || patient.patientId || '', '', patient.nameComponents || patient.name || '', '', patient.birthDate || patient.dob || '', patient.sex || ''],
      },
    ],
  });
}

function oruR01(input = {}) {
  const patient = input.patient || {};
  const order = input.order || {};
  const report = input.report || {};
  return buildMessage({
    segments: [
      buildMsh(input, 'ORU', 'R01'),
      {
        name: 'PID',
        fields: ['', '', patient.id || patient.patientId || '', '', patient.nameComponents || patient.name || '', '', patient.birthDate || patient.dob || '', patient.sex || ''],
      },
      {
        name: 'OBR',
        fields: [
          '',
          order.placerOrderNumber || order.orderId || '',
          order.fillerOrderNumber || order.centerId || '',
          [order.testId || '', order.testName || ''],
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          report.status || order.status || '',
        ],
      },
      {
        name: 'OBX',
        fields: [
          '1',
          report.format || 'TX',
          [report.testId || order.testId || '', report.testDescription || order.testName || ''],
          '',
          report.text || report.data || '',
          '',
          '',
          report.patientCondition || '',
          '',
          '',
          report.status || '',
          '',
          report.receivingDateTime || '',
          '',
          report.reportDateTime || '',
          [report.radiologistId || '', report.radiologistName || ''],
          '',
          '',
          report.studyDateTime || '',
        ],
      },
    ],
  });
}

function toMessageString(value) {
  if (typeof value === 'string' || Buffer.isBuffer(value)) return buildMessage(value);
  return buildMessage(value);
}

module.exports = {
  DEFAULT_SEPARATORS,
  MLLP_START,
  MLLP_END,
  CR,
  escapeValue,
  unescapeValue,
  buildSegment,
  buildMessage,
  parseMessage,
  parseAck,
  buildAck,
  frameMllp,
  extractMllpFrames,
  stripMllp,
  formatHl7DateTime,
  createMessageControlId,
  ormO01,
  oruR01,
  adtA08,
  toMessageString,
};
