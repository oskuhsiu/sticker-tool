/**
 * 打包與下載（瀏覽器版）：fflate 壓 zip、blob 觸發下載。
 */

import { zipSync } from 'fflate';
import {
  MAIN_FILE,
  POPUP_ANIMATION_MAIN_PATH,
  POPUP_STATIC_MAIN_PATH,
  POPUP_STATIC_TAB_PATH,
  TAB_FILE,
  popupAnimationFilePath,
  popupStaticFilePath,
  stickerFileName,
} from '@core/naming.js';

export interface PackFiles {
  main: Uint8Array;
  tab: Uint8Array;
  /** 依序的貼圖 bytes（命名為 01.png…） */
  stickers: Uint8Array[];
}

export interface PopupPackFiles {
  /** Static cover, stored as `png/main.png`. */
  main: Uint8Array;
  /** Pop-up cover APNG, stored as `popup/main_popup.png`. */
  popupMain: Uint8Array;
  /** Shared static tab image, stored as `png/tab.png`. */
  tab: Uint8Array;
  /** Static sticker PNGs, stored under `png/01.png`… */
  stickers: Uint8Array[];
  /** Pop-up sticker APNGs, stored under `popup/01.png`… */
  popupStickers: Uint8Array[];
}

export interface BuiltZip {
  zip: Uint8Array;
  zipBytes: number;
  files: Record<string, Uint8Array>;
}

/** 組出上架包檔案表 + zip bytes */
export function buildPackZip(pack: PackFiles): BuiltZip {
  const files: Record<string, Uint8Array> = {
    [MAIN_FILE]: pack.main,
    [TAB_FILE]: pack.tab,
  };
  for (let i = 0; i < pack.stickers.length; i++) {
    files[stickerFileName(i + 1)] = pack.stickers[i]!;
  }
  // PNG 已壓縮，zip 再壓收益低；level 9 與 CLI 版一致
  const zip = zipSync(files, { level: 9 });
  return { zip, zipBytes: zip.length, files };
}

/**
 * Build the two-track Pop-up Sticker archive.
 *
 * The static and animated numbered sets intentionally live in separate
 * directories so neither set shadows the other in ZIP readers or downloads.
 * LINE's static cover/tab live with the static set; the Pop-up cover lives
 * with the animated set.
 */
export function buildPopupPackZip(pack: PopupPackFiles): BuiltZip {
  if (pack.stickers.length !== pack.popupStickers.length) {
    throw new RangeError(
      `Popup static/animation sticker count mismatch: ${pack.stickers.length}/${pack.popupStickers.length}`,
    );
  }
  const files: Record<string, Uint8Array> = {
    [POPUP_STATIC_MAIN_PATH]: pack.main,
    [POPUP_ANIMATION_MAIN_PATH]: pack.popupMain,
    [POPUP_STATIC_TAB_PATH]: pack.tab,
  };
  for (let i = 0; i < pack.stickers.length; i++) {
    files[popupStaticFilePath(i + 1)] = pack.stickers[i]!;
    files[popupAnimationFilePath(i + 1)] = pack.popupStickers[i]!;
  }
  const zip = zipSync(files, { level: 9 });
  return { zip, zipBytes: zip.length, files };
}

/** 把名稱轉成檔名安全字串（與 CLI 版一致） */
export function safeName(name: string): string {
  const s = name.trim().replace(/[^\w一-鿿.-]+/g, '_').replace(/^_+|_+$/g, '');
  return s.length > 0 ? s : 'stickers';
}

/** 觸發瀏覽器下載 */
export function downloadBytes(filename: string, bytes: Uint8Array, mime = 'application/octet-stream'): void {
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
