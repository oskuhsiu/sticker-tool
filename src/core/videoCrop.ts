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

/**
 * Source-pixel boundaries for one axis of a video grid.
 *
 * The first and last entries are editable outer bounds contained by the
 * source; internal entries are editable separators. A readonly array is
 * accepted so callers can keep their editor state immutable.
 */
export type VideoAxisCuts = readonly number[];

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

/** Return equal source-pixel boundaries with deterministic rounded positions. */
export function equalVideoAxisCuts(total: number, cells: number): number[] {
  const source = positiveInt('total', total);
  const count = positiveInt('cells', cells);
  if (source < count) {
    throw new RangeError(`cells ${count} exceed source size ${source}`);
  }
  return Array.from({ length: count + 1 }, (_, index) => Math.round((index * source) / count));
}

/**
 * Move one grid guide to a proposed source-pixel position.
 *
 * Positions may be fractional while converting from a rendered pointer event;
 * they are rounded to the nearest integer and clamped to the source and their
 * neighbor so every cell retains at least one source pixel. The input array is
 * never mutated.
 */
export function moveVideoGuide(
  cuts: VideoAxisCuts,
  index: number,
  position: number,
  sourceSize: number,
): number[] {
  const source = positiveInt('sourceSize', sourceSize);
  if (!Array.isArray(cuts) || cuts.length < 2) {
    throw new RangeError('cuts must contain two outer bounds');
  }
  if (!Number.isInteger(index) || index < 0 || index >= cuts.length) {
    throw new RangeError(`guide index ${index} must address an existing guide`);
  }
  if (!Number.isFinite(position)) {
    throw new RangeError(`guide position must be finite, got ${position}`);
  }

  // Validate the existing boundaries before using their neighbors as clamps.
  // This keeps the helper deterministic even when called independently of
  // planVideoGrid().
  for (let cursor = 0; cursor < cuts.length; cursor++) {
    const cut = cuts[cursor]!;
    if (!Number.isSafeInteger(cut)) {
      throw new RangeError(`cuts[${cursor}] must be a safe integer, got ${cut}`);
    }
    if (cut < 0 || cut > source) {
      throw new RangeError(`cuts[${cursor}] must stay within 0 and ${source}`);
    }
    if (cursor > 0 && cut <= cuts[cursor - 1]!) {
      throw new RangeError(`cuts must be strictly increasing at index ${cursor}`);
    }
  }

  const rounded = Math.round(position);
  // Math.round() of a very large finite value can exceed the safe-integer
  // range.  Clamp it against safe neighboring cuts first; the result is still
  // guaranteed to be an integer in the legal interval.
  const lower = index === 0 ? 0 : cuts[index - 1]! + 1;
  const upper = index === cuts.length - 1 ? source : cuts[index + 1]! - 1;
  const next = Math.min(upper, Math.max(lower, rounded));
  const result = [...cuts];
  result[index] = next;
  return result;
}

function validateVideoAxisCuts(
  name: 'xCuts' | 'yCuts',
  cuts: VideoAxisCuts | undefined,
  sourceSize: number,
  cells: number,
): number[] {
  if (cuts === undefined) return equalVideoAxisCuts(sourceSize, cells);
  if (!Array.isArray(cuts)) {
    throw new RangeError(`${name} must be an array of source-pixel cuts`);
  }
  if (cuts.length !== cells + 1) {
    throw new RangeError(`${name} must contain exactly ${cells + 1} cuts, got ${cuts.length}`);
  }
  const out = Array.from(cuts);
  for (let index = 0; index < out.length; index++) {
    const cut = out[index]!;
    if (!Number.isSafeInteger(cut)) {
      throw new RangeError(`${name}[${index}] must be a safe integer, got ${cut}`);
    }
    if (cut < 0 || cut > sourceSize) {
      throw new RangeError(`${name} must stay within 0 and ${sourceSize}`);
    }
    if (index > 0 && cut <= out[index - 1]!) {
      throw new RangeError(`${name} must be strictly increasing at index ${index}`);
    }
  }
  return out;
}

/** Plan stable row-major crop rectangles from equal or explicit axis cuts. */
export function planVideoGrid(args: {
  sourceWidth: number;
  sourceHeight: number;
  cols: number;
  rows: number;
  count: number;
  xCuts?: VideoAxisCuts;
  yCuts?: VideoAxisCuts;
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

  const xs = validateVideoAxisCuts('xCuts', args.xCuts, sourceWidth, cols);
  const ys = validateVideoAxisCuts('yCuts', args.yCuts, sourceHeight, rows);
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

/** Product-specific canvas baked into a Video raw master. */
export function planVideoOutputCanvas(
  target: import('./videoProject.js').VideoOutputTarget,
  cropWidth: number,
  cropHeight: number,
): { width: number; height: number } {
  positiveInt('cropWidth', cropWidth);
  positiveInt('cropHeight', cropHeight);
  if (target === 'animated-emoji') return { width: 180, height: 180 };
  if (target === 'popup') return { width: 480, height: 480 };
  if (target === 'animated-sticker') return planAnimatedCanvas(cropWidth, cropHeight);
  throw new RangeError(`unsupported Video output target: ${String(target)}`);
}
