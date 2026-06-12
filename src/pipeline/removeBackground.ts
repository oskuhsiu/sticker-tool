/**
 * 去背：
 *   - 本地免費模型 @imgly/background-removal-node（lazy import；首跑會從 CDN 下載 onnx 模型，見 I-8）。
 *   - auto 模式：用「邊框取樣 alpha」的明確判據偵測殘留背景（解 I-10 #1），有殘留才補刀。
 *
 * 來源職責（見計畫）：
 *   local → 預設開（移除照片背景）；
 *   ai    → 預設關（codex 直接輸出透明），auto 偵測殘留時補刀。
 */

import sharp from 'sharp';
import type { RemoveBgMode } from '../core/types.js';

/** 用本地模型把背景去除，回傳透明 PNG buffer。 */
export async function removeBackgroundLocal(input: Buffer | string): Promise<Buffer> {
  // lazy import：只有真的要去背時才載入沉重的 onnxruntime
  const mod = await import('@imgly/background-removal-node');
  const remove = mod.removeBackground;
  // 一律先轉成 PNG，並包成「帶 MIME type 的 Blob」：
  // @imgly 解碼時讀 blob.type 判斷格式，傳裸 Uint8Array 會因 type 為空而報 "Unsupported format"。
  const src: Buffer = await sharp(input).png().toBuffer();
  const inputBlob = new Blob([new Uint8Array(src)], { type: 'image/png' });
  const blob = await remove(inputBlob, { output: { format: 'image/png' } });
  const ab = await blob.arrayBuffer();
  return Buffer.from(ab);
}

/**
 * auto 判據：取樣 1px 邊框，計算「不透明（alpha>門檻）」像素比例。
 * 比例高 → 邊框被實心背景佔據 → 判定有殘留背景。
 * @param opaqueAlpha 視為不透明的 alpha 門檻（0–255）
 * @param ratioThreshold 邊框不透明比例超過此值即判定有背景
 */
export async function hasResidualBackground(
  input: Buffer | string,
  opaqueAlpha = 128,
  ratioThreshold = 0.5,
): Promise<boolean> {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  if (channels < 4) return true; // 無 alpha = 整張不透明 = 有背景

  const alphaAt = (x: number, y: number): number => data[(y * width + x) * channels + 3] ?? 0;

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
  input: Buffer,
  mode: RemoveBgMode,
): Promise<{ buffer: Buffer; removed: boolean }> {
  if (mode === false) return { buffer: input, removed: false };
  if (mode === true) return { buffer: await removeBackgroundLocal(input), removed: true };
  // 'auto'
  if (await hasResidualBackground(input)) {
    return { buffer: await removeBackgroundLocal(input), removed: true };
  }
  return { buffer: input, removed: false };
}
