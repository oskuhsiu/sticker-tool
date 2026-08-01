#!/usr/bin/env node
// 鬼影／半透明挖洞偵測（唯讀，只量測、不寫檔）。
//
// 解決的問題（char-gen 已知教訓）：codex 偶爾「自行去背」把主體身上原本不透明的部位
// （白衣、眼白、高舉的手臂）key 成半透明——切出來邊緣會跳動、像幽靈。客觀偵測法：
// 掃每格 alpha 落在 [40, 220] 的「半透明像素」佔該格「非透明像素（alpha>0）」的比例。
// 正常的抗鋸齒邊緣帶約 1–2%；≥ 門檻（預設 3%）就代表主體內部被挖出半透明洞，該重 roll。
//
// 輸入：本工具 anim --sheet 產出的最終動態 APNG（逐影格量測），或任何 PNG（單張量測）。
// 輸出：純 JSON 到 stdout（給 skill 解析）；人看的摘要到 stderr。退出碼一律 0（這是量測不是 pass/fail）。
//
// 為何用 upng-js 而非 sharp 抽影格：實測本機 sharp/libvips 不把 APNG 當動態讀
// （metadata.pages 回 1、只拿得到第一格），逐格偵測會靜默失準。upng-js 是本專案編 APNG
// 的同一套件，UPNG.toRGBA8 會把每格 dispose/blend 後合成出逐格 RGBA，靜態 PNG 則回單格。
//
// 用法（須在裝了 upng-js 的專案根目錄執行，如 sticker-tool）：
//   node <skill>/scripts/ghost-check.mjs <檔.png|apng> [--threshold 0.03]
import { createRequire } from 'module';
import { readFileSync } from 'node:fs';
const require = createRequire(process.cwd() + '/package.json');
const UPNG = require('upng-js');

const argv = process.argv.slice(2);
const FILE = argv.find((a) => !a.startsWith('--'));
const tIdx = argv.indexOf('--threshold');
const THRESHOLD = tIdx >= 0 && argv[tIdx + 1] ? Number(argv[tIdx + 1]) : 0.03;
if (!FILE) {
  console.error('用法: node ghost-check.mjs <檔.png|apng> [--threshold 0.03]');
  process.exit(1);
}

const LO = 40;
const HI = 220;
const EDGE_R = 2; // 排除距「透明空值」EDGE_R px 內的半透明像素（去背 soft-matte 抗鋸齒帶）

/**
 * 統計一格的「內部」鬼影佔比。
 * 關鍵：去背（色鍵 soft-matte／@imgly）會在輪廓周邊留一圈抗鋸齒半透明帶，全身小人輪廓長、
 * 這圈邊緣帶可達非零像素的 4–5%——那是正常的，不是破洞。真正的「自行去背挖洞」是輪廓
 * 「內部」（白衣、眼白）出現半透明。所以只算「距 alpha=0 至少 EDGE_R px」的內部半透明像素，
 * 把邊緣 AA 帶排除，門檻 3% 才對得準（否則每張去背後的貼圖都會誤報要重 roll）。
 */
function measure(u8, W, H) {
  const empty = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) empty[i] = u8[i * 4 + 3] === 0 ? 1 : 0;
  const nearEmpty = (x, y) => {
    for (let dy = -EDGE_R; dy <= EDGE_R; dy++) {
      for (let dx = -EDGE_R; dx <= EDGE_R; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) return true; // 畫布邊界視同透明
        if (empty[ny * W + nx]) return true;
      }
    }
    return false;
  };
  let nonzero = 0, interior = 0, edge = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const a = u8[(y * W + x) * 4 + 3];
      if (a > 0) {
        nonzero++;
        if (a >= LO && a <= HI) {
          if (nearEmpty(x, y)) edge++;
          else interior++;
        }
      }
    }
  }
  const ratio = nonzero ? interior / nonzero : 0;
  return {
    nonzero,
    interiorTranslucent: interior,
    edgeTranslucent: edge,
    ratio: Math.round(ratio * 10000) / 10000,
  };
}

// 讀檔 → 切出乾淨的 ArrayBuffer（避開 Node Buffer 共用 pool 的 byteOffset 問題）
const b = readFileSync(FILE);
const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
let img;
let rgbaFrames;
try {
  img = UPNG.decode(ab);
  rgbaFrames = UPNG.toRGBA8(img); // Array<ArrayBuffer>，每格 width*height*4
} catch (e) {
  // 鬼影偵測只對「透明 PNG/APNG」有意義（要有 alpha 通道）。非 PNG（如 JPEG 改副檔名、無 alpha）
  // 直接回乾淨錯誤——本工具 anim --sheet 的輸出一律是真 APNG，正常流程不會踩到。
  console.log(JSON.stringify({ file: FILE, error: 'not_a_png', message: String(e.message || e) }));
  console.error(`✗ 無法解碼為 PNG/APNG：${FILE}（鬼影偵測只適用於本工具輸出的透明 APNG）`);
  process.exit(2);
}
const pages = rgbaFrames.length || 1;

const frames = [];
for (let i = 0; i < rgbaFrames.length; i++) {
  const m = measure(new Uint8Array(rgbaFrames[i]), img.width, img.height);
  frames.push({ frame: i + 1, ...m, flag: m.ratio >= THRESHOLD });
}

const maxRatio = frames.reduce((mx, f) => Math.max(mx, f.ratio), 0);
const flagged = frames.filter((f) => f.flag).map((f) => f.frame);
const result = {
  file: FILE,
  threshold: THRESHOLD,
  pages,
  width: img.width,
  height: img.height,
  maxRatio,
  anyFlag: flagged.length > 0,
  flaggedFrames: flagged,
  frames,
};

console.log(JSON.stringify(result, null, 2));
if (result.anyFlag) {
  console.error(
    `⚠ 偵測到鬼影：格 ${flagged.join(' ')} 半透明佔比 ≥ ${THRESHOLD}（最高 ${maxRatio}）——建議重 roll，把這些格的主體畫成不透明實心。`,
  );
} else if (pages > 1) {
  console.error(`✓ ${pages} 格皆無鬼影（最高半透明佔比 ${maxRatio} < ${THRESHOLD}）`);
} else {
  console.error(`✓ 無鬼影（半透明佔比 ${maxRatio} < ${THRESHOLD}）`);
}
