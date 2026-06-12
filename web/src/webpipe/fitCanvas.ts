/**
 * 等比縮放 + 置中 + padding 到 bounds，確保偶數長寬與透明背景（瀏覽器版 fitCanvas）。
 *
 * 兩種模式（與 CLI 版一致）：
 *   'trim'  — 去掉透明邊 → 等比縮放塞進 (bounds − margin) → 輸出貼齊內容+margin 的偶數畫布。
 *   'exact' — 輸出剛好等於 bounds，內容置中加 padding（main/tab、動態固定畫布用）。
 */

import { ceilEven, floorEven } from '@core/spec.js';
import type { Bounds } from '@core/types.js';
import { cropRaster, padRaster, resizeRaster, trimBounds, type Raster } from './raster.js';

export type FitMode = 'trim' | 'exact';

export interface FitOptions {
  bounds: Bounds;
  mode?: FitMode;
  /** 內容四周保留的透明邊（px）。LINE 建議靜態留 10px。 */
  marginPx?: number;
  /** 允許把小圖放大以填滿（預設 true） */
  allowUpscale?: boolean;
}

export function fitCanvas(input: Raster, opts: FitOptions): Raster {
  const { bounds, mode = 'trim', marginPx = 0, allowUpscale = true } = opts;

  let content = input;
  if (mode === 'trim') {
    const box = trimBounds(input, 10);
    if (box) content = cropRaster(input, box.left, box.top, box.width, box.height);
    // 全透明 → 維持原圖（對應 CLI 版 trim blank 的 fallback）
  }

  const availW = Math.max(2, bounds.width - 2 * marginPx);
  const availH = Math.max(2, bounds.height - 2 * marginPx);

  let scale = Math.min(availW / content.width, availH / content.height);
  if (!allowUpscale) scale = Math.min(scale, 1);

  const scaledW = Math.max(1, Math.round(content.width * scale));
  const scaledH = Math.max(1, Math.round(content.height * scale));
  const resized = resizeRaster(content, scaledW, scaledH);

  let canvasW: number;
  let canvasH: number;
  if (mode === 'exact') {
    canvasW = bounds.width;
    canvasH = bounds.height;
  } else {
    canvasW = Math.min(ceilEven(scaledW + 2 * marginPx), floorEven(bounds.width));
    canvasH = Math.min(ceilEven(scaledH + 2 * marginPx), floorEven(bounds.height));
    canvasW = Math.max(canvasW, ceilEven(scaledW));
    canvasH = Math.max(canvasH, ceilEven(scaledH));
  }

  const padLeft = Math.max(0, Math.floor((canvasW - scaledW) / 2));
  const padRight = Math.max(0, canvasW - scaledW - padLeft);
  const padTop = Math.max(0, Math.floor((canvasH - scaledH) / 2));
  const padBottom = Math.max(0, canvasH - scaledH - padTop);

  return padRaster(resized, { top: padTop, bottom: padBottom, left: padLeft, right: padRight });
}
