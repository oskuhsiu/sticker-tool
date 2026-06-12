/**
 * 疊字（瀏覽器版）：canvas fillText/strokeText。
 * CLI 版要 base64 內嵌字型防豆腐；瀏覽器自帶 CJK fallback，直接用系統字型即可，
 * 也支援使用者上傳字型檔（FontFace 註冊後以家族名引用）。
 * 先畫粗外框（halo）再畫本體 → 任何底色上都可讀（與 CLI 版相同的兩層畫法）。
 */

import { parseColor, toCss } from '@core/color.js';
import type { TextSpec } from '@core/types.js';
import { fromCanvas, toCanvas, type Raster } from './raster.js';

/** 預設字族：系統 UI 字型 + 常見 CJK fallback */
export const DEFAULT_FONT_FAMILY =
  'system-ui, -apple-system, "PingFang TC", "Microsoft JhengHei", "Noto Sans CJK TC", sans-serif';

const UPLOAD_FAMILY = 'stk-user-font';
let uploadedFont: FontFace | null = null;

/** 註冊使用者上傳的字型檔（.otf/.ttf/.woff/.woff2），回傳可填入 TextSpec.font 的家族名 */
export async function registerUploadedFont(file: File): Promise<string> {
  const face = new FontFace(UPLOAD_FAMILY, await file.arrayBuffer());
  await face.load();
  if (uploadedFont) document.fonts.delete(uploadedFont);
  document.fonts.add(face);
  uploadedFont = face;
  return UPLOAD_FAMILY;
}

/** 在貼圖上疊字並回傳新 Raster。text.font 為 CSS 字族（'' 用預設）。 */
export function overlayText(input: Raster, text: TextSpec): Raster {
  const { width: W, height: H } = input;
  if (W === 0 || H === 0 || !text.content) return input;

  const family = text.font.trim() ? text.font : DEFAULT_FONT_FAMILY;
  const cx = (text.x / 100) * W;
  const cy = (text.y / 100) * H;
  const fill = toCss(parseColor(text.color));
  const outline = toCss(parseColor(text.outlineColor ?? '#ffffff'));
  const outlineW = text.outlineWidth ?? Math.max(2, Math.round(text.size * 0.08));

  const canvas = toCanvas(input);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('無法取得 2D canvas context');
  ctx.font = `${text.size}px ${family}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // 外框（halo）：stroke 寬度 = outlineW×2，圓角接合避免尖刺
  ctx.lineJoin = 'round';
  ctx.lineWidth = outlineW * 2;
  ctx.strokeStyle = outline;
  ctx.strokeText(text.content, cx, cy);
  // 本體
  ctx.fillStyle = fill;
  ctx.fillText(text.content, cx, cy);
  return fromCanvas(canvas);
}
