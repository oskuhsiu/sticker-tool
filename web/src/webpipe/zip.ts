/**
 * 打包與下載（瀏覽器版）：fflate 壓 zip、blob 觸發下載。
 */

import { zipSync } from 'fflate';
import { MAIN_FILE, TAB_FILE, stickerFileName } from '@core/naming.js';

export interface PackFiles {
  main: Uint8Array;
  tab: Uint8Array;
  /** 依序的貼圖 bytes（命名為 01.png…） */
  stickers: Uint8Array[];
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
