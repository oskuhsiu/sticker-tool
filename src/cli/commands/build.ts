/**
 * `sticker-tool build <inputDir>`：本機圖片 → 靜態貼圖上架包。
 */

import { STATIC_SPEC, maxBounds } from '../../core/spec.js';
import { validateCount, validatePack } from '../../core/validate.js';
import type { StrokeSpec } from '../../core/types.js';
import { processStatic } from '../../pipeline/processStatic.js';
import { buildMainTab } from '../../package/buildMainTab.js';
import { buildPack } from '../../package/buildZip.js';
import { listImages, log, reportValidation } from '../util.js';

export interface BuildOptions {
  out: string;
  count: number;
  name: string;
  removeBg: boolean;
  stroke: boolean;
  strokeWidth: number;
  strokeColor: string;
  maxSize: [number, number];
  cover: number;
}

export async function runBuild(inputDir: string, opts: BuildOptions): Promise<void> {
  // 1) 張數白名單
  const cv = validateCount('static', opts.count);
  if (!cv.ok) {
    reportValidation('張數', cv);
    process.exitCode = 1;
    return;
  }

  // 2) 收集輸入圖
  const images = await listImages(inputDir);
  if (images.length < opts.count) {
    log.err(`輸入目錄只有 ${images.length} 張圖，少於要求的 ${opts.count} 張`);
    process.exitCode = 1;
    return;
  }
  const picked = images.slice(0, opts.count);
  if (images.length > opts.count) {
    log.warn(`輸入有 ${images.length} 張，取前 ${opts.count} 張`);
  }

  const bounds = { width: opts.maxSize[0], height: opts.maxSize[1] };
  const stroke: StrokeSpec | undefined = opts.stroke
    ? { enabled: true, width: opts.strokeWidth, color: opts.strokeColor }
    : undefined;

  // 3) 逐張處理
  log.step(`處理 ${opts.count} 張靜態貼圖…`);
  const processed = [];
  for (let i = 0; i < picked.length; i++) {
    const r = await processStatic(picked[i]!, {
      bounds,
      removeBackground: opts.removeBg,
      stroke,
      maxBytes: STATIC_SPEC.maxBytes,
    });
    const note = r.notes.length ? `（${r.notes.join('；')}）` : '';
    log.info(`  ${String(i + 1).padStart(2, '0')}.png  ${r.info.width}×${r.info.height}  ${(r.info.bytes / 1024).toFixed(0)}KB ${note}`);
    processed.push(r);
  }

  // 4) main / tab（用 cover）
  const coverIdx = Math.min(Math.max(1, opts.cover), opts.count) - 1;
  const { main, tab, mainInfo, tabInfo } = await buildMainTab(processed[coverIdx]!.buffer);
  log.step(`main.png ${mainInfo.width}×${mainInfo.height}、tab.png ${tabInfo.width}×${tabInfo.height}（封面用第 ${coverIdx + 1} 張）`);

  // 5) 打包
  const result = await buildPack({
    outDir: opts.out,
    name: opts.name,
    main,
    tab,
    stickers: processed.map((p) => p.buffer),
  });
  log.ok(`已輸出 ${result.files.length} 檔到 ${result.dir}`);
  log.ok(`zip：${result.zipPath}（${(result.zipBytes / 1024).toFixed(0)}KB）`);

  // 6) 驗證整包
  const validation = validatePack({
    kind: 'static',
    count: opts.count,
    stickers: processed.map((p) => p.info),
    main: mainInfo,
    tab: tabInfo,
    zipBytes: result.zipBytes,
  });
  const ok = reportValidation('整包', validation);
  if (!ok) process.exitCode = 1;
}

/** 給 commander 用的選項預設 */
export const buildDefaults = {
  out: 'out',
  removeBg: true,
  strokeWidth: 8,
  strokeColor: '#ffffff',
  maxSize: [STATIC_SPEC.maxWidth, STATIC_SPEC.maxHeight] as [number, number],
  cover: 1,
  bounds: maxBounds('static'),
};
