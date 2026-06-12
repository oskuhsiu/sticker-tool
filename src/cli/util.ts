/**
 * CLI 共用小工具：影像檔列舉、尺寸解析、輸出格式化。
 */

import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type { ValidationResult } from '../core/types.js';

const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;

/** 列出目錄中的影像檔（絕對路徑），以自然序（檔名數字）排序 */
export async function listImages(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && IMAGE_EXT.test(e.name))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
    .map((name) => path.join(dir, name));
}

/** 解析 "370x320" → [370, 320] */
export function parseSize(s: string): [number, number] {
  const m = /^(\d+)\s*[xX×]\s*(\d+)$/.exec(s.trim());
  if (!m) throw new Error(`尺寸格式錯誤「${s}」，應為 WxH（如 370x320）`);
  return [Number(m[1]), Number(m[2])];
}

export const log = {
  info: (msg: string) => console.log(msg),
  step: (msg: string) => console.log(`→ ${msg}`),
  ok: (msg: string) => console.log(`✓ ${msg}`),
  warn: (msg: string) => console.warn(`⚠ ${msg}`),
  err: (msg: string) => console.error(`✗ ${msg}`),
};

/** 印出驗證結果，回傳是否通過（無 error） */
export function reportValidation(label: string, r: ValidationResult): boolean {
  const errors = r.issues.filter((i) => i.level === 'error');
  const warnings = r.issues.filter((i) => i.level === 'warning');
  for (const w of warnings) log.warn(`${w.target ? `[${w.target}] ` : ''}${w.message}`);
  for (const e of errors) log.err(`${e.target ? `[${e.target}] ` : ''}${e.message}`);
  if (errors.length === 0) log.ok(`${label}：符合 LINE 規格${warnings.length ? `（${warnings.length} 項提醒）` : ''}`);
  return errors.length === 0;
}
