import { apiRequest } from './api';

/** Pipeline stages: the backend's /stages API (backend/src/routes/stages.js). */

export type StageHook = 'before_send' | 'after_response' | 'after_delivery' | 'on_failure';
export type StageEffect = 'gate' | 'observe';
export type StageOutcome = 'ok' | 'error' | 'skipped' | 'timeout';

export interface StageOutput {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object';
  sensitive?: boolean;
}

export interface StageConfig {
  id: string;
  name: string;
  hook: StageHook;
  effect?: StageEffect;
  enabled?: boolean;
  runner: { type: string; config: Record<string, any> };
  schedule?: { checkAfterSeconds?: number[]; everySeconds?: number; maxAgeSeconds?: number; maxChecks?: number };
  contract?: number | string;
  auth?: { credentialRef?: string; source?: 'integration'; headers?: Record<string, string>; allowedOrigins: string[] };
  onError?: { action: 'ignore' | 'fail_stage' | 'retry_stage'; maxAttempts?: number; backoffSeconds?: number[]; allowUncertainSideEffects?: boolean };
  timeoutMs?: number;
  recording?: { level: 'full' | 'errors-only' | 'summary'; sensitivePaths?: string[]; sensitiveKeys?: string[] };
  outputs?: StageOutput[];
  inputs?: Record<string, string>;
  allowDeliveryRetry?: boolean;
  /** A check after delivery that asks the provider whether it has the message: the statuses that mean it does not. */
  verification?: { resendWhen: string[] };
  template?: { id: string; version: number };
  migratedFrom?: string;
  shadow?: boolean;
}

export interface SendBindings {
  /** fields: the outgoing message's fields (any delivery); headers and query: HTTP only. */
  bindings?: { headers?: Record<string, string>; query?: Record<string, string>; fields?: Record<string, string> };
}

export interface SchemaField {
  name: string;
  label: string;
  widget: 'text' | 'select' | 'checkbox' | 'code' | 'key-value' | 'rows' | 'tags' | 'duration-list';
  options?: string[];
  default?: unknown;
  required?: boolean;
  hint?: string;
  placeholder?: string;
  language?: string;
  valueType?: 'number';
  readOnly?: boolean;
  columns?: SchemaField[];
}

/** How a runner is shown, from the server: the console needs no knowledge of any particular runner. */
export interface RunnerPresentation {
  /** One of the canvas icons. */
  icon?: string;
  /** The step's one-line summary, built from its configuration. */
  summary?: Array<{ field: string; as?: 'text' | 'host' | 'lines' | 'count'; unit?: string }>;
  /** Can it skip or fail the delivery (assumed for a gate whose outcomes are not read yet). */
  mayDecide?: boolean;
  /** What the step hands on: listed by the user on the stage, or named in a list in its configuration. */
  outputs?: { declaredOnStage?: boolean; fromConfig?: string };
  defaultConfig?: Record<string, unknown>;
  defaultConfigByHook?: Partial<Record<StageHook, Record<string, unknown>>>;
}

export interface StageRunner {
  type: string;
  label: string;
  /** One line on why you would add it. */
  description?: string;
  hooks: StageHook[];
  configSchema: { fields: SchemaField[] };
  presentation?: RunnerPresentation;
}

export interface StageTemplate {
  id: string;
  label: string;
  description: string;
  provider: string;
  hook: StageHook;
  recommended: boolean;
}

export interface StageCall {
  id: number;
  at?: string;
  method: string;
  url: string;
  statusCode?: number | null;
  durationMs?: number | null;
  error?: { code: string; message: string } | null;
  requestHeaders?: Record<string, string>;
  requestBody?: unknown;
  requestBodyCut?: 'recording';
  responseHeaders?: Record<string, string>;
  responseBody?: unknown;
  responseBodyCut?: 'network' | 'recording';
  bodiesOmitted?: 'errors-only' | 'summary';
  redirects?: Array<{ status: number; url: string }>;
  finalUrl?: string;
}

export interface StageRun {
  runId: string;
  deliveryId: string | null;
  stage: { id: string; name: string; hook: StageHook; runner: string; definitionHash?: string | null };
  seq: number;
  executionAttempt: number;
  replayOfRunId?: string | null;
  at: string;
  durationMs: number;
  outcome: StageOutcome;
  status: string | null;
  done: boolean;
  errorCode?: string | null;
  reason?: string | null;
  error?: string;
  result?: unknown;
  calls: StageCall[];
  callsOmitted?: number;
  logs: Array<{ level: string; message: string; at: string }>;
  logsOmitted?: number;
  shadow?: boolean;
  fromFollowUp?: boolean;
}

export interface StageState {
  stageId: string;
  stageName: string;
  hook: StageHook;
  status: string | null;
  done: boolean;
  outcome: StageOutcome;
  seq: number;
  runs: number;
  error?: string | null;
}

export interface StageValidationError {
  path: string;
  message: string;
}

export interface StageRuntimeStatus {
  ready: boolean;
  mode: string | null;
  isolated: boolean;
  problems: string[];
  switchedOff: boolean;
}

const json = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body) });

export const getStageRunners = async (): Promise<StageRunner[]> =>
  (await apiRequest<{ runners: StageRunner[] }>('/stages/runners')).runners;

export const getStageTemplates = async (integrationId?: string): Promise<StageTemplate[]> =>
  (await apiRequest<{ templates: StageTemplate[] }>(`/stages/templates${integrationId ? `?integrationId=${integrationId}` : ''}`)).templates;

export const stageFromTemplate = async (templateId: string, body: { id?: string; name?: string } = {}): Promise<StageConfig> =>
  (await apiRequest<{ stage: StageConfig }>(`/stages/templates/${templateId}/stage`, json(body))).stage;

export const validateStages = async (body: {
  integrationId?: string;
  integration?: Record<string, unknown>;
  /** Which delivery's stages: an action's index, or absent for the integration itself. */
  actionIndex?: number | null;
  stages: StageConfig[];
  send?: SendBindings | null;
}): Promise<{ ok: boolean; errors: StageValidationError[]; stages: StageConfig[] }> => apiRequest('/stages/validate', json(body));

export interface StageTestRequest {
  integrationId?: string;
  stage: StageConfig;
  sample?: { event?: unknown; delivery?: unknown };
  deliveryId?: string;
  live?: boolean;
  stubResponses?: Array<{ status: number; body: unknown }>;
}

export const testStage = async (body: StageTestRequest): Promise<{ live: boolean; record: StageRun }> =>
  apiRequest('/stages/test', json(body));

export const getDeliveryStages = async (deliveryId: string): Promise<{ states: StageState[]; runs: StageRun[] }> =>
  apiRequest(`/stages/deliveries/${deliveryId}`);

export const replayStageRun = async (runId: string, body: { reason: string; useCurrentRevision?: boolean }): Promise<{ run: StageRun }> =>
  apiRequest(`/stages/runs/${runId}/replay`, json(body));

export const getStageJobCounts = async (integrationId: string, stageId: string): Promise<Record<string, number>> =>
  (await apiRequest<{ byState: Record<string, number> }>(`/stages/integrations/${integrationId}/stages/${stageId}/jobs`)).byState;

export const repinStageJobs = async (integrationId: string, stageId: string, reason: string): Promise<{ moved: number }> =>
  apiRequest(`/stages/integrations/${integrationId}/stages/${stageId}/repin`, json({ reason }));

export const getStageRuntime = async (): Promise<StageRuntimeStatus> => apiRequest('/stages/runtime');

export interface CredentialOption {
  placeholderId: string;
  name: string;
  provider: string;
  environment: string;
  status: string;
  fields: Array<{ key: string; label?: string }>;
}

/** The org's credentials, for a stage's credential (needs credentials:view). */
export const listCredentialOptions = async (): Promise<CredentialOption[]> => {
  // The credentials API names a credential by `id`; a step stores that as its credentialRef.
  const { data } = await apiRequest<{ data: Array<Omit<CredentialOption, 'placeholderId'> & { id?: string; placeholderId?: string }> }>('/credentials?limit=200');
  return data.map((credential) => ({ ...credential, placeholderId: credential.placeholderId || credential.id || '' }));
};

// ── What the workflow canvas reads (backend stages/save-impact.js, outcomes.js, verified-replay.js)

export interface SaveImpactStage {
  stageId: string;
  name: string;
  hook: StageHook;
  change: 'added' | 'removed' | 'edited' | 'disabled' | 'enabled' | 'unchanged';
  keepOldVersion: number;
  paused: number;
  resumed: number;
  cancelled: number;
}

export interface SaveImpact {
  stages: SaveImpactStage[];
  totals: { keepOldVersion: number; paused: number; resumed: number; cancelled: number };
}

export const getSaveImpact = async (integrationId: string, integration: Record<string, unknown>): Promise<SaveImpact> =>
  apiRequest('/stages/save-impact', json({ integrationId, integration }));

export interface StageOutcomes {
  /** False when the runner cannot describe what it ends with. */
  known: boolean;
  statuses: Array<{ status: string; done: boolean | null }>;
  skips: Array<{ reason: string | null }>;
  fails: Array<{ reason: string | null; retryDelivery: boolean; retryStage: boolean }>;
  dynamicStatus: boolean;
}

export const getStageOutcomes = async (stage: StageConfig): Promise<StageOutcomes> =>
  (await apiRequest<{ outcomes: StageOutcomes }>('/stages/outcomes', json({ stage }))).outcomes;

export interface CheckAndReplayResult {
  verdict: 'safe_to_resend' | 'provider_has_it' | 'unverifiable';
  status: string | null;
  stage: { id: string; name: string } | null;
  runId: string | null;
  reason: string | null;
  replayed?: boolean;
}

export const checkAndReplay = async (deliveryId: string, body: { reason: string; acceptUnverified?: boolean }): Promise<CheckAndReplayResult> =>
  apiRequest(`/stages/deliveries/${deliveryId}/check-and-replay`, json(body));

export interface SimilarFailures {
  matchedOn: 'errorCode' | 'errorCategory' | null;
  windowMinutes: number;
  count: number;
  capped: boolean;
  sample: string[];
}

export const getSimilarFailures = async (logId: string, minutes = 60): Promise<SimilarFailures> =>
  apiRequest(`/logs/${logId}/similar-failures?minutes=${minutes}`);

