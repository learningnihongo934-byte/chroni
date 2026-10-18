// Renders scene.html frame by frame in Chrome and pipes the frames to ffmpeg.
//   node render.mjs                  -> out/chroni-45s.mp4
//   node render.mjs --stills 3,12,20 -> out/still-<t>.png, to check single moments
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const FPS = 30
const here = fileURLToPath(new URL('.', import.meta.url))
mkdirSync(here + 'out', { recursive: true })

const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
await page.goto('file://' + here + 'scene.html?capture')
await page.evaluate(() => document.fonts.ready)

const stillsArg = process.argv.indexOf('--stills')
if (stillsArg > 0) {
  for (const t of process.argv[stillsArg + 1].split(',').map(Number)) {
    await page.evaluate(t => renderAt(t), t)
    await page.screenshot({ path: `${here}out/still-${t}.png` })
  }
  await browser.close()
  process.exit(0)
}

const duration = await page.evaluate(() => DURATION)
const frames = Math.round(duration * FPS)
const out = here + 'out/chroni-45s.mp4'
const ffmpeg = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out],
  { stdio: ['pipe', 'inherit', 'inherit'] })
const done = new Promise((res, rej) => ffmpeg.on('close', c => c === 0 ? res() : rej(new Error('ffmpeg exited ' + c))))

for (let f = 0; f < frames; f++) {
  await page.evaluate(t => renderAt(t), f / FPS)
  const png = await page.screenshot({ type: 'png' })
  if (!ffmpeg.stdin.write(png)) await new Promise(r => ffmpeg.stdin.once('drain', r))
  if (f % FPS === 0) process.stdout.write(`\r${f / FPS}s / ${duration}s`)
}
ffmpeg.stdin.end()
await done
await browser.close()
console.log('\nWrote ' + out)
