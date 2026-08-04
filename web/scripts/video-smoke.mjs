/**
 * Focused browser E2E for Video → APNG V2.
 * Requires ffmpeg and a separately running Vite preview server.
 * Usage: node scripts/video-smoke.mjs http://127.0.0.1:4179/
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { strFromU8, unzipSync } from 'fflate';
import UPNG from 'upng-js';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(new URL(import.meta.url)));
const fixDir = path.join(here, '..', '_smoke', 'video');
mkdirSync(fixDir, { recursive: true });
const BASE = process.argv[2] ?? 'http://127.0.0.1:4179/';

function makeFrame(frameIndex) {
  const width = 640;
  const height = 320;
  const cell = 160;
  const data = new Uint8Array(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel++) {
    data[pixel * 4] = 0;
    data[pixel * 4 + 1] = 255;
    data[pixel * 4 + 2] = 0;
    data[pixel * 4 + 3] = 255;
  }
  for (let sticker = 0; sticker < 8; sticker++) {
    const col = sticker % 4;
    const row = Math.floor(sticker / 4);
    const cx = col * cell + 80 + Math.round(22 * Math.sin((frameIndex + sticker) * 0.7));
    const cy = row * cell + 80 + Math.round(12 * Math.cos((frameIndex + sticker) * 0.5));
    const radius = 42;
    for (let y = cy - radius; y <= cy + radius; y++) {
      for (let x = cx - radius; x <= cx + radius; x++) {
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        if ((x - cx) ** 2 + (y - cy) ** 2 > radius ** 2) continue;
        const offset = (y * width + x) * 4;
        data[offset] = 60 + sticker * 20;
        data[offset + 1] = 40 + sticker * 10;
        data[offset + 2] = 210 - sticker * 15;
      }
    }
  }
  return { data, width, height };
}

for (let index = 0; index < 12; index++) {
  const frame = makeFrame(index);
  const png = UPNG.encode([frame.data.buffer], frame.width, frame.height, 0);
  writeFileSync(path.join(fixDir, `frame_${String(index).padStart(2, '0')}.png`), Buffer.from(png));
}
const videoPath = path.join(fixDir, 'grid-4x2.mp4');
execFileSync('/usr/local/bin/ffmpeg', [
  '-y', '-loglevel', 'error', '-framerate', '10', '-i', path.join(fixDir, 'frame_%02d.png'),
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', videoPath,
]);

const results = [];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ acceptDownloads: true });
page.on('dialog', (dialog) => dialog.accept());
page.on('pageerror', (error) => results.push(`  [pageerror] ${error.message}`));
let modelRequested = false;
page.on('request', (request) => {
  if (request.url().includes('/imgly/') || /birefnet.*\.onnx/i.test(request.url())) modelRequested = true;
});

async function uploadVideo() {
  await page.setInputFiles('[data-tab="video"] input[type=file][accept^="video"]', videoPath);
  await page.waitForSelector('[data-tab="video"] >> text=12 個 presentation frames', { timeout: 120_000 });
}

async function configureSource(count, cols, rows) {
  await page.getByLabel('來源貼圖格數').fill(String(count));
  await page.getByLabel('欄').fill(String(cols));
  await page.getByLabel('列').fill(String(rows));
  await page.getByLabel('專案預設去背').selectOption('color-key');
  await page.waitForSelector(`[data-tab="video"] >> text=實際來源 frames：${12}`);
}

async function assertGridPreviewsAligned() {
  await page.waitForFunction(() => {
    const previews = [...document.querySelectorAll('[data-tab="video"] .video-grid-preview')];
    return previews.length === 4 && previews.every((preview) => preview.querySelector('img')?.complete);
  });
  const mismatches = await page.locator('[data-tab="video"] .video-grid-preview').evaluateAll((previews) =>
    previews.flatMap((preview, index) => {
      const image = preview.querySelector('img')?.getBoundingClientRect();
      const overlay = preview.querySelector('svg')?.getBoundingClientRect();
      if (!image || !overlay) return [`preview ${index + 1} 缺少 image 或 grid overlay`];
      const delta = {
        left: Math.abs(image.left - overlay.left),
        top: Math.abs(image.top - overlay.top),
        width: Math.abs(image.width - overlay.width),
        height: Math.abs(image.height - overlay.height),
      };
      return Object.values(delta).some((value) => value > 0.5)
        ? [`preview ${index + 1} grid/image bounds 不一致：${JSON.stringify(delta)}`]
        : [];
    }),
  );
  if (mismatches.length) throw new Error(mismatches.join('\n'));
}

async function buildRawMaster(expectedCount) {
  await page.getByRole('button', { name: '擷取範圍內所有 frames 並建立 raw master' }).click();
  await page.waitForSelector('[data-tab="video"] >> text=逐張 exact-target 編輯', { timeout: 180_000 });
  const items = await page.locator('[data-tab="video"] .video-sticker-list-item').count();
  if (items !== expectedCount) throw new Error(`貼圖列表應有 ${expectedCount} 張，實際 ${items}`);
  await page.waitForSelector('[data-tab="video"] >> text=12 source samples');
}

async function renderAll() {
  const button = page.getByRole('button', { name: '依序產生所有 dirty previews' });
  await button.click();
  await page.waitForSelector('[data-tab="video"] >> text=所有 dirty previews 已通過', { timeout: 240_000 });
}

try {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  await page.click('.tabs >> text=影片 → APNG');

  await uploadVideo();
  const metadataText = await page.locator('[data-tab="video"] .video-source-card .tab-desc').first().textContent();
  if (!metadataText?.includes('12 個 presentation frames')) throw new Error('probe 未顯示實際 12 格');
  if (await page.locator('label', { hasText: 'master 取樣格數' }).count()) throw new Error('V2 不應再顯示 master 取樣格數');
  await configureSource(6, 3, 2);
  await assertGridPreviewsAligned();
  results.push('✓ 四個時間預覽的裁切格線與影像 bounds 完全對齊');
  await buildRawMaster(6);
  if (modelRequested) throw new Error('raw ingest 與 color-key 不應下載語意去背模型');
  results.push('✓ 12 個 presentation frames 全數進入 6 張 raw master，沒有固定 20 格取樣器');

  await page.getByRole('button', { name: '建立 LINE ZIP / 最終驗證' }).click();
  await page.waitForSelector('[data-tab="video"] >> text=缺少必要 sticker bytes');
  if (await page.locator('[role="dialog"] >> text=這不是符合 LINE Sticker 規則的 ZIP').count()) {
    throw new Error('缺少必要 bytes 的結構性失敗不應提供 override dialog');
  }
  await renderAll();
  await page.getByRole('button', { name: '建立 LINE ZIP / 最終驗證' }).click();
  await page.waitForSelector('[role="dialog"] >> text=這不是符合 LINE Sticker 規則的 ZIP', { timeout: 120_000 });
  await page.waitForSelector('[role="dialog"] >> text=animated 貼圖張數須為 8/16/24，收到 6');
  await page.waitForSelector('[role="dialog"] >> text=我了解，下載標示為不合規的 ZIP');
  await page.getByRole('button', { name: '返回修正' }).click();
  results.push('✓ 缺 bytes 時硬阻擋；6 張有完整 bytes 時只提供明確標示的不合規 override');

  await uploadVideo();
  await configureSource(8, 4, 2);
  await buildRawMaster(8);
  await renderAll();

  await page.getByLabel('目標格數').fill('5');
  await page.getByRole('button', { name: '產生這張預覽' }).click();
  await page.waitForSelector('[data-tab="video"] >> text=第 1 張 exact-target 成品已通過 final-byte gate', { timeout: 120_000 });
  await page.waitForSelector('[data-tab="video"] >> text=final 5/5 格');
  await page.waitForSelector('[data-tab="video"] canvas[aria-label="第 1 張成品預覽"]');
  await page.getByRole('button', { name: '暫停' }).click();
  await page.getByRole('button', { name: '重新開始' }).click();
  const players = await page.locator('[data-tab="video"] .apng-timeline-player').count();
  if (players !== 1) throw new Error(`一次只應有一個 active controlled player，實際 ${players}`);
  results.push('✓ 單張 hard target=5 從 raw master 重編，controlled player 使用 final decoded timing');

  const projectDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '下載 Project ZIP V2' }).click();
  const projectDownload = await projectDownloadPromise;
  const projectPath = await projectDownload.path();
  if (!projectPath) throw new Error('Project V2 download path unavailable');
  const entries = unzipSync(new Uint8Array(readFileSync(projectPath)));
  const manifest = JSON.parse(strFromU8(entries['sticker-project.json']));
  if (manifest.version !== 2 || manifest.frameCoverage !== 'all-presentation-frames' || manifest.backgroundStage !== 'raw') {
    throw new Error('Project manifest 不是 all-frame/raw V2');
  }
  if (manifest.master.sourceFrameCount !== 12) throw new Error(`Project 應保存 12 source refs，實際 ${manifest.master.sourceFrameCount}`);
  for (const sticker of manifest.master.stickers) {
    const samples = sticker.chunks.reduce((sum, chunk) => sum + chunk.sampleRefs.length, 0);
    if (samples !== 12) throw new Error(`${sticker.id} 只保存 ${samples}/12 sample refs`);
  }
  if (Object.keys(entries).some((entry) => entry.startsWith('source/') || entry.startsWith('audio/'))) {
    throw new Error('Project V2 不得內嵌 source video/audio');
  }
  results.push('✓ Project V2 manifest/ZIP 保存每張完整 12 sample refs、raw checksums，且不含來源影片或音軌');

  await page.setInputFiles('[data-tab="video"] input[type=file][accept^=".zip"]', projectPath);
  await page.waitForSelector('[data-tab="video"] >> text=已恢復 Project V2 的 12 個 sample refs', { timeout: 120_000 });
  if (await page.getByLabel('目標格數').inputValue() !== '5') throw new Error('V2 re-import 未恢復第 1 張 target=5');
  await page.waitForSelector('[data-tab="video"] >> text=final 5/5 格');
  results.push('✓ Project V2 可在沒有原影片與 decoder 的情況下恢復 draft/current/editor');

  await page.getByRole('button', { name: '建立 LINE ZIP / 最終驗證' }).click();
  await page.waitForSelector('[data-tab="video"] >> text=全部符合 LINE 規格', { timeout: 180_000 });
  const lineDownload = page.getByRole('button', { name: /下載 LINE ZIP/ });
  if (!(await lineDownload.isEnabled())) throw new Error('合規 final bytes 未開放一般 LINE ZIP');
  if (modelRequested) throw new Error('整個 color-key V2 smoke 不應下載語意模型');
  results.push('✓ 8 張 current + cover actual timeline → main/tab/LINE ZIP，final-byte validation 通過');
} catch (error) {
  results.push(`✗ 失敗：${error.message}`);
  try {
    await page.screenshot({ path: path.join(fixDir, 'failure.png'), fullPage: true });
    results.push(`  截圖：${path.join(fixDir, 'failure.png')}`);
  } catch {}
  process.exitCode = 1;
} finally {
  await browser.close();
}

console.log(results.join('\n'));
