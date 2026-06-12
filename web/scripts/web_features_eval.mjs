/**
 * Web 動態 APNG 新功能的 headless 評測（playwright × vite preview dist）。
 * 情境（每個＝一個 try 資料夾）：
 *   A 4x4 預設        → 產出 APNG；預覽循環開＝acTL num_plays 0、關＝原值
 *   B 5x4 防呆開(預設) → 被「網格防呆」擋下、無下載鈕
 *   C 5x4 防呆關      → 強制繼續、有產出（允許使用者 override）
 *   D 淡藍單色背景 4x4 → 單色色鍵去背（不載 @imgly 模型）、正常產出
 *   E 4x4 手動排版     → 第 5 格 Shift+→×3（+30px）→ 打包 → 偏移烙進影格
 * 用法（從 web/ 執行）：node scripts/web_features_eval.mjs <previewURL> <evalDir>
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import UPNG from 'upng-js';
import { chromium } from 'playwright';

const [BASE, EVAL_DIR] = process.argv.slice(2);
if (!BASE || !EVAL_DIR) {
  console.error('用法：node scripts/web_features_eval.mjs <previewURL> <evalDir>');
  process.exit(1);
}
const SHEET_GREEN = path.resolve(EVAL_DIR, '../spike/char_drink_green.png');
const SHEET_BLUE = path.resolve(EVAL_DIR, 'fixtures/char_drink_bluebg.png');

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [];

/** 開新分頁到動態 APNG 分頁（每情境全新 state） */
async function openAnimTab() {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(600);
  await page.click('.tabs >> text=動態 APNG');
  return page;
}

async function setGrid(page, grid) {
  await page.locator('[data-tab="anim"] input:not([type])').first().fill(grid);
}

/** checkbox：0=自動去背 1=網格防呆 2=預覽循環播放 */
function checkbox(page, idx) {
  return page.locator('[data-tab="anim"] input[type=checkbox]').nth(idx);
}

async function uiLog(page) {
  return page.locator('[data-tab="anim"] .log-pane').innerText();
}

async function saveDownload(page, dir, fileName) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('[data-tab="anim"] >> text=下載 APNG'),
  ]);
  const dest = path.join(dir, fileName);
  await download.saveAs(dest);
  return dest;
}

/** 預覽 <img> 的 blob bytes（看 acTL num_plays） */
async function previewBytes(page) {
  const b64 = await page.evaluate(async () => {
    const img = document.querySelector('[data-tab="anim"] .png-preview.big img');
    if (!img) return null;
    const buf = await (await fetch(img.src)).arrayBuffer();
    let s = '';
    const u8 = new Uint8Array(buf);
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  });
  return b64 ? new Uint8Array(Buffer.from(b64, 'base64')) : null;
}

const numPlays = (png) => UPNG.decode(png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength)).tabs.acTL?.num_plays ?? -1;

function record(tryName, lines) {
  const msg = `【${tryName}】\n${lines.map((l) => `  ${l}`).join('\n')}`;
  console.log(msg);
  results.push(msg);
}

// ---------- A：4x4 預設（含預覽循環驗證） ----------
{
  const dir = path.join(EVAL_DIR, 'try-005-web-4x4-defaults');
  mkdirSync(dir, { recursive: true });
  const page = await openAnimTab();
  const lines = [];
  try {
    await page.setInputFiles('[data-tab="anim"] input[type=file]', SHEET_GREEN);
    await page.click('text=切格並產生動畫');
    await page.waitForSelector('[data-tab="anim"] >> text=下載 APNG', { timeout: 180_000 });
    const dl = await saveDownload(page, dir, 'anim.png');
    lines.push(`✓ 產出 ${dl}`);

    const prevLoop = await previewBytes(page);
    lines.push(`預覽循環開：num_plays=${numPlays(prevLoop)}（期望 0=無限）`);
    await checkbox(page, 2).uncheck();
    await page.waitForTimeout(300);
    const prevOnce = await previewBytes(page);
    lines.push(`預覽循環關：num_plays=${numPlays(prevOnce)}（期望 1=下載檔原值）`);
    const editorVisible = await page.locator('.layout-editor').isVisible();
    lines.push(`手動排版區塊可見：${editorVisible}`);
  } catch (e) {
    lines.push(`✗ ${e.message}`);
    await page.screenshot({ path: path.join(dir, 'failure.png'), fullPage: true }).catch(() => {});
    process.exitCode = 1;
  }
  writeFileSync(path.join(dir, 'ui-log.txt'), await uiLog(page).catch(() => '') + '\n');
  record('try-005 web 4x4 預設', lines);
  await page.close();
}

// ---------- B：5x4 防呆開（預設）→ 擋下 ----------
{
  const dir = path.join(EVAL_DIR, 'try-006-web-5x4-guard-on');
  mkdirSync(dir, { recursive: true });
  const page = await openAnimTab();
  const lines = [];
  try {
    await page.setInputFiles('[data-tab="anim"] input[type=file]', SHEET_GREEN);
    await setGrid(page, '5x4');
    await page.click('text=切格並產生動畫');
    await page.waitForSelector('[data-tab="anim"] .log-err >> text=網格防呆', { timeout: 120_000 });
    lines.push('✓ 顯示「網格防呆」錯誤');
    await page.waitForTimeout(1500);
    const hasDownload = await page.locator('[data-tab="anim"] >> text=下載 APNG').count();
    lines.push(`下載鈕出現：${hasDownload > 0}（期望 false）`);
    if (hasDownload > 0) process.exitCode = 1;
  } catch (e) {
    lines.push(`✗ ${e.message}`);
    await page.screenshot({ path: path.join(dir, 'failure.png'), fullPage: true }).catch(() => {});
    process.exitCode = 1;
  }
  writeFileSync(path.join(dir, 'ui-log.txt'), await uiLog(page).catch(() => '') + '\n');
  record('try-006 web 5x4 防呆開', lines);
  await page.close();
}

// ---------- C：5x4 防呆關 → 強制繼續 ----------
{
  const dir = path.join(EVAL_DIR, 'try-007-web-5x4-guard-off');
  mkdirSync(dir, { recursive: true });
  const page = await openAnimTab();
  const lines = [];
  try {
    await page.setInputFiles('[data-tab="anim"] input[type=file]', SHEET_GREEN);
    await setGrid(page, '5x4');
    await checkbox(page, 1).uncheck();
    await page.click('text=切格並產生動畫');
    await page.waitForSelector('[data-tab="anim"] >> text=下載 APNG', { timeout: 180_000 });
    const dl = await saveDownload(page, dir, 'anim.png');
    lines.push(`✓ 防呆關閉可強制產出 ${dl}（內容預期漂移，使用者自負）`);
  } catch (e) {
    lines.push(`✗ ${e.message}`);
    await page.screenshot({ path: path.join(dir, 'failure.png'), fullPage: true }).catch(() => {});
    process.exitCode = 1;
  }
  writeFileSync(path.join(dir, 'ui-log.txt'), await uiLog(page).catch(() => '') + '\n');
  record('try-007 web 5x4 防呆關', lines);
  await page.close();
}

// ---------- D：淡藍單色背景 → 單色色鍵（不載模型） ----------
{
  const dir = path.join(EVAL_DIR, 'try-008-web-solidbg');
  mkdirSync(dir, { recursive: true });
  const page = await openAnimTab();
  const lines = [];
  let modelRequested = false;
  page.on('request', (r) => {
    if (r.url().includes('imgly')) modelRequested = true;
  });
  try {
    await page.setInputFiles('[data-tab="anim"] input[type=file]', SHEET_BLUE);
    await page.click('text=切格並產生動畫');
    await page.waitForSelector('[data-tab="anim"] >> text=下載 APNG', { timeout: 180_000 });
    const dl = await saveDownload(page, dir, 'anim.png');
    const log = await uiLog(page);
    lines.push(`✓ 產出 ${dl}`);
    lines.push(`log 含「單色色鍵」：${log.includes('單色色鍵')}（期望 true）`);
    lines.push(`期間請求過 @imgly 模型資源：${modelRequested}（期望 false＝不會卡模型下載）`);
    if (modelRequested) process.exitCode = 1;
  } catch (e) {
    lines.push(`✗ ${e.message}`);
    await page.screenshot({ path: path.join(dir, 'failure.png'), fullPage: true }).catch(() => {});
    process.exitCode = 1;
  }
  writeFileSync(path.join(dir, 'ui-log.txt'), await uiLog(page).catch(() => '') + '\n');
  record('try-008 web 淡藍單色背景', lines);
  await page.close();
}

// ---------- E：手動排版（第 5 格 +30px → 打包） ----------
{
  const dir = path.join(EVAL_DIR, 'try-009-web-manual-layout');
  mkdirSync(dir, { recursive: true });
  const page = await openAnimTab();
  const lines = [];
  try {
    await page.setInputFiles('[data-tab="anim"] input[type=file]', SHEET_GREEN);
    await page.click('text=切格並產生動畫');
    await page.waitForSelector('[data-tab="anim"] >> text=下載 APNG', { timeout: 180_000 });

    // 選第 5 格 → 鍵盤 Shift+→ ×3 = +30px → 播放測試 → 打包
    await page.click('.frame-strip >> text="5"');
    const canvas = page.locator('.layout-canvas');
    await canvas.focus();
    for (let i = 0; i < 3; i++) await canvas.press('Shift+ArrowRight');
    await page.waitForSelector('.layout-status >> text=(30, 0)');
    lines.push('✓ 鍵盤微調：第 5 格偏移 (30, 0)');

    await page.click('button:has-text("播放測試")');
    await page.waitForTimeout(600);
    await page.click('button:has-text("停止")');
    lines.push('✓ 播放測試可開關');

    await page.click('button:has-text("以手動排版打包")');
    await page.waitForSelector('[data-tab="anim"] .log-pane >> text=手動排版 APNG', { timeout: 120_000 });
    const dl = await saveDownload(page, dir, 'anim_manual.png');
    lines.push(`✓ 手動排版打包產出 ${dl}（第 5 格應比其他格右移 ~30px×fit縮放）`);
  } catch (e) {
    lines.push(`✗ ${e.message}`);
    await page.screenshot({ path: path.join(dir, 'failure.png'), fullPage: true }).catch(() => {});
    process.exitCode = 1;
  }
  writeFileSync(path.join(dir, 'ui-log.txt'), await uiLog(page).catch(() => '') + '\n');
  record('try-009 web 手動排版', lines);
  await page.close();
}

await browser.close();
writeFileSync(path.join(EVAL_DIR, 'web-features-eval.txt'), results.join('\n\n') + '\n');
