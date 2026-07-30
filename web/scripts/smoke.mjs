/**
 * 端到端冒煙測試（headless Chrome × vite preview 的 dist 產物）：
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
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

/** 等指定分頁內出現文字（各分頁常駐 DOM，必須以 data-tab 限定，否則會等到隱藏分頁的舊結果） */
async function expectText(tab, selectorText, timeout = 60_000) {
  await page.waitForSelector(`[data-tab="${tab}"] >> text=${selectorText}`, { timeout });
}

try {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(800); // 容 COI service worker 註冊/可能的一次重載
  await page.waitForSelector('text=本機圖片打包');
  await page.waitForSelector('.tabs >> text=影片 → APNG');
  const tabCount = await page.locator('.tabs .tab').count();
  if (tabCount !== 5) throw new Error(`應渲染 5 個獨立分頁，實際 ${tabCount}`);
  results.push('✓ 頁面載入、五分頁渲染（影片 workflow 獨立）');

  // --- 1) 本機圖片打包（關去背：不動 onnx 模型，驗證其餘整條管線） ---
  await page.click('.tabs >> text=本機圖片打包');
  await page.setInputFiles('[data-tab="build"] input[type=file][accept="image/*"]', singles);
  // 去背 checkbox 是第一個（預設勾選）→ 取消
  await page.uncheck('[data-tab="build"] .form-row >> nth=1 >> input[type=checkbox] >> nth=0');
  await page.click('text=開始打包');
  await expectText('build', '全部符合 LINE 規格');
  const nImgs = await page.locator('[data-tab="build"] .sticker-grid img').count();
  if (nImgs !== 10) throw new Error(`本機打包預覽應有 10 張（main+tab+8），實際 ${nImgs}`);
  results.push('✓ 本機圖片 → 靜態包：驗證全過、預覽 10 張');

  // --- 2) 組圖切格（綠幕 → chroma key，不需模型） ---
  await page.click('.tabs >> text=組圖切格');
  await page.setInputFiles('[data-tab="sheet"] input[type=file][accept="image/*"]', path.join(fixDir, 'sheet_green_4x2.png'));
  await page.click('text=切格並打包');
  await expectText('sheet', '全部符合 LINE 規格');
  await expectText('sheet', '綠幕');
  results.push('✓ 綠幕組圖 → 切格 → 靜態包：驗證全過（色鍵路徑）');

  // --- 2b) 組圖切格（白底 → @imgly onnx 語意去背；首次載入 ~88MB 本地模型） ---
  if (process.env.SMOKE_IMGLY === '1') {
    await page.click('[data-tab="sheet"] .filepick-remove'); // 移除上一輪的綠幕組圖
    await page.setInputFiles('[data-tab="sheet"] input[type=file][accept="image/*"]', path.join(fixDir, 'sheet_white_4x2.png'));
    await page.click('text=切格並打包');
    await expectText('sheet', '語意去背', 240_000);
    await expectText('sheet', '全部符合 LINE 規格', 240_000);
    results.push('✓ 白底組圖 → onnx 語意去背 → 靜態包：模型載入與推論正常');
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
