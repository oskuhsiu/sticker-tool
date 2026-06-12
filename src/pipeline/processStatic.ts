/**
 * 靜態貼圖單張流程串接：
 *   去背 → fitCanvas（trim+置中+10px 邊，偶數）→ [描邊 M3] → [疊字 M4] → 壓到 ≤1MB。
 * 回傳最終 buffer + 供驗證的 ImageInfo。
 */

import sharp from 'sharp';
import { STATIC_SPEC } from '../core/spec.js';
import type { Bounds, RemoveBgMode, StrokeSpec, TextSpec } from '../core/types.js';
import type { ImageInfo } from '../core/validate.js';
import { applyBackgroundRemoval } from './removeBackground.js';
import { fitCanvas } from './fitCanvas.js';
import { applyStroke } from './stroke.js';
import { overlayText } from './text.js';

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
  buffer: Buffer;
  info: ImageInfo;
  notes: string[];
}

async function toInfo(buffer: Buffer): Promise<ImageInfo> {
  const meta = await sharp(buffer).metadata();
  return {
    width: meta.width ?? 0,
    height: meta.height ?? 0,
    bytes: buffer.length,
    hasAlpha: meta.hasAlpha ?? false,
    channels: meta.channels ?? 0,
  };
}

export async function processStatic(
  input: Buffer | string,
  opts: ProcessStaticOptions,
): Promise<ProcessedSticker> {
  const notes: string[] = [];
  const baseMargin = opts.marginPx ?? STATIC_SPEC.recommendedMarginPx;
  const maxBytes = opts.maxBytes ?? STATIC_SPEC.maxBytes;
  const strokeEnabled = opts.stroke?.enabled ?? false;
  const strokeWidth = strokeEnabled ? opts.stroke!.width : 0;

  // 1) 去背
  const srcBuf = typeof input === 'string' ? await sharp(input).png().toBuffer() : input;
  const { buffer: bgRemoved, removed } = await applyBackgroundRemoval(srcBuf, opts.removeBackground);
  if (removed) notes.push('已套用去背');

  // 2) fitCanvas：預留 margin 給描邊（描邊會往 margin 內擴張，留 10px 淨邊）
  const fitMargin = baseMargin + strokeWidth;
  const fitted = await fitCanvas(bgRemoved, {
    bounds: opts.bounds,
    mode: 'trim',
    marginPx: fitMargin,
  });
  let current = fitted.buffer;

  // 3) 描邊（M3）：在最終解析度上對 alpha 擴張填白，往預留的 margin 內長
  if (strokeEnabled) {
    current = await applyStroke(current, opts.stroke!);
    notes.push(`白色描邊 ${opts.stroke!.width}px`);
  }

  // 4) 疊字（M4）：在最終畫布上依百分比定位
  if (opts.text) {
    current = await overlayText(current, opts.text);
    notes.push(`疊字「${opts.text.content}」`);
  }

  // 5) 壓到 ≤ maxBytes（I-9 auto-fit）
  const { fitPngUnderBytes } = await import('./pngFit.js');
  const fit = await fitPngUnderBytes(current, maxBytes);
  if (fit.colors !== null) notes.push(`減色至 ${fit.colors} 色以符合 ${(maxBytes / 1024).toFixed(0)}KB`);
  if (fit.overBudget) notes.push(`⚠ 仍超過 ${(maxBytes / 1024).toFixed(0)}KB（${(fit.bytes / 1024).toFixed(0)}KB）`);

  return { buffer: fit.buffer, info: await toInfo(fit.buffer), notes };
}
