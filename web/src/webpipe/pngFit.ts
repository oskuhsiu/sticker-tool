/**
 * 靜態 PNG 檔案大小檢查與選用降色（瀏覽器版）。
 * 預設只回報超標；使用者明確允許時才沿色階量化。
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
export function fitPngUnderBytes(
  input: Raster,
  maxBytes: number,
  options: { forbidPalette?: boolean; reduceColors?: boolean } = {},
): PngFitResult {
  const lossless = encodePng(input, 0, options.forbidPalette);
  if (lossless.length <= maxBytes) {
    return { png: lossless, bytes: lossless.length, colors: null, overBudget: false };
  }

  let best: PngFitResult = {
    png: lossless,
    bytes: lossless.length,
    colors: null,
    overBudget: true,
  };

  if (!options.reduceColors) return best;

  for (const colors of COLOR_LADDER) {
    const png = encodePng(input, colors, options.forbidPalette);
    if (png.length < best.bytes) {
      best = { png, bytes: png.length, colors, overBudget: png.length > maxBytes };
    }
    if (png.length <= maxBytes) {
      return { png, bytes: png.length, colors, overBudget: false };
    }
  }
  return best;
}
