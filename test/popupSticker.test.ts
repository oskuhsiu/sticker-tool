/** LINE Popup Sticker 規格、命名與雙軌整包驗證回歸測試。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ANIMATED_SPEC,
  BIG_STICKER_SPEC,
  MAIN,
  POPUP_MAIN,
  POPUP_STICKER_SPEC,
  STATIC_SPEC,
  TAB,
  ZIP_MAX_BYTES,
  allowedCounts,
  isAllowedCount,
  maxBounds,
} from '../src/core/spec.js';
import {
  MAIN_FILE,
  POPUP_ANIMATION_DIR,
  POPUP_ANIMATION_MAIN_PATH,
  POPUP_MAIN_FILE,
  POPUP_STATIC_DIR,
  POPUP_STATIC_MAIN_PATH,
  POPUP_STATIC_TAB_PATH,
  TAB_FILE,
  popupAnimationFilePath,
  popupStaticFilePath,
  stickerFileName,
} from '../src/core/naming.js';
import {
  validateAnimatedImage,
  validateBigStickerImage,
  validateCount,
  validateMain,
  validatePack,
  validatePopupImage,
  validatePopupMain,
  validatePopupPack,
  validatePopupStaticImage,
  validateStaticImage,
  validateTab,
  type ImageInfo,
} from '../src/core/validate.js';

const popupImage = (overrides: Partial<ImageInfo> = {}): ImageInfo => ({
  width: POPUP_MAIN.width,
  height: POPUP_MAIN.height,
  bytes: 100_000,
  hasAlpha: true,
  channels: POPUP_STICKER_SPEC.channels,
  colorType: 6,
  isApng: true,
  frames: POPUP_STICKER_SPEC.minFrames,
  loops: POPUP_STICKER_SPEC.minLoops,
  durationMs: 1_000,
  transparentPixels: 1,
  foregroundPixels: 1,
  distinctFrames: 2,
  ...overrides,
});

const staticImage = (overrides: Partial<ImageInfo> = {}): ImageInfo => ({
  width: STATIC_SPEC.maxWidth,
  height: STATIC_SPEC.maxHeight,
  bytes: 100_000,
  hasAlpha: true,
  channels: STATIC_SPEC.channels,
  colorType: 6,
  transparentPixels: 1,
  foregroundPixels: 1,
  ...overrides,
});

const mainImage = (overrides: Partial<ImageInfo> = {}): ImageInfo => ({
  width: MAIN.width,
  height: MAIN.height,
  bytes: 100_000,
  hasAlpha: true,
  channels: 4,
  colorType: 6,
  transparentPixels: 1,
  foregroundPixels: 1,
  ...overrides,
});

const tabImage = (overrides: Partial<ImageInfo> = {}): ImageInfo => ({
  width: TAB.width,
  height: TAB.height,
  bytes: 100_000,
  hasAlpha: true,
  channels: 4,
  colorType: 6,
  transparentPixels: 1,
  foregroundPixels: 1,
  ...overrides,
});

test('popup spec: exact limits, source-facing main, counts, and bounds', () => {
  assert.equal(POPUP_STICKER_SPEC.maxWidth, 480);
  assert.equal(POPUP_STICKER_SPEC.maxHeight, 480);
  assert.equal(POPUP_STICKER_SPEC.minHeightAtMaxWidth, 320);
  assert.equal(POPUP_STICKER_SPEC.minWidthAtMaxHeight, 200);
  assert.equal(POPUP_STICKER_SPEC.maxBytes, 1_000_000);
  assert.deepEqual([...POPUP_STICKER_SPEC.playbackDurationsSec], [1, 2, 3]);
  assert.equal(POPUP_STICKER_SPEC.minFrames, 5);
  assert.equal(POPUP_STICKER_SPEC.maxFrames, 20);
  assert.equal(POPUP_STICKER_SPEC.minLoops, 1);
  assert.equal(POPUP_STICKER_SPEC.maxLoops, 3);
  assert.equal(POPUP_STICKER_SPEC.maxDurationSec, 3);
  assert.deepEqual(POPUP_MAIN, { width: 480, height: 480 });
  assert.deepEqual(maxBounds('popup'), { width: 480, height: 480 });
  assert.deepEqual([...allowedCounts('popup')], [8, 16, 24]);
  assert.ok(isAllowedCount('popup', 24));
  assert.ok(!isAllowedCount('popup', 32));
  assert.ok(validateCount('popup', 8).ok);
  assert.ok(!validateCount('popup', 40).ok);

  // Existing routes remain unchanged.
  assert.deepEqual(maxBounds('static'), { width: STATIC_SPEC.maxWidth, height: STATIC_SPEC.maxHeight });
  assert.deepEqual(maxBounds('animated'), {
    width: ANIMATED_SPEC.maxWidth,
    height: ANIMATED_SPEC.maxHeight,
  });
  assert.deepEqual(maxBounds('big'), { width: BIG_STICKER_SPEC.maxWidth, height: BIG_STICKER_SPEC.maxHeight });
  assert.deepEqual([...allowedCounts('static')], [8, 16, 24, 32, 40]);
  assert.deepEqual([...allowedCounts('animated')], [8, 16, 24]);
  assert.deepEqual([...allowedCounts('big')], [8, 16, 24, 32, 40]);
});

test('popup naming: grouped cover assets and paired numbered paths', () => {
  assert.equal(MAIN_FILE, 'main.png');
  assert.equal(POPUP_MAIN_FILE, 'main_popup.png');
  assert.equal(TAB_FILE, 'tab.png');
  assert.equal(POPUP_STATIC_DIR, 'png');
  assert.equal(POPUP_ANIMATION_DIR, 'popup');
  assert.equal(POPUP_STATIC_MAIN_PATH, 'png/main.png');
  assert.equal(POPUP_STATIC_TAB_PATH, 'png/tab.png');
  assert.equal(POPUP_ANIMATION_MAIN_PATH, 'popup/main_popup.png');
  assert.equal(popupStaticFilePath(1), 'png/01.png');
  assert.equal(popupStaticFilePath(24), 'png/24.png');
  assert.equal(popupAnimationFilePath(1), 'popup/01.png');
  assert.equal(popupAnimationFilePath(24), 'popup/24.png');
  assert.throws(() => popupStaticFilePath(0));
  assert.throws(() => popupAnimationFilePath(Number.NaN));
  assert.equal(stickerFileName(1), '01.png');
});

test('popup geometry: both legal 480-side branches and boundaries pass', () => {
  assert.ok(validatePopupImage(popupImage({ width: 480, height: 320 })).ok);
  assert.ok(validatePopupImage(popupImage({ width: 200, height: 480 })).ok);
  assert.ok(validatePopupImage(popupImage({ width: 480, height: 480 })).ok);
  assert.ok(validatePopupImage(popupImage({ width: 480, height: 480, frames: 20, loops: 1, durationMs: 3_000 })).ok);
  assert.ok(validatePopupImage(popupImage({ width: 480, height: 480, frames: 5, loops: 3, durationMs: 1_000 })).ok);

  const invalidGeometry: Array<[string, Partial<ImageInfo>]> = [
    ['below 320px height at width 480', { width: 480, height: 318 }],
    ['below 200px width at height 480', { width: 198, height: 480 }],
    ['neither side exactly 480', { width: 478, height: 478 }],
    ['over maximum width', { width: 482, height: 480 }],
    ['over maximum height', { width: 480, height: 482 }],
    ['odd width', { width: 479, height: 480 }],
  ];
  for (const [label, overrides] of invalidGeometry) {
    assert.equal(validatePopupImage(popupImage(overrides)).ok, false, label);
  }
});

test('popup image: strict APNG evidence, timing, alpha/content, RGB, and bytes', () => {
  const missingEvidence: Array<[string, Partial<ImageInfo>, string]> = [
    ['APNG evidence', { isApng: undefined }, 'popup.apng'],
    ['frame evidence', { frames: undefined }, 'popup.framesEvidence'],
    ['loop evidence', { loops: undefined }, 'popup.loopsEvidence'],
    ['duration evidence', { durationMs: undefined }, 'popup.durationEvidence'],
    ['transparent evidence', { transparentPixels: undefined }, 'popup.transparentEvidence'],
    ['foreground evidence', { foregroundPixels: undefined }, 'popup.foregroundEvidence'],
    ['distinct-frame evidence', { distinctFrames: undefined }, 'popup.distinctEvidence'],
    ['color type evidence', { colorType: undefined }, 'popup.rgb'],
  ];
  for (const [label, overrides, code] of missingEvidence) {
    const validation = validatePopupImage(popupImage(overrides));
    assert.equal(validation.ok, false, label);
    assert.ok(validation.issues.some((issue) => issue.code === code), label);
  }

  const invalidEvidence: Array<[string, Partial<ImageInfo>, string]> = [
    ['not APNG', { isApng: false }, 'popup.apng'],
    ['palette PNG', { colorType: 3 }, 'popup.rgb'],
    ['missing alpha', { hasAlpha: false }, 'popup.alpha'],
    ['no transparent pixels', { transparentPixels: 0 }, 'popup.transparentPixels'],
    ['no foreground pixels', { foregroundPixels: 0 }, 'popup.empty'],
    ['no distinct frames', { distinctFrames: 0 }, 'popup.identical'],
    ['too few frames', { frames: 4 }, 'popup.frames'],
    ['too many frames', { frames: 21 }, 'popup.frames'],
    ['too few loops', { loops: 0 }, 'popup.loops'],
    ['too many loops', { loops: 4 }, 'popup.loops'],
    ['fractional duration', { durationMs: 1_500 }, 'popup.duration'],
    ['too long total duration', { loops: 2, durationMs: 2_000 }, 'popup.totalDuration'],
    ['all-identical frames', { distinctFrames: 1 }, 'popup.identical'],
    ['over one megabyte', { bytes: 1_000_001 }, 'popup.bytes'],
  ];
  for (const [label, overrides, code] of invalidEvidence) {
    const validation = validatePopupImage(popupImage(overrides));
    assert.equal(validation.ok, false, label);
    assert.ok(validation.issues.some((issue) => issue.code === code), label);
  }

  // Repeated adjacent frames are allowed when the final sequence has variation.
  assert.ok(validatePopupImage(popupImage({ adjacentDuplicateFrames: 3 })).ok);
  assert.ok(validatePopupImage(popupImage({ bytes: POPUP_STICKER_SPEC.maxBytes })).ok);
});

test('popup main: exact 480×480 and full popup animation rules', () => {
  assert.ok(validatePopupMain(popupImage()).ok);
  assert.ok(
    !validatePopupMain(popupImage({ width: 480, height: 320 })).issues.every(
      (issue) => issue.code !== 'popupMain.size',
    ),
  );
  assert.ok(!validatePopupMain(popupImage({ isApng: false })).ok);
  assert.ok(!validatePopupMain(popupImage({ frames: undefined })).ok);
});

test('validatePopupPack: paired static/popup lists, shared assets, and ZIP limit', () => {
  const stickers = Array.from({ length: 8 }, () => staticImage());
  const popupStickers = Array.from({ length: 8 }, () => popupImage());
  const valid = validatePopupPack({
    count: 8,
    stickers,
    popupStickers,
    main: mainImage(),
    popupMain: popupImage(),
    tab: tabImage(),
    zipBytes: ZIP_MAX_BYTES,
  });
  assert.equal(valid.ok, true);

  assert.ok(
    !validatePopupPack({
      count: 8,
      stickers: stickers.slice(0, 7),
      popupStickers,
      main: mainImage(),
      popupMain: popupImage(),
      tab: tabImage(),
    }).ok,
  );
  assert.ok(
    !validatePopupPack({
      count: 8,
      stickers,
      popupStickers,
      main: mainImage({ colorType: 3 }),
      popupMain: popupImage(),
      tab: tabImage({ transparentPixels: undefined }),
    }).ok,
    'Popup cover/tab assets require final RGBA and transparency evidence',
  );
  assert.ok(
    !validatePopupPack({
      count: 8,
      stickers,
      popupStickers: popupStickers.slice(0, 7),
      main: mainImage(),
      popupMain: popupImage(),
      tab: tabImage(),
    }).ok,
  );
  assert.ok(
    !validatePopupPack({
      count: 8,
      stickers,
      popupStickers,
      main: mainImage({ width: MAIN.width + 2 }),
      popupMain: popupImage(),
      tab: tabImage(),
    }).ok,
  );
  assert.ok(
    !validatePopupPack({
      count: 8,
      stickers,
      popupStickers,
      main: mainImage(),
      popupMain: popupImage({ width: 480, height: 320 }),
      tab: tabImage(),
    }).ok,
  );
  assert.ok(
    !validatePopupPack({
      count: 8,
      stickers,
      popupStickers,
      main: mainImage(),
      popupMain: popupImage(),
      tab: tabImage({ height: TAB.height + 2 }),
      zipBytes: ZIP_MAX_BYTES + 1,
    }).ok,
  );

  assert.ok(
    !validatePopupStaticImage(staticImage({ colorType: 3 })).ok,
    'palette static PNG is not accepted for the Popup static track',
  );
  assert.ok(!validatePopupStaticImage(staticImage({ transparentPixels: undefined })).ok);
  assert.ok(!validatePopupStaticImage(staticImage({ transparentPixels: 0 })).ok);
  assert.ok(!validatePopupStaticImage(staticImage({ foregroundPixels: undefined })).ok);
  assert.ok(!validatePopupStaticImage(staticImage({ foregroundPixels: 0 })).ok);
  assert.ok(
    !validatePopupPack({
      count: 8,
      stickers: stickers.map((sticker) => ({ ...sticker, colorType: 3 })),
      popupStickers,
      main: mainImage(),
      popupMain: popupImage(),
      tab: tabImage(),
    }).ok,
  );

  // A one-list popup call cannot be mistaken for a complete pair.
  assert.ok(
    !validatePack({
      kind: 'popup',
      count: 8,
      stickers: popupStickers,
      main: mainImage(),
      tab: tabImage(),
    }).ok,
  );
});

test('existing static, Big Sticker, and animated validators remain compatible', () => {
  assert.ok(validateStaticImage(staticImage()).ok);
  assert.ok(validateBigStickerImage({
    width: BIG_STICKER_SPEC.minWidth,
    height: BIG_STICKER_SPEC.minHeight,
    bytes: 100_000,
    hasAlpha: true,
    channels: BIG_STICKER_SPEC.channels,
    colorType: 6,
  }).ok);
  assert.ok(validateAnimatedImage({
    width: ANIMATED_SPEC.maxWidth,
    height: ANIMATED_SPEC.maxHeight,
    bytes: 100_000,
    hasAlpha: true,
    channels: ANIMATED_SPEC.channels,
    isApng: true,
    frames: ANIMATED_SPEC.minFrames,
    loops: ANIMATED_SPEC.minLoops,
  }).ok);
  assert.ok(validateMain(mainImage(), 'static').ok);
  assert.ok(validateTab(tabImage()).ok);
});
