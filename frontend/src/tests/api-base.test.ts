import { describe, expect, it } from 'vitest';
import { resolveApiBase } from '../utils/api-base';

describe('resolveApiBase', () => {
  it('resolves a relative base against the page origin', () => {
    expect(resolveApiBase('/api/v1')).toBe(`${window.location.origin}/api/v1`);
  });
  it('keeps absolute URLs and trims trailing slashes', () => {
    expect(resolveApiBase('https://gw.example.com/api/v1/')).toBe('https://gw.example.com/api/v1');
  });
  it('falls back when unset', () => {
    expect(resolveApiBase(undefined)).toBe('http://localhost:4000/api/v1');
  });
});
