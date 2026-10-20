import { describe, it, expect, vi, afterEach } from 'vitest';
import { deleteAdminOrg } from '../services/api';

const respond = (status: number, body: unknown) =>
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  );

// Deleting an org that still has users or integrations is refused (409) so
// its users aren't left signing in to an org that no longer exists.
describe('deleteAdminOrg', () => {
  afterEach(() => vi.restoreAllMocks());

  it('surfaces the refusal message and counts on 409', async () => {
    const message = 'Organization still has 1 active user and 3 integrations.';
    respond(409, { error: message, code: 'CONFLICT', details: { activeUsers: 1, integrations: 3 } });

    await expect(deleteAdminOrg(648)).rejects.toMatchObject({ statusCode: 409, message });
  });

  it('sends force=true only when asked and returns what was deactivated', async () => {
    const fetchSpy = respond(200, { message: 'Organization deleted', usersDeactivated: 1, integrationsDisabled: 2 });

    await expect(deleteAdminOrg(648, { force: true })).resolves.toMatchObject({ usersDeactivated: 1 });
    expect(String(fetchSpy.mock.calls[0][0])).toMatch(/\/admin\/orgs\/648\?force=true$/);

    await deleteAdminOrg(648);
    expect(String(fetchSpy.mock.calls[1][0])).toMatch(/\/admin\/orgs\/648$/);
  });
});
