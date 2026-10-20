'use strict';

// The gateway encrypts 57+ production secrets (DB passwords, API keys, Script Job
// env vars) with a key that falls back to sha256(MONGODB_URI) when
// GATEWAY_SECRET_KEY is unset. That coupling is invisible until someone rotates
// the Mongo password and every secret becomes permanently undecryptable.
//
// These tests pin the two behaviours that make the failure survivable:
// the fallback is detected and announced, and a malformed key is never silently
// ignored.

jest.mock('../../src/mongodb', () => ({ getDb: jest.fn() }));
jest.mock('../../src/logger', () => ({ log: jest.fn() }));

const { log } = require('../../src/logger');
const { describeKeySource, assertSecretKeyHealth } = require('../../src/services/gateway-secrets');

const VALID_KEY = 'a'.repeat(64); // 32 bytes hex

describe('gateway secret key health', () => {
  const original = {};

  beforeEach(() => {
    jest.clearAllMocks();
    for (const k of ['GATEWAY_SECRET_KEY', 'MONGODB_URI', 'GATEWAY_SECRET_KEY_REQUIRED']) {
      original[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(original)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  describe('describeKeySource', () => {
    it('reports a properly configured key as configured', () => {
      process.env.GATEWAY_SECRET_KEY = VALID_KEY;
      expect(describeKeySource()).toEqual({ source: 'configured', reason: null });
    });

    it('reports the MONGODB_URI fallback when no key is set', () => {
      process.env.MONGODB_URI = 'mongodb://user:pass@host/db';
      const result = describeKeySource();
      expect(result.source).toBe('mongodb-uri');
      expect(result.reason).toMatch(/not set/i);
    });

    it('does not silently accept a wrong-length key', () => {
      // 16 bytes. Today this is ignored with no signal at all.
      process.env.GATEWAY_SECRET_KEY = '00112233445566778899aabbccddeeff';
      process.env.MONGODB_URI = 'mongodb://host/db';
      const result = describeKeySource();
      expect(result.source).toBe('mongodb-uri');
      expect(result.reason).toMatch(/IGNORED/);
      expect(result.reason).toMatch(/16 bytes/);
    });

    it('does not throw on a non-hex key value', () => {
      process.env.GATEWAY_SECRET_KEY = 'definitely-not-hex!!';
      process.env.MONGODB_URI = 'mongodb://host/db';
      expect(() => describeKeySource()).not.toThrow();
      expect(describeKeySource().source).toBe('mongodb-uri');
    });

    it('falls back to a hardcoded seed when nothing at all is configured', () => {
      const result = describeKeySource();
      expect(result.source).toBe('hardcoded');
    });
  });

  describe('assertSecretKeyHealth', () => {
    it('logs info and reports healthy when a real key is configured', () => {
      process.env.GATEWAY_SECRET_KEY = VALID_KEY;
      expect(assertSecretKeyHealth()).toEqual({ source: 'configured', healthy: true });
      expect(log).toHaveBeenCalledWith('info', expect.stringContaining('using GATEWAY_SECRET_KEY'));
    });

    it('warns loudly — naming the consequence — when falling back to MONGODB_URI', () => {
      process.env.MONGODB_URI = 'mongodb://user:pass@host/db';
      const result = assertSecretKeyHealth();

      expect(result).toEqual({ source: 'mongodb-uri', healthy: false });
      expect(log).toHaveBeenCalledWith(
        'warn',
        expect.stringContaining('INSECURE SECRET KEY'),
        expect.objectContaining({ remediation: expect.any(String) })
      );
      // The warning has to state the actual consequence, not just "insecure".
      const [, message] = log.mock.calls.find(([level]) => level === 'warn');
      expect(message).toMatch(/permanently undecryptable/i);
    });

    it('boots (with a warning) rather than failing when strict mode is off', () => {
      process.env.MONGODB_URI = 'mongodb://host/db';
      expect(() => assertSecretKeyHealth()).not.toThrow();
    });

    it('refuses to boot on an unsafe key when GATEWAY_SECRET_KEY_REQUIRED=true', () => {
      process.env.MONGODB_URI = 'mongodb://host/db';
      process.env.GATEWAY_SECRET_KEY_REQUIRED = 'true';
      expect(() => assertSecretKeyHealth()).toThrow(/permanently undecryptable/i);
    });

    it('does not block boot in strict mode when the key is valid', () => {
      process.env.GATEWAY_SECRET_KEY = VALID_KEY;
      process.env.GATEWAY_SECRET_KEY_REQUIRED = 'true';
      expect(() => assertSecretKeyHealth()).not.toThrow();
    });

    it('points at a remediation command that the rotation script actually supports', () => {
      process.env.MONGODB_URI = 'mongodb://host/db';
      assertSecretKeyHealth();
      const [, , meta] = log.mock.calls.find(([level]) => level === 'warn');
      // Guards against the remediation text drifting from the real CLI flags.
      expect(meta.remediation).toContain('--generate-key');
      expect(meta.remediation).toContain('--to=');
      expect(meta.remediation).toContain('--commit');
    });
  });
});
