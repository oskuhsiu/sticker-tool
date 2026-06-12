/**
 * 動態貼圖單張流程（瀏覽器版）：連續影格 → 穩定化（殺漂移）→ 每格 fit 'exact' 到同一畫布
 * → [描邊][疊字] → APNG（loops 1–4）→ auto-fit 到 ≤1MB。
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
  stroke?: StrokeSpec;
  text?: TextSpec;
  animation: AnimationConfig;
  /** 影格率；給定則由它定每格延遲，否則用 animation.durationSec */
  fps?: number;
}

export interface ProcessedAnimated {
  png: Uint8Array;
  info: ImageInfo;
  notes: string[];
  /** fit 後對齊的影格（供產動態 main.png 用） */
  fittedFrames: Raster[];
}

const DEFAULT_BOUNDS: Bounds = { width: ANIMATED_SPEC.maxWidth, height: ANIMATED_SPEC.maxHeight };

export async function processAnimated(
  frameInputs: Raster[],
  opts: ProcessAnimatedOptions,
): Promise<ProcessedAnimated> {
  const notes: string[] = [];
  const bounds = opts.bounds ?? DEFAULT_BOUNDS;

  // 1) 影格數夾在 [minFrames, 20]
  if (frameInputs.length < ANIMATED_SPEC.minFrames) {
    throw new Error(`動態貼圖至少需 ${ANIMATED_SPEC.minFrames} 格，只有 ${frameInputs.length}`);
  }
  let frames = frameInputs;
  if (frames.length > ANIMATED_SPEC.maxFrames) {
    frames = subsampleFrames(frames, ANIMATED_SPEC.maxFrames);
    notes.push(`影格 ${frameInputs.length}→${ANIMATED_SPEC.maxFrames}（LINE 上限）`);
  }

  // 2) 統一尺寸 + 去背（全部影格先到手；穩定化要跨格一起算錨點中位數）
  const W = frames[0]!.width;
  const H = frames[0]!.height;
  const prepped: Raster[] = [];
  for (const f of frames) {
    let r = f.width === W && f.height === H ? f : resizeRaster(f, W, H);
    if (opts.removeBackground !== false) {
      r = (await applyBackgroundRemoval(r, opts.removeBackground)).raster;
    }
    prepped.push(r);
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

  // 3) 每格延遲（維持 loops × 單輪時長 ≤ 4s）
  let perLoopSec = opts.fps ? fitted.length / opts.fps : opts.animation.durationSec;
  const total = opts.animation.loops * perLoopSec;
  if (total > ANIMATED_SPEC.maxDurationSec) {
    perLoopSec = ANIMATED_SPEC.maxDurationSec / opts.animation.loops;
    notes.push(`總時長 ${total.toFixed(1)}s>${ANIMATED_SPEC.maxDurationSec}s，單輪壓到 ${perLoopSec.toFixed(2)}s`);
  }
  const delayMs = (perLoopSec * 1000) / fitted.length;

  // 4) 編碼 + auto-fit ≤ maxBytes
  await yieldToUI();
  const fit = encodeApngAutoFit(fitted, {
    loops: opts.animation.loops,
    delayMs,
    maxBytes: opts.animation.maxBytes,
    minColors: opts.animation.minColors,
    minFrames: opts.animation.minFrames,
    priority: opts.animation.priority,
    ladder: opts.animation.ladder,
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
  return { png: fit.png, info, notes, fittedFrames: fitted };
}
