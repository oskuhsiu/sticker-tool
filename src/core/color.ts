/**
 * CSS 顏色字串 → {r,g,b,alpha} 解析。純函式。
 * 支援 #rgb / #rgba / #rrggbb / #rrggbbaa 與少數常見色名。
 */

export interface RGBA {
  r: number;
  g: number;
  b: number;
  alpha: number; // 0–1
}

const NAMED: Record<string, string> = {
  white: '#ffffff',
  black: '#000000',
  red: '#ff0000',
  green: '#00ff00',
  blue: '#0000ff',
  transparent: '#00000000',
};

export function parseColor(input: string): RGBA {
  let s = input.trim().toLowerCase();
  if (NAMED[s]) s = NAMED[s]!;
  if (!s.startsWith('#')) {
    throw new Error(`無法解析顏色「${input}」：請用 #rrggbb 或 #rrggbbaa 形式`);
  }
  const hex = s.slice(1);
  const expand = (h: string) =>
    h.length === 3 || h.length === 4
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h;
  const h = expand(hex);
  if (h.length !== 6 && h.length !== 8) {
    throw new Error(`無法解析顏色「${input}」：長度不正確`);
  }
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
  if ([r, g, b].some((n) => Number.isNaN(n))) {
    throw new Error(`無法解析顏色「${input}」`);
  }
  return { r, g, b, alpha: a };
}

/** 轉成 CSS 字串（給 SVG 用） */
export function toCss({ r, g, b, alpha }: RGBA): string {
  return alpha >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${alpha})`;
}
