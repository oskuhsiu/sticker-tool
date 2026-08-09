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

test('Video grid accepts inset outer bounds while keeping every crop inside the source', () => {
  const grid = planVideoGrid({
    sourceWidth: 400,
    sourceHeight: 200,
    cols: 3,
    rows: 2,
    count: 6,
    xCuts: [10, 100, 275, 390],
    yCuts: [5, 80, 190],
  });
  assert.deepEqual(grid.rects.map((rect) => [rect.left, rect.top, rect.width, rect.height]), [
    [10, 5, 90, 75], [100, 5, 175, 75], [275, 5, 115, 75],
    [10, 80, 90, 110], [100, 80, 175, 110], [275, 80, 115, 110],
  ]);
  assert.ok(grid.rects.every((rect) => (
    rect.left >= 0 && rect.top >= 0 &&
    rect.left + rect.width <= grid.sourceWidth &&
    rect.top + rect.height <= grid.sourceHeight
  )));
});

test('Video grid rejects malformed explicit source-pixel cuts', () => {
  const base = { sourceWidth: 100, sourceHeight: 80, cols: 2, rows: 2, count: 4 } as const;
  assert.throws(() => planVideoGrid({ ...base, xCuts: [0, 100] }), /xCuts must contain exactly 3 cuts/);
  assert.throws(() => planVideoGrid({ ...base, xCuts: [-1, 50, 100] }), /xCuts must stay within 0 and 100/);
  assert.throws(() => planVideoGrid({ ...base, yCuts: [0, 40, 81] }), /yCuts must stay within 0 and 80/);
  assert.throws(() => planVideoGrid({ ...base, xCuts: [0, 50.5, 100] }), /xCuts\[1\] must be a safe integer/);
  assert.throws(() => planVideoGrid({ ...base, xCuts: [0, 100, 100] }), /xCuts must be strictly increasing/);
  assert.throws(
    () => planVideoGrid({ ...base, xCuts: [0, Number.MAX_SAFE_INTEGER + 1, 100] }),
    /xCuts\[1\] must be a safe integer/,
  );
});

test('Video guide movement rounds and clamps internal separators between their neighbors', () => {
  const cuts = [0, 100, 200, 300];
  assert.deepEqual(moveVideoGuide(cuts, 1, 150.5, 300), [0, 151, 200, 300]);
  assert.deepEqual(cuts, [0, 100, 200, 300], 'moving a guide must not mutate editor state');
  assert.deepEqual(moveVideoGuide(cuts, 1, -10, 300), [0, 1, 200, 300]);
  assert.deepEqual(moveVideoGuide(cuts, 1, 999, 300), [0, 199, 200, 300]);
  assert.throws(() => moveVideoGuide(cuts, -1, 120, 300), /guide index/);
  assert.throws(() => moveVideoGuide(cuts, 4, 120, 300), /guide index/);
  assert.throws(() => moveVideoGuide(cuts, 1.5, 120, 300), /guide index/);
  assert.deepEqual(equalVideoAxisCuts(300, 3), [0, 100, 200, 300]);
});

test('Video guide movement lets outer bounds inset but never leave the source or collapse a cell', () => {
  const cuts = [0, 100, 200, 300];
  assert.deepEqual(moveVideoGuide(cuts, 0, 40, 300), [40, 100, 200, 300]);
  assert.deepEqual(moveVideoGuide(cuts, 0, -20, 300), [0, 100, 200, 300]);
  assert.deepEqual(moveVideoGuide(cuts, 0, 999, 300), [99, 100, 200, 300]);
  assert.deepEqual(moveVideoGuide(cuts, 3, 260, 300), [0, 100, 200, 260]);
  assert.deepEqual(moveVideoGuide(cuts, 3, -20, 300), [0, 100, 200, 201]);
  assert.deepEqual(moveVideoGuide(cuts, 3, 999, 300), [0, 100, 200, 300]);
  assert.deepEqual(moveVideoGuide([0, 300], 0, 50, 300), [50, 300]);
  assert.deepEqual(moveVideoGuide([0, 300], 1, 250, 300), [0, 250]);
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
