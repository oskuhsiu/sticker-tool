/** Platform-neutral timeline rules for the Video → APNG v2 workflow. */

export interface SourceFrameTiming {
  sourceIndex: number;
  timestampUs: number;
  durationUs: number;
}

function positiveInteger(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer, got ${value}`);
  }
  return value;
}

function validateTimeline(frames: readonly SourceFrameTiming[]): void {
  for (let index = 0; index < frames.length; index++) {
    const frame = frames[index]!;
    if (!Number.isSafeInteger(frame.sourceIndex) || frame.sourceIndex < 0) {
      throw new RangeError(`sourceIndex ${index} must be a non-negative safe integer`);
    }
    if (!Number.isSafeInteger(frame.timestampUs)) {
      throw new RangeError(`timestampUs ${index} must be a safe integer`);
    }
    positiveInteger(`durationUs ${index}`, frame.durationUs);
    if (index > 0 && frame.timestampUs <= frames[index - 1]!.timestampUs) {
      throw new RangeError(`timestamps must be strictly increasing at index ${index}`);
    }
  }
}

/** Keep sample intervals that intersect [startUs, endUs), clipping boundary durations exactly. */
export function clipFrameIntervals(
  frames: readonly SourceFrameTiming[],
  startUs: number,
  endUs: number,
): SourceFrameTiming[] {
  if (!Number.isSafeInteger(startUs) || !Number.isSafeInteger(endUs) || endUs <= startUs) {
    throw new RangeError(`invalid microsecond range ${startUs}..${endUs}`);
  }
  validateTimeline(frames);
  const clipped: SourceFrameTiming[] = [];
  for (const frame of frames) {
    const frameEndUs = frame.timestampUs + frame.durationUs;
    const intersectionStartUs = Math.max(startUs, frame.timestampUs);
    const intersectionEndUs = Math.min(endUs, frameEndUs);
    if (intersectionEndUs <= intersectionStartUs) continue;
    clipped.push({
      sourceIndex: frame.sourceIndex,
      timestampUs: intersectionStartUs,
      durationUs: intersectionEndUs - intersectionStartUs,
    });
  }
  return clipped;
}

/** Select ordered, time-uniform positions while preserving the first and last candidate. */
export function selectTimeUniformIndices(
  frames: readonly SourceFrameTiming[],
  targetFrames: number,
): number[] {
  positiveInteger('targetFrames', targetFrames);
  validateTimeline(frames);
  if (frames.length === 0) return [];
  if (targetFrames >= frames.length) return frames.map((_, index) => index);
  if (targetFrames === 1) return [0];

  const startUs = frames[0]!.timestampUs;
  const endUs = frames[frames.length - 1]!.timestampUs;
  const selected: number[] = [];
  let minimumIndex = 0;
  for (let slot = 0; slot < targetFrames; slot++) {
    const targetUs = startUs + ((endUs - startUs) * slot) / (targetFrames - 1);
    const maximumIndex = frames.length - (targetFrames - slot);
    let bestIndex = minimumIndex;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let index = minimumIndex; index <= maximumIndex; index++) {
      const distance = Math.abs(frames[index]!.timestampUs - targetUs);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }
    selected.push(bestIndex);
    minimumIndex = bestIndex + 1;
  }
  return selected;
}

/**
 * Return the initial time-uniform candidates followed by deterministic replacements.
 * Each replacement is the unused frame furthest from the currently selected timestamps.
 */
export function candidateExpansionOrder(
  frames: readonly SourceFrameTiming[],
  targetFrames: number,
): number[] {
  const initial = selectTimeUniformIndices(frames, Math.min(targetFrames, frames.length));
  const selected = new Set(initial);
  const replacements: number[] = [];
  while (selected.size < frames.length) {
    let bestIndex = -1;
    let bestDistance = -1;
    for (let index = 0; index < frames.length; index++) {
      if (selected.has(index)) continue;
      let nearest = Number.POSITIVE_INFINITY;
      for (const selectedIndex of selected) {
        nearest = Math.min(nearest, Math.abs(frames[index]!.timestampUs - frames[selectedIndex]!.timestampUs));
      }
      if (nearest > bestDistance || (nearest === bestDistance && index < bestIndex)) {
        bestDistance = nearest;
        bestIndex = index;
      }
    }
    selected.add(bestIndex);
    replacements.push(bestIndex);
  }
  return [...initial, ...replacements];
}

/** Map selected source positions to the presentation span each output frame represents. */
export function representativeSelectionDurations(
  frames: readonly SourceFrameTiming[],
  selectedIndices: readonly number[],
): number[] {
  validateTimeline(frames);
  if (frames.length === 0 || selectedIndices.length === 0) throw new RangeError('frames and selectedIndices must not be empty');
  for (let index = 0; index < selectedIndices.length; index++) {
    const selected = selectedIndices[index]!;
    if (!Number.isSafeInteger(selected) || selected < 0 || selected >= frames.length) {
      throw new RangeError(`selected index ${index} is out of range`);
    }
    if (index > 0 && selected <= selectedIndices[index - 1]!) {
      throw new RangeError('selectedIndices must be strictly increasing');
    }
  }
  const timelineEndUs = frames[frames.length - 1]!.timestampUs + frames[frames.length - 1]!.durationUs;
  return selectedIndices.map((selected, index) => {
    const startUs = frames[selected]!.timestampUs;
    const endUs = index + 1 < selectedIndices.length
      ? frames[selectedIndices[index + 1]!]!.timestampUs
      : timelineEndUs;
    return positiveInteger(`selected durationUs ${index}`, endUs - startUs);
  });
}

/** Allocate positive integer milliseconds proportionally, with an exact requested total. */
export function allocateExactDelays(durationsUs: readonly number[], totalMs: number): number[] {
  positiveInteger('totalMs', totalMs);
  if (durationsUs.length === 0) throw new RangeError('durationsUs must not be empty');
  if (totalMs < durationsUs.length) {
    throw new RangeError(`totalMs ${totalMs} is too short for ${durationsUs.length} positive delays`);
  }
  durationsUs.forEach((duration, index) => positiveInteger(`durationUs ${index}`, duration));

  const remainingMs = totalMs - durationsUs.length;
  const totalDurationUs = durationsUs.reduce((sum, duration) => sum + duration, 0);
  const allocations = durationsUs.map((duration, index) => {
    const exact = (remainingMs * duration) / totalDurationUs;
    const floor = Math.floor(exact);
    return { index, delay: floor + 1, remainder: exact - floor };
  });
  let unallocated = totalMs - allocations.reduce((sum, value) => sum + value.delay, 0);
  allocations
    .slice()
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index)
    .slice(0, unallocated)
    .forEach((value) => {
      allocations[value.index]!.delay++;
      unallocated--;
    });
  if (unallocated !== 0) throw new Error('exact delay allocation failed');
  return allocations.map((value) => value.delay);
}
