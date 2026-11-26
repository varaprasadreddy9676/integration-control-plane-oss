import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sidebarSource = readFileSync(resolve(process.cwd(), 'src/components/layout/AppSidebar.tsx'), 'utf8');
const foundationStyles = readFileSync(resolve(process.cwd(), 'src/design-system/theme/product-foundations.css'), 'utf8');

describe('global search control', () => {
  it('keeps search in the top bar and removes sidebar-owned duplicate styles', () => {
    expect(sidebarSource).toContain("app-sidebar${isCollapsed ? ' app-sidebar--collapsed' : ''}");
    expect(sidebarSource).not.toContain('SearchOutlined');
    expect(sidebarSource).not.toContain('Recent');
    expect(foundationStyles).toContain('.global-search-trigger');
    expect(foundationStyles).not.toContain('.app-sidebar-search');
  });

  it('keeps the activity date range wide on desktop and reflows filters at intermediate widths', () => {
    expect(foundationStyles).toContain('minmax(250px, 1.2fr) minmax(260px, 1.35fr)');
    expect(foundationStyles).toMatch(/@media \(max-width: 1280px\)\s*\{\s*\.activity-filter-grid\s*\{\s*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/);
  });
});
