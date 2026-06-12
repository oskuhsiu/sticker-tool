/**
 * 去背（瀏覽器版）：
 *   - @imgly/background-removal（onnxruntime-web / wasm），模型與 wasm 自託管於 ./imgly/
 *     （build 時從 node_modules 複製，見 vite.config.ts），首次使用需下載 ~80MB 模型。
 *   - auto 模式：沿用 CLI 的「邊框取樣 alpha」判據，偵測殘留背景才補刀。
 */

import { removeBackground as imglyRemove, type Config } from '@imgly/background-removal';
import type { RemoveBgMode } from '@core/types.js';
import { decodeBlob, type Raster } from './raster.js';
import { encodePng } from './png.js';

export type ModelProgress = (key: string, current: number, total: number) => void;

let onProgress: ModelProgress | undefined;

/** UI 註冊模型下載進度回呼（首次去背會下載大模型，要讓使用者看得到進度） */
export function setModelProgress(cb: ModelProgress | undefined): void {
  onProgress = cb;
}

function imglyConfig(): Config {
  return {
    publicPath: new URL('imgly/', document.baseURI).href,
    model: 'medium',
    output: { format: 'image/png' },
    progress: (key, current, total) => onProgress?.(key, current, total),
  };
}

/** 用本地模型把背景去除。 */
export async function removeBackgroundLocal(input: Raster): Promise<Raster> {
  const png = encodePng(input);
  const blob = new Blob([png.buffer as ArrayBuffer], { type: 'image/png' });
  const out = await imglyRemove(blob, imglyConfig());
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
): Promise<{ raster: Raster; removed: boolean }> {
  if (mode === false) return { raster: input, removed: false };
  if (mode === true) return { raster: await removeBackgroundLocal(input), removed: true };
  if (hasResidualBackground(input)) {
    return { raster: await removeBackgroundLocal(input), removed: true };
  }
  return { raster: input, removed: false };
}
