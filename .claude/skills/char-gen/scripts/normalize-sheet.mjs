#!/usr/bin/env node
// 多格 sheet 正規化：把「沒照等分網格畫」的人物重排回嚴格等分格槽。
//
// 解決的問題（實測 dance20.png）：模型畫高密度網格（如 5×4）時常把垂直空間用滿——
// 256px 高的格畫出 273px 的人物、上排的腳越過格線掉進下排格子頂部，等分切格必切到人。
//
// 做法：連通塊分析（alpha>10 寬鬆閾值，把髮絲/腳尖這類被半透明斷開的碎塊接回來）→
// 面積前 N 大＝人物塊，小塊就近併入（同欄、垂直最近）→ 按質心分配格槽 →
// 全域統一縮放（保持各格人物相對大小）→ 每排腳底基線對齊（保留跳起格的離地量）→
// 輸出嚴格等分的新 sheet，之後交 sticker-tool `anim --sheet --grid` 安全切格。
//
// --equalize-rows：模型畫多排 sheet 常越下排人物越小（實測 dance20_v6 高度中位數
// 425→397→381→337，第四排比第一排小 20%，且是系統性遞減非動作造成）。開啟後每排
// 高度中位數補償到最高排水準，排內相對差異（蹲、跳）保留。預設關閉——若某排語意上
// 本來就該矮（如整排蹲姿），補償會錯誤放大。
//
// 用法（需在安裝了 sharp 的專案根目錄執行，如 sticker-tool）：
//   node normalize-sheet.mjs <in.png> <out.png> <cols>x<rows> [--equalize-rows]
import { createRequire } from 'module';
const require = createRequire(process.cwd() + '/package.json');
const sharp = require('sharp');

const EQUALIZE = process.argv.includes('--equalize-rows');
const [IN, OUT, GRID] = process.argv.slice(2).filter(a => !a.startsWith('--'));
if (!IN || !OUT || !GRID) {
  console.error('用法: node normalize-sheet.mjs <in.png> <out.png> <cols>x<rows> [--equalize-rows]');
  process.exit(1);
}
const [COLS, ROWS] = GRID.split('x').map(Number);
const MARGIN = 8; // 每格上下保留邊距

const { data, info } = await sharp(IN).raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height;
const CW = W / COLS, CH = H / ROWS;

// 1) 連通標記（alpha>10 寬鬆閾值，把半透明弱連接含進來）
const label = new Int32Array(W * H).fill(-1);
const comps = [];
for (let start = 0; start < W * H; start++) {
  if (label[start] !== -1 || data[start * 4 + 3] <= 10) continue;
  const id = comps.length;
  const queue = [start];
  label[start] = id;
  let area = 0, minX = W, maxX = 0, minY = H, maxY = 0, sumX = 0, sumY = 0;
  while (queue.length) {
    const p = queue.pop();
    const x = p % W, y = (p / W) | 0;
    area++; sumX += x; sumY += y;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    for (const q of [p - 1, p + 1, p - W, p + W]) {
      if (q < 0 || q >= W * H) continue;
      if (Math.abs((q % W) - x) > 1) continue;
      if (label[q] === -1 && data[q * 4 + 3] > 10) { label[q] = id; queue.push(q); }
    }
  }
  comps.push({ id, area, minX, maxX, minY, maxY, cx: sumX / area, cy: sumY / area });
}

// 2) 面積前 N 大為人物塊；其餘小塊就近併入（同欄、bbox 垂直距離最近的大塊）
comps.sort((a, b) => b.area - a.area);
const bodies = comps.slice(0, COLS * ROWS);
const minors = comps.slice(COLS * ROWS).filter(c => c.area >= 30); // 純噪點丟棄
const mergeMap = new Map();
for (const m of minors) {
  let best = null, bestD = Infinity;
  for (const b of bodies) {
    const xOverlap = Math.min(m.maxX, b.maxX) - Math.max(m.minX, b.minX);
    if (xOverlap < 0) continue;
    const dy = m.minY > b.maxY ? m.minY - b.maxY : b.minY > m.maxY ? b.minY - m.maxY : 0;
    if (dy < bestD) { bestD = dy; best = b; }
  }
  if (best && bestD < 60) {
    mergeMap.set(m.id, best.id);
    best.minX = Math.min(best.minX, m.minX); best.maxX = Math.max(best.maxX, m.maxX);
    best.minY = Math.min(best.minY, m.minY); best.maxY = Math.max(best.maxY, m.maxY);
    console.log(`小塊${m.id}(${m.area}px) 併入塊${best.id}（垂直距離${bestD}）`);
  }
}
const bodyOf = new Int32Array(comps.length).fill(-1);
for (const b of bodies) bodyOf[b.id] = b.id;
for (const [mid, bid] of mergeMap) bodyOf[mid] = bid;

// 3) 分配格槽：先按質心 y 分排、排內按 x 排序給欄
const slotted = bodies.map(b => ({ ...b, row: Math.min(ROWS - 1, Math.floor(b.cy / CH)) }));
const byRow = new Map();
for (const b of slotted) {
  if (!byRow.has(b.row)) byRow.set(b.row, []);
  byRow.get(b.row).push(b);
}
const assigned = [];
for (const [row, list] of [...byRow.entries()].sort((a, b) => a[0] - b[0])) {
  if (list.length !== COLS) console.log(`警告：排${row + 1} 有 ${list.length} 塊（應為 ${COLS}）——分配可能錯位，請目視檢查輸出`);
  list.sort((a, b) => a.cx - b.cx).forEach((b, i) => assigned.push({ ...b, col: i, row }));
}

// 4) 按排高度補償（--equalize-rows）：每排高度中位數對齊到最高排
const rowK = new Map();
for (const [row, list] of byRow) rowK.set(row, 1);
if (EQUALIZE) {
  const medOf = arr => { const v = [...arr].sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; };
  const rowMed = new Map();
  for (const [row, list] of byRow) rowMed.set(row, medOf(list.map(b => b.maxY - b.minY + 1)));
  const maxMed = Math.max(...rowMed.values());
  for (const [row, med] of rowMed) {
    rowK.set(row, maxMed / med);
    console.log(`排${row + 1}: 高度中位數 ${med}px → 補償 ×${(maxMed / med).toFixed(3)}`);
  }
}

// 5) 全域縮放係數：（補償後）最高人物要能放進 CH - 2*MARGIN（不放大、只縮小）
const maxH = Math.max(...assigned.map(b => (b.maxY - b.minY + 1) * rowK.get(b.row)));
const s = Math.min(1, (CH - 2 * MARGIN) / maxH);
console.log(`最高人物 ${maxH.toFixed(0)}px，格高 ${CH}，全域縮放 s=${s.toFixed(3)}`);

// 6) 每排腳底基線 = 該排塊 maxY 最大值（站地塊的腳底）
const baseline = new Map();
for (const [row, list] of byRow) baseline.set(row, Math.max(...list.map(b => b.maxY)));

// 7) 摳塊（label mask，避免 bbox 內鄰塊像素混入）→ 按 排補償×全域 縮放 → 貼到標準格槽
const composites = [];
for (const b of assigned) {
  const k = rowK.get(b.row) * s;
  const bw = b.maxX - b.minX + 1, bh = b.maxY - b.minY + 1;
  const buf = Buffer.alloc(bw * bh * 4);
  for (let y = b.minY; y <= b.maxY; y++) for (let x = b.minX; x <= b.maxX; x++) {
    const src = (y * W + x) * 4;
    const lid = label[y * W + x];
    if (lid !== -1 && bodyOf[lid] === b.id) {
      const dst = ((y - b.minY) * bw + (x - b.minX)) * 4;
      buf[dst] = data[src]; buf[dst + 1] = data[src + 1]; buf[dst + 2] = data[src + 2]; buf[dst + 3] = data[src + 3];
    }
  }
  const sw = Math.max(1, Math.round(bw * k)), sh = Math.max(1, Math.round(bh * k));
  const piece = await sharp(buf, { raw: { width: bw, height: bh, channels: 4 } })
    .resize(sw, sh, { fit: 'fill' }).png().toBuffer();
  // 定位：x 置中於格槽；y 腳底對齊「格底-MARGIN」，保留相對排基線的離地差（跳起格不落地）
  const lift = (baseline.get(b.row) - b.maxY) * k;
  const left = Math.round((b.col + 0.5) * CW - sw / 2);
  const top = Math.round((b.row + 1) * CH - MARGIN - sh - lift);
  composites.push({ input: piece, left: Math.max(0, left), top: Math.max(0, top) });
  const cell = b.row * COLS + b.col + 1;
  console.log(`格${cell}: 塊${b.id} ${bw}x${bh} → ${sw}x${sh}（×${k.toFixed(3)}）離地${lift.toFixed(0)}px`);
}
await sharp({
  create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
}).composite(composites).png().toFile(OUT);
console.log(`輸出: ${OUT}`);
