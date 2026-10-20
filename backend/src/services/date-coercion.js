'use strict';

function parseSlashDate(value) {
  const match = String(value).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?:\s*([AP]M))?)?$/i);
  if (!match) {
    return null;
  }

  const [, day, month, year, hourRaw, minuteRaw, meridiemRaw] = match;
  let hour = hourRaw ? Number(hourRaw) : 0;
  const minute = minuteRaw ? Number(minuteRaw) : 0;

  if (meridiemRaw) {
    const meridiem = meridiemRaw.toUpperCase();
    if (meridiem === 'PM' && hour < 12) {
      hour += 12;
    }
    if (meridiem === 'AM' && hour === 12) {
      hour = 0;
    }
  }

  const parsed = new Date(Number(year), Number(month) - 1, Number(day), hour, minute, 0, 0);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function parseNumericDate(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  return new Date(Math.abs(numeric) < 1e12 ? numeric * 1000 : numeric);
}

function coerceDateValue(rawValue) {
  if (rawValue instanceof Date) {
    return Number.isFinite(rawValue.getTime()) ? rawValue : null;
  }

  if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
    return parseNumericDate(rawValue);
  }

  if (typeof rawValue === 'string') {
    const trimmed = rawValue.trim();
    if (!trimmed) {
      return null;
    }

    if (/^\d+$/.test(trimmed)) {
      const numericDate = parseNumericDate(trimmed);
      return numericDate && Number.isFinite(numericDate.getTime()) ? numericDate : null;
    }

    const slashDate = parseSlashDate(trimmed);
    if (slashDate) {
      return slashDate;
    }

    const parsed = new Date(trimmed);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }

  return null;
}

function coerceDateTimestamp(rawValue) {
  const parsed = coerceDateValue(rawValue);
  return parsed ? parsed.getTime() : null;
}

module.exports = {
  coerceDateValue,
  coerceDateTimestamp,
};
