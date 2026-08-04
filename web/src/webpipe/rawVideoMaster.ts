import { planVideoOutputCanvas, type VideoGridPlan } from '@core/videoCrop.js';
import type { RawVisualFrameRef, SourceFrameRef, VideoOutputTarget } from '@core/videoProject.js';
import { encodeApng } from './apng.js';
import { fitCanvas } from './fitCanvas.js';
import {
  type MasterApngChunk,
  type MasterApngSet,
  type MasterApngSticker,
} from './masterApng.js';
import { cropRaster, yieldToUI, type Raster } from './raster.js';
import type { BrowserVideoSource } from './videoSource.js';
import type { VideoMasterStore } from './videoMasterStore.js';

function rgbaHash(raster: Raster): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < raster.data.length; index++) {
    hash ^= raster.data[index]!;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function equalRaster(a: Raster, b: Raster): boolean {
  if (a.width !== b.width || a.height !== b.height || a.data.length !== b.data.length) return false;
  for (let index = 0; index < a.data.length; index++) {
    if (a.data[index] !== b.data[index]) return false;
  }
  return true;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

interface PendingStickerChunk {
  samples: Array<Omit<SourceFrameRef, 'chunkId' | 'visualFrameId'> & { raster: Raster }>;
}

/** Build an all-presentation-frame, target-fitted raw-color master and stream it into the store. */
export async function buildRawVideoMaster(args: {
  source: BrowserVideoSource;
  grid: VideoGridPlan;
  target: VideoOutputTarget;
  rangeStartUs: number;
  rangeEndUs: number;
  store: VideoMasterStore;
  chunkFrames?: number;
  signal?: AbortSignal;
  onProgress?: (progress: {
    sourceFrames: number;
    totalSourceFrames: number;
    crops: number;
    totalCrops: number;
    chunks: number;
  }) => void;
}): Promise<MasterApngSet> {
  const chunkFrames = Math.max(2, Math.min(60, Math.round(args.chunkFrames ?? 20)));
  const sourceTimings = args.source.frameIndex.filter((frame) => {
    const endUs = frame.timestampUs + frame.durationUs;
    return frame.timestampUs < args.rangeEndUs && endUs > args.rangeStartUs;
  });
  if (sourceTimings.length < 1) throw new Error('可編輯時間窗內沒有 presentation frame');
  const stickers: MasterApngSticker[] = args.grid.rects.map((rect) => {
    const canvas = planVideoOutputCanvas(args.target, rect.width, rect.height);
    return { id: rect.id, index: rect.index, width: canvas.width, height: canvas.height, chunks: [] };
  });
  const pending: PendingStickerChunk[] = stickers.map(() => ({ samples: [] }));
  let processedFrames = 0;
  let processedCrops = 0;
  let writtenChunks = 0;

  const flush = async () => {
    if (pending[0]!.samples.length === 0) return;
    for (let stickerIndex = 0; stickerIndex < stickers.length; stickerIndex++) {
      const sticker = stickers[stickerIndex]!;
      const samples = pending[stickerIndex]!.samples;
      const chunkIndex = sticker.chunks.length;
      const chunkId = `${sticker.id}-chunk-${String(chunkIndex + 1).padStart(3, '0')}`;
      const storeKey = `master/${sticker.id}/chunk_${String(chunkIndex + 1).padStart(3, '0')}.png`;
      const visualFrames: Raster[] = [];
      const visualRefs: RawVisualFrameRef[] = [];
      const sampleRefs: SourceFrameRef[] = [];
      for (const sample of samples) {
        const hash = rgbaHash(sample.raster);
        let frameInChunk = -1;
        for (let index = 0; index < visualFrames.length; index++) {
          if (visualRefs[index]!.rgbaHash === hash && equalRaster(visualFrames[index]!, sample.raster)) {
            frameInChunk = index;
            break;
          }
        }
        if (frameInChunk < 0) {
          frameInChunk = visualFrames.length;
          visualFrames.push(sample.raster);
          visualRefs.push({
            visualFrameId: `${chunkId}-visual-${String(frameInChunk + 1).padStart(3, '0')}`,
            rgbaHash: hash,
            chunkId,
            frameInChunk,
          });
        }
        sampleRefs.push({
          sourceIndex: sample.sourceIndex,
          timestampUs: sample.timestampUs,
          durationUs: sample.durationUs,
          chunkId,
          visualFrameId: visualRefs[frameInChunk]!.visualFrameId,
        });
      }
      const png = encodeApng(visualFrames, {
        loops: 1,
        delaysMs: visualFrames.map(() => 1),
        colors: 0,
        forbidPalette: true,
      });
      const chunk: MasterApngChunk = {
        id: chunkId,
        stickerId: sticker.id,
        index: chunkIndex,
        sampleRefs,
        visualRefs,
        width: sticker.width,
        height: sticker.height,
        storeKey,
        bytes: png.length,
        sha256: await sha256(png),
      };
      await args.store.put(storeKey, png);
      sticker.chunks.push(chunk);
      pending[stickerIndex] = { samples: [] };
      writtenChunks++;
    }
  };

  try {
    for await (const sourceFrame of args.source.frames(args.rangeStartUs, args.rangeEndUs, args.signal)) {
      if (args.signal?.aborted) throw new DOMException('影片處理已取消', 'AbortError');
      for (let stickerIndex = 0; stickerIndex < stickers.length; stickerIndex++) {
        const rect = args.grid.rects[stickerIndex]!;
        const sticker = stickers[stickerIndex]!;
        const crop = cropRaster(sourceFrame.raster, rect.left, rect.top, rect.width, rect.height);
        pending[stickerIndex]!.samples.push({
          sourceIndex: sourceFrame.sourceIndex,
          timestampUs: sourceFrame.timestampUs,
          durationUs: sourceFrame.durationUs,
          raster: fitCanvas(crop, {
            bounds: { width: sticker.width, height: sticker.height },
            mode: 'exact',
            trimInput: false,
            marginPx: 0,
          }),
        });
        processedCrops++;
      }
      processedFrames++;
      if (pending[0]!.samples.length >= chunkFrames) await flush();
      args.onProgress?.({
        sourceFrames: processedFrames,
        totalSourceFrames: sourceTimings.length,
        crops: processedCrops,
        totalCrops: sourceTimings.length * stickers.length,
        chunks: writtenChunks,
      });
      await yieldToUI();
    }
    await flush();
  } catch (error) {
    await args.store.clear();
    throw error;
  }

  const sampleCounts = new Set(stickers.map((sticker) => sticker.chunks.reduce(
    (sum, chunk) => sum + chunk.sampleRefs.length,
    0,
  )));
  if (sampleCounts.size !== 1 || !sampleCounts.has(sourceTimings.length)) {
    await args.store.clear();
    throw new Error('raw master sample index 不完整');
  }
  return {
    rangeStartUs: args.rangeStartUs,
    rangeEndUs: args.rangeEndUs,
    sourceFrameCount: sourceTimings.length,
    visualFrameCount: stickers.reduce(
      (sum, sticker) => sum + sticker.chunks.reduce((chunkSum, chunk) => chunkSum + chunk.visualRefs.length, 0),
      0,
    ),
    chunkFrames,
    frameCoverage: 'all-presentation-frames',
    backgroundStage: 'raw',
    stickers,
    store: args.store,
  };
}
