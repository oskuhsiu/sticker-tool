/**
 * Focused E2E for the independent Video → APNG workflow.
 *
 * Requires ffmpeg and a separately running Vite preview server.
 * Usage: node scripts/video-smoke.mjs http://127.0.0.1:4179/
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
  '-y',
  '-loglevel', 'error',
  '-framerate', '10',
  '-i', path.join(fixDir, 'frame_%02d.png'),
  '-c:v', 'libx264',
  '-pix_fmt', 'yuv420p',
  '-movflags', '+faststart',
  videoPath,
]);

const results = [];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ acceptDownloads: true });
page.on('pageerror', (error) => results.push(`  [pageerror] ${error.message}`));

try {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  await page.click('.tabs >> text=影片 → APNG');
  await page.setInputFiles('[data-tab="video"] input[type=file][accept^="video"]', videoPath);
  await page.waitForSelector('[data-tab="video"] >> text=建立可編輯 master APNG', { timeout: 30_000 });
  const keyCheckbox = page.getByLabel('單色色鍵去背');
  if (await keyCheckbox.isChecked()) throw new Error('影片單色色鍵去背應預設關閉');
  await page.getByLabel('來源貼圖格數').fill('6');
  await page.getByLabel('欄').fill('3');
  await page.getByLabel('列').fill('2');
  await page.getByLabel('master 取樣格數').selectOption('10');
  await page.click('[data-tab="video"] >> text=切影片並建立 master / 原切版本');
  await page.waitForSelector('[data-tab="video"] >> text=APNG 調整模式', { timeout: 180_000 });
  let previews = await page.locator('[data-tab="video"] .video-compare-grid img').count();
  if (previews !== 12) throw new Error(`6 格來源的原切/current 預覽應有 12 張，實際 ${previews}`);
  results.push('✓ 來源格數可低於 LINE 下限：3×2 → 6 組 master/baseline/current');

  await page.click('[data-tab="video"] >> text=建立 LINE 上架包');
  await page.waitForSelector('[data-tab="video"] >> text=animated 貼圖張數須為 8/16/24，收到 6', { timeout: 120_000 });
  const invalidLineButton = page.getByRole('button', { name: /下載 LINE ZIP/ });
  if (await invalidLineButton.isEnabled()) throw new Error('6 張來源不應啟用 LINE ZIP 下載');
  results.push('✓ 6 張 Project 可編輯，但 LINE ZIP validation gate 仍拒絕');

  await page.setInputFiles('[data-tab="video"] input[type=file][accept^="video"]', videoPath);
  await page.waitForSelector('[data-tab="video"] >> text=建立可編輯 master APNG', { timeout: 30_000 });
  await page.getByLabel('來源貼圖格數').fill('8');
  await page.getByLabel('欄').fill('4');
  await page.getByLabel('列').fill('2');
  await page.getByLabel('master 取樣格數').selectOption('10');
  await page.getByLabel('單色色鍵去背').check();
  await page.click('[data-tab="video"] >> text=切影片並建立 master / 原切版本');
  await page.waitForSelector('[data-tab="video"] >> text=APNG 調整模式', { timeout: 180_000 });
  previews = await page.locator('[data-tab="video"] .video-compare-grid img').count();
  if (previews !== 16) throw new Error(`原切/current 預覽應有 16 張，實際 ${previews}`);
  results.push('✓ MP4 逐時間點解碼 → 4×2 裁切 → 8 組 master/baseline/current');

  const firstCard = page.locator('[data-tab="video"] .video-settings-card').first();
  await firstCard.locator('input[type=number]').nth(2).fill('5');
  await firstCard.getByRole('button', { name: '套用這張' }).click();
  await page.waitForSelector('[data-tab="video"] >> text=第 1 張已從 master APNG 重編', { timeout: 60_000 });
  results.push('✓ 單張從 master APNG 改為 5 格，不重新讀影片');

  const projectDownload = page.waitForEvent('download');
  await page.click('[data-tab="video"] >> text=下載可再調整 Project ZIP');
  const download = await projectDownload;
  const projectPath = await download.path();
  if (!projectPath) throw new Error('Project ZIP download path unavailable');

  await page.setInputFiles('[data-tab="video"] input[type=file][accept^=".zip"]', projectPath);
  await page.waitForSelector('[data-tab="video"] >> text=未啟動影片 decoder', { timeout: 30_000 });
  const restoredFirst = page.locator('[data-tab="video"] .video-settings-card').first();
  const restoredFrames = await restoredFirst.locator('input[type=number]').nth(2).inputValue();
  if (restoredFrames !== '5') throw new Error(`重新匯入後第 1 張應為 5 格設定，實際 ${restoredFrames}`);
  results.push('✓ Project ZIP 重新匯入後恢復已調整 current 與設定');

  await page.click('[data-tab="video"] >> text=建立 LINE 上架包');
  await page.waitForSelector('[data-tab="video"] >> text=全部符合 LINE 規格', { timeout: 120_000 });
  const lineButton = page.getByRole('button', { name: /下載 LINE ZIP/ });
  if (!(await lineButton.isEnabled())) throw new Error('LINE ZIP 驗證通過後下載按鈕仍被停用');
  results.push('✓ current renders → main/tab/LINE ZIP，validation gate 通過');
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
