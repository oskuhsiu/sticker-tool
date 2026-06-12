/**
 * 動態影格主體穩定化：把連續影格的主體（角色）對齊到同一位置，
 * 殺掉 codex 逐格產圖的「跨格漂移」（左右擺動實測可達畫面 20–25%）。
 *
 * 為什麼 fit 救不了：fitCanvas('exact') 只把「整格畫布」縮放置中，對齊的是畫布、不是主體；
 * 主體在格內偏左偏右它管不到，漂移原樣保留。所以要在 fit「之前」先對齊主體。
 *
 * 怎麼對齊：偵測每格的「穩定錨點」——預設取「上半部、暗且不透明」像素（＝頭髮/眉眼）的質心，
 * 平移每格使錨點落在全體中位數位置。主體被釘住，手腳/道具相對它移動（所以**不能**用整體
 * bounding box 當錨點，會被伸出的手拉歪）。純平移、不縮放（實測漂移幾乎只有位移、頭部大小穩定）。
 *
 * 填補色：平移會在一側露出空白。填補色「比照背景」——每格取四角平均色：白底→填白、
 * 透明底（已去背）→填透明。這樣白底素材不必去背也不會出現「白塊邊緣左右甩」的背景漂移
 * （去背雖也能解，但會把飛出的愛心等分離前景物件一起吃掉）。
 *
 * 由 processAnimated 在「去背之後、fit 之前」呼叫（需全部影格一起算錨點中位數）。
 */

import sharp from 'sharp';
import type { StabilizeConfig } from '../core/types.js';

export interface StabilizeResult {
  frames: Buffer[];
  /** 對齊前主體水平擺幅（px） */
  driftBeforeX: number;
  /** 對齊後殘餘水平擺幅（px，理應趨近 0） */
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
  bg: sharp.Color;
}

/** 讀一次 raw：算錨點（限上半部）＋背景色（四角平均） */
async function analyzeFrame(
  buf: Buffer,
  W: number,
  H: number,
  cfg: StabilizeConfig,
): Promise<FrameInfo> {
  const { data, info } = await sharp(buf)
    .resize(W, H, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const ch = info.channels; // RGBA = 4
  const yMax = Math.max(1, Math.floor(H * cfg.topFraction));
  let sx = 0;
  let sy = 0;
  let cnt = 0;
  for (let y = 0; y < yMax; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * ch;
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
  // 四角平均當背景色（平移露出的邊緣用它填，避免白塊邊緣甩動）
  const corners = [0, W - 1, (H - 1) * W, (H - 1) * W + (W - 1)].map((p) => p * ch);
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
    bg: { r: r / n, g: g / n, b: b / n, alpha: a / n / 255 },
  };
}

/** 平移：dx/dy 為正＝內容右/下移；露出的邊緣以 bg 填（比照背景）+ extract 維持 W×H */
async function translate(
  buf: Buffer,
  dx: number,
  dy: number,
  W: number,
  H: number,
  bg: sharp.Color,
): Promise<Buffer> {
  let p = sharp(buf).resize(W, H, { fit: 'fill' }).ensureAlpha();
  if (dx > 0) p = p.extend({ left: dx, background: bg });
  else if (dx < 0) p = p.extend({ right: -dx, background: bg });
  let out = await p.png().toBuffer();
  out = await sharp(out).extract({ left: dx < 0 ? -dx : 0, top: 0, width: W, height: H }).png().toBuffer();

  let p2 = sharp(out);
  if (dy > 0) p2 = p2.extend({ top: dy, background: bg });
  else if (dy < 0) p2 = p2.extend({ bottom: -dy, background: bg });
  out = await p2.png().toBuffer();
  out = await sharp(out).extract({ left: 0, top: dy < 0 ? -dy : 0, width: W, height: H }).png().toBuffer();
  return out;
}

const median = (arr: number[]): number => {
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const span = (arr: number[]): number => Math.max(...arr) - Math.min(...arr);

/**
 * 把所有影格對齊到錨點中位數位置。anchor='none' 或 <2 格時原樣回傳。
 */
export async function stabilizeFrames(
  frames: Buffer[],
  cfg: StabilizeConfig,
): Promise<StabilizeResult> {
  if (cfg.anchor === 'none' || frames.length < 2) {
    return { frames, driftBeforeX: 0, driftAfterX: 0 };
  }
  const meta = await sharp(frames[0]!).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  if (W === 0 || H === 0) return { frames, driftBeforeX: 0, driftAfterX: 0 };

  const infos: FrameInfo[] = [];
  for (const f of frames) infos.push(await analyzeFrame(f, W, H, cfg));
  const anchors = infos.map((fi) => fi.anchor);

  const tx = median(anchors.map((a) => a.cx));
  const ty = median(anchors.map((a) => a.cy));
  const driftBeforeX = span(anchors.map((a) => a.cx));

  const out: Buffer[] = [];
  for (let i = 0; i < frames.length; i++) {
    const a = anchors[i]!;
    const dx = Math.round(tx - a.cx);
    const dy = cfg.axis === 'xy' ? Math.round(ty - a.cy) : 0;
    out.push(dx === 0 && dy === 0 ? frames[i]! : await translate(frames[i]!, dx, dy, W, H, infos[i]!.bg));
  }

  // 量殘餘漂移（驗證/回報用）
  const after: number[] = [];
  for (const f of out) after.push((await analyzeFrame(f, W, H, cfg)).anchor.cx);
  return { frames: out, driftBeforeX, driftAfterX: span(after) };
}
