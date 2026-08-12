import assert from 'node:assert/strict';
import type { VideoStickerSettings } from '../src/webpipe/processMasterApngSticker.js';
import {
  activeVideoVisualFrameIds,
  pickedVideoVisualFrameIds,
  prepareVideoFrame,
  selectVideoCalibrationFrames,
  type VideoRawVisualFrame,
} from '../src/webpipe/processMasterApngSticker.js';
import { createKeepMask, hashRasterContent } from '../src/webpipe/foregroundCorrection.js';
import {
  createVideoFrameCorrection,
  videoCorrectionSetIdentity,
  videoCorrectionTargetKey,
} from '../src/webpipe/videoForegroundCorrection.js';
import { VideoFrameRenderCache } from '../src/webpipe/videoFrameRenderCache.js';
import type { PreparedBackgroundRemovalSession } from '../src/webpipe/backgroundRemovalJob.js';
import type { MasterApngSticker } from '../src/webpipe/masterApng.js';
import type { Raster } from '../src/webpipe/raster.js';
import { createRawVisualIdentityRegistry } from '../src/webpipe/rawVideoMaster.js';

function raster(seed: number): Raster {
  return {
    width: 3,
    height: 1,
    data: new Uint8ClampedArray([
      seed, 10, 20, 255,
      30, seed, 40, 255,
      50, 60, seed, 255,
    ]),
  };
}

const settings: VideoStickerSettings = {
  stickerId: 'sticker-1',
  rangeStartUs: 0,
  rangeEndUs: 500,
  targetFrames: 3,
  perLoopDurationMs: 1000,
  loops: 1,
  background: {
    mode: 'color-key',
    color: '#cf567b',
    colorKey: { scope: 'edge-connected', edge: 'decontaminate' },
  },
  maxColors: 0,
};
const source = raster(100);
const sourceContentHash = await hashRasterContent(source);
let automaticCalls = 0;
const prepared: PreparedBackgroundRemovalSession = {
  identity: 'prepared-shared-calibration',
  async remove(input) {
    automaticCalls++;
    const data = new Uint8ClampedArray(input.data);
    for (let offset = 3; offset < data.length; offset += 4) data[offset] = 0;
    return {
      raster: { ...input, data },
      automaticMatte: new Uint8ClampedArray(input.width * input.height),
      sessionIdentity: this.identity,
    };
  },
};
const cache = new VideoFrameRenderCache(1024 * 1024);
const empty = await prepareVideoFrame({
  stickerId: settings.stickerId,
  visualFrameId: 'visual-1',
  source,
  sourceContentHash,
  settings,
  cache,
  removerVersion: 'browser-color-key@5',
  preparedBackground: prepared,
});
assert.equal(automaticCalls, 1);
assert.equal(empty.sessionIdentity, prepared.identity);
assert.deepEqual(empty.corrected, empty.automatic);

const mask = createKeepMask(source.width, source.height);
mask.data[1] = 255;
const correction = createVideoFrameCorrection({
  stickerId: settings.stickerId,
  visualFrameId: 'visual-1',
  sourceContentHash,
  label: 'visual 1',
  source,
  mask,
});
const corrections = new Map([[videoCorrectionTargetKey('sticker-1', 'visual-1'), correction]]);
const corrected = await prepareVideoFrame({
  stickerId: settings.stickerId,
  visualFrameId: 'visual-1',
  source,
  sourceContentHash,
  settings,
  cache,
  removerVersion: 'browser-color-key@5',
  preparedBackground: prepared,
  corrections,
});
assert.equal(corrected.automaticCacheHit, true, 'final render reuses preview automatic bytes');
assert.equal(automaticCalls, 1, 'Keep edits do not rerun the remover');
assert.deepEqual(
  corrected.corrected.data.slice(4, 8),
  source.data.slice(4, 8),
  'a correction restores the exact source pixel after automatic removal',
);

const changedSource = raster(101);
await prepareVideoFrame({
  stickerId: settings.stickerId,
  visualFrameId: 'visual-1',
  source: changedSource,
  sourceContentHash: await hashRasterContent(changedSource),
  settings,
  cache,
  removerVersion: 'browser-color-key@5',
  preparedBackground: prepared,
  corrections,
});
assert.equal(automaticCalls, 2, 'strong source content identity prevents stale automatic reuse');

const visuals: VideoRawVisualFrame[] = Array.from({ length: 7 }, (_, index) => ({
  frame: raster(index),
  visualFrameId: `visual-${index}`,
  rawFrameHash: `weak-${index}`,
  sourceContentHash: `strong-${index}`,
  sourceIndex: index,
  timestampUs: index * 100,
  durationUs: 100,
}));
assert.deepEqual(
  selectVideoCalibrationFrames(visuals).map((visual) => visual.visualFrameId),
  ['visual-0', 'visual-3', 'visual-6'],
  'calibration is time-stratified over raw visuals and independent of targetFrames',
);

const master: MasterApngSticker = {
  id: 'sticker-1',
  index: 0,
  width: 3,
  height: 1,
  chunks: [{
    id: 'chunk-1',
    stickerId: 'sticker-1',
    index: 0,
    width: 3,
    height: 1,
    storeKey: 'unused',
    bytes: 0,
    sha256: 'unused',
    visualRefs: [0, 1, 2].map((index) => ({
      visualFrameId: `visual-${index}`,
      rgbaHash: `weak-${index}`,
      chunkId: 'chunk-1',
      frameInChunk: index,
    })),
    sampleRefs: [
      { sourceIndex: 0, timestampUs: 0, durationUs: 100, chunkId: 'chunk-1', visualFrameId: 'visual-0' },
      { sourceIndex: 1, timestampUs: 100, durationUs: 100, chunkId: 'chunk-1', visualFrameId: 'visual-0' },
      { sourceIndex: 2, timestampUs: 200, durationUs: 100, chunkId: 'chunk-1', visualFrameId: 'visual-1' },
      { sourceIndex: 3, timestampUs: 300, durationUs: 100, chunkId: 'chunk-1', visualFrameId: 'visual-2' },
    ],
  }],
};
assert.deepEqual(activeVideoVisualFrameIds(master, 0, 300), ['visual-0', 'visual-1']);
assert.deepEqual(activeVideoVisualFrameIds(master, 0, 400), ['visual-0', 'visual-1', 'visual-2']);

const pickedMaster: MasterApngSticker = {
  ...master,
  chunks: [{
    ...master.chunks[0]!,
    visualRefs: [0, 1, 2, 3].map((index) => ({
      visualFrameId: `picked-${index}`,
      rgbaHash: `picked-weak-${index}`,
      chunkId: 'chunk-1',
      frameInChunk: index,
    })),
    sampleRefs: [
      { sourceIndex: 10, timestampUs: 0, durationUs: 90, chunkId: 'chunk-1', visualFrameId: 'picked-0' },
      { sourceIndex: 11, timestampUs: 90, durationUs: 130, chunkId: 'chunk-1', visualFrameId: 'picked-0' },
      { sourceIndex: 12, timestampUs: 220, durationUs: 780, chunkId: 'chunk-1', visualFrameId: 'picked-1' },
      { sourceIndex: 13, timestampUs: 1000, durationUs: 110, chunkId: 'chunk-1', visualFrameId: 'picked-2' },
      { sourceIndex: 14, timestampUs: 1110, durationUs: 90, chunkId: 'chunk-1', visualFrameId: 'picked-3' },
    ],
  }],
};
assert.deepEqual(
  pickedVideoVisualFrameIds(pickedMaster, 0, 1200, 3),
  ['picked-0', 'picked-1', 'picked-3'],
  'planned chips use the renderer time-uniform candidates rather than first-N samples',
);
assert.deepEqual(
  pickedVideoVisualFrameIds(pickedMaster, 0, 1200, 3, [10, 13, 14]),
  ['picked-0', 'picked-2', 'picked-3'],
  'final selected source indices replace the planned chip with actual replacement evidence',
);
assert.deepEqual(
  pickedVideoVisualFrameIds(pickedMaster, 0, 1200, 3, [10, 11, 13]),
  ['picked-0', 'picked-2'],
  'repeated presentation samples display one shared correction chip in presentation order',
);
const clippedPickMaster: MasterApngSticker = {
  ...master,
  chunks: [{
    ...master.chunks[0]!,
    visualRefs: [0, 1, 2, 3].map((index) => ({
      visualFrameId: `clipped-${index}`,
      rgbaHash: `clipped-weak-${index}`,
      chunkId: 'chunk-1',
      frameInChunk: index,
    })),
    sampleRefs: [
      { sourceIndex: 20, timestampUs: 0, durationUs: 200, chunkId: 'chunk-1', visualFrameId: 'clipped-0' },
      { sourceIndex: 21, timestampUs: 510, durationUs: 60, chunkId: 'chunk-1', visualFrameId: 'clipped-1' },
      { sourceIndex: 22, timestampUs: 570, durationUs: 430, chunkId: 'chunk-1', visualFrameId: 'clipped-2' },
      { sourceIndex: 23, timestampUs: 1000, durationUs: 100, chunkId: 'chunk-1', visualFrameId: 'clipped-3' },
    ],
  }],
};
assert.deepEqual(
  pickedVideoVisualFrameIds(clippedPickMaster, 100, 1100, 3),
  ['clipped-0', 'clipped-2', 'clipped-3'],
  'planned chip selection clips boundary sample intervals exactly like the renderer',
);
const beforeIdentity = videoCorrectionSetIdentity(corrections, 'sticker-1', ['visual-0']);
const afterIdentity = videoCorrectionSetIdentity(corrections, 'sticker-1', ['visual-0', 'visual-1']);
assert.notEqual(beforeIdentity, afterIdentity, 'newly included edited visuals alter current-render freshness');
assert.equal(
  videoCorrectionSetIdentity(corrections, 'sticker-1', ['visual-2']),
  videoCorrectionSetIdentity(new Map(), 'sticker-1', ['visual-2']),
  'range expansion leaves a previously unseen visual unedited',
);

const heldRegistry = createRawVisualIdentityRegistry('held-sticker');
const heldFrame = raster(77);
const firstChunkId = (await heldRegistry.resolve(heldFrame)).id;
await heldRegistry.resolve(raster(78)); // distinct visual in the first physical chunk
const secondChunkId = (await heldRegistry.resolve({ ...heldFrame, data: new Uint8ClampedArray(heldFrame.data) })).id;
assert.equal(secondChunkId, firstChunkId, 'identical raw visuals share one logical correction ID across chunk boundaries');

cache.set('unrelated-sticker', source);
cache.set('colab-sticker', source);
assert.equal(cache.invalidateWhere((key) => key.startsWith('colab')), 1);
assert.ok(cache.get('unrelated-sticker'), 'targeted invalidation preserves unrelated sticker entries');

console.log('video prepared-session, raw-visual correction, and cache identity contract OK');
