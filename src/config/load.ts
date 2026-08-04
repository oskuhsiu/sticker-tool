/**
 * 讀取 YAML/JSON 設定檔 → 驗證（zod）→ 正規化成 core 的 PackConfig。
 *
 * 正規化規則：
 *  - kind：先解析 product，再由 package.animated / frames 決定是否 animated。
 *  - removeBackground 省略時依來源：local→true、ai→false（解 I-10 #2 預設來源）。
 *  - maxSize 省略時用該 kind 的規格上限。
 *  - grid "4x3" → {cols,rows}；"auto" 保留。
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { ANIMATED_EMOJI_SPEC, ANIMATED_SPEC, maxBounds } from '../core/spec.js';
import type { LinePackKind, PackConfig } from '../core/types.js';
import { ConfigSchema, type RawConfig } from './schema.js';

function parseGrid(grid: 'auto' | string): 'auto' | { cols: number; rows: number } {
  if (grid === 'auto') return 'auto';
  const m = /^(\d+)\s*[xX×]\s*(\d+)$/.exec(grid);
  if (!m) throw new Error(`grid 格式錯誤「${grid}」`);
  return { cols: Number(m[1]), rows: Number(m[2]) };
}

/** 把驗證過的 raw config 正規化成 PackConfig */
export function normalizeConfig(raw: RawConfig): PackConfig {
  const hasFrames = raw.stickers.some((s) => Array.isArray(s.frames) && s.frames.length > 0);
  const animated = raw.package.animated === true || hasFrames;
  const kind: LinePackKind = raw.package.product === 'emoji'
    ? animated ? 'animated-emoji' : 'emoji'
    : animated ? 'animated' : 'static';

  const removeBackground =
    raw.processing.removeBackground ?? (raw.source === 'local' ? true : false);
  const maxSize: [number, number] =
    raw.processing.maxSize ?? [maxBounds(kind).width, maxBounds(kind).height];
  const animationMaxBytes = raw.animation.maxBytes ?? (
    raw.package.product === 'emoji' ? ANIMATED_EMOJI_SPEC.maxBytes : ANIMATED_SPEC.maxBytes
  );

  return {
    name: raw.package.name,
    count: raw.package.count,
    source: raw.source,
    kind,
    emojiSet: raw.package.product === 'emoji' ? raw.package.emojiSet : undefined,
    ai: {
      style: raw.ai.style,
      transparent: raw.ai.transparent,
      isCharacter: raw.ai.isCharacter,
      grid: parseGrid(raw.ai.grid),
      reference: raw.ai.reference,
      crop: raw.ai.crop,
      forceOversizeSet: raw.ai.forceOversizeSet,
      cellVariations: raw.ai.cellVariations,
    },
    processing: {
      removeBackground,
      stroke: raw.processing.stroke,
      maxSize,
    },
    cover: raw.cover,
    animation: {
      ...raw.animation,
      maxBytes: animationMaxBytes,
      autoFit: raw.animation.autoFit ?? (raw.package.product === 'emoji' ? false : true),
    },
    stickers: raw.stickers,
  };
}

/** 讀檔 + 驗證 + 正規化 */
export async function loadConfig(configPath: string): Promise<PackConfig> {
  const text = await readFile(configPath, 'utf8');
  let data: unknown;
  try {
    // YAML 是 JSON 的超集，.json 也能解析；但 .json 用 JSON.parse 錯誤訊息較清楚
    data = path.extname(configPath).toLowerCase() === '.json' ? JSON.parse(text) : YAML.parse(text);
  } catch (e) {
    throw new Error(`設定檔解析失敗（${configPath}）：${(e as Error).message}`);
  }
  const parsed = ConfigSchema.safeParse(data);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`設定檔不符規範（${configPath}）：\n${lines.join('\n')}`);
  }
  return normalizeConfig(parsed.data);
}

/** 解析相對於設定檔目錄的路徑（reference / input / frames / font） */
export function resolveRelative(configPath: string, p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(path.dirname(configPath), p);
}
