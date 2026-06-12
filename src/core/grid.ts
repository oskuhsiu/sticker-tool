/**
 * 由張數決定 sprite sheet 網格（rows×cols）與需幾張大圖。
 * 純邏輯、平台無關。
 *
 * 核心約束（issues #4，已實測定案）：
 *  - 跨 codex 呼叫「守不住臉」→ 角色包必須在「同一次呼叫、單張組圖」內產完。
 *  - 角色包張數實務上限（基準 spike 4×3=12 品質佳）：
 *      8  → 完全支援
 *      16 → 支援但警告單格解析度下降（4×4，超出已驗證範圍）
 *      ≥24 → 預設擋下，需 forceOversizeSet 才強制單次（接受降質）
 *  - 多張大圖/多次呼叫僅限非角色貼圖（物件/風景，不需身份一致）。
 */

import type { GridDecision, GridLayout } from './types.js';

/** 單張 sprite sheet 的格數上限（spike 實測 12 格品質佳） */
export const CELL_CAP_PER_SHEET = 12;

/** 角色包單張組圖：品質良好的張數上限 */
const CHAR_GOOD_MAX = 8;
/** 角色包單張組圖：可接受但會降質的張數上限 */
const CHAR_WARN_MAX = 16;

/**
 * 由「格數」決定近似方形、略偏橫向的 rows×cols。
 * sprite sheet 偏橫向（cols ≥ rows）符合多數產圖模型輸出比例。
 */
export function gridDimsFor(cells: number): { cols: number; rows: number } {
  if (cells < 1) throw new RangeError(`格數須 ≥1，收到 ${cells}`);
  // 常見張數採用手調、好看的版面
  const table: Record<number, { cols: number; rows: number }> = {
    1: { cols: 1, rows: 1 },
    2: { cols: 2, rows: 1 },
    3: { cols: 3, rows: 1 },
    4: { cols: 2, rows: 2 },
    6: { cols: 3, rows: 2 },
    8: { cols: 4, rows: 2 },
    9: { cols: 3, rows: 3 },
    10: { cols: 5, rows: 2 },
    12: { cols: 4, rows: 3 },
    16: { cols: 4, rows: 4 },
    20: { cols: 5, rows: 4 },
    24: { cols: 6, rows: 4 },
  };
  const hit = table[cells];
  if (hit) return hit;
  // 一般情形：略偏橫向（×1.4），cols 取上界後算 rows
  const cols = Math.ceil(Math.sqrt(cells * 1.4));
  const rows = Math.ceil(cells / cols);
  return { cols, rows };
}

/**
 * 規劃整包的網格與大圖張數。
 * @param count   目標貼圖張數
 * @param opts    isCharacter（角色包→單次單張）；forceOversizeSet（角色包超限強制）
 */
export function planGrid(
  count: number,
  opts: { isCharacter: boolean; forceOversizeSet?: boolean },
): GridDecision {
  const { isCharacter, forceOversizeSet = false } = opts;
  const warnings: string[] = [];

  if (count < 1) {
    return {
      layout: { count, cols: 1, rows: 1, sheets: 1, cellsPerSheet: 1 },
      warnings: [],
      blocked: true,
      blockReason: `張數須 ≥1，收到 ${count}`,
    };
  }

  if (isCharacter) {
    // 角色包：恆為「單張組圖」。
    const dims = gridDimsFor(count);
    const layout: GridLayout = {
      count,
      cols: dims.cols,
      rows: dims.rows,
      sheets: 1,
      cellsPerSheet: count,
    };

    if (count <= CHAR_GOOD_MAX) {
      return { layout, warnings, blocked: false };
    }
    if (count <= CHAR_WARN_MAX) {
      warnings.push(
        `角色包 ${count} 張採單張 ${dims.cols}×${dims.rows} 組圖：單格解析度下降（超出已驗證的 4×3=12 範圍），臉部細節可能變糊。`,
      );
      return { layout, warnings, blocked: false };
    }
    // > 16 張
    if (forceOversizeSet) {
      warnings.push(
        `角色包 ${count} 張遠超單張組圖品質範圍（${dims.cols}×${dims.rows}）。已用 forceOversizeSet 強制單次產出，單格將明顯降質；建議改 8/16 張，或非角色物件包改逐張高解析模式。`,
      );
      return { layout, warnings, blocked: false };
    }
    return {
      layout,
      warnings,
      blocked: true,
      blockReason:
        `角色包 ${count} 張預設擋下：單張組圖塞 ${count} 格會嚴重降質、且跨呼叫無法保證同一人。` +
        ` 選項：(a) 設定 ai.forceOversizeSet=true 接受降質強制單次；(b) 改用 8 或 16 張；(c) 設 ai.isCharacter=false 走逐張高解析模式（臉會漂，僅適合非角色/物件貼圖）。`,
    };
  }

  // 非角色包：可切多張大圖（只需風格一致，不需身份一致）。
  const sheets = Math.ceil(count / CELL_CAP_PER_SHEET);
  const cellsPerSheet = Math.ceil(count / sheets); // 平均分配，各 sheet 同網格
  const dims = gridDimsFor(cellsPerSheet);
  const layout: GridLayout = {
    count,
    cols: dims.cols,
    rows: dims.rows,
    sheets,
    cellsPerSheet,
  };
  if (sheets > 1) {
    warnings.push(
      `非角色包 ${count} 張將分 ${sheets} 張大圖產出（每張 ${dims.cols}×${dims.rows}）；跨大圖僅保證風格一致、不保證物件身份一致。`,
    );
  }
  return { layout, warnings, blocked: false };
}

/**
 * 依「投影剖面」把 n 等分的內部切線各自吸附到附近最空的縫（valley）。
 * 用於切 sprite sheet：codex 的網格常輕微沒對齊、或舉手等主體略外溢，死切 1/n 會切到主體；
 * 改在每條等分線附近 ±窗內找剖面最低點（最空＝最可能是格間透明縫）當切線。
 * profile[i] = 第 i 欄（或列）的內容量（如 alpha 總和）；回傳含頭尾的切點 [0, cut1, …, total]。
 * 剖面近乎平坦（沒有明顯縫）時該線回退到等分位置，避免亂跳。純邏輯、平台無關。
 *
 * 註：切格主線已改用 core/sheet.ts 的 `planCutsFromProfile`（找透明帶、切在帶中心、回報穿越成本，
 * 更穩健），並由 pipeline/sheetAnalysis.ts 的 cutSheet 串起「偵測背景→去背→切→校正」。
 * 本函式保留為輕量純工具。
 */
export function snapToValleys(profile: number[], n: number): number[] {
  const total = profile.length;
  if (n <= 1 || total < n) return [0, total];
  const cell = total / n;
  const win = Math.max(2, Math.round(cell * 0.3));
  const cuts: number[] = [0];
  for (let k = 1; k < n; k++) {
    const exp = Math.round((k * total) / n);
    const lo = Math.max(1, exp - win);
    const hi = Math.min(total - 2, exp + win);
    let best = exp;
    let bv = Infinity;
    let localMax = 0;
    for (let i = lo; i <= hi; i++) {
      const v = profile[i]!;
      if (v < bv) {
        bv = v;
        best = i;
      }
      if (v > localMax) localMax = v;
    }
    // 只有窗內存在明顯凹陷（縫）才吸附；否則用等分位置
    cuts.push(localMax > 0 && (localMax - bv) / localMax > 0.05 ? best : exp);
  }
  cuts.push(total);
  return cuts;
}
