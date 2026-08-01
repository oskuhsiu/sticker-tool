import assert from 'node:assert/strict';
import { unzipSync } from 'fflate';
import { planVideoGrid } from '../../src/core/videoCrop.js';
import { encodeApng, decodeApngFrames } from '../src/webpipe/apng.js';
import { pngImageInfo } from '../src/webpipe/png.js';
import {
  buildVideoProjectZip,
  importVideoProjectZip,
} from '../src/webpipe/videoProjectZip.js';
import type { MasterApngSet } from '../src/webpipe/masterApng.js';
import type {
  VideoRenderSnapshot,
  VideoStickerSettings,
} from '../src/webpipe/processMasterApngSticker.js';

function frame(seed: number) {
  const data = new Uint8ClampedArray(16 * 16 * 4);
  for (let pixel = 0; pixel < 16 * 16; pixel++) {
    data[pixel * 4] = (pixel + seed * 29) % 256;
    data[pixel * 4 + 1] = (pixel * 3 + seed * 31) % 256;
    data[pixel * 4 + 2] = (pixel * 7 + seed * 37) % 256;
    data[pixel * 4 + 3] = pixel % 7 === 0 ? 0 : 255;
  }
  return { data, width: 16, height: 16 };
}

const timestampsMs = [0, 200, 400, 600, 800, 999];
const delaysMs = [200, 200, 200, 200, 199, 1];
const grid = planVideoGrid({ sourceWidth: 64, sourceHeight: 32, cols: 4, rows: 2, count: 8 });
const master: MasterApngSet = {
  timestampsMs,
  sourceFrameCount: timestampsMs.length,
  masterFrameCount: timestampsMs.length,
  chunkFrames: 10,
  stickers: grid.rects.map((rect) => {
    const png = encodeApng(
      timestampsMs.map((_, index) => frame(index + rect.index)),
      { loops: 1, delaysMs, colors: 0, forbidPalette: true },
    );
    return {
      id: rect.id,
      index: rect.index,
      width: 16,
      height: 16,
      distinctFrames: 6,
      transparentPixels: 100,
      foregroundPixels: 1000,
      chunks: [{
        id: `${rect.id}-chunk-001`,
        stickerId: rect.id,
        index: 0,
        timestampsMs,
        delaysMs,
        width: 16,
        height: 16,
        png,
      }],
    };
  }),
};
const settings: VideoStickerSettings[] = grid.rects.map(() => ({
  startMs: 0,
  endMs: 1000,
  targetFrames: 6,
  playbackSec: 1,
  loops: 1,
  maxColors: 0,
}));
const baseline: VideoRenderSnapshot[] = master.stickers.map((sticker, index) => {
  const png = sticker.chunks[0]!.png;
  return {
    png,
    info: pngImageInfo(png),
    settings: { ...settings[index]! },
    metrics: {
      masterFramesInRange: 6,
      requestedFrames: 6,
      outputFrames: 6,
      droppedFrames: 0,
      selectedTimestampsMs: timestampsMs,
      frameDelaysMs: delaysMs,
      perLoopDurationMs: 1000,
      totalPlaybackMs: 1000,
      bytes: png.length,
      width: 16,
      height: 16,
    },
    notes: [],
  };
});
const current = baseline.map((snapshot, index) => ({
  ...snapshot,
  settings: { ...snapshot.settings, targetFrames: index === 0 ? 5 : 6 },
}));

const built = buildVideoProjectZip({
  name: 'roundtrip',
  createdAt: '2026-07-29T00:00:00.000Z',
  cover: 1,
  source: {
    fileName: 'source.mp4',
    mimeType: 'video/mp4',
    durationMs: 1000,
    width: 64,
    height: 32,
  },
  editableStartMs: 0,
  editableEndMs: 1000,
  grid,
  master,
  settings,
  baseline,
  current,
});
const restored = importVideoProjectZip(built.zip);
const entries = Object.keys(unzipSync(built.zip));
assert.equal(entries.some((entry) => /\.(mp4|mov|webm|m4v)$/i.test(entry)), false);
assert.equal(entries.includes('sticker-project.json'), true);
assert.equal(entries.filter((entry) => entry.startsWith('renders/original/')).length, 8);
assert.equal(entries.filter((entry) => entry.startsWith('renders/adjusted/')).length, 8);
assert.equal(restored.manifest.source.embedded, false);
assert.equal(restored.manifest.master.stickers.length, 8);
assert.equal(restored.current[0]!.settings.targetFrames, 5);
assert.deepEqual(restored.current[0]!.png, current[0]!.png);
const decoded = decodeApngFrames(restored.master.stickers[0]!.chunks[0]!.png);
assert.equal(decoded.frames.length, 6);
assert.deepEqual(decoded.delaysMs, delaysMs);
console.log(`video project round-trip OK (${built.zip.length} bytes)`);
