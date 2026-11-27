import { describe, expect, it } from 'vitest';
import { DEFAULT_BRANDING, brandingDocumentTitle, normalizeBranding } from '../app/branding';

describe('branding', () => {
  it('falls back to a generic product name when nothing is configured', () => {
    expect(DEFAULT_BRANDING.productName.length).toBeGreaterThan(0);
    expect(normalizeBranding(undefined)).toEqual(DEFAULT_BRANDING);
    expect(normalizeBranding({})).toEqual(DEFAULT_BRANDING);
  });

  it('accepts an organisation override and trims it', () => {
    expect(
      normalizeBranding({ productName: '  Acme Gateway ', workspaceName: 'ACME', logoUrl: ' https://acme.test/logo.svg ' })
    ).toEqual({
      productName: 'Acme Gateway',
      workspaceName: 'ACME',
      logoUrl: 'https://acme.test/logo.svg',
    });
  });

  it('treats explicit empty strings as "no wordmark" rather than falling back', () => {
    const branding = normalizeBranding({ workspaceName: '', logoUrl: '' });
    expect(branding.workspaceName).toBeNull();
    expect(branding.logoUrl).toBeNull();
  });

  it('builds the document title from the workspace and product', () => {
    expect(brandingDocumentTitle({ productName: 'Gateway', workspaceName: 'Acme', logoUrl: null })).toBe(
      'Acme · Gateway'
    );
    expect(brandingDocumentTitle({ productName: 'Gateway', workspaceName: null, logoUrl: null })).toBe('Gateway');
  });
});
