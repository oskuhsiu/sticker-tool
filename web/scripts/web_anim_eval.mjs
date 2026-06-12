/**
 * Web 版動態 APNG 的 headless 評測：載入 dist 的「動態 APNG」分頁 →
 * 上傳影格組圖 → 設定網格 → 產生動畫 → 攔截下載存檔 + 抓 UI log。
 * 用法：node eval/web_anim_eval.mjs <previewURL> <sheetPath> <grid> <outDir>
 * （從 web/ 目錄執行：playwright 在 web/node_modules）
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const [BASE, sheetPath, grid, outDir] = process.argv.slice(2);
if (!BASE || !sheetPath || !grid || !outDir) {
  console.error('用法：node eval/web_anim_eval.mjs <previewURL> <sheetPath> <grid> <outDir>');
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

try {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(800); // COI service worker 註冊/重載
  await page.waitForSelector('text=動態 APNG');
  await page.click('.tabs >> text=動態 APNG');

  // 網格欄位：SheetMode 第一個文字輸入（預設 "4x4"）
  const gridInput = page.locator('[data-tab="anim"] input[type=text], [data-tab="anim"] input:not([type])').first();
  await gridInput.fill(grid);
  await page.setInputFiles('[data-tab="anim"] input[type=file][accept="image/*"]', path.resolve(sheetPath));
  await page.click('text=切格並產生動畫');
  await page.waitForSelector('[data-tab="anim"] >> text=下載 APNG', { timeout: 180_000 });

  const logText = await page.locator('[data-tab="anim"] .log-pane').innerText();
  writeFileSync(path.join(outDir, 'ui-log.txt'), logText + '\n');
  console.log('--- UI log ---\n' + logText + '\n--------------');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('[data-tab="anim"] >> text=下載 APNG'),
  ]);
  const dest = path.join(outDir, 'anim.png');
  await download.saveAs(dest);
  console.log(`✓ 已存 ${dest}`);
} catch (e) {
  console.error(`✗ 失敗：${e.message}`);
  try {
    await page.screenshot({ path: path.join(outDir, 'failure.png'), fullPage: true });
  } catch {}
  process.exitCode = 1;
} finally {
  await browser.close();
}
