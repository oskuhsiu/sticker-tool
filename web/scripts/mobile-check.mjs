/**
 * 手機可用性快檢：iPhone 視窗（390×844）開線上站台，逐分頁截圖並量測
 * 是否有水平溢出（破版的主要訊號）。用法：node scripts/mobile-check.mjs [URL]
 */

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from 'playwright';

const here = path.dirname(fileURLToPath(new URL(import.meta.url)));
const outDir = path.join(here, '..', '_mobile');
mkdirSync(outDir, { recursive: true });

const BASE = process.argv[2] ?? 'https://oskuhsiu.github.io/sticker-tool/';
const TABS = ['本機圖片打包', '組圖切格', '動態 APNG', '產圖 Prompt'];

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ ...devices['iPhone 13'] });
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForTimeout(1200);

for (const t of TABS) {
  await page.click(`.tabs >> text=${t}`);
  await page.waitForTimeout(300);
  const overflow = await page.evaluate(() => {
    const el = document.scrollingElement;
    return { scrollW: el.scrollWidth, clientW: el.clientWidth };
  });
  const bad = overflow.scrollW > overflow.clientW;
  console.log(`${bad ? '✗' : '✓'} ${t}：scrollWidth=${overflow.scrollW} clientWidth=${overflow.clientW}${bad ? '（水平溢出！）' : ''}`);
  await page.screenshot({ path: path.join(outDir, `tab-${t}.png`), fullPage: true });
}
await browser.close();
console.log(`截圖在 ${outDir}/`);
