/**
 * 組圖切格（瀏覽器版）：偵測背景 → 去背成透明 → 由前景占用剖面規劃「參照」切線
 * → 元件式抽格（@core/cells：格線僅參照、逐格偵測實際範圍、越線不切斷、空格回報）。
 * 綠幕門檻與 CLI 版一致；瀏覽器色鍵預設只處理外框四向連通背景，
 * 使用者也可明確選擇以色差容差掃描全圖並硬挖符合像素。
 * 切線規劃與抽格直接重用 @core 的純函式。
 *
 * 去背一律走色鍵（綠幕／單色），不用 @imgly 語意模型——sheet 流程曾卡在 ~80MB
 * 模型下載；不透明背景改用「邊框平均色」或「使用者點選色」做單色色鍵。
 */

import { inferAxisCells, planCutsFromProfile, type CutPlan } from '@core/sheet.js';
import { extractCells, type CellMeta } from '@core/cells.js';
import {
  DEFAULT_COLOR_KEY_OPTIONS,
  type ColorKeyOptions,
} from '@core/colorKey.js';
import {
  prepareColorKeySession,
  type ColorKeyCalibrationDiagnostics,
  type PreparedColorKeySession,
} from './preparedColorKey.js';
import type { Raster } from './raster.js';

export type Background =
  | { kind: 'transparent' }
  | { kind: 'green'; color: [number, number, number] }
  | { kind: 'opaque'; color: [number, number, number] };

export interface SheetAnalysis {
  background: Background;
  /** 去背成透明後的整張 sheet；後續抽格由它抽 */
  keyed: Raster;
  width: number;
  height: number;
  xs: number[];
  ys: number[];
  xPlan: CutPlan;
  yPlan: CutPlan;
  /** 由前景縫隙推斷的實際網格（單軸不確定＝null）；網格防呆用 */
  inferredGrid: { cols: number | null; rows: number | null };
  colorKeySessionIdentity?: string;
  colorKeyDiagnostics?: ColorKeyCalibrationDiagnostics;
  warnings: string[];
}

export interface KeyOptions {
  /** 自動去背（預設 true）；false＝直接用原圖 alpha（圖須已是透明底） */
  autoRemove?: boolean;
  /** 上游已完成語意去背時，用這個標籤取代「須已透明」警告。 */
  preRemovedLabel?: string;
  /** 使用者點選的背景色：指定時用此色做單色色鍵（蓋過自動偵測） */
  pickColor?: [number, number, number] | null;
  /** 僅供單色色鍵使用的範圍、容差與邊緣策略。 */
  colorKey?: ColorKeyOptions;
  /** Preview and final analysis may share one immutable color-key calibration. */
  preparedColorKey?: PreparedColorKeySession;
  /** An automatic/corrected full-sheet raster prepared by the shared preview boundary. */
  preparedResult?: {
    raster: Raster;
    sessionIdentity?: string;
    diagnostics?: ColorKeyCalibrationDiagnostics;
  };
}

const ALPHA_OPAQUE = 128;
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

/** 切格前的完整程式分析：偵測背景 → 去背 → 規劃參照切線。 */
export async function analyzeSheet(
  src: Raster,
  grid: { cols: number; rows: number },
  key: KeyOptions = {},
): Promise<SheetAnalysis> {
  const { cols, rows } = grid;
  const warnings: string[] = [];
  const background = detectBackground(src);
  const colorKey = key.colorKey ?? DEFAULT_COLOR_KEY_OPTIONS;
  let keyed = src;
  let colorKeySessionIdentity: string | undefined;
  let colorKeyDiagnostics: ColorKeyCalibrationDiagnostics | undefined;
  if (key.preparedResult) {
    if (key.preparedResult.raster.width !== src.width || key.preparedResult.raster.height !== src.height) {
      throw new Error('預先準備的組圖去背結果尺寸與來源不一致');
    }
    keyed = key.preparedResult.raster;
    colorKeySessionIdentity = key.preparedResult.sessionIdentity;
    colorKeyDiagnostics = key.preparedResult.diagnostics;
  } else if (key.autoRemove !== false) {
    const prepared = key.preparedColorKey ?? await prepareColorKeySession([src], {
      manualColor: key.pickColor,
      colorKey,
    });
    const rendered = prepared.render(src);
    keyed = rendered.raster;
    colorKeySessionIdentity = rendered.sessionIdentity;
    colorKeyDiagnostics = prepared.diagnostics;
  }
  const { colOcc, rowOcc } = foregroundProfiles(keyed);

  const xPlan = planCutsFromProfile(colOcc, cols);
  const yPlan = planCutsFromProfile(rowOcc, rows);

  const inferredGrid = { cols: inferAxisCells(colOcc), rows: inferAxisCells(rowOcc) };
  const colsMismatch = inferredGrid.cols !== null && inferredGrid.cols !== cols;
  const rowsMismatch = inferredGrid.rows !== null && inferredGrid.rows !== rows;
  if (colsMismatch || rowsMismatch) {
    warnings.push(
      `內容縫隙顯示組圖約為 ${inferredGrid.cols ?? '?'}×${inferredGrid.rows ?? '?'}，` +
        `與指定網格 ${cols}×${rows} 不符——切出的影格會錯位漂移，請確認網格設定。`,
    );
  }

  if (key.preRemovedLabel) {
    warnings.push(`已由 ${key.preRemovedLabel} 完成語意去背，再以完整 alpha mask 分析縫隙與跨格元件。`);
  } else if (key.autoRemove === false) {
    warnings.push('已關閉自動去背：直接使用原圖 alpha（圖須已是透明底，否則切格會失敗）。');
  } else if (key.pickColor && colorKey.scope === 'whole-image') {
    const [r, g, b] = key.pickColor;
    warnings.push(
      `以點選色 rgb(${r},${g},${b}) 掃描全圖，硬挖色差容差 ${colorKey.tolerancePercent.toFixed(1)}% 內的像素。`,
    );
  } else if (key.pickColor) {
    const [r, g, b] = key.pickColor;
    warnings.push(
      `以點選色 rgb(${r},${g},${b}) 做外框連通單色色鍵去背；` +
        '被非背景色完整包住的同色細節會保留，封閉的背景洞也可能保留。',
    );
  } else if (background.kind !== 'transparent' && colorKey.scope === 'whole-image') {
    const [r, g, b] = background.color;
    warnings.push(
      `以偵測色 rgb(${r | 0},${g | 0},${b | 0}) 掃描全圖，硬挖色差容差 ${colorKey.tolerancePercent.toFixed(1)}% 內的像素。`,
    );
  } else if (background.kind === 'opaque') {
    const [r, g, b] = background.color;
    warnings.push(
      `背景非透明（近 rgb(${r | 0},${g | 0},${b | 0})）：以邊框平均色做外框連通單色色鍵去背。` +
        '被非背景色完整包住的同色細節會保留，封閉的背景洞也可能保留；' +
        `若自動顏色不準，可改用「從圖選色」指定背景色。`,
    );
  }

  if (colorKeyDiagnostics?.detectedColor) {
    const [r, g, b] = colorKeyDiagnostics.detectedColor;
    warnings.push(
      `背景群集 rgb(${r},${g},${b})，偵測信心 ${Math.round(colorKeyDiagnostics.confidence * 100)}%。`,
    );
  }
  warnings.push(...(colorKeyDiagnostics?.warnings ?? []));

  return {
    background,
    keyed,
    width: keyed.width,
    height: keyed.height,
    xs: xPlan.cuts,
    ys: yPlan.cuts,
    xPlan,
    yPlan,
    inferredGrid,
    ...(colorKeySessionIdentity ? { colorKeySessionIdentity } : {}),
    ...(colorKeyDiagnostics ? { colorKeyDiagnostics } : {}),
    warnings,
  };
}

export interface CutSheetResult {
  /** 同尺寸（canvasW×canvasH）已對齊放置的格 */
  cells: Raster[];
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
 * align：'center'（靜態，各自置中）｜'grid'（動態影格，按原圖等分格座標對齊、場景固定不閃）。
 */
export async function cutSheet(
  src: Raster,
  opts: { cols: number; rows: number; count: number; align?: 'center' | 'grid'; key?: KeyOptions },
): Promise<CutSheetResult> {
  const { cols, rows, count, align = 'center' } = opts;
  if (cols < 1 || rows < 1) throw new RangeError(`網格 ${cols}×${rows} 不合法`);
  const analysis = await analyzeSheet(src, { cols, rows }, opts.key);

  const ex = extractCells(analysis.keyed, { cols, rows, count, xs: analysis.xs, ys: analysis.ys, align });

  const cells: Raster[] = ex.cells.map((c) => ({
    data: new Uint8ClampedArray(c.buffer, c.byteOffset, c.byteLength) as Uint8ClampedArray<ArrayBuffer>,
    width: ex.canvasW,
    height: ex.canvasH,
  }));
  return { cells, analysis, cellsMeta: ex.metas, canvasW: ex.canvasW, canvasH: ex.canvasH, sceneShiftMax: ex.sceneShiftMax, keyed: true };
}
