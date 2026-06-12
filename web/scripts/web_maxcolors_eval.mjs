/**
 * 減色開關評測（try-011）：4x4 + 減色上限 256 → 期望 log 出現「減色至 256 色」、
 * 檔案大小遠小於無損版（960KB → ~300KB）。
 * 用法（從 web/ 執行）：node scripts/web_maxcolors_eval.mjs <previewURL> <evalDir>
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const [BASE, EVAL_DIR] = process.argv.slice(2);
const SHEET = path.resolve(EVAL_DIR, '../spike/char_drink_green.png');
const dir = path.join(EVAL_DIR, 'try-011-web-maxcolors-256');
mkdirSync(dir, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
try {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(600);
  await page.click('.tabs >> text=動態 APNG');
  await page.setInputFiles('[data-tab="anim"] input[type=file]', SHEET);
  await page.selectOption('[data-tab="anim"] select', '256');
  await page.click('text=切格並產生動畫');
  await page.waitForSelector('[data-tab="anim"] >> text=下載 APNG', { timeout: 180_000 });

  const log = await page.locator('[data-tab="anim"] .log-pane').innerText();
  writeFileSync(path.join(dir, 'ui-log.txt'), log + '\n');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('[data-tab="anim"] >> text=下載 APNG'),
  ]);
  const dest = path.join(dir, 'anim.png');
  await download.saveAs(dest);

  const reduced = log.includes('減色至 256 色');
  console.log(`✓ 產出 ${dest}`);
  console.log(`log 含「減色至 256 色」：${reduced}（期望 true）`);
  if (!reduced) process.exitCode = 1;
} catch (e) {
  console.error(`✗ ${e.message}`);
  await page.screenshot({ path: path.join(dir, 'failure.png'), fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
