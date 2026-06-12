/**
 * 切格前的「程式分析」與切格後的「校正」——把過去要 agent 看圖手調的事全部算出來。
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
 *   4) calibrateCells：切完後逐格量「主體是否被切線切開、前景占比」，pad 成統一大小，
 *      回傳「算好的品質報告」取代人工看拼貼。
 *
 * 切出來的格已是去背後的透明 PNG，下游不必再逐格去背（少跑 15 次 @imgly）。
 */

import sharp from 'sharp';
import { planCutsFromProfile, type CutPlan } from '../core/sheet.js';
import { removeBackgroundLocal } from './removeBackground.js';

export type Background =
  | { kind: 'transparent' }
  | { kind: 'green'; color: [number, number, number] }
  | { kind: 'opaque'; color: [number, number, number] };

export interface SheetAnalysis {
  background: Background;
  /** 去背成透明後的整張 sheet（RGBA PNG）；後續切格由它切 */
  keyed: Buffer;
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
  /** 前景（不透明）占該格面積比例 */
  fgRatio: number;
  /** 主體在「內部切線那一側」沿邊跨越量顯著 → 疑似被切開 */
  sliced: boolean;
  /** 被切開的內部邊（L/R/T/B） */
  touch: string;
  /** 內部邊上前景占該邊長度的最大比例（bleed；0=邊緣乾淨，越高=越多主體跨格） */
  bleed: number;
  /** 該格幾乎沒主體（fgRatio < 門檻）→ 切錯位或漏畫 */
  empty: boolean;
  /** 中線校準時有平移主體或清掉鄰格殘片 */
  recentered: boolean;
}

export interface Calibration {
  /** pad 成統一大小、置中後的格 */
  cells: Buffer[];
  reports: CellReport[];
  /** 被切線切開的格數 */
  slicedCount: number;
  /** 統一後的格大小 */
  cellW: number;
  cellH: number;
}

const ALPHA_OPAQUE = 128; // alpha > 此值視為前景
/** 內部切線那側「沿邊前景占比」超過此值才算被切開（半邊以上跨格＝真的切到，非腳尖輕觸） */
const BLEED_TH = 0.5;
/** 前景占比低於此值＝該格幾乎沒主體（切錯位或 char-gen 漏畫該格） */
const EMPTY_TH = 0.02;
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

/** 由 RGBA 算每欄/列的前景（alpha>門檻）像素數 */
async function foregroundProfiles(keyed: Buffer): Promise<{ colOcc: number[]; rowOcc: number[]; W: number; H: number }> {
  const { data, info } = await sharp(keyed).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: ch } = info;
  const colOcc = new Array<number>(W).fill(0);
  const rowOcc = new Array<number>(H).fill(0);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (data[(y * W + x) * ch + 3]! > ALPHA_OPAQUE) {
        colOcc[x]! += 1;
        rowOcc[y]! += 1;
      }
    }
  }
  return { colOcc, rowOcc, W, H };
}

/**
 * 切格前的完整程式分析：偵測背景 → 去背 → 由前景剖面規劃 gutter 切線。
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
  const { colOcc, rowOcc, W, H } = await foregroundProfiles(keyed);

  const xPlan = planCutsFromProfile(colOcc, cols);
  const yPlan = planCutsFromProfile(rowOcc, rows);

  const noGutterX = xPlan.gutterFound.filter((v) => !v).length;
  const noGutterY = yPlan.gutterFound.filter((v) => !v).length;
  if (noGutterX || noGutterY) {
    warnings.push(
      `有 ${noGutterX} 條直線、${noGutterY} 條橫線找不到乾淨透明縫（主體跨格塞滿）：已取占用最小處切，` +
        `但建議回 char-gen 讓網格留明顯間隙、主體不越格線。`,
    );
  }
  if (background.kind === 'opaque') {
    const [r, g, b] = background.color;
    warnings.push(
      `背景非透明（近 rgb(${r | 0},${g | 0},${b | 0})）：已用語意模型整張去背。` +
        `若主體與背景同色（如白衣白底）邊緣可能殘留，最乾淨的做法是請 char-gen 直接產透明底。`,
    );
  }

  return { background, keyed, width: W, height: H, xs: xPlan.cuts, ys: yPlan.cuts, xPlan, yPlan, warnings };
}

/** 置中 pad 到 W×H（透明底） */
async function padCenter(buf: Buffer, w: number, h: number, W: number, H: number): Promise<Buffer> {
  if (w === W && h === H) return buf;
  const left = Math.floor((W - w) / 2);
  const top = Math.floor((H - h) / 2);
  return sharp(buf)
    .extend({ left, right: W - w - left, top, bottom: H - h - top, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

/**
 * 量一格的「前景占比」與四邊各自的「沿邊前景占比」（bleed）。
 * bleed 直接量主體跨格的程度（沿切線那條邊有多少前景像素），比「bbox 是否碰到 1px」穩健——
 * 懶骨頭/腳尖輕觸邊緣（單點）不會誤判成被切開，真正一大塊跨格才會。
 */
async function inspectCell(
  buf: Buffer,
): Promise<{ fgRatio: number; edge: { L: number; R: number; T: number; B: number } }> {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H } = info;
  const op = (x: number, y: number): number => (data[(y * W + x) * 4 + 3]! > ALPHA_OPAQUE ? 1 : 0);
  let fg = 0;
  for (let p = 0; p < W * H; p++) if (data[p * 4 + 3]! > ALPHA_OPAQUE) fg++;
  // 取最外兩排，避免去背後邊緣一排毛邊造成抖動；用兩排內較大者
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

/** 4-連通元件標記（alpha>門檻）；回傳每像素的 label（0=背景）與各元件 bbox/面積（id = index+1） */
function labelComponents(data: Buffer, W: number, H: number): { labels: Int32Array; comps: Comp[] } {
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
 * 中線校準（純程式、確定性）：把單格主體置中對齊格中心，並清掉鄰格滲入的殘片。
 * 為什麼需要：codex 把主體畫得比格高大時，上一格的身體尾巴會溢進這格頂部（被切線切到）；
 * fitCanvas 的 trim 會把「主體＋殘片」一起當內容置中，於是殘片留著、中心也偏掉。
 * 做法：連通元件分析 → 主體＝最大元件 → 丟棄「與主體 bbox 有明顯間隙（離 > 邊長×GAP）」的遠處元件
 *（＝被切線切斷的鄰格尾巴；主體被去背拆成數塊、或貼近主體的道具會因間隙小而保留）→ 把保留內容置中。
 * 動態包的飛出愛心等遠處分離前景靠 recenter=false 保住（不會走到這裡）。
 * 回傳 { buffer, moved }：moved=是否有平移或清片（供報告）。
 */
const GAP_FRAC = 0.06; // 與主體 bbox 的容許間隙（占格短邊比例）
async function recenterCell(buf: Buffer): Promise<{ buffer: Buffer; moved: boolean; dropped: number }> {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  const { labels, comps } = labelComponents(data, W, H);
  if (!comps.length) return { buffer: buf, moved: false, dropped: 0 };

  let mainIdx = 0;
  for (let i = 1; i < comps.length; i++) if (comps[i]!.area > comps[mainIdx]!.area) mainIdx = i;
  const m = comps[mainIdx]!;
  const margin = Math.round(Math.min(W, H) * GAP_FRAC);

  // 留：主體，或 bbox 落在「主體 bbox 外擴 margin」內的元件（含被拆塊的主體、貼近道具）。
  // 丟：離主體有明顯間隙的遠處元件＝鄰格被切斷的殘片。
  const keep = new Uint8Array(comps.length + 1);
  let dropped = 0;
  for (let i = 0; i < comps.length; i++) {
    const c = comps[i]!;
    const near =
      !(c.maxx < m.minx - margin || c.minx > m.maxx + margin || c.maxy < m.miny - margin || c.miny > m.maxy + margin);
    if (i === mainIdx || near) keep[i + 1] = 1;
    else dropped++;
  }

  // 組「清片後」緩衝並算保留內容 bbox
  const out = Buffer.alloc(W * H * 4);
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
  if (maxx < minx) return { buffer: buf, moved: false, dropped: 0 };

  const bw = maxx - minx + 1;
  const bh = maxy - miny + 1;
  // 已置中且無清片 → 原樣回（省一次編碼）
  const centeredX = Math.abs((minx + maxx) / 2 - (W - 1) / 2) <= 1;
  const centeredY = Math.abs((miny + maxy) / 2 - (H - 1) / 2) <= 1;
  if (dropped === 0 && centeredX && centeredY) return { buffer: buf, moved: false, dropped: 0 };

  const cropped = await sharp(out, { raw: { width: W, height: H, channels: 4 } })
    .extract({ left: minx, top: miny, width: bw, height: bh })
    .png()
    .toBuffer();
  const buffer = await padCenter(cropped, bw, bh, W, H);
  return { buffer, moved: true, dropped };
}

/**
 * 切格後校正：逐格量「主體是否被內部切線切開、前景占比」，並 pad 成統一大小。
 * recenter=true（靜態預設）時再做「中線校準」：清掉鄰格滲入殘片＋把主體置中。
 * 動態包不要 recenter（會破壞跨格對齊、造成抖動）——交給 processAnimated 的 stabilize。
 * 回傳算好的品質報告，讓上層用數字判斷（要不要回 char-gen 重產），不必看拼貼圖。
 * @param raw  各格（可能不等大）的 RGBA PNG，row-major
 */
export async function calibrateCells(
  raw: Buffer[],
  grid: { cols: number; rows: number; recenter?: boolean },
): Promise<Calibration> {
  const { cols, rows, recenter = true } = grid;
  const metas = await Promise.all(raw.map((b) => sharp(b).metadata()));
  const cellW = Math.max(...metas.map((m) => m.width ?? 0));
  const cellH = Math.max(...metas.map((m) => m.height ?? 0));

  const reports: CellReport[] = [];
  const cells: Buffer[] = [];
  for (let i = 0; i < raw.length; i++) {
    const { fgRatio, edge } = await inspectCell(raw[i]!);
    const c = i % cols;
    const rrow = (i / cols) | 0;
    // 只看「內部切線」那側；沿邊前景占比 > BLEED_TH 才算被切開（避免腳尖/道具輕觸誤判）
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
    // 先 pad 成統一大小，再（靜態）中線校準
    let cell = await padCenter(raw[i]!, metas[i]!.width ?? 0, metas[i]!.height ?? 0, cellW, cellH);
    let recentered = false;
    if (recenter && !empty) {
      const r = await recenterCell(cell);
      cell = r.buffer;
      recentered = r.moved;
    }
    reports.push({ index: i, fgRatio: +fgRatio.toFixed(3), sliced: touch.length > 0, touch, bleed: +bleed.toFixed(3), empty, recentered });
    cells.push(cell);
  }
  return { cells, reports, slicedCount: reports.filter((r) => r.sliced).length, cellW, cellH };
}

export interface CutSheetResult {
  cells: Buffer[];
  analysis: SheetAnalysis;
  calibration: Calibration;
  /** 切出的格已去背（透明前景）→ 下游不必再去背 */
  keyed: boolean;
}

/**
 * 一站式：分析（偵測背景→去背→規劃 gutter 切線）→ 切格 → 校正。
 * 取前 count 格（row-major）。切出的格已是去背後的透明 PNG。
 */
export async function cutSheet(
  src: Buffer | string,
  opts: { cols: number; rows: number; count: number; recenter?: boolean },
): Promise<CutSheetResult> {
  const { cols, rows, count, recenter = true } = opts;
  const analysis = await analyzeSheet(src, { cols, rows });
  const { xs, ys, keyed } = analysis;

  const raw: Buffer[] = [];
  for (let r = 0; r < rows && raw.length < count; r++) {
    for (let c = 0; c < cols && raw.length < count; c++) {
      const left = xs[c]!;
      const top = ys[r]!;
      const width = xs[c + 1]! - left;
      const height = ys[r + 1]! - top;
      raw.push(await sharp(keyed).extract({ left, top, width, height }).ensureAlpha().png().toBuffer());
    }
  }
  if (raw.length < count) {
    throw new Error(`組圖只切得出 ${raw.length} 格，少於要求的 ${count} 格（網格 ${cols}×${rows}）`);
  }

  const calibration = await calibrateCells(raw, { cols, rows, recenter });
  return { cells: calibration.cells, analysis, calibration, keyed: true };
}
