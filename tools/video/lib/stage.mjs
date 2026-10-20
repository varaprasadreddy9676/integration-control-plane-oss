// Recording stage: one Chromium page captured with the DevTools screencast
// (sharper than Playwright's built-in video), a visible cursor, human-paced
// input, and scene markers that drive captions and teaser cuts.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

export const WIDTH = 1920;
export const HEIGHT = 1080;

const CURSOR_SCRIPT = `
(() => {
  const install = () => {
    if (document.getElementById('__cursor')) return;
    const style = document.createElement('style');
    style.textContent = \`
      #__cursor { position: fixed; z-index: 2147483647; pointer-events: none; width: 22px; height: 22px;
        transform: translate(-3px, -2px); transition: transform 60ms ease-out; }
      #__cursor svg { filter: drop-shadow(0 2px 3px rgba(0,0,0,.35)); }
      .__ripple { position: fixed; z-index: 2147483646; pointer-events: none; width: 44px; height: 44px;
        margin: -22px 0 0 -22px; border-radius: 50%; border: 2px solid rgba(59,130,246,.9);
        background: rgba(59,130,246,.18); animation: __ripple 520ms ease-out forwards; }
      @keyframes __ripple { from { transform: scale(.3); opacity: 1; } to { transform: scale(1.4); opacity: 0; } }
      #__caption { position: fixed; z-index: 2147483645; left: 50%; bottom: 56px; transform: translateX(-50%);
        max-width: 1500px; padding: 16px 30px; border-radius: 14px; background: rgba(17,24,39,.86);
        color: #fff; font: 500 34px/1.35 'Inter', -apple-system, 'Segoe UI', sans-serif; text-align: center;
        box-shadow: 0 10px 30px rgba(0,0,0,.25); pointer-events: none; opacity: 0; transition: opacity 220ms ease; }
      #__caption.on { opacity: 1; }
    \`;
    document.documentElement.appendChild(style);
    const cursor = document.createElement('div');
    cursor.id = '__cursor';
    cursor.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M3 2l7.5 19 2.6-7.9L21 10.5z" fill="#111827" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    cursor.style.left = (window.__cursorX ?? 960) + 'px';
    cursor.style.top = (window.__cursorY ?? 540) + 'px';
    document.documentElement.appendChild(cursor);
    const caption = document.createElement('div');
    caption.id = '__caption';
    document.documentElement.appendChild(caption);
    window.__setCaption = (text) => {
      caption.textContent = text || '';
      caption.classList.toggle('on', Boolean(text));
    };
    if (window.__pendingCaption) window.__setCaption(window.__pendingCaption);
    addEventListener('mousemove', (e) => {
      cursor.style.left = e.clientX + 'px';
      cursor.style.top = e.clientY + 'px';
    }, true);
    addEventListener('mousedown', (e) => {
      const r = document.createElement('div');
      r.className = '__ripple';
      r.style.left = e.clientX + 'px';
      r.style.top = e.clientY + 'px';
      document.documentElement.appendChild(r);
      setTimeout(() => r.remove(), 600);
    }, true);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
})();
`;

export async function openStage({ outDir, headless = true }) {
  await mkdir(path.join(outDir, 'frames'), { recursive: true });
  // CHROMIUM_PATH: use an already-installed Chromium instead of Playwright's bundled one.
  const browser = await chromium.launch({ headless, executablePath: process.env.CHROMIUM_PATH || undefined });
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1,
    locale: 'en-US',
    timezoneId: process.env.VIDEO_TZ || 'UTC',
  });
  await context.addInitScript(CURSOR_SCRIPT);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);

  const frames = [];
  const markers = [];
  let mouse = { x: WIDTH / 2, y: HEIGHT / 2 };
  // One clock for frames and scene markers: wall time since start(). The
  // screencast's metadata.timestamp is also wall-clock seconds.
  let t0 = null;
  const now = () => (t0 === null ? 0 : Date.now() / 1000 - t0);

  cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
    await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => undefined);
    if (t0 === null) return;
    const file = path.join(outDir, 'frames', `${String(frames.length).padStart(6, '0')}.jpg`);
    frames.push({ file, t: Math.max(0, metadata.timestamp - t0) });
    await writeFile(file, Buffer.from(data, 'base64'));
  });

  let currentCaption = '';
  const applyCaption = () =>
    page
      .evaluate((text) => {
        window.__pendingCaption = text;
        if (window.__setCaption) window.__setCaption(text);
      }, currentCaption)
      .catch(() => undefined);
  page.on('load', applyCaption);
  page.on('domcontentloaded', applyCaption);

  const stage = {
    page,
    /** Pages set with setContent() skip init scripts; install the overlay explicitly. */
    async showPage(html) {
      await page.setContent(html);
      await page.evaluate(CURSOR_SCRIPT);
      await applyCaption();
    },
    /** Shows a caption over whatever is on screen until changed. */
    async caption(text) {
      currentCaption = text || '';
      await applyCaption();
    },
    async start() {
      t0 = Date.now() / 1000;
      await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: WIDTH, maxHeight: HEIGHT });
      await stage.pause(300);
    },
    async stop() {
      await stage.pause(600);
      await cdp.send('Page.stopScreencast').catch(() => undefined);
      await writeFile(path.join(outDir, 'frames.json'), JSON.stringify(frames));
      await writeFile(path.join(outDir, 'markers.json'), JSON.stringify(markers, null, 2));
      await browser.close();
      return { frames, markers };
    },
    pause: (ms) => page.waitForTimeout(ms),
    /** Marks a scene; `caption` is burned in while it plays, `chapter` starts a chapter. */
    async scene(id, { caption, chapter, teaser } = {}, body) {
      if (caption !== undefined) await stage.caption(caption);
      const start = now();
      markers.push({ id, caption: caption || null, chapter: chapter || null, teaser: teaser || null, start, end: null });
      const marker = markers[markers.length - 1];
      try {
        await body();
      } finally {
        marker.end = now();
      }
    },
    /** Glide the cursor to a locator's centre, as a person would. */
    async moveTo(locator, { steps = 22 } = {}) {
      await locator.scrollIntoViewIfNeeded();
      let box = await locator.boundingBox();
      // Sticky footers and the caption cover the screen edges; centre targets that sit there.
      if (box && (box.y < 70 || box.y + box.height > HEIGHT - 150)) {
        await locator.evaluate((el) => el.scrollIntoView({ block: 'center' }));
        await page.waitForTimeout(250);
        box = await locator.boundingBox();
      }
      if (!box) throw new Error(`Not visible: ${locator}`);
      const x = box.x + Math.min(box.width / 2, 120);
      const y = box.y + box.height / 2;
      await page.mouse.move(x, y, { steps });
      mouse = { x, y };
      await page.evaluate(([cx, cy]) => {
        window.__cursorX = cx;
        window.__cursorY = cy;
      }, [x, y]);
    },
    async click(locator, { pauseAfter = 450 } = {}) {
      await stage.moveTo(locator);
      await stage.pause(140);
      await page.mouse.down();
      await page.mouse.up();
      await stage.pause(pauseAfter);
    },
    /** Types like a person; `paste` drops the text in at once, as pasting a URL would. */
    async type(locator, text, { delay = 45, clear = false, paste = false } = {}) {
      await stage.click(locator, { pauseAfter: 150 });
      if (paste) {
        await locator.fill(text);
        await stage.pause(500);
        return;
      }
      if (clear) {
        await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
        await page.keyboard.press('Backspace');
      }
      await page.keyboard.type(text, { delay });
      await stage.pause(250);
    },
    get mouse() {
      return mouse;
    },
  };
  return stage;
}
