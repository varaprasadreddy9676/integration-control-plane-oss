'use strict';

/** {{name}} placeholders in templates, the one implementation. */

const { replacePlaceholders, replacePlaceholdersInObject } = require('../../src/utils/placeholders');

describe('replacePlaceholders', () => {
  it('replaces every occurrence and a missing value becomes empty', () => {
    expect(replacePlaceholders('{{host}}/a/{{host}}/{{id}}', { host: 'x.test', id: '7' })).toBe('x.test/a/x.test/7');
    expect(replacePlaceholders('a-{{gone}}-b', { gone: undefined })).toBe('a--b');
    expect(replacePlaceholders('{{unknown}}', { other: '1' })).toBe('{{unknown}}');
  });

  it('is literal: a value may contain replacement patterns and a name may contain regex characters', () => {
    expect(replacePlaceholders('{{k}}', { k: "price $& $1 $'" })).toBe("price $& $1 $'");
    expect(replacePlaceholders('{{a.b}} {{axb}}', { 'a.b': 'dot', axb: 'x' })).toBe('dot x');
  });

  it('leaves non-text alone', () => {
    expect(replacePlaceholders(42, { a: 'b' })).toBe(42);
    expect(replacePlaceholders(null, { a: 'b' })).toBeNull();
    expect(replacePlaceholders('{{a}}', undefined)).toBe('{{a}}');
  });
});

describe('replacePlaceholdersInObject', () => {
  it('goes through objects and arrays at any depth and returns a copy', () => {
    const source = { url: 'https://{{host}}/x', headers: { 'X-Id': '{{id}}', n: 3 }, list: ['{{id}}', { deep: '{{host}}' }], flag: true, nothing: null };
    const result = replacePlaceholdersInObject(source, { host: 'h.test', id: '9' });
    expect(result).toEqual({ url: 'https://h.test/x', headers: { 'X-Id': '9', n: 3 }, list: ['9', { deep: 'h.test' }], flag: true, nothing: null });
    expect(source.url).toBe('https://{{host}}/x');
  });
});
