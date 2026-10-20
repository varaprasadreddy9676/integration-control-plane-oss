/**
 * A fresh install has no ui_config document, which made every config read fail
 * with "UI configuration not seeded" until someone ran a script by hand.
 * ensureDefaultUiConfig() creates it at startup — and must never overwrite a
 * default that already exists (production edits it through the admin UI).
 */

const mockCollection = {
  updateOne: jest.fn().mockResolvedValue({ upsertedCount: 1 }),
};

jest.mock('../../src/mongodb', () => ({
  isConnected: jest.fn().mockReturnValue(true),
  getDbSafe: jest.fn().mockResolvedValue({ collection: jest.fn(() => mockCollection) }),
}));

const { ensureDefaultUiConfig } = require('../../src/data/ui-config');
const { defaultUIConfig } = require('../../src/data/ui-config-defaults');

describe('ensureDefaultUiConfig', () => {
  beforeEach(() => mockCollection.updateOne.mockClear());

  it('inserts the default document only when it is missing', async () => {
    await ensureDefaultUiConfig();

    expect(mockCollection.updateOne).toHaveBeenCalledTimes(1);
    const [filter, update, options] = mockCollection.updateOne.mock.calls[0];
    expect(filter).toEqual({ _id: 'default' });
    expect(options).toEqual({ upsert: true });
    // Only $setOnInsert: an existing document is left exactly as it is.
    expect(Object.keys(update)).toEqual(['$setOnInsert']);
    expect(update.$setOnInsert._id).toBeUndefined();
    expect(update.$setOnInsert.httpMethods).toEqual(defaultUIConfig.httpMethods);
    expect(update.$setOnInsert.authTypes).toEqual(defaultUIConfig.authTypes);
  });

  it('reports whether it created the document', async () => {
    mockCollection.updateOne.mockResolvedValueOnce({ upsertedCount: 1 });
    await expect(ensureDefaultUiConfig()).resolves.toBe(true);

    mockCollection.updateOne.mockResolvedValueOnce({ upsertedCount: 0 });
    await expect(ensureDefaultUiConfig()).resolves.toBe(false);
  });
});
