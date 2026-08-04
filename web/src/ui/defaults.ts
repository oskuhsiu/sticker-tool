/**
 * Web 版的設定預設值（取代 CLI 的 zod schema 預設）。
 * UI 只暴露常用欄位，其餘用與 CLI 相同的預設。
 */

import type { AnimationConfig, StrokeSpec, TextSpec } from '@core/types.js';

export function makeAnimation(opts: {
  loops: number;
  durationSec: number;
  stabilize: boolean;
  /** 減色上限：0=不降色；256/128/64＝使用者明確要求降色 */
  maxColors?: number;
}): AnimationConfig {
  return {
    maxBytes: 1_000_000,
    loops: opts.loops,
    durationSec: opts.durationSec,
    autoFit: (opts.maxColors ?? 0) > 0,
    priority: 'balanced',
    minColors: 16,
    maxColors: opts.maxColors ?? 0,
    minFrames: 5,
    ladder: 'auto',
    stabilize: {
      enabled: opts.stabilize,
      anchor: 'head',
      axis: 'xy',
      darkThreshold: 70,
      topFraction: 0.5,
    },
  };
}

export function makeStroke(enabled: boolean, width: number, color: string): StrokeSpec | undefined {
  return enabled ? { enabled: true, width, color } : undefined;
}

/** 逐格疊字共用設定（內容逐格、位置/大小/顏色共用） */
export interface SharedTextStyle {
  x: number;
  y: number;
  size: number;
  color: string;
  font: string;
}

export const DEFAULT_TEXT_STYLE: SharedTextStyle = {
  x: 50,
  y: 88,
  size: 40,
  color: '#000000',
  font: '',
};

/** UI safety bound: LINE packs need at most 40 cells, while this still permits generous custom layouts. */
export const MAX_CUSTOM_GRID_AXIS = 64;
export const MAX_CUSTOM_GRID_CELLS = 400;

export function customGridIssue(grid: { cols: number; rows: number }): string | null {
  const { cols, rows } = grid;
  if (!Number.isSafeInteger(cols) || !Number.isSafeInteger(rows) || cols < 1 || rows < 1) {
    return `網格欄列必須是正整數，收到 ${cols}×${rows}`;
  }
  if (cols > MAX_CUSTOM_GRID_AXIS || rows > MAX_CUSTOM_GRID_AXIS) {
    return `自訂網格單邊最多 ${MAX_CUSTOM_GRID_AXIS} 格，收到 ${cols}×${rows}`;
  }
  if (cols > Math.floor(MAX_CUSTOM_GRID_CELLS / rows)) {
    return `自訂網格最多 ${MAX_CUSTOM_GRID_CELLS} 格，收到 ${cols}×${rows}`;
  }
  return null;
}

export function makeText(content: string, style: SharedTextStyle): TextSpec | undefined {
  const c = content.trim();
  if (!c) return undefined;
  return { content: c, x: style.x, y: style.y, size: style.size, color: style.color, font: style.font };
}

/** "4x2" → {cols,rows}；空字串/auto → null */
export function parseGridText(s: string): { cols: number; rows: number } | null {
  const t = s.trim().toLowerCase();
  if (!t || t === 'auto') return null;
  const m = /^(\d+)\s*[x×]\s*(\d+)$/.exec(t);
  if (!m) throw new Error(`網格格式須為 "4x2" 或 "auto"，得到「${s}」`);
  return { cols: Number(m[1]), rows: Number(m[2]) };
}
