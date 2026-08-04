/**
 * 端到端冒煙測試（headless Chrome × vite preview 的 dist 產物）：
 *   0. Colab + BiRefNet 獨立教學頁：可直接開啟與回主工具
 *   1. 本機圖片打包：8 張透明底圖 → 靜態包 → 驗證全過
 *   2. 組圖切格：4×2 綠幕組圖 → 色鍵去背切格 → 靜態包 → 驗證全過
 *   3. 動態 APNG（單組圖）：4×4 透明底影格組圖 → APNG → 驗證全過
 *   4. 產圖 Prompt：靜態/動態 prompt 內容檢查
 * 用法：node scripts/smoke.mjs <previewURL>
 * 產出 fixtures 到 _smoke/，結果印到 stdout（CI/終端可讀）。
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import UPNG from 'upng-js';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(new URL(import.meta.url)));
const fixDir = path.join(here, '..', '_smoke');
mkdirSync(fixDir, { recursive: true });

const BASE = process.argv[2] ?? 'http://127.0.0.1:4179/';

// ---------- fixture 產生 ----------

function makeCanvas(w, h, fill = [0, 0, 0, 0]) {
  const data = new Uint8Array(w * h * 4);
  for (let p = 0; p < w * h; p++) {
    data[p * 4] = fill[0];
    data[p * 4 + 1] = fill[1];
    data[p * 4 + 2] = fill[2];
    data[p * 4 + 3] = fill[3];
  }
  return { data, w, h };
}

function fillCircle(c, cx, cy, r, [R, G, B, A]) {
  for (let y = Math.max(0, cy - r); y <= Math.min(c.h - 1, cy + r); y++) {
    for (let x = Math.max(0, cx - r); x <= Math.min(c.w - 1, cx + r); x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) {
        const i = (y * c.w + x) * 4;
        c.data[i] = R;
        c.data[i + 1] = G;
        c.data[i + 2] = B;
        c.data[i + 3] = A;
      }
    }
  }
}

function savePng(c, name) {
  const ab = UPNG.encode([c.data.buffer], c.w, c.h, 0);
  const p = path.join(fixDir, name);
  writeFileSync(p, Buffer.from(ab));
  return p;
}

// 1) 8 張透明底單圖（彩色身體 + 深色頭：給去背/fit 流程）
const singles = [];
for (let i = 0; i < 8; i++) {
  const c = makeCanvas(420, 380);
  fillCircle(c, 210, 230, 120, [60 + i * 20, 120, 200 - i * 15, 255]); // 身體
  fillCircle(c, 210, 110, 70, [30, 30, 60, 255]); // 深色頭
  singles.push(savePng(c, `single_${String(i + 1).padStart(2, '0')}.png`));
}

// 1b) 8 張白底單圖（SMOKE_IMGLY=1：真模型去背與 alpha 驗證）
const opaqueSingles = [];
for (let i = 0; i < 8; i++) {
  const c = makeCanvas(320, 320, [246, 242, 232, 255]);
  fillCircle(c, 160 + i - 4, 205, 76, [225, 112 + i * 5, 65, 255]);
  fillCircle(c, 160 + i - 4, 105, 58, [45, 52, 70, 255]);
  opaqueSingles.push(savePng(c, `opaque_${String(i + 1).padStart(2, '0')}.png`));
}

// 2) 4×2 綠幕組圖（純綠底，主體置中留縫：走 chroma key 路徑，不需 onnx 模型）
{
  const cellW = 400;
  const cellH = 400;
  const c = makeCanvas(cellW * 4, cellH * 2, [0, 255, 0, 255]);
  for (let k = 0; k < 8; k++) {
    const col = k % 4;
    const row = (k / 4) | 0;
    const cx = col * cellW + cellW / 2;
    const cy = row * cellH + cellH / 2;
    fillCircle(c, cx, cy + 40, 110, [220, 80 + k * 15, 90, 255]); // 身體
    fillCircle(c, cx, cy - 80, 60, [25, 25, 50, 255]); // 深色頭
  }
  savePng(c, 'sheet_green_4x2.png');
}

// 2b) 4×2 白底組圖（走 opaque → @imgly 語意去背路徑；SMOKE_IMGLY=1 才測）
{
  const cellW = 400;
  const cellH = 400;
  const c = makeCanvas(cellW * 4, cellH * 2, [250, 250, 250, 255]);
  for (let k = 0; k < 8; k++) {
    const col = k % 4;
    const row = (k / 4) | 0;
    const cx = col * cellW + cellW / 2;
    const cy = row * cellH + cellH / 2;
    fillCircle(c, cx, cy + 40, 110, [200, 60 + k * 18, 80, 255]);
    fillCircle(c, cx, cy - 80, 60, [25, 25, 50, 255]);
  }
  savePng(c, 'sheet_white_4x2.png');
}

// 3) 4×4 透明底影格組圖（深色球水平小幅移動：切格→stabilize→APNG）
{
  const cell = 256;
  const c = makeCanvas(cell * 4, cell * 4);
  for (let k = 0; k < 16; k++) {
    const col = k % 4;
    const row = (k / 4) | 0;
    const cx = col * cell + cell / 2 + Math.round(18 * Math.sin((k / 16) * 2 * Math.PI));
    const cy = row * cell + cell / 2;
    fillCircle(c, cx, cy + 30, 70, [200, 120, 60, 255]); // 身體
    fillCircle(c, cx, cy - 55, 40, [20, 20, 45, 255]); // 深色頭（stabilize 錨點）
  }
  savePng(c, 'frames_4x4.png');
}

// ---------- 瀏覽器測試 ----------

const results = [];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
let imglyRequested = false;
page.on('request', (request) => {
  if (request.url().includes('/imgly/')) imglyRequested = true;
});
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

/** 等指定分頁內出現文字（各分頁常駐 DOM，必須以 data-tab 限定，否則會等到隱藏分頁的舊結果） */
async function expectText(tab, selectorText, timeout = 60_000) {
  await page.waitForSelector(`[data-tab="${tab}"] >> text=${selectorText}`, { timeout });
}

/** 量測預覽 PNG 的可見 alpha bbox；用於確認不同輸出規格沒有非等比拉伸內容。 */
async function visibleAlphaBounds(locator) {
  return locator.evaluate(async (image) => {
    if (!(image instanceof HTMLImageElement)) throw new Error('alpha bbox 目標不是圖片');
    const blob = await (await fetch(image.src)).blob();
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('無法建立 alpha bbox canvas');
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let left = canvas.width;
    let top = canvas.height;
    let right = -1;
    let bottom = -1;
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        if (pixels[(y * canvas.width + x) * 4 + 3] <= 128) continue;
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
    if (right < left || bottom < top) throw new Error('預覽 PNG 沒有可見 alpha bbox');
    return { width: right - left + 1, height: bottom - top + 1 };
  });
}

try {
  await page.goto(`${BASE.replace(/#.*/, '')}#/colab-birefnet`, { waitUntil: 'load' });
  await page.waitForTimeout(800); // 容 COI service worker 註冊/可能的一次重載
  await page.waitForSelector('[data-page="colab-birefnet"] >> text=在 Google Colab 啟動 BiRefNet');
  await page.waitForSelector('[data-page="colab-birefnet"] >> text=直接在 Colab 開啟');
  await page.waitForSelector('[data-page="colab-birefnet"] >> text=astronaut');
  await page.waitForSelector('[data-page="colab-birefnet"] >> text=下載 Notebook');
  await page.click('.colab-guide-back');
  await page.waitForSelector('text=本機圖片打包');
  await page.waitForSelector('.tabs >> text=影片 → APNG');
  const tabCount = await page.locator('.tabs .tab').count();
  if (tabCount !== 5) throw new Error(`應渲染 5 個獨立分頁，實際 ${tabCount}`);
  results.push('✓ Colab + BiRefNet 教學頁可直接開啟、返回五分頁工具');

  // --- 1) 本機圖片打包（預設不去背：不動模型） ---
  await page.click('.tabs >> text=本機圖片打包');
  await page.setInputFiles('[data-tab="build"] input[type=file][accept="image/*"]', singles);
  const buildRemoval = page.locator('[data-tab="build"]').getByLabel('去背方式');
  if (await buildRemoval.inputValue() !== 'none') throw new Error('本機圖片打包應預設不去背');
  await page.click('text=開始打包');
  await expectText('build', '全部符合 LINE 規格');
  const nImgs = await page.locator('[data-tab="build"] .sticker-grid img').count();
  if (nImgs !== 10) throw new Error(`本機打包預覽應有 10 張（main+tab+8），實際 ${nImgs}`);
  if (imglyRequested) throw new Error('不去背模式不應請求 IMG.LY 資源');
  results.push('✓ 本機圖片 → 靜態包：驗證全過、預覽 10 張');

  // --- 1b) IMG.LY 真模型：白底 8 張 → 透明輸出 ---
  if (process.env.SMOKE_IMGLY === '1') {
    await page.setInputFiles('[data-tab="build"] input[type=file][accept="image/*"]', opaqueSingles);
    await buildRemoval.selectOption('imgly');
    await expectText('build', '首次需下載約 84 MiB', 10_000);
    await page.click('text=開始打包');
    await page.waitForSelector('[data-tab="build"] >> text=處理中…', { timeout: 10_000 });
    await expectText('build', 'zip 打包完成', 300_000);
    await expectText('build', '全部符合 LINE 規格', 300_000);
    const alpha = await page.locator('[data-tab="build"] .sticker-grid img').nth(2).evaluate(async (image) => {
      const blob = await (await fetch(image.src)).blob();
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d');
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let transparent = 0;
      let retained = 0;
      for (let offset = 3; offset < pixels.length; offset += 4) {
        if (pixels[offset] === 0) transparent++;
        else retained++;
      }
      return { transparent, retained };
    });
    if (!imglyRequested || alpha.transparent === 0 || alpha.retained === 0) {
      throw new Error(`IMG.LY 未完成有效透明輸出：requested=${imglyRequested} alpha=${JSON.stringify(alpha)}`);
    }
    results.push(`✓ IMG.LY 白底 8 張 → 真模型去背成功（透明 ${alpha.transparent}、保留 ${alpha.retained} px）`);
  }

  // --- 2) 組圖切格（綠幕 → chroma key，不需模型） ---
  await page.click('.tabs >> text=組圖切格');
  await page.setInputFiles('[data-tab="sheet"] input[type=file][accept="image/*"]', path.join(fixDir, 'sheet_green_4x2.png'));
  const sheetTab = page.locator('[data-tab="sheet"]');
  const sheetPreview = sheetTab.locator('[data-testid="sheet-cut-preview"]');
  await sheetPreview.waitFor();
  await page.waitForFunction(() => {
    const image = document.querySelector('[data-tab="sheet"] [data-sheet-preview-image]');
    return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0;
  });
  const activeRects = sheetPreview.locator('[data-sheet-cut-cell][data-active="true"]');
  const activeLabels = sheetPreview.locator('[data-sheet-cut-label]');
  if (await activeRects.count() !== 8 || await activeLabels.count() !== 8) {
    throw new Error(`4×2 切割示意應有 8 個 active rect/label，實際 ${await activeRects.count()}/${await activeLabels.count()}`);
  }
  const previewBounds = await sheetPreview.locator('[data-sheet-preview-media]').evaluate((media) => {
    const image = media.querySelector('[data-sheet-preview-image]');
    const svg = media.querySelector('[data-sheet-preview-overlay]');
    if (!(image instanceof Element) || !(svg instanceof Element)) throw new Error('切割示意缺少 img/svg');
    const a = image.getBoundingClientRect();
    const b = svg.getBoundingClientRect();
    return {
      left: Math.abs(a.left - b.left),
      top: Math.abs(a.top - b.top),
      width: Math.abs(a.width - b.width),
      height: Math.abs(a.height - b.height),
    };
  });
  if (Math.max(previewBounds.left, previewBounds.top, previewBounds.width, previewBounds.height) >= 1) {
    throw new Error(`切割示意 img/svg bounds 未對齊：${JSON.stringify(previewBounds)}`);
  }
  const labelMetrics = await sheetPreview.locator('[data-sheet-cut-label]').evaluateAll((labels) => labels.map((label) => {
    const rect = label.parentElement?.querySelector('rect');
    if (!rect) return { visible: false, contained: false };
    const labelBox = label.getBoundingClientRect();
    const cellBox = rect.getBoundingClientRect();
    return {
      visible: labelBox.width > 0 && labelBox.height > 0,
      contained: labelBox.left >= cellBox.left - 1 && labelBox.right <= cellBox.right + 1
        && labelBox.top >= cellBox.top - 1 && labelBox.bottom <= cellBox.bottom + 1,
    };
  }));
  if (labelMetrics.some(({ visible, contained }) => !visible || !contained)) {
    throw new Error(`切割示意編號不可見或溢出格子：${JSON.stringify(labelMetrics)}`);
  }
  results.push('✓ 4×2 組圖上傳後立即顯示 8 格 nominal 切割示意，img/svg bounds 對齊');
  await page.click('text=切格並打包');
  await expectText('sheet', '全部符合 LINE 規格');
  await expectText('sheet', '綠幕');
  const regularContentBounds = await visibleAlphaBounds(sheetTab.locator('.sticker-grid .png-preview img').nth(2));
  results.push('✓ 綠幕組圖 → 切格 → 靜態包：驗證全過（色鍵路徑）');

  // --- 2a) 同一組圖切換 Big Sticker 規格，再驗證 8 張自然尺寸 ---
  await sheetTab.getByTestId('sheet-spec-select').selectOption('big');
  await expectText('sheet', '80×524–396×660', 10_000);
  await page.click('text=切格並打包');
  await expectText('sheet', '全部符合 LINE 規格');
  const bigStickerImages = sheetTab.locator('.sticker-grid .png-preview img');
  await page.waitForFunction(() => {
    const images = document.querySelectorAll('[data-tab="sheet"] .sticker-grid .png-preview img');
    const stickers = Array.from(images).slice(2);
    return stickers.length === 8 && stickers.every((image) => {
      if (!(image instanceof HTMLImageElement) || !image.complete) return false;
      const { naturalWidth: width, naturalHeight: height } = image;
      return width >= 80 && width <= 396 && height >= 524 && height <= 660 && width % 2 === 0 && height % 2 === 0;
    });
  });
  const bigSizes = await bigStickerImages.evaluateAll((images) => images.slice(2).map((image) => ({
    width: image.naturalWidth,
    height: image.naturalHeight,
  })));
  if (bigSizes.length !== 8 || bigSizes.some(({ width, height }) =>
    width < 80 || width > 396 || height < 524 || height > 660 || width % 2 !== 0 || height % 2 !== 0
  )) {
    throw new Error(`Big Sticker 8 張自然尺寸不符：${JSON.stringify(bigSizes)}`);
  }
  const bigContentBounds = await visibleAlphaBounds(bigStickerImages.nth(2));
  const regularAspect = regularContentBounds.width / regularContentBounds.height;
  const bigAspect = bigContentBounds.width / bigContentBounds.height;
  if (Math.abs(bigAspect / regularAspect - 1) > 0.03) {
    throw new Error(
      `Big Sticker 內容疑似被非等比拉伸：regular=${JSON.stringify(regularContentBounds)} big=${JSON.stringify(bigContentBounds)}`,
    );
  }
  results.push(`✓ Big Sticker 組圖 → 驗證全過、8 張自然尺寸合規且內容維持等比（${bigSizes.map(({ width, height }) => `${width}×${height}`).join(', ')}）`);

  // --- 2b) 組圖語意去背：overlap crops → alpha mask 拼回 → component-aware 切格 ---
  if (process.env.SMOKE_IMGLY === '1') {
    await sheetTab.getByTestId('sheet-spec-select').selectOption('static');
    const sheetRemoval = page.locator('[data-tab="sheet"]').getByLabel('去背方式');
    await page.click('[data-tab="sheet"] .filepick-remove');
    await page.setInputFiles('[data-tab="sheet"] input[type=file][accept="image/*"]', path.join(fixDir, 'sheet_white_4x2.png'));
    await sheetRemoval.selectOption('imgly');
    await page.click('text=切格並打包');
    await page.waitForSelector('[data-tab="sheet"] >> text=處理中…', { timeout: 10_000 });
    await expectText('sheet', '已由 IMG.LY 完成語意去背', 300_000);
    await expectText('sheet', '全部符合 LINE 規格', 300_000);
    results.push('✓ IMG.LY 組圖 crops → mask 拼回 → component-aware 切格：驗證全過');
  }

  // --- 3) 動態 APNG：單組圖模式 ---
  await page.click('.tabs >> text=動態 APNG');
  await page.setInputFiles('[data-tab="anim"] input[type=file][accept="image/*"]', path.join(fixDir, 'frames_4x4.png'));
  await page.click('text=切格並產生動畫');
  await expectText('anim', '全部符合 LINE 規格', 120_000);
  await expectText('anim', '下載 APNG');
  results.push('✓ 影格組圖 → 穩定化 → APNG：驗證全過');

  // --- 4) 產圖 Prompt ---
  await page.click('.tabs >> text=產圖 Prompt');
  await expectText('prompt', 'sprite sheet', 10_000);
  await page.click('text=動態影格組圖');
  await expectText('prompt', 'CONSECUTIVE ANIMATION FRAMES', 10_000);
  results.push('✓ 產圖 Prompt：靜態/動態 prompt 內容正確');
} catch (e) {
  results.push(`✗ 失敗：${e.message}`);
  try {
    await page.screenshot({ path: path.join(fixDir, 'failure.png'), fullPage: true });
    results.push(`  截圖：${path.join(fixDir, 'failure.png')}`);
  } catch {}
  process.exitCode = 1;
} finally {
  await browser.close();
}

console.log(results.join('\n'));
