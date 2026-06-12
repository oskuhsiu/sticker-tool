/**
 * 組裝上架包：把 main.png / tab.png / 序號圖寫到輸出目錄，再壓成 .zip。
 */

import { createWriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import archiver from 'archiver';
import { MAIN_FILE, TAB_FILE, stickerFileName } from '../core/naming.js';

export interface BuildPackArgs {
  /** 輸出目錄（檔案 + zip 都放這） */
  outDir: string;
  /** 貼圖包名（用於 zip 檔名） */
  name: string;
  main: Buffer;
  tab: Buffer;
  /** 依序的貼圖 buffer（會命名為 01.png…） */
  stickers: Buffer[];
}

export interface BuildPackResult {
  dir: string;
  zipPath: string;
  zipBytes: number;
  files: string[];
}

/** 把名稱轉成檔名安全字串 */
function safeName(name: string): string {
  const s = name.trim().replace(/[^\w一-鿿.-]+/g, '_').replace(/^_+|_+$/g, '');
  return s.length > 0 ? s : 'stickers';
}

/** 寫出所有檔案並壓 zip */
export async function buildPack(args: BuildPackArgs): Promise<BuildPackResult> {
  const { outDir, name, main, tab, stickers } = args;
  await mkdir(outDir, { recursive: true });

  const written: { abs: string; entry: string }[] = [];
  const put = async (entry: string, buf: Buffer) => {
    const abs = path.join(outDir, entry);
    await writeFile(abs, buf);
    written.push({ abs, entry });
  };

  await put(MAIN_FILE, main);
  await put(TAB_FILE, tab);
  for (let i = 0; i < stickers.length; i++) {
    await put(stickerFileName(i + 1), stickers[i]!);
  }

  const zipPath = path.join(outDir, `${safeName(name)}.zip`);
  const zipBytes = await zipFiles(zipPath, written);

  return {
    dir: outDir,
    zipPath,
    zipBytes,
    files: written.map((w) => w.entry),
  };
}

function zipFiles(zipPath: string, files: { abs: string; entry: string }[]): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const output = createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', () => resolve(archive.pointer()));
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);
    for (const f of files) archive.file(f.abs, { name: f.entry });
    void archive.finalize();
  });
}
