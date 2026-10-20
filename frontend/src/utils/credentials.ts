/**
 * Integration credentials come back from the API masked (see the backend's
 * utils/integration-secrets). Super admins can reveal the stored values into an
 * open edit form; only fields still showing the mask are filled, so anything
 * the user has already edited stays as it is.
 */
export const SECRET_MASK = '********';

type Json = unknown;

const isPlainObject = (value: Json): value is Record<string, Json> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const parseJsonObject = (value: Json): Record<string, Json> | null => {
  if (isPlainObject(value)) return value;
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const isHeaderRows = (value: Json): value is Array<{ key?: string; value?: Json }> =>
  Array.isArray(value) && value.every((row) => isPlainObject(row) && 'key' in row);

export function fillMaskedValues<T>(current: T, revealed: Json): T {
  if (current === SECRET_MASK) return (revealed === undefined || revealed === null ? current : revealed) as T;

  // A form field holding JSON text (inbound custom headers).
  if (typeof current === 'string' && current.includes(SECRET_MASK)) {
    const parsedCurrent = parseJsonObject(current);
    const parsedRevealed = parseJsonObject(revealed);
    if (!parsedCurrent || !parsedRevealed) return current;
    return JSON.stringify(fillMaskedValues(parsedCurrent, parsedRevealed), null, 2) as T;
  }

  // Key/value header rows in the form, a header object in the document.
  if (isHeaderRows(current) && isPlainObject(revealed)) {
    return current.map((row) =>
      row.value === SECRET_MASK && row.key && revealed[row.key] !== undefined ? { ...row, value: revealed[row.key] } : row
    ) as T;
  }

  if (Array.isArray(current)) {
    const revealedList = Array.isArray(revealed) ? revealed : [];
    return current.map((item, index) => fillMaskedValues(item, revealedList[index])) as T;
  }

  if (isPlainObject(current)) {
    const revealedObject = isPlainObject(revealed) ? revealed : {};
    const out: Record<string, Json> = {};
    for (const [key, value] of Object.entries(current)) out[key] = fillMaskedValues(value, revealedObject[key]);
    return out as T;
  }

  return current;
}

/** True when any field of the form still shows the mask. */
export function hasMaskedValues(value: Json): boolean {
  if (value === SECRET_MASK) return true;
  if (typeof value === 'string') return value.includes(SECRET_MASK);
  if (Array.isArray(value)) return value.some(hasMaskedValues);
  if (isPlainObject(value)) return Object.values(value).some(hasMaskedValues);
  return false;
}
