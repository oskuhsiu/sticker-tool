/**
 * 去背（瀏覽器版）：
 *   - @imgly/background-removal（onnxruntime-web / wasm），模型與 wasm 自託管於 ./imgly/
 *     （build 時從 node_modules 複製，見 vite.config.ts），首次使用需下載 ~80MB 模型。
 *   - auto 模式：沿用 CLI 的「邊框取樣 alpha」判據，偵測殘留背景才補刀。
 */

import type { Config } from '@imgly/background-removal';
import type { RemoveBgMode } from '@core/types.js';
import { decodeBlob, type Raster } from './raster.js';
import { encodePng } from './png.js';

export type ModelProgress = (key: string, current: number, total: number) => void;
export const IMGLY_MEDIUM_MODEL_BYTES = 88_188_479;

export interface ImglyRemovalOptions {
  signal?: AbortSignal;
  onProgress?: ModelProgress;
}

function imglyConfig(options: ImglyRemovalOptions): Config {
  return {
    publicPath: new URL('imgly/', document.baseURI).href,
    model: 'medium',
    output: { format: 'image/png' },
    fetchArgs: options.signal ? { signal: options.signal } : undefined,
    progress: options.onProgress,
  };
}

/** 用本地模型把背景去除。 */
export async function removeBackgroundLocal(
  input: Raster,
  options: ImglyRemovalOptions = {},
): Promise<Raster> {
  if (options.signal?.aborted) throw new DOMException('IMG.LY 去背已取消', 'AbortError');
  const { removeBackground: imglyRemove } = await import('@imgly/background-removal');
  const png = encodePng(input);
  const blob = new Blob([png.buffer as ArrayBuffer], { type: 'image/png' });
  const out = await imglyRemove(blob, imglyConfig(options));
  if (options.signal?.aborted) throw new DOMException('IMG.LY 去背已取消', 'AbortError');
  return decodeBlob(out);
}

/**
 * auto 判據：取樣 1px 邊框，計算「不透明（alpha>門檻）」像素比例。
 * 比例高 → 邊框被實心背景佔據 → 判定有殘留背景。
 */
export function hasResidualBackground(
  input: Raster,
  opaqueAlpha = 128,
  ratioThreshold = 0.5,
): boolean {
  const { data, width, height } = input;
  const alphaAt = (x: number, y: number): number => data[(y * width + x) * 4 + 3] ?? 0;

  let total = 0;
  let opaque = 0;
  const bump = (a: number) => {
    total++;
    if (a > opaqueAlpha) opaque++;
  };
  for (let x = 0; x < width; x++) {
    bump(alphaAt(x, 0));
    bump(alphaAt(x, height - 1));
  }
  for (let y = 0; y < height; y++) {
    bump(alphaAt(0, y));
    bump(alphaAt(width - 1, y));
  }
  if (total === 0) return false;
  return opaque / total > ratioThreshold;
}

/**
 * 依模式套用去背。
 *   true  → 一律去背
 *   false → 不動
 *   'auto'→ 偵測殘留背景才去背
 */
export async function applyBackgroundRemoval(
  input: Raster,
  mode: RemoveBgMode,
  options: ImglyRemovalOptions = {},
): Promise<{ raster: Raster; removed: boolean }> {
  if (mode === false) return { raster: input, removed: false };
  if (mode === true) return { raster: await removeBackgroundLocal(input, options), removed: true };
  if (hasResidualBackground(input)) {
    return { raster: await removeBackgroundLocal(input, options), removed: true };
  }
  return { raster: input, removed: false };
}
