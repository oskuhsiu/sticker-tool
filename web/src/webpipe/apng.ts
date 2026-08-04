/**
 * 連續影格 → APNG（upng-js，與 CLI 版同一顆編碼器）。
 *
 *  - loops：upng-js 把 acTL num_plays 寫死 0（無限循環），但 LINE 要 1–4，
 *    故編完後直接改寫 acTL num_plays 欄位 + 重算該 chunk CRC。
 *  - auto-fit：超過 maxBytes 才沿品質階梯降色數，極端情況才減影格。第一個達標即停。
 */

import UPNG from 'upng-js';
import { adjacentDuplicateIndices, equalRgbaFrames } from '@core/frameSequence.js';
import type { AnimPriority, LadderRung } from '@core/types.js';
import type { ImageInfo } from '@core/validate.js';
import { distributeFrameDelays } from '@core/videoCrop.js';
import type { Raster } from './raster.js';
import { pngImageInfo } from './png.js';

/** 驗證影格等尺寸並轉成 RGBA8 ArrayBuffer 陣列 */
function framesToRgba(frames: Raster[]): { bufs: ArrayBuffer[]; width: number; height: number } {
  const first = frames[0];
  if (!first) throw new Error('沒有影格');
  const W = first.width;
  const H = first.height;
  const bufs: ArrayBuffer[] = [];
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]!;
    if (f.width !== W || f.height !== H) {
      throw new Error(`影格 ${i + 1} 尺寸 ${f.width}×${f.height} 與第一格 ${W}×${H} 不一致`);
    }
    bufs.push(f.data.buffer.slice(f.data.byteOffset, f.data.byteOffset + f.data.byteLength) as ArrayBuffer);
  }
  return { bufs, width: W, height: H };
}

/** 在 PNG bytes 內找 ASCII 'acTL' 的位移；找不到回 -1 */
function findAcTL(png: Uint8Array): number {
  // a=97 c=99 T=84 L=76
  for (let i = 8; i < png.length - 3; i++) {
    if (png[i] === 97 && png[i + 1] === 99 && png[i + 2] === 84 && png[i + 3] === 76) return i;
  }
  return -1;
}

/** 改寫 APNG 的 acTL num_plays（循環次數）並重算 chunk CRC */
export function setApngNumPlays(png: Uint8Array, loops: number): Uint8Array {
  const idx = findAcTL(png);
  if (idx < 0) return png; // 非動畫（單格）→ 無 acTL
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  // chunk：[len][type "acTL"@idx][num_frames@idx+4][num_plays@idx+8][crc@idx+12]
  view.setUint32(idx + 8, loops >>> 0);
  const crc = UPNG.crc.crc(png, idx, 12) >>> 0; // CRC 涵蓋 type+data 共 12 bytes
  view.setUint32(idx + 12, crc);
  return png;
}

/** 編成 APNG（單格則為靜態 PNG）。colors=0/undefined 為無損。 */
export function encodeApng(
  frames: Raster[],
  opts: {
    loops: number;
    delayMs?: number;
    delaysMs?: number[];
    colors?: number;
    /** Internal editable APNGs use true to keep repeated frames reliably decodable by upng-js. */
    forbidPalette?: boolean;
  },
): Uint8Array {
  const { bufs, width, height } = framesToRgba(frames);
  const dels =
    opts.delaysMs ??
    distributeFrameDelays(Math.max(frames.length, Math.round((opts.delayMs ?? 100) * frames.length)), frames.length);
  if (dels.length !== frames.length || dels.some((d) => !Number.isInteger(d) || d < 1)) {
    throw new Error(`APNG delays must contain ${frames.length} positive integer millisecond values`);
  }
  const ab = UPNG.encode(bufs, width, height, opts.colors ?? 0, dels, opts.forbidPalette ?? false);
  let png: Uint8Array = new Uint8Array(ab);
  if (frames.length > 1) png = setApngNumPlays(png, opts.loops);
  return png;
}

/** 讀回 APNG 資訊（給驗證用） */
export function readApngInfo(png: Uint8Array): {
  isApng: boolean;
  frames: number;
  loops: number;
  width: number;
  height: number;
  delaysMs: number[];
  durationMs: number;
} {
  const img = UPNG.decode(png);
  const actl = img.tabs.acTL;
  const delaysMs = actl ? img.frames.map((frame) => frame.delay) : [];
  return {
    isApng: !!actl,
    frames: actl?.num_frames ?? 1,
    loops: actl?.num_plays ?? 0,
    width: img.width,
    height: img.height,
    delaysMs,
    durationMs: delaysMs.reduce((sum, delay) => sum + delay, 0),
  };
}

/** Decode every composited APNG frame for project editing. */
export function decodeApngFrames(png: Uint8Array): {
  frames: Raster[];
  delaysMs: number[];
  loops: number;
} {
  const input = png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer;
  const img = UPNG.decode(input);
  const rgba = UPNG.toRGBA8(img);
  const delaysMs = img.tabs.acTL ? img.frames.map((frame) => frame.delay) : [0];
  return {
    frames: rgba.map((buffer) => ({
      data: new Uint8ClampedArray(buffer),
      width: img.width,
      height: img.height,
    })),
    delaysMs,
    loops: img.tabs.acTL?.num_plays ?? 0,
  };
}

/**
 * Reopen final PNG/APNG bytes and collect evidence from the decoded visuals.
 * This deliberately does not inspect pre-encode frames, since palette fitting,
 * APNG compositing, and delay rounding can all change the delivered bytes.
 */
export interface AnimatedByteEvidence {
  frames: Raster[];
  delaysMs: number[];
  loops: number;
  info: ImageInfo;
  distinctFrames: number;
  adjacentDuplicateFrames: number;
  transparentPixels: number;
  foregroundPixels: number;
}

export function inspectAnimatedBytes(
  png: Uint8Array,
  requestedFrames?: number,
): AnimatedByteEvidence {
  const decoded = decodeApngFrames(png);
  const base = pngImageInfo(png);
  const unique: Raster[] = [];
  let transparentPixels = 0;
  let foregroundPixels = 0;
  for (const frame of decoded.frames) {
    if (!unique.some((candidate) => equalRgbaFrames(candidate, frame))) unique.push(frame);
    for (let index = 3; index < frame.data.length; index += 4) {
      const alpha = frame.data[index]!;
      if (alpha < 255) transparentPixels++;
      if (alpha > 10) foregroundPixels++;
    }
  }
  const adjacentDuplicateFrames = adjacentDuplicateIndices(decoded.frames, equalRgbaFrames).length;
  const durationMs = decoded.delaysMs.reduce((sum, delay) => sum + delay, 0);
  const info: ImageInfo = {
    ...base,
    frames: decoded.frames.length,
    requestedFrames,
    loops: decoded.loops,
    durationMs,
    distinctFrames: unique.length,
    adjacentDuplicateFrames,
    transparentPixels,
    foregroundPixels,
  };
  return {
    frames: decoded.frames,
    delaysMs: decoded.delaysMs,
    loops: decoded.loops,
    info,
    distinctFrames: unique.length,
    adjacentDuplicateFrames,
    transparentPixels,
    foregroundPixels,
  };
}

/** Source indices selected by the same deterministic algorithm as subsampleFrames. */
export function subsampleIndices(length: number, target: number): number[] {
  if (length < 1) return [];
  if (target >= length) return Array.from({ length }, (_, index) => index);
  if (target <= 1) return [0];
  const out: number[] = [];
  let last = -1;
  for (let i = 0; i < target; i++) {
    let idx = Math.round((i * (length - 1)) / (target - 1));
    if (idx <= last) idx = last + 1;
    last = idx;
    out.push(idx);
  }
  return out;
}

/** 等距抽樣 target 格，保序、含頭尾、索引嚴格遞增 */
export function subsampleFrames<T>(frames: T[], target: number): T[] {
  return subsampleIndices(frames.length, target).map((index) => frames[index]!);
}

const COLOR_STEPS = [0, 256, 192, 128, 96, 64, 48, 32, 24, 16];

export function exactFrameColorSteps(minColors: number, maxColors = 0): number[] {
  const steps = COLOR_STEPS.filter((colors) =>
    colors === 0
      ? maxColors === 0
      : colors >= Math.max(16, minColors) && (maxColors === 0 || colors <= maxColors),
  );
  if (steps.length === 0) steps.push(Math.max(16, minColors));
  return steps;
}

export interface ExactFrameEncodeResult {
  png: Uint8Array;
  colors: number;
  frames: number;
  bytes: number;
  overBudget: boolean;
  delaysMs: number[];
  accepted: boolean;
}

/** Search colors only. The requested frame sequence and exact delays never change. */
export function encodeApngExactFrames(
  frames: Raster[],
  opts: {
    loops: number;
    delaysMs: number[];
    maxBytes: number;
    minColors: number;
    maxColors?: number;
    /** Optional final-byte contract. Rejected color candidates remain available as diagnostics only. */
    acceptCandidate?: (png: Uint8Array) => boolean;
  },
): ExactFrameEncodeResult {
  let best: ExactFrameEncodeResult | null = null;
  let bestAccepted: ExactFrameEncodeResult | null = null;
  for (const colors of exactFrameColorSteps(opts.minColors, opts.maxColors ?? 0)) {
    const png = encodeApng(frames, {
      loops: opts.loops,
      delaysMs: opts.delaysMs,
      colors,
      forbidPalette: colors === 0,
    });
    const candidate: ExactFrameEncodeResult = {
      png,
      colors,
      frames: frames.length,
      bytes: png.length,
      overBudget: png.length > opts.maxBytes,
      delaysMs: [...opts.delaysMs],
      accepted: opts.acceptCandidate?.(png) ?? true,
    };
    if (!best || candidate.bytes < best.bytes) best = candidate;
    if (candidate.accepted && (!bestAccepted || candidate.bytes < bestAccepted.bytes)) bestAccepted = candidate;
    if (candidate.accepted && !candidate.overBudget) return candidate;
  }
  return bestAccepted ?? best!;
}

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

/** 依優先序產生 (colors, frames) 品質階梯（與 CLI 版一致）；maxColors>0＝強制減色上限 */
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
    for (const f of frames) for (const c of colors) push(c, f);
  } else if (priority === 'frames') {
    for (const c of colors) for (const f of frames) push(c, f);
  } else {
    const protectF = Math.max(8, minFrames);
    const midC = Math.max(Math.min(48, maxColors || 48), Math.max(minColors, 16));
    const hi = colors.filter((c) => c === 0 || c >= midC);
    const lo = colors.filter((c) => c !== 0 && c < midC);
    const framesToProtect = frames.filter((f) => f >= protectF);
    const framesBelow = frames.filter((f) => f < protectF);
    for (const c of hi) push(c, frameCount);
    for (const f of framesToProtect) push(midC, f);
    for (const c of lo) push(c, protectF);
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
  png: Uint8Array;
  colors: number;
  frames: number;
  bytes: number;
  overBudget: boolean;
  usedFrameIndices: number[];
  delaysMs: number[];
}

/** 組裝 + auto-fit 到 ≤ maxBytes；回報最終色數×影格×bytes */
export function encodeApngAutoFit(frames: Raster[], opts: AutoFitOptions): AutoFitResult {
  const steps =
    opts.ladder === 'auto'
      ? autoLadder(opts.priority, frames.length, opts.minColors, opts.minFrames, opts.maxColors)
      : opts.ladder;

  let best: AutoFitResult | null = null;
  for (const step of steps) {
    const usedFrameIndices = subsampleIndices(frames.length, step.frames);
    const used = usedFrameIndices.map((index) => frames[index]!);
    const delaysMs = distributeFrameDelays(Math.round(opts.delayMs * frames.length), used.length);
    const png = encodeApng(used, {
      loops: opts.loops,
      delaysMs,
      colors: step.colors,
      forbidPalette: step.colors === 0,
    });
    const r: AutoFitResult = {
      png,
      colors: step.colors,
      frames: used.length,
      bytes: png.length,
      overBudget: png.length > opts.maxBytes,
      usedFrameIndices,
      delaysMs,
    };
    if (!best || r.bytes < best.bytes) best = r;
    if (png.length <= opts.maxBytes) return r;
  }
  return best!;
}
