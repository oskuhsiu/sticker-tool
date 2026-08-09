import { adjacentDuplicateIndices, coalesceAdjacentFrames, equalRgbaFrames } from '@core/frameSequence.js';
import { ANIMATED_EMOJI_SPEC, ANIMATED_SPEC, POPUP_STICKER_SPEC } from '@core/spec.js';
import {
  candidateExpansionOrder,
  allocateExactDelays,
  representativeSelectionDurations,
  selectTimeUniformIndices,
  type SourceFrameTiming,
} from '@core/videoTimeline.js';
import type {
  VideoSelectionPlanV2,
  VideoStickerDraftV2,
  VideoOutputTarget,
} from '@core/videoProject.js';
import {
  validateAnimatedEmojiImage,
  validateAnimatedImage,
  validatePopupImage,
  type ImageInfo,
} from '@core/validate.js';
import { decodeApngFrames, encodeApngExactFrames } from './apng.js';
import { decodeMasterSticker, type MasterApngSticker } from './masterApng.js';
import { pngImageInfo } from './png.js';
import type { Raster } from './raster.js';
import { VideoFrameRenderCache } from './videoFrameRenderCache.js';
import type { VideoMasterStore } from './videoMasterStore.js';

export type VideoStickerSettings = VideoStickerDraftV2;

export interface VideoRenderMetrics {
  masterFramesInRange: number;
  requestedFrames: number;
  outputFrames: number;
  droppedFrames: number;
  selectedSourceIndices: number[];
  selectedTimestampsUs: number[];
  frameDelaysMs: number[];
  perLoopDurationMs: number;
  totalPlaybackMs: number;
  bytes: number;
  width: number;
  height: number;
  distinctFrames: number;
  adjacentDuplicateFrames: number;
  transparentPixels: number;
  foregroundPixels: number;
}

export interface VideoRenderSnapshot {
  png: Uint8Array;
  info: ImageInfo;
  settings: VideoStickerSettings;
  metrics: VideoRenderMetrics;
  selection: VideoSelectionPlanV2;
  notes: string[];
  errors: string[];
}

export interface AnimatedByteEvidence {
  frames: Raster[];
  delaysMs: number[];
  loops: number;
  info: ImageInfo;
  distinctFrames: number;
  adjacentDuplicateFrames: number;
  transparentPixels: number;
  foregroundPixels: number;
}

export function inspectAnimatedBytes(
  png: Uint8Array,
  requestedFrames?: number,
): AnimatedByteEvidence {
  const decoded = decodeApngFrames(png);
  const base = pngImageInfo(png);
  const unique: Raster[] = [];
  let transparentPixels = 0;
  let foregroundPixels = 0;
  for (const frame of decoded.frames) {
    if (!unique.some((candidate) => equalRgbaFrames(candidate, frame))) unique.push(frame);
    for (let index = 3; index < frame.data.length; index += 4) {
      const alpha = frame.data[index]!;
      if (alpha < 255) transparentPixels++;
      if (alpha > 10) foregroundPixels++;
    }
  }
  const adjacentDuplicateFrames = adjacentDuplicateIndices(decoded.frames, equalRgbaFrames).length;
  const durationMs = decoded.delaysMs.reduce((sum, delay) => sum + delay, 0);
  const info: ImageInfo = {
    ...base,
    frames: decoded.frames.length,
    requestedFrames,
    loops: decoded.loops,
    durationMs,
    distinctFrames: unique.length,
    adjacentDuplicateFrames,
    transparentPixels,
    foregroundPixels,
  };
  return {
    frames: decoded.frames,
    delaysMs: decoded.delaysMs,
    loops: decoded.loops,
    info,
    distinctFrames: unique.length,
    adjacentDuplicateFrames,
    transparentPixels,
    foregroundPixels,
  };
}

function targetContract(target: VideoOutputTarget) {
  if (target === 'animated-emoji') return ANIMATED_EMOJI_SPEC;
  if (target === 'popup') return POPUP_STICKER_SPEC;
  return ANIMATED_SPEC;
}

export function validateVideoStickerSettings(
  settings: VideoStickerSettings,
  target: VideoOutputTarget,
): string[] {
  const contract = targetContract(target);
  const errors: string[] = [];
  if (
    !Number.isSafeInteger(settings.rangeStartUs) ||
    !Number.isSafeInteger(settings.rangeEndUs) ||
    settings.rangeEndUs <= settings.rangeStartUs
  ) {
    errors.push('開始與結束時間必須是有效的整數微秒範圍');
  }
  if (
    !Number.isInteger(settings.targetFrames) ||
    settings.targetFrames < contract.minFrames ||
    settings.targetFrames > contract.maxFrames
  ) {
    errors.push(`目標格數必須是 ${contract.minFrames}–${contract.maxFrames}`);
  }
  if (
    target === 'popup' &&
    (!Number.isInteger(settings.staticFrameIndex) ||
      settings.staticFrameIndex! < 0 ||
      settings.staticFrameIndex! >= settings.targetFrames)
  ) {
    errors.push(`靜態圖 frame 必須是 1–${settings.targetFrames}`);
  }
  const allowedDurationMs = contract.playbackDurationsSec.map((seconds) => seconds * 1000);
  if (!allowedDurationMs.includes(settings.perLoopDurationMs)) {
    errors.push(`單輪播放時間必須是 ${allowedDurationMs.join('、')}ms`);
  }
  if (
    !Number.isInteger(settings.loops) ||
    settings.loops < contract.minLoops ||
    settings.loops > contract.maxLoops
  ) {
    errors.push(`循環次數必須是 ${contract.minLoops}–${contract.maxLoops}`);
  }
  if (settings.perLoopDurationMs * settings.loops > contract.maxDurationSec * 1000) {
    errors.push(`單輪 ${settings.perLoopDurationMs}ms × ${settings.loops} loops 超過總播放 ${contract.maxDurationSec} 秒`);
  }
  if (settings.background.mode === 'color-key' && settings.background.color !== undefined) {
    if (!/^#[0-9a-f]{6}$/i.test(settings.background.color)) errors.push('單色色鍵必須是 #RRGGBB');
  }
  return errors;
}

function cloneSettings(settings: VideoStickerSettings): VideoStickerSettings {
  return { ...settings, background: { ...settings.background } };
}

/** Render one draft from raw master frames without changing its requested target frame count. */
export async function processMasterApngSticker(args: {
  target: VideoOutputTarget;
  master: MasterApngSticker;
  store: VideoMasterStore;
  settings: VideoStickerSettings;
  cache: VideoFrameRenderCache;
  removerVersion: string;
  removeBackground?: (input: Raster, signal?: AbortSignal) => Promise<Raster>;
  signal?: AbortSignal;
  onProgress?: (stage: string) => void;
}): Promise<VideoRenderSnapshot> {
  const { master, settings } = args;
  const contract = targetContract(args.target);
  const settingErrors = validateVideoStickerSettings(settings, args.target);
  if (settingErrors.length > 0) throw new Error(settingErrors.join('；'));
  const decoded = await decodeMasterSticker(master, args.store, settings.rangeStartUs, settings.rangeEndUs);
  if (decoded.length === 0) throw new Error(`${master.id} 在目前 range 沒有 raw master frame`);
  const timings: SourceFrameTiming[] = decoded.map(({ sampleRef }) => ({
    sourceIndex: sampleRef.sourceIndex,
    timestampUs: sampleRef.timestampUs,
    durationUs: sampleRef.durationUs,
  }));
  const expansion = candidateExpansionOrder(timings, Math.min(settings.targetFrames, timings.length));
  const initialCount = Math.min(settings.targetFrames, timings.length);
  const transformed = new Map<number, Raster>();
  const candidateIndices: number[] = [];
  const quantizationRejected = new Set<number>();
  let bestAttempt: {
    png: Uint8Array;
    evidence: AnimatedByteEvidence;
    selected: number[];
    selectedDurationsUs: number[];
    delaysMs: number[];
    colors: number;
    overBudget: boolean;
    removed: number[];
  } | null = null;

  candidateLoop: for (let expansionIndex = 0; expansionIndex < expansion.length; expansionIndex++) {
    if (args.signal?.aborted) throw new DOMException('動畫處理已取消', 'AbortError');
    const localIndex = expansion[expansionIndex]!;
    const raw = decoded[localIndex]!;
    args.onProgress?.(expansionIndex < initialCount
      ? `初選畫格 ${expansionIndex + 1}/${initialCount}`
      : `補選畫格 ${expansionIndex - initialCount + 1}/${expansion.length - initialCount}`);
    let frame = raw.frame;
    if (settings.background.mode !== 'none') {
      if (!args.removeBackground) throw new Error(`${settings.background.mode} 去背 adapter 未啟用`);
      const key = VideoFrameRenderCache.key({
        stickerId: settings.stickerId,
        rawFrameHash: raw.rawFrameHash,
        removerVersion: args.removerVersion,
        background: settings.background,
      });
      const cached = args.cache.get(key);
      if (cached) {
        frame = cached;
      } else {
        frame = await args.removeBackground(frame, args.signal);
        args.cache.set(key, frame);
      }
    }
    transformed.set(localIndex, frame);
    candidateIndices.push(localIndex);

    while (true) {
      const ordered = [...candidateIndices].sort((a, b) => a - b);
      const coalesced = coalesceAdjacentFrames(
        ordered.map((index) => transformed.get(index)!),
        ordered.map((index) => timings[index]!.durationUs),
        equalRgbaFrames,
      );
      const baseSourceIndices = coalesced.keptIndices.map((position) => ordered[position]!);
      const runSourceIndices: number[] = [];
      const runDurationsUs: number[] = [];
      const removed = coalesced.removedAdjacentIndices.map((position) => ordered[position]!);
      for (let runIndex = 0; runIndex < baseSourceIndices.length; runIndex++) {
        const sourceIndex = baseSourceIndices[runIndex]!;
        const durationUs = coalesced.delaysMs[runIndex]!;
        if (quantizationRejected.has(sourceIndex) && runDurationsUs.length > 0) {
          runDurationsUs[runDurationsUs.length - 1]! += durationUs;
          removed.push(sourceIndex);
        } else {
          runSourceIndices.push(sourceIndex);
          runDurationsUs.push(durationUs);
        }
      }
      if (runSourceIndices.length < Math.min(settings.targetFrames, timings.length) && expansionIndex < expansion.length - 1) {
        break;
      }
      const outputTarget = Math.min(settings.targetFrames, runSourceIndices.length);
      const runTimings = runSourceIndices.map((index) => timings[index]!);
      const selectedRunPositions = selectTimeUniformIndices(runTimings, outputTarget);
      const selected = selectedRunPositions.map((position) => runSourceIndices[position]!);
      const selectedDurationsUs = representativeSelectionDurations(timings, selected);
      const selectedFrames = selected.map((index) => transformed.get(index)!);
      const delaysMs = allocateExactDelays(selectedDurationsUs, settings.perLoopDurationMs);
      args.onProgress?.(`編碼 ${selected.length} 格`);
      const encoded = encodeApngExactFrames(selectedFrames, {
        loops: settings.loops,
        delaysMs,
        maxBytes: contract.maxBytes,
        minColors: 16,
        maxColors: settings.maxColors,
        preserveColors: settings.preserveColors,
        forbidPalette: args.target === 'animated-emoji' || args.target === 'popup',
        acceptCandidate: (png) => {
          const candidateEvidence = inspectAnimatedBytes(png, settings.targetFrames);
          return (
            candidateEvidence.frames.length === selected.length &&
            candidateEvidence.adjacentDuplicateFrames === 0 &&
            candidateEvidence.info.durationMs === settings.perLoopDurationMs &&
            candidateEvidence.loops === settings.loops
          );
        },
      });
      const evidence = inspectAnimatedBytes(encoded.png, settings.targetFrames);
      const attempt = {
        png: encoded.png,
        evidence,
        selected,
        selectedDurationsUs,
        delaysMs: evidence.delaysMs,
        colors: encoded.colors,
        overBudget: encoded.overBudget,
        removed,
      };
      if (!bestAttempt || attempt.png.length < bestAttempt.png.length) bestAttempt = attempt;

      let addedQuantizationRejection = false;
      if (evidence.frames.length === selected.length) {
        for (const duplicatePosition of adjacentDuplicateIndices(evidence.frames, equalRgbaFrames)) {
          const rejected = selected[duplicatePosition]!;
          if (!quantizationRejected.has(rejected)) {
            quantizationRejected.add(rejected);
            addedQuantizationRejection = true;
          }
        }
      }
      if (addedQuantizationRejection) continue;
      if (
        evidence.info.frames === settings.targetFrames &&
        evidence.adjacentDuplicateFrames === 0 &&
        evidence.info.durationMs === settings.perLoopDurationMs
      ) {
        bestAttempt = attempt;
        break candidateLoop;
      }
      break;
    }
  }

  if (!bestAttempt) throw new Error(`${master.id} 無法建立任何成品候選`);
  const { evidence } = bestAttempt;
  const targetName = args.target === 'animated-emoji'
    ? `${String(master.index + 1).padStart(3, '0')}.png`
    : args.target === 'popup'
      ? `popup/${String(master.index + 1).padStart(2, '0')}.png`
      : `${String(master.index + 1).padStart(2, '0')}.png`;
  const validation = args.target === 'animated-emoji'
    ? validateAnimatedEmojiImage(evidence.info, targetName)
    : args.target === 'popup'
      ? validatePopupImage(evidence.info, targetName)
      : validateAnimatedImage(evidence.info, targetName);
  const errors = validation.issues.filter((issue) => issue.level === 'error').map((issue) => issue.message);
  const notes: string[] = [];
  if (settings.preserveColors) notes.push('保留原色（未減色）');
  else if (bestAttempt.colors !== 0) notes.push(`減色至 ${bestAttempt.colors} 色`);
  if (evidence.info.frames !== settings.targetFrames) {
    notes.push(`此範圍最多只有 ${evidence.info.frames} 個可區分成品畫格，目標為 ${settings.targetFrames}`);
  }
  if (bestAttempt.overBudget) {
    notes.push(`exact-target 成品 ${(bestAttempt.png.length / 1024).toFixed(0)}KB 超過 ${(contract.maxBytes / 1000).toFixed(0)}KB`);
  }
  if (evidence.adjacentDuplicateFrames > 0) {
    notes.push(`量化後仍有 ${evidence.adjacentDuplicateFrames} 個相鄰重複畫格`);
  }
  notes.push(...errors.map((message) => `⚠ ${message}`));

  const selectedSourceIndices = bestAttempt.selected.map((index) => timings[index]!.sourceIndex);
  const selection: VideoSelectionPlanV2 = {
    candidateSourceIndices: candidateIndices.slice(0, initialCount).map((index) => timings[index]!.sourceIndex),
    selectedSourceIndices,
    removedAdjacentSourceIndices: bestAttempt.removed.map((index) => timings[index]!.sourceIndex),
    replacementSourceIndices: candidateIndices.slice(initialCount).map((index) => timings[index]!.sourceIndex),
    sourceTimestampsUs: bestAttempt.selected.map((index) => timings[index]!.timestampUs),
    sourceDurationsUs: [...bestAttempt.selectedDurationsUs],
    finalDelaysMs: [...evidence.delaysMs],
  };
  return {
    png: bestAttempt.png,
    info: evidence.info,
    settings: cloneSettings(settings),
    selection,
    notes,
    errors,
    metrics: {
      masterFramesInRange: decoded.length,
      requestedFrames: settings.targetFrames,
      outputFrames: evidence.info.frames ?? evidence.frames.length,
      droppedFrames: decoded.length - evidence.frames.length,
      selectedSourceIndices,
      selectedTimestampsUs: selection.sourceTimestampsUs,
      frameDelaysMs: [...evidence.delaysMs],
      perLoopDurationMs: evidence.info.durationMs ?? 0,
      totalPlaybackMs: (evidence.info.durationMs ?? 0) * settings.loops,
      bytes: bestAttempt.png.length,
      width: evidence.info.width,
      height: evidence.info.height,
      distinctFrames: evidence.distinctFrames,
      adjacentDuplicateFrames: evidence.adjacentDuplicateFrames,
      transparentPixels: evidence.transparentPixels,
      foregroundPixels: evidence.foregroundPixels,
    },
  };
}
