/**
 * 動態貼圖單張流程：連續影格 → 每格 fit 到同一畫布（≤320×270、一邊=270、偶數）
 * → [描邊][疊字] → APNG（loops 1–4）→ auto-fit 到 ≤1MB。
 *
 * ★ 防漂移/抖動（兩道）：
 *   1. 主體穩定化（stabilizeFrames，fit 前）：把各格主體對齊到同一錨點，殺掉 codex
 *      逐格產圖的跨格漂移（左右擺動可達畫面 20–25%）。這是「對齊主體」。
 *   2. fitCanvas 'exact'（不逐格 trim）：全部影格以相同縮放、相同位置落在同一畫布。
 *      這是「對齊畫布」——但畫布對齊救不了主體在格內的偏移，故需要第 1 道。
 *   逐格獨立 trim+置中會讓移動中的主體重新置中 → 抖動，故禁用。
 */

import sharp from 'sharp';
import { ANIMATED_SPEC } from '../core/spec.js';
import type { AnimationConfig, Bounds, RemoveBgMode, StrokeSpec, TextSpec } from '../core/types.js';
import type { ImageInfo } from '../core/validate.js';
import { applyBackgroundRemoval } from './removeBackground.js';
import { fitCanvas } from './fitCanvas.js';
import { applyStroke } from './stroke.js';
import { overlayText } from './text.js';
import { autoLadder, encodeApngAutoFit, inspectAnimatedBytes, subsampleFrames } from './apng.js';
import { stabilizeFrames } from './stabilize.js';

export interface ProcessAnimatedOptions {
  /** 動態畫布上限，預設 320×270 */
  bounds?: Bounds;
  removeBackground: RemoveBgMode;
  stroke?: StrokeSpec;
  text?: TextSpec;
  animation: AnimationConfig;
  /** Explicit frame/duration limits for workflows with a different APNG contract. */
  limits?: AnimatedProcessingLimits;
  /** Reject source frames whose decoded canvases differ. Emoji enables this explicitly. */
  requireConsistentFrameSize?: boolean;
  /** Crop every retained frame by one shared alpha-union box before exact fitting. */
  trimTransparentPadding?: boolean;
  /** Transparent margin inside the exact output canvas. Defaults to zero. */
  marginPx?: number;
  /** Never reduce the fitted frame sequence while searching optional color candidates. */
  preserveFrames?: boolean;
  /** Keep final PNG/APNG candidates in truecolor RGBA even when colors are quantized. */
  forbidPalette?: boolean;
  /** 影格率；給定則由它定每格延遲，否則用 animation.durationSec */
  fps?: number;
}

export interface AnimatedProcessingLimits {
  minFrames: number;
  maxFrames: number;
  maxDurationSec: number;
  /** When present, reject rather than clamp a per-loop duration outside this allowlist. */
  playbackDurationsSec?: readonly number[];
  label?: string;
}

export interface ProcessedAnimated {
  buffer: Buffer;
  info: ImageInfo;
  notes: string[];
  /** fit 後對齊的影格（供產動態 main.png 用） */
  fittedFrames: Buffer[];
  /** 最終 APNG 相對於 fitted sequence 實際採用的索引。 */
  usedFrameIndices: number[];
  /** 從最終 APNG 解碼取得的每格整數毫秒延遲。 */
  frameDelaysMs: number[];
}

const DEFAULT_BOUNDS: Bounds = { width: ANIMATED_SPEC.maxWidth, height: ANIMATED_SPEC.maxHeight };
const DEFAULT_LIMITS: AnimatedProcessingLimits = {
  minFrames: ANIMATED_SPEC.minFrames,
  maxFrames: ANIMATED_SPEC.maxFrames,
  maxDurationSec: ANIMATED_SPEC.maxDurationSec,
};

export async function processAnimated(
  frameInputs: (Buffer | string)[],
  opts: ProcessAnimatedOptions,
): Promise<ProcessedAnimated> {
  const notes: string[] = [];
  const bounds = opts.bounds ?? DEFAULT_BOUNDS;
  const limits = resolveLimits(opts.limits);

  // 1) Validate one source-canvas contract, then clamp to the workflow's retained-frame maximum.
  if (frameInputs.length < limits.minFrames) {
    throw new Error(`動態貼圖至少需 ${limits.minFrames} 格，只有 ${frameInputs.length}`);
  }
  const normalizedInputs = await normalizeAndValidateFrameInputs(
    frameInputs,
    opts.requireConsistentFrameSize ?? false,
  );
  let frames = normalizedInputs;
  if (frames.length > limits.maxFrames) {
    frames = subsampleFrames(frames, limits.maxFrames);
    const suffix = limits.label ? `（${limits.label} 上限）` : '（LINE 上限）';
    notes.push(`影格 ${frameInputs.length}→${limits.maxFrames}${suffix}`);
  }
  const perLoopSec = resolvePerLoopDuration(frames.length, opts, limits, notes);

  // 2) 載入 + 去背（全部影格先到手；穩定化要跨格一起算錨點中位數）
  const prepped: Buffer[] = [];
  for (const f of frames) {
    let buf = f;
    if (opts.removeBackground !== false) {
      buf = (await applyBackgroundRemoval(buf, opts.removeBackground)).buffer;
    }
    prepped.push(buf);
  }

  // 2b) 主體穩定化（殺跨格漂移）——務必在 fit 之前：fit 'exact' 只置中畫布、不對齊主體
  let aligned = prepped;
  const stab = opts.animation.stabilize;
  if (stab?.enabled && stab.anchor !== 'none') {
    const r = await stabilizeFrames(prepped, stab);
    aligned = r.frames;
    notes.push(`穩定化（${stab.anchor}）：主體水平漂移 ${r.driftBeforeX.toFixed(0)}→${r.driftAfterX.toFixed(0)}px`);
  }

  // 2c) Emoji-style trimming uses one union rectangle for the full sequence.
  // Per-frame trimming would recenter deliberate movement and is intentionally not used.
  const sequenceFit = opts.trimTransparentPadding
    ? await cropFramesToSharedAlphaBounds(aligned)
    : { frames: aligned, cropped: false };
  if (sequenceFit.cropped) notes.push('已依全序列共同前景範圍裁切透明邊');

  // 2d) 逐格 fit 'exact'（全格同縮放同位置）→ 描邊/疊字
  const fitted: Buffer[] = [];
  for (const buf0 of sequenceFit.frames) {
    let buf = (await fitCanvas(buf0, {
      bounds,
      mode: 'exact',
      trimInput: false,
      marginPx: opts.marginPx ?? 0,
    })).buffer;
    if (opts.stroke?.enabled) buf = await applyStroke(buf, opts.stroke);
    if (opts.text) buf = await overlayText(buf, opts.text);
    fitted.push(buf);
  }

  // 3) 每格延遲（legacy profile clamps; allowlisted profiles reject invalid timing）
  const delayMs = (perLoopSec * 1000) / fitted.length;

  // 4) 編碼；autoFit=false 時只做無損編碼並回報超標，不暗中降色或減格。
  const configuredLadder = opts.animation.autoFit
    ? opts.animation.ladder
    : [{ colors: 0, frames: fitted.length }];
  const preservationSource = configuredLadder === 'auto'
    ? autoLadder(
        opts.animation.priority,
        fitted.length,
        opts.animation.minColors,
        fitted.length,
        opts.animation.maxColors,
      )
    : configuredLadder;
  const ladder = opts.preserveFrames
    ? [...new Map(
        preservationSource.map((rung) => [
          rung.colors,
          { ...rung, frames: fitted.length },
        ]),
      ).values()]
    : configuredLadder;
  const fit = await encodeApngAutoFit(fitted, {
    loops: opts.animation.loops,
    delayMs,
    maxBytes: opts.animation.maxBytes,
    minColors: opts.animation.minColors,
    maxColors: opts.animation.maxColors,
    minFrames: opts.preserveFrames
      ? fitted.length
      : Math.max(limits.minFrames, opts.animation.minFrames),
    priority: opts.animation.priority,
    ladder,
    durationMs: limits.playbackDurationsSec ? Math.round(perLoopSec * 1000) : undefined,
    forbidPalette: opts.forbidPalette,
  });
  if (fit.colors !== 0) notes.push(`減色至 ${fit.colors} 色`);
  if (fit.frames !== fitted.length) notes.push(`減影格至 ${fit.frames} 格`);
  if (fit.overBudget) notes.push(`⚠ 仍超過 ${(opts.animation.maxBytes / 1024).toFixed(0)}KB（${(fit.bytes / 1024).toFixed(0)}KB）`);

  // 5) Reopen the delivered bytes; intended settings are not validation evidence.
  const requestedFrames = opts.preserveFrames || !opts.animation.autoFit ? fitted.length : undefined;
  const evidence = inspectAnimatedBytes(fit.buffer, requestedFrames);
  return {
    buffer: fit.buffer,
    info: evidence.info,
    notes,
    fittedFrames: fit.usedFrameIndices.map((index) => fitted[index]!),
    usedFrameIndices: fit.usedFrameIndices,
    frameDelaysMs: evidence.delaysMs,
  };
}

async function normalizeAndValidateFrameInputs(
  frameInputs: (Buffer | string)[],
  requireConsistentFrameSize: boolean,
): Promise<Buffer[]> {
  const normalized: Buffer[] = [];
  let expectedWidth = 0;
  let expectedHeight = 0;
  for (let index = 0; index < frameInputs.length; index++) {
    const { data, info } = await sharp(frameInputs[index]!, { failOn: 'none' })
      .rotate()
      .ensureAlpha()
      .png()
      .toBuffer({ resolveWithObject: true });
    if (index === 0) {
      expectedWidth = info.width;
      expectedHeight = info.height;
    } else if (
      requireConsistentFrameSize
      && (info.width !== expectedWidth || info.height !== expectedHeight)
    ) {
      throw new Error(
        `影格 ${index + 1} 尺寸 ${info.width}×${info.height} 與第一格 ${expectedWidth}×${expectedHeight} 不一致；不會自動拉伸`,
      );
    }
    normalized.push(data);
  }
  return normalized;
}

async function cropFramesToSharedAlphaBounds(
  frames: Buffer[],
): Promise<{ frames: Buffer[]; cropped: boolean }> {
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = -1;
  let bottom = -1;
  let width = 0;
  let height = 0;
  for (const frame of frames) {
    const { data, info } = await sharp(frame).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    width = info.width;
    height = info.height;
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        if (data[(y * info.width + x) * 4 + 3]! <= 10) continue;
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    }
  }
  if (right < 0 || (left === 0 && top === 0 && right === width - 1 && bottom === height - 1)) {
    return { frames, cropped: false };
  }
  const crop = {
    left,
    top,
    width: right - left + 1,
    height: bottom - top + 1,
  };
  return {
    frames: await Promise.all(frames.map((frame) => sharp(frame).extract(crop).png().toBuffer())),
    cropped: true,
  };
}

function resolveLimits(limits?: AnimatedProcessingLimits): AnimatedProcessingLimits {
  if (!limits) return DEFAULT_LIMITS;
  if (!Number.isInteger(limits.minFrames) || limits.minFrames < 1) {
    throw new RangeError(`動畫 minFrames 必須是正整數，收到 ${limits.minFrames}`);
  }
  if (!Number.isInteger(limits.maxFrames) || limits.maxFrames < limits.minFrames) {
    throw new RangeError(
      `動畫 maxFrames 必須是不小於 minFrames（${limits.minFrames}）的整數，收到 ${limits.maxFrames}`,
    );
  }
  if (!Number.isFinite(limits.maxDurationSec) || limits.maxDurationSec <= 0) {
    throw new RangeError(`動畫 maxDurationSec 必須是正數，收到 ${limits.maxDurationSec}`);
  }
  if (
    limits.playbackDurationsSec
    && (
      limits.playbackDurationsSec.length === 0
      || limits.playbackDurationsSec.some((duration) => !Number.isFinite(duration) || duration <= 0)
    )
  ) {
    throw new RangeError('動畫 playbackDurationsSec 必須包含至少一個正數');
  }
  return limits;
}

function resolvePerLoopDuration(
  frameCount: number,
  opts: ProcessAnimatedOptions,
  limits: AnimatedProcessingLimits,
  notes: string[],
): number {
  let perLoopSec = opts.fps ? frameCount / opts.fps : opts.animation.durationSec;
  if (limits.playbackDurationsSec) {
    const allowed = limits.playbackDurationsSec.some(
      (duration) => Math.abs(duration - perLoopSec) < 1e-9,
    );
    if (!allowed) {
      throw new RangeError(
        `單輪播放時間 ${perLoopSec}s 不合法；允許 ${limits.playbackDurationsSec.join('/')} 秒`,
      );
    }
  }
  const total = opts.animation.loops * perLoopSec;
  if (total > limits.maxDurationSec + 1e-9) {
    if (limits.playbackDurationsSec) {
      throw new RangeError(
        `總播放時間 ${total}s 超過 ${limits.maxDurationSec}s（${opts.animation.loops} loops × ${perLoopSec}s）`,
      );
    }
    perLoopSec = limits.maxDurationSec / opts.animation.loops;
    notes.push(`總時長 ${total.toFixed(1)}s>${limits.maxDurationSec}s，單輪壓到 ${perLoopSec.toFixed(2)}s`);
  }
  return perLoopSec;
}
