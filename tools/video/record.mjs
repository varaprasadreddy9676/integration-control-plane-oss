// Records the setup walkthrough against a fresh install.
//
//   1. Fresh stack: ./scripts/init-env.sh && docker compose up -d --build
//   2. First admin:  docker compose exec backend node scripts/create-user.js \
//                      --email admin@example.com --password 'ChangeMe123!' --role SUPER_ADMIN
//   3. npm run record && npm run build      (from tools/video)
//
// Terminal output shown in the video lives in capture/*.txt: real output from
// a fresh install, so the video shows exactly what a new user will see.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { openStage } from './lib/stage.mjs';
import { TERMINAL_HTML, cardHtml } from './lib/pages.mjs';
import { scenes } from './scenes.mjs';

const OUT = path.resolve(process.env.VIDEO_OUT || 'out');
const config = {
  base: process.env.CONSOLE_URL || 'http://localhost/integration-gateway',
  apiBase: process.env.API_URL || 'http://localhost:3545/api/v1',
  email: process.env.ADMIN_EMAIL || 'admin@example.com',
  password: process.env.ADMIN_PASSWORD || 'ChangeMe123!',
  repoUrl: process.env.REPO_URL || 'https://github.com/varaprasadreddy9676/integration-control-plane-oss.git',
  inboundTarget: 'https://httpbin.org/anything/crm/customers',
  inboundKey: 'acme-lookup-7f3a9c',
  scheduledSource: 'https://jsonplaceholder.typicode.com/users',
  scheduledTarget: 'https://httpbin.org/anything/crm/customers/sync',
  only: process.env.ONLY ? process.env.ONLY.split(',') : null,
};

const capture = async (name) => (await readFile(path.join('capture', `${name}.txt`), 'utf8')).trimEnd().split('\n');

const stage = await openStage({ outDir: OUT, headless: process.env.HEADED !== '1' });
const { page } = stage;

const helpers = {
  config,
  capture,
  /** Values scenes hand to later scenes (e.g. the API key created on screen). */
  state: {},
  async card({ eyebrow, title, subtitle, hold = 2600 }) {
    await stage.showPage(cardHtml({ eyebrow, title, subtitle }));
    await stage.pause(hold);
    await page.evaluate(() => window.leave());
    await stage.pause(450);
  },
  async terminal(title = 'Terminal') {
    await stage.showPage(TERMINAL_HTML);
    await page.evaluate((t) => window.setTitle(t), title);
    await stage.pause(500);
    return {
      run: async (command, output = [], { holdAfter = 900, cls = 'out', perLine = 55 } = {}) => {
        await page.evaluate((c) => window.typeCommand(c), command);
        if (output.length) await page.evaluate(([lines, k, p]) => window.printLines(lines, k, p), [output, cls, perLine]);
        await stage.pause(holdAfter);
      },
      note: async (text, holdAfter = 700) => {
        await page.evaluate((t) => window.printLines([t], 'note'), text);
        await stage.pause(holdAfter);
      },
      clear: () => page.evaluate(() => window.clearTerm()),
    };
  },
};

await stage.start();
try {
  for (const scene of scenes) {
    if (config.only && !config.only.includes(scene.id)) continue;
    try {
      await stage.scene(scene.id, scene, () => scene.run(stage, helpers));
    } catch (error) {
      await page.screenshot({ path: path.join(OUT, `failed-${scene.id}.png`) }).catch(() => undefined);
      throw new Error(`Scene "${scene.id}" failed: ${error.message}`);
    }
  }
} finally {
  const { frames, markers } = await stage.stop();
  console.log(`Recorded ${frames.length} frames across ${markers.length} scenes into ${OUT}`);
}
