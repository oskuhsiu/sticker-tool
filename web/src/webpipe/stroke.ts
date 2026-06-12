/**
 * 白色描邊（瀏覽器版）：alpha 圓形膨脹 → 純色描邊層 → 原圖疊上。
 * CLI 版用 blur+threshold 近似膨脹；這裡直接做形態學膨脹（逐列滑動窗 max，
 * 由圓形核的弦長決定各列窗寬），效果等價、無 wasm 依賴。
 * 之後對遮罩做一次 3×3 平均柔化邊緣（抗鋸齒），再合成。
 */

import { parseColor } from '@core/color.js';
import type { StrokeSpec } from '@core/types.js';
import { compositeOver, type Raster } from './raster.js';

/** 二值 alpha（>8 視為內容）做半徑 r 的圓形膨脹，回傳 0/255 遮罩 */
function dilateAlpha(input: Raster, radius: number): Uint8Array {
  const { data, width: W, height: H } = input;
  const src = new Uint8Array(W * H);
  for (let p = 0; p < W * H; p++) src[p] = data[p * 4 + 3]! > 8 ? 1 : 0;

  // 每列先做水平膨脹（之後垂直方向按弦長取 OR），等價於圓形核
  const r = Math.max(1, Math.round(radius));
  const out = new Uint8Array(W * H);
  // chord[dy] = 半徑 r 的圓在垂直位移 dy 時的水平半弦長
  const chords: number[] = [];
  for (let dy = -r; dy <= r; dy++) {
    chords.push(Math.floor(Math.sqrt(r * r - dy * dy)));
  }
  // 對每個來源列 sy、每個垂直位移 dy：把來源點沿水平 ±chord 寫進目標列
  //（r ≤ ~16、畫布 ≤ 370×320，O(H·(2r+1)·W) 規模很小）
  for (let sy = 0; sy < H; sy++) {
    for (let dy = -r; dy <= r; dy++) {
      const ty = sy + dy;
      if (ty < 0 || ty >= H) continue;
      const chord = chords[dy + r]!;
      const outRow = ty * W;
      const srcRow = sy * W;
      for (let x = 0; x < W; x++) {
        if (!src[srcRow + x]) continue;
        const lo = Math.max(0, x - chord);
        const hi = Math.min(W - 1, x + chord);
        out.fill(255, outRow + lo, outRow + hi + 1);
      }
    }
  }
  return out;
}

/** 3×3 盒平均（只為柔化遮罩邊緣的鋸齒） */
function smoothMask(mask: Uint8Array, W: number, H: number): Uint8Array {
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let sum = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= W) continue;
          sum += mask[yy * W + xx]!;
          n++;
        }
      }
      out[y * W + x] = Math.round(sum / n);
    }
  }
  return out;
}

export function applyStroke(input: Raster, stroke: StrokeSpec): Raster {
  if (!stroke.enabled || stroke.width <= 0) return input;
  const { width: W, height: H } = input;
  if (W === 0 || H === 0) return input;

  const { r, g, b } = parseColor(stroke.color);
  const mask = smoothMask(dilateAlpha(input, stroke.width), W, H);

  const layer: Raster = { data: new Uint8ClampedArray(W * H * 4), width: W, height: H };
  for (let p = 0; p < W * H; p++) {
    layer.data[p * 4] = r;
    layer.data[p * 4 + 1] = g;
    layer.data[p * 4 + 2] = b;
    layer.data[p * 4 + 3] = mask[p]!;
  }
  return compositeOver(layer, input);
}
