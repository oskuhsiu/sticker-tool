/**
 * `sticker-tool build <inputDir>`：本機圖片 → 靜態貼圖上架包。
 */

import { EMOJI_SPEC, STATIC_SPEC, maxBounds } from '../../core/spec.js';
import { emojiFileName, emojiPackManifest } from '../../core/naming.js';
import { validateCount, validateEmojiPack, validatePack } from '../../core/validate.js';
import type { StrokeSpec } from '../../core/types.js';
import type { PackageProduct } from '../../config/schema.js';
import { inspectStaticPng, processStatic } from '../../pipeline/processStatic.js';
import { buildMainTab, buildTab } from '../../package/buildMainTab.js';
import { buildEmojiPack } from '../../package/buildEmojiZip.js';
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
  maxSize?: [number, number];
  cover: number;
  product?: PackageProduct;
}

export async function runBuild(inputDir: string, opts: BuildOptions): Promise<void> {
  const product = opts.product ?? 'sticker';
  if (product !== 'sticker' && product !== 'emoji') {
    throw new Error(`--product 只能是 sticker 或 emoji，收到「${String(product)}」`);
  }
  const kind = product === 'emoji' ? 'emoji' : 'static';
  if (
    kind === 'emoji' &&
    opts.maxSize !== undefined &&
    (opts.maxSize[0] !== EMOJI_SPEC.width || opts.maxSize[1] !== EMOJI_SPEC.height)
  ) {
    throw new Error(
      `Emoji 輸出畫布固定為 ${EMOJI_SPEC.width}×${EMOJI_SPEC.height}；不可指定其他 --max-size`,
    );
  }

  // 1) 張數白名單
  const cv = validateCount(kind, opts.count);
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

  const selectedSize = opts.maxSize ?? (
    kind === 'emoji'
      ? [EMOJI_SPEC.width, EMOJI_SPEC.height] as [number, number]
      : [STATIC_SPEC.maxWidth, STATIC_SPEC.maxHeight] as [number, number]
  );
  const bounds = { width: selectedSize[0], height: selectedSize[1] };
  const stroke: StrokeSpec | undefined = opts.stroke
    ? { enabled: true, width: opts.strokeWidth, color: opts.strokeColor }
    : undefined;

  // 3) 逐張處理
  log.step(`處理 ${opts.count} 張${kind === 'emoji' ? ' Regular Emoji' : '靜態貼圖'}…`);
  const processed = [];
  for (let i = 0; i < picked.length; i++) {
    const filename = kind === 'emoji'
      ? emojiFileName(i + 1)
      : `${String(i + 1).padStart(2, '0')}.png`;
    const r = await processStatic(picked[i]!, {
      bounds,
      removeBackground: opts.removeBg,
      stroke,
      maxBytes: kind === 'emoji' ? EMOJI_SPEC.maxBytes : STATIC_SPEC.maxBytes,
      marginPx: kind === 'emoji' ? 0 : undefined,
      canvasMode: kind === 'emoji' ? 'exact' : undefined,
      trimInput: kind === 'emoji' ? true : undefined,
      forbidPalette: kind === 'emoji',
    });
    if (kind === 'emoji') r.info.filename = filename;
    const note = r.notes.length ? `（${r.notes.join('；')}）` : '';
    log.info(`  ${filename}  ${r.info.width}×${r.info.height}  ${(r.info.bytes / 1024).toFixed(0)}KB ${note}`);
    processed.push(r);
  }

  // 4) support image（Sticker: main+tab；Emoji: tab only）
  const coverIdx = Math.min(Math.max(1, opts.cover), opts.count) - 1;
  if (kind === 'emoji') {
    const { tab } = await buildTab(processed[coverIdx]!.buffer);
    const tabInfo = await inspectStaticPng(tab, 'tab.png');
    log.step(`tab.png ${tabInfo.width}×${tabInfo.height}（縮圖來源用第 ${coverIdx + 1} 張）`);

    const archivePaths = emojiPackManifest(opts.count);
    const preflight = validateEmojiPack({
      kind,
      count: opts.count,
      items: processed.map((item) => item.info),
      tab: tabInfo,
      archivePaths,
    });
    if (!preflight.ok) {
      reportValidation('Emoji 預檢', preflight);
      process.exitCode = 1;
      return;
    }

    const result = await buildEmojiPack({
      outDir: opts.out,
      name: opts.name,
      kind,
      tab,
      items: processed.map((item) => item.buffer),
    });
    const validation = validateEmojiPack({
      kind,
      count: opts.count,
      items: processed.map((item) => item.info),
      tab: tabInfo,
      archivePaths: result.files,
      zipBytes: result.zipBytes,
    });
    const ok = reportValidation('整包', validation);
    if (!ok) {
      process.exitCode = 1;
      return;
    }
    log.ok(`已輸出 ${result.files.length} 檔到 ${result.dir}`);
    log.ok(`zip：${result.zipPath}（${(result.zipBytes / 1024).toFixed(0)}KB）`);
    return;
  }

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
  product: 'sticker' as PackageProduct,
  bounds: maxBounds('static'),
};
