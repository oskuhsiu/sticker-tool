/**
 * 等比縮放 + 置中 + padding 到 bounds，確保偶數長寬與透明背景（瀏覽器版 fitCanvas）。
 *
 * 兩種輸出模式（與 CLI 版一致）：
 *   'trim'  — 輸出貼齊內容+margin 的偶數畫布。
 *   'exact' — 輸出剛好等於 bounds，內容置中加 padding（main/tab、動態固定畫布用）。
 *
 * 是否先裁掉輸入的透明邊由 trimInput 獨立控制。未指定時沿用舊行為：
 * trim 輸出會裁邊，exact 輸出保留原始畫布。
 */

import { ceilEven, floorEven } from '@core/spec.js';
import type { Bounds } from '@core/types.js';
import { cropRaster, padRaster, resizeRaster, trimBounds, type Raster } from './raster.js';

export type FitMode = 'trim' | 'exact';

export interface FitOptions {
  bounds: Bounds;
  mode?: FitMode;
  /** 是否先裁掉輸入透明邊；預設為 mode === 'trim'，以保留既有行為。 */
  trimInput?: boolean;
  /**
   * Optional lower bound for trim-mode output dimensions. The canvas is padded
   * transparently to this size after proportional fitting; content is never
   * stretched to satisfy it.
   */
  minCanvas?: Bounds;
  /** 內容四周保留的透明邊（px）。LINE 建議靜態留 10px。 */
  marginPx?: number;
  /** 允許把小圖放大以填滿（預設 true） */
  allowUpscale?: boolean;
}

export function fitCanvas(input: Raster, opts: FitOptions): Raster {
  const { bounds, minCanvas, mode = 'trim', marginPx = 0, allowUpscale = true } = opts;
  const trimInput = opts.trimInput ?? mode === 'trim';

  validateBounds('bounds', bounds);
  if (minCanvas) validateBounds('minCanvas', minCanvas);
  if (mode !== 'trim' && mode !== 'exact') {
    throw new RangeError(`Invalid fit mode: ${String(mode)}`);
  }
  if (!Number.isFinite(marginPx) || marginPx < 0 || !Number.isInteger(marginPx)) {
    throw new RangeError(`Invalid marginPx: expected a finite non-negative integer, got ${String(marginPx)}`);
  }
  if (minCanvas && (minCanvas.width > bounds.width || minCanvas.height > bounds.height)) {
    throw new RangeError(
      `minCanvas ${minCanvas.width}×${minCanvas.height} exceeds bounds ${bounds.width}×${bounds.height}`,
    );
  }

  // Trim output is always even and must not exceed the requested maximum. An
  // odd maximum therefore has one pixel of unusable headroom; if rounding the
  // minimum would consume it, fail rather than silently violating the contract.
  const maxWidth = floorEven(bounds.width);
  const maxHeight = floorEven(bounds.height);
  if (mode === 'trim') {
    if (maxWidth > bounds.width || maxHeight > bounds.height || maxWidth < 2 || maxHeight < 2) {
      throw new RangeError(
        `bounds ${bounds.width}×${bounds.height} cannot produce an even trim canvas`,
      );
    }
    if (minCanvas) {
      const minWidth = ceilEven(minCanvas.width);
      const minHeight = ceilEven(minCanvas.height);
      if (minWidth > maxWidth || minHeight > maxHeight) {
        throw new RangeError(
          `minCanvas ${minCanvas.width}×${minCanvas.height} cannot fit as an even canvas within bounds ${bounds.width}×${bounds.height}`,
        );
      }
    }
    if (2 * marginPx > maxWidth || 2 * marginPx > maxHeight) {
      throw new RangeError(
        `marginPx ${marginPx} is too large for bounds ${bounds.width}×${bounds.height}`,
      );
    }
  }

  if (!Number.isInteger(input.width) || !Number.isInteger(input.height) || input.width <= 0 || input.height <= 0) {
    throw new RangeError(`Invalid input raster dimensions: ${input.width}×${input.height}`);
  }

  let content = input;
  if (trimInput) {
    const box = trimBounds(input, 10);
    if (box) content = cropRaster(input, box.left, box.top, box.width, box.height);
    // 全透明 → 維持原圖（對應 CLI 版 trim blank 的 fallback）
  }

  // Use the even maximum as the source of truth for trim mode. This keeps both
  // the rounded content and its requested margin inside bounds, including
  // odd/custom max dimensions such as 369×319. Exact mode intentionally keeps
  // its historical sizing inputs so its fixed-canvas behavior is unchanged.
  const fitMaxWidth = mode === 'trim' ? maxWidth : bounds.width;
  const fitMaxHeight = mode === 'trim' ? maxHeight : bounds.height;
  const availW = Math.max(2, fitMaxWidth - 2 * marginPx);
  const availH = Math.max(2, fitMaxHeight - 2 * marginPx);

  let scale = Math.min(availW / content.width, availH / content.height);
  if (!allowUpscale) scale = Math.min(scale, 1);

  // Rounding can add one pixel. Clamp to the available area before adding
  // margin so the final even canvas never exceeds its maximum.
  const scaledW = Math.min(availW, Math.max(1, Math.round(content.width * scale)));
  const scaledH = Math.min(availH, Math.max(1, Math.round(content.height * scale)));
  const resized = resizeRaster(content, scaledW, scaledH);

  let canvasW: number;
  let canvasH: number;
  if (mode === 'exact') {
    canvasW = bounds.width;
    canvasH = bounds.height;
  } else {
    canvasW = Math.max(ceilEven(scaledW + 2 * marginPx), ceilEven(scaledW));
    canvasH = Math.max(ceilEven(scaledH + 2 * marginPx), ceilEven(scaledH));
    if (minCanvas) {
      canvasW = Math.max(canvasW, ceilEven(minCanvas.width));
      canvasH = Math.max(canvasH, ceilEven(minCanvas.height));
    }
    if (canvasW > maxWidth || canvasH > maxHeight) {
      throw new RangeError(
        `Fitted canvas ${canvasW}×${canvasH} exceeds bounds ${bounds.width}×${bounds.height}`,
      );
    }
  }

  const padLeft = Math.max(0, Math.floor((canvasW - scaledW) / 2));
  const padRight = Math.max(0, canvasW - scaledW - padLeft);
  const padTop = Math.max(0, Math.floor((canvasH - scaledH) / 2));
  const padBottom = Math.max(0, canvasH - scaledH - padTop);

  return padRaster(resized, { top: padTop, bottom: padBottom, left: padLeft, right: padRight });
}

function validateBounds(label: string, bounds: Bounds): void {
  if (
    !Number.isFinite(bounds.width)
    || !Number.isFinite(bounds.height)
    || !Number.isInteger(bounds.width)
    || !Number.isInteger(bounds.height)
    || bounds.width <= 0
    || bounds.height <= 0
  ) {
    throw new RangeError(
      `Invalid ${label}: expected finite positive integer dimensions, got ${bounds.width}×${bounds.height}`,
    );
  }
}
