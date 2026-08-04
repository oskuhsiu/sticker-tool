/**
 * `sticker-tool gen --config <file> --sheet <組圖.png>`：把「現成組圖」切格 → 處理 → 靜態上架包。
 *
 * 產圖本身不在這裡——交由 char-gen skill（codex 內建 image_gen）完成；本指令只做確定性的
 * 切格 / 去背 / fit / 疊字 / 打包（分工見 .claude/skills/char-gen：skill 畫圖、sticker-tool 打包）。
 * 角色一致性靠 char-gen 的「單張組圖、餵回同一張參照圖」保證；本指令只負責把那張組圖拆好包好。
 */

import path from 'node:path';
import { existsSync } from 'node:fs';
import { planGrid } from '../../core/grid.js';
import { emojiFileName, emojiPackManifest } from '../../core/naming.js';
import { EMOJI_SPEC } from '../../core/spec.js';
import type { GridLayout, PackConfig } from '../../core/types.js';
import { validateCount, validateEmojiPack, validatePack } from '../../core/validate.js';
import { cutSheet } from '../../pipeline/sheetAnalysis.js';
import { reportCut } from '../cutReport.js';
import { inspectStaticPng, processStatic } from '../../pipeline/processStatic.js';
import { buildMainTab, buildTab } from '../../package/buildMainTab.js';
import { buildEmojiPack } from '../../package/buildEmojiZip.js';
import { buildPack } from '../../package/buildZip.js';
import { loadConfig, resolveRelative } from '../../config/load.js';
import { log, reportValidation } from '../util.js';

export interface GenOptions {
  config: string;
  /** 一或多張現成組圖（char-gen 產出）；張數須等於版面 sheets 數 */
  sheet: string[];
  out?: string;
  /** 覆寫 config.package.count（CLI > config，I-10 #2） */
  count?: number;
  name?: string;
}

/** 套用 config.ai.grid 覆寫（僅單張組圖時）；驗證容量足夠 */
function applyGridOverride(layout: GridLayout, cfg: PackConfig): GridLayout {
  const g = cfg.ai.grid;
  if (g === 'auto' || layout.sheets !== 1) return layout;
  if (g.cols * g.rows < layout.count) {
    log.warn(`設定的 grid ${g.cols}×${g.rows} 容不下 ${layout.count} 張，改用自動版面`);
    return layout;
  }
  return { ...layout, cols: g.cols, rows: g.rows };
}

export async function runGen(opts: GenOptions): Promise<void> {
  const cfg = await loadConfig(opts.config);
  if (opts.count !== undefined) cfg.count = opts.count;
  if (opts.name) cfg.name = opts.name;
  const outDir = opts.out ?? 'out';

  if (cfg.kind === 'animated' || cfg.kind === 'animated-emoji') {
    log.err(`動態包請用 anim 指令；gen 僅處理靜態。`);
    process.exitCode = 1;
    return;
  }
  if (!reportValidation('張數', validateCount(cfg.kind, cfg.count))) {
    process.exitCode = 1;
    return;
  }
  const isEmoji = cfg.kind === 'emoji';

  // --sheet 是 CLI 路徑參數 → 相對 CWD 解析（與 --out/--config 一致；非 config 內宣告路徑）
  const sheets = (opts.sheet ?? []).map((s) => path.resolve(s));
  if (sheets.length === 0) {
    log.err(`請用 --sheet 指定 char-gen 產出的組圖（可重複指定多張）。`);
    process.exitCode = 1;
    return;
  }
  for (const s of sheets) {
    if (!existsSync(s)) {
      log.err(`找不到組圖：${s}`);
      process.exitCode = 1;
      return;
    }
  }

  // 1) 版面決策（取 cols/rows/sheets 供切格）。產圖已外移給 char-gen，故 blocked 僅警告、不再擋下。
  const decision = planGrid(cfg.count, {
    isCharacter: cfg.ai.isCharacter,
    forceOversizeSet: cfg.ai.forceOversizeSet,
  });
  for (const w of decision.warnings) log.warn(w);
  if (decision.blocked) {
    log.warn(
      decision.blockReason ??
        '張數超出角色一致性建議範圍；產圖已由 char-gen 處理，仍繼續打包。',
    );
  }
  const layout = applyGridOverride(decision.layout, cfg);

  if (sheets.length !== layout.sheets) {
    log.err(`版面需要 ${layout.sheets} 張組圖，但 --sheet 給了 ${sheets.length} 張。`);
    process.exitCode = 1;
    return;
  }

  // 2) 逐張組圖切格（cutSheet：偵測背景→去背→元件式抽格（格線僅參照、越線不切斷）→ 各自置中）
  const cells: Buffer[] = [];
  for (let s = 0; s < layout.sheets; s++) {
    const remaining = cfg.count - s * layout.cellsPerSheet;
    const thisCount = Math.min(layout.cellsPerSheet, remaining);
    log.step(
      `切格 ${s + 1}/${layout.sheets}（${layout.cols}×${layout.rows}，${thisCount} 格）← ${path.basename(sheets[s]!)}`,
    );
    const cut = await cutSheet(sheets[s]!, { cols: layout.cols, rows: layout.rows, count: thisCount });
    reportCut(cut);
    cells.push(...cut.cells);
  }
  log.ok(`共切出 ${cells.length} 格`);

  // 3) 逐格處理（cutSheet 已整張去背 → 下游不重複去背，除非 config 明確要求 true）
  const bounds = { width: cfg.processing.maxSize[0], height: cfg.processing.maxSize[1] };
  const forceRembg = cfg.processing.removeBackground === true;
  const processed = [];
  for (let i = 0; i < cells.length; i++) {
    const item = cfg.stickers[i];
    const filename = isEmoji
      ? emojiFileName(i + 1)
      : `${String(i + 1).padStart(2, '0')}.png`;
    const r = await processStatic(cells[i]!, {
      bounds,
      removeBackground: forceRembg ? true : false,
      stroke: cfg.processing.stroke.enabled ? cfg.processing.stroke : undefined,
      text: item?.text
        ? { ...item.text, font: resolveRelative(opts.config, item.text.font) }
        : undefined,
      maxBytes: isEmoji ? EMOJI_SPEC.maxBytes : undefined,
      marginPx: isEmoji ? 0 : undefined,
      canvasMode: isEmoji ? 'exact' : undefined,
      trimInput: isEmoji ? true : undefined,
      forbidPalette: true,
    });
    if (isEmoji) r.info.filename = filename;
    const note = r.notes.length ? `（${r.notes.join('；')}）` : '';
    log.info(`  ${filename}  ${r.info.width}×${r.info.height}  ${(r.info.bytes / 1024).toFixed(0)}KB ${note}`);
    processed.push(r);
  }

  // 4) support image + 打包
  const coverIdx = Math.min(Math.max(1, cfg.cover), cfg.count) - 1;
  if (isEmoji) {
    const { tab } = await buildTab(processed[coverIdx]!.buffer);
    const tabInfo = await inspectStaticPng(tab, 'tab.png');
    const archivePaths = emojiPackManifest(cfg.count);
    const preflight = validateEmojiPack({
      kind: 'emoji',
      count: cfg.count,
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
      outDir,
      name: cfg.name,
      kind: 'emoji',
      tab,
      items: processed.map((item) => item.buffer),
    });
    const validation = validateEmojiPack({
      kind: 'emoji',
      count: cfg.count,
      items: processed.map((item) => item.info),
      tab: tabInfo,
      archivePaths: result.files,
      zipBytes: result.zipBytes,
    });
    if (!reportValidation('整包', validation)) {
      process.exitCode = 1;
      return;
    }
    log.ok(`已輸出 ${result.files.length} 檔到 ${result.dir}`);
    log.ok(`zip：${result.zipPath}（${(result.zipBytes / 1024).toFixed(0)}KB）`);
    return;
  }

  const { main, tab, mainInfo, tabInfo } = await buildMainTab(processed[coverIdx]!.buffer);
  const result = await buildPack({
    outDir,
    name: cfg.name,
    main,
    tab,
    stickers: processed.map((p) => p.buffer),
  });
  log.ok(`已輸出 ${result.files.length} 檔到 ${result.dir}`);
  log.ok(`zip：${result.zipPath}（${(result.zipBytes / 1024).toFixed(0)}KB）`);

  // 5) 驗證
  const validation = validatePack({
    kind: 'static',
    count: cfg.count,
    stickers: processed.map((p) => p.info),
    main: mainInfo,
    tab: tabInfo,
    zipBytes: result.zipBytes,
  });
  if (!reportValidation('整包', validation)) process.exitCode = 1;
}
