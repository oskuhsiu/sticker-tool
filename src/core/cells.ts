/**
 * 元件式抽格（純邏輯、平台無關；CLI 與 web 共用）。
 *
 * 為什麼不用「沿切線切矩形」：格線在 AI 產的組圖裡只是參照——每格主體大小不一、
 * 道具會越線（舉高的奶瓶伸進上一格）。死切矩形會把越線的部分切斷、把鄰格滲入的
 * 殘片留在格內。改成：
 *   1) 整張 keyed sheet 做連通元件標記；
 *   2) 每個元件按「質心落在哪個參照格」歸屬該格（越線像素跟著元件走，不會被切斷，
 *      也不會殘留到鄰格）；
 *   3) 每格內容 trim 到實際 bbox，畫布取所有格的最大寬高；
 *   4) 放置對齊兩種模式：
 *      'center'＝靜態貼圖：各自置中（每張獨立，無對齊需求）。
 *      'grid'  ＝動態影格：以「原圖等分格原點」初始放置，再做「場景精修對齊」。
 *
 * 場景精修對齊（'grid'）——動畫不閃動的關鍵：
 *   實測 AI 組圖的構圖座標既不是等分格、也不是縫中心格——場景固定物在格內的位置
 *   會逐行/逐格累積漂移（±30–70px @1254px sheet）。錨點平移（如頭部）又會把場景
 *   推出畫布。正解是「對齊場景本身」：
 *     a) 逐像素中位數影像＝場景估計（會動的主體被中位數濾掉，留下固定景物）；
 *     b) 每格對中位數影像做小範圍平移搜尋（SAD，金字塔 4×→2× 粗到細）；
 *     c) 套用平移後重新放置。
 *   全程純逐像素、確定性、無 ML。
 */

export interface RGBASheet {
  /** RGBA，長度 = width*height*4 */
  data: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
}

export interface CellMeta {
  index: number;
  /** 該格沒有任何元件，或前景占比低於門檻（漏畫/切錯位） */
  empty: boolean;
  /** 前景面積占參照格面積比例 */
  fgRatio: number;
  /** 內容 bbox 越出參照切線的最大 px（內容已完整保留，僅供回報） */
  outOfCell: number;
  /** 內容 bbox（sheet 全域座標）；空格 = null */
  bbox: { left: number; top: number; width: number; height: number } | null;
}

export interface ExtractedCells {
  /** 同尺寸（canvasW×canvasH）的 RGBA 格，已按 align 模式放置；空格 = 全透明 */
  cells: Uint8Array[];
  metas: CellMeta[];
  canvasW: number;
  canvasH: number;
  /** 被當雜訊丟棄的微小元件數 */
  noiseDropped: number;
  /** 場景精修對齊的最大平移 px（'grid' 模式才有；0=初始放置已對齊） */
  sceneShiftMax: number;
}

export interface ExtractOptions {
  cols: number;
  rows: number;
  /** 取前 count 格（row-major）；落在其後格子的元件忽略 */
  count: number;
  /** 參照切線（planCutsFromProfile 的 cuts），長度 cols+1 / rows+1 */
  xs: number[];
  ys: number[];
  align: 'grid' | 'center';
}

const ALPHA_OPAQUE = 128; // alpha > 此值視為前景（面積/質心/占用剖面）
/**
 * 連通判定用較低門檻：色鍵的軟邊（半透明漸層）會讓「手握的瓶子」這類細頸接點
 * 在 alpha>128 下假性斷開、被拆成碎片；半透明邊像素（alpha 10–128）仍是同一物件
 * 的一部分。格與格之間的縫是「全透明 0」，不會因此誤連。
 */
const ALPHA_CONNECT = 10;
const EMPTY_TH = 0.02; // 前景占比低於此值＝幾乎沒主體
const NOISE_AREA = 16; // 面積小於此的元件當雜訊（色鍵殘點），不參與 bbox/歸屬
const SMALL_FRAC = 0.05; // 面積 <（最大元件×此值）的元件視為「碎片」，歸最近大元件的格
const SHIFT_FRAC = 0.12; // 場景精修的最大搜尋平移（占畫布短邊比例）

interface Comp {
  area: number;
  minx: number;
  miny: number;
  maxx: number;
  maxy: number;
  sumx: number;
  sumy: number;
}

/**
 * 4-連通元件標記（連通門檻 ALPHA_CONNECT，含半透明軟邊）；
 * area/質心只累計實心像素（alpha>ALPHA_OPAQUE），與面積/占用的定義一致。
 */
export function labelComponents(
  data: Uint8Array | Uint8ClampedArray,
  W: number,
  H: number,
): { labels: Int32Array; comps: Comp[] } {
  const labels = new Int32Array(W * H);
  const comps: Comp[] = [];
  const stack: number[] = [];
  for (let s = 0; s < W * H; s++) {
    if (data[s * 4 + 3]! <= ALPHA_CONNECT || labels[s]) continue;
    const id = comps.length + 1;
    labels[s] = id;
    stack.length = 0;
    stack.push(s);
    let area = 0;
    let minx = W;
    let miny = H;
    let maxx = 0;
    let maxy = 0;
    let sumx = 0;
    let sumy = 0;
    while (stack.length) {
      const q = stack.pop()!;
      const qx = q % W;
      const qy = (q / W) | 0;
      if (data[q * 4 + 3]! > ALPHA_OPAQUE) {
        area++;
        sumx += qx;
        sumy += qy;
      }
      if (qx < minx) minx = qx;
      if (qx > maxx) maxx = qx;
      if (qy < miny) miny = qy;
      if (qy > maxy) maxy = qy;
      if (qx > 0 && data[(q - 1) * 4 + 3]! > ALPHA_CONNECT && !labels[q - 1]) { labels[q - 1] = id; stack.push(q - 1); }
      if (qx < W - 1 && data[(q + 1) * 4 + 3]! > ALPHA_CONNECT && !labels[q + 1]) { labels[q + 1] = id; stack.push(q + 1); }
      if (qy > 0 && data[(q - W) * 4 + 3]! > ALPHA_CONNECT && !labels[q - W]) { labels[q - W] = id; stack.push(q - W); }
      if (qy < H - 1 && data[(q + W) * 4 + 3]! > ALPHA_CONNECT && !labels[q + W]) { labels[q + W] = id; stack.push(q + W); }
    }
    comps.push({ area, minx, miny, maxx, maxy, sumx, sumy });
  }
  return { labels, comps };
}

/** v 落在 cuts 的哪個區間：最後一個 i 使 cuts[i] ≤ v，夾在 [0, 區間數-1] */
function intervalOf(cuts: number[], v: number): number {
  let i = 0;
  while (i + 2 < cuts.length && v >= cuts[i + 1]!) i++;
  return i;
}

/** box 平均縮小 f 倍（RGBA） */
function downscale(src: Uint8Array, W: number, H: number, f: number): { data: Uint8Array; w: number; h: number } {
  const w = Math.max(1, Math.floor(W / f));
  const h = Math.max(1, Math.floor(H / f));
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let sy = y * f; sy < Math.min(H, (y + 1) * f); sy++) {
        for (let sx = x * f; sx < Math.min(W, (x + 1) * f); sx++) {
          const i = (sy * W + sx) * 4;
          r += src[i]!;
          g += src[i + 1]!;
          b += src[i + 2]!;
          a += src[i + 3]!;
          n++;
        }
      }
      const o = (y * w + x) * 4;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
      out[o + 3] = a / n;
    }
  }
  return { data: out, w, h };
}

/** 逐像素中位數影像（場景估計）；frame i 以 offsets[i] 平移後取樣 */
function medianFrame(frames: Uint8Array[], w: number, h: number, offsets: Array<{ x: number; y: number }>): Uint8Array {
  const n = frames.length;
  const out = new Uint8Array(w * h * 4);
  const vals = new Uint8Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let ch = 0; ch < 4; ch++) {
        let m = 0;
        for (let f = 0; f < n; f++) {
          const sx = x - offsets[f]!.x;
          const sy = y - offsets[f]!.y;
          vals[m++] = sx >= 0 && sx < w && sy >= 0 && sy < h ? frames[f]![(sy * w + sx) * 4 + ch]! : 0;
        }
        // 插入排序（n ≤ 20）取中位
        for (let a = 1; a < m; a++) {
          const v = vals[a]!;
          let b = a - 1;
          while (b >= 0 && vals[b]! > v) {
            vals[b + 1] = vals[b]!;
            b--;
          }
          vals[b + 1] = v;
        }
        out[(y * w + x) * 4 + ch] = vals[m >> 1]!;
      }
    }
  }
  return out;
}

/** frame 平移 (dx,dy) 後對參考影像的 SAD（只算參考的有效像素清單；缺前景罰滿） */
function sadAt(
  ref: Uint8Array,
  refIdx: Int32Array,
  frame: Uint8Array,
  w: number,
  h: number,
  dx: number,
  dy: number,
): number {
  let s = 0;
  for (let k = 0; k < refIdx.length; k++) {
    const p = refIdx[k]!;
    const x = p % w;
    const y = (p / w) | 0;
    const sx = x - dx;
    const sy = y - dy;
    const o = p * 4;
    if (sx < 0 || sx >= w || sy < 0 || sy >= h) {
      s += 765;
      continue;
    }
    const i = (sy * w + sx) * 4;
    if (frame[i + 3]! <= ALPHA_OPAQUE) {
      s += 765;
      continue;
    }
    s += Math.abs(ref[o]! - frame[i]!) + Math.abs(ref[o + 1]! - frame[i + 1]!) + Math.abs(ref[o + 2]! - frame[i + 2]!);
  }
  return s;
}

/**
 * 場景精修對齊：對每格找一個小平移，使它與「中位數影像（場景估計）」最匹配。
 * 金字塔 4×（粗搜全範圍）→ 2×（細修 ±2）；回傳 full-res 偏移（誤差 ≤1px）。
 */
function refineSceneAlignment(cells: Uint8Array[], W: number, H: number, skip: boolean[]): Array<{ x: number; y: number }> {
  const n = cells.length;
  const offsets = Array.from({ length: n }, () => ({ x: 0, y: 0 }));
  const act: number[] = [];
  for (let i = 0; i < n; i++) if (!skip[i]) act.push(i);
  if (act.length < 3) return offsets; // 格太少，中位數不可靠

  const maxShift = Math.round(Math.min(W, H) * SHIFT_FRAC);
  if (maxShift < 4) return offsets;

  for (const f of [4, 2]) {
    const ds = new Map<number, Uint8Array>();
    let w = 0;
    let h = 0;
    for (const i of act) {
      const d = downscale(cells[i]!, W, H, f);
      ds.set(i, d.data);
      w = d.w;
      h = d.h;
    }
    const scaled = act.map((i) => ({ x: Math.round(offsets[i]!.x / f), y: Math.round(offsets[i]!.y / f) }));
    const ref = medianFrame(act.map((i) => ds.get(i)!), w, h, scaled);
    // 參考的有效像素 = 中位 alpha > 門檻（= 多數影格在此處有前景的場景區）
    const idxList: number[] = [];
    for (let p = 0; p < w * h; p++) if (ref[p * 4 + 3]! > ALPHA_OPAQUE) idxList.push(p);
    if (idxList.length < 64) return offsets; // 沒有穩定場景區（每格內容毫無重疊）→ 不精修
    const refIdx = Int32Array.from(idxList);

    const r = f === 4 ? Math.max(1, Math.ceil(maxShift / 4)) : 2;
    for (let k = 0; k < act.length; k++) {
      const i = act[k]!;
      const cx = scaled[k]!.x;
      const cy = scaled[k]!.y;
      let best = Infinity;
      let bx = cx;
      let by = cy;
      for (let dy = cy - r; dy <= cy + r; dy++) {
        for (let dx = cx - r; dx <= cx + r; dx++) {
          const s = sadAt(ref, refIdx, ds.get(i)!, w, h, dx, dy);
          if (s < best) {
            best = s;
            bx = dx;
            by = dy;
          }
        }
      }
      offsets[i] = { x: bx * f, y: by * f };
    }
  }
  return offsets;
}

export function extractCells(sheet: RGBASheet, opts: ExtractOptions): ExtractedCells {
  const { cols, rows, count, xs, ys, align } = opts;
  const { data, width: W, height: H } = sheet;
  const { labels, comps } = labelComponents(data, W, H);

  // 元件 → 格：大元件按質心落在哪個參照格；小元件（多半是被手指等遮擋
  // 截斷的道具碎片，如舉高奶瓶的瓶口）歸「bbox 距離最近的大元件」所在格——
  // 按自己的質心會把越線道具的碎片誤判給鄰格。
  const cellOf = new Int32Array(comps.length).fill(-1);
  let noiseDropped = 0;
  let maxArea = 0;
  for (const c of comps) if (c.area > maxArea) maxArea = c.area;
  const bigTh = maxArea * SMALL_FRAC;
  const deferred: number[] = [];
  const byCentroid = (c: Comp): number => {
    const col = intervalOf(xs, c.sumx / c.area);
    const row = intervalOf(ys, c.sumy / c.area);
    return row * cols + col;
  };
  for (let i = 0; i < comps.length; i++) {
    const c = comps[i]!;
    if (c.area < NOISE_AREA) {
      noiseDropped++;
      continue;
    }
    if (c.area >= bigTh) {
      const idx = byCentroid(c);
      if (idx < count) cellOf[i] = idx;
    } else {
      deferred.push(i);
    }
  }
  for (const i of deferred) {
    const c = comps[i]!;
    const cx = c.sumx / c.area;
    const cy = c.sumy / c.area;
    let bestDist = Infinity;
    let bestCell = -1;
    for (let j = 0; j < comps.length; j++) {
      const b = comps[j]!;
      if (b.area < bigTh || cellOf[j]! < 0) continue;
      // 質心到大元件 bbox 最近點的距離（bbox-對-bbox 的間隙會被「bbox 大但實際像素遠」騙到）
      const gx = cx < b.minx ? b.minx - cx : cx > b.maxx ? cx - b.maxx : 0;
      const gy = cy < b.miny ? b.miny - cy : cy > b.maxy ? cy - b.maxy : 0;
      const d = gx * gx + gy * gy;
      if (d < bestDist) {
        bestDist = d;
        bestCell = cellOf[j]!;
      }
    }
    if (bestCell >= 0) {
      cellOf[i] = bestCell;
    } else {
      const idx = byCentroid(c);
      if (idx < count) cellOf[i] = idx;
    }
  }

  // 每格 union bbox + 前景面積
  const bl = new Array<number>(count).fill(W);
  const bt = new Array<number>(count).fill(H);
  const br = new Array<number>(count).fill(-1);
  const bb = new Array<number>(count).fill(-1);
  const fgArea = new Array<number>(count).fill(0);
  for (let i = 0; i < comps.length; i++) {
    const ci = cellOf[i]!;
    if (ci < 0) continue;
    const c = comps[i]!;
    if (c.minx < bl[ci]!) bl[ci] = c.minx;
    if (c.miny < bt[ci]!) bt[ci] = c.miny;
    if (c.maxx > br[ci]!) br[ci] = c.maxx;
    if (c.maxy > bb[ci]!) bb[ci] = c.maxy;
    fgArea[ci]! += c.area;
  }
  const hasContent = (i: number): boolean => br[i]! >= 0;

  // 放置（dx/dy）＋畫布大小；assemble = 單一像素 pass 把每個前景像素寫進其格的畫布
  const dx = new Array<number>(count).fill(0);
  const dy = new Array<number>(count).fill(0);
  let canvasW = 1;
  let canvasH = 1;
  const computeCanvas = (): void => {
    canvasW = 1;
    canvasH = 1;
    for (let i = 0; i < count; i++) {
      if (!hasContent(i)) continue;
      const bw = br[i]! - bl[i]! + 1;
      const bh = bb[i]! - bt[i]! + 1;
      if (dx[i]! + bw > canvasW) canvasW = dx[i]! + bw;
      if (dy[i]! + bh > canvasH) canvasH = dy[i]! + bh;
    }
  };
  const assemble = (): Uint8Array[] => {
    const out: Uint8Array[] = Array.from({ length: count }, () => new Uint8Array(canvasW * canvasH * 4));
    for (let p = 0; p < W * H; p++) {
      const l = labels[p]!;
      if (!l) continue;
      const ci = cellOf[l - 1]!;
      if (ci < 0) continue;
      const x = p % W;
      const y = (p / W) | 0;
      const tx = x - bl[ci]! + dx[ci]!;
      const ty = y - bt[ci]! + dy[ci]!;
      if (tx < 0 || tx >= canvasW || ty < 0 || ty >= canvasH) continue;
      const ti = (ty * canvasW + tx) * 4;
      const si = p * 4;
      const cell = out[ci]!;
      cell[ti] = data[si]!;
      cell[ti + 1] = data[si + 1]!;
      cell[ti + 2] = data[si + 2]!;
      cell[ti + 3] = data[si + 3]!;
    }
    return out;
  };

  let sceneShiftMax = 0;
  if (align === 'grid') {
    // 初始放置：內容在「等分格」內的相對位置（AI 構圖座標系的近似）
    const cellW = W / cols;
    const cellH = H / rows;
    let minRelX = Infinity;
    let minRelY = Infinity;
    for (let i = 0; i < count; i++) {
      if (!hasContent(i)) continue;
      const relX = bl[i]! - (i % cols) * cellW;
      const relY = bt[i]! - ((i / cols) | 0) * cellH;
      if (relX < minRelX) minRelX = relX;
      if (relY < minRelY) minRelY = relY;
    }
    for (let i = 0; i < count; i++) {
      if (!hasContent(i)) continue;
      dx[i] = Math.round(bl[i]! - (i % cols) * cellW - minRelX);
      dy[i] = Math.round(bt[i]! - ((i / cols) | 0) * cellH - minRelY);
    }
    computeCanvas();

    // 場景精修：AI 構圖會逐行/逐格累積漂移，初始放置只是近似 → 對齊到中位數場景
    const draft = assemble();
    const skip = Array.from({ length: count }, (_, i) => !hasContent(i));
    const offsets = refineSceneAlignment(draft, canvasW, canvasH, skip);
    let minDx = Infinity;
    let minDy = Infinity;
    for (let i = 0; i < count; i++) {
      if (!hasContent(i)) continue;
      sceneShiftMax = Math.max(sceneShiftMax, Math.abs(offsets[i]!.x), Math.abs(offsets[i]!.y));
      dx[i]! += offsets[i]!.x;
      dy[i]! += offsets[i]!.y;
      if (dx[i]! < minDx) minDx = dx[i]!;
      if (dy[i]! < minDy) minDy = dy[i]!;
    }
    if (sceneShiftMax > 0) {
      for (let i = 0; i < count; i++) {
        if (!hasContent(i)) continue;
        dx[i]! -= minDx;
        dy[i]! -= minDy;
      }
      computeCanvas();
    }
  } else {
    // center：各自置中
    for (let i = 0; i < count; i++) {
      if (!hasContent(i)) continue;
      const bw = br[i]! - bl[i]! + 1;
      const bh = bb[i]! - bt[i]! + 1;
      if (bw > canvasW) canvasW = bw;
      if (bh > canvasH) canvasH = bh;
    }
    for (let i = 0; i < count; i++) {
      if (!hasContent(i)) continue;
      dx[i] = (canvasW - (br[i]! - bl[i]! + 1)) >> 1;
      dy[i] = (canvasH - (bb[i]! - bt[i]! + 1)) >> 1;
    }
  }

  const cells = assemble();

  // 量測報告
  const metas: CellMeta[] = [];
  for (let i = 0; i < count; i++) {
    const col = i % cols;
    const row = (i / cols) | 0;
    if (!hasContent(i)) {
      metas.push({ index: i, empty: true, fgRatio: 0, outOfCell: 0, bbox: null });
      continue;
    }
    const refArea = (xs[col + 1]! - xs[col]!) * (ys[row + 1]! - ys[row]!);
    const fgRatio = refArea > 0 ? fgArea[i]! / refArea : 0;
    const outOfCell = Math.max(
      0,
      xs[col]! - bl[i]!,
      br[i]! + 1 - xs[col + 1]!,
      ys[row]! - bt[i]!,
      bb[i]! + 1 - ys[row + 1]!,
    );
    metas.push({
      index: i,
      empty: fgRatio < EMPTY_TH,
      fgRatio: +fgRatio.toFixed(3),
      outOfCell,
      bbox: { left: bl[i]!, top: bt[i]!, width: br[i]! - bl[i]! + 1, height: bb[i]! - bt[i]! + 1 },
    });
  }

  return { cells, metas, canvasW, canvasH, noiseDropped, sceneShiftMax };
}
