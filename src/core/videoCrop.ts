/**
 * Video-sheet planning rules shared by browser adapters.
 *
 * This module only deals with geometry and integer millisecond timelines. It
 * deliberately contains no DOM, Canvas, codec, or filesystem dependencies.
 */

export interface VideoCropRect {
  id: string;
  index: number;
  row: number;
  col: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface VideoGridPlan {
  sourceWidth: number;
  sourceHeight: number;
  cols: number;
  rows: number;
  count: number;
  rects: VideoCropRect[];
}

function positiveInt(name: string, value: number): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer, got ${value}`);
  }
  return value;
}

/** Plan stable row-major crop rectangles that cover an equally divided grid. */
export function planVideoGrid(args: {
  sourceWidth: number;
  sourceHeight: number;
  cols: number;
  rows: number;
  count: number;
}): VideoGridPlan {
  const sourceWidth = positiveInt('sourceWidth', args.sourceWidth);
  const sourceHeight = positiveInt('sourceHeight', args.sourceHeight);
  const cols = positiveInt('cols', args.cols);
  const rows = positiveInt('rows', args.rows);
  const count = positiveInt('count', args.count);
  const capacity = cols * rows;
  if (count > capacity) {
    throw new RangeError(`crop count ${count} exceeds grid capacity ${capacity}`);
  }
  if (sourceWidth < cols || sourceHeight < rows) {
    throw new RangeError(`grid ${cols}x${rows} exceeds source ${sourceWidth}x${sourceHeight}`);
  }

  const xs = Array.from({ length: cols + 1 }, (_, i) => Math.round((i * sourceWidth) / cols));
  const ys = Array.from({ length: rows + 1 }, (_, i) => Math.round((i * sourceHeight) / rows));
  const rects: VideoCropRect[] = [];
  for (let index = 0; index < count; index++) {
    const row = Math.floor(index / cols);
    const col = index % cols;
    const left = xs[col]!;
    const top = ys[row]!;
    rects.push({
      id: `sticker-${String(index + 1).padStart(2, '0')}`,
      index,
      row,
      col,
      left,
      top,
      width: xs[col + 1]! - left,
      height: ys[row + 1]! - top,
    });
  }
  return { sourceWidth, sourceHeight, cols, rows, count, rects };
}

/**
 * Produce a deterministic inclusive timeline in integer milliseconds.
 * The last timestamp is clamped to endMs - 1 so a browser does not seek past EOF.
 */
export function planSampleTimestamps(startMs: number, endMs: number, frameCount: number): number[] {
  if (!Number.isInteger(startMs) || !Number.isInteger(endMs)) {
    throw new RangeError('startMs and endMs must be integer milliseconds');
  }
  positiveInt('frameCount', frameCount);
  if (startMs < 0 || endMs <= startMs) {
    throw new RangeError(`invalid sample range ${startMs}..${endMs}`);
  }
  if (frameCount === 1) return [startMs];

  const lastMs = endMs - 1;
  const out: number[] = [];
  for (let i = 0; i < frameCount; i++) {
    const t = Math.round(startMs + (i * (lastMs - startMs)) / (frameCount - 1));
    if (out.length === 0 || t > out[out.length - 1]!) out.push(t);
  }
  return out;
}

/** Select time-uniform source indices, preserving order and unique indices. */
export function selectTimelineIndices(
  timestampsMs: readonly number[],
  startMs: number,
  endMs: number,
  targetFrames: number,
): number[] {
  positiveInt('targetFrames', targetFrames);
  if (endMs <= startMs) throw new RangeError(`invalid selection range ${startMs}..${endMs}`);

  const candidates: number[] = [];
  for (let i = 0; i < timestampsMs.length; i++) {
    const t = timestampsMs[i]!;
    if (!Number.isFinite(t)) throw new RangeError(`timestamp ${i} is not finite`);
    if (i > 0 && t <= timestampsMs[i - 1]!) {
      throw new RangeError(`timestamps must be strictly increasing at index ${i}`);
    }
    if (t >= startMs && t < endMs) candidates.push(i);
  }
  if (targetFrames >= candidates.length) return candidates;
  if (targetFrames === 1) return [candidates[0]!];

  const selected: number[] = [];
  for (let i = 0; i < targetFrames; i++) {
    const candidateIndex = Math.round((i * (candidates.length - 1)) / (targetFrames - 1));
    selected.push(candidates[candidateIndex]!);
  }
  return selected;
}

/** Split an exact total duration into positive integer per-frame delays. */
export function distributeFrameDelays(totalMs: number, frameCount: number): number[] {
  positiveInt('totalMs', totalMs);
  positiveInt('frameCount', frameCount);
  if (totalMs < frameCount) {
    throw new RangeError(`totalMs ${totalMs} is too short for ${frameCount} positive frame delays`);
  }
  const base = Math.floor(totalMs / frameCount);
  let remainder = totalMs - base * frameCount;
  return Array.from({ length: frameCount }, () => {
    const delay = base + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder--;
    return delay;
  });
}

/** LINE-compatible output canvas that preserves the crop aspect ratio. */
export function planAnimatedCanvas(cropWidth: number, cropHeight: number): { width: number; height: number } {
  positiveInt('cropWidth', cropWidth);
  positiveInt('cropHeight', cropHeight);
  const ratio = cropWidth / cropHeight;
  let width: number;
  let height: number;
  if (ratio >= 1) {
    width = Math.min(320, Math.round(270 * ratio));
    height = Math.round(width / ratio);
  } else {
    height = 270;
    width = Math.round(height * ratio);
  }
  width = Math.max(2, width - (width % 2));
  height = Math.max(2, height - (height % 2));
  if (width < 270 && height < 270) height = 270;
  return { width, height };
}
