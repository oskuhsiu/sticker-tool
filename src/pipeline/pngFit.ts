/**
 * 靜態 PNG 檔案大小 auto-fit（解 I-9）：超過 maxBytes 時逐步減色（palette 量化）直到達標。
 * 保留 alpha 與尺寸不變，只動色數。動態 APNG 的壓縮另見 pipeline/apng.ts（upng-js）。
 */

import sharp from 'sharp';

/** 由高到低的 palette 色數階梯 */
const COLOR_LADDER = [256, 192, 128, 96, 64, 48, 32, 24, 16];

export interface PngFitResult {
  buffer: Buffer;
  bytes: number;
  /** 最終色數；null 表示無損（未量化） */
  colors: number | null;
  /** 是否仍超過 maxBytes（到色數地板仍超標） */
  overBudget: boolean;
}

export interface PngFitOptions {
  /** Quantize colors but store the delivered candidate as truecolor RGBA. */
  forbidPalette?: boolean;
}

/**
 * 把 PNG 壓到 ≤ maxBytes。先試無損；超標才沿色階減色，第一個達標即停。
 */
export async function fitPngUnderBytes(
  input: Buffer,
  maxBytes: number,
  options: PngFitOptions = {},
): Promise<PngFitResult> {
  // 先確保是壓好的無損 PNG
  let lossless = await sharp(input)
    .png({ compressionLevel: 9, effort: 10 })
    .toBuffer();
  if (options.forbidPalette && lossless[25] !== 6) {
    lossless = await sharp(lossless)
      .ensureAlpha()
      .png({ palette: false, compressionLevel: 9, effort: 10 })
      .toBuffer();
  }
  if (lossless.length <= maxBytes) {
    return { buffer: lossless, bytes: lossless.length, colors: null, overBudget: false };
  }

  let best: PngFitResult = {
    buffer: lossless,
    bytes: lossless.length,
    colors: null,
    overBudget: true,
  };

  for (const colors of COLOR_LADDER) {
    const quantized = await sharp(input)
      .png({ palette: true, colors, compressionLevel: 9, effort: 10 })
      .toBuffer();
    const buf = options.forbidPalette
      ? await sharp(quantized)
          .ensureAlpha()
          .png({ palette: false, compressionLevel: 9, effort: 10 })
          .toBuffer()
      : quantized;
    if (buf.length < best.bytes) {
      best = { buffer: buf, bytes: buf.length, colors, overBudget: buf.length > maxBytes };
    }
    if (buf.length <= maxBytes) {
      return { buffer: buf, bytes: buf.length, colors, overBudget: false };
    }
  }
  return best;
}
