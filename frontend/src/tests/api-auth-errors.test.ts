import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getTenantInfo } from '../services/api';

const TOKEN_KEY = 'integration_gateway_token';

const respond = (status: number, body: unknown) =>
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  );

// A 403 means "signed in, but not allowed this" (a permission, or another
// org). Signing the user out for it threw people back to the start page.
describe('API auth errors', () => {
  beforeEach(() => localStorage.setItem(TOKEN_KEY, 'session-token'));
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('keeps the session on 403', async () => {
    respond(403, { error: 'You do not have access to this organization', code: 'FORBIDDEN' });
    await expect(getTenantInfo()).rejects.toMatchObject({ statusCode: 403 });
    expect(localStorage.getItem(TOKEN_KEY)).toBe('session-token');
  });

  it('ends the session on 401', async () => {
    respond(401, { error: 'Invalid token', code: 'UNAUTHORIZED' });
    await expect(getTenantInfo()).rejects.toMatchObject({ statusCode: 401 });
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });
});
