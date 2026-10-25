'use strict';

/**
 * The `http` runner: one HTTP call with no code. Method, URL, headers, query and
 * body are templates ({{ }}, see binding.js); `extract` reads values out of the
 * response into typed outputs; `status` maps a value to the stage's status word,
 * and `doneWhen` lists the words that end a scheduled check.
 *
 *   {
 *     method: 'GET', url: 'https://api.example.com/messages/{{ delivery.response.body.id }}',
 *     headers: { Accept: 'application/json' }, query: { verbose: '1' }, body: undefined,
 *     expectStatus: [200],                     // default: any 2xx
 *     extract: [{ name: 'state', from: 'response.body.message.status', type: 'string' }],
 *     status: { from: 'state', map: { delivered: 'DELIVERED', read: 'READ' }, otherwise: 'PENDING' },
 *     doneWhen: ['DELIVERED', 'READ', 'FAILED']
 *   }
 */

const { resolveTemplate, resolveMap, expressionsIn, BindingError } = require('../binding');
const { parsePath } = require('../mask');

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const OUTPUT_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const STATUS_WORD = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
const TYPES = ['string', 'number', 'boolean', 'object'];

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function templatesIn(value, path, add) {
  if (typeof value === 'string') {
    try {
      expressionsIn(value);
    } catch (error) {
      if (error instanceof BindingError) add(path, error.message);
      else throw error;
    }
  } else if (Array.isArray(value)) value.forEach((item, i) => templatesIn(item, `${path}[${i}]`, add));
  else if (isPlainObject(value)) Object.entries(value).forEach(([k, v]) => templatesIn(v, `${path}.${k}`, add));
}

function validate(config) {
  const problems = [];
  const add = (path, message) => problems.push({ path, message });
  const method = String(config.method || 'GET').toUpperCase();
  if (!METHODS.includes(method)) add('method', `method is one of ${METHODS.join(', ')}`);
  if (typeof config.url !== 'string' || !config.url.trim()) add('url', 'A URL is required');
  templatesIn(config.url, 'url', add);
  for (const part of ['headers', 'query']) {
    if (config[part] !== undefined && !isPlainObject(config[part])) add(part, `${part} is an object`);
    templatesIn(config[part], part, add);
  }
  templatesIn(config.body, 'body', add);
  if (config.expectStatus !== undefined) {
    const list = config.expectStatus;
    if (
      !Array.isArray(list) ||
      list.length === 0 ||
      list.some((code) => !Number.isInteger(code) || code < 100 || code > 599)
    ) {
      add('expectStatus', 'expectStatus lists HTTP status codes');
    }
  }
  const names = new Set();
  (config.extract || []).forEach((rule, i) => {
    if (!isPlainObject(rule) || !OUTPUT_NAME.test(String(rule.name || '')))
      return add(`extract[${i}].name`, 'Each extracted value needs a name');
    if (names.has(rule.name)) add(`extract[${i}].name`, `${rule.name} is extracted twice`);
    names.add(rule.name);
    if (typeof rule.from !== 'string' || !/^response\.(status|headers|body)(\.|\[|$)/.test(rule.from)) {
      add(`extract[${i}].from`, 'from is a path starting response.status, response.headers or response.body');
    }
    if (rule.type !== undefined && !TYPES.includes(rule.type))
      add(`extract[${i}].type`, `type is one of ${TYPES.join(', ')}`);
    return undefined;
  });
  if (config.extract !== undefined && !Array.isArray(config.extract)) add('extract', 'extract is a list');
  if (config.status !== undefined) {
    const status = config.status;
    if (!isPlainObject(status) || !names.has(status.from)) add('status.from', 'status.from names an extracted value');
    const words = [
      ...Object.values((status && status.map) || {}),
      ...(status && status.otherwise ? [status.otherwise] : []),
    ];
    if (words.some((word) => !STATUS_WORD.test(String(word))))
      add('status.map', 'Status words are letters, digits and _ (up to 32)');
  }
  if (
    config.doneWhen !== undefined &&
    (!Array.isArray(config.doneWhen) || config.doneWhen.some((w) => !STATUS_WORD.test(String(w))))
  ) {
    add('doneWhen', 'doneWhen lists status words');
  }
  return problems;
}

function outputs(config) {
  return (config.extract || []).map((rule) => ({
    name: rule.name,
    type: rule.type || 'string',
    sensitive: Boolean(rule.sensitive),
  }));
}

function pick(source, path) {
  let value = source;
  for (const segment of parsePath(path)) {
    if (value === null || value === undefined || typeof value !== 'object') return undefined;
    value = value[segment];
  }
  return value;
}

function resolveBody(body, scopes) {
  if (typeof body === 'string') return resolveTemplate(body, scopes);
  if (Array.isArray(body)) return body.map((item) => resolveBody(item, scopes));
  if (isPlainObject(body)) {
    const out = {};
    for (const [key, value] of Object.entries(body)) out[key] = resolveBody(value, scopes);
    return out;
  }
  return body;
}

async function run(ctx) {
  const config = ctx.stage.runner.config;
  const scopes = { ...ctx.scope, inputs: ctx.inputs };
  let response;
  try {
    const request = {
      method: String(config.method || 'GET').toUpperCase(),
      url: resolveTemplate(config.url, scopes),
      body: config.body === undefined ? undefined : resolveBody(config.body, scopes),
      options: { headers: resolveMap(config.headers, scopes), params: resolveMap(config.query, scopes) },
    };
    response = await ctx.http(request, { signal: ctx.signal });
  } catch (error) {
    if (error instanceof BindingError)
      return { outcome: 'error', errorCode: 'BINDING_ERROR', error: error.message, logs: [] };
    return { outcome: 'error', errorCode: error.code || 'NETWORK', error: error.message, logs: [] };
  }

  const expected = config.expectStatus;
  const accepted = expected ? expected.includes(response.status) : response.status >= 200 && response.status < 300;
  if (!accepted)
    return { outcome: 'error', errorCode: 'UNEXPECTED_STATUS', error: `HTTP ${response.status}`, logs: [] };

  const source = { response: { status: response.status, headers: response.headers, body: response.data } };
  const data = {};
  for (const rule of config.extract || []) {
    const value = pick(source, rule.from);
    data[rule.name] = value === undefined ? null : value;
  }
  let status;
  if (config.status) {
    const raw = data[config.status.from];
    const mapped = config.status.map && raw !== null && raw !== undefined ? config.status.map[String(raw)] : undefined;
    status = mapped || config.status.otherwise || (raw === null || raw === undefined ? undefined : String(raw));
  }
  const done = Array.isArray(config.doneWhen) && status ? config.doneWhen.includes(status) : undefined;
  return { outcome: 'ok', value: { status, done, data }, logs: [] };
}

/** The status words a configured request can produce: its map's words and `otherwise`; anything else passes through as the raw value. */
function outcomes(config) {
  if (!config.status) return { statuses: [], dynamicStatus: false };
  const done = new Set(Array.isArray(config.doneWhen) ? config.doneWhen : []);
  const words = [...new Set([...Object.values(config.status.map || {}), ...(config.status.otherwise ? [config.status.otherwise] : [])])];
  return { statuses: words.map((status) => ({ status, done: done.has(status) })), dynamicStatus: !config.status.otherwise };
}

module.exports = {
  type: 'http',
  label: 'HTTP request',
  hooks: ['before_send', 'after_response', 'after_delivery', 'on_failure'],
  configSchema: {
    fields: [
      { name: 'method', label: 'Method', widget: 'select', options: METHODS, default: 'GET' },
      { name: 'url', label: 'URL', widget: 'text', required: true },
      { name: 'headers', label: 'Headers', widget: 'key-value' },
      { name: 'query', label: 'Query parameters', widget: 'key-value' },
      { name: 'body', label: 'Body', widget: 'code', language: 'json' },
      {
        name: 'expectStatus',
        label: 'Accepted status codes',
        widget: 'tags',
        valueType: 'number',
        hint: 'Default: any 2xx',
      },
      {
        name: 'extract',
        label: 'Extract values',
        widget: 'rows',
        columns: [
          { name: 'name', label: 'Name', widget: 'text' },
          { name: 'from', label: 'From', widget: 'text', placeholder: 'response.body.status' },
          { name: 'type', label: 'Type', widget: 'select', options: TYPES, default: 'string' },
          { name: 'sensitive', label: 'Sensitive', widget: 'checkbox' },
        ],
      },
      { name: 'status.from', label: 'Status comes from', widget: 'text', hint: 'The name of an extracted value' },
      { name: 'status.map', label: 'Status words', widget: 'key-value', hint: 'value -> STATUS' },
      { name: 'status.otherwise', label: 'Otherwise', widget: 'text' },
      { name: 'doneWhen', label: 'Done when status is', widget: 'tags' },
    ],
  },
  validate,
  outputs,
  outcomes,
  run,
};
