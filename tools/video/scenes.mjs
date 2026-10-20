// The walkthrough, scene by scene. Each scene: id, optional chapter (YouTube
// chapter title), caption (shown while it plays), teaser (which short clip it
// also belongs to), and run(stage, helpers).

export const scenes = [
  {
    id: 'intro',
    chapter: 'Introduction',
    caption: '',
    run: (stage, { card }) =>
      card({
        eyebrow: 'Integration Gateway',
        title: 'From docker compose to three live integrations',
        subtitle: 'Outbound events, an inbound API and a scheduled job — on a fresh install, in about four minutes.',
        hold: 3600,
      }),
  },
  {
    id: 'docker-card',
    chapter: 'Run it with Docker',
    caption: '',
    run: (stage, { card }) =>
      card({ eyebrow: 'Step 1', title: 'Run it with Docker', subtitle: 'All you need is Docker with Compose.' }),
  },
  {
    id: 'docker',
    caption: 'Clone the repository and generate a .env with random secrets.',
    run: async (stage, { terminal, capture, config }) => {
      const t = await terminal('integration-control-plane-oss — zsh');
      await t.run(`git clone ${config.repoUrl}`, ["Cloning into 'integration-control-plane-oss'..."], { holdAfter: 500 });
      await t.run('cd integration-control-plane-oss', [], { holdAfter: 300 });
      await t.run('./scripts/init-env.sh', await capture('init-env'), { holdAfter: 1400 });
      await stage.caption('Start MongoDB, the gateway and the console. The first build takes a few minutes.');
      await t.run('docker compose up -d --build', await capture('compose-up'), { holdAfter: 900, perLine: 260 });
      await t.run('docker compose ps', await capture('compose-ps'), { holdAfter: 1600 });
      await stage.caption('Create the first account: a super admin who can manage every organization.');
      await t.clear();
      await t.run(
        "docker compose exec backend node scripts/create-user.js \\\n    --email admin@example.com --password 'ChangeMe123!' --role SUPER_ADMIN",
        await capture('create-user'),
        { holdAfter: 2200 }
      );
    },
  },
  {
    id: 'sign-in',
    chapter: 'Sign in and create an organization',
    caption: 'Open http://localhost/integration-gateway and sign in.',
    run: async (stage, { config }) => {
      const { page } = stage;
      await page.goto(`${config.base}/`);
      await stage.pause(1200);
      await stage.click(page.getByRole('button', { name: 'Sign in' }).first());
      await stage.type(page.getByPlaceholder('you@company.com', { exact: true }), config.email);
      await stage.type(page.locator('input[type="password"]'), config.password);
      await stage.click(page.locator('button[type="submit"]'));
      await page.waitForURL(/admin\/orgs/, { timeout: 15000 });
      await stage.pause(1500);
    },
  },
  {
    id: 'create-org',
    caption: 'Everything belongs to an organization. Create one: a name and a short code are enough.',
    run: async (stage) => {
      const { page } = stage;
      await stage.click(page.getByRole('button', { name: 'Create Org' }));
      const dialog = page.getByRole('dialog');
      await stage.type(dialog.getByPlaceholder('e.g. Acme Corp', { exact: true }), 'Acme Retail');
      await stage.type(dialog.getByPlaceholder('ACME', { exact: true }), 'ACME');
      await stage.pause(500);
      await stage.click(dialog.getByRole('button', { name: 'OK', exact: true }));
      await page.getByRole('cell', { name: 'Acme Retail' }).waitFor({ timeout: 10000 });
      await stage.pause(1200);
    },
  },
  {
    id: 'open-org',
    caption: 'Switch into the new organization. Its dashboard shows what to set up first.',
    run: async (stage) => {
      const { page } = stage;
      await stage.click(page.locator('header .ant-select').first());
      await stage.click(page.locator('.ant-select-item-option', { hasText: 'Acme Retail' }).first());
      await stage.click(page.getByRole('button', { name: 'Switch', exact: true }));
      await stage.pause(800);
      if (!/\/dashboard/.test(page.url())) {
        await stage.click(page.getByRole('menuitem', { name: 'Dashboard' }));
      }
      await page.getByText('Get started').waitFor({ timeout: 15000 });
      await stage.pause(2500);
    },
  },
  {
    id: 'event-source',
    chapter: 'Outbound: deliver events to a partner API',
    caption: 'Outbound integrations react to events. Choose how events arrive — here, HTTP push.',
    run: async (stage) => {
      const { page } = stage;
      await stage.click(page.getByRole('button', { name: 'Set up event source' }));
      await page.getByText('Configure Event Source').waitFor({ timeout: 15000 });
      await stage.pause(700);
      await stage.click(page.locator('.ant-select').filter({ hasText: /None \(no event source\)/ }).first());
      await stage.click(page.locator('.ant-select-item-option', { hasText: 'HTTP Push' }).first());
      await stage.pause(900);
      await stage.click(page.getByRole('button', { name: /Save Configuration/ }));
      await stage.pause(1800);
    },
  },
  {
    id: 'event-type',
    caption: 'Describe the event your systems send. ORDER_PLACED, with the fields it carries.',
    run: async (stage, { config }) => {
      const { page } = stage;
      await page.goto(`${config.base}/events/catalog`);
      await stage.click(page.getByRole('button', { name: /Add Event Type/ }));
      const dialog = page.getByRole('dialog');
      await stage.type(dialog.getByPlaceholder('ORDER_PLACED', { exact: true }), 'ORDER_PLACED');
      await stage.type(dialog.getByPlaceholder('Order Placed', { exact: true }), 'Order placed');
      await stage.type(dialog.getByPlaceholder(/path \(e\.g\./), 'orderId');
      await stage.pause(400);
      await stage.click(dialog.getByRole('button', { name: 'Create', exact: true }));
      await page.getByText('ORDER_PLACED').first().waitFor({ timeout: 10000 });
      await stage.pause(1500);
    },
  },
  {
    id: 'outbound-create',
    caption: 'Create the outbound integration: when ORDER_PLACED arrives, POST it to the partner API.',
    teaser: 'outbound',
    run: async (stage, { config }) => {
      const { page } = stage;
      await page.goto(`${config.base}/integrations/new`);
      await page.getByPlaceholder('e.g., New order to CRM', { exact: true }).waitFor({ timeout: 15000 });
      await stage.pause(600);
      await stage.type(page.getByPlaceholder('e.g., New order to CRM', { exact: true }), 'Orders to partner CRM');
      await stage.click(page.getByRole('combobox', { name: 'Event Type' }));
      await stage.click(page.locator('.ant-select-item-option', { hasText: 'ORDER_PLACED' }).first());
      await stage.type(
        page.getByPlaceholder('https://api.example.com/integrations/receive', { exact: true }),
        'https://httpbin.org/anything/orders',
        { paste: true }
      );
      await stage.pause(700);
      await stage.click(page.getByRole('button', { name: /Review & Create/ }));
      await stage.pause(2200);
      await stage.click(page.locator('.ant-drawer').getByRole('button', { name: /Create Draft/ }));
      await page.waitForURL(/\/integrations(\?|$)/, { timeout: 15000 });
      await stage.pause(1200);
    },
  },
  {
    id: 'outbound-activate',
    caption: 'It starts as a draft. Switch it on when you are ready.',
    teaser: 'outbound',
    run: async (stage) => {
      const { page } = stage;
      const row = page.locator('.ant-table-row', { hasText: 'Orders to partner CRM' });
      await row.waitFor({ timeout: 15000 });
      await stage.click(row.locator('.ant-switch'), { pauseAfter: 2200 });
    },
  },
  {
    id: 'api-key',
    caption: 'Your systems push events with an API key. Create one that can only run integrations.',
    run: async (stage, { config, state }) => {
      const { page } = stage;
      await page.goto(`${config.base}/admin/api-keys`);
      await stage.click(page.getByRole('button', { name: /Create API key/i }).first());
      const dialog = page.locator('.ant-modal', { hasText: 'Create API Key' });
      await stage.type(dialog.getByPlaceholder('e.g. CI pipeline, MCP server, laptop script', { exact: true }), 'Order system');
      await stage.click(dialog.locator('.ant-radio-wrapper', { hasText: 'Run integrations only' }));
      await stage.click(dialog.getByRole('button', { name: 'Create', exact: true }));
      const keyInput = page.locator('input[aria-label="New API key"]');
      await keyInput.waitFor({ timeout: 10000 });
      await stage.pause(1800);
      state.apiKey = await keyInput.inputValue();
      await stage.click(page.getByRole('button', { name: /I've copied it/ }));
      await stage.pause(600);
    },
  },
  {
    id: 'push-event',
    caption: 'Push an event over HTTP. The gateway queues it and delivers it to every matching integration.',
    teaser: 'outbound',
    run: async (stage, { terminal, config, state }) => {
      const t = await terminal('Order system — zsh');
      await t.run('export API_KEY=mdcs_pat_••••••••   # the key you just created', [], { holdAfter: 500 });
      const body = { eventType: 'ORDER_PLACED', payload: { orderId: 'ORD-1001', customer: 'Dana Lee', total: 49.9 } };
      const command =
        'curl -X POST "http://localhost:3545/api/v1/events/push?orgId=1" \\\n' +
        '     -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" \\\n' +
        `     -d '${JSON.stringify(body)}'`;
      const response = await fetch(`${config.apiBase}/events/push?orgId=1`, {
        method: 'POST',
        headers: { 'X-API-Key': state.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const text = await response.text();
      await t.run(command, [text], { holdAfter: 2600, cls: response.ok ? 'ok' : 'out' });
    },
  },
  {
    id: 'outbound-logs',
    caption: 'Every delivery is logged: the exact request, the partner response and a timeline.',
    teaser: 'outbound',
    run: async (stage, { config }) => {
      const { page } = stage;
      await page.goto(`${config.base}/logs`);
      const row = page.locator('.ant-table-row', { hasText: 'Orders to partner CRM' }).first();
      await row.waitFor({ timeout: 20000 });
      await stage.pause(900);
      await stage.click(row, { pauseAfter: 2200 });
      const drawer = page.locator('.ant-drawer-content').last();
      await stage.click(drawer.getByRole('tab', { name: 'Response' }), { pauseAfter: 2400 });
      await stage.click(drawer.getByRole('tab', { name: 'Timeline' }), { pauseAfter: 2200 });
      await page.keyboard.press('Escape');
      await stage.pause(500);
    },
  },
  {
    id: 'inbound-create',
    chapter: 'Inbound: put an API in front of a partner',
    caption: 'Inbound integrations give your callers one stable endpoint and forward to the partner API.',
    teaser: 'inbound',
    run: async (stage, { config }) => {
      const { page } = stage;
      await page.goto(`${config.base}/inbound-integrations/new`);
      const name = page.getByPlaceholder('e.g., CleverTap Real-time Sync', { exact: true });
      await name.waitFor({ timeout: 15000 });
      await stage.pause(600);
      await stage.type(name, 'Customer lookup API');
      await stage.type(page.getByPlaceholder('e.g., clevertap', { exact: true }), 'customer-lookup');
      await stage.click(page.getByRole('button', { name: 'Continue to Target API' }));
      await stage.type(page.getByPlaceholder('https://api.example.com/integration', { exact: true }), config.inboundTarget, { paste: true });
      await stage.click(page.locator('.ant-tabs-tabpane-active .ant-form-item', { hasText: 'Authentication Type' }).locator('.ant-select').first());
      await stage.click(page.locator('.ant-select-dropdown:visible .ant-select-item-option', { hasText: 'None' }).first());
      await stage.caption('Callers must present a key: protect the endpoint with API key auth.');
      await stage.click(page.getByRole('tab', { name: 'Authentication' }));
      await stage.click(page.locator('.ant-tabs-tabpane-active .ant-select').first());
      await stage.click(page.locator('.ant-select-dropdown:visible .ant-select-item-option', { hasText: 'API Key' }).first());
      await stage.type(page.getByPlaceholder('e.g., X-API-Key', { exact: true }), 'X-API-Key');
      await stage.type(page.getByPlaceholder('Enter your API key', { exact: true }), config.inboundKey);
      await stage.caption('Review and create. The endpoint is live straight away.');
      await stage.click(page.getByRole('tab', { name: 'Review & Submit' }), { pauseAfter: 1800 });
      await stage.click(page.getByRole('button', { name: 'Create Integration' }));
      await page.waitForURL(/\/integrations(\?|$)/, { timeout: 15000 });
      await stage.pause(1600);
    },
  },
  {
    id: 'inbound-call',
    caption: 'Without the key the gateway refuses the call. With it, the request reaches the partner.',
    teaser: 'inbound',
    run: async (stage, { terminal, config }) => {
      const t = await terminal('Storefront — zsh');
      const url = `${config.apiBase}/public/integrations/customer-lookup?orgId=1`;
      const body = { customerId: 'C-42' };
      const call = (headers) =>
        fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
      const shownUrl = 'http://localhost:3545/api/v1/public/integrations/customer-lookup?orgId=1';

      const denied = await call({});
      await t.run(`curl -X POST "${shownUrl}" \\\n     -d '${JSON.stringify(body)}'`, [await denied.text()], { holdAfter: 1800 });

      const allowed = await call({ 'X-API-Key': config.inboundKey });
      const echo = await allowed.json();
      const shown = JSON.stringify({ method: echo.method, url: echo.url, json: echo.json }, null, 2).split('\n');
      await t.run(
        `curl -s -X POST "${shownUrl}" \\\n     -H "X-API-Key: ${config.inboundKey}" -H "Content-Type: application/json" \\\n` +
          `     -d '${JSON.stringify(body)}' | jq '{method, url, json}'`,
        shown,
        { holdAfter: 2800, cls: allowed.ok ? 'ok' : 'out' }
      );
    },
  },
  {
    id: 'inbound-logs',
    caption: 'The call is traced end to end: what the caller sent, what the partner returned.',
    teaser: 'inbound',
    run: async (stage, { config }) => {
      const { page } = stage;
      await page.goto(`${config.base}/logs`);
      const row = page.locator('.ant-table-row', { hasText: 'Customer lookup API' }).first();
      await row.waitFor({ timeout: 20000 });
      await stage.pause(800);
      await stage.click(row, { pauseAfter: 1200 });
      const drawer = page.locator('.ant-drawer-content').last();
      await stage.click(drawer.getByRole('tab', { name: 'Trace' }), { pauseAfter: 2400 });
      await stage.click(drawer.getByRole('tab', { name: 'Response' }), { pauseAfter: 2200 });
      await page.keyboard.press('Escape');
      await stage.pause(500);
    },
  },
  {
    id: 'scheduled-create',
    chapter: 'Scheduled: sync data on a timetable',
    caption: 'Scheduled jobs pull data on a timetable, reshape it and deliver it. Name the job.',
    teaser: 'scheduled',
    run: async (stage, { config }) => {
      const { page } = stage;
      await page.goto(`${config.base}/scheduled-jobs/new`);
      const name = page.getByPlaceholder('Daily Bills Export', { exact: true });
      await name.waitFor({ timeout: 15000 });
      await stage.pause(600);
      await stage.type(name, 'Nightly customer sync');
      await stage.caption('Pick when it runs: a cron expression, or a preset.');
      await stage.click(page.getByRole('tab', { name: 'Schedule' }), { pauseAfter: 700 });
      await stage.click(page.getByText('Every day at 9 AM', { exact: true }), { pauseAfter: 1600 });
      await stage.caption('Where the data comes from: a REST API. Test it to preview real records.');
      await stage.click(page.getByRole('tab', { name: 'Data Source' }));
      await stage.click(page.locator('.ant-tabs-tabpane-active .ant-radio-button-wrapper', { hasText: 'Internal API' }));
      await stage.type(page.getByPlaceholder('http://localhost:4000/api/v1/analytics', { exact: true }), config.scheduledSource, { paste: true });
      await stage.click(page.getByRole('button', { name: /Test Data Source/ }));
      const preview = page.locator('.ant-modal', { hasText: 'Data Source Test Result' });
      await preview.getByText('Records Fetched').waitFor({ timeout: 30000 });
      await stage.pause(2600);
      await stage.click(preview.locator('.ant-modal-footer button.ant-btn-primary'), { pauseAfter: 600 });
      await stage.caption('Reshape the records with a little JavaScript before delivery.');
      await stage.click(page.getByRole('tab', { name: 'Transformation' }), { pauseAfter: 600 });
      // Monaco auto-closes brackets and auto-indents; turn that off so typed code lands verbatim.
      await page.evaluate(() =>
        window.monaco?.editor.getEditors().forEach((e) =>
          e.updateOptions({
            autoClosingBrackets: 'never',
            autoClosingQuotes: 'never',
            autoClosingOvertype: 'never',
            autoIndent: 'none',
            quickSuggestions: false,
            suggestOnTriggerCharacters: false,
            acceptSuggestionOnEnter: 'off',
            wordBasedSuggestions: 'off',
          })
        )
      );
      await stage.type(
        page.locator('.ant-tabs-tabpane-active .monaco-editor').first(),
        'return {\n  syncedAt: new Date().toISOString(),\n  customers: payload.data.map((u) => ({ id: u.id, name: u.name, email: u.email })),\n};',
        { clear: true, delay: 28 }
      );
      await stage.pause(900);
      await stage.caption('And where it goes: POST to the partner API.');
      await stage.click(page.getByRole('tab', { name: 'Destination' }));
      await stage.type(page.getByPlaceholder('https://api.finance.com/v1/import', { exact: true }), config.scheduledTarget, { paste: true });
      await stage.click(page.getByRole('tab', { name: 'Review & Submit' }), { pauseAfter: 1800 });
      await stage.click(page.getByRole('button', { name: /Create Scheduled Job/ }).last());
      await page.waitForURL(/\/scheduled-jobs(\?|$)/, { timeout: 15000 });
      await stage.pause(1400);
    },
  },
  {
    id: 'scheduled-run',
    caption: "Don't wait for 9 AM: run it now and check the result.",
    teaser: 'scheduled',
    run: async (stage, { config }) => {
      const { page } = stage;
      const row = page.locator('.ant-table-row', { hasText: 'Nightly customer sync' }).first();
      await row.waitFor({ timeout: 15000 });
      await stage.click(row.getByRole('button', { name: 'Execute Nightly customer sync now' }), { pauseAfter: 4500 });
      await stage.click(row.getByText('Nightly customer sync', { exact: true }));
      await stage.click(page.getByRole('tab', { name: 'Execution History' }), { pauseAfter: 2600 });
      await stage.caption('The partner received the reshaped payload: just id, name and email.');
      await page.goto(`${config.base}/logs`);
      const log = page.locator('.ant-table-row', { hasText: 'Nightly customer sync' }).first();
      await log.waitFor({ timeout: 20000 });
      await stage.click(log, { pauseAfter: 900 });
      await stage.click(page.locator('.ant-drawer-content').last().getByRole('tab', { name: 'Response' }), { pauseAfter: 3000 });
      await page.keyboard.press('Escape');
      await stage.pause(400);
    },
  },
  {
    id: 'dashboard',
    chapter: 'Wrap-up',
    caption: 'The dashboard now shows traffic from all three integrations.',
    run: async (stage, { config }) => {
      const { page } = stage;
      await page.goto(`${config.base}/dashboard`);
      await stage.pause(1200);
      await stage.click(page.locator('.dashboard-filters .ant-select').first());
      await stage.click(page.locator('.ant-select-dropdown:visible .ant-select-item-option', { hasText: '7 days' }).first());
      await stage.pause(4000);
    },
  },
  {
    id: 'outro',
    caption: '',
    run: (stage, { card, config }) =>
      card({
        eyebrow: 'Integration Gateway',
        title: 'Outbound, inbound and scheduled — running',
        subtitle: `Source and docs: ${config.repoUrl.replace(/^https:\/\//, '').replace(/\.git$/, '')}`,
        hold: 4200,
      }),
  },
];
