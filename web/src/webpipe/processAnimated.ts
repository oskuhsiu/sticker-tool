/**
 * 動態貼圖單張流程（瀏覽器版）：連續影格 → 穩定化（殺漂移）→ 每格 fit 'exact' 到同一畫布
 * → [描邊][疊字] → APNG（loops 1–4）→ 檔案大小檢查；只有明確開啟才 auto-fit。
 * 與 CLI 版相同的兩道防抖：先對齊主體（stabilize）、再對齊畫布（fit 'exact' 不逐格 trim）。
 */

import { ANIMATED_SPEC } from '@core/spec.js';
import type { AnimationConfig, Bounds, RemoveBgMode, StrokeSpec, TextSpec } from '@core/types.js';
import type { ImageInfo } from '@core/validate.js';
import { applyBackgroundRemoval } from './removeBackground.js';
import { fitCanvas } from './fitCanvas.js';
import { applyStroke } from './stroke.js';
import { overlayText } from './text.js';
import { encodeApngAutoFit, readApngInfo, subsampleFrames } from './apng.js';
import { stabilizeFrames } from './stabilize.js';
import { resizeRaster, yieldToUI, type Raster } from './raster.js';

export interface ProcessAnimatedOptions {
  /** 動態畫布上限，預設 320×270 */
  bounds?: Bounds;
  removeBackground: RemoveBgMode;
  /** Browser-only injected remover (IMG.LY/BiRefNet/Colab); runs after frame subsampling and before stabilization. */
  removeBackgroundRaster?: (input: Raster, signal?: AbortSignal) => Promise<Raster>;
  signal?: AbortSignal;
  onBackgroundProgress?: (completed: number, total: number) => void;
  stroke?: StrokeSpec;
  text?: TextSpec;
  animation: AnimationConfig;
  /** Explicit frame/duration limits for workflows with a different APNG contract. */
  limits?: AnimatedProcessingLimits;
  /** Never reduce the fitted frame sequence while searching optional color candidates. */
  preserveFrames?: boolean;
  /** Keep final PNG/APNG candidates in truecolor RGBA even when colors are quantized. */
  forbidPalette?: boolean;
  /** 影格率；給定則由它定每格延遲，否則用 animation.durationSec */
  fps?: number;
}

export interface AnimatedProcessingLimits {
  /** Minimum number of frames accepted before encoding. */
  minFrames: number;
  /** Maximum number of frames retained before fitting/encoding. */
  maxFrames: number;
  /** Maximum total playback duration across all loops, in seconds. */
  maxDurationSec: number;
  /** Optional label used in processing notes. */
  label?: string;
}

export interface ProcessedAnimated {
  png: Uint8Array;
  info: ImageInfo;
  notes: string[];
  /** fit 後對齊的影格（供產動態 main.png 用） */
  fittedFrames: Raster[];
  /** 最終 APNG 相對於輸入 fitted sequence 實際採用的索引。 */
  usedFrameIndices: number[];
  /** 最終 APNG 每格的整數毫秒延遲。 */
  frameDelaysMs: number[];
}

const DEFAULT_BOUNDS: Bounds = { width: ANIMATED_SPEC.maxWidth, height: ANIMATED_SPEC.maxHeight };
const DEFAULT_LIMITS: AnimatedProcessingLimits = {
  minFrames: ANIMATED_SPEC.minFrames,
  maxFrames: ANIMATED_SPEC.maxFrames,
  maxDurationSec: ANIMATED_SPEC.maxDurationSec,
};

export async function processAnimated(
  frameInputs: Raster[],
  opts: ProcessAnimatedOptions,
): Promise<ProcessedAnimated> {
  const notes: string[] = [];
  const bounds = opts.bounds ?? DEFAULT_BOUNDS;
  const limits = resolveLimits(opts.limits);

  // 1) 影格數夾在工作流指定的上下限（預設為一般動態貼圖規格）
  if (frameInputs.length < limits.minFrames) {
    throw new Error(`動態貼圖至少需 ${limits.minFrames} 格，只有 ${frameInputs.length}`);
  }
  let frames = frameInputs;
  if (frames.length > limits.maxFrames) {
    frames = subsampleFrames(frames, limits.maxFrames);
    const suffix = limits.label ? `（${limits.label} 上限）` : '（LINE 上限）';
    notes.push(`影格 ${frameInputs.length}→${limits.maxFrames}${suffix}`);
  }

  // 2) 統一尺寸 + 去背（全部影格先到手；穩定化要跨格一起算錨點中位數）
  const W = frames[0]!.width;
  const H = frames[0]!.height;
  const prepped: Raster[] = [];
  for (let index = 0; index < frames.length; index++) {
    const f = frames[index]!;
    if (opts.signal?.aborted) throw new DOMException('動畫處理已取消', 'AbortError');
    let r = f.width === W && f.height === H ? f : resizeRaster(f, W, H);
    if (opts.removeBackgroundRaster) {
      r = await opts.removeBackgroundRaster(r, opts.signal);
    } else if (opts.removeBackground !== false) {
      r = (await applyBackgroundRemoval(r, opts.removeBackground)).raster;
    }
    prepped.push(r);
    opts.onBackgroundProgress?.(index + 1, frames.length);
    await yieldToUI();
  }

  // 2b) 主體穩定化（殺跨格漂移）——務必在 fit 之前
  let aligned = prepped;
  const stab = opts.animation.stabilize;
  if (stab?.enabled && stab.anchor !== 'none') {
    const r = stabilizeFrames(prepped, stab);
    aligned = r.frames;
    notes.push(`穩定化（${stab.anchor}）：主體水平漂移 ${r.driftBeforeX.toFixed(0)}→${r.driftAfterX.toFixed(0)}px`);
  }

  // 2c) 逐格 fit 'exact'（全格同縮放同位置）→ 描邊/疊字
  const fitted: Raster[] = [];
  for (const r0 of aligned) {
    let r = fitCanvas(r0, { bounds, mode: 'exact', marginPx: 0 });
    if (opts.stroke?.enabled) r = applyStroke(r, opts.stroke);
    if (opts.text?.content) r = overlayText(r, opts.text);
    fitted.push(r);
  }

  // 3) 每格延遲（維持 loops × 單輪時長不超過目前工作流上限）
  let perLoopSec = opts.fps ? fitted.length / opts.fps : opts.animation.durationSec;
  const total = opts.animation.loops * perLoopSec;
  if (total > limits.maxDurationSec) {
    perLoopSec = limits.maxDurationSec / opts.animation.loops;
    notes.push(`總時長 ${total.toFixed(1)}s>${limits.maxDurationSec}s，單輪壓到 ${perLoopSec.toFixed(2)}s`);
  }
  const delayMs = (perLoopSec * 1000) / fitted.length;

  // 4) 編碼；autoFit=false 時只做無損編碼並回報超標，不暗中降色或減格。
  await yieldToUI();
  const configuredLadder = opts.animation.autoFit
    ? opts.animation.ladder
    : [{ colors: 0, frames: fitted.length }];
  const ladder = opts.preserveFrames && Array.isArray(configuredLadder)
    ? configuredLadder.map((rung) => ({ ...rung, frames: fitted.length }))
    : configuredLadder;
  const fit = encodeApngAutoFit(fitted, {
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
    forbidPalette: opts.forbidPalette,
  });
  if (fit.colors !== 0) notes.push(`減色至 ${fit.colors} 色`);
  if (fit.frames !== fitted.length) notes.push(`減影格至 ${fit.frames} 格`);
  if (fit.overBudget) notes.push(`⚠ 仍超過 ${(opts.animation.maxBytes / 1024).toFixed(0)}KB（${(fit.bytes / 1024).toFixed(0)}KB）`);

  // 5) info（尺寸/影格/循環由 APNG 讀回）
  const apngInfo = readApngInfo(fit.png);
  const info: ImageInfo = {
    width: apngInfo.width,
    height: apngInfo.height,
    bytes: fit.bytes,
    hasAlpha: true,
    channels: 4,
    isApng: apngInfo.isApng,
    frames: apngInfo.frames,
    loops: apngInfo.loops,
  };
  return {
    png: fit.png,
    info,
    notes,
    fittedFrames: fit.usedFrameIndices.map((index) => fitted[index]!),
    usedFrameIndices: fit.usedFrameIndices,
    frameDelaysMs: fit.delaysMs,
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
  return limits;
}
