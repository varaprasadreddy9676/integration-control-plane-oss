'use strict';

/**
 * Data binding: `{{ path }}` and `{{ path ?? fallback }}` in stage inputs and in
 * the Send step's bindings. No other operators.
 *
 *   scopes   event.*, delivery.*, stages.<stageId>.output.*, vars.*
 *   typed    a value that is exactly one expression keeps its type
 *            ("{{ delivery.attempt }}" -> 2); inside text it becomes text
 *            ("Bearer {{ stages.getToken.output.accessToken }}")
 *   missing  a missing value without a fallback is an error, raised before the
 *            stage runs (a gate fails closed, an observer records the error)
 */

const EXPRESSION = /\{\{\s*([^{}]*?)\s*\}\}/g;
const WHOLE = /^\s*\{\{\s*([^{}]*?)\s*\}\}\s*$/;
const SCOPES = new Set(['event', 'delivery', 'stages', 'vars']);
const SEGMENT = /^[A-Za-z0-9_$-]+$/;

class BindingError extends Error {
  constructor(message, path) {
    super(message);
    this.code = 'BINDING_ERROR';
    this.path = path;
  }
}

/** "a.b[0].c ?? \"x\"" -> { text, segments: ['a','b','0','c'], fallback: { value: 'x' } } */
function parseExpression(source) {
  const text = String(source).trim();
  const split = text.indexOf('??');
  const pathText = (split === -1 ? text : text.slice(0, split)).trim();
  let fallback;
  if (split !== -1) {
    const literal = text.slice(split + 2).trim();
    try {
      fallback = { value: JSON.parse(literal) };
    } catch (_error) {
      throw new BindingError(`The fallback in {{ ${text} }} must be a JSON value, such as "text", 10 or true`, pathText);
    }
    if (fallback.value !== null && typeof fallback.value === 'object') {
      throw new BindingError(`The fallback in {{ ${text} }} must be text, a number, true, false or null`, pathText);
    }
  }
  const segments = pathText.replace(/\[(\d+)\]/g, '.$1').split('.');
  if (!pathText || segments.some((segment) => !SEGMENT.test(segment))) {
    throw new BindingError(`{{ ${text} }} is not a valid path`, pathText);
  }
  if (!SCOPES.has(segments[0])) {
    throw new BindingError(`{{ ${text} }} must start with event, delivery, stages or vars`, pathText);
  }
  return { text, path: pathText, segments, fallback };
}

function lookup(scopes, segments) {
  let value = scopes;
  for (const segment of segments) {
    if (value === null || value === undefined || typeof value !== 'object') return undefined;
    if (!Object.prototype.hasOwnProperty.call(value, segment)) return undefined;
    value = value[segment];
  }
  return value;
}

function evaluate(expression, scopes) {
  const value = lookup(scopes, expression.segments);
  if (value !== undefined && value !== null) return value;
  if (expression.fallback) return expression.fallback.value;
  throw new BindingError(`No value for {{ ${expression.path} }}`, expression.path);
}

const asText = (value) => (value !== null && typeof value === 'object' ? JSON.stringify(value) : String(value));

// "{{" that is not part of a well-formed expression is a mistake, not text.
function assertWellFormed(template) {
  if (template.replace(EXPRESSION, '').includes('{{')) {
    throw new BindingError(`"${template}" has a {{ }} expression that is not valid`, null);
  }
}

/** Resolve one template string against the scopes. Non-strings are returned unchanged. */
function resolveTemplate(template, scopes) {
  if (typeof template !== 'string') return template;
  assertWellFormed(template);
  const whole = WHOLE.exec(template);
  if (whole) return evaluate(parseExpression(whole[1]), scopes);
  return template.replace(EXPRESSION, (_match, inner) => asText(evaluate(parseExpression(inner), scopes)));
}

/** Resolve every value of a { name: template } map; a new object. */
function resolveMap(map, scopes) {
  const out = {};
  for (const [name, template] of Object.entries(map || {})) out[name] = resolveTemplate(template, scopes);
  return out;
}

/** Every expression in a template (for validation), parsed; throws on a malformed one. */
function expressionsIn(template) {
  if (typeof template !== 'string') return [];
  assertWellFormed(template);
  const found = [];
  template.replace(EXPRESSION, (_match, inner) => {
    found.push(parseExpression(inner));
    return '';
  });
  return found;
}

module.exports = { resolveTemplate, resolveMap, expressionsIn, parseExpression, BindingError };
