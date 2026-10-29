#!/usr/bin/env node
/**
 * One scene of a strand, recorded as a video: the player in capture mode, stepped through the scene's moments at a
 * fixed frame rate (at the page's usual 2× by default) from the reader's camera, each event as a caption under the
 * stage; the frames go to ffmpeg as a WebM (VP8), through one file of concatenated JPEG frames (the ffmpeg Playwright
 * keeps reads neither a pipe nor a file pattern, but reads an image stream from a file).
 *
 *   node playground/record-scene.mjs <strand-page.html> <scene-id> <out.webm> --vendor <dir> [--fps 15] [--speed 2] [--ffmpeg <path>]
 *
 * The page is the strand exporter's output with --vendor; <dir> holds its three.js files. Renders with the installed
 * Google Chrome, headless. ffmpeg defaults to the one Playwright keeps in its cache.
 */
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { browser, serve } from './two-view-things.mjs';

const { values, positionals } = parseArgs({ allowPositionals: true, options: { vendor: { type: 'string' }, fps: { type: 'string', default: '15' }, speed: { type: 'string', default: '2' }, ffmpeg: { type: 'string', default: `${homedir()}/Library/Caches/ms-playwright/ffmpeg-1011/ffmpeg-mac` } } });
const [page, scene, out] = positionals;
if (!page || !scene || !out || !values.vendor) throw new Error('Usage: node playground/record-scene.mjs <strand-page.html> <scene-id> <out.webm> --vendor <dir> [--fps 15] [--speed 2]');
const fps = Number(values.fps), step = Number(values.speed) / fps, started = Date.now();
const { server, url } = await serve(resolve(page), resolve(values.vendor)), chrome = await browser();
const stream = `${resolve(out)}.mjpeg`, frameFile = createWriteStream(stream);
let frames = 0;
try {
  await chrome.open(url);
  const timeline = await chrome.evaluate(`window.__stage.timeline(${JSON.stringify(scene)})`);
  if (!timeline.length) throw new Error(`No scene ${scene} in this strand`);
  for (const segment of timeline) for (let t = segment.start; t < segment.end; t += step) {
    await chrome.evaluate(`window.__stage.capture(${JSON.stringify({ id: 'frame', at: t, place: segment.place, caption: segment.text })})`);
    const jpeg = Buffer.from(await chrome.still('jpeg'), 'base64');
    if (!frameFile.write(jpeg)) await new Promise(done => frameFile.once('drain', done));
    frames++;
  }
} finally { await new Promise(done => frameFile.end(done)); await chrome.close(); server.close(); }
const encoder = spawn(values.ffmpeg, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(fps), '-i', `file:${stream}`, '-c:v', 'libvpx', '-b:v', '2500k', '-crf', '8', '-auto-alt-ref', '0', resolve(out)], { stdio: 'inherit' });
await new Promise((done, fail) => encoder.on('close', code => (code === 0 ? done() : fail(new Error(`ffmpeg exited with ${code}`)))));
await rm(stream, { force: true });
console.log(JSON.stringify({ out: resolve(out), scene, frames, seconds: Math.round(frames / fps * 10) / 10, took: (Date.now() - started) / 1000 }));
