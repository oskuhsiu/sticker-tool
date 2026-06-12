/**
 * 序號命名：index → "01.png"（兩位數，1-based）。純函式。
 */

import { SEQ_DIGITS } from './spec.js';

/**
 * 把貼圖序號（1-based）轉成 LINE 上架要求的兩位數檔名。
 * @param oneBasedIndex 1, 2, 3, …
 * @returns "01.png", "02.png", …
 */
export function stickerFileName(oneBasedIndex: number): string {
  if (!Number.isInteger(oneBasedIndex) || oneBasedIndex < 1) {
    throw new RangeError(`貼圖序號須為 ≥1 的整數，收到 ${oneBasedIndex}`);
  }
  return `${String(oneBasedIndex).padStart(SEQ_DIGITS, '0')}.png`;
}

/** 依張數產生全部序號檔名 ["01.png", …, "NN.png"] */
export function stickerFileNames(count: number): string[] {
  return Array.from({ length: count }, (_, i) => stickerFileName(i + 1));
}

export const MAIN_FILE = 'main.png';
export const TAB_FILE = 'tab.png';
