/**
 * 把 cutSheet 的切格分析／校正報告寫進處理紀錄（對應 CLI 的 cutReport）。
 */

import type { CutSheetResult } from '../webpipe/sheetAnalysis.js';
import type { Logger } from './common.jsx';

const bgLabel = (bg: CutSheetResult['analysis']['background']): string => {
  if (bg.kind === 'transparent') return '透明';
  if (bg.kind === 'green') return '綠幕（色鍵去背）';
  const [r, g, b] = bg.color;
  return `不透明 rgb(${r | 0},${g | 0},${b | 0})（語意去背）`;
};

export function reportCut(cut: CutSheetResult, logger: Logger): void {
  const { analysis, calibration } = cut;
  logger.log('info', `背景：${bgLabel(analysis.background)}`);

  const fmt = (plan: { cost: number; gutterFound: boolean[] }): string => {
    const found = plan.gutterFound.filter(Boolean).length;
    const tot = plan.gutterFound.length;
    return `成本 ${plan.cost.toFixed(3)}、對齊縫 ${found}/${tot}`;
  };
  logger.log('info', `切線品質（越低越好）｜直：${fmt(analysis.xPlan)}｜橫：${fmt(analysis.yPlan)}`);

  if (calibration.slicedCount > 0) {
    const bad = calibration.reports.filter((r) => r.sliced).map((r) => `#${r.index + 1}${r.touch}`);
    logger.log('warn', `主體有半邊以上跨切線的格（${calibration.slicedCount}）：${bad.join(' ')}（字母=越界的邊；多半是該格主體被畫得太大）`);
  }
  const empties = calibration.reports.filter((r) => r.empty).map((r) => `#${r.index + 1}`);
  if (empties.length) {
    logger.log('warn', `幾乎沒主體的空格（${empties.length}）：${empties.join(' ')}（切錯位或該格漏畫）`);
  }
  if (calibration.slicedCount === 0 && empties.length === 0) {
    logger.log('info', '校正：每格主體完整、無空格');
  }
  for (const w of analysis.warnings) logger.log('warn', w);
}
