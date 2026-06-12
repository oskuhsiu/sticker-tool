#!/usr/bin/env node
/**
 * gif-frames：把 GIF（或多頁動畫）拆成影格，並可拼成「動作對位圖」當 char-gen 的第二張 -i。
 *
 * 用法：
 *   node gif-frames.mjs <src.gif> [options]
 *
 * options：
 *   --out <dir>      輸出目錄（預設 <gif同層>/<gif檔名>_frames）
 *   --grid <CxR>     同時拼一張對位圖：C 欄 × R 列，並從來源等距取樣 C*R 格
 *   --frames <N>     等距取樣 N 格（與 --grid 二擇一；--grid 已隱含 N=C*R）
 *   --cell <px>      對位圖每格邊長（預設 256；nearest 放大保留輪廓）
 *   --gutter <px>    對位圖格間隙（預設 = round(cell*0.08)）
 *   --no-frames      只輸出對位圖，不輸出個別影格
 *   --label          對位圖每格標格號（預設「不標」——輸出乾淨無編號；對位靠 reading order 位置）
 *   --bg <hex>       對位圖底色（預設 ffffff 白底；對位圖一律不透明）
 *
 * 設計理由（see ../SKILL.md / char-gen method.md 第 5 節）：
 *   - 拆格用 sharp 的 page 選頁，逐頁抽出，原尺寸無損；對位圖才 nearest 放大（保留像素輪廓）。
 *   - 等距取樣含頭尾端點，動作弧線兩端不漏；播放時長要按取樣比例補償（本工具會算給你）。
 *   - 對位圖＝與「輸出網格同構」的姿勢索引：格號讓「輸出格N 姿勢 = 對位圖格N」對得起來。
 *   - 對位圖是「姿勢參照」不是成品，故白底＋標號；成品的透明/綠幕背景是 char-gen 那邊的事。
 */
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--no-frames') a.noFrames = true;
    else if (t === '--label') a.label = true;
    else if (t.startsWith('--')) a[t.slice(2)] = argv[++i];
    else a._.push(t);
  }
  return a;
}

function parseGrid(s) {
  const m = /^(\d+)\s*[xX×]\s*(\d+)$/.exec(s || '');
  if (!m) throw new Error(`--grid 須為 "5x4" 格式，得到「${s}」`);
  return { cols: +m[1], rows: +m[2] };
}

/** 等距取樣 N 個索引（含頭尾端點）。P 個來源 → N 個 0-based 索引。 */
function sampleIndices(P, N) {
  if (N >= P) return Array.from({ length: P }, (_, i) => i);
  if (N <= 1) return [0];
  return Array.from({ length: N }, (_, k) => Math.round((k * (P - 1)) / (N - 1)));
}

/** 一格的格號標籤（左上角，紅字＋白底圓角襯底，pixel-art 白底也看得清） */
function labelSvg(cell, n) {
  const fs = Math.max(14, Math.round(cell * 0.13));
  const pad = Math.round(fs * 0.35);
  const w = fs * String(n).length * 0.7 + pad * 2;
  const h = fs + pad * 2;
  return Buffer.from(
    `<svg width="${cell}" height="${cell}" xmlns="http://www.w3.org/2000/svg">` +
    `<rect x="2" y="2" width="${Math.round(w)}" height="${Math.round(h)}" rx="${Math.round(h * 0.25)}" fill="#ffffff" fill-opacity="0.82"/>` +
    `<text x="${2 + pad}" y="${2 + pad + fs * 0.82}" font-family="Arial,Helvetica,sans-serif" font-weight="bold" font-size="${fs}" fill="#d01616">${n}</text>` +
    `</svg>`,
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const src = args._[0];
  if (!src) {
    console.error('用法：node gif-frames.mjs <src.gif> [--grid CxR | --frames N] [--out dir] [--cell px] [--gutter px] [--no-frames] [--label]');
    process.exit(1);
  }
  const base = path.basename(src).replace(/\.[^.]+$/, '');
  const outDir = args.out ?? path.join(path.dirname(path.resolve(src)), `${base}_frames`);
  const cell = +(args.cell ?? 256);
  const gutter = args.gutter != null ? +args.gutter : Math.round(cell * 0.08);
  const bg = `#${(args.bg ?? 'ffffff').replace(/^#/, '')}`;

  const meta = await sharp(src, { animated: true }).metadata();
  const P = meta.pages ?? 1;
  const W = meta.width;
  const Hpage = meta.pageHeight ?? meta.height;
  const delays = meta.delay ?? [];
  const avgDelay = delays.length ? Math.round(delays.reduce((s, d) => s + d, 0) / delays.length) : 100;

  let grid = null;
  let N = P;
  if (args.grid) {
    grid = parseGrid(args.grid);
    N = grid.cols * grid.rows;
  } else if (args.frames) {
    N = Math.min(P, Math.max(1, +args.frames));
  }
  const idx = sampleIndices(P, N);

  await mkdir(outDir, { recursive: true });
  console.log(`來源：${src}`);
  console.log(`  ${W}×${Hpage}／格，${P} 格，平均 ${avgDelay}ms/格（一輪 ${(P * avgDelay / 1000).toFixed(2)}s）`);
  console.log(`取樣：${N} 格${N < P ? `（自 ${P} 等距取樣，含頭尾）` : '（全取）'}`);
  console.log(`  取樣原始格號(1-based)：${idx.map((i) => i + 1).join(', ')}`);
  if (N < P) {
    const ms = Math.round(avgDelay * P / N);
    console.log(`  ⚠ 播放時長補償：取了 ${N}/${P}，每格時長應 = ${avgDelay} × ${P}/${N} ≈ ${ms}ms（照搬 ${avgDelay}ms 會把動作快轉 ${(P / N).toFixed(1)}×）`);
  }

  // 1) 抽出取樣到的個別影格（原尺寸無損；保留來源 alpha）
  const cellBuffers = [];
  for (let k = 0; k < idx.length; k++) {
    const page = idx[k];
    const buf = await sharp(src, { page }).png().toBuffer(); // 選單頁 → 該格
    cellBuffers.push(buf);
    if (!args.noFrames) {
      const name = path.join(outDir, `frame_${String(k + 1).padStart(2, '0')}.png`);
      await writeFile(name, buf);
    }
  }
  if (!args.noFrames) console.log(`個別影格：${outDir}/frame_01.png … frame_${String(N).padStart(2, '0')}.png（原尺寸 ${W}×${Hpage}）`);

  // 2) 拼對位圖（白底、格間留隙、每格標號、nearest 放大保留輪廓）
  if (grid) {
    const { cols, rows } = grid;
    const GW = cols * cell + (cols + 1) * gutter;
    const GH = rows * cell + (rows + 1) * gutter;
    const composites = [];
    for (let k = 0; k < N; k++) {
      const c = k % cols;
      const r = (k / cols) | 0;
      const cx = gutter + c * (cell + gutter);
      const cy = gutter + r * (cell + gutter);
      // 影格 fit 進格內（preserve aspect、nearest）、置中，先 flatten 到白避免來源透明殘黑
      const fitted = await sharp(cellBuffers[k])
        .flatten({ background: bg })
        .resize({ width: cell, height: cell, fit: 'contain', background: bg, kernel: 'nearest' })
        .png()
        .toBuffer();
      composites.push({ input: fitted, left: cx, top: cy });
      if (args.label) composites.push({ input: labelSvg(cell, k + 1), left: cx, top: cy });
    }
    const montagePath = path.join(outDir, `pose_ref_${cols}x${rows}.png`);
    await sharp({ create: { width: GW, height: GH, channels: 4, background: bg } })
      .composite(composites)
      .png()
      .toFile(montagePath);
    console.log(`對位圖：${montagePath}  ${GW}×${GH}（${cols}×${rows}，格 ${cell}px、隙 ${gutter}px、白底${args.label ? '、標號' : '、無編號'}）`);
    console.log(`  → char-gen 用法：master 在前、此圖在後，雙 -i 餵入；文字寫「輸出格N 姿勢=對位圖格N、動作幅度照搬不要收斂」。`);
  }
}

main().catch((e) => {
  console.error('gif-frames 失敗：', e.message);
  process.exit(1);
});
