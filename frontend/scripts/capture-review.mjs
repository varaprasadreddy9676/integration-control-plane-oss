import { access, mkdir, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const frontendRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = dirname(frontendRoot);
const outputDir = process.env.REVIEW_OUTPUT_DIR || join(repoRoot, 'medics-screen-review', 'after');
const baseUrl = process.env.REVIEW_BASE_URL || 'http://127.0.0.1:5177/integration-gateway';
const orgQuery = '?orgId=33';
const routes = [
  ['01-dashboard', `/dashboard${orgQuery}`],
  ['02-integrations', `/integrations?tab=outbound&orgId=33`],
  ['03-integration-detail', `/integrations/review-outbound${orgQuery}`],
  ['04-inbound-integrations', `/integrations?tab=inbound&orgId=33`],
  ['05-inbound-detail', `/inbound-integrations/review-inbound${orgQuery}`],
  ['06-flow-builder', `/flow-builder${orgQuery}`],
  ['07-flow-builder-new', `/flow-builder/new${orgQuery}`],
  ['08-events', `/events${orgQuery}`],
  ['09-events-catalog', `/events/catalog${orgQuery}`],
  ['10-lookups', `/lookups${orgQuery}`],
  ['11-lookups-stats', `/lookups/stats${orgQuery}`],
  ['12-lookup-detail', `/lookups/review-lookup${orgQuery}`],
  ['13-logs', `/logs${orgQuery}`],
  ['14-log-detail', `/logs/review-log-1${orgQuery}`],
  ['15-dlq', `/dlq${orgQuery}`],
  ['16-scheduled', `/scheduled${orgQuery}`],
  ['17-scheduled-jobs', `/scheduled-jobs${orgQuery}`],
  ['18-scheduled-job-detail', `/scheduled-jobs/review-job${orgQuery}`],
  ['19-alert-center', `/alert-center${orgQuery}`],
  ['20-system-logs', `/system-logs${orgQuery}`],
  ['21-templates', `/templates${orgQuery}`],
  ['22-template-new', `/templates/new${orgQuery}`],
  ['23-template-detail', `/templates/review-template${orgQuery}`],
  ['24-bulk', `/bulk${orgQuery}`],
  ['25-versions', `/versions/Appointment%20Created%20to%20Scheduling${orgQuery}`],
  ['26-settings', `/settings${orgQuery}`],
  ['27-settings-event-source', `/settings/event-source${orgQuery}`],
  ['28-settings-mysql-pool', `/settings/mysql-pool${orgQuery}`],
  ['29-settings-sender-profiles', `/settings/sender-profiles${orgQuery}`],
  ['30-settings-providers', `/settings/providers${orgQuery}`],
  ['31-admin-users', `/admin/users`],
  ['32-admin-orgs', `/admin/orgs`],
  ['33-admin-roles', `/admin/roles`],
  ['34-admin-api-keys', `/admin/api-keys`],
  ['35-admin-permissions', `/admin/permissions`],
  ['36-admin-rate-limits', `/admin/rate-limits`],
  ['37-admin-audit-logs', `/admin/audit-logs`],
  ['38-admin-user-activity', `/admin/user-activity`],
  ['39-admin-storage', `/admin/storage`],
  ['40-admin-system-status', `/admin/system-status`],
  ['41-status-system', `/status/system${orgQuery}`],
  ['42-help', `/help${orgQuery}`],
  ['43-help-lookup-guide', `/help/lookup-guide${orgQuery}`],
  ['44-docs', `/docs`],
  ['45-docs-versioning', `/docs/versioning`],
  ['46-portal-launch', `/portal/launch?pid=review-profile&secret=review-fixture-credential`],
  ['47-login', `/login`],
];
const requestedRoutes = process.env.REVIEW_ONLY?.split(',').filter(Boolean);
const routesToCapture = requestedRoutes ? routes.filter(([name]) => requestedRoutes.includes(name)) : routes;
if (requestedRoutes && routesToCapture.length !== requestedRoutes.length) {
  throw new Error(
    `Unknown REVIEW_ONLY route name(s): ${requestedRoutes.filter((name) => !routes.some(([routeName]) => routeName === name)).join(', ')}`
  );
}
if (!routesToCapture.length) throw new Error('No review routes selected.');

const browserPath = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
await access(browserPath, constants.X_OK);
await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: browserPath });
const issues = [];
const warnings = [];
const captures = [];
const hoverChecks = [];
const mobileChromeChecks = [];
const mobileScopeNoticeChecks = [];
const tabChecks = [];

async function checkLookupRowHover(page, theme, width) {
  await page.setViewportSize({ width, height: 844 });
  await page.goto(`${baseUrl}/lookups${orgQuery}`, { waitUntil: 'domcontentloaded' });
  const row = page.locator('.modern-table-wrapper .ant-table-tbody > tr.ant-table-row').first();
  await row.waitFor({ state: 'visible' });
  await row.hover();
  await page.waitForTimeout(180);
  const result = await row.evaluate((rowElement, theme) => {
    const cells = [...rowElement.querySelectorAll('td')];
    const cell = cells.find((candidate) => !candidate.classList.contains('ant-table-selection-column'));
    const resolveColor = (value) => {
      const probe = document.createElement('span');
      probe.style.position = 'fixed';
      probe.style.backgroundColor = value;
      document.body.append(probe);
      const resolved = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return resolved;
    };
    const rgb = (value) =>
      value
        .match(/[\d.]+/g)
        .slice(0, 3)
        .map(Number)
        .map((channel) => {
          const normalized = channel / 255;
          return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
        });
    const luminance = (value) => {
      const [red, green, blue] = rgb(value);
      return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    };
    const background = getComputedStyle(cell).backgroundColor;
    const rowBackground = getComputedStyle(rowElement).backgroundColor;
    const cellBackgrounds = cells.map((candidate) => getComputedStyle(candidate).backgroundColor);
    const color = getComputedStyle(cell).color;
    const expectedFallbackBackground = theme === 'dark' ? 'rgb(24, 28, 34)' : 'rgb(252, 252, 255)';
    const expectedFallbackColor = theme === 'dark' ? 'rgb(222, 226, 236)' : 'rgb(27, 27, 34)';
    const visibleTextSamples = cells
      .filter((candidate) => !candidate.classList.contains('ant-table-selection-column'))
      .flatMap((candidate) => [...candidate.querySelectorAll('*')])
      .filter(
        (element) =>
          element.children.length === 0 &&
          element.textContent?.trim() &&
          !element.closest('.status-badge, .ant-switch, button')
      )
      .map((element) => {
        let surface = element;
        let surfaceColor = 'transparent';
        while (surface && surface !== rowElement) {
          surfaceColor = getComputedStyle(surface).backgroundColor;
          if (surfaceColor !== 'transparent' && !surfaceColor.endsWith(', 0)')) break;
          surface = surface.parentElement;
        }
        return {
          text: element.textContent.trim().slice(0, 80),
          className: String(element.className || ''),
          color: getComputedStyle(element).color,
          background: surfaceColor,
        };
      });
    const mobileCardMode = cell.closest('.modern-table-wrapper')?.classList.contains('mobile-card-mode') ?? false;
    const expectedBackground = resolveColor(
      mobileCardMode ? expectedFallbackBackground : 'var(--color-background-row-hover)'
    );
    const expectedColor = resolveColor('var(--color-text-primary)');
    const [first, second] = [luminance(background), luminance(color)].sort((a, b) => b - a);
    const root = document.documentElement;
    const previousSurface = root.style.getPropertyValue('--color-bg-surface');
    const previousForeground = root.style.getPropertyValue('--color-text-primary');
    root.style.setProperty('--color-bg-surface', '#000000');
    root.style.setProperty('--color-text-primary', '#111111');
    const fallbackBackground = getComputedStyle(cell).backgroundColor;
    const fallbackRowBackground = getComputedStyle(rowElement).backgroundColor;
    const fallbackColor = getComputedStyle(cell).color;
    const fallbackTextSamples = cells
      .filter((candidate) => !candidate.classList.contains('ant-table-selection-column'))
      .flatMap((candidate) => [...candidate.querySelectorAll('*')])
      .filter(
        (element) =>
          element.children.length === 0 &&
          element.textContent?.trim() &&
          !element.closest('.status-badge, .ant-switch, button')
      )
      .map((element) => {
        let surface = element;
        let surfaceColor = 'transparent';
        while (surface && surface !== rowElement) {
          surfaceColor = getComputedStyle(surface).backgroundColor;
          if (surfaceColor !== 'transparent' && !surfaceColor.endsWith(', 0)')) break;
          surface = surface.parentElement;
        }
        return {
          text: element.textContent.trim().slice(0, 80),
          className: String(element.className || ''),
          color: getComputedStyle(element).color,
          background: surfaceColor,
        };
      });
    if (previousSurface) root.style.setProperty('--color-bg-surface', previousSurface);
    else root.style.removeProperty('--color-bg-surface');
    if (previousForeground) root.style.setProperty('--color-text-primary', previousForeground);
    else root.style.removeProperty('--color-text-primary');
    return {
      background,
      rowBackground,
      cellBackgrounds,
      color,
      visibleTextSamples,
      expectedBackground,
      expectedColor,
      contrast: (first + 0.05) / (second + 0.05),
      mobileCardMode,
      fallbackBackground,
      fallbackRowBackground,
      fallbackColor,
      fallbackTextSamples,
      fallbackPasses:
        fallbackBackground === expectedFallbackBackground &&
        fallbackRowBackground === expectedFallbackBackground &&
        fallbackColor === expectedFallbackColor,
    };
  }, theme);
  hoverChecks.push({ route: '10-lookups', theme, width, ...result });
  await page.screenshot({
    path: join(outputDir, `10-lookups-hover-${theme}-${width}.png`),
    animations: 'disabled',
  });
  const inconsistentCardBackground =
    result.mobileCardMode &&
    (result.rowBackground !== result.expectedBackground ||
      result.cellBackgrounds.some((background) => background !== result.expectedBackground));
  if (inconsistentCardBackground) {
    issues.push({
      route: '/lookups',
      kind: 'contrast',
      detail: `${theme} mobile lookup card hover repaints its row/cells to ${result.rowBackground} / ${result.cellBackgrounds.join(', ')}, expected ${result.expectedBackground}`,
    });
  } else if (result.mobileCardMode && result.color !== result.expectedColor) {
    issues.push({
      route: '/lookups',
      kind: 'contrast',
      detail: `${theme} mobile lookup card text is ${result.color}, expected semantic foreground ${result.expectedColor}`,
    });
  } else if (result.contrast < 4.5) {
    issues.push({
      route: '/lookups',
      kind: 'contrast',
      detail: `${theme} hovered lookup row contrast is ${result.contrast.toFixed(2)}:1 (${result.color} on ${result.background})`,
    });
  }
  const colorLuminance = (value) => {
    const [red, green, blue] = value
      .match(/[\d.]+/g)
      .slice(0, 3)
      .map((channel) => {
        const normalized = Number(channel) / 255;
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      });
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };
  const lowContrastText = result.visibleTextSamples.filter(({ color, background }) => {
    const [first, second] = [colorLuminance(color), colorLuminance(background)].sort((a, b) => b - a);
    return (first + 0.05) / (second + 0.05) < 4.5;
  });
  if (result.mobileCardMode && lowContrastText.length) {
    issues.push({
      route: '/lookups',
      kind: 'contrast',
      detail: `${theme} mobile lookup hover has visible text below 4.5:1 contrast (${lowContrastText.map(({ color, background }) => `${color} on ${background}`).join(', ')})`,
    });
  }
  const lowContrastFallbackText = result.fallbackTextSamples.filter(({ color, background }) => {
    const [first, second] = [colorLuminance(color), colorLuminance(background)].sort((a, b) => b - a);
    return (first + 0.05) / (second + 0.05) < 4.5;
  });
  if (result.mobileCardMode && lowContrastFallbackText.length) {
    issues.push({
      route: '/lookups',
      kind: 'contrast',
      detail: `${theme} mobile lookup hover fallback has visible text below 4.5:1 contrast (${lowContrastFallbackText.map(({ color, background }) => `${color} on ${background}`).join(', ')})`,
    });
  }
  if (result.mobileCardMode && !result.fallbackPasses) {
    issues.push({
      route: '/lookups',
      kind: 'contrast',
      detail: `${theme} mobile lookup hover fallback is ${result.fallbackRowBackground} / ${result.fallbackColor}, expected ${theme === 'dark' ? 'rgb(24, 28, 34) / rgb(222, 226, 236)' : 'rgb(252, 252, 255) / rgb(27, 27, 34)'}`,
    });
  }
}

async function checkSystemLogTabs(page) {
  const appRows = await page.locator('.modern-table-wrapper .ant-table-tbody > tr.ant-table-row').count();
  const appTags = await page.locator('.modern-table-wrapper .ant-tag').count();
  const appBadges = await page.locator('.modern-table-wrapper .status-badge').allTextContents();
  const appText = await page.locator('.modern-table-wrapper').innerText();
  if (appRows < 2) {
    issues.push({
      route: '/system-logs',
      kind: 'fixture-content',
      detail: `Expected two application poll rows; found ${appRows}`,
    });
  }
  const appSemanticsPass =
    appTags === 0 &&
    appBadges.some((label) => label.includes('Has errors')) &&
    appBadges.some((label) => label.includes('Healthy')) &&
    appText.includes('POLL #1248') &&
    appText.includes('1 error') &&
    appText.includes('1 warning') &&
    !appText.includes('1 errors') &&
    !appText.includes('1 warnings');
  if (!appSemanticsPass) {
    issues.push({
      route: '/system-logs',
      kind: 'status-metadata',
      detail: JSON.stringify({ appTags, appBadges, hasPollId: appText.includes('POLL #1248') }),
    });
  }

  const accessTab = page.getByRole('tab', { name: 'Access Logs' });
  await accessTab.click();
  const selected = await accessTab.getAttribute('aria-selected');
  if (selected !== 'true') {
    issues.push({
      route: '/system-logs',
      kind: 'tabs',
      detail: 'Selecting Access Logs did not update the active tab state',
    });
  }
  await page.locator('.modern-table-wrapper .status-badge').filter({ hasText: 'Info' }).waitFor({
    state: 'visible',
    timeout: 5000,
  });
  const accessTags = await page.locator('.modern-table-wrapper .ant-tag').count();
  const accessBadges = await page.locator('.modern-table-wrapper .status-badge').allTextContents();
  if (accessTags !== 0 || !accessBadges.some((label) => label.includes('Info'))) {
    issues.push({
      route: '/system-logs',
      kind: 'status-metadata',
      detail: JSON.stringify({ accessTags, accessBadges }),
    });
  }
  await page.screenshot({
    path: join(outputDir, '20-system-logs-access-1440.png'),
    animations: 'disabled',
  });
  tabChecks.push({
    route: '20-system-logs',
    appSemanticsPass,
    accessTags,
    accessBadges,
    screenshots: 1,
    passed: appSemanticsPass && accessTags === 0 && accessBadges.some((label) => label.includes('Info')),
  });
}

async function checkSystemLogSummaryLayout(page, width) {
  const summary = page.locator('.system-logs-summary-grid');
  const columns = await summary.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length);
  const expected = width < 768 ? 2 : 4;
  if (columns !== expected) {
    issues.push({
      route: '/system-logs',
      kind: 'layout',
      detail: `Summary cards use ${columns} columns at ${width}px; expected ${expected}`,
    });
  }
}

async function checkVersionTabs(page, outputDir) {
  const versionTags = await page.locator('.ant-tag').count();
  const versionStatuses = await page.locator('.status-badge').allTextContents();
  const compatibilityVisible = await page.getByText('Backward compatible').count();
  const summaryPass = versionTags === 0 && versionStatuses.includes('Default') && compatibilityVisible > 0;
  tabChecks.push({
    route: '25-versions',
    check: 'status-and-metadata',
    versionTags,
    versionStatuses,
    compatibilityVisible,
    passes: summaryPass,
  });
  if (!summaryPass)
    issues.push({
      route: '/versions',
      kind: 'presentation',
      detail: `Expected neutral compatibility metadata and sentence-case lifecycle badge (Tags: ${versionTags}; badges: ${versionStatuses.join(', ')})`,
    });

  const timelineTab = page.getByRole('tab', { name: 'Timeline' });
  await timelineTab.click();
  const selected = await timelineTab.getAttribute('aria-selected');
  const timelineVisible = await page.locator('#timeline-panel').isVisible();
  const passes = selected === 'true' && timelineVisible;
  tabChecks.push({ route: '25-versions', tab: 'Timeline', selected, timelineVisible, passes });
  if (!passes)
    issues.push({
      route: '/versions',
      kind: 'tabs',
      detail: 'Selecting Timeline did not activate its associated panel',
    });
  await page.screenshot({ path: join(outputDir, '25-versions-timeline-light-1440.png'), animations: 'disabled' });
  await page.getByRole('tab', { name: 'Versions' }).click();
}

async function checkBulkImportTabs(page, outputDir) {
  await page.getByRole('button', { name: /Bulk Import/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Bulk Import Events' });
  await dialog.waitFor({ state: 'visible' });
  const fileTab = dialog.getByRole('tab', { name: 'File Upload' });
  const jsonTab = dialog.getByRole('tab', { name: 'JSON Input' });
  const filePanel = dialog.locator('#file-upload-panel');
  const jsonPanel = dialog.locator('#json-input-panel');
  const initialPass = (await fileTab.getAttribute('aria-selected')) === 'true' && (await filePanel.isVisible());
  await jsonTab.click();
  const jsonPass =
    (await jsonTab.getAttribute('aria-selected')) === 'true' &&
    (await jsonPanel.isVisible()) &&
    (await dialog.getByPlaceholder(/Paste JSON array or object with events array/).isVisible());
  tabChecks.push({ route: '08-events', tab: 'JSON Input', initialPass, jsonPass });
  if (!initialPass || !jsonPass) {
    issues.push({
      route: '/events',
      kind: 'tabs',
      detail: 'Bulk import tab selection or its input panel did not activate',
    });
  }
  await page.screenshot({ path: join(outputDir, '08-events-bulk-import-json-light-1440.png'), animations: 'disabled' });
  await page.keyboard.press('Escape');
}

async function checkEventDetailTabs(page, outputDir, width) {
  await page.locator('.event-catalog-view-button').first().click();
  const drawer = page.locator('.ant-drawer').last();
  const eventTags = await drawer.locator('.ant-tag').count();
  const categoryVisible = await drawer.getByText('Category', { exact: true }).isVisible();
  const eventTypeVisible = await drawer.getByText('Event Type', { exact: true }).isVisible();
  const summaryPass = eventTags === 0 && categoryVisible && eventTypeVisible;
  tabChecks.push({
    route: '09-events-catalog',
    width,
    check: 'neutral-summary',
    eventTags,
    categoryVisible,
    eventTypeVisible,
    passes: summaryPass,
  });
  if (!summaryPass) {
    issues.push({
      route: '/events/catalog',
      kind: 'presentation',
      detail: `Expected event type/category as neutral text without Tags (drawer Tags: ${eventTags})`,
    });
  }
  const schemaTab = page.getByRole('tab', { name: /Field Schema/ });
  const sampleTab = page.getByRole('tab', { name: 'Sample Payload' });
  const usageTab = page.getByRole('tab', { name: 'Usage Guide' });
  const schemaPanel = page.locator('#event-detail-schema-panel');
  const samplePanel = page.locator('#event-detail-sample-panel');
  const usagePanel = page.locator('#event-detail-usage-panel');
  const schemaPass =
    (await schemaTab.getAttribute('aria-selected')) === 'true' &&
    (await schemaTab.getAttribute('aria-controls')) === 'event-detail-schema-panel' &&
    (await schemaPanel.isVisible());
  await sampleTab.click();
  const samplePass =
    (await sampleTab.getAttribute('aria-selected')) === 'true' &&
    (await sampleTab.getAttribute('aria-controls')) === 'event-detail-sample-panel' &&
    (await samplePanel.isVisible()) &&
    (await samplePanel.getByText(/appointmentId/).isVisible());
  await page.screenshot({
    path: join(outputDir, `09-events-catalog-sample-payload-light-${width}.png`),
    animations: 'disabled',
  });
  await usageTab.click();
  const usagePass =
    (await usageTab.getAttribute('aria-selected')) === 'true' &&
    (await usageTab.getAttribute('aria-controls')) === 'event-detail-usage-panel' &&
    (await usagePanel.isVisible()) &&
    (await usagePanel.getByText('Common Use Cases').isVisible());
  tabChecks.push({ route: '09-events-catalog', width, schemaPass, samplePass, usagePass, screenshots: 2 });
  if (!schemaPass || !samplePass || !usagePass) {
    issues.push({
      route: '/events/catalog',
      kind: 'tabs',
      detail: 'Event detail tab selection, panel association, or content did not activate',
    });
  }
  await page.screenshot({
    path: join(outputDir, `09-events-catalog-usage-guide-light-${width}.png`),
    animations: 'disabled',
  });
}

async function checkScheduledDeliveryTabs(page, outputDir, width) {
  const allTab = page.getByRole('tab', { name: 'All Deliveries' });
  const failuresTab = page.getByRole('tab', { name: /Failures & Overdue/ });
  const panel = page.locator('#scheduled-delivery-results-panel');
  const antTags = await page.locator('.ant-tag').count();
  const statuses = await panel.locator('.status-badge').allTextContents();
  const statusPresentationPass = antTags === 0 && statuses.includes('Pending') && statuses.includes('Failed');
  tabChecks.push({
    route: '16-scheduled',
    width,
    check: 'status-and-metadata',
    antTags,
    statuses,
    passes: statusPresentationPass,
  });
  if (!statusPresentationPass) {
    issues.push({
      route: '/scheduled',
      kind: 'presentation',
      detail: `Expected neutral event metadata and sentence-case statuses (Tags: ${antTags}; statuses: ${statuses.join(', ')})`,
    });
  }
  const initialPass =
    (await allTab.getAttribute('aria-selected')) === 'true' &&
    (await allTab.getAttribute('aria-controls')) === 'scheduled-delivery-results-panel' &&
    (await panel.isVisible());
  await failuresTab.click();
  const failurePass =
    (await failuresTab.getAttribute('aria-selected')) === 'true' &&
    (await failuresTab.getAttribute('aria-controls')) === 'scheduled-delivery-results-panel' &&
    (await panel.isVisible()) &&
    (await panel.getByText('VISIT_COMPLETED').isVisible());
  tabChecks.push({ route: '16-scheduled', width, initialPass, failurePass, screenshots: 1 });
  if (!initialPass || !failurePass) {
    issues.push({
      route: '/scheduled',
      kind: 'tabs',
      detail: 'Scheduled delivery view tabs did not activate their result panel and matching rows',
    });
  }
  await page.screenshot({ path: join(outputDir, `16-scheduled-failures-light-${width}.png`), animations: 'disabled' });
}

async function checkScheduledJobsMetadata(page) {
  const antTags = await page.locator('.ant-tag').count();
  const statuses = await page.locator('.status-badge').allTextContents();
  const hasScriptMetadata = (await page.getByText('Script job', { exact: true }).count()) > 0;
  const hasDataSource = (await page.getByText('User script', { exact: true }).count()) > 0;
  const passes = antTags === 0 && statuses.includes('Active') && hasScriptMetadata && hasDataSource;
  tabChecks.push({
    route: '17-scheduled-jobs',
    check: 'status-and-metadata',
    antTags,
    statuses,
    hasScriptMetadata,
    hasDataSource,
    passes,
  });
  if (!passes) {
    issues.push({
      route: '/scheduled-jobs',
      kind: 'presentation',
      detail: `Expected shared Active badge and neutral script metadata (Tags: ${antTags}; badges: ${statuses.join(', ')})`,
    });
  }
}

async function checkLookupGuideTabs(page, outputDir, width) {
  const overviewTab = page.getByRole('tab', { name: 'Overview' });
  const scriptsTab = page.getByRole('tab', { name: 'Using in Scripts' });
  const overviewPanel = page.locator('#lookup-guide-overview-panel');
  const scriptsPanel = page.locator('#lookup-guide-scripts-panel');
  const initialPass =
    (await overviewTab.getAttribute('aria-selected')) === 'true' &&
    (await overviewTab.getAttribute('aria-controls')) === 'lookup-guide-overview-panel' &&
    (await overviewPanel.isVisible());
  await scriptsTab.click();
  const scriptsPass =
    (await scriptsTab.getAttribute('aria-selected')) === 'true' &&
    (await scriptsTab.getAttribute('aria-controls')) === 'lookup-guide-scripts-panel' &&
    (await scriptsPanel.isVisible()) &&
    (await scriptsPanel.getByText('Basic Usage').isVisible());
  const neutralContentPass =
    (await page.locator('[role="tabpanel"] .ant-tag').count()) === 0 &&
    (await page.locator('[role="tabpanel"] .ant-alert').count()) === 0 &&
    (await overviewPanel.getByText('PASSTHROUGH').count()) > 0;
  tabChecks.push({
    route: '43-help-lookup-guide',
    width,
    initialPass,
    scriptsPass,
    neutralContentPass,
    screenshots: 1,
  });
  if (!initialPass || !scriptsPass || !neutralContentPass) {
    issues.push({
      route: '/help/lookup-guide',
      kind: 'tabs',
      detail: 'Lookup guide tabs/content failed, or instructional metadata rendered as AntD tags/alerts',
    });
  }
  await page.screenshot({
    path: join(outputDir, `43-help-lookup-guide-scripts-light-${width}.png`),
    animations: 'disabled',
  });
}

async function checkHl7DetailTabs(page, outputDir, width) {
  const sectionToggle = page.getByText('HL7 Message Details', { exact: true });
  const sectionPass = await sectionToggle.isVisible().catch(() => false);
  if (!sectionPass) {
    const requestDetailsVisible = await page
      .getByText('Request Details', { exact: true })
      .isVisible()
      .catch(() => false);
    const responseDetailsVisible = await page
      .getByText('Response Details', { exact: true })
      .isVisible()
      .catch(() => false);
    if (!requestDetailsVisible || !responseDetailsVisible) {
      issues.push({
        route: '/logs/review-log-1',
        kind: 'tabs',
        detail: 'Synthetic request/response detail sections are missing',
      });
    }
    return;
  }
  await sectionToggle.click();

  const tabList = page.getByRole('tablist', { name: 'HL7 delivery details' });
  const requestTab = tabList.getByRole('tab', { name: 'Request HL7' });
  const requestPass =
    (await requestTab.getAttribute('aria-selected')) === 'true' &&
    (await requestTab.getAttribute('aria-controls')) === 'hl7-request-panel' &&
    (await page.locator('#hl7-request-panel').getByText('MSG-DEMO-1042').isVisible());

  const requestFieldsTab = tabList.getByRole('tab', { name: /Request Fields/ });
  await requestFieldsTab.click();
  const requestFieldsPanel = page.locator('#hl7-request-fields-panel');
  await requestFieldsPanel.waitFor({ state: 'visible' });
  const fieldsPass =
    (await requestFieldsTab.getAttribute('aria-selected')) === 'true' &&
    (await requestFieldsPanel.locator('.ant-table-tbody > tr').count()) > 0;

  const ackFieldsTab = tabList.getByRole('tab', { name: /ACK Fields/ });
  await ackFieldsTab.click();
  const ackFieldsPanel = page.locator('#hl7-ack-fields-panel');
  await ackFieldsPanel.waitFor({ state: 'visible' });
  const ackPass =
    (await ackFieldsTab.getAttribute('aria-selected')) === 'true' &&
    (await ackFieldsPanel.locator('.ant-table-tbody > tr').count()) > 0;

  tabChecks.push({ route: '14-log-detail', width, sectionPass, requestPass, fieldsPass, ackPass, screenshots: 1 });
  if (!sectionPass || !requestPass || !fieldsPass || !ackPass) {
    issues.push({
      route: '/logs/review-log-1',
      kind: 'tabs',
      detail: 'HL7 request/field/ACK tabs did not show their linked content',
    });
  }
  await page.screenshot({
    path: join(outputDir, `14-log-detail-hl7-ack-fields-light-${width}.png`),
    animations: 'disabled',
  });
}

async function checkLogDetailSemantics(page, width) {
  const headerText = await page
    .locator('.page-header')
    .innerText()
    .catch(() => '');
  const rawIdentifierVisible = headerText.includes('review-log-1');
  const humanNameVisible = headerText.includes('Appointment Created to Scheduling');
  const deliveredStatusVisible = await page
    .locator('.status-badge[data-status="SUCCESS"]')
    .getByText('Delivered')
    .count();
  const httpCode = page.getByText('202', { exact: true });
  const httpCodeIsPlainText =
    (await httpCode.count()) === 1 && (await httpCode.evaluate((element) => element.tagName)) === 'CODE';
  const tagCount = await page.locator('.ant-tag').count();
  const passes =
    humanNameVisible && !rawIdentifierVisible && deliveredStatusVisible > 0 && httpCodeIsPlainText && tagCount === 0;
  tabChecks.push({
    route: '14-log-detail',
    width,
    check: 'breadcrumb-and-status-semantics',
    humanNameVisible,
    rawIdentifierVisible,
    deliveredStatusVisible,
    httpCodeIsPlainText,
    tagCount,
    passes,
  });
  if (!passes) {
    issues.push({
      route: '/logs/review-log-1',
      kind: 'log-detail-semantics',
      detail: JSON.stringify({
        humanNameVisible,
        rawIdentifierVisible,
        deliveredStatusVisible,
        httpCodeIsPlainText,
        tagCount,
      }),
    });
  }
}

async function checkDeliveryLogSemantics(page) {
  const table = page.locator('.logs-table-wrapper');
  const rowCount = await table.locator('.ant-table-tbody > tr.ant-table-row').count();
  const tagCount = await page.locator('.ant-tag').count();
  const deliveredStatus = await table.locator('.status-badge[data-status="SUCCESS"]').getByText('Delivered').count();
  const httpCode = table.locator('tbody code').filter({ hasText: /^202$/ });
  const httpCodeIsPlain = (await httpCode.count()) === 1;
  const summaryCounts = Object.fromEntries(
    (await page.locator('.logs-summary-strip .stat-pill').evaluateAll((pills) =>
      pills
        .map((pill) => {
          const match = pill.getAttribute('aria-label')?.match(/^Filter by (.+?): ([\d,]+)/);
          return match ? [match[1], Number(match[2].replace(/,/g, ''))] : null;
        })
        .filter(Boolean)
    ))
  );
  const summaryCountsMatchFixture =
    summaryCounts.Total === 2 &&
    summaryCounts.Delivered === 1 &&
    summaryCounts.Failed === 1 &&
    summaryCounts.Skipped === 0 &&
    summaryCounts.Pending === 0;
  const passes = rowCount === 2 && tagCount === 0 && deliveredStatus > 0 && httpCodeIsPlain && summaryCountsMatchFixture;
  tabChecks.push({
    route: '13-logs',
    check: 'delivery-log-status-and-diagnostic-semantics',
    rowCount,
    tagCount,
    deliveredStatus,
    httpCodeIsPlain,
    summaryCounts,
    summaryCountsMatchFixture,
    passes,
  });
  if (!passes) {
    issues.push({
      route: '/logs',
      kind: 'delivery-log-semantics',
      detail: JSON.stringify({ rowCount, tagCount, deliveredStatus, httpCodeIsPlain, summaryCounts, summaryCountsMatchFixture }),
    });
  }

  const reviewRow = page.locator('.ant-table-tbody > tr.ant-table-row').filter({ hasText: 'Visit Completed to Analytics' });
  await reviewRow.click();
  const drawer = page.locator('.ant-drawer').last();
  const timelineTab = drawer.getByRole('tab', { name: 'Timeline' });
  await timelineTab.waitFor({ state: 'visible' });
  await timelineTab.click();
  const panelId = await timelineTab.getAttribute('aria-controls');
  const timelinePanel = page.locator(`#${panelId}`);
  await timelinePanel.getByRole('button', { name: 'Copy trace ID' }).waitFor({ state: 'visible' });
  const completed = await timelinePanel.getByText('Completed', { exact: true }).count();
  const failed = await timelinePanel.getByText('Failed', { exact: true }).count();
  const antTags = await timelinePanel.locator('.ant-tag').count();
  const antTypography = await timelinePanel.locator('.ant-typography').count();
  const timelinePasses = completed > 0 && failed === 1 && antTags === 0 && antTypography === 0;
  tabChecks.push({ route: '13-logs', check: 'trace-timeline-status-presentation', completed, failed, antTags, antTypography, passes: timelinePasses });
  if (!timelinePasses) {
    issues.push({
      route: '/logs',
      kind: 'trace-timeline-presentation',
      detail: JSON.stringify({ completed, failed, antTags, antTypography }),
    });
  }
  await page.screenshot({ path: join(outputDir, '13-logs-trace-timeline-light-1440.png'), animations: 'disabled' });
  await page.keyboard.press('Escape');
  await drawer.waitFor({ state: 'hidden' });
}

async function checkEventSourceMetadata(page) {
  await page.getByText('Configure Event Source', { exact: true }).waitFor({ state: 'visible' });
  const tagCount = await page.locator('.ant-tag').count();
  const statusBadges = await page.locator('.page-header .status-badge').count();
  const sourceTypeVisible = (await page.getByText('HTTP Push', { exact: true }).count()) > 0;
  const pollIntervalVisible = (await page.getByText('Poll Interval (ms)', { exact: true }).count()) > 0;
  const batchSizeVisible = (await page.getByText('Batch Size', { exact: true }).count()) > 0;
  const passes = tagCount === 0 && statusBadges === 1 && sourceTypeVisible && pollIntervalVisible && batchSizeVisible;
  tabChecks.push({
    route: '27-settings-event-source',
    check: 'configuration-metadata-semantics',
    tagCount,
    statusBadges,
    sourceTypeVisible,
    pollIntervalVisible,
    batchSizeVisible,
    passes,
  });
  if (!passes) {
    issues.push({
      route: '/settings/event-source',
      kind: 'event-source-metadata',
      detail: JSON.stringify({ tagCount, statusBadges, sourceTypeVisible, pollIntervalVisible, batchSizeVisible }),
    });
  }
}

async function checkSettingsMetadata(page, outputDir) {
  const workspace = page.locator('.organization-settings-workspace');
  const eventProcessingHeader = workspace
    .locator('.ant-collapse-header')
    .filter({ hasText: 'Event Processing' })
    .first();
  await eventProcessingHeader.waitFor({ state: 'visible' });
  const headerTags = await eventProcessingHeader.locator('.ant-tag').count();
  const advancedLabelVisible = await eventProcessingHeader.getByText('Advanced', { exact: true }).isVisible();
  if ((await eventProcessingHeader.getAttribute('aria-expanded')) !== 'true') {
    await eventProcessingHeader.click();
  }
  const eventProcessing = workspace.locator('.ant-collapse-item').filter({ hasText: 'Event Processing' }).first();
  const panel = eventProcessing.locator('.ant-collapse-content');
  await panel.waitFor({ state: 'visible' });
  await page.waitForTimeout(300);
  const panelExpanded = (await eventProcessingHeader.getAttribute('aria-expanded')) === 'true';
  await eventProcessing.screenshot({ path: join(outputDir, '26-settings-event-processing-light-1440.png') });
  const legacyAlerts = await eventProcessing.locator('.ant-alert').count();
  const passes = headerTags === 0 && legacyAlerts === 0 && advancedLabelVisible && panelExpanded;
  tabChecks.push({
    route: '26-settings',
    check: 'settings-metadata-and-guidance',
    headerTags,
    legacyAlerts,
    advancedLabelVisible,
    panelExpanded,
    passes,
  });
  if (!passes) {
    issues.push({
      route: '/settings',
      kind: 'settings-component-consistency',
      detail: JSON.stringify({ headerTags, legacyAlerts, advancedLabelVisible, panelExpanded }),
    });
  }
}

async function checkBulkOperations(page, outputDir) {
  const workspace = page.locator('.bulk-operations-template');
  const rows = workspace.locator('.ant-table-tbody > tr.ant-table-row');
  await rows.first().waitFor({ state: 'visible' });
  const operationTags = await workspace.locator('.ant-tag').count();
  const operationAlerts = await workspace.locator('.ant-alert').count();
  const operationStatuses = await workspace.locator('.status-badge').count();
  const operationPass = operationTags === 0 && operationAlerts === 0 && operationStatuses > 0;
  tabChecks.push({
    route: '24-bulk',
    check: 'bulk-table-semantics',
    operationTags,
    operationAlerts,
    operationStatuses,
    passes: operationPass,
  });
  if (!operationPass) {
    issues.push({
      route: '/bulk',
      kind: 'bulk-table-semantics',
      detail: JSON.stringify({ operationTags, operationAlerts, operationStatuses }),
    });
  }

  const importTab = page.getByRole('tab', { name: 'Import / export' });
  await importTab.click();
  const importPanel = page.locator('#bulk-import-panel');
  const importVisible = await importPanel.getByRole('heading', { name: 'Import configurations' }).isVisible();
  const importAlerts = await importPanel.locator('.ant-alert').count();
  const importPass = importVisible && importAlerts === 0;
  tabChecks.push({ route: '24-bulk', check: 'import-guidance', importVisible, importAlerts, passes: importPass });
  if (!importPass) {
    issues.push({
      route: '/bulk',
      kind: 'bulk-import-guidance',
      detail: JSON.stringify({ importVisible, importAlerts }),
    });
  }
  await page.screenshot({ path: join(outputDir, '24-bulk-import-light-1440.png'), animations: 'disabled' });

  await page.getByRole('tab', { name: 'Bulk changes' }).click();
  await rows.first().locator('.ant-checkbox').click();
  await workspace.getByRole('button', { name: 'Delete', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const deleteWarning = await dialog.getByText('Deletion cannot be undone', { exact: true }).isVisible();
  const deleteAlerts = await dialog.locator('.ant-alert').count();
  const deletePass = deleteWarning && deleteAlerts === 0;
  tabChecks.push({
    route: '24-bulk',
    check: 'delete-confirmation-warning',
    deleteWarning,
    deleteAlerts,
    passes: deletePass,
  });
  if (!deletePass) {
    issues.push({
      route: '/bulk',
      kind: 'bulk-delete-warning',
      detail: JSON.stringify({ deleteWarning, deleteAlerts }),
    });
  }
  await page.waitForTimeout(300);
  await dialog.screenshot({
    path: join(outputDir, '24-bulk-delete-confirmation-light-1440.png'),
    animations: 'disabled',
  });
  await page.keyboard.press('Escape');
}

async function checkDeliverySteps(page, outputDir) {
  const editButton = page.getByRole('button', { name: 'Edit Integration' });
  if (await editButton.count()) await editButton.click();
  const stepsLayout = page.locator('.ant-radio-button-wrapper').filter({ hasText: 'Steps' });
  await stepsLayout.click();
  const deliveryTab = page.getByRole('tab', { name: 'Delivery (1 step)', exact: true });
  await deliveryTab.waitFor({ state: 'visible' });
  await deliveryTab.click();
  const step = page.getByTestId('delivery-step-validate-request');
  await step.waitFor({ state: 'visible' });
  const stepTags = await step.locator('.ant-tag').count();
  const runnerVisible = await step.getByText('Script', { exact: true }).isVisible();
  const effectVisible = await step.getByText('Decides', { exact: true }).isVisible();
  const stepAlerts = await page.locator('.ant-alert').count();
  const passes = stepTags === 0 && runnerVisible && effectVisible && stepAlerts === 0;
  tabChecks.push({
    route: '03-integration-detail',
    check: 'delivery-step-metadata',
    stepTags,
    runnerVisible,
    effectVisible,
    stepAlerts,
    passes,
  });
  if (!passes) {
    issues.push({
      route: '/integrations/review-outbound',
      kind: 'delivery-step-metadata',
      detail: JSON.stringify({ stepTags, runnerVisible, effectVisible, stepAlerts }),
    });
  }
  await page.screenshot({
    path: join(outputDir, '03-integration-detail-steps-light-1440.png'),
    animations: 'disabled',
  });
}

async function checkFollowUpTestResult(page, outputDir) {
  await page.getByRole('tab', { name: 'Delivery follow-up', exact: true }).click();
  await page.getByText('Test the script', { exact: true }).click();
  await page.getByRole('button', { name: /Run test/ }).click();
  const result = page.locator('.ant-collapse-content-active').filter({ hasText: 'The script answered' });
  await result.waitFor({ state: 'visible' });
  const statusVisible = await result.getByText('Delivered', { exact: true }).isVisible();
  const statusBadges = await result.locator('.status-badge').count();
  const antTags = await result.locator('.ant-tag').count();
  const antAlerts = await result.locator('.ant-alert').count();
  const passes = statusVisible && statusBadges === 1 && antTags === 0 && antAlerts === 0;
  tabChecks.push({
    route: '03-integration-detail',
    check: 'follow-up-test-result',
    statusVisible,
    statusBadges,
    antTags,
    antAlerts,
    passes,
  });
  if (!passes) {
    issues.push({
      route: '/integrations/review-outbound',
      kind: 'follow-up-test-result',
      detail: JSON.stringify({ statusVisible, statusBadges, antTags, antAlerts }),
    });
  }
  await page.screenshot({
    path: join(outputDir, '03-integration-detail-follow-up-test-light-1440.png'),
    animations: 'disabled',
  });
}

async function checkTemplateMetadata(page, width) {
  const cards = page.locator('.template-card');
  const quickSetup = page.locator('section[aria-labelledby="quick-setup-heading"]');
  const cardCount = await cards.count();
  const tagCount = await cards.locator('.ant-tag').count();
  const quickSetupTagCount = await quickSetup.locator('.ant-tag').count();
  const inboundDirectionVisible = await quickSetup.locator('.status-badge').getByText('Inbound').count();
  const outboundDirectionVisible = await quickSetup.locator('.status-badge').getByText('Outbound').count();
  const categoryVisible = await cards.getByText('Messaging', { exact: true }).count();
  const activeLabelVisible = await cards.getByText('Active', { exact: true }).count();
  const vendorIsPlainMetadata = (await cards.getByText('Northstar Messaging', { exact: true }).count()) > 0;
  const countIsInFilterRow = await page
    .locator('.filter-bar')
    .getByText(/of \d+ templates/)
    .count();
  const titleHasNoMetadataChips = (await page.locator('.page-header .status-badge').count()) === 0;
  const passes =
    cardCount > 0 &&
    tagCount === 0 &&
    quickSetupTagCount === 0 &&
    inboundDirectionVisible > 0 &&
    outboundDirectionVisible > 0 &&
    categoryVisible > 0 &&
    activeLabelVisible > 0 &&
    vendorIsPlainMetadata &&
    countIsInFilterRow > 0 &&
    titleHasNoMetadataChips;
  tabChecks.push({
    route: '21-templates',
    width,
    check: 'template-metadata-hierarchy',
    cardCount,
    tagCount,
    quickSetupTagCount,
    inboundDirectionVisible,
    outboundDirectionVisible,
    categoryVisible,
    activeLabelVisible,
    vendorIsPlainMetadata,
    countIsInFilterRow,
    titleHasNoMetadataChips,
    passes,
  });
  if (!passes) {
    issues.push({
      route: '/templates',
      kind: 'template-metadata-hierarchy',
      detail: JSON.stringify({
        cardCount,
        tagCount,
        quickSetupTagCount,
        inboundDirectionVisible,
        outboundDirectionVisible,
        categoryVisible,
        activeLabelVisible,
        vendorIsPlainMetadata,
        countIsInFilterRow,
        titleHasNoMetadataChips,
      }),
    });
  }
}

async function checkScheduledJobDetailTabs(page, outputDir, width) {
  const tabList = page.getByRole('tablist', { name: 'Scheduled job configuration' });
  const expected = ['Basic Info', 'Schedule', 'Script', 'Review & Submit', 'Execution History'];
  const visitedPanels = new Set();
  let passed = true;
  for (const label of expected) {
    const tab = tabList.getByRole('tab', { name: label });
    const panelId = await tab.getAttribute('aria-controls');
    await tab.click();
    const panel = page.locator(`#${panelId}`);
    const active = (await tab.getAttribute('aria-selected')) === 'true';
    const associated = !!panelId && (await panel.getAttribute('aria-labelledby')) === (await tab.getAttribute('id'));
    const visible = await panel.isVisible();
    passed = passed && active && associated && visible;
    if (panelId && visible) visitedPanels.add(panelId);
  }
  const retained = await Promise.all([...visitedPanels].map((panelId) => page.locator(`#${panelId}`).count()));
  const wraps =
    width === 390
      ? await page
          .locator('.retained-tab-list--wrap > .astryx-tab-strip')
          .evaluate((element) => getComputedStyle(element).flexWrap === 'wrap')
      : true;
  passed = passed && retained.every((count) => count === 1) && wraps;
  tabChecks.push({
    route: '18-scheduled-job-detail',
    width,
    checkedTabs: expected.length,
    retainedPanels: visitedPanels.size,
    wraps,
    passed,
  });
  if (!passed) {
    issues.push({
      route: '/scheduled-jobs/review-job',
      kind: 'tabs',
      detail: `Scheduled job tabs or panels failed at ${width}px`,
    });
  }
  await page.screenshot({
    path: join(outputDir, `18-scheduled-job-detail-history-${width}.png`),
    animations: 'disabled',
  });
}

async function checkIntegrationSectionTabs(page, outputDir, width) {
  await page.getByRole('button', { name: 'Edit Integration' }).click();
  const tabList = page.getByRole('tablist', { name: 'Integration configuration sections' });
  await tabList.waitFor({ state: 'visible' });
  const tabs = tabList.getByRole('tab');
  const tabCount = await tabs.count();
  const visitedPanelIds = new Set();
  let checkedTabs = 0;
  let passed = true;

  for (let index = 0; index < tabCount; index += 1) {
    const tab = tabs.nth(index);
    const disabled = (await tab.getAttribute('aria-disabled')) === 'true';
    if (disabled) continue;
    const panelId = await tab.getAttribute('aria-controls');
    if (!panelId) {
      passed = false;
      issues.push({
        route: '/integrations/review-outbound',
        kind: 'tabs',
        detail: 'A configuration tab has no aria-controls panel reference',
      });
      continue;
    }
    await tab.click();
    const panel = page.locator(`#${panelId}`);
    const visible = await panel.isVisible();
    const labelledBy = await panel.getAttribute('aria-labelledby');
    const selected = (await tab.getAttribute('aria-selected')) === 'true';
    if (!visible || labelledBy !== (await tab.getAttribute('id')) || !selected) passed = false;
    if (visitedPanelIds.size > 0) {
      const retainedPanels = await Promise.all([...visitedPanelIds].map((id) => page.locator(`#${id}`).count()));
      if (retainedPanels.some((count) => count !== 1)) passed = false;
    }
    visitedPanelIds.add(panelId);
    checkedTabs += 1;
  }

  const passes = passed && checkedTabs >= 5;
  tabChecks.push({
    route: '03-integration-detail',
    width,
    checkedTabs,
    retainedPanelCount: visitedPanelIds.size,
    passes,
  });
  if (!passes) {
    issues.push({
      route: '/integrations/review-outbound',
      kind: 'tabs',
      detail: `Integration tab navigation or panel association failed at ${width}px (${checkedTabs} tabs checked)`,
    });
  }
  await page.screenshot({
    path: join(outputDir, `03-integration-detail-edit-tabs-${width}.png`),
    animations: 'disabled',
  });
}

async function checkInboundIntegrationTabs(page, outputDir, width) {
  const tabList = page.getByRole('tablist', { name: 'Inbound integration configuration' });
  await tabList.waitFor({ state: 'visible' });
  const tabs = tabList.getByRole('tab');
  const tabCount = await tabs.count();
  const visitedPanels = new Set();
  let passed = tabCount === 7;
  let reviewMetadataTags = null;
  let reviewMetadataPass = true;
  let antAlertCount = 0;

  for (let index = 0; index < tabCount; index += 1) {
    const tab = tabs.nth(index);
    if ((await tab.getAttribute('aria-disabled')) === 'true') {
      passed = false;
      continue;
    }
    const panelId = await tab.getAttribute('aria-controls');
    if (!panelId) {
      passed = false;
      continue;
    }
    await tab.click();
    const panel = page.locator(`#${panelId}`);
    await panel.waitFor({ state: 'visible' });
    antAlertCount = Math.max(antAlertCount, await page.locator('.ant-alert').count());
    const associated = (await panel.getAttribute('aria-labelledby')) === (await tab.getAttribute('id'));
    const selected = (await tab.getAttribute('aria-selected')) === 'true';
    if (!associated || !selected || !(await panel.isVisible())) passed = false;
    if ((await tab.innerText()).includes('Review & Submit')) {
      reviewMetadataTags = await panel.locator('.ant-tag').count();
      const summaryText = await panel.innerText();
      reviewMetadataPass =
        reviewMetadataTags === 0 &&
        summaryText.includes('Target API Configuration') &&
        summaryText.includes('HTTP Method:') &&
        summaryText.includes('Transformations');
      if (!reviewMetadataPass) {
        issues.push({
          route: '/inbound-integrations/review-inbound',
          kind: 'review-summary-metadata',
          detail: `Review metadata tags=${reviewMetadataTags}; required summary fields present: ${summaryText.includes('Target API Configuration') && summaryText.includes('HTTP Method:') && summaryText.includes('Transformations')}`,
        });
      }
    }
    visitedPanels.add(panelId);
    await page.screenshot({
      path: join(outputDir, `05-inbound-detail-${String(index + 1).padStart(2, '0')}-${width}.png`),
      animations: 'disabled',
    });
  }

  if (reviewMetadataTags === null) reviewMetadataPass = false;
  let retained = true;
  for (const id of visitedPanels) {
    if ((await page.locator(`#${id}`).count()) !== 1) retained = false;
  }
  const wraps = await tabList.evaluate((strip) => getComputedStyle(strip).flexWrap === 'wrap');
  passed = passed && retained && wraps && reviewMetadataPass && antAlertCount === 0;
  tabChecks.push({
    route: '05-inbound-detail',
    width,
    checkedTabs: tabCount,
    retainedPanels: visitedPanels.size,
    reviewMetadataTags,
    reviewMetadataPass,
    antAlertCount,
    wraps,
    screenshots: tabCount,
    passed,
  });
  if (!passed) {
    issues.push({
      route: '/inbound-integrations/review-inbound',
      kind: 'tabs',
      detail: `Inbound configuration tabs, panels, or alert migration failed at ${width}px (AntD alerts: ${antAlertCount})`,
    });
  }
}

async function checkAdminFixtureContent(page, route, width) {
  const expectedContent = {
    '31-admin-users': 'alex.morgan@example.test',
    '32-admin-orgs': 'Northstar Health Network',
    '33-admin-roles': 'Platform Administrator',
    '34-admin-api-keys': 'Nightly report job',
    '35-admin-permissions': 'Permission matrix',
  }[route];
  const bodyText = await page.locator('body').innerText();
  const passes =
    Boolean(expectedContent && bodyText.includes(expectedContent)) &&
    !/admin access only|access denied/i.test(bodyText);
  tabChecks.push({ route, width, adminFixtureContent: expectedContent, passes });
  if (!passes) {
    issues.push({
      route: `/${route}`,
      kind: 'admin-fixture',
      detail: `Expected populated admin content (${expectedContent || 'route not recognized'}) and no access-denied placeholder`,
    });
  }
}

async function checkSystemStatusTabs(page, outputDir, width) {
  const tabList = page.getByRole('tablist', { name: 'System status sections' });
  await tabList.waitFor({ state: 'visible' });
  const tabs = tabList.getByRole('tab');
  const overviewPanel = page.locator('#system-status-overview-panel');
  const overviewMetricCount = await overviewPanel.locator('.ant-statistic').count();
  const headerChipCount = await page.locator('.page-header .ant-tag').count();
  const metricRects = await overviewPanel
    .locator('.ant-row')
    .first()
    .locator('.ant-col')
    .evaluateAll((columns) =>
      columns.map((column) => {
        const rect = column.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width };
      })
    );
  const mobileKpisUseTwoColumns =
    width > 575 ||
    (metricRects.length >= 4 &&
      Math.abs(metricRects[0].y - metricRects[1].y) < 2 &&
      metricRects[2].y > metricRects[0].y &&
      metricRects[0].x < metricRects[1].x);
  const expectedCount = 6;
  const visited = new Set();
  let passed =
    (await tabs.count()) === expectedCount &&
    overviewMetricCount <= 4 &&
    headerChipCount === 0 &&
    mobileKpisUseTwoColumns;
  if (overviewMetricCount > 4 || headerChipCount > 0 || !mobileKpisUseTwoColumns) {
    issues.push({
      route: '/admin/system-status',
      kind: 'summary-density',
      detail: JSON.stringify({ overviewMetricCount, headerChipCount, mobileKpisUseTwoColumns, metricRects }),
    });
  }

  for (let index = 0; index < expectedCount; index += 1) {
    const tab = tabs.nth(index);
    const panelId = await tab.getAttribute('aria-controls');
    if (!panelId) {
      passed = false;
      continue;
    }
    await tab.click();
    const tabId = await tab.getAttribute('id');
    await page.waitForFunction(
      ({ selectedTabId, selectedPanelId }) => {
        const selectedElement = selectedTabId ? document.getElementById(selectedTabId) : null;
        const selectedPanel = document.getElementById(selectedPanelId);
        return selectedElement?.getAttribute('aria-selected') === 'true' && selectedPanel && !selectedPanel.hidden;
      },
      { selectedTabId: tabId, selectedPanelId: panelId }
    );
    const panel = page.locator(`#${panelId}`);
    const selected = (await tab.getAttribute('aria-selected')) === 'true';
    const visible = await panel.isVisible();
    const labelledBy = await panel.getAttribute('aria-labelledby');
    if (!selected || !visible || labelledBy !== (await tab.getAttribute('id'))) passed = false;
    if (new URL(page.url()).searchParams.get('tab') !== (await tab.getAttribute('data-tab-value'))) passed = false;
    for (const priorPanelId of visited) {
      if ((await page.locator(`#${priorPanelId}`).count()) !== 1) passed = false;
    }
    visited.add(panelId);
  }

  const passes = passed && visited.size === expectedCount;
  tabChecks.push({
    route: '40-admin-system-status',
    width,
    checkedTabs: visited.size,
    overviewMetricCount,
    headerChipCount,
    mobileKpisUseTwoColumns,
    urlBacked: true,
    passes,
  });
  if (!passes) {
    issues.push({
      route: '/admin/system-status',
      kind: 'tabs',
      detail: `System Status tabs, panels, or URL selection failed at ${width}px`,
    });
  }
  await page.screenshot({
    path: join(outputDir, `40-admin-system-status-tabs-${width}.png`),
    animations: 'disabled',
  });
}

async function checkDashboardTrend(page, width) {
  const chart = page.locator('.dashboard-chart-card').first();
  await chart.waitFor({ state: 'visible' });
  const kpiRects = await page.locator('.dashboard-kpis .dashboard-metric-tile').evaluateAll((tiles) =>
    tiles.map((tile) => {
      const rect = tile.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width };
    })
  );
  const kpiContainer = await page.locator('.dashboard-kpis').evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, width: rect.width };
  });
  const mobileKpisUseTwoColumns =
    width > 720 ||
    (kpiRects.length >= 4 &&
      Math.abs(kpiRects[0].y - kpiRects[1].y) < 2 &&
      kpiRects[2].y > kpiRects[0].y &&
      kpiRects[0].x < kpiRects[1].x);
  const mobileOddLastKpiCentered =
    width > 720 ||
    kpiRects.length % 2 === 0 ||
    Math.abs(
      kpiRects[kpiRects.length - 1].x +
        kpiRects[kpiRects.length - 1].width / 2 -
        (kpiContainer.x + kpiContainer.width / 2)
    ) < 2;
  const labels = (await chart.locator('.recharts-xAxis .recharts-cartesian-axis-tick-value').allTextContents())
    .map((label) => label.trim())
    .filter(Boolean);
  const bars = await chart.locator('svg.recharts-surface path.recharts-rectangle').evaluateAll((segments) =>
    segments.map((segment) => {
      const bounds = segment.getBBox();
      return { x: bounds.x, width: bounds.width, height: bounds.height, fill: segment.getAttribute('fill') };
    })
  );
  const uniqueDays = new Set(labels).size === labels.length;
  const barsByDay = new Map();
  for (const bar of bars) {
    const key = bar.x.toFixed(1);
    barsByDay.set(key, (barsByDay.get(key) || 0) + 1);
  }
  const alignedStack =
    bars.length >= labels.length &&
    barsByDay.size === labels.length &&
    [...barsByDay.values()].every((segmentCount) => segmentCount > 0);
  const visibleSegments = bars.length >= 3 && bars.every(({ width: barWidth, height }) => barWidth > 0 && height > 0);
  const passes = uniqueDays && alignedStack && visibleSegments && mobileKpisUseTwoColumns && mobileOddLastKpiCentered;
  tabChecks.push({
    route: '01-dashboard',
    width,
    uniqueDays,
    alignedStack,
    visibleSegments,
    mobileKpisUseTwoColumns,
    mobileOddLastKpiCentered,
    kpiRects,
    labels,
    bars,
    passes,
  });
  if (!passes) {
    issues.push({
      route: '/dashboard',
      kind: 'delivery-trend-chart',
      detail: JSON.stringify({
        uniqueDays,
        alignedStack,
        visibleSegments,
        mobileKpisUseTwoColumns,
        mobileOddLastKpiCentered,
        kpiRects,
        labels,
        bars,
      }),
    });
  }

  const outboundTab = page.locator('#dashboard-tab-outbound');
  await outboundTab.click();
  const outboundPanel = page.locator('#dashboard-panel-outbound');
  await outboundPanel.waitFor({ state: 'visible' });
  await outboundPanel.getByText('Event Type Performance').waitFor({ state: 'visible' });
  const remainingStatusChips = await outboundPanel.locator('.ant-tag').count();
  const outboundTabPasses = remainingStatusChips === 0;
  tabChecks.push({ route: '01-dashboard', width, tab: 'Outbound', remainingStatusChips, passes: outboundTabPasses });
  if (!outboundTabPasses) {
    issues.push({
      route: '/dashboard',
      kind: 'outbound-metric-chips',
      detail: `${remainingStatusChips} non-status chips remain in the Outbound dashboard tab`,
    });
  }
  await page.screenshot({ path: join(outputDir, `01-dashboard-outbound-light-${width}.png`), animations: 'disabled' });

  if (width > 720) {
    for (const { key, title, expectedStatus } of [
      { key: 'errors', title: 'Top Errors' },
      { key: 'logs', title: 'Recent Failures', expectedStatus: 'FAILED' },
      { key: 'inbound', title: 'Performance by Endpoint' },
      { key: 'scheduled', title: 'Job Health Status' },
    ]) {
      const tab = page.locator(`#dashboard-tab-${key}`);
      await tab.click();
      await page.waitForFunction(
        (tabId) => document.getElementById(tabId)?.getAttribute('aria-selected') === 'true',
        `dashboard-tab-${key}`
      );
      const panel = page.locator(`#dashboard-panel-${key}`);
      await panel.waitFor({ state: 'visible' });
      await panel.getByText(title, { exact: true }).waitFor({ state: 'visible' });
      await page.waitForTimeout(750);
      const remainingTags = await panel.locator('.ant-tag').count();
      const statusCount = expectedStatus
        ? await panel.locator(`.status-badge[data-status="${expectedStatus}"]`).count()
        : null;
      const passes = remainingTags === 0 && (expectedStatus === undefined || (statusCount || 0) > 0);
      tabChecks.push({ route: '01-dashboard', width, tab: key, remainingTags, statusCount, passes });
      if (!passes) {
        issues.push({
          route: '/dashboard',
          kind: `${key}-status-vocabulary`,
          detail: `${remainingTags} AntD tags remain; expected status count: ${expectedStatus ? statusCount : 'none'}`,
        });
      }
      await page.screenshot({
        path: join(outputDir, `01-dashboard-${key}-light-${width}.png`),
        animations: 'disabled',
      });
      if (key === 'scheduled') {
        const tableWrapper = panel.locator('.modern-table-wrapper').first();
        const tableBounds = await tableWrapper.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return { left: rect.left, right: rect.right };
        });
        const headers = await tableWrapper.locator('.ant-table-thead th').evaluateAll((cells) =>
          cells
            .filter((cell) => !cell.classList.contains('ant-table-selection-column'))
            .map((cell) => {
              const rect = cell.getBoundingClientRect();
              return { x: rect.x, right: rect.right };
            })
            .sort((a, b) => a.x - b.x)
        );
        const headersDoNotOverlap = headers.every(
          (header, index) => index === 0 || header.x >= headers[index - 1].right - 1
        );
        const headersFit =
          headers.length > 0 &&
          headers[0].x >= tableBounds.left - 1 &&
          headers[headers.length - 1].right <= tableBounds.right + 1;
        tabChecks.push({
          route: '01-dashboard',
          width,
          tab: key,
          headersDoNotOverlap,
          headersFit,
          headerCount: headers.length,
        });
        if (!headersDoNotOverlap || !headersFit) {
          issues.push({
            route: '/dashboard',
            kind: 'scheduled-table-header-layout',
            detail: JSON.stringify({ headersDoNotOverlap, headersFit, tableBounds, headers }),
          });
        }
      }
    }
  }

  const deliveriesTab = page.locator('#dashboard-tab-deliveries');
  await deliveriesTab.click();
  await page.waitForFunction(
    () => document.getElementById('dashboard-tab-deliveries')?.getAttribute('aria-selected') === 'true'
  );
  const deliveriesPanel = page.locator('#dashboard-panel-deliveries');
  await deliveriesPanel.getByText('Appointment Created to Scheduling', { exact: true }).first().waitFor({
    state: 'visible',
  });
  await page.waitForTimeout(750);
  const deliveriesTags = await deliveriesPanel.locator('.ant-tag').count();
  const deliveriesHasPerformance = await deliveriesPanel.getByText('Total Requests', { exact: true }).count();
  const performanceHeader = await deliveriesPanel.locator('.ant-card-head-title').first().boundingBox();
  const deliveryHeaderFits =
    width > 720 || Boolean(performanceHeader && performanceHeader.width > 200 && performanceHeader.height < 80);
  const deliveriesPasses = deliveriesTags === 0 && deliveriesHasPerformance > 0 && deliveryHeaderFits;
  tabChecks.push({
    route: '01-dashboard',
    width,
    tab: 'Deliveries',
    deliveriesTags,
    deliveriesHasPerformance,
    deliveryHeaderFits,
    performanceHeader,
    passes: deliveriesPasses,
    screenshots: 1,
  });
  if (!deliveriesPasses) {
    issues.push({
      route: '/dashboard',
      kind: 'delivery-metric-chips',
      detail: `${deliveriesTags} AntD Tags remain; performance table present: ${deliveriesHasPerformance > 0}; mobile header fits: ${deliveryHeaderFits}`,
    });
  }
  await deliveriesPanel.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: join(outputDir, `01-dashboard-deliveries-light-${width}.png`),
    animations: 'disabled',
  });
}

async function checkTraceViewerTabs(page, outputDir, width) {
  const dlqRow = page.locator('.dlq-table-section .ant-table-tbody > tr.ant-table-row').first();
  await dlqRow.waitFor({ state: 'visible' });
  const noLegacyChips = (await page.locator('.dlq-table-section .ant-tag, .dlq-table-section .ant-alert').count()) === 0;
  const confirmationPage = await page.context().newPage();
  await confirmationPage.goto(page.url(), { waitUntil: 'domcontentloaded' });
  const confirmationRow = confirmationPage.locator('.dlq-table-section .ant-table-tbody > tr.ant-table-row').first();
  await confirmationRow.waitFor({ state: 'visible' });
  await confirmationRow.getByRole('button', { name: /More actions for/ }).waitFor({ state: 'visible' });
  const actionButtons = confirmationRow.locator('.dlq-row-actions button');
  const actionButtonCount = await actionButtons.count();
  const compactActions = actionButtonCount === 2;
  const moreActions = confirmationRow.getByRole('button', { name: /More actions for/ });
  await moreActions.click();
  const actionMenu = confirmationPage.getByRole('menu');
  const menuActions = ['Retry', 'Abandon', 'Delete'];
  const menuText = await actionMenu.innerText();
  const menuActionsVisible = menuActions.every((label) => menuText.includes(label));
  await actionMenu.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  const deleteConfirmation = confirmationPage.locator('.ant-modal').filter({ hasText: 'Delete this entry?' });
  await deleteConfirmation.waitFor({ state: 'visible' });
  await confirmationPage.waitForTimeout(350);
  const deleteConfirmationVisible = await deleteConfirmation.getByText('Delete this entry?', { exact: true }).first().isVisible();
  const confirmationBounds = await deleteConfirmation.boundingBox();
  const confirmationFits = !!confirmationBounds && confirmationBounds.width > 0 && confirmationBounds.height > 0 &&
    confirmationBounds.x >= 0 && confirmationBounds.y >= 0 && confirmationBounds.x + confirmationBounds.width <= width + 1;
  if (deleteConfirmationVisible) {
    await confirmationPage.screenshot({ path: join(outputDir, `15-dlq-delete-confirmation-${width}.png`), animations: 'disabled' });
  }
  await confirmationPage.close();
  if (!compactActions || !menuActionsVisible || !deleteConfirmationVisible || !confirmationFits || !noLegacyChips) {
    issues.push({
      route: '/dlq',
      kind: 'row-actions',
      detail: JSON.stringify({ actionButtonCount, compactActions, menuActionsVisible, deleteConfirmationVisible, confirmationFits, confirmationBounds, noLegacyChips }),
    });
  }
  await dlqRow.getByRole('button', { name: /View details for/ }).click();
  const detailsDrawer = page.locator('.ant-drawer').filter({ hasText: 'DLQ Entry Details' });
  await detailsDrawer.waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'View Trace' }).click();
  const traceDialog = page.locator('.ant-modal').filter({ hasText: 'Execution Trace Viewer' });
  await traceDialog.waitFor({ state: 'visible' });
  const tabList = traceDialog.getByRole('tablist', { name: 'Trace request and response details' });
  const neutralDiagnostics =
    (await traceDialog.locator('.ant-tag').count()) === 0 &&
    (await traceDialog.locator('.ant-alert').count()) === 0 &&
    (await traceDialog.getByText('Delivered').count()) > 0;
  const tabs = tabList.getByRole('tab');
  const expectedLabels = ['Request', 'Response', 'Error Details', 'Vendor Responses'];
  let passed = (await tabs.count()) === expectedLabels.length;
  const visitedPanels = new Set();
  const failedPanels = [];

  for (const label of expectedLabels) {
    const tab = tabList.getByRole('tab', { name: label, exact: true });
    const panelId = await tab.getAttribute('aria-controls');
    const tabId = await tab.getAttribute('id');
    if (!panelId || !tabId) {
      passed = false;
      continue;
    }
    await tab.click();
    await page.waitForFunction(
      ({ selectedTabId, selectedPanelId }) => {
        const selectedElement = document.getElementById(selectedTabId);
        const selectedPanel = document.getElementById(selectedPanelId);
        return selectedElement?.getAttribute('aria-selected') === 'true' && selectedPanel && !selectedPanel.hidden;
      },
      { selectedTabId: tabId, selectedPanelId: panelId }
    );
    const panel = page.locator(`#${panelId}`);
    if ((await panel.getAttribute('aria-labelledby')) !== tabId) passed = false;
    const panelText = await panel.innerText();
    const hasExpectedContent = label === 'Request'
      ? panelText.includes('analytics.example.test/events')
      : label === 'Response'
        ? panelText.includes('503')
        : label === 'Error Details'
          ? panelText.includes('Scheduling API temporarily unavailable')
          : panelText.includes('northstar-analytics');
    if (!hasExpectedContent) {
      failedPanels.push(label);
      passed = false;
    }
    for (const previousPanel of visitedPanels) {
      if ((await page.locator(`#${previousPanel}`).count()) !== 1) passed = false;
    }
    visitedPanels.add(panelId);
  }

  const passes = passed && visitedPanels.size === expectedLabels.length && neutralDiagnostics && compactActions &&
    menuActionsVisible && deleteConfirmationVisible && noLegacyChips;
  tabChecks.push({
    route: '15-dlq',
    width,
    checkedTabs: visitedPanels.size,
    retainedPanels: true,
    neutralDiagnostics,
    failedPanels,
    compactActions,
    menuActionsVisible,
    deleteConfirmationVisible,
    confirmationFits,
    noLegacyChips,
    passes,
  });
  if (!passes)
    issues.push({
      route: '/dlq',
      kind: 'tabs',
      detail: JSON.stringify({ width, passed, passes, visitedPanels: visitedPanels.size, neutralDiagnostics, compactActions, actionButtonCount, menuActionsVisible, deleteConfirmationVisible, failedPanels }),
    });
  await page.screenshot({
    path: join(outputDir, `15-dlq-trace-viewer-tabs-${width}.png`),
    animations: 'disabled',
  });
}

async function checkFlowBuilderCanvas(page, outputDir) {
  const geometry = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('.react-flow__node')];
    const minimap = document.querySelector('.react-flow__minimap');
    if (!minimap) return { nodeCount: nodes.length, minimap: null, overlapsNode: false };
    const map = minimap.getBoundingClientRect();
    const overlapsNode = nodes.some((node) => {
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && map.left < rect.right && map.right > rect.left &&
        map.top < rect.bottom && map.bottom > rect.top;
    });
    return {
      nodeCount: nodes.length,
      minimap: { x: map.x, y: map.y, width: map.width, height: map.height },
      overlapsNode,
    };
  });
  const geometryPass = geometry.nodeCount > 0 && !!geometry.minimap &&
    geometry.minimap.width <= 140 && geometry.minimap.height <= 100 && !geometry.overlapsNode;
  tabChecks.push({ route: '07-flow-builder-new', check: 'canvas-minimap-layout', ...geometry, passes: geometryPass });
  if (!geometryPass) {
    issues.push({ route: '/flow-builder/new', kind: 'canvas-minimap', detail: JSON.stringify(geometry) });
  }

  const validation = page.locator('.flow-builder-validation-state--error');
  const validationCount = await validation.count();
  if (validationCount) {
    const validationLabel = await validation.first().getAttribute('aria-label');
    await validation.first().focus();
    const validationTooltip = page.getByRole('tooltip').first();
    await validationTooltip.waitFor({ state: 'visible' });
    const validationText = await validationTooltip.innerText();
    const validationPass = /3 validation errors/i.test(validationLabel || '') &&
      /3 Errors?/i.test(validationText) && /required|not configured/i.test(validationText);
    tabChecks.push({ route: '07-flow-builder-new', check: 'validation-details', validationLabel, validationText, passes: validationPass });
    if (!validationPass) {
      issues.push({ route: '/flow-builder/new', kind: 'validation-details', detail: validationText || 'No validation details shown' });
    }
    await page.screenshot({
      path: join(outputDir, '07-flow-builder-validation-details-1440.png'),
      animations: 'disabled',
    });
  }

  const nodeError = page.locator('.react-flow__node [role="img"][aria-label*="validation"]').first();
  if (await nodeError.count()) {
    const nodeErrorLabel = await nodeError.getAttribute('aria-label');
    await nodeError.focus();
    const nodeErrorTooltip = page.getByRole('tooltip').last();
    await nodeErrorTooltip.waitFor({ state: 'visible' });
    const nodeErrorText = await nodeErrorTooltip.innerText();
    const nodeErrorPass = /validation error/i.test(nodeErrorLabel || '') && /not configured|required/i.test(nodeErrorText);
    tabChecks.push({ route: '07-flow-builder-new', check: 'node-error-details', nodeErrorLabel, nodeErrorText, passes: nodeErrorPass });
    if (!nodeErrorPass) {
      issues.push({ route: '/flow-builder/new', kind: 'node-error-details', detail: nodeErrorText || 'No node issue details shown' });
    }
  }
}

async function checkMobileChrome(page) {
  const checks = {
    orgSwitcher: await page
      .getByRole('combobox', { name: 'Switch organization' })
      .isVisible()
      .catch(() => false),
    search: await page
      .getByRole('button', { name: 'Search pages' })
      .isVisible()
      .catch(() => false),
    moreActions: await page
      .getByRole('button', { name: 'More actions' })
      .isVisible()
      .catch(() => false),
  };
  mobileChromeChecks.push(checks);
  for (const [control, visible] of Object.entries(checks)) {
    if (!visible)
      issues.push({ route: '/dashboard', kind: 'mobile-chrome', detail: `Mobile ${control} control is not visible` });
  }
  if (checks.moreActions) {
    await page.getByRole('button', { name: 'More actions' }).click();
    for (const label of ['New integration', 'Dark mode', 'Sign out']) {
      const visible = await page
        .getByRole('menuitem', { name: label })
        .waitFor({ state: 'visible', timeout: 1000 })
        .then(() => true)
        .catch(() => false);
      if (!visible)
        issues.push({ route: '/dashboard', kind: 'mobile-chrome', detail: `Mobile More menu is missing ${label}` });
    }
    await page.keyboard.press('Escape');
  }
}

async function checkSidebarControls(page, outputDir, width) {
  if (width === 1440) {
    const sidebar = page.getByTestId('app-sidebar');
    const selectedItem = sidebar.locator('.astryx-side-nav-item[data-selected="selected"]').first();
    const selectedAccent = await selectedItem.evaluate((element) => getComputedStyle(element).boxShadow);
    const expectedSelectedAccent = await sidebar.evaluate((element) => {
      const probe = document.createElement('span');
      probe.style.backgroundColor = 'var(--color-sidebar-accent)';
      element.append(probe);
      const color = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return color;
    });
    const dashboardItem = sidebar.getByRole('button', { name: 'Dashboard' });
    const expectedHoverBackground = await sidebar.evaluate((element) => {
      const probe = document.createElement('span');
      probe.style.backgroundColor = 'var(--color-sidebar-hover)';
      element.append(probe);
      const color = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return color;
    });
    await dashboardItem.hover();
    const hoverBackground = await dashboardItem.evaluate((element) => getComputedStyle(element).backgroundColor);
    const hoverTextColor = await dashboardItem.evaluate((element) => getComputedStyle(element).color);
    const hoverFeedbackWorks = hoverBackground !== 'rgba(0, 0, 0, 0)' && hoverTextColor !== 'rgb(0, 0, 0)';
    const groupToggle = sidebar.getByRole('button', { name: 'Collapse Overview' });
    const groupToggleUsesDesignSystem = await groupToggle.evaluate((element) =>
      element.classList.contains('app-sidebar__group-toggle')
    );
    await groupToggle.click();
    const overviewCollapsed = (await sidebar.getByRole('button', { name: 'Dashboard' }).count()) === 0;
    await sidebar.getByRole('button', { name: 'Expand Overview' }).click();
    const overviewRestored = await sidebar.getByRole('button', { name: 'Dashboard' }).isVisible();
    const navigationFeedbackWorks = selectedAccent.includes(expectedSelectedAccent) &&
      hoverBackground === expectedHoverBackground && hoverFeedbackWorks && groupToggleUsesDesignSystem &&
      overviewCollapsed && overviewRestored;
    if (!navigationFeedbackWorks) {
      issues.push({
        route: '/dashboard',
        kind: 'sidebar-interaction-feedback',
        detail: JSON.stringify({ selectedAccent, expectedSelectedAccent, expectedHoverBackground, hoverBackground, hoverTextColor, groupToggleUsesDesignSystem, overviewCollapsed, overviewRestored }),
      });
    }
    await page.screenshot({ path: join(outputDir, 'sidebar-expanded-light-1440.png'), animations: 'disabled' });
    const collapse = page.getByRole('button', { name: 'Collapse sidebar' });
    const expandedWidth = await sidebar.evaluate((element) => element.getBoundingClientRect().width);
    const collapseInBrandHeader = await collapse.evaluate((button) => !!button.closest('.astryx-side-nav-heading'));
    const noExpandedActionRow = (await sidebar.locator('.app-sidebar__collapse-row').count()) === 0;
    await collapse.click();
    await page.waitForTimeout(450);
    const expand = page.getByRole('button', { name: 'Expand sidebar' });
    const collapsedWidth = await sidebar.evaluate((element) => element.getBoundingClientRect().width);
    const collapsedStateWorks = (await expand.count()) === 1 && collapsedWidth < expandedWidth;
    if (!collapsedStateWorks) {
      issues.push({ route: '/dashboard', kind: 'sidebar-collapse', detail: 'Desktop collapse control did not expose Expand sidebar' });
    }
    await page.screenshot({ path: join(outputDir, 'sidebar-collapsed-light-1440.png'), animations: 'disabled' });
    await expand.click();
    await page.waitForTimeout(450);
    const restoredWidth = await sidebar.evaluate((element) => element.getBoundingClientRect().width);
    const expandedStateWorks = (await page.getByRole('button', { name: 'Collapse sidebar' }).count()) === 1 && restoredWidth > collapsedWidth;
    if (!expandedStateWorks) {
      issues.push({ route: '/dashboard', kind: 'sidebar-expand', detail: 'Desktop expand control did not restore the sidebar' });
    }
    tabChecks.push({ route: 'sidebar', mode: 'desktop', expandedWidth, collapsedWidth, restoredWidth, collapseInBrandHeader, noExpandedActionRow, selectedAccent, expectedSelectedAccent, expectedHoverBackground, hoverBackground, hoverTextColor, groupToggleUsesDesignSystem, overviewCollapsed, overviewRestored, navigationFeedbackWorks, passes: collapsedStateWorks && expandedStateWorks && collapseInBrandHeader && noExpandedActionRow && navigationFeedbackWorks, screenshots: 2 });
    return;
  }

  const toggle = page.getByTestId('mobile-nav-toggle');
  await toggle.click();
  const dialog = page.getByRole('dialog', { name: 'Integration Gateway navigation' });
  await dialog.waitFor({ state: 'visible' });
  await page.waitForTimeout(700);
  const close = dialog.getByRole('button', { name: 'Close navigation' });
  const [drawerBounds, closeBounds] = await Promise.all([
    page.locator('.astryx-mobile-nav-drawer').boundingBox(),
    close.boundingBox(),
  ]);
  const drawerFits = !!drawerBounds && drawerBounds.x >= 0 && drawerBounds.x + drawerBounds.width <= width + 1;
  const closeFits = !!closeBounds && closeBounds.x >= 0 && closeBounds.x + closeBounds.width <= width + 1;
  const navVisible = await dialog.getByRole('navigation').getByText('Lookup Tables').isVisible();
  const noDuplicateActions = (await dialog.locator('.ant-select').count()) === 0;
  const noDesktopToggle = (await dialog.getByRole('button', { name: /collapse sidebar|expand sidebar/i }).count()) === 0;
  const openStateWorks = (await toggle.getAttribute('aria-expanded')) === 'true' && drawerFits && closeFits && navVisible && noDuplicateActions && noDesktopToggle;
  if (!openStateWorks) {
    issues.push({ route: '/dashboard', kind: 'sidebar-mobile-open', detail: JSON.stringify({ drawerFits, closeFits, navVisible, noDuplicateActions, noDesktopToggle }) });
  }
  await page.screenshot({ path: join(outputDir, 'sidebar-mobile-open-light-390.png'), animations: 'disabled' });
  await close.click();
  await page.waitForTimeout(700);
  const closedDialog = await page.evaluate(
    () => document.querySelector('dialog[aria-label="Integration Gateway navigation"]')?.open !== true
  );
  const closeStateWorks = (await toggle.getAttribute('aria-expanded')) === 'false' && closedDialog;
  if (!closeStateWorks) {
    issues.push({ route: '/dashboard', kind: 'sidebar-mobile-close', detail: 'Close navigation did not close the mobile drawer' });
  }
  await toggle.click();
  await dialog.getByRole('navigation').getByText('Event Catalog').click();
  await page.waitForURL(/\/events\/catalog(?:\?|$)/);
  await page.waitForTimeout(700);
  const navigationCloses = await page.evaluate(
    () => document.querySelector('dialog[aria-label="Integration Gateway navigation"]')?.open !== true
  );
  if (!navigationCloses) {
    issues.push({ route: '/events', kind: 'sidebar-mobile-navigation', detail: 'Selecting a navigation item did not close the drawer' });
  }
  tabChecks.push({ route: 'sidebar', mode: 'mobile', drawerFits, closeFits, navVisible, noDuplicateActions, noDesktopToggle, closeStateWorks, navigationCloses, passes: openStateWorks && closeStateWorks && navigationCloses, screenshots: 1 });
}

async function checkEventAuditLayout(page, outputDir) {
  const headerBounds = await page.locator('.page-header').boundingBox();
  const tableBounds = await page.locator('.event-audit-table-panel').boundingBox();
  const aligned = !!headerBounds && !!tableBounds &&
    Math.abs(headerBounds.x - tableBounds.x) <= 2 &&
    Math.abs(headerBounds.x + headerBounds.width - tableBounds.x - tableBounds.width) <= 2;
  if (!aligned) {
    issues.push({ route: '/events', kind: 'content-gutter', detail: JSON.stringify({ headerBounds, tableBounds }) });
  }
  await page.screenshot({ path: join(outputDir, '08-events-table-gutter-light-1440.png'), animations: 'disabled' });
  tabChecks.push({ route: '08-events', check: 'page-header-and-table-gutters', aligned, headerBounds, tableBounds, passes: aligned, screenshots: 1 });

  await page.getByRole('button', { name: 'Add Test Events' }).click();
  const dialog = page.getByRole('dialog', { name: 'Insert Test Events' });
  const warningVisible = await dialog.getByText(/writes real, synthetic events into the live audit trail/i).isVisible();
  const noAntdAlert = (await dialog.locator('.ant-alert').count()) === 0;
  const mobileLabel = await dialog.locator('label').filter({ hasText: 'Patient Mobile' }).innerText();
  const optionalLabelIsSingular = mobileLabel.replace(/\s+/g, ' ').trim() === 'Patient Mobile (optional)';
  if (!warningVisible || !noAntdAlert || !optionalLabelIsSingular) {
    issues.push({ route: '/events', kind: 'test-event-warning', detail: JSON.stringify({ warningVisible, noAntdAlert, mobileLabel }) });
  }
  await page.waitForTimeout(350);
  await page.screenshot({ path: join(outputDir, '08-events-test-event-warning-light-1440.png'), animations: 'disabled' });
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  tabChecks.push({ route: '08-events', check: 'test-event-warning', warningVisible, noAntdAlert, optionalLabelIsSingular, passes: warningVisible && noAntdAlert && optionalLabelIsSingular, screenshots: 1 });
}

async function checkTableGutter(page, route, selector) {
  const contentBounds = await page.locator('.page-template__content').boundingBox();
  const tableBounds = await page.locator(selector).boundingBox();
  const aligned = !!contentBounds && !!tableBounds &&
    Math.abs(contentBounds.x - tableBounds.x) <= 2 &&
    Math.abs(contentBounds.x + contentBounds.width - tableBounds.x - tableBounds.width) <= 2;
  if (!aligned) {
    issues.push({ route, kind: 'content-gutter', detail: JSON.stringify({ selector, contentBounds, tableBounds }) });
  }
  tabChecks.push({ route, check: 'page-content-and-table-gutters', selector, aligned, contentBounds, tableBounds, passes: aligned });
  if (route === '/logs') {
    const moreButton = page.getByRole('button', { name: 'More actions for Visit Completed to Analytics' });
    const [forceVisible, actionBounds] = await Promise.all([moreButton.isVisible(), moreButton.boundingBox()]);
    const actionFits = !!tableBounds && !!actionBounds && forceVisible &&
      actionBounds.x >= tableBounds.x && actionBounds.x + actionBounds.width <= tableBounds.x + tableBounds.width + 1;
    if (!actionFits) {
      issues.push({ route, kind: 'row-action-clipping', detail: JSON.stringify({ forceVisible, actionBounds, tableBounds }) });
    }
    await moreButton.click();
    const forceMenuItem = page.getByRole('menuitem', { name: 'Force retry' });
    const forceMenuVisible = await forceMenuItem.isVisible();
    if (!forceMenuVisible) {
      issues.push({ route, kind: 'force-retry-menu', detail: 'Force retry was not available from the row action menu' });
    } else {
      await forceMenuItem.click();
      const confirmationVisible = await page.locator('.ant-modal-confirm-title').getByText('Force retry delivery?', { exact: true }).isVisible();
      if (!confirmationVisible) {
        issues.push({ route, kind: 'force-retry-confirmation', detail: 'Force retry did not open its confirmation' });
      } else {
        await page.locator('.ant-modal-confirm').getByRole('button', { name: 'Cancel' }).click();
      }
    }
    tabChecks.push({ route, check: 'force-retry-action-fits-and-confirms', actionFits, forceMenuVisible, passes: actionFits && forceMenuVisible, actionBounds, tableBounds });
  }
}

async function createContext(theme, width, height, { authenticate = true } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  await context.addInitScript(
    ({ selectedTheme }) => {
      localStorage.setItem('themeMode', selectedTheme);
      localStorage.setItem('density', 'middle');
      localStorage.setItem('ig_feature_flags', JSON.stringify({ integrationFlowBuilderEnabled: true }));
    },
    { selectedTheme: theme }
  );
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') {
      const finding = { route: page.url(), kind: 'console', detail: message.text() };
      if (/^(Warning:|\[antd:)/.test(message.text())) warnings.push(finding);
      else issues.push(finding);
    }
  });
  page.on('pageerror', (error) => issues.push({ route: page.url(), kind: 'pageerror', detail: error.message }));
  page.on('requestfailed', (request) => {
    if (!request.failure()?.errorText?.includes('ERR_ABORTED')) {
      issues.push({
        route: page.url(),
        kind: 'requestfailed',
        detail: `${request.method()} ${request.url()} ${request.failure()?.errorText || ''}`,
      });
    }
  });
  page.on('response', (response) => {
    if (response.status() >= 400)
      issues.push({ route: page.url(), kind: 'http', detail: `${response.status()} ${response.url()}` });
  });
  if (authenticate) {
    await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
    await page.getByLabel('Email').fill('review.admin@example.test');
    await page.getByLabel('Password').fill('local-fixture-only');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL(/dashboard|admin/);
  }
  return { context, page };
}

async function visit(page, name, path, width, height, screenshotPath) {
  const response = await page.goto(`${baseUrl}${path}`, { waitUntil: 'domcontentloaded' });
  await page.locator('body').waitFor();
  await page
    .waitForFunction(() => document.body.innerText.trim().length >= 20, undefined, { timeout: 10000 })
    .catch(() => undefined);
  await page.waitForTimeout(150);
  const activeSpinners = page.locator('.ant-spin-spinning:visible');
  if (await activeSpinners.count()) {
    await activeSpinners
      .last()
      .waitFor({ state: 'hidden', timeout: 10000 })
      .catch(() => {
        issues.push({ route: path, kind: 'loading', detail: 'Ant Design spinner remained visible after 10 seconds' });
      });
  }
  if (name === '01-dashboard') {
    await page
      .waitForFunction(
        () =>
          document.querySelectorAll('.dashboard-chart-card svg.recharts-surface path.recharts-rectangle').length >= 3,
        undefined,
        { timeout: 10000 }
      )
      .catch(() =>
        issues.push({ route: path, kind: 'loading', detail: 'Delivery trend chart did not finish rendering' })
      );
    await page.waitForTimeout(750);
  }
  if (name === '13-logs') {
    await page.waitForFunction(
      () => {
        const pills = [...document.querySelectorAll('.logs-summary-strip .stat-pill')];
        return pills.length > 0 && pills.every((pill) => {
          const target = pill.getAttribute('aria-label')?.match(/^Filter by .+?: ([\d,]+)/)?.[1]?.replace(/,/g, '');
          const shown = pill.querySelector('.stat-pill__value')?.textContent?.trim().replace(/,/g, '');
          return target !== undefined && shown === target;
        });
      },
      undefined,
      { timeout: 5000 }
    ).catch(() => issues.push({ route: path, kind: 'animated-counts', detail: 'Delivery summary counts did not settle to their accessible values' }));
  }
  if (name === '07-flow-builder-new') {
    await page.locator('.react-flow__node .flow-builder-node-label').first().waitFor({ state: 'visible' });
  }
  const details = await page.evaluate(() => ({
    viewportWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    textLength: document.body.innerText.trim().length,
    bodyText: document.body.innerText.slice(0, 1200),
    flowNodeScale: (() => {
      const viewport = document.querySelector('.react-flow__viewport');
      const label = document.querySelector('.flow-builder-node-label');
      if (!viewport || !label) return null;
      const transform = getComputedStyle(viewport).transform;
      const matrix = transform.match(/^matrix(?:3d)?\(([^,]+)/);
      const scale = transform === 'none' ? 1 : Number(matrix?.[1] ?? 1);
      return Number.parseFloat(getComputedStyle(label).fontSize) * scale;
    })(),
  }));
  const record = { route: name, path, width, height, status: response?.status() ?? null, ...details };
  if (details.textLength < 20)
    issues.push({ route: path, kind: 'blank', detail: `Only ${details.textLength} visible characters` });
  if (details.scrollWidth > details.viewportWidth + 1) {
    issues.push({
      route: path,
      kind: 'overflow',
      width,
      detail: `document scrollWidth ${details.scrollWidth} > viewport ${details.viewportWidth}`,
    });
  }
  if (name === '07-flow-builder-new' && (details.flowNodeScale ?? 0) < 12) {
    issues.push({
      route: path,
      kind: 'flow-node-readability',
      width,
      detail: `Effective node label size ${details.flowNodeScale ?? 0}px is below 12px`,
    });
  }
  if (/access denied|you do not have permission|permission denied/i.test(details.bodyText)) {
    issues.push({ route: path, kind: 'denied', detail: details.bodyText.slice(0, 250) });
  }
  if (screenshotPath) await page.screenshot({ path: screenshotPath, animations: 'disabled' });
  captures.push(record);
}

try {
  for (const theme of ['light', 'dark']) {
    for (const [width, height] of [
      [1440, 1000],
      [390, 844],
    ]) {
      const { context, page } = await createContext(theme, width, height);
      for (const [name, path] of routesToCapture) {
        if (name === '47-login') continue;
        await visit(page, name, path, width, height, join(outputDir, `${name}-${theme}-${width}.png`));
        if (
          (width === 1440 || width === 390) &&
          theme === 'light' &&
          ['31-admin-users', '32-admin-orgs', '33-admin-roles', '34-admin-api-keys', '35-admin-permissions'].includes(
            name
          )
        ) {
          await checkAdminFixtureContent(page, name, width);
        }
        if (width === 1440 && theme === 'light' && name === '20-system-logs') await checkSystemLogTabs(page);
        if (width === 1440 && theme === 'light' && name === '13-logs') await checkDeliveryLogSemantics(page);
        if (width === 1440 && theme === 'light' && name === '27-settings-event-source') {
          await checkEventSourceMetadata(page);
        }
        if (width === 1440 && theme === 'light' && name === '26-settings') {
          await checkSettingsMetadata(page, outputDir);
        }
        if (width === 1440 && theme === 'light' && name === '24-bulk') {
          await checkBulkOperations(page, outputDir);
        }
        if (name === '20-system-logs') await checkSystemLogSummaryLayout(page, width);
        if (width === 1440 && theme === 'light' && name === '25-versions') await checkVersionTabs(page, outputDir);
        if (width === 1440 && theme === 'light' && name === '17-scheduled-jobs') await checkScheduledJobsMetadata(page);
        if (width === 1440 && theme === 'light' && name === '08-events') await checkBulkImportTabs(page, outputDir);
        if ((width === 1440 || width === 390) && theme === 'light' && name === '09-events-catalog') {
          await checkEventDetailTabs(page, outputDir, width);
        }
        if ((width === 1440 || width === 390) && theme === 'light' && name === '16-scheduled') {
          await checkScheduledDeliveryTabs(page, outputDir, width);
        }
        if ((width === 1440 || width === 390) && theme === 'light' && name === '43-help-lookup-guide') {
          await checkLookupGuideTabs(page, outputDir, width);
        }
        if ((width === 1440 || width === 390) && theme === 'light' && name === '14-log-detail') {
          await checkLogDetailSemantics(page, width);
          await checkHl7DetailTabs(page, outputDir, width);
        }
        if ((width === 1440 || width === 390) && theme === 'light' && name === '21-templates') {
          await checkTemplateMetadata(page, width);
        }
        if ((width === 1440 || width === 390) && theme === 'light' && name === '18-scheduled-job-detail') {
          await checkScheduledJobDetailTabs(page, outputDir, width);
        }
        if ((width === 1440 || width === 390) && theme === 'light' && name === '03-integration-detail') {
          await checkIntegrationSectionTabs(page, outputDir, width);
        }
        if (width === 1440 && theme === 'light' && name === '03-integration-detail') {
          await checkDeliverySteps(page, outputDir);
          await checkFollowUpTestResult(page, outputDir);
        }
        if ((width === 1440 || width === 390) && theme === 'light' && name === '05-inbound-detail') {
          await checkInboundIntegrationTabs(page, outputDir, width);
        }
        if ((width === 1440 || width === 390) && theme === 'light' && name === '40-admin-system-status') {
          await checkSystemStatusTabs(page, outputDir, width);
        }
        if ((width === 1440 || width === 390) && theme === 'light' && name === '01-dashboard') {
          await checkDashboardTrend(page, width);
        }
        if (width === 1440 && theme === 'light' && name === '15-dlq') {
          await checkTraceViewerTabs(page, outputDir, width);
        }
        if (width === 1440 && theme === 'light' && name === '07-flow-builder-new') {
          await checkFlowBuilderCanvas(page, outputDir);
        }
        if ((width === 1440 || width === 390) && theme === 'light' && name === '01-dashboard') {
          await checkSidebarControls(page, outputDir, width);
        }
        if (width === 1440 && theme === 'light' && name === '08-events') {
          await checkEventAuditLayout(page, outputDir);
        }
        if (width === 1440 && theme === 'light' && name === '13-logs') {
          await checkTableGutter(page, '/logs', '.logs-table-wrapper');
        }
        if (width === 1440 && theme === 'light' && name === '15-dlq') {
          await checkTableGutter(page, '/dlq', '.dlq-table-section .full-bleed-table');
        }
        if (width === 1440 && theme === 'light' && name === '16-scheduled') {
          await checkTableGutter(page, '/scheduled', '.full-bleed-table');
        }
        if (width === 1440 && theme === 'light' && name === '19-alert-center') {
          await checkTableGutter(page, '/alert-center', '.full-bleed-table');
        }
        if (width === 1440 && theme === 'light' && name === '20-system-logs') {
          await checkTableGutter(page, '/system-logs', '.full-bleed-table');
        }
        if (width === 390 && theme === 'light' && name === '01-dashboard') await checkMobileChrome(page);
        if (width === 390 && theme === 'light' && name === '40-admin-system-status') {
          const notice = page.locator('.system-status-scope-notice__body');
          if (await notice.count()) {
            const geometry = await notice.evaluate((element) => {
              const rect = element.getBoundingClientRect();
              return { width: rect.width, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth };
            });
            const hasReturnAction = await notice.getByRole('button', { name: 'Back to all organizations' }).isVisible();
            const passes = geometry.width > 0 && geometry.scrollWidth <= geometry.clientWidth + 1 && hasReturnAction;
            mobileScopeNoticeChecks.push({ ...geometry, hasReturnAction, passes });
            if (!passes)
              issues.push({
                route: '/admin/system-status',
                kind: 'mobile-scope-notice',
                detail: JSON.stringify({ ...geometry, hasReturnAction }),
              });
          }
        }
      }
      if (width === 390 && routesToCapture.some(([name]) => name === '10-lookups')) {
        await checkLookupRowHover(page, theme, 390);
        await checkLookupRowHover(page, theme, 642);
      }
      await context.close();
      if (routesToCapture.some(([name]) => name === '47-login')) {
        const { context: loginContext, page: loginPage } = await createContext(theme, width, height, {
          authenticate: false,
        });
        await visit(loginPage, '47-login', '/login', width, height, join(outputDir, `47-login-${theme}-${width}.png`));
        await loginContext.close();
      }
    }
  }

  if (process.env.REVIEW_SMOKE !== '1') {
    const { context, page } = await createContext('light', 320, 800);
    for (const width of [320, 768, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      for (const [name, path] of routesToCapture) {
        if (name === '47-login') continue;
        await visit(page, name, path, width, 900, null);
      }
    }
    await context.close();
    if (routesToCapture.some(([name]) => name === '47-login')) {
      for (const width of [320, 768, 1024]) {
        const { context: loginContext, page: loginPage } = await createContext('light', width, 900, {
          authenticate: false,
        });
        await visit(loginPage, '47-login', '/login', width, 900, null);
        await loginContext.close();
      }
    }
  }
} finally {
  await browser.close();
}

const report = {
  generatedAt: new Date().toISOString(),
  source: 'Local synthetic review fixture only',
  baseUrl,
  routeCount: routesToCapture.length,
  screenshotCount:
    captures.filter(({ width, height }) => (width === 1440 && height === 1000) || (width === 390 && height === 844))
      .length + tabChecks.reduce((count, check) => count + (check.screenshots || 1), 0),
  hoverScreenshotCount: hoverChecks.length,
  overflowSweepWidths: [320, 768, 1024],
  routeResults: captures,
  hoverChecks,
  tabChecks,
  mobileChromeChecks,
  mobileScopeNoticeChecks,
  issues,
  warnings,
  passed: issues.length === 0,
};
await writeFile(join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
const hoverReadout = [
  ...new Map(hoverChecks.map(({ theme, contrast }) => [theme, `${theme} ${contrast.toFixed(2)}:1`])).values(),
].join(', ');
await writeFile(
  join(outputDir, 'README.md'),
  `# UI review captures\n\nGenerated by frontend/scripts/capture-review.mjs against the local synthetic fixture. No validation or production data is used.\n\n- ${routesToCapture.length} routed screens captured in light and dark at 1440x1000 and 390x844.\n- ${process.env.REVIEW_SMOKE === '1' ? 'Overflow sweep skipped in smoke mode.' : 'All routed screens checked for horizontal overflow at 320, 768, and 1024 pixels.'}\n- Result: ${report.passed ? 'PASS' : 'FAIL'} (${issues.length} issue(s)); see report.json.\n${hoverReadout ? `- Lookup hover contrast: ${hoverReadout}.\n` : ''}${mobileChromeChecks.length ? '- Mobile chrome checks passed for organization switching, search, and More actions.\n' : ''}${mobileScopeNoticeChecks.some(({ passes }) => passes) ? '- Mobile system-status scope notice check passed.\n' : ''}- ${warnings.length} non-fatal browser warning(s) are recorded in report.json.\n`
);
process.stdout.write(
  `Captured ${report.screenshotCount} screenshots across ${routesToCapture.length} routes; ${issues.length} error(s), ${warnings.length} warning(s). Report: ${resolve(outputDir, 'report.json')}\n`
);
if (!report.passed) process.exitCode = 1;
