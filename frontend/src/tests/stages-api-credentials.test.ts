import { beforeEach, describe, expect, it, vi } from 'vitest';

const request = vi.hoisted(() => vi.fn());
vi.mock('../services/api', async (importOriginal) => ({ ...(await importOriginal<object>()), apiRequest: request }));

import { listCredentialOptions } from '../services/stages-api';

describe('the credentials a step can use', () => {
  beforeEach(() => request.mockReset());

  it('are identified by the id the credentials API returns, which is what a step stores', async () => {
    request.mockResolvedValue({
      data: [{ id: 'cred_1', name: 'Acme portal', provider: 'Acme', environment: 'production', status: 'READY', fields: [{ key: 'token', label: 'Access token' }] }],
    });
    const [option] = await listCredentialOptions();
    expect(option.placeholderId).toBe('cred_1');
    expect(option).toMatchObject({ name: 'Acme portal', provider: 'Acme', fields: [{ key: 'token' }] });
  });

  it('keep a placeholderId when that is what comes back', async () => {
    request.mockResolvedValue({ data: [{ placeholderId: 'cred_2', name: 'B', provider: 'P', environment: 'validation', status: 'READY', fields: [] }] });
    expect((await listCredentialOptions())[0].placeholderId).toBe('cred_2');
  });
});
