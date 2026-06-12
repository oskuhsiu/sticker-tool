/**
 * 動態影格主體穩定化（瀏覽器版）：把連續影格的主體對齊到同一位置，殺跨格漂移。
 * 邏輯與 CLI 版相同：取「上半部、暗且不透明」像素（頭髮/眉眼）質心當錨點，
 * 平移每格使錨點落在全體中位數位置；平移露出的邊用「四角平均色」填（比照背景）。
 */

import type { StabilizeConfig } from '@core/types.js';
import { resizeRaster, translateRaster, type Raster, type RGBA8 } from './raster.js';

export interface StabilizeResult {
  frames: Raster[];
  /** 對齊前主體水平擺幅（px） */
  driftBeforeX: number;
  /** 對齊後殘餘水平擺幅（px） */
  driftAfterX: number;
}

interface Anchor {
  cx: number;
  cy: number;
  cnt: number;
}

interface FrameInfo {
  anchor: Anchor;
  /** 背景色（四角平均）；平移填補用：白底→白、透明底→透明 */
  bg: RGBA8;
}

/** 算錨點（限上半部）＋背景色（四角平均）；frame 已是 W×H */
function analyzeFrame(f: Raster, cfg: StabilizeConfig): FrameInfo {
  const { data, width: W, height: H } = f;
  const yMax = Math.max(1, Math.floor(H * cfg.topFraction));
  let sx = 0;
  let sy = 0;
  let cnt = 0;
  for (let y = 0; y < yMax; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (data[i + 3]! <= 128) continue; // 透明背景略過
      if (cfg.anchor === 'head') {
        const lum = 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
        if (lum >= cfg.darkThreshold) continue; // 只留暗（頭髮）
      }
      sx += x;
      sy += y;
      cnt++;
    }
  }
  const corners = [0, W - 1, (H - 1) * W, (H - 1) * W + (W - 1)].map((p) => p * 4);
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  for (const c of corners) {
    r += data[c]!;
    g += data[c + 1]!;
    b += data[c + 2]!;
    a += data[c + 3]!;
  }
  const n = corners.length;
  return {
    anchor: { cx: cnt ? sx / cnt : W / 2, cy: cnt ? sy / cnt : (H * cfg.topFraction) / 2, cnt },
    bg: { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n), a: Math.round(a / n) },
  };
}

const median = (arr: number[]): number => {
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const span = (arr: number[]): number => Math.max(...arr) - Math.min(...arr);

/** 把所有影格對齊到錨點中位數位置。anchor='none' 或 <2 格時原樣回傳。 */
export function stabilizeFrames(frames: Raster[], cfg: StabilizeConfig): StabilizeResult {
  if (cfg.anchor === 'none' || frames.length < 2) {
    return { frames, driftBeforeX: 0, driftAfterX: 0 };
  }
  const W = frames[0]!.width;
  const H = frames[0]!.height;
  if (W === 0 || H === 0) return { frames, driftBeforeX: 0, driftAfterX: 0 };

  // 尺寸不一的影格先校到第一格大小（對應 CLI 版 analyzeFrame/translate 的 resize fill）
  const sized = frames.map((f) => (f.width === W && f.height === H ? f : resizeRaster(f, W, H)));

  const infos = sized.map((f) => analyzeFrame(f, cfg));
  const anchors = infos.map((fi) => fi.anchor);

  const tx = median(anchors.map((a) => a.cx));
  const ty = median(anchors.map((a) => a.cy));
  const driftBeforeX = span(anchors.map((a) => a.cx));

  const out: Raster[] = [];
  for (let i = 0; i < sized.length; i++) {
    const a = anchors[i]!;
    const dx = Math.round(tx - a.cx);
    const dy = cfg.axis === 'xy' ? Math.round(ty - a.cy) : 0;
    out.push(dx === 0 && dy === 0 ? sized[i]! : translateRaster(sized[i]!, dx, dy, infos[i]!.bg));
  }

  const after = out.map((f) => analyzeFrame(f, cfg).anchor.cx);
  return { frames: out, driftBeforeX, driftAfterX: span(after) };
}
