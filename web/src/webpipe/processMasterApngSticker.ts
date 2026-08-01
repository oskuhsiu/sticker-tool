import { ANIMATED_SPEC, maxBounds } from '@core/spec.js';
import { selectTimelineIndices } from '@core/videoCrop.js';
import type { AnimationConfig } from '@core/types.js';
import type { ImageInfo } from '@core/validate.js';
import { decodeMasterSticker, type MasterApngSticker } from './masterApng.js';
import { decodeApngFrames } from './apng.js';
import { processAnimated } from './processAnimated.js';

export interface VideoStickerSettings {
  startMs: number;
  endMs: number;
  targetFrames: number;
  playbackSec: 1 | 2 | 3 | 4;
  loops: 1 | 2 | 3 | 4;
  maxColors: number;
}

export interface VideoRenderMetrics {
  masterFramesInRange: number;
  requestedFrames: number;
  outputFrames: number;
  droppedFrames: number;
  selectedTimestampsMs: number[];
  frameDelaysMs: number[];
  perLoopDurationMs: number;
  totalPlaybackMs: number;
  bytes: number;
  width: number;
  height: number;
  distinctFrames: number;
  transparentPixels: number;
  foregroundPixels: number;
}

export interface VideoRenderSnapshot {
  png: Uint8Array;
  info: ImageInfo;
  settings: VideoStickerSettings;
  metrics: VideoRenderMetrics;
  notes: string[];
}

function animationFor(settings: VideoStickerSettings): AnimationConfig {
  return {
    maxBytes: ANIMATED_SPEC.maxBytes,
    loops: settings.loops,
    durationSec: settings.playbackSec,
    autoFit: true,
    priority: 'balanced',
    minColors: 16,
    maxColors: settings.maxColors,
    minFrames: ANIMATED_SPEC.minFrames,
    ladder: 'auto',
    stabilize: {
      enabled: false,
      anchor: 'none',
      axis: 'xy',
      darkThreshold: 70,
      topFraction: 0.5,
    },
  };
}

function decodedPixelEvidence(frames: Awaited<ReturnType<typeof decodeApngFrames>>['frames']): {
  distinctFrames: number;
  transparentPixels: number;
  foregroundPixels: number;
} {
  const hashes = new Set<number>();
  let transparentPixels = 0;
  let foregroundPixels = 0;
  for (const frame of frames) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < frame.data.length; index += 4) {
      const alpha = frame.data[index + 3]!;
      if (alpha < 255) transparentPixels++;
      if (alpha > 10) foregroundPixels++;
      hash ^= frame.data[index]!;
      hash = Math.imul(hash, 0x01000193);
      hash ^= frame.data[index + 1]!;
      hash = Math.imul(hash, 0x01000193);
      hash ^= frame.data[index + 2]!;
      hash = Math.imul(hash, 0x01000193);
      hash ^= alpha;
      hash = Math.imul(hash, 0x01000193);
    }
    hashes.add(hash >>> 0);
  }
  return { distinctFrames: hashes.size, transparentPixels, foregroundPixels };
}

export function validateVideoStickerSettings(settings: VideoStickerSettings): string[] {
  const errors: string[] = [];
  if (!Number.isInteger(settings.startMs) || !Number.isInteger(settings.endMs) || settings.endMs <= settings.startMs) {
    errors.push('開始與結束時間必須是有效的整數毫秒範圍');
  }
  if (
    !Number.isInteger(settings.targetFrames) ||
    settings.targetFrames < ANIMATED_SPEC.minFrames ||
    settings.targetFrames > ANIMATED_SPEC.maxFrames
  ) {
    errors.push(`目標格數必須是 ${ANIMATED_SPEC.minFrames}–${ANIMATED_SPEC.maxFrames}`);
  }
  if (![1, 2, 3, 4].includes(settings.playbackSec)) errors.push('單輪播放秒數必須是 1、2、3 或 4');
  if (![1, 2, 3, 4].includes(settings.loops)) errors.push('循環次數必須是 1–4');
  if (settings.playbackSec * settings.loops > ANIMATED_SPEC.maxDurationSec) {
    errors.push(`單輪 ${settings.playbackSec}s × ${settings.loops} loops 超過總播放 4 秒`);
  }
  return errors;
}

export async function processMasterApngSticker(
  master: MasterApngSticker,
  settings: VideoStickerSettings,
): Promise<VideoRenderSnapshot> {
  const errors = validateVideoStickerSettings(settings);
  if (errors.length > 0) throw new Error(errors.join('；'));

  const decoded = await decodeMasterSticker(master, settings.startMs, settings.endMs);
  if (decoded.frames.length < ANIMATED_SPEC.minFrames) {
    throw new Error(
      `${master.id} 在 ${(settings.startMs / 1000).toFixed(1)}–${(settings.endMs / 1000).toFixed(1)} 秒內只有 ` +
        `${decoded.frames.length} 個 master frames，至少需要 ${ANIMATED_SPEC.minFrames} 個`,
    );
  }
  const localIndices = selectTimelineIndices(
    decoded.timestampsMs,
    settings.startMs,
    settings.endMs,
    Math.min(settings.targetFrames, decoded.frames.length),
  );
  const selectedFrames = localIndices.map((index) => decoded.frames[index]!);
  const selectedTimestamps = localIndices.map((index) => decoded.timestampsMs[index]!);
  const processed = await processAnimated(selectedFrames, {
    bounds: maxBounds('animated'),
    removeBackground: false,
    animation: animationFor(settings),
  });
  const finalDecoded = decodeApngFrames(processed.png);
  const evidence = decodedPixelEvidence(finalDecoded.frames);
  const usedTimestamps = processed.usedFrameIndices.map((index) => selectedTimestamps[index]!);
  const finalDelaysMs = finalDecoded.delaysMs;
  const perLoopDurationMs = finalDelaysMs.reduce((sum, delay) => sum + delay, 0);
  const info: ImageInfo = {
    ...processed.info,
    durationMs: perLoopDurationMs,
    distinctFrames: evidence.distinctFrames,
    transparentPixels: evidence.transparentPixels,
    foregroundPixels: evidence.foregroundPixels,
  };
  return {
    png: processed.png,
    info,
    settings: { ...settings },
    notes: processed.notes,
    metrics: {
      masterFramesInRange: decoded.frames.length,
      requestedFrames: settings.targetFrames,
      outputFrames: processed.info.frames ?? processed.usedFrameIndices.length,
      droppedFrames: decoded.frames.length - processed.usedFrameIndices.length,
      selectedTimestampsMs: usedTimestamps,
      frameDelaysMs: [...finalDelaysMs],
      perLoopDurationMs,
      totalPlaybackMs: perLoopDurationMs * settings.loops,
      bytes: processed.png.length,
      width: processed.info.width,
      height: processed.info.height,
      ...evidence,
    },
  };
}
