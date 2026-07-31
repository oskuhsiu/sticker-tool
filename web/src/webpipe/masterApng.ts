import { planAnimatedCanvas, type VideoGridPlan } from '@core/videoCrop.js';
import { decodeApngFrames, encodeApng } from './apng.js';
import {
  cropRaster,
  resizeRaster,
  yieldToUI,
  type Raster,
} from './raster.js';
import { detectBackground, keyBackground } from './sheetAnalysis.js';
import type { BrowserVideoSource } from './videoSource.js';

export interface MasterApngChunk {
  id: string;
  stickerId: string;
  index: number;
  timestampsMs: number[];
  delaysMs: number[];
  width: number;
  height: number;
  png: Uint8Array;
}

export interface MasterApngSticker {
  id: string;
  index: number;
  width: number;
  height: number;
  chunks: MasterApngChunk[];
}

export interface MasterApngSet {
  timestampsMs: number[];
  sourceFrameCount: number;
  masterFrameCount: number;
  chunkFrames: number;
  stickers: MasterApngSticker[];
}

/**
 * Optional local/remote background-model hook. It is deliberately applied
 * after a cell is cropped, so every model sees one sticker crop at a time and
 * a remote adapter never receives the full source frame.
 */
export type CropBackgroundRemover = (input: Raster, signal?: AbortSignal) => Promise<Raster>;

function sourceDelays(timestampsMs: number[]): number[] {
  if (timestampsMs.length === 1) return [100];
  return timestampsMs.map((timestamp, index) => {
    if (index < timestampsMs.length - 1) return Math.max(1, timestampsMs[index + 1]! - timestamp);
    return Math.max(1, timestamp - timestampsMs[index - 1]!);
  });
}

export async function buildMasterApngSet(args: {
  source: BrowserVideoSource;
  grid: VideoGridPlan;
  timestampsMs: number[];
  autoRemoveBackground: boolean;
  pickColor?: [number, number, number] | null;
  removeCropBackground?: CropBackgroundRemover;
  chunkFrames?: number;
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number) => void;
  onRemovalProgress?: (completed: number, total: number) => void;
}): Promise<MasterApngSet> {
  const chunkFrames = Math.max(2, Math.min(20, Math.round(args.chunkFrames ?? 10)));
  if (args.timestampsMs.length < 5) throw new Error('master APNG 至少需要 5 個來源時間點');
  const delays = sourceDelays(args.timestampsMs);
  const stickers: MasterApngSticker[] = args.grid.rects.map((rect) => {
    const canvas = planAnimatedCanvas(rect.width, rect.height);
    return {
      id: rect.id,
      index: rect.index,
      width: canvas.width,
      height: canvas.height,
      chunks: [],
    };
  });
  const pending = stickers.map(() => [] as Raster[]);
  let background: ReturnType<typeof detectBackground> | null = null;
  let chunkStart = 0;
  let removedCrops = 0;
  const totalCrops = args.timestampsMs.length * stickers.length;

  const flush = () => {
    if (pending[0]?.length === 0) return;
    const chunkEnd = chunkStart + pending[0]!.length;
    for (let stickerIndex = 0; stickerIndex < stickers.length; stickerIndex++) {
      const sticker = stickers[stickerIndex]!;
      const frames = pending[stickerIndex]!;
      const chunkIndex = sticker.chunks.length;
      const timestampsMs = args.timestampsMs.slice(chunkStart, chunkEnd);
      const delaysMs = delays.slice(chunkStart, chunkEnd);
      const png = encodeApng(frames, { loops: 1, delaysMs, colors: 0, forbidPalette: true });
      sticker.chunks.push({
        id: `${sticker.id}-chunk-${String(chunkIndex + 1).padStart(3, '0')}`,
        stickerId: sticker.id,
        index: chunkIndex,
        timestampsMs,
        delaysMs,
        width: sticker.width,
        height: sticker.height,
        png,
      });
      pending[stickerIndex] = [];
    }
    chunkStart = chunkEnd;
  };

  for (let frameIndex = 0; frameIndex < args.timestampsMs.length; frameIndex++) {
    if (args.signal?.aborted) throw new DOMException('影片處理已取消', 'AbortError');
    const sourceFrame = await args.source.frameAt(args.timestampsMs[frameIndex]!, args.signal);
    let keyed = sourceFrame;
    if (!args.removeCropBackground) {
      if (!background) background = detectBackground(sourceFrame);
      keyed = keyBackground(sourceFrame, background, {
        autoRemove: args.autoRemoveBackground,
        pickColor: args.pickColor,
      });
    }
    for (let stickerIndex = 0; stickerIndex < stickers.length; stickerIndex++) {
      const rect = args.grid.rects[stickerIndex]!;
      const sticker = stickers[stickerIndex]!;
      let cropped = cropRaster(keyed, rect.left, rect.top, rect.width, rect.height);
      if (args.removeCropBackground) {
        cropped = await args.removeCropBackground(cropped, args.signal);
        removedCrops++;
        args.onRemovalProgress?.(removedCrops, totalCrops);
      }
      pending[stickerIndex]!.push(resizeRaster(cropped, sticker.width, sticker.height));
    }
    args.onProgress?.(frameIndex + 1, args.timestampsMs.length);
    if (pending[0]!.length >= chunkFrames) flush();
    await yieldToUI();
  }
  flush();

  return {
    timestampsMs: [...args.timestampsMs],
    sourceFrameCount: args.timestampsMs.length,
    masterFrameCount: args.timestampsMs.length,
    chunkFrames,
    stickers,
  };
}

export async function decodeMasterSticker(
  sticker: MasterApngSticker,
  startMs: number,
  endMs: number,
): Promise<{ frames: Raster[]; timestampsMs: number[] }> {
  const frames: Raster[] = [];
  const timestampsMs: number[] = [];
  for (const chunk of sticker.chunks) {
    if (!chunk.timestampsMs.some((timestamp) => timestamp >= startMs && timestamp < endMs)) continue;
    const decoded = decodeApngFrames(chunk.png);
    if (decoded.frames.length !== chunk.timestampsMs.length) {
      throw new Error(
        `${chunk.id} 解碼格數 ${decoded.frames.length} 與 manifest ${chunk.timestampsMs.length} 不一致`,
      );
    }
    for (let i = 0; i < decoded.frames.length; i++) {
      const timestamp = chunk.timestampsMs[i]!;
      if (timestamp >= startMs && timestamp < endMs) {
        frames.push(decoded.frames[i]!);
        timestampsMs.push(timestamp);
      }
    }
    await yieldToUI();
  }
  return { frames, timestampsMs };
}
