// Assembles the recording (out/frames + frames.json + markers.json) into:
//   out/setup-walkthrough.mp4   1080p30 H.264 (captions are already in the frames)
//   out/setup-walkthrough.srt   the same captions as a sidecar file
//   out/chapters.txt            YouTube chapter list
//   out/teaser-<name>.mp4       short clips cut from scenes tagged with `teaser`
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const OUT = path.resolve(process.env.VIDEO_OUT || 'out');
const FPS = 30;

const frames = JSON.parse(await readFile(path.join(OUT, 'frames.json'), 'utf8'));
const markers = JSON.parse(await readFile(path.join(OUT, 'markers.json'), 'utf8'));
if (!frames.length) throw new Error('No frames recorded');
const totalSeconds = frames[frames.length - 1].t + 1;

const ffmpeg = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });

const ts = (s, sep) => {
  const ms = Math.round(s * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  const rest = ms % 1000;
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return sep === 'srt'
    ? `${pad(h)}:${pad(m)}:${pad(sec)},${pad(rest, 3)}`
    : `${h}:${pad(m)}:${pad(sec)}.${pad(Math.floor(rest / 10))}`;
};

// 1. Frames → constant-rate video. Each screencast frame is shown until the next.
const concat = frames
  .map((f, i) => {
    const next = frames[i + 1];
    const duration = next ? Math.max(0.001, next.t - f.t) : 1;
    return `file '${f.file}'\nduration ${duration.toFixed(4)}`;
  })
  .join('\n');
await writeFile(path.join(OUT, 'frames.txt'), `${concat}\nfile '${frames[frames.length - 1].file}'\n`);

// 2. Captions (one per captioned scene).
const captions = markers.filter((m) => m.caption && m.end > m.start);
const srt = captions.map((c, i) => `${i + 1}\n${ts(c.start, 'srt')} --> ${ts(c.end, 'srt')}\n${c.caption}\n`).join('\n');
await writeFile(path.join(OUT, 'setup-walkthrough.srt'), srt);

// Captions are drawn in the browser during recording (lib/stage.mjs), so the
// frames already carry them; the .srt is an optional closed-caption track.

// 3. Chapters for YouTube (first must be 0:00).
const chapters = markers.filter((m) => m.chapter);
const chapterLines = chapters.map((c, i) => {
  const s = i === 0 ? 0 : Math.floor(c.start);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} ${c.chapter}`;
});
await writeFile(path.join(OUT, 'chapters.txt'), `${chapterLines.join('\n')}\n`);

// 4. Master: frames + burned-in captions.
const master = path.join(OUT, 'setup-walkthrough.mp4');
ffmpeg([
  '-f', 'concat', '-safe', '0', '-i', path.join(OUT, 'frames.txt'),
  '-vf', `fps=${FPS},scale=1920:1080:flags=lanczos,format=yuv420p`,
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-movflags', '+faststart',
  master,
]);

// 5. Teasers: concatenate the scenes tagged for each teaser, from the master.
const teasers = {};
for (const m of markers) if (m.teaser) (teasers[m.teaser] ||= []).push(m);
for (const [name, scenes] of Object.entries(teasers)) {
  const parts = [];
  for (const [i, s] of scenes.entries()) {
    const part = path.join(OUT, `_teaser-${name}-${i}.mp4`);
    ffmpeg(['-ss', String(s.start), '-to', String(s.end), '-i', master, '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-an', part]);
    parts.push(`file '${part}'`);
  }
  const list = path.join(OUT, `_teaser-${name}.txt`);
  await writeFile(list, `${parts.join('\n')}\n`);
  ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', path.join(OUT, `teaser-${name}.mp4`)]);
}

console.log(`Built ${master} (${Math.round(totalSeconds)} s), ${captions.length} captions, ${chapters.length} chapters, ${Object.keys(teasers).length} teasers.`);
