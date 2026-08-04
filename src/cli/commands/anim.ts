/**
 * `sticker-tool anim`：連續影格 → 動態貼圖（APNG）。兩種模式：
 *
 *   整包模式  `anim --config <file>`
 *     config 的 stickers[].frames（本機影格路徑，char-gen 產出）→ 8/16/24 張動態貼圖上架包。
 *
 *   單組圖模式 `anim --sheet <組圖> --grid 4x4 [--frames N --duration 2 --loops 1]`
 *     把「一張 frames-sheet」（char-gen 的單段動作組圖）元件式抽格（格線僅參照）→
 *     按原圖格線對齊（場景固定）→ fit → 一段動畫 APNG。
 *
 * 整包模式走 processAnimated 的確定性管線：去背 → 主體穩定化（殺漂移）→ fit → APNG；
 * 單組圖模式抽格時已對齊 → 跳過錨點穩定化（錨點平移會把場景物件推出畫布）。
 */

import path from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { ANIMATED_EMOJI_SPEC, isEmojiKind, maxBounds } from '../../core/spec.js';
import { emojiFileName, emojiPackManifest } from '../../core/naming.js';
import type { AnimationConfig, Bounds, RemoveBgMode } from '../../core/types.js';
import {
  validateAnimatedEmojiImage,
  validateAnimatedImage,
  validateCount,
  validateEmojiPack,
  validatePack,
} from '../../core/validate.js';
import { cutSheet } from '../../pipeline/sheetAnalysis.js';
import { reportCut } from '../cutReport.js';
import { processAnimated, type ProcessedAnimated } from '../../pipeline/processAnimated.js';
import { inspectStaticPng } from '../../pipeline/processStatic.js';
import { buildAnimatedMain, buildTab } from '../../package/buildMainTab.js';
import { buildEmojiPack } from '../../package/buildEmojiZip.js';
import { buildPack } from '../../package/buildZip.js';
import { loadConfig, resolveRelative } from '../../config/load.js';
import { AnimationSchema, type PackageProduct } from '../../config/schema.js';
import { log, reportValidation } from '../util.js';

export interface AnimOptions {
  config?: string;
  out?: string;
  count?: number;
  name?: string;
  /** 單組圖模式：一張 frames-sheet（相對 CWD） */
  sheet?: string;
  /** 單組圖模式：影格網格 "RxC"，如 "4x4" */
  grid?: string;
  /** 單組圖模式：取前 N 格（預設 = grid 全部） */
  frames?: number;
  /** 單組圖模式：總時長（秒），覆寫 durationSec */
  duration?: number;
  /** 循環次數 1–4（覆寫） */
  loops?: number;
  /** 單組圖模式：把切出的逐格影格（fit 後，與 APNG 一致）落地（除錯/量測用） */
  dumpFrames?: boolean;
  /** 單組圖模式：把未經 fit 縮放的原始切格落地（除錯/量測用） */
  dumpCells?: boolean;
  /** 單組圖模式的輸出產品；整包模式由 config.package.product 決定。 */
  product?: PackageProduct;
}

function parseGrid(s: string): { cols: number; rows: number } {
  const m = /^(\d+)\s*[xX×]\s*(\d+)$/.exec(s);
  if (!m) throw new Error(`--grid 格式須為 "4x4"，得到「${s}」`);
  return { cols: Number(m[1]), rows: Number(m[2]) };
}

/** 單組圖模式：一張 frames-sheet → 一段動畫 APNG */
async function runSingleSheet(opts: AnimOptions, outDir: string): Promise<void> {
  if (!opts.grid) {
    log.err('單組圖模式需要 --grid（如 4x4）');
    process.exitCode = 1;
    return;
  }
  const sheetPath = path.resolve(opts.sheet!);
  if (!existsSync(sheetPath)) {
    log.err(`找不到組圖：${sheetPath}`);
    process.exitCode = 1;
    return;
  }
  const { cols, rows } = parseGrid(opts.grid);
  const count = opts.frames ?? cols * rows;

  // 動畫設定：有 --config 用其 animation/removeBackground，否則用 schema 預設；--duration/--loops 覆寫
  let animation: AnimationConfig;
  let removeBg: RemoveBgMode = false;
  let product: PackageProduct = opts.product ?? 'sticker';
  if (product !== 'sticker' && product !== 'emoji') {
    throw new Error(`--product 只能是 sticker 或 emoji，收到「${String(product)}」`);
  }
  if (opts.config) {
    const cfg = await loadConfig(opts.config);
    const configProduct: PackageProduct = isEmojiKind(cfg.kind) ? 'emoji' : 'sticker';
    if (opts.product !== undefined && opts.product !== configProduct) {
      log.err(
        `--product ${opts.product} 與設定檔 package.product=${configProduct} 衝突；不會靜默覆寫`,
      );
      process.exitCode = 1;
      return;
    }
    product = configProduct;
    animation = cfg.animation;
    removeBg = cfg.processing.removeBackground;
  } else {
    animation = AnimationSchema.parse({});
    if (product === 'emoji') {
      animation = {
        ...animation,
        maxBytes: ANIMATED_EMOJI_SPEC.maxBytes,
        autoFit: false,
      };
    }
  }
  if (opts.duration !== undefined) animation = { ...animation, durationSec: opts.duration };
  if (opts.loops !== undefined) animation = { ...animation, loops: opts.loops };

  const kind = product === 'emoji' ? 'animated-emoji' : 'animated';
  if (
    kind === 'animated-emoji' &&
    (count < ANIMATED_EMOJI_SPEC.minFrames || count > ANIMATED_EMOJI_SPEC.maxFrames)
  ) {
    log.err(
      `Animated Emoji 影格數須為 ${ANIMATED_EMOJI_SPEC.minFrames}–${ANIMATED_EMOJI_SPEC.maxFrames}，收到 ${count}；不會自動減格`,
    );
    process.exitCode = 1;
    return;
  }

  log.step(`切格 ${cols}×${rows}（取前 ${count} 格）← ${path.basename(sheetPath)}`);
  // cutSheet：偵測背景→去背→元件式抽格（格線僅參照、逐格偵測實際範圍、越線不切斷）
  // align 'grid'：按原圖等分格座標對齊放置——AI 構圖時場景在每格內位置一致，保留此座標系動畫就不閃
  const cut = await cutSheet(sheetPath, { cols, rows, count, align: 'grid' });
  reportCut(cut);
  // 切出的格已去背 → 下游不重複去背（除非 config 明確要求 true）
  const frames = cut.cells;
  // grid 對齊已把場景固定 → 關掉頭錨點穩定化（錨點平移會把場景物件推出畫布）
  animation = { ...animation, stabilize: { ...animation.stabilize, enabled: false } };
  log.info('影格已按原圖格線對齊（場景固定）→ 跳過錨點穩定化');

  const proc = await processAnimated(frames, {
    bounds: maxBounds(kind),
    removeBackground: removeBg === true ? true : false,
    animation,
    limits: kind === 'animated-emoji'
      ? {
          minFrames: ANIMATED_EMOJI_SPEC.minFrames,
          maxFrames: ANIMATED_EMOJI_SPEC.maxFrames,
          maxDurationSec: ANIMATED_EMOJI_SPEC.maxDurationSec,
          playbackDurationsSec: ANIMATED_EMOJI_SPEC.playbackDurationsSec,
          label: 'Animated Emoji',
        }
      : undefined,
    requireConsistentFrameSize: kind === 'animated-emoji',
    trimTransparentPadding: kind === 'animated-emoji',
    marginPx: 0,
    preserveFrames: kind === 'animated-emoji',
    forbidPalette: kind === 'animated-emoji',
  });
  for (const n of proc.notes) log.info(`  ${n}`);

  const validation = kind === 'animated-emoji'
    ? validateAnimatedEmojiImage(proc.info)
    : validateAnimatedImage(proc.info);
  if (kind === 'animated-emoji' && !reportValidation('動畫', validation)) {
    process.exitCode = 1;
    return;
  }

  await mkdir(outDir, { recursive: true });
  const name = opts.name ?? (kind === 'animated-emoji' ? '001' : 'anim');
  const outPath = path.join(outDir, `${name}.png`);
  await writeFile(outPath, proc.buffer);
  log.ok(
    `動畫 APNG：${outPath}  ${proc.info.width}×${proc.info.height}  ${proc.info.frames}格×${proc.info.loops}loop  ${(proc.info.bytes / 1024).toFixed(0)}KB`,
  );

  // --dump-cells：把「未經 fit 縮放」的原始切格（cut.cells，畫布 canvasW×canvasH、已去背）落地
  if (opts.dumpCells) {
    const cellsDir = path.join(outDir, `${name}_cells`);
    await mkdir(cellsDir, { recursive: true });
    await Promise.all(
      cut.cells.map((buf, i) =>
        writeFile(path.join(cellsDir, `cell_${String(i + 1).padStart(2, '0')}.png`), buf),
      ),
    );
    log.info(
      `原始切格已落地（${cut.cells.length} 格，每格 ${cut.canvasW}×${cut.canvasH}，未 fit 縮放）→ ${cellsDir}/cell_NN.png`,
    );
  }

  // --dump-frames：把 APNG 內的逐格（已切格＋去背＋fit）落地，方便逐格量測/查鬼影，不必反拆 APNG
  if (opts.dumpFrames) {
    const framesDir = path.join(outDir, `${name}_frames`);
    await mkdir(framesDir, { recursive: true });
    await Promise.all(
      proc.fittedFrames.map((buf, i) =>
        writeFile(path.join(framesDir, `frame_${String(i + 1).padStart(2, '0')}.png`), buf),
      ),
    );
    log.info(
      `逐格影格已落地（${proc.fittedFrames.length} 格，每格 ${proc.info.width}×${proc.info.height}）→ ${framesDir}/frame_NN.png`,
    );
  }

  if (kind === 'animated' && !reportValidation('動畫', validation)) process.exitCode = 1;
}

/** 整包模式：config 的 stickers[].frames → 動態貼圖上架包 */
async function runPack(opts: AnimOptions, outDir: string): Promise<void> {
  const cfg = await loadConfig(opts.config!);
  if (opts.count !== undefined) cfg.count = opts.count;
  if (opts.name) cfg.name = opts.name;

  if (cfg.kind !== 'animated' && cfg.kind !== 'animated-emoji') {
    log.err('整包 anim 模式需要動態設定；請設 package.animated=true 或提供 stickers[].frames');
    process.exitCode = 1;
    return;
  }
  const isEmoji = cfg.kind === 'animated-emoji';

  const cv = validateCount(cfg.kind, cfg.count);
  if (!reportValidation('張數', cv)) {
    process.exitCode = 1;
    return;
  }

  const bounds: Bounds = maxBounds(cfg.kind);
  const processedList: ProcessedAnimated[] = [];
  for (let i = 0; i < cfg.count; i++) {
    const item = cfg.stickers[i];
    if (!item?.frames || item.frames.length === 0) {
      log.err(
        `第 ${i + 1} 張：缺少 frames（請在 config 的 stickers[${i}].frames 指定 char-gen 產出的影格路徑）`,
      );
      process.exitCode = 1;
      return;
    }
    if (
      isEmoji &&
      (item.frames.length < ANIMATED_EMOJI_SPEC.minFrames ||
        item.frames.length > ANIMATED_EMOJI_SPEC.maxFrames)
    ) {
      log.err(
        `第 ${i + 1} 張 Animated Emoji 影格數須為 ${ANIMATED_EMOJI_SPEC.minFrames}–${ANIMATED_EMOJI_SPEC.maxFrames}，收到 ${item.frames.length}；不會自動減格`,
      );
      process.exitCode = 1;
      return;
    }
    const frames = item.frames.map((f) => resolveRelative(opts.config!, f));

    const proc = await processAnimated(frames, {
      bounds,
      removeBackground: cfg.processing.removeBackground,
      stroke: cfg.processing.stroke.enabled ? cfg.processing.stroke : undefined,
      text: item.text ? { ...item.text, font: resolveRelative(opts.config!, item.text.font) } : undefined,
      animation: cfg.animation,
      fps: item.fps,
      limits: isEmoji
        ? {
            minFrames: ANIMATED_EMOJI_SPEC.minFrames,
            maxFrames: ANIMATED_EMOJI_SPEC.maxFrames,
            maxDurationSec: ANIMATED_EMOJI_SPEC.maxDurationSec,
            playbackDurationsSec: ANIMATED_EMOJI_SPEC.playbackDurationsSec,
            label: 'Animated Emoji',
          }
        : undefined,
      requireConsistentFrameSize: isEmoji,
      trimTransparentPadding: isEmoji,
      marginPx: isEmoji && cfg.processing.stroke.enabled ? cfg.processing.stroke.width : 0,
      preserveFrames: isEmoji,
      forbidPalette: isEmoji,
    });
    const filename = isEmoji
      ? emojiFileName(i + 1)
      : `${String(i + 1).padStart(2, '0')}.png`;
    if (isEmoji) proc.info.filename = filename;
    const note = proc.notes.length ? `（${proc.notes.join('；')}）` : '';
    log.info(
      `  ${filename}  ${proc.info.width}×${proc.info.height}  ${proc.info.frames}格×${proc.info.loops}loop  ${(proc.info.bytes / 1024).toFixed(0)}KB ${note}`,
    );
    processedList.push(proc);
  }

  // Sticker: animated main + tab. Emoji: tab only.
  const coverIdx = Math.min(Math.max(1, cfg.cover), cfg.count) - 1;
  const cover = processedList[coverIdx]!;
  if (isEmoji) {
    const { tab } = await buildTab(cover.fittedFrames[0]!);
    const tabInfo = await inspectStaticPng(tab, 'tab.png');
    const archivePaths = emojiPackManifest(cfg.count);
    const preflight = validateEmojiPack({
      kind: 'animated-emoji',
      count: cfg.count,
      items: processedList.map((item) => item.info),
      tab: tabInfo,
      archivePaths,
    });
    if (!preflight.ok) {
      reportValidation('Animated Emoji 預檢', preflight);
      process.exitCode = 1;
      return;
    }

    const result = await buildEmojiPack({
      outDir,
      name: cfg.name,
      kind: 'animated-emoji',
      tab,
      items: processedList.map((item) => item.buffer),
    });
    const validation = validateEmojiPack({
      kind: 'animated-emoji',
      count: cfg.count,
      items: processedList.map((item) => item.info),
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

  const { main, mainInfo } = await buildAnimatedMain(cover.fittedFrames, cfg.animation);
  const { tab, tabInfo } = await buildTab(cover.fittedFrames[0]!);
  log.step(`main.png（APNG）${mainInfo.width}×${mainInfo.height} ${mainInfo.frames}格、tab.png ${tabInfo.width}×${tabInfo.height}`);

  const result = await buildPack({
    outDir,
    name: cfg.name,
    main,
    tab,
    stickers: processedList.map((p) => p.buffer),
  });
  log.ok(`已輸出 ${result.files.length} 檔到 ${result.dir}`);
  log.ok(`zip：${result.zipPath}（${(result.zipBytes / 1024).toFixed(0)}KB）`);

  const validation = validatePack({
    kind: 'animated',
    count: cfg.count,
    stickers: processedList.map((p) => p.info),
    main: mainInfo,
    tab: tabInfo,
    zipBytes: result.zipBytes,
  });
  if (!reportValidation('整包', validation)) process.exitCode = 1;
}

export async function runAnim(opts: AnimOptions): Promise<void> {
  const outDir = opts.out ?? 'out';
  if (opts.sheet) return runSingleSheet(opts, outDir);
  if (!opts.config) {
    log.err('整包模式需要 --config（或用 --sheet + --grid 把單張組圖做成一段動畫）');
    process.exitCode = 1;
    return;
  }
  return runPack(opts, outDir);
}
