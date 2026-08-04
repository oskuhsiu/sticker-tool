import assert from 'node:assert/strict';

import { BIG_STICKER_SPEC } from '../../src/core/spec.js';
import { validateBigStickerImage } from '../../src/core/validate.js';
import { encodeApngAutoFit, inspectAnimatedBytes } from '../src/webpipe/apng.js';
import { pngImageInfo } from '../src/webpipe/png.js';
import { fitPngUnderBytes } from '../src/webpipe/pngFit.js';
import { processAnimated } from '../src/webpipe/processAnimated.js';
import type { Raster } from '../src/webpipe/raster.js';

function patternedRaster(width: number, height: number, phase = 0): Raster {
  const data = new Uint8ClampedArray(width * height * 4);
  let state = (0x9e3779b9 ^ (phase * 0x85ebca6b)) >>> 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
      data[offset] = state & 255;
      data[offset + 1] = (state >>> 8) & 255;
      data[offset + 2] = (state >>> 16) & 255;
      data[offset + 3] = x === 0 || y === 0 ? 0 : 255;
    }
  }
  return { data, width, height };
}

const bigRaster = patternedRaster(BIG_STICKER_SPEC.minWidth, BIG_STICKER_SPEC.minHeight);
const untouched = fitPngUnderBytes(bigRaster, 1, { forbidPalette: true });
assert.equal(untouched.overBudget, true);
assert.equal(untouched.colors, null, 'over-budget output must remain lossless until reduction is selected');
assert.equal(pngImageInfo(untouched.png).colorType, 6);

const reduced = fitPngUnderBytes(bigRaster, 1, { forbidPalette: true, reduceColors: true });
assert.notEqual(reduced.colors, null, 'explicit color reduction should search quantized candidates');
const reducedBigInfo = {
  ...pngImageInfo(reduced.png),
  transparentPixels: 1,
  foregroundPixels: 1,
};
assert.equal(reducedBigInfo.colorType, 6, 'quantized Big PNG must remain truecolor RGBA');
assert.equal(
  validateBigStickerImage({ ...reducedBigInfo, bytes: Math.min(reducedBigInfo.bytes, BIG_STICKER_SPEC.maxBytes) })
    .issues.some((issue) => issue.code === 'big.rgb'),
  false,
);

const popupFrames = Array.from({ length: 5 }, (_, index) => patternedRaster(480, 480, index));
const originalColorAnimation = await processAnimated(
  popupFrames.map((frame) => ({ ...frame, data: new Uint8ClampedArray(frame.data) })),
  {
    bounds: { width: 480, height: 480 },
    removeBackground: false,
    animation: {
      maxBytes: 1,
      loops: 1,
      durationSec: 1,
      autoFit: false,
      priority: 'balanced',
      minColors: 64,
      maxColors: 256,
      minFrames: 5,
      ladder: 'auto',
      stabilize: { enabled: false, anchor: 'none', axis: 'xy', darkThreshold: 70, topFraction: 0.5 },
    },
    preserveFrames: true,
    forbidPalette: true,
    limits: { minFrames: 5, maxFrames: 20, maxDurationSec: 3 },
  },
);
assert.equal(originalColorAnimation.info.bytes > 1, true);
assert.equal(originalColorAnimation.notes.some((note) => note.includes('減色至')), false);
assert.equal(pngImageInfo(originalColorAnimation.png).colorType, 6);
assert.equal(originalColorAnimation.fittedFrames.length, popupFrames.length);

const popup = encodeApngAutoFit(popupFrames, {
  loops: 1,
  delayMs: 200,
  maxBytes: 1,
  minColors: 64,
  maxColors: 256,
  minFrames: popupFrames.length,
  priority: 'colors',
  ladder: 'auto',
  forbidPalette: true,
});
const popupEvidence = inspectAnimatedBytes(popup.png, popupFrames.length).info;
assert.equal(popup.colors > 0, true, 'fixture must exercise a quantized APNG candidate');
assert.equal(popupEvidence.colorType, 6, 'quantized Pop-up APNG must remain truecolor RGBA');
assert.equal(popupEvidence.frames, popupFrames.length, 'optional color reduction must preserve frames');

console.log('truecolor Big/Pop-up encoding and opt-in reduction contracts OK');
