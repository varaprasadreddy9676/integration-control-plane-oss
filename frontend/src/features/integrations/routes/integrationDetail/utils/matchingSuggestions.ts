import type { EventType, FieldSchema } from '../../../../../services/api';
import { flattenFields } from './fieldMapping';

export interface MatchingSuggestion {
  key: string;
  paths: string;
  score: number;
  reason: string;
}

export interface MatchingSuggestionsResult {
  suggestedResourceType: string | null;
  suggestedPaths: Array<{ key: string; paths: string }>;
  confidence: 'high' | 'medium' | 'low';
  reasoning: string[];
}

export interface MatchingSuggestionFormSeed {
  resourceType?: string;
  subjectExtractionMode: 'PATHS';
  subjectExtractionPaths: Array<{ key: string; paths: string }>;
}

const GENERIC_OBJECT_NAMES = new Set(['payload', 'data', 'event', 'body', 'details']);
const ID_NAME_PATTERN = /(^|_)(id|rid|uuid|reference|ref|number|code)$/i;
const IGNORE_PATH_PATTERN = /(date|time|timestamp|status|name|description|message)$/i;

const toResourceType = (eventType?: string): string | null => {
  if (!eventType) return null;
  const tokens = eventType
    .split('_')
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) return null;

  const stopWords = new Set([
    'CREATED',
    'UPDATED',
    'CONFIRMED',
    'CONFIRMATION',
    'CANCELLED',
    'CANCELLATION',
    'RESCHEDULED',
    'APPROVED',
    'REJECTED',
    'COMPLETED',
    'SENT',
    'DELIVERED',
    'FAILED',
    'RELEASED',
    'DISCARDED',
  ]);

  const filtered = tokens.filter((token) => !stopWords.has(token));
  if (filtered.length === 0) return null;
  return filtered[0];
};

const pathExistsInSample = (samplePayload: any, path: string): boolean => {
  if (!samplePayload || !path) return false;
  const value = path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), samplePayload);
  return value !== undefined && value !== null && value !== '';
};

const scoreField = (field: FieldSchema, samplePayload: any): { score: number; reason: string[] } => {
  const path = field.path || field.name || '';
  const name = field.name || path.split('.').pop() || '';
  const type = String(field.type || '').toLowerCase();
  const reason: string[] = [];
  let score = 0;

  if (!path || !name) {
    return { score: 0, reason };
  }

  if (type === 'boolean' || type === 'array' || type === 'object') {
    return { score: 0, reason };
  }

  if (IGNORE_PATH_PATTERN.test(path)) {
    return { score: 0, reason };
  }

  if (name.toLowerCase() === 'id') {
    score += 10;
    reason.push('exact id field');
  } else if (ID_NAME_PATTERN.test(name) || ID_NAME_PATTERN.test(path)) {
    score += 7;
    reason.push('looks like a stable identifier');
  }

  if (field.required) {
    score += 3;
    reason.push('required in schema');
  }

  if (pathExistsInSample(samplePayload, path)) {
    score += 4;
    reason.push('present in sample payload');
  }

  return { score, reason };
};

const toSuggestionKey = (path: string): string => {
  const parts = path.split('.');
  const leaf = parts[parts.length - 1] || path;
  return leaf
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
};

export const buildMatchingSuggestions = (eventTypeData?: EventType | null): MatchingSuggestionsResult | null => {
  if (!eventTypeData?.fields?.length) {
    return null;
  }

  const flattenedFields = flattenFields(eventTypeData.fields as any[]) as FieldSchema[];

  const suggestions: MatchingSuggestion[] = flattenedFields
    .map((field) => {
      const path = field.path || field.name || '';
      const { score, reason } = scoreField(field, eventTypeData.samplePayload);
      return {
        key: toSuggestionKey(path),
        paths: path,
        score,
        reason: reason.join(', '),
      };
    })
    .filter((field) => field.score > 0 && field.paths)
    .sort((a, b) => b.score - a.score);

  const deduped = new Map<string, MatchingSuggestion>();
  suggestions.forEach((suggestion) => {
    const existing = deduped.get(suggestion.key);
    if (!existing || suggestion.score > existing.score) {
      deduped.set(suggestion.key, suggestion);
    }
  });

  const topSuggestions = [...deduped.values()].slice(0, 3);
  if (topSuggestions.length === 0) {
    const fallbackField = flattenedFields.find((field) => {
      const path = field.path || field.name || '';
      const type = String(field.type || '').toLowerCase();

      if (!path || /(^|\.)(status|name|description|message)$/i.test(path)) {
        return false;
      }

      return !['boolean', 'array', 'object'].includes(type);
    });

    if (!fallbackField) {
      return null;
    }

    const fallbackPath = fallbackField.path || fallbackField.name || '';
    return {
      suggestedResourceType: toResourceType(eventTypeData.eventType),
      suggestedPaths: [{ key: toSuggestionKey(fallbackPath), paths: fallbackPath }],
      confidence: 'low',
      reasoning: [`${fallbackPath}: fallback field from schema`],
    };
  }

  const leadingObjects = topSuggestions
    .map((item) => item.paths.split('.')[0])
    .filter((value) => value && !GENERIC_OBJECT_NAMES.has(value.toLowerCase()));
  const dominantObject = leadingObjects.length > 0 && leadingObjects.every((value) => value === leadingObjects[0]) ? leadingObjects[0] : null;
  const suggestedResourceType = dominantObject ? dominantObject.toUpperCase() : toResourceType(eventTypeData.eventType);

  const confidence = topSuggestions[0].score >= 12 ? 'high' : topSuggestions[0].score >= 8 ? 'medium' : 'low';

  return {
    suggestedResourceType,
    suggestedPaths: topSuggestions.map(({ key, paths }) => ({ key, paths })),
    confidence,
    reasoning: topSuggestions.map((item) => `${item.paths}: ${item.reason}`),
  };
};

export const buildMatchingSuggestionFormSeed = (
  suggestions?: MatchingSuggestionsResult | null
): MatchingSuggestionFormSeed | null => {
  if (!suggestions || suggestions.suggestedPaths.length === 0) {
    return null;
  }

  return {
    ...(suggestions.suggestedResourceType ? { resourceType: suggestions.suggestedResourceType } : {}),
    subjectExtractionMode: 'PATHS',
    subjectExtractionPaths: suggestions.suggestedPaths,
  };
};
