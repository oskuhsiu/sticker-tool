import assert from 'node:assert/strict';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { planVideoGrid, planVideoOutputCanvas } from '../../src/core/videoCrop.js';
import { encodeApng, decodeApngFrames, encodeApngExactFrames } from '../src/webpipe/apng.js';
import {
  buildVideoProjectZip,
  importVideoProjectZip,
} from '../src/webpipe/videoProjectZip.js';
import type { MasterApngSet } from '../src/webpipe/masterApng.js';
import {
  inspectAnimatedBytes,
  processMasterApngSticker,
  validateVideoStickerSettings,
  type VideoRenderSnapshot,
  type VideoStickerSettings,
} from '../src/webpipe/processMasterApngSticker.js';
import { VideoFrameRenderCache } from '../src/webpipe/videoFrameRenderCache.js';
import { createVideoMasterStore } from '../src/webpipe/videoMasterStore.js';
import type { Raster } from '../src/webpipe/raster.js';

function frame(width: number, height: number, seed: number) {
  const pixelCount = width * height;
  const data = new Uint8ClampedArray(pixelCount * 4);
  for (let pixel = 0; pixel < pixelCount; pixel++) {
    data[pixel * 4] = (pixel + seed * 29) % 256;
    data[pixel * 4 + 1] = (pixel * 3 + seed * 31) % 256;
    data[pixel * 4 + 2] = (pixel * 7 + seed * 37) % 256;
    data[pixel * 4 + 3] = pixel % 7 === 0 ? 0 : 255;
  }
  return { data, width, height };
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

const timestampsUs = [0, 200_000, 400_000, 600_000, 800_000, 999_000];
const delaysMs = [200, 200, 200, 200, 199, 1];
const grid = planVideoGrid({
  sourceWidth: 1080,
  sourceHeight: 540,
  cols: 4,
  rows: 2,
  count: 8,
  xCuts: [0, 250, 500, 800, 1080],
  yCuts: [0, 250, 540],
});
const store = await createVideoMasterStore({ projectId: 'roundtrip', forceMemory: true });
const stickers: MasterApngSet['stickers'] = [];
for (const rect of grid.rects) {
  const canvas = planVideoOutputCanvas('animated-sticker', rect.width, rect.height);
  const frames = timestampsUs.map((_, index) => frame(canvas.width, canvas.height, index + rect.index));
  const png = encodeApng(frames, { loops: 1, delaysMs, colors: 0, forbidPalette: true });
  const id = `${rect.id}-chunk-001`;
  const storeKey = `master/${rect.id}/chunk_001.png`;
  await store.put(storeKey, png);
  const visualRefs = frames.map((_, index) => ({
    visualFrameId: `${id}-visual-${index + 1}`,
    rgbaHash: `hash-${rect.index}-${index}`,
    chunkId: id,
    frameInChunk: index,
  }));
  stickers.push({
    id: rect.id,
    index: rect.index,
    width: canvas.width,
    height: canvas.height,
    chunks: [{
      id,
      stickerId: rect.id,
      index: 0,
      sampleRefs: timestampsUs.map((timestampUs, index) => ({
        sourceIndex: index,
        timestampUs,
        durationUs: delaysMs[index]! * 1000,
        chunkId: id,
        visualFrameId: visualRefs[index]!.visualFrameId,
      })),
      visualRefs,
      width: canvas.width,
      height: canvas.height,
      storeKey,
      bytes: png.length,
      sha256: await sha256(png),
    }],
  });
}
const master: MasterApngSet = {
  rangeStartUs: 0,
  rangeEndUs: 1_000_000,
  sourceFrameCount: timestampsUs.length,
  visualFrameCount: timestampsUs.length * stickers.length,
  chunkFrames: 20,
  frameCoverage: 'all-presentation-frames',
  backgroundStage: 'raw',
  stickers,
  store,
};
const settings: VideoStickerSettings[] = grid.rects.map((rect) => ({
  stickerId: rect.id,
  rangeStartUs: 0,
  rangeEndUs: 1_000_000,
  targetFrames: 6,
  perLoopDurationMs: 1000,
  loops: 1,
  background: { mode: 'none' },
  preserveColors: rect.index === 0,
  maxColors: 0,
}));
const current: VideoRenderSnapshot[] = [];
for (let index = 0; index < stickers.length; index++) {
  const sticker = stickers[index]!;
  const png = await store.get(sticker.chunks[0]!.storeKey);
  const targetFrames = index === 0 ? 5 : 6;
  const evidence = inspectAnimatedBytes(png, 6);
  current.push({
    png,
    info: evidence.info,
    settings: { ...settings[index]!, targetFrames },
    metrics: {
      masterFramesInRange: 6,
      requestedFrames: targetFrames,
      outputFrames: 6,
      droppedFrames: 0,
      selectedSourceIndices: [0, 1, 2, 3, 4, 5],
      selectedTimestampsUs: timestampsUs,
      frameDelaysMs: delaysMs,
      perLoopDurationMs: 1000,
      totalPlaybackMs: 1000,
      bytes: png.length,
      width: sticker.width,
      height: sticker.height,
      distinctFrames: evidence.distinctFrames,
      adjacentDuplicateFrames: evidence.adjacentDuplicateFrames,
      transparentPixels: evidence.transparentPixels,
      foregroundPixels: evidence.foregroundPixels,
    },
    selection: {
      candidateSourceIndices: [0, 1, 2, 3, 4, 5],
      selectedSourceIndices: [0, 1, 2, 3, 4, 5],
      removedAdjacentSourceIndices: [],
      replacementSourceIndices: [],
      sourceTimestampsUs: timestampsUs,
      sourceDurationsUs: delaysMs.map((delay) => delay * 1000),
      finalDelaysMs: delaysMs,
    },
    notes: [],
    errors: [],
  });
}

const built = await buildVideoProjectZip({
  target: 'animated-sticker',
  name: 'roundtrip',
  createdAt: '2026-08-01T00:00:00.000Z',
  cover: 1,
  source: {
    fileName: 'source.mp4',
    mimeType: 'video/mp4',
    container: 'Mp4',
    codec: 'avc1.42e01e',
    durationMs: 1000,
    durationUs: 1_000_000,
    firstTimestampUs: 0,
    endTimestampUs: 1_000_000,
    width: 1080,
    height: 540,
    codedWidth: 1080,
    codedHeight: 540,
    rotation: 0,
    pixelAspectRatio: { num: 1, den: 1 },
    frameCount: 6,
    averageFps: 6,
  },
  editableStartUs: 0,
  editableEndUs: 1_000_000,
  grid,
  master,
  settings,
  current,
});
const restored = await importVideoProjectZip(built.zip);
assert.equal(restored.manifest.version, 3);
assert.equal(restored.manifest.target, 'animated-sticker');
assert.equal(restored.manifest.source.embedded, false);
assert.equal(restored.manifest.frameCoverage, 'all-presentation-frames');
assert.equal(restored.manifest.backgroundStage, 'raw');
assert.equal(restored.manifest.master.stickers.length, 8);
assert.deepEqual(restored.manifest.grid, grid, 'Project V3 must preserve unequal source-pixel grid geometry');
assert.equal(restored.current[0]!.settings.targetFrames, 5);
assert.equal(restored.manifest.settings[0]!.preserveColors, true);
assert.equal(restored.current[0]!.info.format, 'png');
assert.deepEqual(restored.current[0]!.png, current[0]!.png);
const restoredChunk = restored.master.stickers[0]!.chunks[0]!;
const decoded = decodeApngFrames(await restored.master.store.get(restoredChunk.storeKey));
assert.equal(decoded.frames.length, 6);
assert.deepEqual(decoded.delaysMs, delaysMs);
assert.equal(restoredChunk.sampleRefs.length, 6);
assert.equal(restoredChunk.visualRefs.length, 6);
console.log(`video project V3 streaming round-trip OK (${built.zip.length} bytes)`);

const v2Archive = unzipSync(built.zip);
const v2Manifest = JSON.parse(new TextDecoder().decode(v2Archive['sticker-project.json'])) as Record<string, unknown>;
v2Manifest.version = 2;
delete v2Manifest.target;
v2Archive['sticker-project.json'] = strToU8(JSON.stringify(v2Manifest));
const restoredV2 = await importVideoProjectZip(zipSync(v2Archive));
assert.equal(restoredV2.manifest.version, 3);
assert.equal(restoredV2.manifest.target, 'animated-sticker');
console.log('Project V2 migrates explicitly to the Animated Sticker V3 target');

const popupSettings: VideoStickerSettings = {
  ...settings[0]!,
  perLoopDurationMs: 1000,
  loops: 3,
  staticFrameIndex: 4,
};
assert.deepEqual(validateVideoStickerSettings(popupSettings, 'popup'), []);
assert.match(
  validateVideoStickerSettings({ ...popupSettings, staticFrameIndex: 6 }, 'popup').join('；'),
  /靜態圖 frame 必須是 1–6/,
);
assert.match(
  validateVideoStickerSettings({ ...popupSettings, perLoopDurationMs: 2000, loops: 2 }, 'popup').join('；'),
  /超過總播放 3 秒/,
);
console.log('Popup Video settings require a valid derived-static frame and the 3-second playback contract');

const mismatchedTargetArchive = unzipSync(built.zip);
const mismatchedTargetManifest = JSON.parse(
  new TextDecoder().decode(mismatchedTargetArchive['sticker-project.json']),
) as Record<string, unknown>;
mismatchedTargetManifest.target = 'animated-emoji';
mismatchedTargetArchive['sticker-project.json'] = strToU8(JSON.stringify(mismatchedTargetManifest));
await assert.rejects(
  importVideoProjectZip(zipSync(mismatchedTargetArchive)),
  /canvas .*animated-emoji 目標 180×180 不一致/,
  'V3 import must reject a target whose baked master canvas does not match',
);

const extraEntryArchive = unzipSync(built.zip);
extraEntryArchive['source/undeclared.mp4'] = new Uint8Array([1, 2, 3]);
await assert.rejects(
  importVideoProjectZip(zipSync(extraEntryArchive)),
  /未宣告 entry/,
  'V2 import must reject undeclared source bytes',
);

const corruptArchive = unzipSync(built.zip);
const corruptPath = built.manifest.master.stickers[0]!.chunks[0]!.path;
corruptArchive[corruptPath] = corruptArchive[corruptPath]!.slice();
corruptArchive[corruptPath]![20] ^= 0xff;
await assert.rejects(
  importVideoProjectZip(zipSync(corruptArchive)),
  /checksum/,
  'V2 import must reject corrupt master bytes',
);

const legacyMasterPath = 'master/sticker-01/chunk_001.png';
const legacyRenderPath = 'renders/adjusted/01.png';
const legacyManifest = {
  schema: 'sticker-tool/video-apng-project',
  version: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  name: 'legacy-roundtrip',
  cover: 1,
  source: {
    fileName: 'legacy.mp4', mimeType: 'video/mp4', durationMs: 1000, width: 270, height: 270,
    embedded: false, editableStartMs: 0, editableEndMs: 1000, sampling: 'time-uniform',
  },
  grid: planVideoGrid({ sourceWidth: 270, sourceHeight: 270, cols: 1, rows: 1, count: 1 }),
  master: {
    sourceFrameCount: 6,
    masterFrameCount: 6,
    chunkFrames: 20,
    stickers: [{
      id: 'sticker-01', index: 0, width: 270, height: 270,
      chunks: [{
        path: legacyMasterPath,
        id: 'sticker-01-chunk-001',
        index: 0,
        timestampsMs: timestampsUs.map((value) => value / 1000),
        delaysMs,
        width: 270,
        height: 270,
        bytes: current[0]!.png.length,
      }],
    }],
  },
  settings: [{ startMs: 0, endMs: 1000, targetFrames: 6, playbackSec: 1, loops: 1, maxColors: 0 }],
  current: [{
    path: legacyRenderPath,
    settings: { startMs: 0, endMs: 1000, targetFrames: 6, playbackSec: 1, loops: 1, maxColors: 0 },
    metrics: {
      masterFramesInRange: 6,
      requestedFrames: 6,
      outputFrames: 6,
      droppedFrames: 0,
      selectedTimestampsMs: timestampsUs.map((value) => value / 1000),
      frameDelaysMs: delaysMs,
      perLoopDurationMs: 1000,
      totalPlaybackMs: 1000,
      bytes: current[0]!.png.length,
      width: 270,
      height: 270,
      distinctFrames: 6,
      transparentPixels: current[0]!.metrics.transparentPixels,
      foregroundPixels: current[0]!.metrics.foregroundPixels,
    },
    notes: [],
  }],
};
const legacyZip = zipSync({
  'sticker-project.json': strToU8(JSON.stringify(legacyManifest)),
  [legacyMasterPath]: current[0]!.png,
  [legacyRenderPath]: current[0]!.png,
});
const restoredLegacy = await importVideoProjectZip(legacyZip);
assert.equal(restoredLegacy.manifest.frameCoverage, 'sampled-legacy');
assert.equal(restoredLegacy.manifest.backgroundStage, 'baked-legacy');
assert.equal(restoredLegacy.manifest.legacy?.importedFromVersion, 1);
assert.equal(restoredLegacy.master.sourceFrameCount, 6);
assert.equal(restoredLegacy.master.stickers[0]!.chunks[0]!.sampleRefs.length, 6);
assert.match(restoredLegacy.current[0]!.notes.at(-1) ?? '', /無法補回缺失 frame/);
console.log('strict V2 rejection and explicit V1 sampled/baked import OK');

async function contractMaster(id: string, sourceSeeds: number[]): Promise<MasterApngSet> {
  const contractStore = await createVideoMasterStore({ projectId: `contract-${id}`, forceMemory: true });
  const visualSeeds = [...new Set(sourceSeeds)];
  const visualFrames = visualSeeds.map((seed) => frame(270, 270, seed));
  const chunkId = `${id}-chunk-001`;
  const storeKey = `master/${id}/chunk_001.png`;
  const png = encodeApng(visualFrames, {
    loops: 1,
    delaysMs: visualFrames.map(() => 1),
    colors: 0,
    forbidPalette: true,
  });
  await contractStore.put(storeKey, png);
  const visualRefs = visualSeeds.map((seed, index) => ({
    visualFrameId: `${chunkId}-visual-${index + 1}`,
    rgbaHash: `seed-${seed}`,
    chunkId,
    frameInChunk: index,
  }));
  return {
    rangeStartUs: 0,
    rangeEndUs: sourceSeeds.length * 100_000,
    sourceFrameCount: sourceSeeds.length,
    visualFrameCount: visualFrames.length,
    chunkFrames: 20,
    frameCoverage: 'all-presentation-frames',
    backgroundStage: 'raw',
    stickers: [{
      id,
      index: 0,
      width: 270,
      height: 270,
      chunks: [{
        id: chunkId,
        stickerId: id,
        index: 0,
        sampleRefs: sourceSeeds.map((seed, index) => ({
          sourceIndex: index,
          timestampUs: index * 100_000,
          durationUs: 100_000,
          chunkId,
          visualFrameId: visualRefs[visualSeeds.indexOf(seed)]!.visualFrameId,
        })),
        visualRefs,
        width: 270,
        height: 270,
        storeKey,
        bytes: png.length,
        sha256: await sha256(png),
      }],
    }],
    store: contractStore,
  };
}

async function renderContract(sourceSeeds: number[], targetFrames: number) {
  const contract = await contractMaster(`contract-${sourceSeeds.join('-')}`, sourceSeeds);
  return processMasterApngSticker({
    target: 'animated-sticker',
    master: contract.stickers[0]!,
    store: contract.store,
    settings: {
      stickerId: contract.stickers[0]!.id,
      rangeStartUs: contract.rangeStartUs,
      rangeEndUs: contract.rangeEndUs,
      targetFrames,
      perLoopDurationMs: 1000,
      loops: 1,
      background: { mode: 'none' },
      maxColors: 0,
    },
    cache: new VideoFrameRenderCache(8 * 1024 * 1024),
    removerVersion: 'none@contract',
  });
}

async function renderQuantizationContract(sourceFrames: Raster[]) {
  const id = 'contract-quantization';
  const contractStore = await createVideoMasterStore({ projectId: id, forceMemory: true });
  const chunkId = `${id}-chunk-001`;
  const storeKey = `master/${id}/chunk_001.png`;
  const png = encodeApng(sourceFrames, {
    loops: 1,
    delaysMs: sourceFrames.map(() => 1),
    colors: 0,
    forbidPalette: true,
  });
  await contractStore.put(storeKey, png);
  const visualRefs = sourceFrames.map((_, index) => ({
    visualFrameId: `${chunkId}-visual-${index + 1}`,
    rgbaHash: `quant-${index}`,
    chunkId,
    frameInChunk: index,
  }));
  return processMasterApngSticker({
    target: 'animated-sticker',
    master: {
      id,
      index: 0,
      width: sourceFrames[0]!.width,
      height: sourceFrames[0]!.height,
      chunks: [{
        id: chunkId,
        stickerId: id,
        index: 0,
        sampleRefs: sourceFrames.map((_, index) => ({
          sourceIndex: index,
          timestampUs: index * 100_000,
          durationUs: 100_000,
          chunkId,
          visualFrameId: visualRefs[index]!.visualFrameId,
        })),
        visualRefs,
        width: sourceFrames[0]!.width,
        height: sourceFrames[0]!.height,
        storeKey,
        bytes: png.length,
        sha256: await sha256(png),
      }],
    },
    store: contractStore,
    settings: {
      stickerId: id,
      rangeStartUs: 0,
      rangeEndUs: sourceFrames.length * 100_000,
      targetFrames: 5,
      perLoopDurationMs: 1000,
      loops: 1,
      background: { mode: 'none' },
      maxColors: 16,
    },
    cache: new VideoFrameRenderCache(8 * 1024 * 1024),
    removerVersion: 'none@quantization-contract',
  });
}

const adjacentReplacement = await renderContract([1, 1, 2, 3, 4, 5], 5);
assert.equal(adjacentReplacement.metrics.outputFrames, 5);
assert.equal(adjacentReplacement.metrics.adjacentDuplicateFrames, 0);
assert.equal(adjacentReplacement.metrics.frameDelaysMs.reduce((sum, value) => sum + value, 0), 1000);
assert.ok(adjacentReplacement.selection.removedAdjacentSourceIndices.includes(1));
assert.ok(adjacentReplacement.selection.replacementSourceIndices.length > 0);
assert.ok(adjacentReplacement.selection.sourceDurationsUs.some((duration) => duration === 200_000));

const firstLastEqual = await renderContract([1, 2, 3, 4, 1], 5);
assert.equal(firstLastEqual.metrics.outputFrames, 5);
assert.equal(firstLastEqual.metrics.adjacentDuplicateFrames, 0);
assert.equal(firstLastEqual.metrics.distinctFrames, 4);

const allSame = await renderContract([7, 7, 7, 7, 7, 7], 5);
assert.equal(allSame.metrics.outputFrames, 1);
assert.ok(allSame.errors.length > 0);
assert.match(allSame.notes.join(' '), /最多只有 1 個可區分成品畫格/);
const quantizationFrames = Array.from({ length: 6 }, (_, frameIndex): Raster => {
  const width = 270;
  const height = 270;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel++) {
    const shade = pixel % 256;
    data[pixel * 4] = shade;
    data[pixel * 4 + 1] = shade;
    data[pixel * 4 + 2] = shade;
    data[pixel * 4 + 3] = 255;
  }
  if (frameIndex <= 1) {
    data[0] = 120 + frameIndex;
  } else {
    const startX = 20 + frameIndex * 32;
    for (let y = 100; y < 130; y++) for (let x = startX; x < startX + 30; x++) {
      const offset = (y * width + x) * 4;
      data[offset] = 255;
      data[offset + 1] = 0;
      data[offset + 2] = 0;
    }
  }
  return { data, width, height };
});
const quantizationReplacement = await renderQuantizationContract(quantizationFrames);
assert.equal(quantizationReplacement.metrics.outputFrames, 5);
assert.equal(quantizationReplacement.metrics.adjacentDuplicateFrames, 0);
assert.ok(quantizationReplacement.selection.removedAdjacentSourceIndices.includes(1));
assert.ok(quantizationReplacement.selection.replacementSourceIndices.includes(3));
const originalColorFailure = encodeApngExactFrames(quantizationFrames.slice(0, 5), {
  loops: 1,
  delaysMs: [200, 200, 200, 200, 200],
  maxBytes: 1,
  minColors: 16,
  preserveColors: true,
});
assert.equal(originalColorFailure.colors, 0, 'original-color mode must not try palette candidates');
assert.equal(originalColorFailure.overBudget, true, 'original-color mode must report oversize instead of reducing colors');
let randomState = 0x4a3c40c3;
const oversizedFrames = Array.from({ length: 20 }, (): Raster => {
  const width = 512;
  const height = 512;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel++) {
    randomState ^= randomState << 13;
    randomState ^= randomState >>> 17;
    randomState ^= randomState << 5;
    const color = (randomState & 15) * 17;
    data[pixel * 4] = color;
    data[pixel * 4 + 1] = 255 - color;
    data[pixel * 4 + 2] = (color * 7) & 255;
    data[pixel * 4 + 3] = 255;
  }
  return { data, width, height };
});
const oneMegabyteFailure = encodeApngExactFrames(oversizedFrames, {
  loops: 1,
  delaysMs: oversizedFrames.map(() => 50),
  maxBytes: 1_000_000,
  minColors: 16,
  maxColors: 16,
});
assert.equal(oneMegabyteFailure.overBudget, true);
assert.ok(oneMegabyteFailure.bytes > 1_000_000);
assert.equal(decodeApngFrames(oneMegabyteFailure.png).frames.length, 20, '1 MB failure must not silently drop frames');
const tinyCache = new VideoFrameRenderCache(3);
tinyCache.set('oversize', { data: new Uint8ClampedArray([1, 2, 3, 255]), width: 1, height: 1 });
assert.equal(tinyCache.bytesUsed, 0);
assert.equal(tinyCache.get('oversize'), null);
console.log('exact-target, raw/quantized duplicate replacement, delay merge, first=last, all-same, and byte-failure contracts OK');
