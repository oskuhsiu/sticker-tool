import type { RawVisualFrameRef, SourceFrameRef, VideoFrameCoverage } from '@core/videoProject.js';
import { decodeApngFrames } from './apng.js';
import type { Raster } from './raster.js';
import type { VideoMasterStore } from './videoMasterStore.js';

export interface MasterApngChunk {
  id: string;
  stickerId: string;
  index: number;
  sampleRefs: SourceFrameRef[];
  visualRefs: RawVisualFrameRef[];
  width: number;
  height: number;
  storeKey: string;
  bytes: number;
  sha256: string;
}

export interface MasterApngSticker {
  id: string;
  index: number;
  width: number;
  height: number;
  chunks: MasterApngChunk[];
}

export interface MasterApngSet {
  rangeStartUs: number;
  rangeEndUs: number;
  sourceFrameCount: number;
  visualFrameCount: number;
  chunkFrames: number;
  frameCoverage: VideoFrameCoverage;
  backgroundStage: 'raw' | 'baked-legacy';
  stickers: MasterApngSticker[];
  store: VideoMasterStore;
}

export interface DecodedMasterFrame {
  frame: Raster;
  sampleRef: SourceFrameRef;
  rawFrameHash: string;
}

export async function decodeMasterSticker(
  sticker: MasterApngSticker,
  store: VideoMasterStore,
  startUs: number,
  endUs: number,
): Promise<DecodedMasterFrame[]> {
  const frames: DecodedMasterFrame[] = [];
  for (const chunk of sticker.chunks) {
    const relevant = chunk.sampleRefs.filter((sample) => {
      const sampleEndUs = sample.timestampUs + sample.durationUs;
      return sample.timestampUs < endUs && sampleEndUs > startUs;
    });
    if (relevant.length === 0) continue;
    const decoded = decodeApngFrames(await store.get(chunk.storeKey));
    if (decoded.frames.length !== chunk.visualRefs.length) {
      throw new Error(
        `${chunk.id} 解碼 visual 格數 ${decoded.frames.length} 與 manifest ${chunk.visualRefs.length} 不一致`,
      );
    }
    const visualById = new Map(chunk.visualRefs.map((visual) => [visual.visualFrameId, visual]));
    for (const sampleRef of relevant) {
      const visual = visualById.get(sampleRef.visualFrameId);
      if (!visual) throw new Error(`${chunk.id} 缺少 visual ${sampleRef.visualFrameId}`);
      const frame = decoded.frames[visual.frameInChunk];
      if (!frame) throw new Error(`${chunk.id} visual frameInChunk ${visual.frameInChunk} 超出範圍`);
      const clippedStartUs = Math.max(startUs, sampleRef.timestampUs);
      const clippedEndUs = Math.min(endUs, sampleRef.timestampUs + sampleRef.durationUs);
      frames.push({
        frame,
        rawFrameHash: visual.rgbaHash,
        sampleRef: {
          ...sampleRef,
          timestampUs: clippedStartUs,
          durationUs: clippedEndUs - clippedStartUs,
        },
      });
    }
  }
  frames.sort((a, b) => a.sampleRef.timestampUs - b.sampleRef.timestampUs);
  return frames;
}

export async function decodeMasterPoster(
  sticker: MasterApngSticker,
  store: VideoMasterStore,
): Promise<Raster> {
  const chunk = sticker.chunks[0];
  if (!chunk) throw new Error(`${sticker.id} 沒有 raw master chunk`);
  const decoded = decodeApngFrames(await store.get(chunk.storeKey));
  const firstSample = chunk.sampleRefs[0];
  if (!firstSample) throw new Error(`${chunk.id} 沒有 sample ref`);
  const visual = chunk.visualRefs.find((candidate) => candidate.visualFrameId === firstSample.visualFrameId);
  if (!visual || !decoded.frames[visual.frameInChunk]) throw new Error(`${chunk.id} 沒有 poster visual`);
  return decoded.frames[visual.frameInChunk]!;
}
