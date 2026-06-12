/**
 * 從組圖（sprite sheet）切出個別貼圖／影格。
 *
 * 切線對齊（align）：
 *   'equal'  — 純等分網格切格（組圖網格本就乾淨、或不需去背時用）。
 *   'auto'   — 程式分析後再切（預設、推薦）：偵測背景→去背成透明→由前景占用剖面把每條
 *              等分線吸附到真實透明縫的中心→切→校正成統一大小。切出的格已去背。
 *              詳見 pipeline/sheetAnalysis.ts 的 cutSheet。'gutter' 為其別名（相容舊呼叫）。
 *
 * 去背策略（strategy）：
 *   'equal'       — 不額外去背（'auto' 已整張去背，這裡不再重複）。
 *   'equal+rembg' — 切後對每格再跑語意去背補刀（極少需要；'auto' 通常已足夠）。
 */

import sharp from 'sharp';
import type { CropStrategy, RemoveBgMode } from '../core/types.js';
import { equalCuts } from '../core/sheet.js';
import { cutSheet } from './sheetAnalysis.js';
import { applyBackgroundRemoval } from './removeBackground.js';

export interface CropGridOptions {
  cols: number;
  rows: number;
  /** 只取前 count 格（其餘空格忽略） */
  count: number;
  strategy?: CropStrategy;
  /** 'equal+rembg' 用的去背模式，預設 true */
  removeBgMode?: RemoveBgMode;
  /** 切線對齊：'auto'（程式分析＋去背＋gutter，預設）| 'equal'（純等分）；'gutter'＝'auto' 別名 */
  align?: 'equal' | 'gutter' | 'auto';
}

/**
 * 切格。align 預設 'auto'：走 cutSheet（偵測背景→去背→gutter 切→校正），切出的格已去背。
 * align 'equal'：純等分切，再依 strategy 決定要不要逐格去背。
 */
export async function cropGrid(sheet: Buffer | string, opts: CropGridOptions): Promise<Buffer[]> {
  const { cols, rows, count, strategy = 'equal', removeBgMode = true, align = 'auto' } = opts;
  if (cols < 1 || rows < 1) throw new RangeError(`網格 ${cols}×${rows} 不合法`);

  if (align !== 'equal') {
    const { cells } = await cutSheet(sheet, { cols, rows, count });
    return cells;
  }

  // align 'equal'：純等分切
  const src: Buffer = typeof sheet === 'string' ? await sharp(sheet).png().toBuffer() : sheet;
  const meta = await sharp(src).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  if (W === 0 || H === 0) throw new Error('組圖尺寸讀取失敗');
  const xs = equalCuts(W, cols);
  const ys = equalCuts(H, rows);

  const cells: Buffer[] = [];
  for (let r = 0; r < rows && cells.length < count; r++) {
    for (let c = 0; c < cols && cells.length < count; c++) {
      const left = xs[c]!;
      const top = ys[r]!;
      const width = xs[c + 1]! - left;
      const height = ys[r + 1]! - top;
      cells.push(await sharp(src).extract({ left, top, width, height }).ensureAlpha().png().toBuffer());
    }
  }
  if (cells.length < count) {
    throw new Error(`組圖只切得出 ${cells.length} 格，少於要求的 ${count} 格（網格 ${cols}×${rows}）`);
  }

  if (strategy === 'equal+rembg') {
    return Promise.all(cells.map(async (b) => (await applyBackgroundRemoval(b, removeBgMode)).buffer));
  }
  return cells;
}
