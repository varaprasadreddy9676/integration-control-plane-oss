'use strict';

const { generateMaskedCurlCommand } = require('../../src/utils/curl-generator');

describe('generateMaskedCurlCommand', () => {
  it('never prints an inbound API key saved as apiKey', () => {
    const curl = generateMaskedCurlCommand({
      type: 'customer-lookup',
      orgId: 1,
      httpMethod: 'POST',
      inboundAuthType: 'API_KEY',
      inboundAuthConfig: { headerName: 'X-API-Key', apiKey: 'lookup-secret' },
    });

    expect(curl).toContain('X-API-Key: <your-api-key>');
    expect(curl).not.toContain('lookup-secret');
  });
});
