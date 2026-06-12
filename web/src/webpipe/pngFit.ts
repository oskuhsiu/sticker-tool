/**
 * 靜態 PNG 檔案大小 auto-fit（瀏覽器版）：超過 maxBytes 時逐步減色（upng palette 量化）。
 * 保留 alpha 與尺寸不變，只動色數。
 */

import { encodePng } from './png.js';
import type { Raster } from './raster.js';

/** 由高到低的 palette 色數階梯（與 CLI 版一致） */
const COLOR_LADDER = [256, 192, 128, 96, 64, 48, 32, 24, 16];

export interface PngFitResult {
  png: Uint8Array;
  bytes: number;
  /** 最終色數；null 表示無損（未量化） */
  colors: number | null;
  /** 是否仍超過 maxBytes（到色數地板仍超標） */
  overBudget: boolean;
}

/** 把 Raster 編成 ≤ maxBytes 的 PNG。先試無損；超標才沿色階減色，第一個達標即停。 */
export function fitPngUnderBytes(input: Raster, maxBytes: number): PngFitResult {
  const lossless = encodePng(input, 0);
  if (lossless.length <= maxBytes) {
    return { png: lossless, bytes: lossless.length, colors: null, overBudget: false };
  }

  let best: PngFitResult = {
    png: lossless,
    bytes: lossless.length,
    colors: null,
    overBudget: true,
  };

  for (const colors of COLOR_LADDER) {
    const png = encodePng(input, colors);
    if (png.length < best.bytes) {
      best = { png, bytes: png.length, colors, overBudget: png.length > maxBytes };
    }
    if (png.length <= maxBytes) {
      return { png, bytes: png.length, colors, overBudget: false };
    }
  }
  return best;
}
