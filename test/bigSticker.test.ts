/** LINE Big Sticker 規格與整包驗證回歸測試。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BIG_STICKER_SPEC,
  ANIMATED_SPEC,
  STATIC_SPEC,
  MAIN,
  TAB,
  ZIP_MAX_BYTES,
  allowedCounts,
  isAllowedCount,
  maxBounds,
} from '../src/core/spec.js';
import {
  validateAnimatedImage,
  validateBigStickerImage,
  validateCount,
  validateMain,
  validatePack,
  validateStaticImage,
  validateTab,
  type ImageInfo,
} from '../src/core/validate.js';

const bigImage = (overrides: Partial<ImageInfo> = {}): ImageInfo => ({
  width: BIG_STICKER_SPEC.minWidth,
  height: BIG_STICKER_SPEC.minHeight,
  bytes: 100_000,
  hasAlpha: true,
  channels: BIG_STICKER_SPEC.channels,
  ...overrides,
});

const mainImage = (overrides: Partial<ImageInfo> = {}): ImageInfo => ({
  width: MAIN.width,
  height: MAIN.height,
  bytes: 100_000,
  hasAlpha: true,
  channels: 4,
  ...overrides,
});

const tabImage = (overrides: Partial<ImageInfo> = {}): ImageInfo => ({
  width: TAB.width,
  height: TAB.height,
  bytes: 100_000,
  hasAlpha: true,
  channels: 4,
  ...overrides,
});

test('big spec: bounds, margin, channels, and count allowlist', () => {
  assert.deepEqual(BIG_STICKER_SPEC, {
    minWidth: 80,
    minHeight: 524,
    maxWidth: 396,
    maxHeight: 660,
    maxBytes: 1_000_000,
    recommendedMarginPx: 0,
    counts: [8, 16, 24, 32, 40],
    channels: 4,
  });
  assert.deepEqual(maxBounds('big'), { width: 396, height: 660 });
  assert.deepEqual([...allowedCounts('big')], [8, 16, 24, 32, 40]);
  assert.ok(isAllowedCount('big', 40));
  assert.ok(!isAllowedCount('big', 10));
  assert.ok(validateCount('big', 8).ok);
  assert.ok(!validateCount('big', 10).ok);

  // Existing static and animated contracts remain unchanged.
  assert.deepEqual(maxBounds('static'), {
    width: STATIC_SPEC.maxWidth,
    height: STATIC_SPEC.maxHeight,
  });
  assert.deepEqual(maxBounds('animated'), {
    width: ANIMATED_SPEC.maxWidth,
    height: ANIMATED_SPEC.maxHeight,
  });
  assert.deepEqual([...allowedCounts('static')], [8, 16, 24, 32, 40]);
  assert.deepEqual([...allowedCounts('animated')], [8, 16, 24]);
});

test('big image: minimum and maximum bounds are accepted', () => {
  assert.ok(validateBigStickerImage(bigImage({ width: 80, height: 524 })).ok);
  assert.ok(validateBigStickerImage(bigImage({ width: 396, height: 660 })).ok);
});

test('big image: dimensions, alpha, and bytes are enforced', () => {
  const rejected: Array<[string, Partial<ImageInfo>, string]> = [
    ['below minimum width', { width: 78, height: 524 }, 'big.size'],
    ['below minimum height', { width: 80, height: 522 }, 'big.size'],
    ['above maximum width', { width: 398, height: 660 }, 'big.size'],
    ['above maximum height', { width: 396, height: 662 }, 'big.size'],
    ['odd dimensions', { width: 81, height: 525 }, 'big.even'],
    ['missing alpha', { hasAlpha: false }, 'big.alpha'],
    ['fully opaque pixels', { transparentPixels: 0 }, 'big.transparentPixels'],
    ['blank pixels', { foregroundPixels: 0 }, 'big.empty'],
    ['over one megabyte', { bytes: 1_000_001 }, 'big.bytes'],
  ];

  for (const [label, overrides, code] of rejected) {
    const validation = validateBigStickerImage(bigImage(overrides));
    assert.equal(validation.ok, false, label);
    assert.ok(validation.issues.some((issue) => issue.code === code), label);
  }

  assert.ok(validateBigStickerImage(bigImage({ bytes: BIG_STICKER_SPEC.maxBytes })).ok);
});

test('validatePack: big routes sticker validation and reuses main/tab/zip rules', () => {
  const stickers = Array.from({ length: 8 }, () => bigImage());
  const valid = validatePack({
    kind: 'big',
    count: 8,
    stickers,
    main: mainImage({ isApng: false }),
    tab: tabImage(),
    zipBytes: ZIP_MAX_BYTES,
  });
  assert.equal(valid.ok, true);

  // Big uses the static main contract: APNG is not required.
  assert.ok(validateMain(mainImage({ isApng: false }), 'big').ok);
  assert.ok(validateTab(tabImage()).ok);

  // A Big-sized sticker must not accidentally route through static bounds.
  assert.equal(
    validatePack({
      kind: 'big',
      count: 8,
      stickers: [bigImage({ width: 80, height: 524 })],
      main: mainImage(),
      tab: tabImage(),
    }).issues.some((issue) => issue.code === 'static.size'),
    false,
  );

  assert.equal(
    validatePack({
      kind: 'big',
      count: 8,
      stickers,
      main: mainImage(),
      tab: tabImage(),
      zipBytes: ZIP_MAX_BYTES + 1,
    }).issues.some((issue) => issue.code === 'zip.bytes'),
    true,
  );
  assert.equal(
    validatePack({
      kind: 'big',
      count: 8,
      stickers,
      main: mainImage({ width: MAIN.width + 2 }),
      tab: tabImage(),
    }).issues.some((issue) => issue.code === 'main.size'),
    true,
  );
  assert.equal(
    validatePack({
      kind: 'big',
      count: 8,
      stickers,
      main: mainImage(),
      tab: tabImage({ height: TAB.height + 2 }),
    }).issues.some((issue) => issue.code === 'tab.size'),
    true,
  );
});

test('validatePack: static and animated routes still enforce their existing rules', () => {
  const staticSticker: ImageInfo = {
    width: STATIC_SPEC.maxWidth,
    height: STATIC_SPEC.maxHeight,
    bytes: 100_000,
    hasAlpha: true,
    channels: STATIC_SPEC.channels,
  };
  assert.ok(validateStaticImage(staticSticker).ok);
  assert.ok(
    validatePack({
      kind: 'static',
      count: 8,
      stickers: Array.from({ length: 8 }, () => staticSticker),
      main: mainImage(),
      tab: tabImage(),
    }).ok,
  );
  assert.ok(
    !validateStaticImage(bigImage()).ok,
  );

  const animatedSticker: ImageInfo = {
    width: ANIMATED_SPEC.maxWidth,
    height: ANIMATED_SPEC.maxHeight,
    bytes: 100_000,
    hasAlpha: true,
    channels: ANIMATED_SPEC.channels,
    isApng: true,
    frames: ANIMATED_SPEC.minFrames,
    loops: ANIMATED_SPEC.minLoops,
  };
  assert.ok(validateAnimatedImage(animatedSticker).ok);
  assert.ok(
    validatePack({
      kind: 'animated',
      count: 8,
      stickers: Array.from({ length: 8 }, () => animatedSticker),
      main: mainImage({ isApng: true, frames: 5, loops: 1 }),
      tab: tabImage(),
    }).ok,
  );
  assert.ok(
    !validatePack({
      kind: 'animated',
      count: 32,
      stickers: Array.from({ length: 32 }, () => animatedSticker),
      main: mainImage({ isApng: true, frames: 5, loops: 1 }),
      tab: tabImage(),
    }).ok,
  );
});
