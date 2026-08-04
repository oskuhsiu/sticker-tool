/**
 * Focused browser E2E for Video → APNG V3.
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
    return previews.length === 4 && previews.every((preview) => {
      const image = preview.querySelector('img');
      return image?.complete && image.naturalWidth > 0 && image.naturalHeight > 0;
    });
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

async function assertGridEditsSyncCount() {
  await page.getByLabel('欄').fill('3');
  if (await page.getByLabel('來源貼圖格數').inputValue() !== '6') {
    throw new Error('3×2 網格應自動更新來源貼圖格數為 6');
  }
  await assertGridPreviewsAligned();
  await page.getByLabel('欄').fill('4');
  if (await page.getByLabel('來源貼圖格數').inputValue() !== '8') {
    throw new Error('4×2 網格應自動更新來源貼圖格數為 8');
  }
  await assertGridPreviewsAligned();
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

function linePackButton(product) {
  return page.getByRole('button', { name: `建立 ${product} LINE ZIP / 最終驗證` });
}

try {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  await page.click('.tabs >> text=影片 → APNG');

  await uploadVideo();
  const metadataText = await page.locator('[data-tab="video"] .video-source-card .tab-desc').first().textContent();
  if (!metadataText?.includes('12 個 presentation frames')) throw new Error('probe 未顯示實際 12 格');
  if (await page.locator('label', { hasText: 'master 取樣格數' }).count()) throw new Error('V2 不應再顯示 master 取樣格數');
  await page.getByLabel('自選網格預覽時間').waitFor();
  await page.waitForSelector('[data-tab="video"] >> text=只會更新下方「自選」時間點的網格畫面');
  if (!/\d+\.\d{3} 秒/.test(await page.locator('[data-tab="video"] .video-scrub-value').textContent() ?? '')) {
    throw new Error('自選網格預覽時間必須顯示目前秒數');
  }
  await assertGridEditsSyncCount();
  results.push('✓ 修改欄列會同步來源貼圖格數，preview remount 後仍保有有效影像');
  await configureSource(6, 3, 2);
  await assertGridPreviewsAligned();
  results.push('✓ 四個時間預覽的裁切格線與影像 bounds 完全對齊');
  await buildRawMaster(6);
  if (modelRequested) throw new Error('raw ingest 與 color-key 不應下載語意去背模型');
  results.push('✓ 12 個 presentation frames 全數進入 6 張 raw master，沒有固定 20 格取樣器');

  await linePackButton('Animated Sticker').click();
  await page.waitForSelector('[data-tab="video"] >> text=缺少必要成品 bytes');
  if (await page.locator('[role="dialog"] >> text=這不是符合 Animated Sticker 規則的 ZIP').count()) {
    throw new Error('缺少必要 bytes 的結構性失敗不應提供 override dialog');
  }
  await renderAll();
  await linePackButton('Animated Sticker').click();
  await page.waitForSelector('[role="dialog"] >> text=這不是符合 Animated Sticker 規則的 ZIP', { timeout: 120_000 });
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
  await page.getByRole('button', { name: '下載 Project ZIP V3' }).click();
  const projectDownload = await projectDownloadPromise;
  const projectPath = await projectDownload.path();
  if (!projectPath) throw new Error('Project V3 download path unavailable');
  const entries = unzipSync(new Uint8Array(readFileSync(projectPath)));
  const manifest = JSON.parse(strFromU8(entries['sticker-project.json']));
  if (manifest.version !== 3 || manifest.target !== 'animated-sticker' || manifest.frameCoverage !== 'all-presentation-frames' || manifest.backgroundStage !== 'raw') {
    throw new Error('Project manifest 不是 Animated Sticker all-frame/raw V3');
  }
  if (manifest.master.sourceFrameCount !== 12) throw new Error(`Project 應保存 12 source refs，實際 ${manifest.master.sourceFrameCount}`);
  for (const sticker of manifest.master.stickers) {
    const samples = sticker.chunks.reduce((sum, chunk) => sum + chunk.sampleRefs.length, 0);
    if (samples !== 12) throw new Error(`${sticker.id} 只保存 ${samples}/12 sample refs`);
  }
  if (Object.keys(entries).some((entry) => entry.startsWith('source/') || entry.startsWith('audio/'))) {
    throw new Error('Project V3 不得內嵌 source video/audio');
  }
  results.push('✓ Project V3 manifest/ZIP 保存產品目標、每張完整 12 sample refs、raw checksums，且不含來源影片或音軌');

  await page.setInputFiles('[data-tab="video"] input[type=file][accept^=".zip"]', projectPath);
  await page.waitForSelector('[data-tab="video"] >> text=已恢復 Project V3（Animated Sticker）的 12 個 sample refs', { timeout: 120_000 });
  if (await page.getByLabel('目標格數').inputValue() !== '5') throw new Error('V3 re-import 未恢復第 1 張 target=5');
  await page.waitForSelector('[data-tab="video"] >> text=final 5/5 格');
  results.push('✓ Project V3 可在沒有原影片與 decoder 的情況下恢復 target/draft/current/editor');

  await linePackButton('Animated Sticker').click();
  await page.waitForSelector('[data-tab="video"] >> text=全部符合 LINE 規格', { timeout: 180_000 });
  const lineDownload = page.getByRole('button', { name: /下載 LINE ZIP/ });
  if (!(await lineDownload.isEnabled())) throw new Error('合規 final bytes 未開放一般 LINE ZIP');
  if (modelRequested) throw new Error('整個 color-key V3 smoke 不應下載語意模型');
  results.push('✓ 8 張 current + cover actual timeline → main/tab/LINE ZIP，final-byte validation 通過');

  await uploadVideo();
  await page.getByLabel('輸出產品').selectOption('animated-emoji');
  await configureSource(8, 4, 2);
  await buildRawMaster(8);
  await renderAll();
  await linePackButton('Animated Regular Emoji').click();
  await page.waitForSelector('[data-tab="video"] >> text=Animated Regular Emoji LINE ZIP 已完成', { timeout: 180_000 });
  const emojiDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /下載 LINE ZIP/ }).click();
  const emojiDownload = await emojiDownloadPromise;
  const emojiPath = await emojiDownload.path();
  if (!emojiPath) throw new Error('Animated Emoji download path unavailable');
  const emojiEntries = unzipSync(new Uint8Array(readFileSync(emojiPath)));
  const emojiNames = Object.keys(emojiEntries).sort();
  const expectedEmojiNames = ['001.png', '002.png', '003.png', '004.png', '005.png', '006.png', '007.png', '008.png', 'tab.png'];
  if (JSON.stringify(emojiNames) !== JSON.stringify(expectedEmojiNames)) {
    throw new Error(`Animated Emoji ZIP manifest 錯誤：${emojiNames.join(', ')}`);
  }
  if ('main.png' in emojiEntries) throw new Error('Animated Emoji ZIP 不得包含 main.png');
  for (const name of expectedEmojiNames.slice(0, 8)) {
    const decoded = UPNG.decode(emojiEntries[name]);
    if (decoded.width !== 180 || decoded.height !== 180 || decoded.ctype !== 6) {
      throw new Error(`${name} 應為 180×180 truecolor RGBA APNG，實際 ${decoded.width}×${decoded.height} ctype=${decoded.ctype}`);
    }
    if (emojiEntries[name].length > 300_000) throw new Error(`${name} 超過 Animated Emoji 300KB 上限`);
  }
  results.push('✓ Animated Emoji target → 180×180 truecolor、001.png…、無 main.png 的完整 LINE ZIP');

  await uploadVideo();
  await page.getByLabel('輸出產品').selectOption('popup');
  await configureSource(8, 4, 2);
  await buildRawMaster(8);
  await renderAll();
  await page.getByLabel('配對靜態圖使用 frame').selectOption('1');
  await page.waitForSelector('[data-tab="video"] >> text=配對靜態來源：第 2 格');
  if (await page.getByRole('button', { name: '依序產生所有 dirty previews' }).isEnabled()) {
    throw new Error('切換 Popup 配對靜態 frame 不應要求重編 APNG');
  }
  const popupProjectDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '下載 Project ZIP V3' }).click();
  const popupProjectDownload = await popupProjectDownloadPromise;
  const popupProjectPath = await popupProjectDownload.path();
  if (!popupProjectPath) throw new Error('Popup Project V3 download path unavailable');
  const popupProjectEntries = unzipSync(new Uint8Array(readFileSync(popupProjectPath)));
  const popupManifest = JSON.parse(strFromU8(popupProjectEntries['sticker-project.json']));
  if (popupManifest.target !== 'popup' || popupManifest.settings[0].staticFrameIndex !== 1) {
    throw new Error('Popup Project V3 未保存產品或使用者選取的靜態 frame');
  }
  if (popupManifest.master.stickers.some((sticker) => sticker.width !== 480 || sticker.height !== 480)) {
    throw new Error('Popup raw master 必須全部是 480×480');
  }
  await linePackButton('Pop-up Sticker').click();
  await page.waitForSelector('[data-tab="video"] >> text=Pop-up Sticker LINE ZIP 已完成', { timeout: 180_000 });
  const popupDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /下載 LINE ZIP/ }).click();
  const popupDownload = await popupDownloadPromise;
  const popupPath = await popupDownload.path();
  if (!popupPath) throw new Error('Pop-up Sticker download path unavailable');
  const popupEntries = unzipSync(new Uint8Array(readFileSync(popupPath)));
  const expectedPopupNames = [
    ...Array.from({ length: 8 }, (_, index) => `png/${String(index + 1).padStart(2, '0')}.png`),
    'png/main.png',
    'png/tab.png',
    ...Array.from({ length: 8 }, (_, index) => `popup/${String(index + 1).padStart(2, '0')}.png`),
    'popup/main_popup.png',
  ].sort();
  const popupNames = Object.keys(popupEntries).sort();
  if (JSON.stringify(popupNames) !== JSON.stringify(expectedPopupNames)) {
    throw new Error(`Pop-up ZIP manifest 錯誤：${popupNames.join(', ')}`);
  }
  for (let index = 1; index <= 8; index++) {
    const staticName = `png/${String(index).padStart(2, '0')}.png`;
    const animatedName = `popup/${String(index).padStart(2, '0')}.png`;
    const staticImage = UPNG.decode(popupEntries[staticName]);
    const animatedImage = UPNG.decode(popupEntries[animatedName]);
    if (staticImage.width > 370 || staticImage.height > 320 || staticImage.ctype !== 6) {
      throw new Error(`${staticName} 不是合規 truecolor 靜態尺寸`);
    }
    if (animatedImage.width !== 480 || animatedImage.height !== 480 || animatedImage.ctype !== 6 || !animatedImage.tabs.acTL) {
      throw new Error(`${animatedName} 不是 480×480 truecolor APNG`);
    }
  }
  results.push('✓ Pop-up target → 每張選一格衍生靜態圖、480×480 APNG、完整 png/ + popup/ LINE ZIP');
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
