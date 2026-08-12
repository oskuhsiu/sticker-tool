import { adjacentDuplicateIndices, coalesceAdjacentFrames, equalRgbaFrames } from '@core/frameSequence.js';
import { isColorKeyOptions } from '@core/validate.js';
import { ANIMATED_EMOJI_SPEC, ANIMATED_SPEC, POPUP_STICKER_SPEC } from '@core/spec.js';
import {
  candidateExpansionOrder,
  allocateExactDelays,
  representativeSelectionDurations,
  selectTimeUniformIndices,
  type SourceFrameTiming,
} from '@core/videoTimeline.js';
import {
  cloneVideoStickerDraft,
  type VideoOutputTarget,
  VideoSelectionPlanV2,
  VideoStickerDraftV2,
} from '@core/videoProject.js';
import {
  validateAnimatedEmojiImage,
  validateAnimatedImage,
  validatePopupImage,
  type ImageInfo,
} from '@core/validate.js';
import { decodeApngFrames, encodeApngExactFrames } from './apng.js';
import type { PreparedBackgroundRemovalSession } from './backgroundRemovalJob.js';
import { hashRasterContent } from './foregroundCorrection.js';
import { decodeMasterSticker, type MasterApngSticker } from './masterApng.js';
import { pngImageInfo } from './png.js';
import type { Raster } from './raster.js';
import { VideoFrameRenderCache } from './videoFrameRenderCache.js';
import {
  applyVideoFrameCorrection,
  videoCorrectionTargetKey,
  type VideoFrameCorrectionMap,
} from './videoForegroundCorrection.js';
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
  /** Complete provenance used to reject stale current bytes before packaging. */
  renderIdentity?: VideoRenderIdentity;
}

export interface VideoRenderIdentity {
  readonly version: 'video-render-identity@1';
  readonly removerVersion: string;
  readonly configurationIdentity: string;
  readonly calibrationIdentity: string;
  readonly correctionIdentity: string;
  readonly sourceIdentity: string;
  readonly digest: string;
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

export interface VideoRepresentativeFrame {
  frame: Raster;
  candidateIndex: number;
  sourceIndex: number;
  timestampUs: number;
  visualFrameId?: string;
  sourceContentHash: string;
}

export interface VideoRawVisualFrame {
  frame: Raster;
  visualFrameId: string;
  rawFrameHash: string;
  sourceContentHash: string;
  sourceIndex: number;
  timestampUs: number;
  durationUs: number;
}

async function sha256Text(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function activeVideoVisualFrameIds(
  master: MasterApngSticker,
  rangeStartUs: number,
  rangeEndUs: number,
): string[] {
  const samples = master.chunks.flatMap((chunk) => chunk.sampleRefs).filter((sample) => (
    sample.timestampUs < rangeEndUs
    && sample.timestampUs + sample.durationUs > rangeStartUs
  ));
  samples.sort((a, b) => a.timestampUs - b.timestampUs || a.sourceIndex - b.sourceIndex);
  return [...new Set(samples.map((sample) => sample.visualFrameId))];
}

/** Load every unique raw visual in range. Repeated presentation samples share one result. */
export async function loadVideoRawVisualFrames(args: {
  master: MasterApngSticker;
  store: VideoMasterStore;
  rangeStartUs: number;
  rangeEndUs: number;
}): Promise<VideoRawVisualFrame[]> {
  const decoded = await decodeMasterSticker(args.master, args.store, args.rangeStartUs, args.rangeEndUs);
  const unique = new Map<string, VideoRawVisualFrame>();
  for (const item of decoded) {
    const visualFrameId = item.sampleRef.visualFrameId;
    if (unique.has(visualFrameId)) continue;
    unique.set(visualFrameId, {
      frame: item.frame,
      visualFrameId,
      rawFrameHash: item.rawFrameHash,
      sourceContentHash: await hashRasterContent(item.frame),
      sourceIndex: item.sampleRef.sourceIndex,
      timestampUs: item.sampleRef.timestampUs,
      durationUs: item.sampleRef.durationUs,
    });
  }
  return [...unique.values()];
}

/** Calibration is independent of targetFrames and covers the active raw-visual timeline. */
export function selectVideoCalibrationFrames(
  visuals: readonly VideoRawVisualFrame[],
  maximum = 3,
): VideoRawVisualFrame[] {
  if (!Number.isSafeInteger(maximum) || maximum < 1) throw new RangeError('Calibration frame count must be positive');
  if (visuals.length <= maximum) return [...visuals];
  const timings: SourceFrameTiming[] = visuals.map((visual) => ({
    sourceIndex: visual.sourceIndex,
    timestampUs: visual.timestampUs,
    durationUs: visual.durationUs,
  }));
  return selectTimeUniformIndices(timings, maximum).map((index) => visuals[index]!);
}

export async function videoSourceSetIdentity(
  visuals: readonly Pick<VideoRawVisualFrame, 'visualFrameId' | 'sourceContentHash'>[],
): Promise<string> {
  const parts = [...visuals]
    .sort((a, b) => a.visualFrameId.localeCompare(b.visualFrameId))
    .map((visual) => `${visual.visualFrameId}:${visual.sourceContentHash}`);
  return sha256Text(parts.join('\n'));
}

/** Pick up to three time-uniform frames from the draft's initial target-frame candidates. */
export async function loadVideoRepresentativeFrames(args: {
  master: MasterApngSticker;
  store: VideoMasterStore;
  rangeStartUs: number;
  rangeEndUs: number;
  targetFrames: number;
}): Promise<VideoRepresentativeFrame[]> {
  const decoded = await decodeMasterSticker(args.master, args.store, args.rangeStartUs, args.rangeEndUs);
  if (decoded.length === 0) return [];
  const timings: SourceFrameTiming[] = decoded.map(({ sampleRef }) => ({
    sourceIndex: sampleRef.sourceIndex,
    timestampUs: sampleRef.timestampUs,
    durationUs: sampleRef.durationUs,
  }));
  const candidatePositions = selectTimeUniformIndices(
    timings,
    Math.min(Math.max(1, Math.trunc(args.targetFrames)), timings.length),
  );
  const candidateTimings = candidatePositions.map((position) => timings[position]!);
  const maximumPreviews = Math.min(3, candidatePositions.length);
  return Promise.all(selectTimeUniformIndices(candidateTimings, maximumPreviews).map(async (candidateIndex) => {
    const decodedIndex = candidatePositions[candidateIndex]!;
    const selected = decoded[decodedIndex]!;
    return {
      frame: selected.frame,
      candidateIndex,
      sourceIndex: selected.sampleRef.sourceIndex,
      timestampUs: selected.sampleRef.timestampUs,
      visualFrameId: selected.sampleRef.visualFrameId,
      sourceContentHash: await hashRasterContent(selected.frame),
    };
  }));
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
  if (settings.background.mode === 'color-key') {
    const validColorKey = isColorKeyOptions(settings.background.colorKey);
    if (!validColorKey) errors.push('單色去背選項無效');
    if (validColorKey && settings.background.colorKey.scope === 'whole-image' && settings.background.color === undefined) {
      errors.push('全圖色碼去背必須指定背景色');
    }
  } else if (settings.background.colorKey !== undefined) {
    errors.push('只有單色去背可使用單色去背選項');
  }
  return errors;
}

export interface VideoFramePreparationResult {
  readonly automatic: Raster;
  readonly corrected: Raster;
  readonly sourceContentHash: string;
  readonly sessionIdentity: string;
  readonly automaticCacheHit: boolean;
}

/** Automatic removal is cached independently; Keep-mask edits only re-compose pixels. */
export async function prepareVideoFrame(args: {
  stickerId: string;
  visualFrameId: string;
  source: Raster;
  sourceContentHash: string;
  settings: VideoStickerSettings;
  cache: VideoFrameRenderCache;
  removerVersion: string;
  preparedBackground?: PreparedBackgroundRemovalSession;
  corrections?: VideoFrameCorrectionMap;
  signal?: AbortSignal;
}): Promise<VideoFramePreparationResult> {
  if (args.signal?.aborted) throw new DOMException('動畫處理已取消', 'AbortError');
  const sourceContentHash = args.sourceContentHash;
  let automatic = args.source;
  let automaticCacheHit = false;
  let sessionIdentity = 'background-none@1';
  if (args.settings.background.mode !== 'none') {
    if (!args.preparedBackground) throw new Error(`${args.settings.background.mode} prepared 去背 session 未啟用`);
    sessionIdentity = args.preparedBackground.identity;
    const key = VideoFrameRenderCache.key({
      stickerId: args.stickerId,
      visualFrameId: args.visualFrameId,
      sourceContentHash,
      removerVersion: args.removerVersion,
      calibrationIdentity: sessionIdentity,
      background: args.settings.background,
    });
    const cached = args.cache.get(key);
    if (cached) {
      automatic = cached;
      automaticCacheHit = true;
    } else {
      automatic = (await args.preparedBackground.remove(args.source, args.signal)).raster;
      args.cache.set(key, automatic);
    }
  }
  const correction = args.corrections?.get(videoCorrectionTargetKey(args.stickerId, args.visualFrameId));
  return {
    automatic,
    corrected: applyVideoFrameCorrection(args.source, automatic, correction, sourceContentHash),
    sourceContentHash,
    sessionIdentity,
    automaticCacheHit,
  };
}

/** Render one draft from raw master frames without changing its requested target frame count. */
export async function processMasterApngSticker(args: {
  target: VideoOutputTarget;
  master: MasterApngSticker;
  store: VideoMasterStore;
  settings: VideoStickerSettings;
  cache: VideoFrameRenderCache;
  removerVersion: string;
  configurationIdentity?: string;
  correctionIdentity?: string;
  preparedBackground?: PreparedBackgroundRemovalSession;
  sourceContentHashes?: ReadonlyMap<string, string>;
  corrections?: VideoFrameCorrectionMap;
  signal?: AbortSignal;
  onProgress?: (stage: string) => void;
}): Promise<VideoRenderSnapshot> {
  const { master, settings } = args;
  const contract = targetContract(args.target);
  const settingErrors = validateVideoStickerSettings(settings, args.target);
  if (settingErrors.length > 0) throw new Error(settingErrors.join('；'));
  const decoded = await decodeMasterSticker(master, args.store, settings.rangeStartUs, settings.rangeEndUs);
  if (decoded.length === 0) throw new Error(`${master.id} 在目前 range 沒有 raw master frame`);
  const sourceContentHashes = new Map(args.sourceContentHashes);
  for (const raw of decoded) {
    if (!sourceContentHashes.has(raw.sampleRef.visualFrameId)) {
      sourceContentHashes.set(raw.sampleRef.visualFrameId, await hashRasterContent(raw.frame));
    }
  }
  const sourceIdentity = await videoSourceSetIdentity(
    [...new Set(decoded.map((raw) => raw.sampleRef.visualFrameId))].map((visualFrameId) => ({
      visualFrameId,
      sourceContentHash: sourceContentHashes.get(visualFrameId)!,
    })),
  );
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
    const prepared = await prepareVideoFrame({
      stickerId: settings.stickerId,
      visualFrameId: raw.sampleRef.visualFrameId,
      source: raw.frame,
      sourceContentHash: sourceContentHashes.get(raw.sampleRef.visualFrameId)!,
      settings,
      cache: args.cache,
      removerVersion: args.removerVersion,
      preparedBackground: args.preparedBackground,
      corrections: args.corrections,
      signal: args.signal,
    });
    const frame = prepared.corrected;
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
        returnFirstRejectedCandidate: true,
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
  const calibrationIdentity = args.preparedBackground?.identity ?? args.removerVersion;
  const correctionIdentity = args.correctionIdentity ?? 'video-keep-set@1:0:cbf29ce484222325';
  const configurationIdentity = args.configurationIdentity ?? args.removerVersion;
  const identityInput = JSON.stringify({
    version: 'video-render-identity@1',
    removerVersion: args.removerVersion,
    configurationIdentity,
    calibrationIdentity,
    correctionIdentity,
    sourceIdentity,
  });
  const renderIdentity: VideoRenderIdentity = {
    version: 'video-render-identity@1',
    removerVersion: args.removerVersion,
    configurationIdentity,
    calibrationIdentity,
    correctionIdentity,
    sourceIdentity,
    digest: await sha256Text(identityInput),
  };
  return {
    png: bestAttempt.png,
    info: evidence.info,
    settings: cloneVideoStickerDraft(settings),
    selection,
    notes,
    errors,
    renderIdentity,
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
