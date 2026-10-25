import type { StageRunner } from '../../services/stages-api';

/** The runners as the server describes them (backend stages/runners/*), for tests of the console. */
export const RUNNERS: StageRunner[] = [
  {
    type: 'script',
    label: 'Script',
    hooks: ['before_send', 'after_response', 'after_delivery', 'on_failure'],
    configSchema: { fields: [{ name: 'code', label: 'Script', widget: 'code', language: 'javascript', required: true }] },
    presentation: {
      icon: 'script',
      summary: [{ field: 'code', as: 'lines', unit: 'line of script' }],
      mayDecide: true,
      outputs: { declaredOnStage: true },
      defaultConfigByHook: {
        before_send: { code: "return { status: 'OK' };" },
        after_response: { code: "return { status: 'OK' };" },
        after_delivery: { code: "return { status: 'PENDING' };" },
        on_failure: { code: "return { status: 'NOTED' };" },
      },
    },
  },
  {
    type: 'http',
    label: 'HTTP request',
    hooks: ['before_send', 'after_response', 'after_delivery', 'on_failure'],
    configSchema: {
      fields: [
        { name: 'method', label: 'Method', widget: 'select', options: ['GET', 'POST'], default: 'GET' },
        { name: 'url', label: 'URL', widget: 'text', required: true },
        { name: 'headers', label: 'Headers', widget: 'key-value' },
        { name: 'expectStatus', label: 'Accepted status codes', widget: 'tags', valueType: 'number' },
        { name: 'status.from', label: 'Status comes from', widget: 'text' },
      ],
    },
    presentation: {
      icon: 'http',
      summary: [{ field: 'method' }, { field: 'url', as: 'host' }],
      mayDecide: false,
      outputs: { fromConfig: 'extract' },
      defaultConfig: { method: 'GET', url: '' },
    },
  },
  {
    type: 'url-check',
    label: 'Check linked URLs',
    hooks: ['before_send'],
    configSchema: { fields: [] },
    presentation: { icon: 'http', summary: [{ field: 'checks', as: 'count', unit: 'linked URL' }], mayDecide: true, outputs: {} },
  },
];

export const RUNNER_MAP = Object.fromEntries(RUNNERS.map((runner) => [runner.type, runner]));
