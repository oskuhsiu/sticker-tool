import assert from 'node:assert/strict';
import test from 'node:test';
import {
  equalVideoAxisCuts,
  moveVideoGuide,
  planAnimatedCanvas,
  planVideoGrid,
  planVideoOutputCanvas,
} from '../src/core/videoCrop.js';

test('Video grid keeps the existing equal source-pixel geometry by default', () => {
  assert.deepEqual(equalVideoAxisCuts(10, 3), [0, 3, 7, 10]);
  const grid = planVideoGrid({ sourceWidth: 10, sourceHeight: 6, cols: 3, rows: 2, count: 6 });
  assert.deepEqual(grid.rects.map((rect) => [rect.left, rect.top, rect.width, rect.height]), [
    [0, 0, 3, 3], [3, 0, 4, 3], [7, 0, 3, 3],
    [0, 3, 3, 3], [3, 3, 4, 3], [7, 3, 3, 3],
  ]);
});

test('Video grid accepts unequal cuts and emits gap-free, non-overlapping row-major rects', () => {
  const xCuts = [0, 100, 275, 400];
  const yCuts = [0, 80, 200];
  const grid = planVideoGrid({
    sourceWidth: 400,
    sourceHeight: 200,
    cols: 3,
    rows: 2,
    count: 6,
    xCuts,
    yCuts,
  });
  assert.deepEqual(grid.rects.map((rect) => [rect.left, rect.top, rect.width, rect.height]), [
    [0, 0, 100, 80], [100, 0, 175, 80], [275, 0, 125, 80],
    [0, 80, 100, 120], [100, 80, 175, 120], [275, 80, 125, 120],
  ]);

  const area = grid.rects.reduce((sum, rect) => sum + rect.width * rect.height, 0);
  assert.equal(area, grid.sourceWidth * grid.sourceHeight);
  for (let first = 0; first < grid.rects.length; first++) {
    const a = grid.rects[first]!;
    for (let second = first + 1; second < grid.rects.length; second++) {
      const b = grid.rects[second]!;
      const overlaps =
        a.left < b.left + b.width && b.left < a.left + a.width &&
        a.top < b.top + b.height && b.top < a.top + a.height;
      assert.equal(overlaps, false, `rects ${first} and ${second} overlap`);
    }
  }
});

test('Video grid rejects malformed explicit source-pixel cuts', () => {
  const base = { sourceWidth: 100, sourceHeight: 80, cols: 2, rows: 2, count: 4 } as const;
  assert.throws(() => planVideoGrid({ ...base, xCuts: [0, 100] }), /xCuts must contain exactly 3 cuts/);
  assert.throws(() => planVideoGrid({ ...base, xCuts: [1, 50, 100] }), /xCuts must start at 0/);
  assert.throws(() => planVideoGrid({ ...base, yCuts: [0, 40, 79] }), /yCuts must start at 0 and end at 80/);
  assert.throws(() => planVideoGrid({ ...base, xCuts: [0, 50.5, 100] }), /xCuts\[1\] must be a safe integer/);
  assert.throws(() => planVideoGrid({ ...base, xCuts: [0, 100, 100] }), /xCuts must be strictly increasing/);
  assert.throws(
    () => planVideoGrid({ ...base, xCuts: [0, Number.MAX_SAFE_INTEGER + 1, 100] }),
    /xCuts\[1\] must be a safe integer/,
  );
});

test('Video guide movement rounds, clamps to neighbors, validates index, and supports exact reset', () => {
  const cuts = [0, 100, 200, 300];
  assert.deepEqual(moveVideoGuide(cuts, 1, 150.5), [0, 151, 200, 300]);
  assert.deepEqual(cuts, [0, 100, 200, 300], 'moving a guide must not mutate editor state');
  assert.deepEqual(moveVideoGuide(cuts, 1, -10), [0, 1, 200, 300]);
  assert.deepEqual(moveVideoGuide(cuts, 1, 999), [0, 199, 200, 300]);
  assert.throws(() => moveVideoGuide(cuts, 0, 120), /internal separator/);
  assert.throws(() => moveVideoGuide(cuts, 3, 120), /internal separator/);
  assert.throws(() => moveVideoGuide(cuts, 1.5, 120), /internal separator/);
  assert.deepEqual(equalVideoAxisCuts(300, 3), [0, 100, 200, 300]);
});

test('Video output canvas is selected before ingest without stretching product contracts', () => {
  assert.deepEqual(planVideoOutputCanvas('animated-sticker', 160, 160), { width: 270, height: 270 });
  assert.deepEqual(planVideoOutputCanvas('animated-sticker', 320, 160), planAnimatedCanvas(320, 160));
  assert.deepEqual(planVideoOutputCanvas('animated-emoji', 320, 160), { width: 180, height: 180 });
  assert.deepEqual(planVideoOutputCanvas('animated-emoji', 160, 320), { width: 180, height: 180 });
  assert.deepEqual(planVideoOutputCanvas('popup', 320, 160), { width: 480, height: 480 });
  assert.deepEqual(planVideoOutputCanvas('popup', 160, 320), { width: 480, height: 480 });
});

test('Video output canvas rejects unknown products and invalid crop geometry', () => {
  assert.throws(
    () => planVideoOutputCanvas('effect' as never, 160, 160),
    /unsupported Video output target/,
  );
  assert.throws(() => planVideoOutputCanvas('animated-sticker', 0, 160), /cropWidth/);
});
