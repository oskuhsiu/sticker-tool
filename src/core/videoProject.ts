import type { SourceFrameTiming } from './videoTimeline.js';
import { copyColorKeyOptions, type ColorKeyOptions } from './colorKey.js';

export const VIDEO_PROJECT_SCHEMA = 'sticker-tool/video-apng-project' as const;
export const VIDEO_PROJECT_VERSION = 7 as const;

export const VIDEO_CORRECTION_LIMITS = {
  maxEdits: 10_000,
  maxAssetBytes: 4_000_000,
  maxAggregateAssetBytes: 64_000_000,
  maxDecodedPixels: 100_000_000,
} as const;

/**
 * Product selected before raw-master ingest. Canvas geometry is baked into the
 * master chunks, so a project cannot switch products without re-ingesting.
 */
export type VideoOutputTarget = 'animated-sticker' | 'animated-emoji' | 'popup';

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

export interface VideoCorrectionTarget {
  stickerId: string;
  visualFrameId: string;
}

/** Runtime/export form. The mask is one byte per source pixel and is never embedded in JSON. */
export interface VideoForegroundCorrection extends VideoCorrectionTarget {
  sourceWidth: number;
  sourceHeight: number;
  sourceContentHash: string;
  mask: Uint8Array;
}

export interface VideoCorrectionAssetManifest {
  format: 'keep-mask-u8-crop-v1';
  id: string;
  path: string;
  sha256: string;
  bytes: number;
  width: number;
  height: number;
}

export interface VideoCorrectionTargetManifest extends VideoCorrectionTarget {
  sourceWidth: number;
  sourceHeight: number;
  sourceContentHash: string;
  bounds: { left: number; top: number; width: number; height: number };
  assetId: string;
}

export interface VideoCorrectionManifest {
  targets: VideoCorrectionTargetManifest[];
  assets: VideoCorrectionAssetManifest[];
}

/** Complete exact-render identity persisted for every non-null V7 current. */
export interface VideoRenderProvenance {
  removerVersion: string;
  configurationIdentity: string;
  calibrationIdentity: string;
  correctionSetHash: string;
  sourceSetHash: string;
}

export type VideoBackgroundMode = 'none' | 'color-key' | 'imgly' | 'local-birefnet' | 'colab-birefnet';

export interface VideoColorKeyBackgroundSettings {
  mode: 'color-key';
  color?: string;
  tolerance?: number;
  colorKey: ColorKeyOptions;
}

export interface VideoNonColorKeyBackgroundSettings {
  mode: Exclude<VideoBackgroundMode, 'color-key'>;
  color?: never;
  tolerance?: number;
  colorKey?: never;
}

export type VideoBackgroundSettings =
  | VideoColorKeyBackgroundSettings
  | VideoNonColorKeyBackgroundSettings;

export interface VideoStickerDraftV2 {
  stickerId: string;
  rangeStartUs: number;
  rangeEndUs: number;
  targetFrames: number;
  perLoopDurationMs: 1000 | 2000 | 3000 | 4000;
  loops: 1 | 2 | 3 | 4;
  background: VideoBackgroundSettings;
  /** Popup only: zero-based final APNG frame used to derive the paired static sticker. */
  staticFrameIndex?: number;
  /** Keep truecolor RGBA even when the result exceeds the delivery byte limit. */
  preserveColors?: boolean;
  maxColors: number;
}

/** Clone persisted draft data across UI, render, and archive ownership boundaries. */
export function cloneVideoStickerDraft(settings: VideoStickerDraftV2): VideoStickerDraftV2 {
  return {
    ...settings,
    background: settings.background.mode === 'color-key'
      ? { ...settings.background, colorKey: copyColorKeyOptions(settings.background.colorKey) }
      : {
          mode: settings.background.mode,
          ...(settings.background.tolerance === undefined
            ? {}
            : { tolerance: settings.background.tolerance }),
        },
  };
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
