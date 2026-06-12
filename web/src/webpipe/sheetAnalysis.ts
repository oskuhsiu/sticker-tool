/**
 * 組圖切格（瀏覽器版）：偵測背景 → 去背成透明 → 由前景占用剖面把切線吸到真實透明縫
 * → 切格 → 校正（pad 統一大小、量測被切開/空格、靜態再做中線校準）。
 * 純逐像素邏輯與 CLI 版一致；切線規劃重用 @core/sheet 的 planCutsFromProfile。
 */

import { planCutsFromProfile, type CutPlan } from '@core/sheet.js';
import { cropRaster, padRaster, type Raster } from './raster.js';
import { removeBackgroundLocal } from './removeBackground.js';

export type Background =
  | { kind: 'transparent' }
  | { kind: 'green'; color: [number, number, number] }
  | { kind: 'opaque'; color: [number, number, number] };

export interface SheetAnalysis {
  background: Background;
  /** 去背成透明後的整張 sheet；後續切格由它切 */
  keyed: Raster;
  width: number;
  height: number;
  xs: number[];
  ys: number[];
  xPlan: CutPlan;
  yPlan: CutPlan;
  warnings: string[];
}

/** 某格切格後的校正量測 */
export interface CellReport {
  index: number;
  fgRatio: number;
  sliced: boolean;
  touch: string;
  bleed: number;
  empty: boolean;
  recentered: boolean;
}

export interface Calibration {
  cells: Raster[];
  reports: CellReport[];
  slicedCount: number;
  cellW: number;
  cellH: number;
}

const ALPHA_OPAQUE = 128;
const BLEED_TH = 0.5;
const EMPTY_TH = 0.02;
const isGreenPx = (r: number, g: number, b: number): boolean => g > 90 && g - r > 40 && g - b > 40;

/** 取邊框（2px 框）像素樣本，判背景型態 */
export function detectBackground(src: Raster): Background {
  const { data, width: W, height: H } = src;
  const samples: Array<[number, number, number, number]> = [];
  const at = (x: number, y: number): void => {
    const i = (y * W + x) * 4;
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
 * 綠幕色鍵 + despill（soft matte／抗鋸齒）。
 * greenness = g − max(r,b) 映射 alpha：≤KEY_LO 全保留、≥KEY_HI 全透明、之間線性漸層。
 * 門檻與 CLI 版相同（取自實測直方圖）。
 */
const KEY_LO = 12;
const KEY_HI = 90;
export function chromaKeyGreen(src: Raster): Raster {
  const { data, width: W, height: H } = src;
  const out = new Uint8ClampedArray(W * H * 4);
  for (let p = 0; p < W * H; p++) {
    const i = p * 4;
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
    if (gg > mx + 20) gg = mx + 20; // despill
    out[p * 4] = r;
    out[p * 4 + 1] = gg;
    out[p * 4 + 2] = b;
    out[p * 4 + 3] = Math.min(a0, keyA);
  }
  return { data: out, width: W, height: H };
}

/** 依背景型態把整張 sheet 去背成透明前景。 */
export async function keyBackground(src: Raster, bg: Background): Promise<Raster> {
  if (bg.kind === 'transparent') return src;
  if (bg.kind === 'green') return chromaKeyGreen(src);
  // opaque：色鍵分不開白衣服/白底 → 用語意模型整張去背
  return removeBackgroundLocal(src);
}

/** 每欄/列的前景（alpha>門檻）像素數 */
function foregroundProfiles(keyed: Raster): { colOcc: number[]; rowOcc: number[] } {
  const { data, width: W, height: H } = keyed;
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

/** 切格前的完整程式分析：偵測背景 → 去背 → 規劃 gutter 切線。 */
export async function analyzeSheet(src: Raster, grid: { cols: number; rows: number }): Promise<SheetAnalysis> {
  const { cols, rows } = grid;
  const warnings: string[] = [];
  const background = detectBackground(src);
  const keyed = await keyBackground(src, background);
  const { colOcc, rowOcc } = foregroundProfiles(keyed);

  const xPlan = planCutsFromProfile(colOcc, cols);
  const yPlan = planCutsFromProfile(rowOcc, rows);

  const noGutterX = xPlan.gutterFound.filter((v) => !v).length;
  const noGutterY = yPlan.gutterFound.filter((v) => !v).length;
  if (noGutterX || noGutterY) {
    warnings.push(
      `有 ${noGutterX} 條直線、${noGutterY} 條橫線找不到乾淨透明縫（主體跨格塞滿）：已取占用最小處切，` +
        `但建議重產組圖時讓網格留明顯間隙、主體不越格線。`,
    );
  }
  if (background.kind === 'opaque') {
    const [r, g, b] = background.color;
    warnings.push(
      `背景非透明（近 rgb(${r | 0},${g | 0},${b | 0})）：已用語意模型整張去背。` +
        `若主體與背景同色（如白衣白底）邊緣可能殘留，最乾淨的做法是產圖時直接要求透明底。`,
    );
  }

  return { background, keyed, width: keyed.width, height: keyed.height, xs: xPlan.cuts, ys: yPlan.cuts, xPlan, yPlan, warnings };
}

/** 置中 pad 到 W×H（透明底） */
function padCenter(r: Raster, W: number, H: number): Raster {
  if (r.width === W && r.height === H) return r;
  const left = Math.floor((W - r.width) / 2);
  const top = Math.floor((H - r.height) / 2);
  return padRaster(r, { left, right: W - r.width - left, top, bottom: H - r.height - top });
}

/** 量一格的「前景占比」與四邊各自的「沿邊前景占比」（bleed） */
function inspectCell(r: Raster): { fgRatio: number; edge: { L: number; R: number; T: number; B: number } } {
  const { data, width: W, height: H } = r;
  const op = (x: number, y: number): number => (data[(y * W + x) * 4 + 3]! > ALPHA_OPAQUE ? 1 : 0);
  let fg = 0;
  for (let p = 0; p < W * H; p++) if (data[p * 4 + 3]! > ALPHA_OPAQUE) fg++;
  let L = 0;
  let R = 0;
  for (let y = 0; y < H; y++) {
    L += Math.max(op(0, y), op(1, y));
    R += Math.max(op(W - 1, y), op(W - 2, y));
  }
  let T = 0;
  let B = 0;
  for (let x = 0; x < W; x++) {
    T += Math.max(op(x, 0), op(x, 1));
    B += Math.max(op(x, H - 1), op(x, H - 2));
  }
  return { fgRatio: fg / (W * H), edge: { L: L / H, R: R / H, T: T / W, B: B / W } };
}

interface Comp {
  area: number;
  minx: number;
  miny: number;
  maxx: number;
  maxy: number;
}

/** 4-連通元件標記（alpha>門檻） */
function labelComponents(data: Uint8ClampedArray, W: number, H: number): { labels: Int32Array; comps: Comp[] } {
  const labels = new Int32Array(W * H);
  const comps: Comp[] = [];
  const stack: number[] = [];
  for (let s = 0; s < W * H; s++) {
    if (data[s * 4 + 3]! <= ALPHA_OPAQUE || labels[s]) continue;
    const id = comps.length + 1;
    labels[s] = id;
    stack.length = 0;
    stack.push(s);
    let area = 0;
    let minx = W;
    let miny = H;
    let maxx = 0;
    let maxy = 0;
    while (stack.length) {
      const q = stack.pop()!;
      const qx = q % W;
      const qy = (q / W) | 0;
      area++;
      if (qx < minx) minx = qx;
      if (qx > maxx) maxx = qx;
      if (qy < miny) miny = qy;
      if (qy > maxy) maxy = qy;
      if (qx > 0 && data[(q - 1) * 4 + 3]! > ALPHA_OPAQUE && !labels[q - 1]) { labels[q - 1] = id; stack.push(q - 1); }
      if (qx < W - 1 && data[(q + 1) * 4 + 3]! > ALPHA_OPAQUE && !labels[q + 1]) { labels[q + 1] = id; stack.push(q + 1); }
      if (qy > 0 && data[(q - W) * 4 + 3]! > ALPHA_OPAQUE && !labels[q - W]) { labels[q - W] = id; stack.push(q - W); }
      if (qy < H - 1 && data[(q + W) * 4 + 3]! > ALPHA_OPAQUE && !labels[q + W]) { labels[q + W] = id; stack.push(q + W); }
    }
    comps.push({ area, minx, miny, maxx, maxy });
  }
  return { labels, comps };
}

/**
 * 中線校準：主體置中 + 清掉鄰格滲入殘片（與主體 bbox 有明顯間隙的遠處元件）。
 * 動態包不要 recenter（會破壞跨格對齊）——交給 stabilize。
 */
const GAP_FRAC = 0.06;
function recenterCell(r: Raster): { raster: Raster; moved: boolean; dropped: number } {
  const { data, width: W, height: H } = r;
  const { labels, comps } = labelComponents(data, W, H);
  if (!comps.length) return { raster: r, moved: false, dropped: 0 };

  let mainIdx = 0;
  for (let i = 1; i < comps.length; i++) if (comps[i]!.area > comps[mainIdx]!.area) mainIdx = i;
  const m = comps[mainIdx]!;
  const margin = Math.round(Math.min(W, H) * GAP_FRAC);

  const keep = new Uint8Array(comps.length + 1);
  let dropped = 0;
  for (let i = 0; i < comps.length; i++) {
    const c = comps[i]!;
    const near =
      !(c.maxx < m.minx - margin || c.minx > m.maxx + margin || c.maxy < m.miny - margin || c.miny > m.maxy + margin);
    if (i === mainIdx || near) keep[i + 1] = 1;
    else dropped++;
  }

  const out = new Uint8ClampedArray(W * H * 4);
  let minx = W;
  let miny = H;
  let maxx = 0;
  let maxy = 0;
  for (let p = 0; p < W * H; p++) {
    if (labels[p] && keep[labels[p]!]) {
      out[p * 4] = data[p * 4]!;
      out[p * 4 + 1] = data[p * 4 + 1]!;
      out[p * 4 + 2] = data[p * 4 + 2]!;
      out[p * 4 + 3] = data[p * 4 + 3]!;
      const x = p % W;
      const y = (p / W) | 0;
      if (x < minx) minx = x;
      if (x > maxx) maxx = x;
      if (y < miny) miny = y;
      if (y > maxy) maxy = y;
    }
  }
  if (maxx < minx) return { raster: r, moved: false, dropped: 0 };

  const bw = maxx - minx + 1;
  const bh = maxy - miny + 1;
  const centeredX = Math.abs((minx + maxx) / 2 - (W - 1) / 2) <= 1;
  const centeredY = Math.abs((miny + maxy) / 2 - (H - 1) / 2) <= 1;
  if (dropped === 0 && centeredX && centeredY) return { raster: r, moved: false, dropped: 0 };

  const cropped = cropRaster({ data: out, width: W, height: H }, minx, miny, bw, bh);
  return { raster: padCenter(cropped, W, H), moved: true, dropped };
}

/**
 * 切格後校正：逐格量測 + pad 成統一大小；recenter=true（靜態預設）再做中線校準。
 */
export function calibrateCells(
  raw: Raster[],
  grid: { cols: number; rows: number; recenter?: boolean },
): Calibration {
  const { cols, rows, recenter = true } = grid;
  const cellW = Math.max(...raw.map((r) => r.width));
  const cellH = Math.max(...raw.map((r) => r.height));

  const reports: CellReport[] = [];
  const cells: Raster[] = [];
  for (let i = 0; i < raw.length; i++) {
    const { fgRatio, edge } = inspectCell(raw[i]!);
    const c = i % cols;
    const rrow = (i / cols) | 0;
    const sides: Array<[string, number, boolean]> = [
      ['L', edge.L, c > 0],
      ['R', edge.R, c < cols - 1],
      ['T', edge.T, rrow > 0],
      ['B', edge.B, rrow < rows - 1],
    ];
    let touch = '';
    let bleed = 0;
    for (const [name, val, internal] of sides) {
      if (!internal) continue;
      if (val > bleed) bleed = val;
      if (val > BLEED_TH) touch += name;
    }
    const empty = fgRatio < EMPTY_TH;
    let cell = padCenter(raw[i]!, cellW, cellH);
    let recentered = false;
    if (recenter && !empty) {
      const r = recenterCell(cell);
      cell = r.raster;
      recentered = r.moved;
    }
    reports.push({ index: i, fgRatio: +fgRatio.toFixed(3), sliced: touch.length > 0, touch, bleed: +bleed.toFixed(3), empty, recentered });
    cells.push(cell);
  }
  return { cells, reports, slicedCount: reports.filter((r) => r.sliced).length, cellW, cellH };
}

export interface CutSheetResult {
  cells: Raster[];
  analysis: SheetAnalysis;
  calibration: Calibration;
  /** 切出的格已去背（透明前景）→ 下游不必再去背 */
  keyed: boolean;
}

/**
 * 一站式：分析（偵測背景→去背→規劃 gutter 切線）→ 切格 → 校正。
 * 取前 count 格（row-major）。切出的格已是去背後的透明前景。
 */
export async function cutSheet(
  src: Raster,
  opts: { cols: number; rows: number; count: number; recenter?: boolean },
): Promise<CutSheetResult> {
  const { cols, rows, count, recenter = true } = opts;
  if (cols < 1 || rows < 1) throw new RangeError(`網格 ${cols}×${rows} 不合法`);
  const analysis = await analyzeSheet(src, { cols, rows });
  const { xs, ys, keyed } = analysis;

  const raw: Raster[] = [];
  for (let r = 0; r < rows && raw.length < count; r++) {
    for (let c = 0; c < cols && raw.length < count; c++) {
      const left = xs[c]!;
      const top = ys[r]!;
      const width = xs[c + 1]! - left;
      const height = ys[r + 1]! - top;
      raw.push(cropRaster(keyed, left, top, width, height));
    }
  }
  if (raw.length < count) {
    throw new Error(`組圖只切得出 ${raw.length} 格，少於要求的 ${count} 格（網格 ${cols}×${rows}）`);
  }

  const calibration = calibrateCells(raw, { cols, rows, recenter });
  return { cells: calibration.cells, analysis, calibration, keyed: true };
}
