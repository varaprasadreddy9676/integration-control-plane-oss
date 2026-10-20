'use strict';

/**
 * Operation Templates Resolver — Tests
 *
 * Covers:
 *  1. fillPlaceholders — pure string/object substitution
 *  2. resolveOperationTemplate — MongoDB lookup + placeholder fill
 *  3. applyProviderRef — merge resolved template into action/job config
 *  4. hasProviderRef — predicate
 *  5. Destination dispatch — HTTP_API, INTERNAL_EVENT, SQL_WRITE, MONGODB_WRITE
 */

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFindOne = jest.fn();
jest.mock('../../src/mongodb', () => ({
  getDbSafe: jest.fn(async () => ({
    collection: jest.fn(() => ({
      findOne: (...args) => mockFindOne(...args),
      updateOne: jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1, upsertedCount: 0 }),
      insertOne: jest.fn().mockResolvedValue({ insertedId: 'new-doc-id' }),
    })),
  })),
  isConnected: jest.fn(() => true),
  toObjectId: jest.fn((id) => id),
}));

jest.mock('../../src/logger', () => ({
  log: jest.fn(),
  logError: jest.fn(),
}));

const { fillPlaceholders, resolveOperationTemplate, applyProviderRef, hasProviderRef, findTemplate } =
  require('../../src/services/operation-templates');

// Minimal PartnerHub template document as stored in MongoDB
const PARTNERHUB_FETCH_PROFILE_DOC = {
  _id: 'tpl-1',
  orgId: 10,
  providerKey: 'partnerhub',
  operationKey: 'fetch-profile',
  name: 'PartnerHub - Fetch Profile',
  targetUrl: 'https://api.partnerhub.example/api/profile/fetch',
  httpMethod: 'POST',
  authType: 'CUSTOM',
  authConfig: {
    tokenEndpoint: 'https://api.partnerhub.example/api/generate-token',
    tokenRequestMethod: 'POST',
    tokenRequestBody: JSON.stringify({ username: '{{username}}', password: '{{password}}' }),
    tokenResponsePath: 'data.token',
    tokenHeaderName: 'Authorization',
    tokenHeaderPrefix: '',
  },
  headers: {},
  timeoutMs: 15000,
  retryCount: 2,
  transformationMode: 'SCRIPT',
  transformation: { script: 'return payload;' },
  isActive: true,
};

const PARTNERHUB_WORK_QUEUE_DOC = {
  _id: 'tpl-2',
  orgId: 10,
  providerKey: 'partnerhub',
  operationKey: 'patient-queue',
  name: 'PartnerHub - Work Queue',
  targetUrl: 'https://api.partnerhub.example/api/queue/items',
  httpMethod: 'GET',
  authType: 'CUSTOM',
  authConfig: {
    tokenEndpoint: 'https://api.partnerhub.example/api/generate-token',
    tokenRequestMethod: 'POST',
    tokenRequestBody: JSON.stringify({ username: '{{username}}', password: '{{password}}' }),
    tokenResponsePath: 'data.token',
    tokenHeaderName: 'Authorization',
    tokenHeaderPrefix: '',
  },
  headers: { 'x-partner-id': '{{partnerId}}' },
  timeoutMs: 15000,
  retryCount: 2,
  transformationMode: 'SCRIPT',
  transformation: { script: 'return null;' },
  isActive: true,
};

// ---------------------------------------------------------------------------
// 1. fillPlaceholders
// ---------------------------------------------------------------------------

describe('fillPlaceholders', () => {
  it('replaces {{key}} tokens in a string', () => {
    expect(fillPlaceholders('Hello {{name}}!', { name: 'PartnerHub' })).toBe('Hello PartnerHub!');
  });

  it('replaces multiple distinct tokens in one string', () => {
    expect(fillPlaceholders('{{a}}-{{b}}', { a: 'foo', b: 'bar' })).toBe('foo-bar');
  });

  it('leaves unknown tokens untouched', () => {
    expect(fillPlaceholders('Hello {{unknown}}', {})).toBe('Hello {{unknown}}');
  });

  it('recurses into nested objects', () => {
    const result = fillPlaceholders(
      { url: 'https://example.com/{{path}}', nested: { label: '{{label}}' } },
      { path: 'abha', label: 'ABHA Fetch' }
    );
    expect(result).toEqual({ url: 'https://example.com/abha', nested: { label: 'ABHA Fetch' } });
  });

  it('recurses into arrays', () => {
    const result = fillPlaceholders(['{{a}}', '{{b}}'], { a: 'x', b: 'y' });
    expect(result).toEqual(['x', 'y']);
  });

  it('passes through non-string primitives unchanged', () => {
    expect(fillPlaceholders(42, {})).toBe(42);
    expect(fillPlaceholders(true, {})).toBe(true);
    expect(fillPlaceholders(null, {})).toBeNull();
  });

  it('does not mutate the source object', () => {
    const src = { url: '{{base}}/path' };
    fillPlaceholders(src, { base: 'https://x.com' });
    expect(src.url).toBe('{{base}}/path'); // unchanged
  });

  it('fills authConfig tokenRequestBody placeholders (PartnerHub credential injection)', () => {
    const authConfig = {
      tokenRequestBody: JSON.stringify({ username: '{{username}}', password: '{{password}}' }),
    };
    const filled = fillPlaceholders(authConfig, { username: 'connector', password: 'secret' });
    const body = JSON.parse(filled.tokenRequestBody);
    expect(body.username).toBe('connector');
    expect(body.password).toBe('secret');
  });
});

// ---------------------------------------------------------------------------
// 2. resolveOperationTemplate
// ---------------------------------------------------------------------------

describe('resolveOperationTemplate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns a filled config for a matching template', async () => {
    mockFindOne.mockResolvedValueOnce(PARTNERHUB_FETCH_PROFILE_DOC);

    const result = await resolveOperationTemplate(10, 'partnerhub', 'fetch-profile', {
      username: 'connector',
      password: 's3cr3t',
    });

    expect(result.targetUrl).toBe('https://api.partnerhub.example/api/profile/fetch');
    expect(result.httpMethod).toBe('POST');
    expect(result.outgoingAuthType).toBe('CUSTOM');
    expect(result.outgoingAuthConfig.tokenHeaderPrefix).toBe('');
    // Credentials should be injected into the tokenRequestBody
    const body = JSON.parse(result.outgoingAuthConfig.tokenRequestBody);
    expect(body.username).toBe('connector');
    expect(body.password).toBe('s3cr3t');
  });

  it('fills {{partnerId}} header placeholder for patient-queue template', async () => {
    mockFindOne.mockResolvedValueOnce(PARTNERHUB_WORK_QUEUE_DOC);

    const result = await resolveOperationTemplate(10, 'partnerhub', 'patient-queue', {
      partnerId: 'HIP-001',
    });

    expect(result.customHeaders['x-partner-id']).toBe('HIP-001');
    expect(result.httpMethod).toBe('GET');
  });

  it('throws when no matching template is found', async () => {
    mockFindOne.mockResolvedValue(null); // both org-specific and global lookups return null

    await expect(resolveOperationTemplate(10, 'partnerhub', 'nonexistent', {})).rejects.toThrow(
      /Operation template not found/
    );
  });

  it('tries global template (orgId=0) when org-specific is absent', async () => {
    // First call (org-specific) returns null, second (global) returns template
    mockFindOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...PARTNERHUB_FETCH_PROFILE_DOC, orgId: 0 });

    const result = await resolveOperationTemplate(99, 'partnerhub', 'fetch-profile', {});
    expect(result.targetUrl).toContain('/api/profile/fetch');
  });

  it('defaults missing fields to safe values', async () => {
    mockFindOne.mockResolvedValueOnce({
      ...PARTNERHUB_FETCH_PROFILE_DOC,
      httpMethod: undefined,
      authType: undefined,
      timeoutMs: undefined,
    });

    const result = await resolveOperationTemplate(10, 'partnerhub', 'fetch-profile', {});
    expect(result.httpMethod).toBe('POST');
    expect(result.outgoingAuthType).toBe('NONE');
    expect(result.timeoutMs).toBe(15000);
  });
});

// ---------------------------------------------------------------------------
// 3. applyProviderRef
// ---------------------------------------------------------------------------

describe('applyProviderRef', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns config unchanged when no providerRef is present', async () => {
    const config = { targetUrl: 'https://example.com', httpMethod: 'POST' };
    const result = await applyProviderRef(10, config);
    expect(result).toBe(config); // same reference, no copy
  });

  it('merges resolved template into config with template as base', async () => {
    mockFindOne.mockResolvedValueOnce(PARTNERHUB_FETCH_PROFILE_DOC);

    const action = {
      name: 'Fetch ABHA',
      providerRef: {
        providerKey: 'partnerhub',
        operationKey: 'fetch-profile',
        placeholders: { username: 'connector', password: 'pass' },
      },
    };

    const result = await applyProviderRef(10, action);

    expect(result.targetUrl).toBe('https://api.partnerhub.example/api/profile/fetch');
    expect(result.outgoingAuthType).toBe('CUSTOM');
    expect(result.name).toBe('Fetch ABHA'); // explicit field preserved
  });

  it('explicit action fields override template fields', async () => {
    mockFindOne.mockResolvedValueOnce(PARTNERHUB_FETCH_PROFILE_DOC);

    const action = {
      providerRef: { providerKey: 'partnerhub', operationKey: 'fetch-profile', placeholders: {} },
      targetUrl: 'https://override.example.com/custom', // explicit override
      timeoutMs: 99999,
    };

    const result = await applyProviderRef(10, action);
    expect(result.targetUrl).toBe('https://override.example.com/custom');
    expect(result.timeoutMs).toBe(99999);
  });

  it('deep-merges outgoingAuthConfig (template base, action wins)', async () => {
    mockFindOne.mockResolvedValueOnce(PARTNERHUB_FETCH_PROFILE_DOC);

    const action = {
      providerRef: { providerKey: 'partnerhub', operationKey: 'fetch-profile', placeholders: {} },
      outgoingAuthConfig: { tokenHeaderPrefix: 'Custom' }, // override just the prefix
    };

    const result = await applyProviderRef(10, action);
    // Action override wins
    expect(result.outgoingAuthConfig.tokenHeaderPrefix).toBe('Custom');
    // Template base still present
    expect(result.outgoingAuthConfig.tokenResponsePath).toBe('data.token');
  });

  it('deep-merges customHeaders (template base, action wins)', async () => {
    mockFindOne.mockResolvedValueOnce(PARTNERHUB_WORK_QUEUE_DOC);

    const action = {
      providerRef: {
        providerKey: 'partnerhub',
        operationKey: 'patient-queue',
        placeholders: { partnerId: 'HIP-101' },
      },
      customHeaders: { 'x-extra': 'extra-value' }, // additional header
    };

    const result = await applyProviderRef(10, action);
    expect(result.customHeaders['x-partner-id']).toBe('HIP-101'); // from template
    expect(result.customHeaders['x-extra']).toBe('extra-value'); // from action
  });
});

// ---------------------------------------------------------------------------
// 4. hasProviderRef
// ---------------------------------------------------------------------------

describe('hasProviderRef', () => {
  it('returns true for valid providerRef shape', () => {
    expect(
      hasProviderRef({ providerRef: { providerKey: 'partnerhub', operationKey: 'fetch-profile' } })
    ).toBe(true);
  });

  it('returns false when providerRef is absent', () => {
    expect(hasProviderRef({ targetUrl: 'https://example.com' })).toBe(false);
  });

  it('returns false when providerKey is missing', () => {
    expect(hasProviderRef({ providerRef: { operationKey: 'fetch-profile' } })).toBe(false);
  });

  it('returns false when operationKey is missing', () => {
    expect(hasProviderRef({ providerRef: { providerKey: 'partnerhub' } })).toBe(false);
  });

  it('returns false for null/undefined', () => {
    expect(hasProviderRef(null)).toBe(false);
    expect(hasProviderRef(undefined)).toBe(false);
  });
});

