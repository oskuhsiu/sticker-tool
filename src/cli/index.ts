#!/usr/bin/env node
/**
 * sticker-tool CLI 入口。
 * 子指令：
 *   build  本機圖片 → 靜態包
 *   gen    現成組圖（char-gen 產出）→ 切格 → 靜態包
 *   anim   本機連續影格（char-gen 產出）→ 動態 APNG 包
 *   prompt 只輸出產圖 prompt（mobile/半自動）
 *   init   產生範例設定檔
 * AI 產圖本身已外移給 char-gen skill；本 CLI 只做確定性的切格/處理/打包。
 */

import { Command } from 'commander';
import { runBuild, buildDefaults, type BuildOptions } from './commands/build.js';
import { runGen } from './commands/gen.js';
import { runAnim } from './commands/anim.js';
import { runPrompt } from './commands/prompt.js';
import { runInit } from './commands/init.js';
import { parseSize, log } from './util.js';

const program = new Command();
program
  .name('sticker-tool')
  .description('LINE 貼圖製作工具：原圖/AI → 去背裁切縮放 → 符合規格的上架包')
  .version('0.1.0');

const intArg = (v: string) => parseInt(v, 10);
/** 可重複選項收集器（--sheet a --sheet b → ['a','b']） */
const collect = (v: string, acc: string[]) => {
  acc.push(v);
  return acc;
};
const floatArg = (v: string) => parseFloat(v);

program
  .command('build')
  .argument('<inputDir>', '輸入圖片目錄')
  .description('本機圖片 → 靜態貼圖上架包')
  .requiredOption('-c, --count <n>', '張數（8/16/24/32/40）', intArg)
  .option('-o, --out <dir>', '輸出目錄', buildDefaults.out)
  .option('-n, --name <name>', '貼圖包名（zip 檔名）', 'My Stickers')
  .option('--no-remove-bg', '不要去背（本機來源預設會去背）')
  .option('--stroke', '加白色描邊')
  .option('--stroke-width <px>', '描邊寬度', intArg, buildDefaults.strokeWidth)
  .option('--stroke-color <hex>', '描邊顏色', buildDefaults.strokeColor)
  .option('--max-size <WxH>', '單張尺寸上限', parseSize, buildDefaults.maxSize)
  .option('--cover <n>', '用第幾張產 main/tab', intArg, buildDefaults.cover)
  .action(async (inputDir: string, raw) => {
    const opts: BuildOptions = {
      out: raw.out,
      count: raw.count,
      name: raw.name,
      removeBg: raw.removeBg !== false,
      stroke: !!raw.stroke,
      strokeWidth: raw.strokeWidth,
      strokeColor: raw.strokeColor,
      maxSize: raw.maxSize,
      cover: raw.cover,
    };
    await runBuild(inputDir, opts);
  });

program
  .command('gen')
  .description('現成組圖（char-gen 產出）→ 切格 → 靜態貼圖上架包')
  .requiredOption('--config <file>', '設定檔（YAML/JSON）')
  .option('--sheet <path>', 'char-gen 產出的組圖（可重複指定，每張版面一張）', collect, [])
  .option('-o, --out <dir>', '輸出目錄', 'out')
  .option('-c, --count <n>', '覆寫設定檔張數', intArg)
  .option('-n, --name <name>', '覆寫貼圖包名')
  .action(async (raw) => {
    await runGen({
      config: raw.config,
      sheet: raw.sheet,
      out: raw.out,
      count: raw.count,
      name: raw.name,
    });
  });

program
  .command('anim')
  .description('動態 APNG：--config 整包，或 --sheet+--grid 把單張組圖做成一段動畫')
  .option('--config <file>', '設定檔（YAML/JSON）；整包模式必填')
  .option('--sheet <path>', '單組圖模式：一張 frames-sheet（相對 CWD）')
  .option('--grid <RxC>', '單組圖模式：影格網格，如 4x4')
  .option('--frames <n>', '單組圖模式：取前 N 格（預設＝grid 全部）', intArg)
  .option('--duration <sec>', '單組圖模式：總時長秒（覆寫）', floatArg)
  .option('--loops <n>', '循環次數 1–4（覆寫）', intArg)
  .option('--dump-frames', '單組圖模式：把切出的逐格影格落地成 <out>/<name>_frames/frame_NN.png（除錯/量測用）')
  .option('--dump-cells', '單組圖模式：把「未經 fit 縮放」的原始切格落地成 <out>/<name>_cells/cell_NN.png（除錯/量測用）')
  .option('-o, --out <dir>', '輸出目錄', 'out')
  .option('-c, --count <n>', '覆寫張數（整包 8/16/24）', intArg)
  .option('-n, --name <name>', '輸出檔名（單組圖）/包名（整包）')
  .action(async (raw) => {
    await runAnim({
      config: raw.config,
      sheet: raw.sheet,
      grid: raw.grid,
      frames: raw.frames,
      duration: raw.duration,
      loops: raw.loops,
      dumpFrames: raw.dumpFrames,
      dumpCells: raw.dumpCells,
      out: raw.out,
      count: raw.count,
      name: raw.name,
    });
  });

program
  .command('prompt')
  .description('只輸出產圖 prompt（mobile/半自動，不呼叫 codex）')
  .requiredOption('--config <file>', '設定檔（YAML/JSON）')
  .option('-c, --count <n>', '覆寫設定檔張數', intArg)
  .action(async (raw) => {
    await runPrompt({ config: raw.config, count: raw.count });
  });

program
  .command('init')
  .description('產生範例設定檔')
  .option('-o, --out <file>', '輸出路徑', 'sticker.config.yaml')
  .option('--force', '覆寫既有檔')
  .action(async (raw) => {
    await runInit({ out: raw.out, force: !!raw.force });
  });

program.parseAsync(process.argv).catch((e: unknown) => {
  log.err(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
