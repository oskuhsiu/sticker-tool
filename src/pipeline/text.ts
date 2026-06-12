/**
 * 依設定在貼圖上疊字（SVG rasterize → composite）。
 *
 * I-7：中文字型若靠系統 fontconfig 解析家族名，缺字型會「靜默 fallback 成豆腐」。
 * 因此本檔一律把字型檔 base64 內嵌進 SVG @font-face：
 *   - font 為檔案路徑 → 直接內嵌。
 *   - font 為家族名 → 嘗試 fc-match 解析成檔案再內嵌；解析不到就「報錯」而非靜默 fallback。
 */

import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import sharp from 'sharp';
import { parseColor, toCss } from '../core/color.js';
import type { TextSpec } from '../core/types.js';

const EMBED_FAMILY = 'stk-embedded-font';

function fontFormat(file: string): { format: string; mime: string } {
  const ext = path.extname(file).toLowerCase();
  switch (ext) {
    case '.otf':
      return { format: 'opentype', mime: 'font/otf' };
    case '.ttf':
      return { format: 'truetype', mime: 'font/ttf' };
    case '.woff':
      return { format: 'woff', mime: 'font/woff' };
    case '.woff2':
      return { format: 'woff2', mime: 'font/woff2' };
    default:
      return { format: 'opentype', mime: 'font/otf' };
  }
}

/** 嘗試用 fontconfig 把家族名解析成字型檔路徑（系統有裝 fc-match 才行） */
function fcMatchFile(family: string): string | undefined {
  try {
    const out = execFileSync('fc-match', ['-f', '%{file}', family], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out && existsSync(out) ? out : undefined;
  } catch {
    return undefined;
  }
}

/** 把字型解析成可內嵌的 @font-face CSS（解 I-7：找不到就丟錯） */
function resolveFontFace(font: string): string {
  let file: string | undefined;
  if (font.includes('/') || /\.(otf|ttf|woff2?|TTF|OTF)$/.test(font)) {
    if (!existsSync(font)) {
      throw new Error(`找不到字型檔：${font}`);
    }
    file = font;
  } else {
    file = fcMatchFile(font);
    if (!file) {
      throw new Error(
        `無法解析字型家族「${font}」：請改用字型檔路徑（.otf/.ttf），` +
          `或安裝 fontconfig（fc-match）。為避免缺字型靜默變豆腐，本工具不做系統 fallback。`,
      );
    }
  }
  const { format, mime } = fontFormat(file);
  const b64 = readFileSync(file).toString('base64');
  return `@font-face{font-family:'${EMBED_FAMILY}';src:url(data:${mime};base64,${b64}) format('${format}');}`;
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** 在貼圖上疊字並回傳新 buffer */
export async function overlayText(input: Buffer, text: TextSpec): Promise<Buffer> {
  const meta = await sharp(input).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  if (W === 0 || H === 0) return input;

  const fontFace = resolveFontFace(text.font);
  const cx = (text.x / 100) * W;
  const cy = (text.y / 100) * H;
  const fill = toCss(parseColor(text.color));
  const outline = toCss(parseColor(text.outlineColor ?? '#ffffff'));
  const outlineW = text.outlineWidth ?? Math.max(2, Math.round(text.size * 0.08));
  const content = xmlEscape(text.content);

  // 兩層 <text>：先畫粗外框（halo），再畫本體 → 任何底色上都可讀
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
<style>${fontFace}
text{font-family:'${EMBED_FAMILY}';font-size:${text.size}px;text-anchor:middle;dominant-baseline:central;}</style>
<text x="${cx}" y="${cy}" fill="${outline}" stroke="${outline}" stroke-width="${outlineW * 2}" stroke-linejoin="round">${content}</text>
<text x="${cx}" y="${cy}" fill="${fill}">${content}</text>
</svg>`;

  const textPng = await sharp(Buffer.from(svg)).png().toBuffer();
  return sharp(input)
    .ensureAlpha()
    .composite([{ input: textPng, blend: 'over' }])
    .png()
    .toBuffer();
}
