// Self-contained pages the recorder plays between console scenes: a terminal
// that types real commands and prints their captured output, and title cards.

const FONT_SANS = `'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
const FONT_MONO = `'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace`;

const BACKDROP = `
  html, body { margin: 0; height: 100%; background: #0b0f17; color: #e5e7eb; font-family: ${FONT_SANS}; overflow: hidden; }
  body::before { content: ''; position: fixed; inset: 0;
    background-image: linear-gradient(rgba(148,163,184,.06) 1px, transparent 1px),
                      linear-gradient(90deg, rgba(148,163,184,.06) 1px, transparent 1px);
    background-size: 48px 48px; mask-image: radial-gradient(ellipse at center, #000 30%, transparent 75%); }
`;

export const TERMINAL_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
${BACKDROP}
.win { position: absolute; left: 50%; top: 46%; width: 1500px; height: 740px; transform: translate(-50%, -50%);
  background: #0f1420; border: 1px solid #1f2937; border-radius: 14px; box-shadow: 0 30px 80px rgba(0,0,0,.55); overflow: hidden; }
.bar { height: 44px; display: flex; align-items: center; gap: 9px; padding: 0 18px; background: #131a28; border-bottom: 1px solid #1f2937; }
.dot { width: 13px; height: 13px; border-radius: 50%; }
.title { margin-left: 14px; font: 500 15px ${FONT_SANS}; color: #94a3b8; }
.body { padding: 26px 30px; font: 400 21px/1.55 ${FONT_MONO}; white-space: pre-wrap; word-break: break-word; height: calc(100% - 44px); box-sizing: border-box; overflow: hidden; }
.prompt { color: #60a5fa; } .cmd { color: #f8fafc; } .out { color: #a7b0bf; } .ok { color: #4ade80; } .note { color: #64748b; }
.caret { display: inline-block; width: 11px; height: 23px; background: #f8fafc; vertical-align: -4px; animation: blink 1s steps(1) infinite; }
@keyframes blink { 50% { opacity: 0; } }
</style></head><body>
<div class="win"><div class="bar">
  <span class="dot" style="background:#ff5f57"></span><span class="dot" style="background:#febc2e"></span><span class="dot" style="background:#28c840"></span>
  <span class="title" id="title">Terminal</span></div>
  <div class="body" id="body"><span class="caret" id="caret"></span></div></div>
<script>
  const body = document.getElementById('body');
  const caret = document.getElementById('caret');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function append(cls, text) {
    const span = document.createElement('span');
    span.className = cls;
    span.textContent = text;
    body.insertBefore(span, caret);
    while (body.scrollHeight > body.clientHeight && body.firstChild !== caret) body.removeChild(body.firstChild);
    return span;
  }
  window.setTitle = (t) => { document.getElementById('title').textContent = t; };
  window.clearTerm = () => { while (body.firstChild !== caret) body.removeChild(body.firstChild); };
  window.typeCommand = async (text, speed = 38) => {
    append('prompt', '$ ');
    const span = append('cmd', '');
    for (const ch of text) { span.textContent += ch; await sleep(ch === ' ' ? speed * 0.6 : speed + Math.random() * 25); }
    await sleep(350);
    append('cmd', '\\n');
  };
  window.printLines = async (lines, cls = 'out', perLine = 55) => {
    for (const line of lines) { append(cls, line + '\\n'); await sleep(perLine); }
  };
</script></body></html>`;

export function cardHtml({ eyebrow, title, subtitle }) {
  const esc = (s) => String(s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${BACKDROP}
.card { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); text-align: center; width: 1400px;
  animation: in 700ms cubic-bezier(.16,1,.3,1) both; }
.eyebrow { font: 600 22px ${FONT_MONO}; letter-spacing: .14em; color: #60a5fa; text-transform: uppercase; }
h1 { margin: 22px 0 18px; font: 700 84px/1.05 ${FONT_SANS}; letter-spacing: -0.03em; color: #f8fafc; }
p { margin: 0 auto; max-width: 1100px; font: 400 32px/1.45 ${FONT_SANS}; color: #94a3b8; }
.out { animation: out 450ms ease-in both; }
@keyframes in { from { opacity: 0; transform: translate(-50%, calc(-50% + 18px)); } }
@keyframes out { to { opacity: 0; transform: translate(-50%, calc(-50% - 10px)); } }
</style></head><body><div class="card" id="card">
  ${eyebrow ? `<div class="eyebrow">${esc(eyebrow)}</div>` : ''}
  <h1>${esc(title)}</h1>
  ${subtitle ? `<p>${esc(subtitle)}</p>` : ''}
</div><script>window.leave = () => document.getElementById('card').classList.add('out');</script></body></html>`;
}
