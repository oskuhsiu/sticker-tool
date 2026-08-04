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
export const POPUP_MAIN_FILE = 'main_popup.png';
export const TAB_FILE = 'tab.png';

/** Popup Sticker 靜態貼圖的 archive 資料夾。 */
export const POPUP_STATIC_DIR = 'png';
/** Popup Sticker 動畫貼圖的 archive 資料夾。 */
export const POPUP_ANIMATION_DIR = 'popup';
/** Popup Sticker 靜態封面的 archive 路徑。 */
export const POPUP_STATIC_MAIN_PATH = `${POPUP_STATIC_DIR}/${MAIN_FILE}`;
/** Popup Sticker 聊天室縮圖的 archive 路徑。 */
export const POPUP_STATIC_TAB_PATH = `${POPUP_STATIC_DIR}/${TAB_FILE}`;
/** Popup Sticker 動畫封面的 archive 路徑。 */
export const POPUP_ANIMATION_MAIN_PATH = `${POPUP_ANIMATION_DIR}/${POPUP_MAIN_FILE}`;

/** Popup Sticker 靜態貼圖的 archive 路徑（例如 `png/01.png`）。 */
export function popupStaticFilePath(oneBasedIndex: number): string {
  return `${POPUP_STATIC_DIR}/${stickerFileName(oneBasedIndex)}`;
}

/** Popup Sticker 動畫貼圖的 archive 路徑（例如 `popup/01.png`）。 */
export function popupAnimationFilePath(oneBasedIndex: number): string {
  return `${POPUP_ANIMATION_DIR}/${stickerFileName(oneBasedIndex)}`;
}
