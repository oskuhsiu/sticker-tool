/**
 * 切格前的「程式分析」與元件式抽格——把過去要 agent 看圖手調的事全部算出來。
 *
 * 背景（實測）：codex 的組圖幾乎都是「不透明」交付——綠幕、近白／淺灰平塗，或把透明棋盤
 * 直接畫成實體像素。所以舊的「在 alpha 上找縫」永遠 fallback 成等分死切（根本沒有 alpha）。
 *
 * 本模組的流程（cutSheet）＝
 *   1) detectBackground：取邊框樣本，判 transparent / green / opaque。
 *   2) keyBackground：去背成「透明前景」——
 *        green     → 色鍵 chroma key + despill（即時、精準、無光暈）。
 *        opaque    → @imgly 全圖語意去背（能把白衣服與白底分開，色鍵做不到）。
 *        transparent → 原樣。
 *      去背是「為了找縫」的前置：有了乾淨前景遮罩才量得出真正的格間透明縫。
 *   3) planCutsFromProfile：由前景占用剖面把每條等分線吸附到真實透明縫的中心。
 *      ——但切線只當「參照」：每格主體大小不一、道具會越線，死切矩形會切斷主體。
 *   4) extractCells（core/cells）：整張連通元件標記，元件按質心歸屬格（越線部分完整
 *      保留、鄰格不殘留）→ 逐格 trim → 畫布取最大寬高 → 'grid'（動態，按原圖等分格
 *      座標對齊、場景固定不閃）或 'center'（靜態，各自置中）放置。
 *
 * 切出來的格已是去背後的透明 PNG，下游不必再逐格去背（少跑 15 次 @imgly）。
 */

import sharp from 'sharp';
import { planCutsFromProfile, type CutPlan } from '../core/sheet.js';
import { extractCells, type CellMeta } from '../core/cells.js';
import { removeBackgroundLocal } from './removeBackground.js';

export type Background =
  | { kind: 'transparent' }
  | { kind: 'green'; color: [number, number, number] }
  | { kind: 'opaque'; color: [number, number, number] };

export interface SheetAnalysis {
  background: Background;
  /** 去背成透明後的整張 sheet（RGBA PNG）；後續抽格由它抽 */
  keyed: Buffer;
  width: number;
  height: number;
  xs: number[];
  ys: number[];
  xPlan: CutPlan;
  yPlan: CutPlan;
  warnings: string[];
}

const isGreenPx = (r: number, g: number, b: number): boolean =>
  g > 90 && g - r > 40 && g - b > 40;

/** 取邊框（2px 框）像素樣本，判背景型態 */
export async function detectBackground(src: Buffer | string): Promise<Background> {
  const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: ch } = info;
  const samples: Array<[number, number, number, number]> = [];
  const at = (x: number, y: number): void => {
    const i = (y * W + x) * ch;
    samples.push([data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!]);
  };
  for (let x = 0; x < W; x++) {
    at(x, 0);
    at(x, 1);
    at(x, H - 1);
    at(x, H - 2);
  }
  for (let y = 0; y < H; y++) {
    at(0, y);
    at(1, y);
    at(W - 1, y);
    at(W - 2, y);
  }
  const transFrac = samples.filter((p) => p[3] < 32).length / samples.length;
  if (transFrac > 0.5) return { kind: 'transparent' };

  const opaque = samples.filter((p) => p[3] >= 32);
  const greenFrac = opaque.length
    ? opaque.filter((p) => isGreenPx(p[0], p[1], p[2])).length / opaque.length
    : 0;
  // 邊框主色（平均）
  let r = 0;
  let g = 0;
  let b = 0;
  for (const p of opaque) {
    r += p[0];
    g += p[1];
    b += p[2];
  }
  const n = Math.max(1, opaque.length);
  const color: [number, number, number] = [r / n, g / n, b / n];
  if (greenFrac > 0.5) return { kind: 'green', color };
  return { kind: 'opaque', color };
}

/**
 * 綠幕色鍵 + despill（soft matte／抗鋸齒）。回傳 RGBA PNG。
 *
 * 舊版是二值門檻（判綠→alpha 0、否則 255），曲線/斜邊只會階梯狀鋸齒、邊緣拿不到漸層 alpha。
 * 新版改用連續 greenness = g − max(r,b) 映射成 alpha：
 *   greenness ≤ KEY_LO → 全保留(255)；≥ KEY_HI → 全透明(0)；(LO,HI) 之間線性漸層
 *   → 邊界像素拿到中間 alpha＝抗鋸齒（soft matte）。
 * 門檻取自實測 9 張 codex 綠幕的 greenness 直方圖：主體集中 <10、綠幕 >120、中間 10–120 是稀疏邊緣谷。
 * 漸層帶 [12,90] 攤在這條空谷上——LO=12 讓白衣（greenness≈0）等主體穩穩全保留；HI=90 對綠幕主峰(120+)
 * 留安全邊距，避免不勻綠幕殘留半透明光暈。實測掃帶寬：放寬帶寬一律更抗鋸齒（漸層 px↑）、主體 solid 不減反增
 * （邊更飽滿、不吃主體）、綠邊維持 0；[12,90] 是「抗鋸齒夠/不貼主峰」的折衷。
 * 亮度閘 gg>90：綠幕本就亮，藉此避免把暗綠主體細節誤切。
 * despill 對所有像素做（夾溢綠的 G→消半透明邊緣的綠光暈）；alpha 由「原始」RGB 算，despill 只改輸出顏色。
 * 全逐像素、確定性、無 ML／agent，mobile 版可照搬。
 */
const KEY_LO = 12; // greenness ≤ 此 → 全保留（主體側）
const KEY_HI = 90; // greenness ≥ 此 → 全透明（綠幕側）
export async function chromaKeyGreen(src: Buffer | string): Promise<Buffer> {
  const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: ch } = info;
  const out = Buffer.alloc(W * H * 4);
  for (let p = 0; p < W * H; p++) {
    const i = p * ch;
    const r = data[i]!;
    let gg = data[i + 1]!;
    const b = data[i + 2]!;
    const a0 = data[i + 3]!;
    const mx = Math.max(r, b);
    const greenness = gg - mx;
    let keyA = 255;
    if (gg > 90) {
      if (greenness >= KEY_HI) keyA = 0;
      else if (greenness > KEY_LO) keyA = Math.round((255 * (KEY_HI - greenness)) / (KEY_HI - KEY_LO));
    }
    if (gg > mx + 20) gg = mx + 20; // despill：溢綠夾到非綠通道附近
    out[p * 4] = r;
    out[p * 4 + 1] = gg;
    out[p * 4 + 2] = b;
    out[p * 4 + 3] = Math.min(a0, keyA); // 保留原圖既有透明
  }
  return sharp(out, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
}

/** 依背景型態把整張 sheet 去背成透明前景（RGBA PNG）。 */
export async function keyBackground(src: Buffer | string, bg: Background): Promise<Buffer> {
  if (bg.kind === 'transparent') return sharp(src).ensureAlpha().png().toBuffer();
  if (bg.kind === 'green') return chromaKeyGreen(src);
  // opaque：色鍵分不開白衣服/白底 → 用語意模型整張去背
  return removeBackgroundLocal(src);
}

const ALPHA_OPAQUE = 128; // alpha > 此值視為前景

/** 由 RGBA 算每欄/列的前景（alpha>門檻）像素數 */
function foregroundProfiles(data: Buffer, W: number, H: number): { colOcc: number[]; rowOcc: number[] } {
  const colOcc = new Array<number>(W).fill(0);
  const rowOcc = new Array<number>(H).fill(0);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (data[(y * W + x) * 4 + 3]! > ALPHA_OPAQUE) {
        colOcc[x]! += 1;
        rowOcc[y]! += 1;
      }
    }
  }
  return { colOcc, rowOcc };
}

/**
 * 切格前的完整程式分析：偵測背景 → 去背 → 由前景剖面規劃參照切線。
 * 回傳含「去背後的 keyed sheet」與「切線＋每線品質」，全部算好，不需人工微調。
 */
export async function analyzeSheet(
  src: Buffer | string,
  grid: { cols: number; rows: number },
): Promise<SheetAnalysis> {
  const { cols, rows } = grid;
  const warnings: string[] = [];
  const background = await detectBackground(src);
  const keyed = await keyBackground(src, background);
  const { data, info } = await sharp(keyed).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { colOcc, rowOcc } = foregroundProfiles(data, info.width, info.height);

  const xPlan = planCutsFromProfile(colOcc, cols);
  const yPlan = planCutsFromProfile(rowOcc, rows);

  if (background.kind === 'opaque') {
    const [r, g, b] = background.color;
    warnings.push(
      `背景非透明（近 rgb(${r | 0},${g | 0},${b | 0})）：已用語意模型整張去背。` +
        `若主體與背景同色（如白衣白底）邊緣可能殘留，最乾淨的做法是請 char-gen 直接產透明底。`,
    );
  }

  return { background, keyed, width: info.width, height: info.height, xs: xPlan.cuts, ys: yPlan.cuts, xPlan, yPlan, warnings };
}

export interface CutSheetResult {
  /** 同尺寸（canvasW×canvasH）已對齊放置的格（RGBA PNG） */
  cells: Buffer[];
  analysis: SheetAnalysis;
  cellsMeta: CellMeta[];
  canvasW: number;
  canvasH: number;
  /** 場景精修對齊的最大平移 px（align 'grid' 才有） */
  sceneShiftMax: number;
  /** 切出的格已去背（透明前景）→ 下游不必再去背 */
  keyed: boolean;
}

/**
 * 一站式：分析（偵測背景→去背→規劃參照切線）→ 元件式抽格（取前 count 格，row-major）。
 * align：'center'（靜態，各自置中）｜'grid'（動態影格，按原圖等分格座標對齊、場景固定）。
 * 切出的格已是去背後的透明 PNG。
 */
export async function cutSheet(
  src: Buffer | string,
  opts: { cols: number; rows: number; count: number; align?: 'center' | 'grid' },
): Promise<CutSheetResult> {
  const { cols, rows, count, align = 'center' } = opts;
  const analysis = await analyzeSheet(src, { cols, rows });
  const { data } = await sharp(analysis.keyed).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  const ex = extractCells(
    { data, width: analysis.width, height: analysis.height },
    { cols, rows, count, xs: analysis.xs, ys: analysis.ys, align },
  );

  const cells = await Promise.all(
    ex.cells.map((c) =>
      sharp(Buffer.from(c.buffer, c.byteOffset, c.byteLength), {
        raw: { width: ex.canvasW, height: ex.canvasH, channels: 4 },
      })
        .png()
        .toBuffer(),
    ),
  );
  return { cells, analysis, cellsMeta: ex.metas, canvasW: ex.canvasW, canvasH: ex.canvasH, sceneShiftMax: ex.sceneShiftMax, keyed: true };
}
