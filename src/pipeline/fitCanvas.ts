/**
 * 等比縮放 + 置中 + padding 到 bounds，確保偶數長寬與透明背景。
 *
 * 兩種輸出模式：
 *   'trim'  — 輸出貼齊內容+margin 的偶數畫布（靜態貼圖主用）。
 *   'exact' — 輸出剛好等於 bounds，內容置中加 padding（main/tab、動態固定畫布用）。
 *
 * 是否先裁掉輸入的透明邊由 trimInput 獨立控制。未指定時沿用舊行為：
 * trim 輸出會裁邊，exact 輸出保留原始畫布。
 */

import sharp from 'sharp';
import { ceilEven, floorEven } from '../core/spec.js';
import type { Bounds } from '../core/types.js';

export type FitMode = 'trim' | 'exact';

export interface FitOptions {
  bounds: Bounds;
  mode?: FitMode;
  /** 是否先裁掉輸入透明邊；預設為 mode === 'trim'，以保留既有行為。 */
  trimInput?: boolean;
  /** 內容四周保留的透明邊（px）。LINE 建議靜態留 10px。 */
  marginPx?: number;
  /** padding 底色，預設全透明 */
  background?: sharp.Color;
  /** 允許把小圖放大以填滿（預設 true，貼圖通常想填滿畫面） */
  allowUpscale?: boolean;
}

export interface FitResult {
  buffer: Buffer;
  width: number;
  height: number;
}

const TRANSPARENT: sharp.Color = { r: 0, g: 0, b: 0, alpha: 0 };

/** 載入並保證 RGBA、去除方向 metadata */
function loadRGBA(input: Buffer | string): sharp.Sharp {
  return sharp(input, { failOn: 'none' }).rotate().ensureAlpha();
}

/** 去透明邊後回傳內容 buffer 與尺寸；無可裁切時回原圖 */
async function trimToContent(img: sharp.Sharp): Promise<{ buffer: Buffer; width: number; height: number }> {
  try {
    const { data, info } = await img
      .clone()
      .trim({ background: TRANSPARENT, threshold: 10 })
      .png()
      .toBuffer({ resolveWithObject: true });
    return { buffer: data, width: info.width, height: info.height };
  } catch {
    // 整張同色/全透明 → sharp 會丟 "Image to trim is blank"；退回原圖
    const { data, info } = await img.clone().png().toBuffer({ resolveWithObject: true });
    return { buffer: data, width: info.width, height: info.height };
  }
}

/**
 * 把一張圖 fit 進指定 bounds。
 */
export async function fitCanvas(input: Buffer | string, opts: FitOptions): Promise<FitResult> {
  const {
    bounds,
    mode = 'trim',
    trimInput = mode === 'trim',
    marginPx = 0,
    background = TRANSPARENT,
    allowUpscale = true,
  } = opts;

  const base = loadRGBA(input);
  const content =
    trimInput
      ? await trimToContent(base)
      : await (async () => {
          const { data, info } = await base.png().toBuffer({ resolveWithObject: true });
          return { buffer: data, width: info.width, height: info.height };
        })();

  // 可用內容區（扣掉左右/上下 margin）
  const availW = Math.max(2, bounds.width - 2 * marginPx);
  const availH = Math.max(2, bounds.height - 2 * marginPx);

  let scale = Math.min(availW / content.width, availH / content.height);
  if (!allowUpscale) scale = Math.min(scale, 1);

  const scaledW = Math.max(1, Math.round(content.width * scale));
  const scaledH = Math.max(1, Math.round(content.height * scale));

  const resized = await sharp(content.buffer)
    .resize(scaledW, scaledH, { fit: 'fill' })
    .png()
    .toBuffer();

  // 決定最終畫布尺寸
  let canvasW: number;
  let canvasH: number;
  if (mode === 'exact') {
    canvasW = bounds.width;
    canvasH = bounds.height;
  } else {
    canvasW = Math.min(ceilEven(scaledW + 2 * marginPx), floorEven(bounds.width));
    canvasH = Math.min(ceilEven(scaledH + 2 * marginPx), floorEven(bounds.height));
    // 保證至少容得下內容
    canvasW = Math.max(canvasW, ceilEven(scaledW));
    canvasH = Math.max(canvasH, ceilEven(scaledH));
  }

  const padLeft = Math.max(0, Math.floor((canvasW - scaledW) / 2));
  const padRight = Math.max(0, canvasW - scaledW - padLeft);
  const padTop = Math.max(0, Math.floor((canvasH - scaledH) / 2));
  const padBottom = Math.max(0, canvasH - scaledH - padTop);

  const out = await sharp(resized)
    .extend({ top: padTop, bottom: padBottom, left: padLeft, right: padRight, background })
    .png()
    .toBuffer();

  // extend 後尺寸 = scaled + pad，理應等於 canvas；保險起見回讀
  const meta = await sharp(out).metadata();
  return { buffer: out, width: meta.width ?? canvasW, height: meta.height ?? canvasH };
}
