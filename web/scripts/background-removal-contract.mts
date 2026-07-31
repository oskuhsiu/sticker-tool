import assert from 'node:assert/strict';
import { createBackgroundRemovalJob } from '../src/webpipe/backgroundRemovalJob.js';
import { removeSheetBackgroundByCells } from '../src/webpipe/sheetBackgroundRemoval.js';
import { processAnimated } from '../src/webpipe/processAnimated.js';
import { makeAnimation } from '../src/ui/defaults.js';
import type { Raster } from '../src/webpipe/raster.js';

function solid(width: number, height: number, rgba: [number, number, number, number]): Raster {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel++) data.set(rgba, pixel * 4);
  return { data, width, height };
}

function setPixel(raster: Raster, x: number, y: number, rgba: [number, number, number, number]): void {
  raster.data.set(rgba, (y * raster.width + x) * 4);
}

function alphaAt(raster: Raster, x: number, y: number): number {
  return raster.data[(y * raster.width + x) * 4 + 3]!;
}

async function main(): Promise<void> {
  const source = solid(12, 6, [245, 245, 245, 255]);
  for (let y = 1; y <= 4; y++) {
    for (let x = 4; x <= 7; x++) setPixel(source, x, y, [220, 40, 30, 255]);
  }
  let calls = 0;
  const removed = await removeSheetBackgroundByCells(source, {
    cols: 2,
    rows: 1,
    overlapRatio: 0.25,
    remove: async (crop) => {
      calls++;
      const output = new Uint8ClampedArray(crop.data);
      for (let pixel = 0; pixel < crop.width * crop.height; pixel++) {
        const offset = pixel * 4;
        output[offset + 3] = output[offset]! > 200 && output[offset + 1]! < 100 ? 255 : 0;
      }
      return { data: output, width: crop.width, height: crop.height };
    },
  });
  assert.equal(calls, 2, 'one semantic inference per nominal cell');
  assert.equal(alphaAt(removed, 0, 0), 0, 'background becomes transparent');
  assert.equal(alphaAt(removed, 5, 2), 255, 'subject crossing the nominal cut remains opaque');
  assert.equal(alphaAt(removed, 7, 3), 255, 'overlap preserves subject on the far side of the cut');
  assert.deepEqual([...removed.data.slice((2 * 12 + 5) * 4, (2 * 12 + 5) * 4 + 3)], [220, 40, 30]);

  const noneJob = await createBackgroundRemovalJob({ mode: 'none' });
  assert.equal(await noneJob.remove(source), source, 'none mode is a true no-op');
  await noneJob.dispose();

  const keyedSource = solid(5, 1, [255, 255, 255, 255]);
  setPixel(keyedSource, 2, 0, [220, 40, 30, 255]);
  const colorJob = await createBackgroundRemovalJob({ mode: 'color-key', pickColor: [255, 255, 255] });
  const keyed = await colorJob.remove(keyedSource);
  assert.equal(alphaAt(keyed, 0, 0), 0, 'selected solid color is keyed out');
  assert.equal(alphaAt(keyed, 2, 0), 255, 'different foreground color is retained');
  await colorJob.dispose();

  let animatedCalls = 0;
  const frames = Array.from({ length: 5 }, () => {
    const frame = solid(32, 32, [255, 255, 255, 255]);
    for (let y = 8; y < 24; y++) {
      for (let x = 8; x < 24; x++) setPixel(frame, x, y, [220, 40, 30, 255]);
    }
    return frame;
  });
  const animated = await processAnimated(frames, {
    bounds: { width: 32, height: 32 },
    removeBackground: false,
    removeBackgroundRaster: async (frame) => {
      animatedCalls++;
      const output = new Uint8ClampedArray(frame.data);
      for (let pixel = 0; pixel < frame.width * frame.height; pixel++) {
        const offset = pixel * 4;
        output[offset + 3] = output[offset]! > 240 && output[offset + 1]! > 240 ? 0 : 255;
      }
      return { data: output, width: frame.width, height: frame.height };
    },
    animation: makeAnimation({ loops: 1, durationSec: 1, stabilize: false }),
  });
  assert.equal(animatedCalls, 5, 'injected remover runs once for every retained animation frame');
  assert.equal(alphaAt(animated.fittedFrames[0]!, 0, 0), 0, 'removal happens before animation fitting');
  assert.equal(alphaAt(animated.fittedFrames[0]!, 16, 16), 255, 'foreground survives animation processing');

  console.log('background-removal contract: PASS');
}

await main();
