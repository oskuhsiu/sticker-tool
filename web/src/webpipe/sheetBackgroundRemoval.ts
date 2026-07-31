import { cropRaster, resizeRaster, type Raster } from './raster.js';

export interface RemoveSheetBackgroundOptions {
  cols: number;
  rows: number;
  remove: (input: Raster, signal?: AbortSignal) => Promise<Raster>;
  signal?: AbortSignal;
  overlapRatio?: number;
  onProgress?: (completed: number, total: number) => void;
}

/**
 * Run a semantic remover on overlapping nominal cells, merge their alpha masks
 * back into the original-size sheet, then let component-aware cutting inspect
 * the complete mask. RGB always comes from the original sheet.
 */
export async function removeSheetBackgroundByCells(
  input: Raster,
  options: RemoveSheetBackgroundOptions,
): Promise<Raster> {
  const { cols, rows } = options;
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1) {
    throw new Error('語意去背需要有效的組圖網格');
  }
  const mergedAlpha = new Uint8ClampedArray(input.width * input.height);
  const cellWidth = input.width / cols;
  const cellHeight = input.height / rows;
  const overlap = Math.max(0, Math.min(0.25, options.overlapRatio ?? 0.12));
  const total = cols * rows;
  let completed = 0;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (options.signal?.aborted) throw new DOMException('組圖去背已取消', 'AbortError');
      const marginX = Math.round(cellWidth * overlap);
      const marginY = Math.round(cellHeight * overlap);
      const left = Math.max(0, Math.floor(col * cellWidth) - marginX);
      const top = Math.max(0, Math.floor(row * cellHeight) - marginY);
      const right = Math.min(input.width, Math.ceil((col + 1) * cellWidth) + marginX);
      const bottom = Math.min(input.height, Math.ceil((row + 1) * cellHeight) + marginY);
      const crop = cropRaster(input, left, top, right - left, bottom - top);
      let removed = await options.remove(crop, options.signal);
      if (removed.width !== crop.width || removed.height !== crop.height) {
        removed = resizeRaster(removed, crop.width, crop.height);
      }
      for (let y = 0; y < crop.height; y++) {
        for (let x = 0; x < crop.width; x++) {
          const sheetPixel = (top + y) * input.width + left + x;
          const alpha = removed.data[(y * crop.width + x) * 4 + 3]!;
          if (alpha > mergedAlpha[sheetPixel]!) mergedAlpha[sheetPixel] = alpha;
        }
      }
      completed++;
      options.onProgress?.(completed, total);
    }
  }

  const output = new Uint8ClampedArray(input.data);
  for (let pixel = 0; pixel < mergedAlpha.length; pixel++) {
    const offset = pixel * 4 + 3;
    output[offset] = Math.round(input.data[offset]! * mergedAlpha[pixel]! / 255);
  }
  return { data: output, width: input.width, height: input.height };
}
