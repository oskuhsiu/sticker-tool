/**
 * `sticker-tool prompt --config <file>`：只輸出產圖 prompt，不呼叫 codex。
 * 給 mobile（不直接生圖，只產 prompt 給使用者貼到外部工具）或半自動流程使用。
 */

import { planGrid } from '../../core/grid.js';
import { isEmojiKind } from '../../core/spec.js';
import type { GridLayout } from '../../core/types.js';
import { buildSheetPrompt } from '../../core/prompt.js';
import { validateCount } from '../../core/validate.js';
import { loadConfig } from '../../config/load.js';
import { log, reportValidation } from '../util.js';

export interface PromptOptions {
  config: string;
  count?: number;
}

export async function runPrompt(opts: PromptOptions): Promise<void> {
  const cfg = await loadConfig(opts.config);
  if (opts.count !== undefined) cfg.count = opts.count;

  const countValidation = validateCount(cfg.kind, cfg.count);
  if (!countValidation.ok) {
    reportValidation('張數', countValidation);
    process.exitCode = 1;
    return;
  }

  const decision = planGrid(cfg.count, {
    isCharacter: cfg.ai.isCharacter,
    forceOversizeSet: cfg.ai.forceOversizeSet,
  });
  for (const w of decision.warnings) log.warn(w);
  if (decision.blocked) {
    log.err(decision.blockReason ?? '張數配置被擋下');
    process.exitCode = 1;
    return;
  }
  const layout = decision.layout;

  // 多張大圖 → 印出每張的 prompt
  for (let s = 0; s < layout.sheets; s++) {
    const remaining = cfg.count - s * layout.cellsPerSheet;
    const thisCount = Math.min(layout.cellsPerSheet, remaining);
    const sheetLayout: GridLayout = {
      count: thisCount,
      cols: layout.cols,
      rows: layout.rows,
      sheets: 1,
      cellsPerSheet: thisCount,
    };
    const prompt = buildSheetPrompt({
      style: cfg.ai.style,
      layout: sheetLayout,
      isCharacter: cfg.ai.isCharacter,
      transparent: cfg.ai.transparent,
      cellVariations: cfg.ai.cellVariations,
      hasReference: !!cfg.ai.reference,
      product: isEmojiKind(cfg.kind) ? 'emoji' : 'sticker',
    });
    if (layout.sheets > 1) console.log(`\n===== 大圖 ${s + 1}/${layout.sheets} =====`);
    console.log(prompt);
  }
}
