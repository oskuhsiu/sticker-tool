import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allocateExactDelays,
  candidateExpansionOrder,
  clipFrameIntervals,
  initialCandidateIndices,
  pickedVisualFrameIds,
  representativeSelectionDurations,
  selectTimeUniformIndices,
  type SourceFrameTiming,
} from '../src/core/videoTimeline.js';

const frames: SourceFrameTiming[] = [
  { sourceIndex: 0, timestampUs: 500_000, durationUs: 100_000 },
  { sourceIndex: 1, timestampUs: 600_000, durationUs: 250_000 },
  { sourceIndex: 2, timestampUs: 850_000, durationUs: 50_000 },
  { sourceIndex: 3, timestampUs: 900_000, durationUs: 400_000 },
];

test('clipFrameIntervals preserves VFR samples and clips both range boundaries', () => {
  assert.deepEqual(clipFrameIntervals(frames, 550_000, 1_100_000), [
    { sourceIndex: 0, timestampUs: 550_000, durationUs: 50_000 },
    { sourceIndex: 1, timestampUs: 600_000, durationUs: 250_000 },
    { sourceIndex: 2, timestampUs: 850_000, durationUs: 50_000 },
    { sourceIndex: 3, timestampUs: 900_000, durationUs: 200_000 },
  ]);
});

test('clipFrameIntervals preserves adapter metadata', () => {
  const visualFrames = frames.map((frame, index) => ({ ...frame, visualFrameId: `visual-${index}` }));
  const clipped = clipFrameIntervals(visualFrames, 550_000, 1_100_000);
  assert.deepEqual(clipped.map((frame) => frame.visualFrameId), ['visual-0', 'visual-1', 'visual-2', 'visual-3']);
});

test('time-uniform selection and expansion are deterministic on non-zero timestamps', () => {
  assert.deepEqual(selectTimeUniformIndices(frames, 3), [0, 1, 3]);
  assert.deepEqual(initialCandidateIndices(frames, 3), [0, 1, 3]);
  assert.deepEqual(initialCandidateIndices([], 3), []);
  assert.deepEqual(candidateExpansionOrder(frames, 2), [0, 3, 1, 2]);
});

test('picked visuals follow planned or final source selections and deduplicate shared visuals', () => {
  const visuals = [
    { ...frames[0]!, visualFrameId: 'visual-a' },
    { ...frames[1]!, visualFrameId: 'visual-a' },
    { ...frames[2]!, visualFrameId: 'visual-b' },
    { ...frames[3]!, visualFrameId: 'visual-c' },
  ];
  assert.deepEqual(pickedVisualFrameIds(visuals, 3), ['visual-a', 'visual-c']);
  assert.deepEqual(pickedVisualFrameIds(visuals, 3, [0, 2, 3]), ['visual-a', 'visual-b', 'visual-c']);
});

test('selected durations include skipped VFR presentation intervals and the final tail', () => {
  assert.deepEqual(representativeSelectionDurations(frames, [0, 2, 3]), [350_000, 50_000, 400_000]);
});

for (const frameCount of [5, 6, 7, 11, 20]) {
  for (const totalMs of [1000, 2000, 3000, 4000]) {
    test(`exact weighted delays: ${frameCount} frames in ${totalMs}ms`, () => {
      const delays = allocateExactDelays(
        Array.from({ length: frameCount }, (_, index) => 20_000 + index * 137),
        totalMs,
      );
      assert.equal(delays.length, frameCount);
      assert.ok(delays.every((delay) => Number.isInteger(delay) && delay > 0));
      assert.equal(delays.reduce((sum, delay) => sum + delay, 0), totalMs);
    });
  }
}
