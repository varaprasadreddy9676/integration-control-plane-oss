import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';

/**
 * Hardcoded surface colours are how dark mode breaks. The near-white KPI cards
 * and a status label at 2.83:1 both came from light-mode hex written directly
 * into a component that also renders on the navy shell.
 *
 * This is deliberately narrow rather than a blanket ban:
 *
 *  - Chart series colours (#10B981 etc. passed as a `color:` on a data series)
 *    are data encodings and are meant to stay constant across themes.
 *  - The flow-builder canvas uses categorical node colours, and the login page
 *    is a fixed dark landing surface. Both are excluded by path.
 *
 * What is banned is a *surface* colour — background, border, or text — written
 * as hex on a screen that renders inside the themed app shell. Use cssVar.
 */
const featuresDir = resolve(__dirname, '../features');

const EXCLUDED = [
  'features/flowBuilder/', // categorical node palette on its own canvas
  'features/auth/', // fixed dark landing/login surface
];

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : full.endsWith('.tsx') ? [full] : [];
  });

const SURFACE_HEX = /(background|backgroundColor|borderColor|border|color)\s*:\s*'#[0-9a-fA-F]{6}'/g;

const offenders = walk(featuresDir)
  .map((file) => ({ file, rel: file.split('/src/')[1] }))
  .filter(({ rel }) => !EXCLUDED.some((prefix) => rel.startsWith(prefix)))
  .flatMap(({ file, rel }) => {
    const src = readFileSync(file, 'utf-8');
    const hits = src.match(SURFACE_HEX) || [];
    return hits.length ? [`${rel}: ${hits.length} (${hits[0]})`] : [];
  });

// Occurrences remaining when this guard went in. It is a ratchet: it may fall,
// it must not rise. Each one is a dark-mode bug waiting to be reported, so if
// you are touching a file in this list, take its entries with you.
const BASELINE = 43;

const totalOccurrences = offenders.reduce((sum, entry) => sum + Number(entry.match(/: (\d+) /)?.[1] ?? 0), 0);

describe('themed screens use tokens for surface colours', () => {
  it('does not add hardcoded background/border/text hex outside the excluded surfaces', () => {
    expect({ totalOccurrences, offenders }).toEqual({ totalOccurrences: expect.any(Number), offenders });
    expect(totalOccurrences).toBeLessThanOrEqual(BASELINE);
  });
});
