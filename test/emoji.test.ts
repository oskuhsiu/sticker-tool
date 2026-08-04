/** LINE Regular Emoji 與 Animated Regular Emoji shared-core contract tests. */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ANIMATED_EMOJI_SPEC,
  EMOJI_SPEC,
  EMOJI_ZIP_MAX_BYTES,
  TAB,
  allowedCounts,
  exactItemBounds,
  isAllowedCount,
  isEmojiZipBytesAllowed,
  maxBounds,
} from '../src/core/spec.js';
import {
  TAB_FILE,
  emojiFileName,
  emojiFileNames,
  emojiPackManifest,
} from '../src/core/naming.js';
import {
  validateAnimatedEmojiImage,
  validateCount,
  validateEmojiImage,
  validateEmojiPack,
  type ImageInfo,
} from '../src/core/validate.js';

const staticEmoji = (overrides: Partial<ImageInfo> = {}): ImageInfo => ({
  width: EMOJI_SPEC.width,
  height: EMOJI_SPEC.height,
  bytes: 100_000,
  hasAlpha: true,
  channels: EMOJI_SPEC.channels,
  format: 'png',
  colorType: 6,
  isApng: false,
  transparentPixels: 1,
  foregroundPixels: 1,
  densityDpi: EMOJI_SPEC.minDpi,
  ...overrides,
});

const animatedEmoji = (overrides: Partial<ImageInfo> = {}): ImageInfo => ({
  ...staticEmoji(),
  bytes: 200_000,
  channels: ANIMATED_EMOJI_SPEC.channels,
  isApng: true,
  frames: ANIMATED_EMOJI_SPEC.minFrames,
  loops: ANIMATED_EMOJI_SPEC.minLoops,
  durationMs: 1_000,
  distinctFrames: 2,
  ...overrides,
});

const tabImage = (overrides: Partial<ImageInfo> = {}): ImageInfo => ({
  width: TAB.width,
  height: TAB.height,
  bytes: 50_000,
  hasAlpha: true,
  channels: 4,
  format: 'png',
  colorType: 6,
  isApng: false,
  transparentPixels: 1,
  foregroundPixels: 1,
  densityDpi: EMOJI_SPEC.minDpi,
  ...overrides,
});

function hasCode(validation: ReturnType<typeof validateEmojiImage>, code: string): boolean {
  return validation.issues.some((issue) => issue.code === code);
}

test('emoji specs expose exact bounds, inclusive count range, and distinct ZIP comparators', () => {
  assert.deepEqual(EMOJI_SPEC, {
    width: 180,
    height: 180,
    maxBytes: 1_000_000,
    minDpi: 72,
    minCount: 8,
    maxCount: 40,
    channels: 4,
    sequenceDigits: 3,
    zipMaxBytes: 20_000_000,
    zipMaxInclusive: false,
    requiresMain: false,
  });
  assert.equal(ANIMATED_EMOJI_SPEC.width, 180);
  assert.equal(ANIMATED_EMOJI_SPEC.height, 180);
  assert.equal(ANIMATED_EMOJI_SPEC.maxBytes, 300_000);
  assert.equal(ANIMATED_EMOJI_SPEC.minFrames, 5);
  assert.equal(ANIMATED_EMOJI_SPEC.maxFrames, 20);
  assert.equal(ANIMATED_EMOJI_SPEC.minLoops, 1);
  assert.equal(ANIMATED_EMOJI_SPEC.maxLoops, 4);
  assert.deepEqual([...ANIMATED_EMOJI_SPEC.playbackDurationsSec], [1, 2, 3, 4]);
  assert.equal(ANIMATED_EMOJI_SPEC.maxDurationSec, 4);
  assert.equal(ANIMATED_EMOJI_SPEC.zipMaxInclusive, true);

  assert.deepEqual(exactItemBounds('emoji'), { width: 180, height: 180 });
  assert.deepEqual(exactItemBounds('animated-emoji'), { width: 180, height: 180 });
  assert.equal(exactItemBounds('static'), undefined);
  assert.deepEqual(maxBounds('emoji'), { width: 180, height: 180 });
  assert.deepEqual(maxBounds('animated-emoji'), { width: 180, height: 180 });

  assert.deepEqual([...allowedCounts('emoji')], Array.from({ length: 33 }, (_, i) => i + 8));
  for (const count of [8, 9, 40]) {
    assert.ok(isAllowedCount('emoji', count));
    assert.ok(isAllowedCount('animated-emoji', count));
    assert.ok(validateCount('emoji', count).ok);
    assert.ok(validateCount('animated-emoji', count).ok);
  }
  for (const count of [7, 41]) {
    assert.equal(isAllowedCount('emoji', count), false);
    assert.equal(isAllowedCount('animated-emoji', count), false);
    assert.equal(validateCount('emoji', count).ok, false);
    assert.equal(validateCount('animated-emoji', count).ok, false);
  }

  assert.equal(EMOJI_ZIP_MAX_BYTES, 20_000_000);
  assert.equal(isEmojiZipBytesAllowed('emoji', EMOJI_ZIP_MAX_BYTES - 1), true);
  assert.equal(isEmojiZipBytesAllowed('emoji', EMOJI_ZIP_MAX_BYTES), false);
  assert.equal(isEmojiZipBytesAllowed('animated-emoji', EMOJI_ZIP_MAX_BYTES), true);
  assert.equal(isEmojiZipBytesAllowed('animated-emoji', EMOJI_ZIP_MAX_BYTES + 1), false);
});

test('emoji naming uses exactly three digits and exposes the expected flat manifest', () => {
  assert.equal(emojiFileName(1), '001.png');
  assert.equal(emojiFileName(40), '040.png');
  assert.equal(emojiFileName(305), '305.png');
  assert.deepEqual(emojiFileNames(3), ['001.png', '002.png', '003.png']);
  assert.deepEqual(emojiPackManifest(3), [TAB_FILE, '001.png', '002.png', '003.png']);
  assert.throws(() => emojiFileName(0), RangeError);
  assert.throws(() => emojiFileName(1_000), RangeError);
  assert.throws(() => emojiFileName(Number.NaN), RangeError);
  assert.throws(() => emojiFileNames(1.5), RangeError);
});

test('static emoji validation requires final PNG, exact canvas, alpha/content, and byte evidence', () => {
  assert.ok(validateEmojiImage(staticEmoji(), '001.png').ok);
  assert.ok(validateEmojiImage(staticEmoji({ bytes: EMOJI_SPEC.maxBytes }), '001.png').ok);

  const rejected: Array<[string, Partial<ImageInfo>, string]> = [
    ['missing format evidence', { format: undefined }, 'emoji.format'],
    ['wrong format', { format: 'jpeg' }, 'emoji.format'],
    ['APNG passed as static', { isApng: true }, 'emoji.apng'],
    ['missing APNG evidence', { isApng: undefined }, 'emoji.apngEvidence'],
    ['narrow canvas', { width: 179 }, 'emoji.size'],
    ['short canvas', { height: 179 }, 'emoji.size'],
    ['missing alpha', { hasAlpha: false }, 'emoji.alpha'],
    ['wrong channel count', { channels: 3 }, 'emoji.rgb'],
    ['missing color evidence', { colorType: undefined }, 'emoji.rgb'],
    ['indexed color', { colorType: 3 }, 'emoji.rgb'],
    ['missing transparent evidence', { transparentPixels: undefined }, 'emoji.transparentEvidence'],
    ['opaque image', { transparentPixels: 0 }, 'emoji.transparentPixels'],
    ['missing foreground evidence', { foregroundPixels: undefined }, 'emoji.foregroundEvidence'],
    ['blank image', { foregroundPixels: 0 }, 'emoji.empty'],
    ['over one megabyte', { bytes: EMOJI_SPEC.maxBytes + 1 }, 'emoji.bytes'],
    ['density below 72 dpi', { densityDpi: 71 }, 'emoji.density'],
    ['wrong item filename', { filename: '01.png' }, 'emoji.filename'],
  ];

  for (const [label, overrides, code] of rejected) {
    const validation = validateEmojiImage(staticEmoji(overrides), '001.png');
    assert.equal(validation.ok, false, label);
    assert.ok(hasCode(validation, code), label);
  }

  const unknownDensity = validateEmojiImage(staticEmoji({ densityDpi: undefined }), '001.png');
  assert.equal(unknownDensity.ok, true);
  assert.ok(hasCode(unknownDensity, 'emoji.densityEvidence'));
  assert.equal(
    unknownDensity.issues.find((issue) => issue.code === 'emoji.densityEvidence')?.level,
    'warning',
  );
});

test('animated emoji validation enforces final APNG frames, loops, timing, variation, and 300 KB', () => {
  assert.ok(validateAnimatedEmojiImage(animatedEmoji(), '001.png').ok);
  assert.ok(
    validateAnimatedEmojiImage(animatedEmoji({
      frames: 20,
      loops: 4,
      durationMs: 1_000,
      bytes: ANIMATED_EMOJI_SPEC.maxBytes,
      adjacentDuplicateFrames: 3,
    }), '001.png').ok,
  );
  assert.ok(validateAnimatedEmojiImage(animatedEmoji({ durationMs: 1_001 }), '001.png').ok);

  const rejected: Array<[string, Partial<ImageInfo>, string]> = [
    ['missing APNG evidence', { isApng: undefined }, 'animatedEmoji.apng'],
    ['static PNG', { isApng: false }, 'animatedEmoji.apng'],
    ['missing frame evidence', { frames: undefined }, 'animatedEmoji.framesEvidence'],
    ['too few frames', { frames: 4 }, 'animatedEmoji.frames'],
    ['too many frames', { frames: 21 }, 'animatedEmoji.frames'],
    ['missing loop evidence', { loops: undefined }, 'animatedEmoji.loopsEvidence'],
    ['zero loops', { loops: 0 }, 'animatedEmoji.loops'],
    ['too many loops', { loops: 5 }, 'animatedEmoji.loops'],
    ['missing duration evidence', { durationMs: undefined }, 'animatedEmoji.durationEvidence'],
    ['fractional duration', { durationMs: 1_500 }, 'animatedEmoji.duration'],
    ['outside duration tolerance', { durationMs: 1_002 }, 'animatedEmoji.duration'],
    ['total duration over four seconds', { durationMs: 2_000, loops: 3 }, 'animatedEmoji.totalDuration'],
    ['missing distinct evidence', { distinctFrames: undefined }, 'animatedEmoji.distinctEvidence'],
    ['identical frames', { distinctFrames: 1 }, 'animatedEmoji.identical'],
    ['impossible distinct count', { frames: 5, distinctFrames: 6 }, 'animatedEmoji.distinctFrames'],
    ['over 300 KB', { bytes: ANIMATED_EMOJI_SPEC.maxBytes + 1 }, 'animatedEmoji.bytes'],
  ];

  for (const [label, overrides, code] of rejected) {
    const validation = validateAnimatedEmojiImage(animatedEmoji(overrides), '001.png');
    assert.equal(validation.ok, false, label);
    assert.ok(validation.issues.some((issue) => issue.code === code), label);
  }
});

test('emoji pack validates tab, item count, exact manifest, and no-main archive shape', () => {
  const items = Array.from({ length: 8 }, () => staticEmoji());
  const valid = validateEmojiPack({
    kind: 'emoji',
    count: 8,
    items,
    tab: tabImage(),
    archivePaths: emojiPackManifest(8),
    zipBytes: EMOJI_ZIP_MAX_BYTES - 1,
  });
  assert.equal(valid.ok, true);

  const animatedItems = Array.from({ length: 9 }, () => animatedEmoji());
  assert.ok(validateEmojiPack({
    kind: 'animated-emoji',
    count: 9,
    items: animatedItems,
    tab: tabImage(),
    archivePaths: emojiPackManifest(9),
    zipBytes: EMOJI_ZIP_MAX_BYTES,
  }).ok);

  const malformedManifests: Array<[string, string[], string]> = [
    ['two-digit item', [TAB_FILE, '01.png', ...emojiFileNames(8).slice(1)], 'emoji.manifest.missing'],
    ['missing item', emojiPackManifest(8).filter((path) => path !== '004.png'), 'emoji.manifest.missing'],
    ['duplicate item', [...emojiPackManifest(8), '001.png'], 'emoji.manifest.duplicate'],
    ['unexpected main', ['main.png', ...emojiPackManifest(8)], 'emoji.manifest.unexpected'],
    ['unexpected nested item', [...emojiPackManifest(8), 'emoji/001.png'], 'emoji.manifest.unexpected'],
  ];
  for (const [label, archivePaths, code] of malformedManifests) {
    const validation = validateEmojiPack({
      kind: 'emoji',
      count: 8,
      items,
      tab: tabImage(),
      archivePaths,
    });
    assert.equal(validation.ok, false, label);
    assert.ok(validation.issues.some((issue) => issue.code === code), label);
  }

  assert.equal(validateEmojiPack({
    kind: 'emoji',
    count: 7,
    items: items.slice(0, 7),
    tab: tabImage(),
    archivePaths: emojiPackManifest(7),
  }).ok, false);
  assert.equal(validateEmojiPack({
    kind: 'emoji',
    count: 41,
    items: Array.from({ length: 41 }, () => staticEmoji()),
    tab: tabImage(),
    archivePaths: emojiPackManifest(41),
  }).ok, false);
  assert.equal(validateEmojiPack({
    kind: 'emoji',
    count: 8,
    items: items.slice(0, 7),
    tab: tabImage(),
    archivePaths: emojiPackManifest(8),
  }).ok, false);
  assert.equal(validateEmojiPack({
    kind: 'emoji',
    count: 8,
    items,
    tab: tabImage({ height: TAB.height + 1 }),
    archivePaths: emojiPackManifest(8),
  }).ok, false);
  assert.equal(validateEmojiPack({
    kind: 'animated-emoji',
    count: 8,
    items,
    tab: tabImage(),
    archivePaths: emojiPackManifest(8),
  }).ok, false, 'static PNG items cannot pass an animated emoji pack');
});

test('static and animated emoji pack ZIP boundaries remain intentionally different', () => {
  const staticItems = Array.from({ length: 8 }, () => staticEmoji());
  const animatedItems = Array.from({ length: 8 }, () => animatedEmoji());
  const validateZip = (kind: 'emoji' | 'animated-emoji', zipBytes: number) =>
    validateEmojiPack({
      kind,
      count: 8,
      items: kind === 'emoji' ? staticItems : animatedItems,
      tab: tabImage(),
      archivePaths: emojiPackManifest(8),
      zipBytes,
    });

  assert.ok(validateZip('emoji', EMOJI_ZIP_MAX_BYTES - 1).ok);
  assert.equal(validateZip('emoji', EMOJI_ZIP_MAX_BYTES).ok, false);
  assert.equal(validateZip('emoji', EMOJI_ZIP_MAX_BYTES + 1).ok, false);
  assert.ok(validateZip('animated-emoji', EMOJI_ZIP_MAX_BYTES).ok);
  assert.equal(validateZip('animated-emoji', EMOJI_ZIP_MAX_BYTES + 1).ok, false);
});
