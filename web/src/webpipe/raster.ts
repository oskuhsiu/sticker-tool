/**
 * 瀏覽器版影像基礎操作：取代 CLI 版的 sharp。
 *
 * 統一以 Raster（未預乘的 RGBA buffer）在 pipeline 各步之間傳遞，
 * 只有「解碼輸入檔」與「縮放/畫字」必須過 canvas；裁切、padding、平移、
 * 合成等一律純 TypedArray 運算，避免 canvas 反覆 premultiply 失真。
 */

export interface Raster {
  /** RGBA（未預乘），長度 = width*height*4 */
  data: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
}

export interface RGBA8 {
  r: number;
  g: number;
  b: number;
  /** 0–255 */
  a: number;
}

export const TRANSPARENT: RGBA8 = { r: 0, g: 0, b: 0, a: 0 };

export function createRaster(width: number, height: number, fill: RGBA8 = TRANSPARENT): Raster {
  const data = new Uint8ClampedArray(width * height * 4);
  if (fill.r || fill.g || fill.b || fill.a) {
    for (let p = 0; p < width * height; p++) {
      data[p * 4] = fill.r;
      data[p * 4 + 1] = fill.g;
      data[p * 4 + 2] = fill.b;
      data[p * 4 + 3] = fill.a;
    }
  }
  return { data, width, height };
}

export function cloneRaster(r: Raster): Raster {
  return { data: new Uint8ClampedArray(r.data), width: r.width, height: r.height };
}

/** 解碼輸入檔（PNG/JPEG/WebP/GIF 首格…）→ Raster；套 EXIF 方向（對應 sharp .rotate()） */
export async function decodeBlob(blob: Blob): Promise<Raster> {
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  try {
    const canvas = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('無法取得 2D canvas context');
    ctx.drawImage(bmp, 0, 0);
    const id = ctx.getImageData(0, 0, bmp.width, bmp.height);
    return { data: id.data, width: bmp.width, height: bmp.height };
  } finally {
    bmp.close();
  }
}

export function toImageData(r: Raster): ImageData {
  return new ImageData(r.data, r.width, r.height);
}

export function toCanvas(r: Raster): OffscreenCanvas {
  const canvas = new OffscreenCanvas(r.width, r.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('無法取得 2D canvas context');
  ctx.putImageData(toImageData(r), 0, 0);
  return canvas;
}

export function fromCanvas(canvas: OffscreenCanvas): Raster {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('無法取得 2D canvas context');
  const id = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { data: id.data, width: canvas.width, height: canvas.height };
}

/** 等比/非等比縮放（canvas，高品質取樣）。對應 sharp.resize(fit:'fill')。 */
export function resizeRaster(r: Raster, width: number, height: number): Raster {
  if (width === r.width && height === r.height) return r;
  const src = toCanvas(r);
  const dst = new OffscreenCanvas(width, height);
  const ctx = dst.getContext('2d');
  if (!ctx) throw new Error('無法取得 2D canvas context');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, r.width, r.height, 0, 0, width, height);
  return fromCanvas(dst);
}

/** 裁切（純複製，不過 canvas）。對應 sharp.extract。 */
export function cropRaster(r: Raster, left: number, top: number, width: number, height: number): Raster {
  if (left < 0 || top < 0 || left + width > r.width || top + height > r.height) {
    throw new RangeError(`裁切範圍 (${left},${top} ${width}×${height}) 超出 ${r.width}×${r.height}`);
  }
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const srcOff = ((top + y) * r.width + left) * 4;
    out.set(r.data.subarray(srcOff, srcOff + width * 4), y * width * 4);
  }
  return { data: out, width, height };
}

export interface PadSpec {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
}

/** 四周加邊（純複製）。對應 sharp.extend。 */
export function padRaster(r: Raster, pad: PadSpec, bg: RGBA8 = TRANSPARENT): Raster {
  const top = pad.top ?? 0;
  const bottom = pad.bottom ?? 0;
  const left = pad.left ?? 0;
  const right = pad.right ?? 0;
  const W = r.width + left + right;
  const H = r.height + top + bottom;
  const out = createRaster(W, H, bg);
  for (let y = 0; y < r.height; y++) {
    out.data.set(r.data.subarray(y * r.width * 4, (y + 1) * r.width * 4), ((top + y) * W + left) * 4);
  }
  return out;
}

/** source-over 合成（未預乘 alpha 的正確混色）。對應 sharp.composite(blend:'over')。 */
export function compositeOver(dst: Raster, src: Raster, dx = 0, dy = 0): Raster {
  const out = cloneRaster(dst);
  const x0 = Math.max(0, dx);
  const y0 = Math.max(0, dy);
  const x1 = Math.min(dst.width, dx + src.width);
  const y1 = Math.min(dst.height, dy + src.height);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const si = ((y - dy) * src.width + (x - dx)) * 4;
      const di = (y * dst.width + x) * 4;
      const sa = src.data[si + 3]! / 255;
      if (sa === 0) continue;
      const da = out.data[di + 3]! / 255;
      const oa = sa + da * (1 - sa);
      if (oa === 0) continue;
      for (let c = 0; c < 3; c++) {
        out.data[di + c] = Math.round(
          (src.data[si + c]! * sa + out.data[di + c]! * da * (1 - sa)) / oa,
        );
      }
      out.data[di + 3] = Math.round(oa * 255);
    }
  }
  return out;
}

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 內容（alpha > threshold）的 bounding box；全透明回 null。對應 sharp.trim 的透明邊判定。 */
export function trimBounds(r: Raster, alphaThreshold = 10): Box | null {
  let minx = r.width;
  let miny = r.height;
  let maxx = -1;
  let maxy = -1;
  for (let y = 0; y < r.height; y++) {
    for (let x = 0; x < r.width; x++) {
      if (r.data[(y * r.width + x) * 4 + 3]! > alphaThreshold) {
        if (x < minx) minx = x;
        if (x > maxx) maxx = x;
        if (y < miny) miny = y;
        if (y > maxy) maxy = y;
      }
    }
  }
  if (maxx < 0) return null;
  return { left: minx, top: miny, width: maxx - minx + 1, height: maxy - miny + 1 };
}

/** 平移內容（dx/dy 正 = 右/下移），露出的邊用 bg 填，輸出維持原尺寸。 */
export function translateRaster(r: Raster, dx: number, dy: number, bg: RGBA8 = TRANSPARENT): Raster {
  if (dx === 0 && dy === 0) return r;
  const out = createRaster(r.width, r.height, bg);
  const x0 = Math.max(0, dx);
  const x1 = Math.min(r.width, r.width + dx);
  const w = x1 - x0;
  if (w <= 0) return out;
  for (let y = 0; y < r.height; y++) {
    const sy = y - dy;
    if (sy < 0 || sy >= r.height) continue;
    const srcOff = (sy * r.width + (x0 - dx)) * 4;
    out.data.set(r.data.subarray(srcOff, srcOff + w * 4), (y * r.width + x0) * 4);
  }
  return out;
}

/** 把處理權讓回 UI（長流程中穿插呼叫，避免畫面凍結） */
export function yieldToUI(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
