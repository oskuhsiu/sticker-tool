import assert from 'node:assert/strict';
import { createBackgroundRemovalJob } from '../src/webpipe/backgroundRemovalJob.js';
import { removeSheetBackgroundByCells } from '../src/webpipe/sheetBackgroundRemoval.js';
import { processAnimated } from '../src/webpipe/processAnimated.js';
import { chromaKeyGreen, chromaKeySolid } from '../src/webpipe/sheetAnalysis.js';
import { makeAnimation } from '../src/ui/defaults.js';
import type { Raster } from '../src/webpipe/raster.js';
import type { ColorKeyOptions } from '../../src/core/colorKey.js';

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
  const colorJob = await createBackgroundRemovalJob({
    mode: 'color-key',
    pickColor: [255, 255, 255],
    colorKey: { edge: 'soft' },
  });
  const keyed = await colorJob.remove(keyedSource);
  assert.equal(alphaAt(keyed, 0, 0), 0, 'selected solid color is keyed out');
  assert.equal(alphaAt(keyed, 2, 0), 255, 'different foreground color is retained');

  const connectedSource = solid(5, 5, [255, 255, 255, 255]);
  for (let y = 1; y <= 3; y++) {
    for (let x = 1; x <= 3; x++) setPixel(connectedSource, x, y, [220, 40, 30, 255]);
  }
  setPixel(connectedSource, 2, 2, [255, 255, 255, 255]);
  setPixel(connectedSource, 4, 0, [245, 245, 245, 255]);
  const connected = await colorJob.remove(connectedSource);
  assert.equal(alphaAt(connected, 0, 0), 0, 'edge-connected selected color is removed');
  assert.equal(alphaAt(connected, 4, 0), 0, 'edge-connected near-background color is removed');
  assert.equal(alphaAt(connected, 1, 1), 255, 'different-color subject remains opaque');
  assert.equal(alphaAt(connected, 2, 2), 255, 'enclosed matching subject detail remains opaque');

  const topologySource = solid(4, 4, [220, 40, 30, 255]);
  setPixel(topologySource, 0, 0, [255, 255, 255, 255]);
  setPixel(topologySource, 1, 1, [255, 255, 255, 173]);
  setPixel(topologySource, 3, 0, [235, 235, 235, 255]);
  setPixel(topologySource, 3, 1, [234, 234, 234, 200]);
  setPixel(topologySource, 3, 2, [192, 192, 192, 64]);
  setPixel(topologySource, 3, 3, [191, 191, 191, 100]);
  const topology = await colorJob.remove(topologySource);
  assert.equal(alphaAt(topology, 0, 0), 0, 'exact border color is removed');
  assert.equal(alphaAt(topology, 1, 1), 173, 'diagonal-only matching detail is not four-way connected');
  assert.equal(alphaAt(topology, 3, 0), 0, 'distance 20 is fully transparent');
  assert.equal(alphaAt(topology, 3, 1), 6, 'distance 21 starts the soft matte');
  assert.equal(alphaAt(topology, 3, 2), 64, 'soft matte never increases source alpha');
  assert.equal(alphaAt(topology, 3, 3), 100, 'distance 64 is retained exactly');
  assert.deepEqual([...topology.data.slice((1 * 4 + 3) * 4, (1 * 4 + 3) * 4 + 3)], [234, 234, 234]);

  const compositeEdge = solid(1, 1, [213, 213, 213, 255]);
  const softEdge = chromaKeySolid(
    compositeEdge,
    [255, 255, 255],
    { edge: 'soft' },
  );
  const cleanEdge = chromaKeySolid(
    compositeEdge,
    [255, 255, 255],
    { edge: 'decontaminate' },
  );
  const hardEdge = chromaKeySolid(
    compositeEdge,
    [255, 255, 255],
    { edge: 'hard' },
  );
  assert.deepEqual([...softEdge.data], [213, 213, 213, 128], 'soft edge keeps composite RGB and feathered alpha');
  assert.deepEqual([...cleanEdge.data], [171, 171, 171, 128], 'decontaminate removes background color from opaque edge RGB');
  assert.deepEqual([...hardEdge.data], [213, 213, 213, 0], 'hard edge removes every in-scope candidate');

  const greenTopology = solid(5, 5, [20, 120, 20, 255]);
  for (let y = 1; y <= 3; y++) {
    for (let x = 1; x <= 3; x++) setPixel(greenTopology, x, y, [220, 40, 30, 255]);
  }
  setPixel(greenTopology, 2, 2, [20, 120, 20, 173]);
  const connectedGreen = chromaKeyGreen(greenTopology, { edge: 'decontaminate' });
  assert.equal(alphaAt(connectedGreen, 2, 2), 173, 'connected green key preserves enclosed green detail');
  assert.deepEqual(
    [...connectedGreen.data.slice((2 * 5 + 2) * 4, (2 * 5 + 2) * 4 + 4)],
    [20, 120, 20, 173],
    'connected green key preserves out-of-scope RGBA bit-for-bit',
  );
  const connectedGreenJob = await createBackgroundRemovalJob({
    mode: 'color-key',
    colorKey: { edge: 'decontaminate' },
  });
  assert.equal(
    alphaAt(await connectedGreenJob.remove(greenTopology), 2, 2),
    173,
    'auto-detected green background receives connected scope through the job dispatcher',
  );
  await assert.rejects(
    createBackgroundRemovalJob({
      mode: 'color-key',
      colorKey: { scope: 'all-matching', edge: 'decontaminate' } as unknown as ColorKeyOptions,
    }),
    /不支援.*全圖|全圖.*不支援/,
    'retired all-image keying is rejected instead of silently punching through subject pixels',
  );
  assert.throws(
    () => chromaKeySolid(
      connectedSource,
      [255, 255, 255],
      { scope: 'all-matching', edge: 'soft' } as unknown as ColorKeyOptions,
    ),
    /不支援.*全圖|全圖.*不支援/,
    'direct raster calls also reject retired all-image settings',
  );
  await connectedGreenJob.dispose();

  const greenThresholds = solid(4, 1, [80, 92, 50, 200]);
  setPixel(greenThresholds, 1, 0, [80, 93, 50, 255]);
  setPixel(greenThresholds, 2, 0, [50, 100, 20, 255]);
  setPixel(greenThresholds, 3, 0, [20, 110, 10, 255]);
  const softGreen = chromaKeyGreen(greenThresholds, { edge: 'soft' });
  const cleanGreen = chromaKeyGreen(greenThresholds, { edge: 'decontaminate' });
  const hardGreen = chromaKeyGreen(greenThresholds, { edge: 'hard' });
  assert.equal(alphaAt(softGreen, 0, 0), 200, 'greenness 12 preserves source alpha');
  assert.equal(alphaAt(softGreen, 1, 0), 252, 'greenness 13 starts the soft matte');
  assert.deepEqual([...softGreen.data.slice(8, 12)], [50, 100, 20, 131], 'soft green edge preserves RGB');
  assert.deepEqual([...cleanGreen.data.slice(8, 12)], [50, 70, 20, 131], 'green decontaminate despills only selected edge pixels');
  assert.equal(alphaAt(softGreen, 3, 0), 0, 'greenness 90 is fully transparent');
  assert.equal(alphaAt(hardGreen, 2, 0), 0, 'hard green edge removes every in-scope candidate');

  await assert.rejects(
    createBackgroundRemovalJob({
      mode: 'none',
      colorKey: { edge: 'soft' },
    }),
    /單色色鍵選項.*color-key/,
    'non-color-key jobs reject color-key-only options',
  );

  const empty = await colorJob.remove(solid(0, 0, [255, 255, 255, 255]));
  assert.equal(empty.data.length, 0, 'empty rasters remain empty');
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
