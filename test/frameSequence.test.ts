import assert from 'node:assert/strict';
import test from 'node:test';
import {
  adjacentDuplicateIndices,
  coalesceAdjacentFrames,
  equalRgbaFrames,
} from '../src/core/frameSequence.js';

const frame = (value: number) => ({ width: 1, height: 1, data: new Uint8Array([value, 0, 0, 255]) });

test('coalesceAdjacentFrames merges delay into the previous frame only', () => {
  const a = frame(1);
  const b = frame(2);
  const result = coalesceAdjacentFrames([a, frame(1), b], [100, 50, 80], equalRgbaFrames);
  assert.deepEqual(result.keptIndices, [0, 2]);
  assert.deepEqual(result.removedAdjacentIndices, [1]);
  assert.deepEqual(result.delaysMs, [150, 80]);
});

test('equal first and last frames are not treated as adjacent', () => {
  const frames = [frame(1), frame(2), frame(1)];
  assert.deepEqual(adjacentDuplicateIndices(frames, equalRgbaFrames), []);
  assert.equal(coalesceAdjacentFrames(frames, [10, 10, 10], equalRgbaFrames).frames.length, 3);
});

test('fully transparent RGB storage does not create a distinct composited visual', () => {
  assert.equal(
    equalRgbaFrames(
      { width: 1, height: 1, data: new Uint8Array([255, 0, 0, 0]) },
      { width: 1, height: 1, data: new Uint8Array([0, 255, 0, 0]) },
    ),
    true,
  );
});
