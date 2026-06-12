/**
 * 把 cutSheet 算好的切格分析／校正報告印成人看得懂的摘要。
 * 重點：這些都是「程式量出來的數字」——背景型態、每條切線的穿越成本、被切開的格——
 * 讓使用者用數據判斷「可接受 or 回 char-gen 重產」，而不是盯著拼貼圖手調。
 */

import type { CutSheetResult } from '../pipeline/sheetAnalysis.js';
import { log } from './util.js';

const bgLabel = (bg: CutSheetResult['analysis']['background']): string => {
  if (bg.kind === 'transparent') return '透明';
  if (bg.kind === 'green') return '綠幕（色鍵去背）';
  const [r, g, b] = bg.color;
  return `不透明 rgb(${r | 0},${g | 0},${b | 0})（語意去背）`;
};

export function reportCut(cut: CutSheetResult): void {
  const { analysis, calibration } = cut;
  log.info(`背景：${bgLabel(analysis.background)}`);

  const fmt = (plan: { cost: number; gutterFound: boolean[] }): string => {
    const found = plan.gutterFound.filter(Boolean).length;
    const tot = plan.gutterFound.length;
    return `成本 ${plan.cost.toFixed(3)}、對齊縫 ${found}/${tot}`;
  };
  log.info(`切線品質（越低越好）｜直：${fmt(analysis.xPlan)}｜橫：${fmt(analysis.yPlan)}`);

  if (calibration.slicedCount > 0) {
    const bad = calibration.reports.filter((r) => r.sliced).map((r) => `#${r.index + 1}${r.touch}`);
    log.warn(`主體有半邊以上跨切線的格（${calibration.slicedCount}）：${bad.join(' ')}（字母=越界的邊；多半是該格主體被畫得太大）`);
  }
  const empties = calibration.reports.filter((r) => r.empty).map((r) => `#${r.index + 1}`);
  if (empties.length) log.warn(`幾乎沒主體的空格（${empties.length}）：${empties.join(' ')}（切錯位或 char-gen 漏畫該格）`);
  if (calibration.slicedCount === 0 && empties.length === 0) log.info('校正：每格主體完整、無空格');
  for (const w of analysis.warnings) log.warn(w);
}
