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
import { encodeApngAutoFit, readApngInfo, subsampleFrames } from './apng.js';
import { stabilizeFrames } from './stabilize.js';

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
  buffer: Buffer;
  info: ImageInfo;
  notes: string[];
  /** fit 後對齊的影格（供產動態 main.png 用） */
  fittedFrames: Buffer[];
}

const DEFAULT_BOUNDS: Bounds = { width: ANIMATED_SPEC.maxWidth, height: ANIMATED_SPEC.maxHeight };

export async function processAnimated(
  frameInputs: (Buffer | string)[],
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

  // 2) 載入 + 去背（全部影格先到手；穩定化要跨格一起算錨點中位數）
  const prepped: Buffer[] = [];
  for (const f of frames) {
    let buf = typeof f === 'string' ? await sharp(f).png().toBuffer() : f;
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

  // 2c) 逐格 fit 'exact'（全格同縮放同位置）→ 描邊/疊字
  const fitted: Buffer[] = [];
  for (const buf0 of aligned) {
    let buf = (await fitCanvas(buf0, { bounds, mode: 'exact', marginPx: 0 })).buffer;
    if (opts.stroke?.enabled) buf = await applyStroke(buf, opts.stroke);
    if (opts.text) buf = await overlayText(buf, opts.text);
    fitted.push(buf);
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
  const fit = await encodeApngAutoFit(fitted, {
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
  const apngInfo = readApngInfo(fit.buffer);
  const meta = await sharp(fit.buffer).metadata();
  const info: ImageInfo = {
    width: apngInfo.width,
    height: apngInfo.height,
    bytes: fit.bytes,
    hasAlpha: meta.hasAlpha ?? true,
    channels: meta.channels ?? 4,
    isApng: apngInfo.isApng,
    frames: apngInfo.frames,
    loops: apngInfo.loops,
  };
  return { buffer: fit.buffer, info, notes, fittedFrames: fitted };
}
