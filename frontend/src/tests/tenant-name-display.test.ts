import { describe, it, expect } from 'vitest';
import { shortTenantName } from '../utils/tenant-display';

/**
 * The header showed the full legal entity name, ellipsised, immediately beside
 * a selector showing the same name ellipsised at a different point — two
 * truncations of one string, e.g.
 *
 *   "Acme Health (Harmony Institut…"   and   "Acme Health (Harmony Institute o…"
 *
 * The identity line keeps the short form; the full name stays on hover and in
 * the selector.
 */

describe('tenant name shortening', () => {
  it('drops a trailing parenthetical legal name', () => {
    expect(shortTenantName('Acme Health (Harmony Institute of Excellence in Reproductive Health)')).toBe('Acme Health');
  });

  it('leaves an already-short name alone', () => {
    expect(shortTenantName('ubq demo')).toBe('ubq demo');
  });

  it('keeps the original when the whole name is parenthesised', () => {
    expect(shortTenantName('(Harmony Institute)')).toBe('(Harmony Institute)');
  });

  it('does not strip parentheses that are not trailing', () => {
    expect(shortTenantName('Apollo (North) Hospital')).toBe('Apollo (North) Hospital');
  });

  it('handles missing names', () => {
    expect(shortTenantName(undefined)).toBeUndefined();
    expect(shortTenantName(null)).toBeUndefined();
    expect(shortTenantName('')).toBeUndefined();
  });
});
