'use strict';

jest.mock('../../src/db', () => ({
  isConfigured: jest.fn(() => false),
}));

jest.mock('../../src/logger', () => ({
  log: jest.fn(),
}));

const { testConnection } = require('../../src/services/event-source-tester');
const { DeliveryWorkerManager } = require('../../src/processor/delivery-worker-manager');
const { Hl7MllpEventSource } = require('../../src/adapters/Hl7MllpEventSource');

describe('HL7 event source configuration', () => {
  it('validates hl7_mllp listener config without opening a network listener', async () => {
    const result = await testConnection('hl7_mllp', {
      host: '0.0.0.0',
      port: 2575,
      messageTypeMapping: {
        'ORM^O01': 'RIS_ORDER_CREATED',
      },
      allowedSourceIps: ['127.0.0.1', '10.10.0.0/16'],
      duplicateWindowMs: 60000,
      listenerLockEnabled: true,
      listenerLockTtlMs: 30000,
      tls: {
        enabled: true,
        keyPath: '/etc/integration-control-plane/hl7.key',
        certPath: '/etc/integration-control-plane/hl7.crt',
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        listener: {
          host: '0.0.0.0',
          port: 2575,
          protocol: 'hl7_mllp',
          transport: 'tls',
          listenerLockEnabled: true,
        },
      })
    );
  });

  it('rejects invalid hl7_mllp listener config', async () => {
    const result = await testConnection('hl7_mllp', {
      host: '',
      port: 99999,
      messageTypeMapping: [],
      allowedSourceIps: '127.0.0.1',
      duplicateWindowMs: 10,
      listenerLockTtlMs: 1,
      tls: { enabled: true },
    });

    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        code: 'INVALID_CONFIG',
        error: expect.stringContaining('port must be between 1 and 65535'),
      })
    );
    expect(result.error).toContain('allowedSourceIps must be an array');
    expect(result.error).toContain('duplicateWindowMs must be between 1000 and 86400000');
    expect(result.error).toContain('listenerLockTtlMs must be between 5000 and 300000');
    expect(result.error).toContain('tls key/cert or keyPath/certPath are required when TLS is enabled');
  });

  it('creates Hl7MllpEventSource from the delivery worker manager', () => {
    const manager = new DeliveryWorkerManager();
    const adapter = manager._createAdapter(812, 'hl7_mllp', {
      host: '127.0.0.1',
      port: 2575,
      messageTypeMapping: {
        'ORU^R01': 'RIS_REPORT_READY',
      },
    });

    expect(adapter).toBeInstanceOf(Hl7MllpEventSource);
    expect(adapter.getRuntimeStatus()).toEqual(
      expect.objectContaining({
        orgId: 812,
        host: '127.0.0.1',
        port: 2575,
        protocol: 'hl7_mllp',
      })
    );
  });
});
