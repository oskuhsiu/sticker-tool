/**
 * 把 cutSheet 的切格分析／抽格報告寫進處理紀錄（對應 CLI 的 cutReport）。
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
  const { analysis, cellsMeta, canvasW, canvasH } = cut;
  logger.log('info', `背景：${bgLabel(analysis.background)}`);

  const fmt = (plan: { gutterFound: boolean[] }): string => {
    const found = plan.gutterFound.filter(Boolean).length;
    const tot = plan.gutterFound.length;
    return `${found}/${tot}`;
  };
  logger.log('info', `參照切線對齊縫｜直：${fmt(analysis.xPlan)}｜橫：${fmt(analysis.yPlan)}（格線僅參照；內容按元件偵測，不會被切斷）`);

  const crossers = cellsMeta.filter((m) => m.outOfCell > 2);
  if (crossers.length) {
    const list = crossers.map((m) => `#${m.index + 1}(+${m.outOfCell}px)`).join(' ');
    logger.log('info', `越出參照格線的主體已完整保留（${crossers.length}）：${list}`);
  }
  const empties = cellsMeta.filter((m) => m.empty).map((m) => `#${m.index + 1}`);
  if (empties.length) {
    logger.log('warn', `幾乎沒主體的空格（${empties.length}）：${empties.join(' ')}（切錯位或該格漏畫）`);
  } else {
    logger.log('info', `抽格：每格主體完整、無空格（畫布 ${canvasW}×${canvasH}）`);
  }
  if (cut.sceneShiftMax > 0) logger.log('info', `場景精修對齊：修正構圖漂移最大 ${cut.sceneShiftMax}px`);
  for (const w of analysis.warnings) logger.log('warn', w);
}
