/**
 * 靜態貼圖單張流程串接（瀏覽器版）：
 *   去背 → fitCanvas（trim+置中+10px 邊，偶數）→ [描邊] → [疊字] → 壓到 ≤1MB。
 */

import { STATIC_SPEC } from '@core/spec.js';
import type { Bounds, RemoveBgMode, StrokeSpec, TextSpec } from '@core/types.js';
import type { ImageInfo } from '@core/validate.js';
import { applyBackgroundRemoval } from './removeBackground.js';
import { fitCanvas } from './fitCanvas.js';
import { applyStroke } from './stroke.js';
import { overlayText } from './text.js';
import { fitPngUnderBytes } from './pngFit.js';
import { pngImageInfo } from './png.js';
import type { Raster } from './raster.js';

export interface ProcessStaticOptions {
  bounds: Bounds;
  removeBackground: RemoveBgMode;
  /** 基礎透明邊（px），預設 LINE 建議的 10px */
  marginPx?: number;
  stroke?: StrokeSpec;
  text?: TextSpec;
  maxBytes?: number;
}

export interface ProcessedSticker {
  png: Uint8Array;
  /** fit 後的點陣（main/tab 重用） */
  raster: Raster;
  info: ImageInfo;
  notes: string[];
}

export async function processStatic(
  input: Raster,
  opts: ProcessStaticOptions,
): Promise<ProcessedSticker> {
  const notes: string[] = [];
  const baseMargin = opts.marginPx ?? STATIC_SPEC.recommendedMarginPx;
  const maxBytes = opts.maxBytes ?? STATIC_SPEC.maxBytes;
  const strokeEnabled = opts.stroke?.enabled ?? false;
  const strokeWidth = strokeEnabled ? opts.stroke!.width : 0;

  // 1) 去背
  const { raster: bgRemoved, removed } = await applyBackgroundRemoval(input, opts.removeBackground);
  if (removed) notes.push('已套用去背');

  // 2) fitCanvas：預留 margin 給描邊（描邊往 margin 內擴張，留 10px 淨邊）
  const fitMargin = baseMargin + strokeWidth;
  let current = fitCanvas(bgRemoved, { bounds: opts.bounds, mode: 'trim', marginPx: fitMargin });

  // 3) 描邊
  if (strokeEnabled) {
    current = applyStroke(current, opts.stroke!);
    notes.push(`白色描邊 ${opts.stroke!.width}px`);
  }

  // 4) 疊字
  if (opts.text?.content) {
    current = overlayText(current, opts.text);
    notes.push(`疊字「${opts.text.content}」`);
  }

  // 5) 壓到 ≤ maxBytes
  const fit = fitPngUnderBytes(current, maxBytes);
  if (fit.colors !== null) notes.push(`減色至 ${fit.colors} 色以符合 ${(maxBytes / 1024).toFixed(0)}KB`);
  if (fit.overBudget) notes.push(`⚠ 仍超過 ${(maxBytes / 1024).toFixed(0)}KB（${(fit.bytes / 1024).toFixed(0)}KB）`);

  return { png: fit.png, raster: current, info: pngImageInfo(fit.png), notes };
}
