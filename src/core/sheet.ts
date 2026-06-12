/**
 * 切格的「純邏輯」核心：由占用剖面（每欄/列的前景像素數）規劃 n 格的切線。
 * 平台無關、可單元測試；像素 I/O（去背、取剖面）在 pipeline/sheetAnalysis.ts。
 *
 * 為什麼要這支：codex 產的組圖網格幾乎不會剛好等分——
 *  尺寸不整除（1254÷4=313.5）、模型把格線畫歪、或主體舉手/道具略外溢。
 * 死切 1/n 會切穿主體、把手夾進隔壁格。改成「先在程式裡找真正的透明縫（gutter），
 * 切在縫的正中央」；找不到縫（主體跨格塞滿）的線才回退等分，並回報該線的穿越成本，
 * 讓上層用「算出來的數字」判斷品質，而不是靠人看拼貼圖微調。
 */

export interface CutPlan {
  /** 含頭尾的切點 [0, c1, …, total]，長度 n+1 */
  cuts: number[];
  /** 每條內部切線是否吸附到真實透明縫（長度 n-1）；false=該線無縫、回退等分/最小點 */
  gutterFound: boolean[];
  /** 每條內部切線的「穿越成本」= occ[cut]/peak（0=切在乾淨縫、越高=切穿越多主體） */
  crossings: number[];
  /** 內部切線穿越成本的平均（單一品質分數，越低越好） */
  cost: number;
}

export interface PlanCutsOptions {
  /** 每條線在等分位置 ±(searchFrac×格寬) 內找縫，預設 0.4 */
  searchFrac?: number;
  /** 占用 ≤ peak×lowFrac 視為「縫」，預設 0.12 */
  lowFrac?: number;
  /** 相鄰切線最小間距（占格寬比例），避免縫太近黏死，預設 0.5 */
  minCellFrac?: number;
}

/** 等分邊界（四捨五入吸收餘數，避免最後一格掉幾 px） */
export function equalCuts(total: number, n: number): number[] {
  return Array.from({ length: n + 1 }, (_, i) => Math.round((i * total) / n));
}

export interface InferAxisOptions {
  /** 占用 ≤ peak×lowFrac 視為「縫」，預設 0.12（與 planCutsFromProfile 同義） */
  lowFrac?: number;
  /** 縫最小寬度 px（濾雜訊），預設 3 */
  minGutterPx?: number;
  /** 分段寬度 max/min 超過此值＝縫被道具跨格遮斷或誤判 → 不下結論，預設 1.8 */
  maxWidthRatio?: number;
}

/**
 * 由占用剖面推斷「內容實際有幾欄/列」：內容範圍（去掉頭尾留白）內的低占用帶＝格間縫，
 * 縫數+1＝格數。只有在分段寬度大致均勻（AI 組圖是等格）時才下結論，否則回 null。
 * 用途：網格防呆——使用者指定 5×4 但內容是 4×4 時，切格會整組錯位漂移（實測 2026-06）。
 */
export function inferAxisCells(occ: number[], opts: InferAxisOptions = {}): number | null {
  const { lowFrac = 0.12, minGutterPx = 3, maxWidthRatio = 1.8 } = opts;
  const peak = Math.max(...occ) || 0;
  if (peak <= 0) return null;
  const th = peak * lowFrac;
  let first = -1;
  let last = -1;
  for (let i = 0; i < occ.length; i++) {
    if (occ[i]! > th) {
      if (first < 0) first = i;
      last = i;
    }
  }
  if (first < 0 || last - first < 8) return null;

  const bands: Array<[number, number]> = [];
  let s = -1;
  for (let i = first; i <= last; i++) {
    if (occ[i]! <= th) {
      if (s < 0) s = i;
    } else if (s >= 0) {
      bands.push([s, i - 1]);
      s = -1;
    }
  }
  const gutters = bands.filter(([a, b]) => b - a + 1 >= minGutterPx);

  // 分段寬度均勻度：縫被跨格道具遮斷會合併出 2 倍寬的段 → 寬度比超標 → 不下結論
  const edges = [first - 0.5, ...gutters.map(([a, b]) => (a + b) / 2), last + 0.5];
  const widths: number[] = [];
  for (let k = 0; k + 1 < edges.length; k++) widths.push(edges[k + 1]! - edges[k]!);
  const wmin = Math.min(...widths);
  const wmax = Math.max(...widths);
  if (wmin <= 0 || wmax / wmin > maxWidthRatio) return null;
  return gutters.length + 1;
}

/** 在 [lo,hi]（含）內找所有「占用 ≤ th」的連續帶，回傳 [start,end] 串 */
function lowBands(occ: number[], lo: number, hi: number, th: number): Array<[number, number]> {
  const bands: Array<[number, number]> = [];
  let s = -1;
  for (let i = lo; i <= hi; i++) {
    if (occ[i]! <= th) {
      if (s < 0) s = i;
    } else if (s >= 0) {
      bands.push([s, i - 1]);
      s = -1;
    }
  }
  if (s >= 0) bands.push([s, hi]);
  return bands;
}

/**
 * 由占用剖面 occ（occ[i]=第 i 欄/列的前景像素數）規劃 n 格切線。
 * 每條內部等分線在 ±窗內找最靠近的透明帶、切在帶中心；無帶則取窗內占用最小點並標記 gutterFound=false。
 * 強制切線嚴格遞增、相鄰間距 ≥ minCell，避免縫貼太近塌掉。
 */
export function planCutsFromProfile(occ: number[], n: number, opts: PlanCutsOptions = {}): CutPlan {
  const total = occ.length;
  const { searchFrac = 0.4, lowFrac = 0.12, minCellFrac = 0.5 } = opts;
  if (n <= 1 || total < n * 2) {
    return { cuts: equalCuts(total, n), gutterFound: [], crossings: [], cost: 0 };
  }
  const peak = Math.max(...occ) || 1;
  const cell = total / n;
  const win = Math.max(2, Math.round(cell * searchFrac));
  const lowTh = peak * lowFrac;
  const minCell = Math.max(1, Math.round(cell * minCellFrac));

  const inner: number[] = [];
  const gutterFound: boolean[] = [];
  for (let k = 1; k < n; k++) {
    const exp = Math.round(k * cell);
    const prev = inner.length ? inner[inner.length - 1]! : 0;
    // 窗：等分位置 ±win，且不早於「前一刀+minCell」、不晚於「尾端要留得下剩餘格」
    const lo = Math.max(1, prev + minCell, exp - win);
    const hi = Math.min(total - 1 - (n - k) * minCell, exp + win);
    if (hi < lo) {
      // 空間被擠掉（縫太密）：退回等分位置並夾住遞增
      inner.push(Math.max(prev + 1, exp));
      gutterFound.push(false);
      continue;
    }
    const bands = lowBands(occ, lo, hi, lowTh);
    if (bands.length) {
      // 取「帶中心最靠近等分位置」的帶；同距取較寬者（縫越寬越可信）
      let best = bands[0]!;
      let bestScore = Infinity;
      for (const b of bands) {
        const center = (b[0] + b[1]) / 2;
        const width = b[1] - b[0] + 1;
        const score = Math.abs(center - exp) - width * 0.5; // 近且寬者勝
        if (score < bestScore) {
          bestScore = score;
          best = b;
        }
      }
      const center = Math.round((best[0] + best[1]) / 2);
      inner.push(Math.min(hi, Math.max(lo, center)));
      gutterFound.push(true);
    } else {
      // 無縫：主體跨此線塞滿——取窗內占用最小點（傷害最小），標記無縫
      let argmin = exp;
      let mv = Infinity;
      for (let i = lo; i <= hi; i++) {
        if (occ[i]! < mv) {
          mv = occ[i]!;
          argmin = i;
        }
      }
      inner.push(argmin);
      gutterFound.push(false);
    }
  }

  const cuts = [0, ...inner, total];
  const crossings = inner.map((c) => occ[c]! / peak);
  const cost = crossings.length ? crossings.reduce((a, b) => a + b, 0) / crossings.length : 0;
  return { cuts, gutterFound, crossings, cost };
}
