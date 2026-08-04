/**
 * Focused browser smoke for LINE Regular Emoji and Animated Regular Emoji.
 *
 * Usage (with `npm run preview -- --port 4179` running in web/):
 *   npm run smoke:emoji -- http://localhost:4179/
 *
 * Evidence is written to web/_smoke/emoji/.
 */

import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import UPNG from 'upng-js';
import { unzipSync } from 'fflate';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(new URL(import.meta.url)));
const evidenceDir = path.join(here, '..', '_smoke', 'emoji');
const BASE = process.argv[2] ?? 'http://127.0.0.1:4179/';
mkdirSync(evidenceDir, { recursive: true });

function makeCanvas(width, height, fill = [0, 0, 0, 0]) {
  const data = new Uint8Array(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel++) {
    const offset = pixel * 4;
    data[offset] = fill[0];
    data[offset + 1] = fill[1];
    data[offset + 2] = fill[2];
    data[offset + 3] = fill[3];
  }
  return { data, width, height };
}

function fillCircle(canvas, centerX, centerY, radius, color) {
  for (let y = Math.max(0, centerY - radius); y <= Math.min(canvas.height - 1, centerY + radius); y++) {
    for (let x = Math.max(0, centerX - radius); x <= Math.min(canvas.width - 1, centerX + radius); x++) {
      if ((x - centerX) ** 2 + (y - centerY) ** 2 > radius ** 2) continue;
      const offset = (y * canvas.width + x) * 4;
      canvas.data[offset] = color[0];
      canvas.data[offset + 1] = color[1];
      canvas.data[offset + 2] = color[2];
      canvas.data[offset + 3] = color[3];
    }
  }
}

function savePng(canvas, filename) {
  const encoded = UPNG.encode([canvas.data.buffer], canvas.width, canvas.height, 0);
  const output = path.join(evidenceDir, filename);
  writeFileSync(output, Buffer.from(encoded));
  return output;
}

function makeFixtures() {
  const staticItems = [];
  for (let index = 0; index < 8; index++) {
    const canvas = makeCanvas(240, 220);
    fillCircle(canvas, 120, 114, 62 + index, [45 + index * 20, 105 + index * 8, 210 - index * 12, 255]);
    fillCircle(canvas, 120, 72, 24, [22, 26 + index * 3, 55, 255]);
    staticItems.push(savePng(canvas, `static-${String(index + 1).padStart(2, '0')}.png`));
  }

  const animationFrames = [];
  for (let frame = 0; frame < 5; frame++) {
    const canvas = makeCanvas(240, 240);
    fillCircle(canvas, 120, 130, 50 + frame * 3, [70 + frame * 28, 95 + frame * 17, 220 - frame * 24, 255]);
    fillCircle(canvas, 120, 78, 27 + frame, [24 + frame * 12, 28, 62 + frame * 16, 255]);
    animationFrames.push(savePng(canvas, `frame-${String(frame + 1).padStart(2, '0')}.png`));
  }

  const cell = 240;
  const sheet = makeCanvas(cell * 3, cell * 2, [0, 255, 0, 255]);
  for (let frame = 0; frame < 6; frame++) {
    const column = frame % 3;
    const row = Math.floor(frame / 3);
    const centerX = column * cell + cell / 2;
    const centerY = row * cell + cell / 2;
    fillCircle(sheet, centerX, centerY + 8, 55 + frame * 2, [210 - frame * 19, 52 + frame * 24, 80 + frame * 17, 255]);
    fillCircle(sheet, centerX, centerY - 42, 25 + frame, [28 + frame * 12, 28, 65 + frame * 15, 255]);
  }

  return {
    staticItems,
    animationFrames,
    animationSheet: savePng(sheet, 'frames-3x2.png'),
  };
}

function expectedEntries(count) {
  return [
    'tab.png',
    ...Array.from({ length: count }, (_, index) => `${String(index + 1).padStart(3, '0')}.png`),
  ].sort();
}

function inspectPng(bytes) {
  const input = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const image = UPNG.decode(input);
  const control = image.tabs.acTL;
  const composited = UPNG.toRGBA8(image);
  const distinctFrames = new Set(composited.map((frame) => Buffer.from(frame).toString('base64'))).size;
  return {
    width: image.width,
    height: image.height,
    colorType: image.ctype,
    isApng: Boolean(control),
    frames: control?.num_frames ?? 1,
    loops: control?.num_plays ?? 0,
    durationMs: control ? image.frames.reduce((sum, frame) => sum + frame.delay, 0) : 0,
    distinctFrames,
    bytes: bytes.byteLength,
  };
}

function inspectEmojiArchive(bytes, count, kind) {
  const archive = unzipSync(bytes);
  const entries = Object.keys(archive).sort();
  assert.deepEqual(entries, expectedEntries(count), `${kind} ZIP entries must be flat and exact`);
  assert.ok(!entries.includes('main.png'), `${kind} ZIP must not contain main.png`);
  assert.ok(entries.every((entry) => !entry.includes('/')), `${kind} ZIP must not contain directories`);
  return { archive, entries };
}

function assertStaticEmoji(info, label) {
  assert.equal(info.width, 180, `${label} width`);
  assert.equal(info.height, 180, `${label} height`);
  assert.equal(info.colorType, 6, `${label} must be truecolor RGBA`);
  assert.equal(info.isApng, false, `${label} must be a static PNG`);
  assert.ok(info.bytes <= 1_000_000, `${label} must be at most 1MB`);
}

function assertAnimatedEmoji(info, label, expectedFrames, expectedDurationMs) {
  assert.equal(info.width, 180, `${label} width`);
  assert.equal(info.height, 180, `${label} height`);
  assert.equal(info.colorType, 6, `${label} must be truecolor RGBA`);
  assert.equal(info.isApng, true, `${label} must be APNG`);
  assert.equal(info.frames, expectedFrames, `${label} frame count`);
  assert.ok(info.frames >= 5 && info.frames <= 20, `${label} must contain 5-20 frames`);
  assert.equal(info.loops, 1, `${label} loops`);
  assert.ok(Math.abs(info.durationMs - expectedDurationMs) <= 1, `${label} duration must be ${expectedDurationMs}ms`);
  assert.ok([1_000, 2_000, 3_000, 4_000].some((allowed) => Math.abs(info.durationMs - allowed) <= 1), `${label} duration must be allowed by LINE`);
  assert.ok(info.durationMs * info.loops <= 4_000, `${label} total playback must be at most 4 seconds`);
  assert.ok(info.distinctFrames >= 2, `${label} must retain at least two distinct frames`);
  assert.ok(info.bytes <= 300_000, `${label} must be at most 300KB`);
}

async function selectValues(locator) {
  return locator.locator('option').evaluateAll((options) => options.map((option) => option.value));
}

function fieldControl(root, label, selector = 'input, select, textarea') {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return root
    .locator('.field-label')
    .filter({ hasText: new RegExp(`^${escaped}$`) })
    .locator('..')
    .locator(selector)
    .first();
}

async function downloadBytes(page, button, evidenceName) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    button.click(),
  ]);
  const temporaryPath = await download.path();
  assert.ok(temporaryPath, `download ${evidenceName} did not expose a local path`);
  const bytes = new Uint8Array(readFileSync(temporaryPath));
  writeFileSync(path.join(evidenceDir, evidenceName), bytes);
  return bytes;
}

async function expectValidDownload(result, buttonName, timeout) {
  const button = result.getByRole('button', { name: buttonName });
  await button.waitFor({ state: 'visible', timeout });
  assert.equal(await result.locator('.v-error').count(), 0, 'Validation must not contain errors');
  assert.equal(await button.isEnabled(), true, 'Validated download must be enabled');
  return button;
}

const fixtures = makeFixtures();
const pass = [];
const evidence = {
  previewUrl: BASE,
  generatedAt: new Date().toISOString(),
};

let browser;
let page;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  page = await browser.newPage({ acceptDownloads: true });
  page.on('pageerror', (error) => console.error(`  [pageerror] ${error.message}`));

  await page.goto(BASE.replace(/#.*/, ''), { waitUntil: 'load' });
  await page.waitForTimeout(800); // Allow the COI service worker's possible first-load reload.
  await page.waitForSelector('.tabs >> text=本機圖片打包');

  // Static Regular Emoji: selector/reset semantics, actual processing, and exact ZIP manifest.
  console.log('[1/3] Static Emoji pack');
  await page.getByRole('button', { name: '本機圖片打包', exact: true }).click();
  const build = page.locator('[data-tab="build"]');
  await fieldControl(build, '張數', 'select').selectOption('40');
  await fieldControl(build, '封面用第幾張', 'input').fill('5');
  await build.getByTestId('build-spec-select').selectOption('emoji');
  assert.equal(await fieldControl(build, '張數', 'select').inputValue(), '8', 'Static Emoji target switch resets count to 8');
  assert.equal(await fieldControl(build, '聊天室縮圖用第幾張', 'input').inputValue(), '1', 'Static Emoji target switch resets tab source to 1');
  assert.deepEqual(
    await selectValues(fieldControl(build, '張數', 'select')),
    Array.from({ length: 33 }, (_, index) => String(index + 8)),
    'Static Emoji count selector must offer 8-40',
  );
  await build.getByTestId('build-emoji-limits').waitFor();
  await build.locator('input[type="file"][accept="image/*"]').setInputFiles(fixtures.staticItems);
  await build.getByRole('button', { name: '開始打包', exact: true }).click();
  const staticResult = build.locator('.pack-result');
  const staticDownload = await expectValidDownload(staticResult, /下載上架包 zip/, 120_000);
  await build.getByTestId('emoji-scale-preview').waitFor();
  const staticCaptions = await staticResult.locator('figcaption').allTextContents();
  assert.ok(staticCaptions.some((caption) => caption.startsWith('001.png ')), 'Static preview must use 001.png');
  assert.ok(staticCaptions.some((caption) => caption.startsWith('008.png ')), 'Static preview must use 008.png');
  assert.equal(await staticResult.getByRole('button', { name: 'main.png', exact: true }).count(), 0, 'Static Emoji result must not offer main.png');
  assert.ok(!staticCaptions.some((caption) => caption.startsWith('main.png')), 'Static Emoji result must not preview main.png');

  const staticZip = await downloadBytes(
    page,
    staticDownload,
    'static-emoji.zip',
  );
  assert.ok(staticZip.byteLength < 20_000_000, 'Static Emoji ZIP must be smaller than 20MB');
  const staticArchive = inspectEmojiArchive(staticZip, 8, 'Static Emoji');
  const staticItems = {};
  for (const entry of staticArchive.entries) {
    const info = inspectPng(staticArchive.archive[entry]);
    if (entry === 'tab.png') {
      assert.equal(info.width, 96, 'Static Emoji tab width');
      assert.equal(info.height, 74, 'Static Emoji tab height');
      assert.equal(info.colorType, 6, 'Static Emoji tab must be truecolor RGBA');
      assert.equal(info.isApng, false, 'Static Emoji tab must be static');
    } else {
      assertStaticEmoji(info, entry);
    }
    staticItems[entry] = info;
  }
  evidence.staticEmoji = {
    zipBytes: staticZip.byteLength,
    entries: staticArchive.entries,
    validationWarnings: await staticResult.locator('.v-warning').allTextContents(),
    items: staticItems,
  };
  pass.push('Static Emoji: 8 images -> valid 180x180 RGBA files; ZIP is tab.png + 001.png..008.png with no main.png');

  // Animated Emoji single-sheet path: prove UI constraints and reopen the downloaded APNG.
  console.log('[2/3] Animated Emoji single sheet');
  await page.getByRole('button', { name: '動態 APNG', exact: true }).click();
  const anim = page.locator('[data-tab="anim"]');
  await anim.getByTestId('anim-mode-sheet').click();
  await anim.getByTestId('anim-sheet-spec-select').selectOption('animated-emoji');
  assert.deepEqual(
    await selectValues(anim.getByTestId('anim-sheet-spec-select')),
    ['animated', 'animated-emoji'],
    'Animated sheet selector must expose both product types',
  );
  await anim.getByTestId('anim-sheet-emoji-limits').waitFor();
  await anim.locator('input[type="file"][accept="image/*"]').setInputFiles(fixtures.animationSheet);
  await fieldControl(anim, '網格（如 4x4）', 'input').fill('3x2');
  await fieldControl(anim, '取前 N 格（空＝全部）', 'input').fill('6');
  await fieldControl(anim, '單輪時長（秒）', 'select').selectOption('2');
  await fieldControl(anim, '網格防呆（網格與內容不符時擋下）', 'input').uncheck();
  await anim.getByRole('button', { name: '切格並產生 Animated Emoji', exact: true }).click();
  const sheetResult = anim.locator('.pack-result');
  const sheetDownload = await expectValidDownload(sheetResult, /下載 APNG/, 180_000);
  const sheetCaption = await sheetResult.locator('figcaption').textContent();
  assert.match(sheetCaption ?? '', /180×180/);
  assert.match(sheetCaption ?? '', /6格/);
  assert.match(sheetCaption ?? '', /單輪 2000ms/);
  const sheetApng = await downloadBytes(
    page,
    sheetDownload,
    'animated-emoji-single.png',
  );
  const sheetInfo = inspectPng(sheetApng);
  assertAnimatedEmoji(sheetInfo, 'single-sheet APNG', 6, 2_000);
  evidence.animatedSingle = {
    ...sheetInfo,
    validationWarnings: await sheetResult.locator('.v-warning').allTextContents(),
  };
  pass.push('Animated Emoji sheet: 3x2 source -> 6-frame 180x180 RGBA APNG, one loop and 2000ms duration');

  // Animated Emoji pack: eight five-frame inputs, then exact archive and decoded-output checks.
  console.log('[3/3] Animated Emoji pack');
  await anim.getByTestId('anim-mode-pack').click();
  await anim.getByTestId('anim-pack-spec-select').selectOption('animated-emoji');
  const packCount = fieldControl(anim, '張數', 'select');
  assert.equal(await packCount.inputValue(), '8', 'Animated Emoji pack target switch resets count to 8');
  assert.deepEqual(
    await selectValues(packCount),
    Array.from({ length: 33 }, (_, index) => String(index + 8)),
    'Animated Emoji pack count selector must offer 8-40',
  );
  await anim.getByTestId('anim-pack-emoji-limits').waitFor();
  await fieldControl(anim, '單輪時長（秒）', 'select').selectOption('1');
  const frameInputs = anim.locator('.frame-sets input[type="file"][accept="image/*"]');
  assert.equal(await frameInputs.count(), 8, 'Eight frame-set pickers must render for the minimum pack');
  for (let index = 0; index < 8; index++) {
    await frameInputs.nth(index).setInputFiles(fixtures.animationFrames);
  }
  await anim.getByRole('button', { name: '打包 Animated Emoji', exact: true }).click();
  await anim.getByTestId('animated-pack-final-evidence').waitFor({ timeout: 240_000 });

  const finalEvidence = await anim.getByTestId('animated-pack-final-evidence').textContent();
  assert.match(finalEvidence ?? '', /001\.png：5 格、1 loops、\s*單輪 1000ms/);
  assert.match(finalEvidence ?? '', /008\.png：5 格、1 loops、\s*單輪 1000ms/);
  const packResult = anim.locator('.pack-result');
  const packDownload = await expectValidDownload(packResult, /下載上架包 zip/, 240_000);
  await packResult.getByTestId('emoji-scale-preview').waitFor();
  const animatedCaptions = await packResult.locator('figcaption').allTextContents();
  assert.equal(await packResult.getByRole('button', { name: 'main.png', exact: true }).count(), 0, 'Animated Emoji result must not offer main.png');
  assert.ok(!animatedCaptions.some((caption) => caption.startsWith('main.png')), 'Animated Emoji result must not preview main.png');

  const animatedZip = await downloadBytes(
    page,
    packDownload,
    'animated-emoji.zip',
  );
  assert.ok(animatedZip.byteLength <= 20_000_000, 'Animated Emoji ZIP must be at most 20MB');
  const animatedArchive = inspectEmojiArchive(animatedZip, 8, 'Animated Emoji');
  const animatedItems = {};
  for (const entry of animatedArchive.entries) {
    const info = inspectPng(animatedArchive.archive[entry]);
    if (entry === 'tab.png') {
      assert.equal(info.width, 96, 'Animated Emoji tab width');
      assert.equal(info.height, 74, 'Animated Emoji tab height');
      assert.equal(info.colorType, 6, 'Animated Emoji tab must be truecolor RGBA');
      assert.equal(info.isApng, false, 'Animated Emoji tab must be static');
    } else {
      assertAnimatedEmoji(info, entry, 5, 1_000);
    }
    animatedItems[entry] = info;
  }
  evidence.animatedPack = {
    zipBytes: animatedZip.byteLength,
    entries: animatedArchive.entries,
    validationWarnings: await packResult.locator('.v-warning').allTextContents(),
    items: animatedItems,
  };
  pass.push('Animated Emoji pack: 8x5 frames -> valid APNGs; ZIP is tab.png + 001.png..008.png with no main.png');

  await page.screenshot({ path: path.join(evidenceDir, 'success.png'), fullPage: true });
  writeFileSync(path.join(evidenceDir, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);

  console.log('Emoji browser smoke PASS');
  for (const result of pass) console.log(`  ✓ ${result}`);
  console.log(`  Evidence: ${evidenceDir}`);
} catch (error) {
  evidence.failure = error instanceof Error ? { message: error.message, stack: error.stack } : String(error);
  writeFileSync(path.join(evidenceDir, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  if (page) {
    await page.screenshot({ path: path.join(evidenceDir, 'failure.png'), fullPage: true }).catch(() => {});
  }
  console.error('Emoji browser smoke FAIL');
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser?.close();
}
