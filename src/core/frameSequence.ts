/** Platform-neutral final-frame sequence canonicalization. */

export interface ComparableRgbaFrame {
  width: number;
  height: number;
  data: ArrayLike<number>;
}

export function equalRgbaFrames(a: ComparableRgbaFrame, b: ComparableRgbaFrame): boolean {
  if (a.width !== b.width || a.height !== b.height || a.data.length !== b.data.length) return false;
  for (let index = 0; index < a.data.length; index += 4) {
    const alphaA = a.data[index + 3];
    const alphaB = b.data[index + 3];
    if (alphaA !== alphaB) return false;
    // RGB stored below fully transparent pixels is not part of the composited visual.
    if (alphaA === 0) continue;
    if (a.data[index] !== b.data[index] || a.data[index + 1] !== b.data[index + 1] || a.data[index + 2] !== b.data[index + 2]) {
      return false;
    }
  }
  return true;
}

export interface CoalescedFrameSequence<T> {
  frames: T[];
  delaysMs: number[];
  keptIndices: number[];
  removedAdjacentIndices: number[];
}

/** Merge only adjacent equal frames, moving a removed frame's delay to the previous retained frame. */
export function coalesceAdjacentFrames<T>(
  frames: readonly T[],
  delaysMs: readonly number[],
  equals: (a: T, b: T) => boolean,
): CoalescedFrameSequence<T> {
  if (frames.length !== delaysMs.length) {
    throw new RangeError(`frame/delay length mismatch: ${frames.length}/${delaysMs.length}`);
  }
  const output: CoalescedFrameSequence<T> = {
    frames: [],
    delaysMs: [],
    keptIndices: [],
    removedAdjacentIndices: [],
  };
  for (let index = 0; index < frames.length; index++) {
    const delay = delaysMs[index]!;
    if (!Number.isSafeInteger(delay) || delay <= 0) {
      throw new RangeError(`delay ${index} must be a positive safe integer`);
    }
    const previous = output.frames[output.frames.length - 1];
    if (previous !== undefined && equals(previous, frames[index]!)) {
      output.delaysMs[output.delaysMs.length - 1]! += delay;
      output.removedAdjacentIndices.push(index);
      continue;
    }
    output.frames.push(frames[index]!);
    output.delaysMs.push(delay);
    output.keptIndices.push(index);
  }
  return output;
}

export function adjacentDuplicateIndices<T>(
  frames: readonly T[],
  equals: (a: T, b: T) => boolean,
): number[] {
  const duplicates: number[] = [];
  for (let index = 1; index < frames.length; index++) {
    if (equals(frames[index - 1]!, frames[index]!)) duplicates.push(index);
  }
  return duplicates;
}
