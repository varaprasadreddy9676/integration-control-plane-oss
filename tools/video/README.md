# Setup walkthrough video

Records the "from `docker compose` to three live integrations" walkthrough
against a real, fresh install, then builds:

| File | What |
|------|------|
| `out/setup-walkthrough.mp4` | Full walkthrough, 1080p30 H.264, captions burned in |
| `out/setup-walkthrough.srt` | The same captions as a sidecar track |
| `out/chapters.txt` | YouTube chapter list (paste into the description) |
| `out/teaser-outbound.mp4`, `teaser-inbound.mp4`, `teaser-scheduled.mp4` | Short clips cut from the walkthrough |

Everything on screen is real: the console is driven by Playwright, terminal
output comes from `capture/*.txt` (recorded from a fresh install), and the
`curl` calls in the terminal scenes are actually made against the stack, so
their responses are genuine.

## Re-record

Needs Docker, Node 18+, and ffmpeg.

1. Start a fresh install somewhere (ports 80 and 3545 free):

   ```bash
   git clone <this repo> video-env && cd video-env
   ./scripts/init-env.sh && docker compose up -d --build
   ```

2. Reset it to an empty database with one super admin:

   ```bash
   ./tools/video/reset.sh path/to/video-env
   ```

3. Record and build (from `tools/video`):

   ```bash
   npm install
   npm run record    # ~4.5 minutes, headless
   npm run build     # ~1-2 minutes
   ```

The demo targets are public echo services (`httpbin.org`, `jsonplaceholder.typicode.com`)
because the gateway blocks private network targets by default.

## Options

| Variable | Default | Use |
|----------|---------|-----|
| `CONSOLE_URL` | `http://localhost/integration-gateway` | Console under test |
| `API_URL` | `http://localhost:3545/api/v1` | API for the terminal scenes |
| `REPO_URL` | GitHub URL | Shown in the `git clone` step and the outro |
| `ONLY` | all scenes | Comma-separated scene ids, for iterating on one scene |
| `HEADED=1` | headless | Watch the browser while recording |
| `CHROMIUM_PATH` | Playwright's Chromium | Use an already-installed Chromium |
| `VIDEO_TZ` | `UTC` | Browser timezone (shown in the schedule step) |

A failing scene saves `out/failed-<scene>.png`. Scenes live in `scenes.mjs`;
each has an optional `chapter`, a `caption`, and a `teaser` tag.
