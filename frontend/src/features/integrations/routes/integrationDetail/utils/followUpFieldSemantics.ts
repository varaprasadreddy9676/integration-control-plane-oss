import type { ConditionPredicateValueType } from '../../../../../mocks/types';

interface SchemaFieldLike {
  path?: string;
  name?: string;
  type?: string;
  description?: string;
  example?: unknown;
}

export type FollowUpFieldKind = 'string' | 'number' | 'boolean' | 'date' | 'datetime' | 'time';

export interface FollowUpFieldSemantic {
  kind: FollowUpFieldKind;
  valueType: ConditionPredicateValueType;
  displayType: string;
  isDateLike: boolean;
  supportsOffsetTiming: boolean;
  priority: number;
}

const GENERIC_METADATA_PATHS = new Set([
  'type',
  'datetime',
  'description',
  'tenantId',
  'entityCode',
  'entityName',
  'entityPhone',
  'orgId',
  'enterpriseCode',
  'enterpriseEntityRID',
  'unitRID',
  'userRID',
]);

const DATE_ONLY_EXAMPLE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_ONLY_EXAMPLE = /^\d{2}:\d{2}(:\d{2})?$/;
const DATE_TIME_EXAMPLE = /(\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2})|(\d{2}\/\d{2}\/\d{4}(\s+\d{1,2}:\d{2}(\s?[AP]M)?)?)/i;
// Hints are matched against the field PATH only (not combined with description).
// Matching the description too breaks the $ anchor because the description adds
// words after the path, causing fields like 'appt.apptDate' to go undetected.
const DATE_HINT = /(^|[._])(date|dob|fromDate|birthDate|visitDate|apptDate|scheduledDate)$/i;
const TIME_HINT = /(^|[._])(time|fromTime|apptTime|visitTime)$/i;
const DATETIME_HINT =
  /(^|[._])(datetime|timestamp|approvedAt|rejectedAt|scheduledAt|releasedAt|createdAt|updatedAt|arrivedAt|occurredAt|rescheduledAt|completedAt|startedAt|endedAt)$/i;

const normalizeText = (value?: unknown) => String(value || '').trim();

const inferDateKind = (field: SchemaFieldLike): FollowUpFieldKind | null => {
  const rawType = normalizeText(field.type).toLowerCase();
  const path = normalizeText(field.path || field.name);
  const description = normalizeText(field.description);
  const example = normalizeText(field.example);
  const searchable = `${path} ${description}`.trim();

  if (rawType === 'datetime' || rawType === 'timestamp') {
    return 'datetime';
  }
  if (rawType === 'date') {
    return 'date';
  }
  if (rawType === 'time') {
    return 'time';
  }

  if (DATETIME_HINT.test(searchable)) {
    return 'datetime';
  }
  if (DATE_HINT.test(searchable)) {
    return 'date';
  }
  if (TIME_HINT.test(searchable)) {
    return 'time';
  }

  if (DATE_ONLY_EXAMPLE.test(example)) {
    return 'date';
  }
  if (TIME_ONLY_EXAMPLE.test(example)) {
    return 'time';
  }
  if (DATE_TIME_EXAMPLE.test(example)) {
    return example.includes(':') ? 'datetime' : 'date';
  }

  return null;
};

const getPriority = (field: SchemaFieldLike, kind: FollowUpFieldKind): number => {
  const path = normalizeText(field.path || field.name);
  const leaf = path.split('.').pop() || path;
  let priority = 0;

  if (path.includes('.')) {
    priority += 8;
  }

  if (!GENERIC_METADATA_PATHS.has(path)) {
    priority += 5;
  }

  if (/(status|state|approved|rejected|result)$/i.test(leaf)) {
    priority += 4;
  }

  if (/(id|rid|number|reference|ref|code)$/i.test(leaf)) {
    priority += 2;
  }

  if (kind === 'datetime') {
    priority += 10;
  } else if (kind === 'date') {
    priority += 7;
  } else if (kind === 'time') {
    priority += 3;
  }

  if (GENERIC_METADATA_PATHS.has(path)) {
    priority -= 10;
  }

  return priority;
};

export const inferFollowUpFieldSemantic = (field: SchemaFieldLike): FollowUpFieldSemantic => {
  const rawType = normalizeText(field.type).toLowerCase();
  const inferredDateKind = inferDateKind(field);

  if (['number', 'integer', 'float', 'double'].includes(rawType)) {
    return {
      kind: 'number',
      valueType: 'NUMBER',
      displayType: 'number',
      isDateLike: false,
      supportsOffsetTiming: false,
      priority: getPriority(field, 'number'),
    };
  }

  if (rawType === 'boolean') {
    return {
      kind: 'boolean',
      valueType: 'BOOLEAN',
      displayType: 'boolean',
      isDateLike: false,
      supportsOffsetTiming: false,
      priority: getPriority(field, 'boolean'),
    };
  }

  if (inferredDateKind) {
    return {
      kind: inferredDateKind,
      valueType: 'DATE',
      displayType: inferredDateKind,
      isDateLike: true,
      supportsOffsetTiming: inferredDateKind === 'date' || inferredDateKind === 'datetime',
      priority: getPriority(field, inferredDateKind),
    };
  }

  return {
    kind: 'string',
    valueType: 'STRING',
    displayType: rawType || 'string',
    isDateLike: false,
    supportsOffsetTiming: false,
    priority: getPriority(field, 'string'),
  };
};
