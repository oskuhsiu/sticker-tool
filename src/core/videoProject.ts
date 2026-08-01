import type { SourceFrameTiming } from './videoTimeline.js';

export const VIDEO_PROJECT_SCHEMA = 'sticker-tool/video-apng-project' as const;
export const VIDEO_PROJECT_VERSION = 2 as const;

export type VideoFrameCoverage = 'all-presentation-frames' | 'sampled-legacy';
export type VideoBackgroundStage = 'raw' | 'baked-legacy';

export interface SourceFrameRef extends SourceFrameTiming {
  chunkId: string;
  visualFrameId: string;
}
export interface RawVisualFrameRef {
  visualFrameId: string;
  rgbaHash: string;
  chunkId: string;
  frameInChunk: number;
}

export type VideoBackgroundMode = 'none' | 'color-key' | 'imgly' | 'local-birefnet' | 'colab-birefnet';

export interface VideoBackgroundSettings {
  mode: VideoBackgroundMode;
  color?: string;
  tolerance?: number;
}

export interface VideoStickerDraftV2 {
  stickerId: string;
  rangeStartUs: number;
  rangeEndUs: number;
  targetFrames: number;
  perLoopDurationMs: 1000 | 2000 | 3000 | 4000;
  loops: 1 | 2 | 3 | 4;
  background: VideoBackgroundSettings;
  maxColors: number;
}

export interface VideoSelectionPlanV2 {
  candidateSourceIndices: number[];
  selectedSourceIndices: number[];
  removedAdjacentSourceIndices: number[];
  replacementSourceIndices: number[];
  sourceTimestampsUs: number[];
  sourceDurationsUs: number[];
  finalDelaysMs: number[];
}

export function isVideoProjectManifestHeader(value: unknown): value is {
  schema: typeof VIDEO_PROJECT_SCHEMA;
  version: number;
} {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return record.schema === VIDEO_PROJECT_SCHEMA && Number.isInteger(record.version);
}
