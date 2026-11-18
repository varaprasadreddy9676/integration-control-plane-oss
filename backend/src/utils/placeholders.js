'use strict';

/**
 * {{name}} placeholders in templates: replaced literally, so a value may contain
 * "$&" or a name may contain "." without changing what is replaced.
 */

/** `text` with every {{key}} of `placeholders` replaced by its value (a missing value becomes ""). */
function replacePlaceholders(text, placeholders) {
  if (typeof text !== 'string') return text;
  return Object.keys(placeholders || {}).reduce((result, key) => result.split(`{{${key}}}`).join(placeholders[key] || ''), text);
}

/** The same through an object or array, at every depth (strings inside arrays too); other values are kept. */
function replacePlaceholdersInObject(value, placeholders) {
  if (typeof value === 'string') return replacePlaceholders(value, placeholders);
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => replacePlaceholdersInObject(item, placeholders));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replacePlaceholdersInObject(item, placeholders)]));
}

module.exports = { replacePlaceholders, replacePlaceholdersInObject };
