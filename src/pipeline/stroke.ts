/**
 * 白色描邊（可開關）：alpha 擴張 → 填色（白）→ 原圖疊上。
 * 在「最終解析度」上施作（見 processStatic），描邊寬度才是穩定的 px 值。
 *
 * 擴張用 blur + threshold 近似形態學膨脹：視覺上是平滑外框，
 * 寬度約等於設定值（描邊是風格化裝飾，非精密尺寸需求）。
 */

import sharp from 'sharp';
import { parseColor } from '../core/color.js';
import type { StrokeSpec } from '../core/types.js';

export async function applyStroke(input: Buffer, stroke: StrokeSpec): Promise<Buffer> {
  if (!stroke.enabled || stroke.width <= 0) return input;

  const meta = await sharp(input).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  if (W === 0 || H === 0) return input;

  const { r, g, b } = parseColor(stroke.color);
  const sigma = Math.max(0.3, stroke.width / 1.3);

  // 1) 取 alpha → blur 擴散 → threshold 變實心 → 得到「原形狀外擴 ~width px」的遮罩
  const expandedAlpha = await sharp(input)
    .ensureAlpha()
    .extractChannel('alpha')
    .blur(sigma)
    .threshold(8)
    .toColourspace('b-w')
    .png()
    .toBuffer();

  // 2) 純色描邊圖層：solid color + 擴張後的 alpha
  const strokeLayer = await sharp({
    create: { width: W, height: H, channels: 3, background: { r, g, b } },
  })
    .joinChannel(expandedAlpha)
    .png()
    .toBuffer();

  // 3) 原圖疊上：中心保留原內容，邊緣露出描邊色
  const original = await sharp(input).ensureAlpha().png().toBuffer();
  return sharp(strokeLayer).composite([{ input: original, blend: 'over' }]).png().toBuffer();
}
