import assert from 'node:assert/strict';
import {
  applyForegroundCorrection,
  copyKeepMask,
  createIncrementalKeepStroke,
  createKeepMask,
  decodeCroppedKeepMask,
  encodeCroppedKeepMask,
  hashCroppedKeepMask,
  mapClientToSource,
  maskBounds,
  paintKeepStroke,
  redoMaskStroke,
  undoMaskStroke,
} from '../src/webpipe/foregroundCorrection.js';
import {
  cacheAutomaticRaster,
  invalidateAutomaticCorrections,
  removeWithForegroundCorrection,
  type ForegroundCorrectionRecord,
} from '../src/webpipe/backgroundCorrection.js';
import type { BackgroundRemovalJob } from '../src/webpipe/backgroundRemovalJob.js';
import type { Raster } from '../src/webpipe/raster.js';

function raster(width: number, height: number, pixels: number[]): Raster {
  return { width, height, data: new Uint8ClampedArray(pixels) };
}

async function main(): Promise<void> {
  const source = raster(1, 1, [200, 100, 50, 200]);
  const automatic = raster(1, 1, [100, 50, 0, 100]);
  const originalSourceBytes = [...source.data];
  const originalAutomaticBytes = [...automatic.data];
  const zero = createKeepMask(1, 1);
  assert.equal(
    applyForegroundCorrection(source, automatic, zero),
    automatic,
    'an all-zero mask is an allocation-free exact automatic result',
  );

  const full = createKeepMask(1, 1, 255);
  assert.deepEqual(
    [...applyForegroundCorrection(source, automatic, full).data],
    [...source.data],
    'full Keep restores exact source RGBA',
  );

  const half = createKeepMask(1, 1, 128);
  assert.deepEqual(
    [...applyForegroundCorrection(source, automatic, half).data],
    [167, 83, 33, 150],
    'intermediate Keep uses the worked premultiplied-alpha blend',
  );
  assert.ok(applyForegroundCorrection(source, automatic, half).data[3]! >= automatic.data[3]!);
  assert.deepEqual([...source.data], originalSourceBytes, 'composition never mutates source RGBA');
  assert.deepEqual([...automatic.data], originalAutomaticBytes, 'composition never mutates automatic RGBA');
  const clearedFull = paintKeepStroke(full, {
    mode: 'clear',
    points: [{ x: 0, y: 0 }],
    radius: 1,
    hardness: 1,
  }).mask;
  assert.equal(
    applyForegroundCorrection(source, automatic, clearedFull),
    automatic,
    'clearing correction returns the exact automatic object',
  );

  const mappedA = mapClientToSource(
    { x: 210, y: 120 },
    {
      clientLeft: 10,
      clientTop: 20,
      cssWidth: 400,
      cssHeight: 200,
      backingWidth: 800,
      backingHeight: 400,
      zoom: 2,
      panX: 40,
      panY: 20,
    },
  );
  assert.deepEqual(mappedA, { x: 180, y: 90 });
  const mappedB = mapClientToSource(
    { x: 210, y: 120 },
    {
      clientLeft: 110,
      clientTop: 70,
      cssWidth: 200,
      cssHeight: 100,
      backingWidth: 800,
      backingHeight: 400,
      zoom: 2,
      panX: 40,
      panY: 20,
      devicePixelRatio: 4,
    },
  );
  assert.deepEqual(mappedB, mappedA, 'CSS scale and DPR do not alter source coordinates');

  const blank = createKeepMask(12, 10);
  const restored = paintKeepStroke(blank, {
    mode: 'restore',
    points: [{ x: 5, y: 5 }, { x: 7, y: 5 }],
    radius: 2,
    hardness: 0.5,
    strength: 255,
  });
  assert.deepEqual(restored.diff.rect, { left: 3, top: 3, width: 7, height: 5 });
  assert.equal(restored.mask.data[5 * 12 + 5], 255, 'restore only raises Keep at the stroke center');
  assert.equal(restored.mask.data[0], 0, 'stroke has a bounded footprint');
  for (let index = 0; index < blank.data.length; index++) {
    assert.ok(restored.mask.data[index]! >= blank.data[index]!, 'restore never lowers Keep');
  }

  const cleared = paintKeepStroke(restored.mask, {
    mode: 'clear',
    points: [{ x: 5, y: 5 }],
    radius: 1,
    hardness: 1,
    strength: 255,
  });
  assert.equal(cleared.mask.data[5 * 12 + 5], 0, 'clear correction decreases Keep to exact zero');
  for (let index = 0; index < restored.mask.data.length; index++) {
    assert.ok(cleared.mask.data[index]! <= restored.mask.data[index]!, 'clear never raises Keep');
  }
  assert.deepEqual(
    [...undoMaskStroke(cleared.mask, cleared.diff).data],
    [...restored.mask.data],
    'undo applies the bounded before-tile',
  );
  assert.deepEqual(
    [...redoMaskStroke(restored.mask, cleared.diff).data],
    [...cleared.mask.data],
    'redo applies the bounded after-tile',
  );

  const path = [
    { x: 1, y: 1 },
    { x: 8, y: 2 },
    { x: 4, y: 8 },
    { x: 10, y: 9 },
  ];
  const batchPath = paintKeepStroke(blank, {
    mode: 'restore',
    points: path,
    radius: 1.75,
    hardness: 0.4,
  });
  const incrementalPath = createIncrementalKeepStroke(blank, {
    mode: 'restore',
    radius: 1.75,
    hardness: 0.4,
  });
  for (const point of path) incrementalPath.addPoint(point);
  const incrementalPainted = incrementalPath.finish();
  assert.deepEqual(
    [...incrementalPainted.mask.data],
    [...batchPath.mask.data],
    'incremental segments preserve whole-stroke coverage without accumulating overlaps',
  );
  assert.deepEqual(
    [...undoMaskStroke(incrementalPainted.mask, incrementalPainted.diff).data],
    [...blank.data],
    'one incremental gesture produces one exact undo diff',
  );

  const longMask = createKeepMask(64, 8);
  const longStroke = createIncrementalKeepStroke(longMask, {
    mode: 'restore',
    radius: 1,
    hardness: 1,
  });
  for (let index = 0; index < 50_000; index++) {
    longStroke.addPoint({ x: index % 64, y: 4 });
  }
  const longPainted = longStroke.finish();
  assert.equal(longPainted.mask.data[4 * 64], 255, 'long incremental strokes preserve the first endpoint');
  assert.equal(longPainted.mask.data[4 * 64 + 63], 255, 'long incremental strokes preserve the last endpoint');
  assert.ok(
    longPainted.diff.before.byteLength <= longMask.data.byteLength,
    'long gestures retain one raster-bounded undo tile',
  );
  const repeatedPoints = Array.from({ length: 200_000 }, () => ({ x: 1, y: 1 }));
  const repeatedPainted = paintKeepStroke(createKeepMask(3, 3), {
    mode: 'restore',
    points: repeatedPoints,
    radius: 1,
    hardness: 1,
  });
  assert.equal(
    repeatedPainted.mask.data[4],
    255,
    'large point arrays do not depend on variadic Math.min/Math.max argument limits',
  );

  assert.equal(maskBounds(blank), null, 'all-zero masks have no bounds');
  assert.equal(encodeCroppedKeepMask(blank, 'source-a'), null, 'all-zero masks are omitted');
  const encodedA = encodeCroppedKeepMask(restored.mask, 'source-a');
  const encodedB = encodeCroppedKeepMask(copyKeepMask(restored.mask, 12, 10), 'source-b');
  assert.ok(encodedA && encodedB);
  assert.deepEqual(encodedA.bounds, { left: 4, top: 4, width: 5, height: 3 });
  assert.equal(encodedA.data.length, encodedA.bounds.width * encodedA.bounds.height);
  assert.deepEqual([...decodeCroppedKeepMask(encodedA).data], [...restored.mask.data], 'crop is lossless');
  assert.equal(
    await hashCroppedKeepMask(encodedA),
    await hashCroppedKeepMask(encodedB),
    'identical mask assets deduplicate independently of their source-content target',
  );

  assert.throws(() => copyKeepMask(restored.mask, 13, 10), /geometry/i);
  assert.throws(
    () => applyForegroundCorrection(source, raster(2, 1, new Array(8).fill(0)), zero),
    /geometry/i,
  );
  assert.throws(
    () => applyForegroundCorrection(source, raster(1, 1, [0, 0, 0, 201]), zero),
    /source alpha/i,
  );
  assert.throws(
    () => decodeCroppedKeepMask({ ...encodedA, data: encodedA.data.subarray(1) }),
    /length/i,
  );

  let automaticCalls = 0;
  const freshAutomatic = raster(1, 1, [10, 20, 30, 0]);
  const fakeJob: BackgroundRemovalJob = {
    label: 'fake',
    prepare: async () => ({
      identity: 'fake-session',
      remove: async () => {
        automaticCalls++;
        return {
          raster: freshAutomatic,
          automaticMatte: new Uint8ClampedArray([0]),
          sessionIdentity: 'fake-session',
        };
      },
    }),
    dispose: async () => undefined,
  };
  const cachedRecord: ForegroundCorrectionRecord = {
    sourceIdentity: 'source-1',
    label: 'source',
    width: 1,
    height: 1,
    keepMask: full,
    ...cacheAutomaticRaster(automatic),
    automaticConfigurationIdentity: 'config-a',
    sessionIdentity: 'cached-session',
  };
  const reused = await removeWithForegroundCorrection({
    input: source,
    sourceIdentity: 'source-1',
    configurationIdentity: 'config-a',
    job: fakeJob,
    record: cachedRecord,
  });
  assert.equal(automaticCalls, 0, 'mask-only rendering reuses the immutable automatic result');
  assert.equal(reused.reusedAutomatic, true);
  assert.deepEqual([...reused.corrected.data], [...source.data], 'cached automatic still receives full Keep restore');

  const invalidated = invalidateAutomaticCorrections(new Map([['source-1', cachedRecord]]));
  assert.equal(invalidated.get('source-1')?.automaticCompressed, undefined, 'setting changes discard stale automatic bytes');
  assert.deepEqual(
    [...invalidated.get('source-1')!.keepMask.data],
    [...full.data],
    'setting changes retain compatible source-coordinate Keep paint',
  );
  const recomputed = await removeWithForegroundCorrection({
    input: source,
    sourceIdentity: 'source-1',
    configurationIdentity: 'config-b',
    job: fakeJob,
    record: invalidated.get('source-1'),
  });
  assert.equal(automaticCalls, 1, 'invalidated automatic result is recomputed exactly once');
  assert.deepEqual([...recomputed.corrected.data], [...source.data], 'retained Keep applies to the new automatic result');

  const replacedSource = await removeWithForegroundCorrection({
    input: source,
    sourceIdentity: 'source-2',
    configurationIdentity: 'config-a',
    job: fakeJob,
    record: cachedRecord,
  });
  assert.equal(automaticCalls, 2, 'a replacement source cannot reuse another source automatic result');
  assert.equal(
    replacedSource.corrected,
    freshAutomatic,
    'a same-sized replacement source cannot inherit another source Keep mask',
  );

  console.log('foreground correction contract: ok');
}

await main();
