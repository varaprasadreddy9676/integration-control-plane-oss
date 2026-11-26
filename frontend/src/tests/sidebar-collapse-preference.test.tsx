import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const appSource = readFileSync(resolve(process.cwd(), 'src/app/App.tsx'), 'utf8');

describe('sidebar collapse preference', () => {
  it('changes only through the user toggle and persists the saved choice', () => {
    expect(appSource.match(/setCollapsed\(/g)).toHaveLength(1);
    expect(appSource).toContain("localStorage.getItem('sidebar-collapsed')");
    expect(appSource).toContain("localStorage.setItem('sidebar-collapsed'");
  });
});
