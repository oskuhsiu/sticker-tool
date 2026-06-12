/**
 * 連續影格 → APNG（upng-js，純 JS、可攜）。
 *
 *  - loops：upng-js 把 acTL num_plays 寫死 0（無限循環），但 LINE 要 1–4，
 *    故編完後直接改寫 acTL num_plays 欄位 + 重算該 chunk CRC。
 *  - auto-fit：超過 maxBytes 才沿品質階梯降色數（多數情況保全影格即達標），
 *    極端情況才減影格（issues：1MB 上限下幾乎用不到）。第一個達標即停。
 */

import UPNG from 'upng-js';
import sharp from 'sharp';
import type { AnimPriority, LadderRung } from '../core/types.js';

/** 把影格 buffer 轉成等尺寸的 RGBA8 ArrayBuffer 陣列 */
async function framesToRgba(
  frames: Buffer[],
): Promise<{ bufs: ArrayBuffer[]; width: number; height: number }> {
  const bufs: ArrayBuffer[] = [];
  let W = 0;
  let H = 0;
  for (let i = 0; i < frames.length; i++) {
    const { data, info } = await sharp(frames[i]!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (i === 0) {
      W = info.width;
      H = info.height;
    } else if (info.width !== W || info.height !== H) {
      throw new Error(`影格 ${i + 1} 尺寸 ${info.width}×${info.height} 與第一格 ${W}×${H} 不一致`);
    }
    bufs.push(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
  }
  return { bufs, width: W, height: H };
}

/** 改寫 APNG 的 acTL num_plays（循環次數）並重算 chunk CRC */
export function setApngNumPlays(png: Buffer, loops: number): Buffer {
  const idx = png.indexOf('acTL', 0, 'latin1');
  if (idx < 0) return png; // 非動畫（單格）→ 無 acTL
  // chunk：[len][type "acTL"@idx][num_frames@idx+4][num_plays@idx+8][crc@idx+12]
  png.writeUInt32BE(loops >>> 0, idx + 8);
  const crc = UPNG.crc.crc(png, idx, 12) >>> 0; // CRC 涵蓋 type+data 共 12 bytes
  png.writeUInt32BE(crc, idx + 12);
  return png;
}

/** 編成 APNG（單格則為靜態 PNG）。colors=0/undefined 為無損。 */
export async function encodeApng(
  frames: Buffer[],
  opts: { loops: number; delayMs: number; colors?: number },
): Promise<Buffer> {
  if (frames.length === 0) throw new Error('沒有影格');
  const { bufs, width, height } = await framesToRgba(frames);
  const dels = bufs.map(() => Math.max(1, Math.round(opts.delayMs)));
  const ab = UPNG.encode(bufs, width, height, opts.colors ?? 0, dels);
  let png: Buffer = Buffer.from(ab);
  if (frames.length > 1) png = setApngNumPlays(png, opts.loops);
  return png;
}

/** 讀回 APNG 資訊（給驗證用） */
export function readApngInfo(buffer: Buffer): {
  isApng: boolean;
  frames: number;
  loops: number;
  width: number;
  height: number;
} {
  const img = UPNG.decode(buffer);
  const actl = img.tabs.acTL;
  return {
    isApng: !!actl,
    frames: actl?.num_frames ?? 1,
    loops: actl?.num_plays ?? 0,
    width: img.width,
    height: img.height,
  };
}

/** 等距抽樣 target 格，保序、含頭尾、索引嚴格遞增 */
export function subsampleFrames<T>(frames: T[], target: number): T[] {
  if (target >= frames.length) return frames.slice();
  if (target <= 1) return [frames[0]!];
  const out: T[] = [];
  let last = -1;
  for (let i = 0; i < target; i++) {
    let idx = Math.round((i * (frames.length - 1)) / (target - 1));
    if (idx <= last) idx = last + 1;
    last = idx;
    out.push(frames[idx]!);
  }
  return out;
}

const COLOR_STEPS = [0, 256, 192, 128, 96, 64, 48, 32, 24, 16];

/** 由 frameCount 產生遞減的影格數序列（到 minFrames 為止） */
function frameSeq(frameCount: number, minFrames: number): number[] {
  const seq = [frameCount];
  let f = frameCount;
  while (f > minFrames) {
    f = Math.max(minFrames, Math.floor(f * 0.75));
    if (seq[seq.length - 1] !== f) seq.push(f);
  }
  return seq;
}

/** 依優先序產生 (colors, frames) 品質階梯；maxColors>0＝強制減色上限（排除無損、夾住階梯） */
export function autoLadder(
  priority: AnimPriority,
  frameCount: number,
  minColors: number,
  minFrames: number,
  maxColors = 0,
): LadderRung[] {
  const colors = COLOR_STEPS.filter((c) =>
    c === 0 ? maxColors === 0 : c >= minColors && (maxColors === 0 || c <= maxColors),
  );
  if (colors.length === 0) colors.push(Math.max(minColors, 16));
  const frames = frameSeq(frameCount, Math.max(5, minFrames));
  const steps: LadderRung[] = [];
  const push = (c: number, f: number) => {
    if (!steps.some((s) => s.colors === c && s.frames === f)) steps.push({ colors: c, frames: f });
  };

  if (priority === 'colors') {
    // 先把色數降到底（保影格），再減影格
    for (const f of frames) for (const c of colors) push(c, f);
  } else if (priority === 'frames') {
    // 先減影格（保色數高），再降色
    for (const c of colors) for (const f of frames) push(c, f);
  } else {
    // balanced：先保「色≥48 且 格≥8」（48 受 maxColors 夾住）
    const protectF = Math.max(8, minFrames);
    const midC = Math.max(Math.min(48, maxColors || 48), Math.max(minColors, 16));
    const hi = colors.filter((c) => c === 0 || c >= midC);
    const lo = colors.filter((c) => c !== 0 && c < midC);
    const framesToProtect = frames.filter((f) => f >= protectF);
    const framesBelow = frames.filter((f) => f < protectF);
    // 1) 全影格，色 high→midC
    for (const c of hi) push(c, frameCount);
    // 2) 色=midC，影格 full→8
    for (const f of framesToProtect) push(midC, f);
    // 3) 影格=protect 底線，色 midC→min
    for (const c of lo) push(c, protectF);
    // 4) 色=min，影格 8→minFrames
    for (const f of framesBelow) push(Math.max(minColors, 16), f);
  }
  return steps;
}

export interface AutoFitOptions {
  loops: number;
  /** 每格延遲（ms）；對應全影格時的延遲，抽樣後會等比放大維持總時長 */
  delayMs: number;
  maxBytes: number;
  minColors: number;
  /** 量化色數上限：0=不設限（容許無損） */
  maxColors: number;
  minFrames: number;
  priority: AnimPriority;
  ladder: 'auto' | LadderRung[];
}

export interface AutoFitResult {
  buffer: Buffer;
  colors: number;
  frames: number;
  bytes: number;
  overBudget: boolean;
}

/** 組裝 + auto-fit 到 ≤ maxBytes；回報最終色數×影格×bytes */
export async function encodeApngAutoFit(
  frames: Buffer[],
  opts: AutoFitOptions,
): Promise<AutoFitResult> {
  const steps =
    opts.ladder === 'auto'
      ? autoLadder(opts.priority, frames.length, opts.minColors, opts.minFrames, opts.maxColors)
      : opts.ladder;

  let best: AutoFitResult | null = null;
  for (const step of steps) {
    const used = subsampleFrames(frames, step.frames);
    const delay = (opts.delayMs * frames.length) / used.length; // 維持總時長
    const buf = await encodeApng(used, { loops: opts.loops, delayMs: delay, colors: step.colors });
    const r: AutoFitResult = {
      buffer: buf,
      colors: step.colors,
      frames: used.length,
      bytes: buf.length,
      overBudget: buf.length > opts.maxBytes,
    };
    if (!best || r.bytes < best.bytes) best = r;
    if (buf.length <= opts.maxBytes) return r;
  }
  return best!;
}
