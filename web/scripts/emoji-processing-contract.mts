import assert from 'node:assert/strict';

import { ANIMATED_EMOJI_SPEC, EMOJI_SPEC } from '../../src/core/spec.js';
import type { AnimationConfig } from '../../src/core/types.js';
import { fitCanvas } from '../src/webpipe/fitCanvas.js';
import { processAnimated } from '../src/webpipe/processAnimated.js';
import { processStatic } from '../src/webpipe/processStatic.js';
import type { Raster } from '../src/webpipe/raster.js';

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

function rectangleRaster(
  width: number,
  height: number,
  rect: { left: number; top: number; width: number; height: number },
  phase = 0,
): Raster {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = rect.top; y < rect.top + rect.height; y++) {
    for (let x = rect.left; x < rect.left + rect.width; x++) {
      const offset = (y * width + x) * 4;
      data[offset] = 40 + phase * 20;
      data[offset + 1] = 80;
      data[offset + 2] = 220;
      data[offset + 3] = 255;
    }
  }
  return { data, width, height };
}

function alphaLeft(raster: Raster): number {
  let left = raster.width;
  for (let y = 0; y < raster.height; y++) {
    for (let x = 0; x < raster.width; x++) {
      if (raster.data[(y * raster.width + x) * 4 + 3]! > 10) left = Math.min(left, x);
    }
  }
  return left;
}

const exactInput = rectangleRaster(200, 200, { left: 10, top: 10, width: 180, height: 180 });
exactInput.data[(100 * exactInput.width + 100) * 4 + 3] = 0;
const exact = fitCanvas(exactInput, {
  bounds: { width: EMOJI_SPEC.width, height: EMOJI_SPEC.height },
  mode: 'exact',
  trimInput: true,
  marginPx: 0,
});
assert.deepEqual([exact.width, exact.height], [180, 180]);
assert.equal(alphaLeft(exact), 0, 'transparent input padding is cropped independently of exact output');

const staticResult = await processStatic(exactInput, {
  bounds: { width: EMOJI_SPEC.width, height: EMOJI_SPEC.height },
  removeBackground: false,
  marginPx: 0,
  canvasMode: 'exact',
  trimInput: true,
  maxBytes: EMOJI_SPEC.maxBytes,
  forbidPalette: true,
});
assert.deepEqual([staticResult.info.width, staticResult.info.height], [180, 180]);
assert.equal(staticResult.info.format, 'png');
assert.equal(staticResult.info.colorType, 6);
assert.equal(staticResult.info.isApng, false);
assert.ok((staticResult.info.transparentPixels ?? 0) > 0);
assert.ok((staticResult.info.foregroundPixels ?? 0) > 0);

const mismatched = Array.from({ length: 5 }, (_, index) =>
  rectangleRaster(index === 4 ? 201 : 200, 180, { left: 10, top: 0, width: 20, height: 180 }, index),
);
await assert.rejects(
  processAnimated(mismatched, {
    bounds: { width: 180, height: 180 },
    removeBackground: false,
    animation: animation(),
    requireConsistentFrameSize: true,
  }),
  /影格 5 尺寸 201×180.*不會自動拉伸/,
);

const frames = Array.from({ length: 6 }, (_, index) =>
  rectangleRaster(200, 180, {
    left: 10 + index * 32,
    top: 0,
    width: 20,
    height: 180,
  }, index),
);
const animated = await processAnimated(frames, {
  bounds: { width: 180, height: 180 },
  removeBackground: false,
  animation: animation({ loops: 2, durationSec: 2 }),
  requireConsistentFrameSize: true,
  limits: {
    minFrames: ANIMATED_EMOJI_SPEC.minFrames,
    maxFrames: ANIMATED_EMOJI_SPEC.maxFrames,
    maxDurationSec: ANIMATED_EMOJI_SPEC.maxDurationSec,
    playbackDurationsSec: ANIMATED_EMOJI_SPEC.playbackDurationsSec,
    label: 'Animated Emoji',
  },
  trimTransparentPadding: true,
  preserveFrames: true,
  forbidPalette: true,
});
assert.deepEqual([animated.info.width, animated.info.height], [180, 180]);
assert.equal(animated.info.format, 'png');
assert.equal(animated.info.colorType, 6);
assert.equal(animated.info.isApng, true);
assert.equal(animated.info.frames, 6);
assert.equal(animated.info.durationMs, 2_000);
assert.equal(animated.frameDelaysMs.reduce((sum, delay) => sum + delay, 0), 2_000);
assert.equal(animated.info.distinctFrames, 6);
assert.ok(alphaLeft(animated.fittedFrames[0]!) < alphaLeft(animated.fittedFrames.at(-1)!));

await assert.rejects(
  processAnimated(frames.slice(0, 5), {
    bounds: { width: 180, height: 180 },
    removeBackground: false,
    animation: animation({ durationSec: 1.5 }),
    limits: {
      minFrames: 5,
      maxFrames: 20,
      maxDurationSec: 4,
      playbackDurationsSec: [1, 2, 3, 4],
    },
  }),
  /單輪播放時間 1\.5s 不合法/,
);

console.log('browser emoji processing contracts: PASS');
