/**
 * `sticker-tool init`：產生範例 sticker.config.yaml。
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { PackageProduct } from '../../config/schema.js';
import { log } from '../util.js';

/** 範例設定檔內容（單一來源；examples/sticker.config.yaml 同此內容） */
export const EXAMPLE_CONFIG = `# sticker-tool 設定檔範例
# 用法（AI 產圖兩步走）：
#   1) 用 char-gen skill 產一張透明組圖（如 out/_sheets/sheet_01.png）
#   2) sticker-tool gen --config sticker.config.yaml --sheet out/_sheets/sheet_01.png --out out
#   整段流程可交給 line-sticker-pack skill 指揮。
#   sticker-tool prompt --config sticker.config.yaml   # 只輸出 prompt（mobile/半自動）

package:
  name: "My Stickers"
  # product: sticker            # 省略時仍為 sticker；Emoji 請用 product: emoji + emojiSet: regular
  # emojiSet: regular           # 僅 product: emoji 可用
  count: 8                    # 8/16/24/32/40（動態僅 8/16/24）；角色包 8 最佳、16 會警告、≥24 需 forceOversizeSet
  # animated: false           # 設 true 為動態包（或在 stickers 用 frames 觸發）

source: ai                    # ai（char-gen 產圖，再 gen --sheet 打包）| local（本機圖片，改用 build）

ai:
  style: "flat cartoon, bold black outline, soft pastel palette, simple shapes"
  transparent: true           # 請產圖時直接輸出透明背景 PNG
  isCharacter: true           # 角色包→強制單張組圖、單次產完（保證同一人）
  grid: auto                  # auto（由張數決定）或 "4x2"
  # reference: ref.png        # 選填：角色/風格參考圖（相對本檔路徑）
  crop: equal                 # equal | equal+rembg（產圖非全透明時補去背）
  forceOversizeSet: false     # 角色包 >16 張時須設 true 才允許（接受降質）
  # cellVariations:           # 選填：逐格表情/姿勢（不足自動補通用情緒）
  #   - "happy waving hello"
  #   - "crying with big tears"

processing:
  # removeBackground: auto    # 省略時：local→true、ai→false；auto=偵測殘留才補刀
  stroke:
    enabled: true             # 白色描邊
    width: 8
    color: "#ffffff"
  # maxSize: [370, 320]       # 省略時用該類型規格上限

cover: 1                      # 用第幾張產 main/tab

# 動態貼圖設定（kind=animated 時生效）
animation:
  maxBytes: 1000000           # LINE 動態單檔 ≤1MB
  loops: 1                    # 循環 1–4（不可無限）
  durationSec: 2              # 總播放 ≤4 秒
  autoFit: true               # 超標自動減色至達標
  priority: balanced          # colors | frames | balanced
  minColors: 16
  minFrames: 5
  ladder: auto

# local 來源或逐張覆寫（文字疊加）時使用：
# stickers:
#   - input: cat01.png
#     text: { content: "嗨", x: 50, y: 88, size: 40, color: "#000", font: "/path/NotoSansTC-Bold.otf" }
#   - frames: [wave1.png, wave2.png, wave3.png]   # 有 frames → 動態 APNG
#     fps: 10
`;

/** `sticker-tool init --product emoji` 的 V1 Regular Emoji 範例。 */
export const EXAMPLE_EMOJI_CONFIG = `# sticker-tool Regular Emoji 設定檔範例
# 靜態：sticker-tool gen --config emoji.config.yaml --sheet sheet.png --out out
# 動態：取消 animated 註解、為每個 stickers[].frames 提供 5–20 格，再執行 anim --config

package:
  name: "My Emoji"
  product: emoji
  emojiSet: regular
  count: 8                    # Regular Emoji 可為 8–40 的任一整數
  # animated: true            # Animated Regular Emoji

source: ai

ai:
  style: "bold chat emoji, thick dark outline, high contrast, simple shapes"
  transparent: true
  isCharacter: true
  grid: auto
  crop: equal
  forceOversizeSet: false

processing:
  # maxSize: [180, 180]       # 可省略；Emoji 固定 180×180，其他值會被拒絕
  stroke:
    enabled: true
    width: 6
    color: "#ffffff"

cover: 1                     # 僅用來產 tab.png；Emoji 不上傳 main.png

animation:
  maxBytes: 300000           # Animated Emoji 單檔不得超過 300KB
  loops: 1
  durationSec: 2             # 單輪只能 1/2/3/4 秒，乘 loops 後不得超過 4 秒
  autoFit: false              # 預設保留原色；確認可接受後才改 true 啟用色階搜尋
  priority: colors
  minColors: 16
  minFrames: 5
  ladder: auto

# Animated Emoji 整包範例（需為 count 中的每一項提供 frames）：
# stickers:
#   - frames: [wave01.png, wave02.png, wave03.png, wave04.png, wave05.png]
#     motion: "friendly wave; first frame already reads as hello"
`;

export interface InitOptions {
  out: string;
  force?: boolean;
  product?: PackageProduct;
}

export async function runInit(opts: InitOptions): Promise<void> {
  const product = opts.product ?? 'sticker';
  if (product !== 'sticker' && product !== 'emoji') {
    throw new Error(`--product 只能是 sticker 或 emoji，收到「${String(product)}」`);
  }
  if (existsSync(opts.out) && !opts.force) {
    log.err(`${opts.out} 已存在。加 --force 覆寫。`);
    process.exitCode = 1;
    return;
  }
  await mkdir(path.dirname(path.resolve(opts.out)), { recursive: true });
  await writeFile(opts.out, product === 'emoji' ? EXAMPLE_EMOJI_CONFIG : EXAMPLE_CONFIG, 'utf8');
  log.ok(`已產生範例設定檔：${opts.out}`);
  log.info(`下一步：用 char-gen skill 產組圖，再執行  sticker-tool gen --config ${opts.out} --sheet <組圖.png> --out out`);
  log.info(`（或交給 line-sticker-pack skill 一手指揮整段流程）`);
}
