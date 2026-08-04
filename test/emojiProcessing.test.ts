/** Node pixel-processing contracts used by Regular Emoji and Animated Regular Emoji. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';

import { ANIMATED_EMOJI_SPEC, EMOJI_SPEC } from '../src/core/spec.js';
import type { AnimationConfig } from '../src/core/types.js';
import { fitCanvas } from '../src/pipeline/fitCanvas.js';
import { processAnimated } from '../src/pipeline/processAnimated.js';
import { inspectStaticPng, processStatic } from '../src/pipeline/processStatic.js';

interface AlphaBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

function animation(overrides: Partial<AnimationConfig> = {}): AnimationConfig {
  return {
    maxBytes: ANIMATED_EMOJI_SPEC.maxBytes,
    loops: 1,
    durationSec: 1,
    autoFit: false,
    priority: 'balanced',
    minColors: 16,
    maxColors: 0,
    minFrames: ANIMATED_EMOJI_SPEC.minFrames,
    ladder: 'auto',
    stabilize: {
      enabled: false,
      anchor: 'none',
      axis: 'xy',
      darkThreshold: 70,
      topFraction: 0.5,
    },
    ...overrides,
  };
}

async function rectanglePng(
  width: number,
  height: number,
  rect: AlphaBox,
  color: [number, number, number] = [220, 40, 30],
): Promise<Buffer> {
  const data = Buffer.alloc(width * height * 4);
  for (let y = rect.top; y < rect.top + rect.height; y++) {
    for (let x = rect.left; x < rect.left + rect.width; x++) {
      const offset = (y * width + x) * 4;
      data[offset] = color[0];
      data[offset + 1] = color[1];
      data[offset + 2] = color[2];
      data[offset + 3] = 255;
    }
  }
  return sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

async function alphaBox(buffer: Buffer, threshold = 10): Promise<AlphaBox | null> {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let left = info.width;
  let top = info.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 4 + 3]! <= threshold) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  return right < 0 ? null : { left, top, width: right - left + 1, height: bottom - top + 1 };
}

const emojiLimits = {
  minFrames: ANIMATED_EMOJI_SPEC.minFrames,
  maxFrames: ANIMATED_EMOJI_SPEC.maxFrames,
  maxDurationSec: ANIMATED_EMOJI_SPEC.maxDurationSec,
  playbackDurationsSec: ANIMATED_EMOJI_SPEC.playbackDurationsSec,
  label: 'Animated Emoji',
} as const;

test('fitCanvas separates transparent input trimming from exact output sizing', async () => {
  const input = await rectanglePng(40, 40, { left: 10, top: 15, width: 20, height: 10 });
  const bounded = await fitCanvas(input, {
    bounds: { width: EMOJI_SPEC.width, height: EMOJI_SPEC.height },
    mode: 'trim',
    marginPx: 10,
  });
  const exactTrimmed = await fitCanvas(input, {
    bounds: { width: EMOJI_SPEC.width, height: EMOJI_SPEC.height },
    mode: 'exact',
    trimInput: true,
    marginPx: 10,
  });
  const exactLegacy = await fitCanvas(input, {
    bounds: { width: EMOJI_SPEC.width, height: EMOJI_SPEC.height },
    mode: 'exact',
    marginPx: 10,
  });

  assert.deepEqual([bounded.width, bounded.height], [180, 100]);
  assert.deepEqual([exactTrimmed.width, exactTrimmed.height], [180, 180]);
  assert.deepEqual([exactLegacy.width, exactLegacy.height], [180, 180]);

  const boundedBox = await alphaBox(bounded.buffer);
  const trimmedBox = await alphaBox(exactTrimmed.buffer);
  const legacyBox = await alphaBox(exactLegacy.buffer);
  assert.ok(boundedBox && trimmedBox && legacyBox);
  assert.ok(Math.abs(boundedBox.width - trimmedBox.width) <= 1);
  assert.ok(Math.abs(boundedBox.height - trimmedBox.height) <= 1);
  assert.ok(trimmedBox.width > legacyBox.width + 50, 'exact+trim must not scale transparent padding as content');
});

test('processStatic emits an exact 180px canvas and final static PNG evidence', async () => {
  const input = await rectanglePng(80, 60, { left: 25, top: 20, width: 30, height: 20 });
  const result = await processStatic(input, {
    bounds: { width: EMOJI_SPEC.width, height: EMOJI_SPEC.height },
    removeBackground: false,
    marginPx: 6,
    canvasMode: 'exact',
    trimInput: true,
    maxBytes: EMOJI_SPEC.maxBytes,
    forbidPalette: true,
  });

  assert.deepEqual([result.info.width, result.info.height], [180, 180]);
  assert.equal(result.info.format, 'png');
  assert.equal(result.info.colorType, 6);
  assert.equal(result.info.channels, 4);
  assert.equal(result.info.isApng, false);
  assert.ok((result.info.transparentPixels ?? 0) > 0);
  assert.ok((result.info.foregroundPixels ?? 0) > 0);
  assert.equal((await inspectStaticPng(result.buffer, '001.png')).filename, '001.png');
});

test('Node static Emoji evaluates reduced-color candidates as final truecolor bytes', async () => {
  const width = 80;
  const height = 60;
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      pixels[offset] = (x * 37 + y * 13) % 256;
      pixels[offset + 1] = (x * 11 + y * 47) % 256;
      pixels[offset + 2] = (x * 71 + y * 5) % 256;
      pixels[offset + 3] = x < 4 || y < 4 ? 0 : 255;
    }
  }
  const input = await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer();
  const result = await processStatic(input, {
    bounds: { width: EMOJI_SPEC.width, height: EMOJI_SPEC.height },
    removeBackground: false,
    marginPx: 4,
    canvasMode: 'exact',
    trimInput: true,
    maxBytes: 1,
    forbidPalette: true,
  });

  assert.equal(result.info.colorType, 6);
  assert.equal(result.info.channels, 4);
  assert.ok(result.notes.some((note) => note.includes('減色至')));
  assert.ok(result.notes.some((note) => note.includes('仍超過')));
});

test('processAnimated rejects mismatched source canvases instead of stretching them', async () => {
  const frames = await Promise.all([
    rectanglePng(24, 16, { left: 2, top: 5, width: 4, height: 4 }),
    rectanglePng(24, 16, { left: 3, top: 5, width: 4, height: 4 }),
    rectanglePng(24, 16, { left: 4, top: 5, width: 4, height: 4 }),
    rectanglePng(24, 16, { left: 5, top: 5, width: 4, height: 4 }),
    rectanglePng(25, 16, { left: 6, top: 5, width: 4, height: 4 }),
  ]);

  await assert.rejects(
    processAnimated(frames, {
      bounds: { width: 180, height: 180 },
      removeBackground: false,
      animation: animation(),
      limits: emojiLimits,
      requireConsistentFrameSize: true,
    }),
    /影格 5 尺寸 25×16.*不會自動拉伸/,
  );
});

test('legacy animated sticker processing still accepts independently fitted source canvases', async () => {
  const frames = await Promise.all([
    rectanglePng(24, 16, { left: 2, top: 5, width: 4, height: 4 }),
    rectanglePng(25, 16, { left: 3, top: 5, width: 4, height: 4 }),
    rectanglePng(24, 17, { left: 4, top: 5, width: 4, height: 4 }),
    rectanglePng(25, 17, { left: 5, top: 5, width: 4, height: 4 }),
    rectanglePng(24, 16, { left: 6, top: 5, width: 4, height: 4 }),
  ]);

  const result = await processAnimated(frames, {
    bounds: { width: 320, height: 270 },
    removeBackground: false,
    animation: animation({ maxBytes: 1_000_000 }),
  });

  assert.equal(result.info.frames, 5);
  assert.deepEqual([result.info.width, result.info.height], [320, 270]);
});

test('animated exact processing preserves motion and reports decoded final-byte evidence', async () => {
  const frames = await Promise.all(
    Array.from({ length: 6 }, (_, index) =>
      rectanglePng(24, 16, { left: 2 + index * 2, top: 6, width: 4, height: 4 }, [40 + index * 20, 80, 220]),
    ),
  );
  const result = await processAnimated(frames, {
    bounds: { width: EMOJI_SPEC.width, height: EMOJI_SPEC.height },
    removeBackground: false,
    animation: animation({ loops: 2, durationSec: 2 }),
    limits: emojiLimits,
    requireConsistentFrameSize: true,
    trimTransparentPadding: true,
    preserveFrames: true,
    forbidPalette: true,
  });

  assert.equal(result.info.format, 'png');
  assert.equal(result.info.colorType, 6);
  assert.equal(result.info.isApng, true);
  assert.deepEqual([result.info.width, result.info.height], [180, 180]);
  assert.equal(result.info.frames, 6);
  assert.equal(result.info.requestedFrames, 6);
  assert.equal(result.info.loops, 2);
  assert.equal(result.info.durationMs, 2_000);
  assert.equal(result.frameDelaysMs.reduce((sum, delay) => sum + delay, 0), 2_000);
  assert.equal(result.info.distinctFrames, 6);
  assert.ok((result.info.transparentPixels ?? 0) > 0);
  assert.ok((result.info.foregroundPixels ?? 0) > 0);
  assert.equal((await inspectStaticPng(result.buffer)).isApng, true);

  const first = await alphaBox(result.fittedFrames[0]!);
  const last = await alphaBox(result.fittedFrames.at(-1)!);
  assert.ok(first && last);
  assert.ok(first.left < last.left, 'one shared crop/scale must preserve deliberate horizontal motion');
});

test('animated emoji timing rejects off-contract durations instead of clamping', async () => {
  const frames = await Promise.all(
    Array.from({ length: 5 }, (_, index) =>
      rectanglePng(16, 16, { left: 2 + index, top: 6, width: 3, height: 3 }),
    ),
  );
  await assert.rejects(
    processAnimated(frames, {
      bounds: { width: 180, height: 180 },
      removeBackground: false,
      animation: animation({ durationSec: 1.5 }),
      limits: emojiLimits,
      preserveFrames: true,
      forbidPalette: true,
    }),
    /單輪播放時間 1\.5s 不合法/,
  );
});

test('preserveFrames constrains the Node auto ladder to the full sequence', async () => {
  const frames = await Promise.all(
    Array.from({ length: 6 }, (_, index) =>
      rectanglePng(12, 12, { left: 1 + index, top: 5, width: 2, height: 2 }),
    ),
  );
  const result = await processAnimated(frames, {
    bounds: { width: 12, height: 12 },
    removeBackground: false,
    animation: animation({ autoFit: true, maxBytes: 1 }),
    limits: emojiLimits,
    preserveFrames: true,
    forbidPalette: true,
  });
  assert.equal(result.info.frames, frames.length);
  assert.equal(result.usedFrameIndices.length, frames.length);
  assert.ok(result.notes.some((note) => note.includes('仍超過')));
});
