/**
 * PNG 編解碼（upng-js，純 JS）。
 * encodePng(colors=0) 為無損 RGBA；colors>0 走 palette 量化（pngFit 的減色階梯用）。
 */

import UPNG from 'upng-js';
import type { ImageInfo } from '@core/validate.js';
import type { Raster } from './raster.js';

/** Raster → PNG bytes。colors=0 無損，>0 量化到該色數。 */
export function encodePng(r: Raster, colors = 0, forbidPalette = false): Uint8Array {
  const ab = r.data.buffer.slice(r.data.byteOffset, r.data.byteOffset + r.data.byteLength);
  return new Uint8Array(UPNG.encode([ab as ArrayBuffer], r.width, r.height, colors, undefined, forbidPalette));
}

/** PNG bytes → Raster（APNG 取首格） */
export function decodePng(png: Uint8Array): Raster {
  const img = UPNG.decode(png);
  const rgba = UPNG.toRGBA8(img);
  const first = rgba[0];
  if (!first) throw new Error('PNG 解碼失敗：沒有影格');
  return { data: new Uint8ClampedArray(first), width: img.width, height: img.height };
}

/** 由 PNG bytes 蒐集驗證用的 ImageInfo（對應 CLI 版 sharp.metadata + readApngInfo） */
export function pngImageInfo(png: Uint8Array): ImageInfo {
  const img = UPNG.decode(png);
  const actl = img.tabs.acTL;
  // ctype：6=RGBA、4=灰+alpha、3=palette（tRNS 才有 alpha）、2=RGB、0=灰
  const hasAlpha =
    img.ctype === 6 || img.ctype === 4 || (img.ctype === 3 && img.tabs['tRNS'] !== undefined);
  const channels = img.ctype === 6 ? 4 : img.ctype === 2 ? 3 : img.ctype === 4 ? 2 : hasAlpha ? 4 : 3;
  return {
    width: img.width,
    height: img.height,
    bytes: png.length,
    hasAlpha,
    channels,
    colorType: img.ctype,
    isApng: !!actl,
    frames: actl?.num_frames ?? 1,
    loops: actl?.num_plays ?? 0,
  };
}
