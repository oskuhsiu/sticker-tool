/**
 * 把 cutSheet 算好的切格分析／抽格報告印成人看得懂的摘要。
 * 重點：這些都是「程式量出來的數字」——背景型態、每條參照切線的品質、越線/空格——
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
  const { analysis, cellsMeta, canvasW, canvasH } = cut;
  log.info(`背景：${bgLabel(analysis.background)}`);

  const fmt = (plan: { gutterFound: boolean[] }): string => {
    const found = plan.gutterFound.filter(Boolean).length;
    const tot = plan.gutterFound.length;
    return `${found}/${tot}`;
  };
  log.info(`參照切線對齊縫｜直：${fmt(analysis.xPlan)}｜橫：${fmt(analysis.yPlan)}（格線僅參照；內容按元件偵測，不會被切斷）`);

  const crossers = cellsMeta.filter((m) => m.outOfCell > 2);
  if (crossers.length) {
    const list = crossers.map((m) => `#${m.index + 1}(+${m.outOfCell}px)`).join(' ');
    log.info(`越出參照格線的主體已完整保留（${crossers.length}）：${list}`);
  }
  const empties = cellsMeta.filter((m) => m.empty).map((m) => `#${m.index + 1}`);
  if (empties.length) log.warn(`幾乎沒主體的空格（${empties.length}）：${empties.join(' ')}（切錯位或 char-gen 漏畫該格）`);
  if (empties.length === 0) log.info(`抽格：每格主體完整、無空格（畫布 ${canvasW}×${canvasH}）`);
  if (cut.sceneShiftMax > 0) log.info(`場景精修對齊：修正構圖漂移最大 ${cut.sceneShiftMax}px`);
  for (const w of analysis.warnings) log.warn(w);
}
