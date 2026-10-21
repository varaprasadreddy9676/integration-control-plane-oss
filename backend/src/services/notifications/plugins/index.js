'use strict';

/**
 * Alert channel plugins. A plugin is one module exporting:
 *
 *   type         unique id, e.g. 'slack'
 *   name         shown in the console
 *   description  one sentence for the console
 *   fields       the settings it needs: { key, label, type, required, placeholder?,
 *                help?, pattern?, patternMessage?, itemPattern?, itemPatternMessage? }
 *                type: 'text' | 'url' | 'secret' (stored encrypted, never returned)
 *                      | 'list' (comma-separated in the console, an array here)
 *   send(alert, settings)  deliver one alert; throw to report failure
 *
 * To add a channel, write the module and add it to PLUGINS below. Settings are
 * validated, encrypted and edited in the console from `fields`; no other code
 * changes are needed. See ../README.md for the alert object.
 */

const PLUGINS = [require('./slack'), require('./email'), require('./webhook'), require('./whatsapp')];
const byType = new Map(PLUGINS.map((plugin) => [plugin.type, plugin]));

const getPlugin = (type) => byType.get(type) || null;

/** The plugins as the API returns them: everything except code. */
function listPlugins() {
  return PLUGINS.map(({ send, ...plugin }) => plugin);
}

const secretFields = (type) => (getPlugin(type)?.fields || []).filter((f) => f.type === 'secret').map((f) => f.key);

/**
 * Check settings against the plugin's declared fields.
 * Returns { config } (normalized: trimmed, lists split) or { error }.
 */
function validateConfig(type, raw = {}) {
  const plugin = getPlugin(type);
  if (!plugin) return { error: `Unknown channel type: ${type}` };
  const config = {};
  for (const field of plugin.fields) {
    let value = raw[field.key];
    if (field.type === 'list') {
      const items = (Array.isArray(value) ? value : String(value ?? '').split(','))
        .map((item) => String(item).trim())
        .filter(Boolean);
      if (items.length === 0) {
        if (field.required) return { error: `${field.label} is required` };
        continue;
      }
      if (field.itemPattern) {
        const bad = items.find((item) => !new RegExp(field.itemPattern).test(item));
        if (bad) return { error: `${bad} ${field.itemPatternMessage || 'is not valid'}` };
      }
      config[field.key] = items;
      continue;
    }
    value = typeof value === 'string' ? value.trim() : value;
    if (value === undefined || value === null || value === '') {
      if (field.required) return { error: `${field.label} is required` };
      continue;
    }
    if (typeof value !== 'string') return { error: `${field.label} must be text` };
    if (field.type === 'url' && !/^https?:\/\//.test(value)) return { error: `${field.label} must be an http(s) URL` };
    if (field.pattern && !new RegExp(field.pattern).test(value)) {
      return { error: field.patternMessage || `${field.label} is not valid` };
    }
    config[field.key] = value;
  }
  return { config };
}

module.exports = { listPlugins, getPlugin, validateConfig, secretFields };
