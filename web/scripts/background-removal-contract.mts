import assert from 'node:assert/strict';
import { createBackgroundRemovalJob } from '../src/webpipe/backgroundRemovalJob.js';
import { removeSheetBackgroundByCells } from '../src/webpipe/sheetBackgroundRemoval.js';
import { processAnimated } from '../src/webpipe/processAnimated.js';
import { prepareColorKeySession } from '../src/webpipe/preparedColorKey.js';
import { analyzeSheet, cutSheet } from '../src/webpipe/sheetAnalysis.js';
import { makeAnimation } from '../src/ui/defaults.js';
import type { Raster } from '../src/webpipe/raster.js';
import type { ColorKeyOptions } from '../../src/core/colorKey.js';

function solid(width: number, height: number, rgba: [number, number, number, number]): Raster {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel++) data.set(rgba, pixel * 4);
  return { data, width, height };
}

function setPixel(raster: Raster, x: number, y: number, rgba: [number, number, number, number]): void {
  raster.data.set(rgba, (y * raster.width + x) * 4);
}

function alphaAt(raster: Raster, x: number, y: number): number {
  return raster.data[(y * raster.width + x) * 4 + 3]!;
}

async function renderColorKey(
  source: Raster,
  manualColor: [number, number, number],
  colorKey: ColorKeyOptions,
): Promise<Raster> {
  const session = await prepareColorKeySession([source], { manualColor, colorKey });
  return session.render(source).raster;
}

async function main(): Promise<void> {
  const source = solid(12, 6, [245, 245, 245, 255]);
  for (let y = 1; y <= 4; y++) {
    for (let x = 4; x <= 7; x++) setPixel(source, x, y, [220, 40, 30, 255]);
  }
  let calls = 0;
  const removed = await removeSheetBackgroundByCells(source, {
    cols: 2,
    rows: 1,
    overlapRatio: 0.25,
    remove: async (crop) => {
      calls++;
      const output = new Uint8ClampedArray(crop.data);
      for (let pixel = 0; pixel < crop.width * crop.height; pixel++) {
        const offset = pixel * 4;
        output[offset + 3] = output[offset]! > 200 && output[offset + 1]! < 100 ? 255 : 0;
      }
      return { data: output, width: crop.width, height: crop.height };
    },
  });
  assert.equal(calls, 2, 'one semantic inference per nominal cell');
  assert.equal(alphaAt(removed, 0, 0), 0, 'background becomes transparent');
  assert.equal(alphaAt(removed, 5, 2), 255, 'subject crossing the nominal cut remains opaque');
  assert.equal(alphaAt(removed, 7, 3), 255, 'overlap preserves subject on the far side of the cut');
  assert.deepEqual([...removed.data.slice((2 * 12 + 5) * 4, (2 * 12 + 5) * 4 + 3)], [220, 40, 30]);

  const sheetSource = solid(40, 20, [207, 86, 123, 255]);
  const sheetAutomatic = solid(40, 20, [0, 0, 0, 0]);
  for (let y = 5; y <= 14; y++) {
    for (let x = 4; x <= 11; x++) setPixel(sheetAutomatic, x, y, [20, 40, 220, 255]);
    for (let x = 28; x <= 35; x++) setPixel(sheetAutomatic, x, y, [220, 40, 20, 255]);
  }
  const sheetCorrected = { ...sheetAutomatic, data: new Uint8ClampedArray(sheetAutomatic.data) };
  for (let y = 8; y <= 9; y++) {
    for (let x = 12; x <= 22; x++) setPixel(sheetCorrected, x, y, [20, 40, 220, 255]);
  }
  const automaticAnalysis = await analyzeSheet(sheetSource, { cols: 2, rows: 1 }, {
    preparedResult: { raster: sheetAutomatic, sessionIdentity: 'sheet-shared-session' },
  });
  const restoredSheet = await cutSheet(sheetSource, {
    cols: 2,
    rows: 1,
    count: 2,
    key: { preparedResult: { raster: sheetCorrected, sessionIdentity: 'sheet-shared-session' } },
  });
  assert.equal(restoredSheet.analysis.colorKeySessionIdentity, 'sheet-shared-session');
  assert.notDeepEqual(restoredSheet.analysis.xs, automaticAnalysis.xs, 'restored source pixels participate in gutter analysis');
  assert.ok(restoredSheet.cellsMeta[0]!.bbox!.left + restoredSheet.cellsMeta[0]!.bbox!.width - 1 >= 22, 'a restored cross-grid feature remains in its source component');
  assert.equal(restoredSheet.cellsMeta[1]!.bbox!.left, 28, 'the neighboring component remains separate and is not duplicated');

  const noneJob = await createBackgroundRemovalJob({ mode: 'none' });
  const noneSession = await noneJob.prepare([source]);
  assert.equal((await noneSession.remove(source)).raster, source, 'none mode is a true no-op');
  await noneJob.dispose();

  const keyedSource = solid(5, 1, [255, 255, 255, 255]);
  setPixel(keyedSource, 2, 0, [220, 40, 30, 255]);
  const colorJob = await createBackgroundRemovalJob({
    mode: 'color-key',
    pickColor: [255, 255, 255],
    colorKey: { scope: 'edge-connected', edge: 'soft' },
  });
  const colorSession = await colorJob.prepare([keyedSource]);
  const keyed = (await colorSession.remove(keyedSource)).raster;
  assert.equal(alphaAt(keyed, 0, 0), 0, 'selected solid color is keyed out');
  assert.equal(alphaAt(keyed, 2, 0), 255, 'different foreground color is retained');

  const prepared = await prepareColorKeySession([keyedSource], {
    manualColor: [255, 255, 255],
    colorKey: { scope: 'edge-connected', edge: 'soft' },
  });
  const preparedPreview = prepared.render(keyedSource);
  const preparedFinal = prepared.render(keyedSource);
  assert.equal(preparedPreview.sessionIdentity, prepared.identity, 'prepared preview exposes its session identity');
  assert.equal(preparedFinal.sessionIdentity, prepared.identity, 'prepared final render reuses the same session identity');
  assert.deepEqual(
    [...preparedPreview.raster.data],
    [...keyed.data],
    'prepared-session prefactor keeps the existing color-key bytes',
  );
  assert.deepEqual(
    [...preparedFinal.automaticMatte],
    Array.from({ length: keyed.width * keyed.height }, (_, pixel) => keyed.data[pixel * 4 + 3]!),
    'prepared render exposes the automatic alpha matte',
  );

  const pink = [207, 86, 123, 255] as const;
  const pinkVariant = [209, 86, 123, 255] as const;
  const pinkFixture = solid(11, 11, pink);
  for (let x = 0; x < pinkFixture.width; x += 2) {
    setPixel(pinkFixture, x, 0, pinkVariant);
    setPixel(pinkFixture, x, pinkFixture.height - 1, pinkVariant);
  }
  for (let y = 1; y + 1 < pinkFixture.height; y += 2) {
    setPixel(pinkFixture, 0, y, pinkVariant);
    setPixel(pinkFixture, pinkFixture.width - 1, y, pinkVariant);
  }
  setPixel(pinkFixture, 0, 0, [0, 0, 255, 255]); // border outlier
  setPixel(pinkFixture, 10, 10, [1, 2, 3, 0]); // transparent samples never fit the cluster
  for (let y = 3; y <= 7; y++) {
    for (let x = 3; x <= 7; x++) setPixel(pinkFixture, x, y, [255, 255, 255, 255]);
  }
  const antialias = [231, 171, 189, 255] as const; // 50% white over #CF567B
  for (let x = 3; x <= 7; x++) {
    setPixel(pinkFixture, x, 2, antialias);
    setPixel(pinkFixture, x, 8, antialias);
  }
  for (let y = 3; y <= 7; y++) {
    setPixel(pinkFixture, 2, y, antialias);
    setPixel(pinkFixture, 8, y, antialias);
  }
  setPixel(pinkFixture, 5, 5, pink); // matching decoration enclosed by white foreground

  const pinkSession = await prepareColorKeySession([pinkFixture], {
    colorKey: { scope: 'edge-connected', edge: 'decontaminate' },
  });
  assert.deepEqual(pinkSession.diagnostics.detectedColor, [208, 86, 123], 'nearby pink border shades fit one cluster');
  assert.ok(pinkSession.diagnostics.dominance > 0.9, 'isolated border outliers are rejected from the dominant cluster');
  assert.ok(pinkSession.diagnostics.confidence > 0.8, 'uniform dominant border cluster has high confidence');
  const pinkResult = pinkSession.render(pinkFixture);
  assert.equal(alphaAt(pinkResult.raster, 1, 0), 0, 'pink cluster variants become connected definite background');
  assert.deepEqual(
    [...pinkResult.raster.data.slice((5 * 11 + 5) * 4, (5 * 11 + 5) * 4 + 4)],
    [...pink],
    'enclosed matching foreground decoration remains source-identical',
  );
  const edgeOffset = (2 * 11 + 5) * 4;
  const edgeRgba = [...pinkResult.raster.data.slice(edgeOffset, edgeOffset + 4)];
  assert.ok(edgeRgba[3]! >= 120 && edgeRgba[3]! <= 136, 'trimap solves the 50% antialiased outline alpha');
  assert.ok(
    Math.max(edgeRgba[0]!, edgeRgba[1]!, edgeRgba[2]!) - Math.min(edgeRgba[0]!, edgeRgba[1]!, edgeRgba[2]!) <= 4,
    'edge RGB reconstruction removes pink spill from the white outline',
  );
  for (const background of [0, 255]) {
    const alpha = edgeRgba[3]! / 255;
    const composite = edgeRgba.slice(0, 3).map((channel) => Math.round(channel! * alpha + background * (1 - alpha)));
    assert.ok(
      Math.max(...composite) - Math.min(...composite) <= 4,
      `reconstructed outline stays neutral over ${background === 0 ? 'black' : 'white'}`,
    );
  }
  const recomposed = edgeRgba.slice(0, 3).map((channel, index) => (
    Math.round(channel! * (edgeRgba[3]! / 255) + pink[index]! * (1 - edgeRgba[3]! / 255))
  ));
  assert.ok(
    recomposed.every((channel, index) => Math.abs(channel - antialias[index]!) <= 3),
    'recompositing the reconstructed edge over learned pink reproduces the source composite',
  );
  assert.ok(pinkResult.diagnostics.backgroundPixelCount > 0, 'render diagnostics count selected background');
  assert.ok(pinkResult.diagnostics.unknownPixelCount > 0, 'render diagnostics count trimap unknown pixels');
  assert.ok(pinkResult.diagnostics.changedPixelCount > 0, 'render diagnostics count changed pixels');

  const combinedPinkSession = await prepareColorKeySession([pinkFixture], {
    manualColor: [207, 86, 123],
    colorKey: {
      scope: 'edge-and-whole-image',
      edge: 'decontaminate',
      tolerancePercent: 0,
    },
  });
  const combinedPinkResult = combinedPinkSession.render(pinkFixture).raster;
  assert.equal(
    alphaAt(combinedPinkResult, 1, 0),
    0,
    'combined mode removes clustered background connected to the outer edge',
  );
  assert.equal(
    alphaAt(combinedPinkResult, 5, 5),
    0,
    'combined mode also removes an enclosed exact whole-image color-code match',
  );
  const combinedEdge = [...combinedPinkResult.data.slice(edgeOffset, edgeOffset + 4)];
  assert.ok(
    combinedEdge[3]! > 0 && combinedEdge[3]! < 255,
    'combined mode retains the decontaminated fractional outline matte',
  );
  assert.ok(
    Math.max(...combinedEdge.slice(0, 3)) - Math.min(...combinedEdge.slice(0, 3)) <= 4,
    'combined mode removes pink spill from the retained white outline',
  );

  const colorManagedPink = solid(11, 11, [191, 94, 122, 255]);
  for (let y = 3; y <= 7; y++) {
    for (let x = 3; x <= 7; x++) setPixel(colorManagedPink, x, y, [255, 255, 255, 255]);
  }
  for (let x = 3; x <= 7; x++) {
    setPixel(colorManagedPink, x, 2, [188, 147, 161, 255]);
    setPixel(colorManagedPink, x, 8, [188, 147, 161, 255]);
  }
  for (let y = 3; y <= 7; y++) {
    setPixel(colorManagedPink, 2, y, [188, 147, 161, 255]);
    setPixel(colorManagedPink, 8, y, [188, 147, 161, 255]);
  }
  const colorManagedResult = await renderColorKey(
    colorManagedPink,
    [191, 94, 122],
    { scope: 'edge-connected', edge: 'decontaminate' },
  );
  const managedOffset = (2 * 11 + 5) * 4;
  const managedEdge = [...colorManagedResult.data.slice(managedOffset, managedOffset + 4)];
  assert.deepEqual(
    managedEdge.slice(0, 3),
    [255, 255, 255],
    'bounded neutral solve removes pink fringe when color management nudges one channel past the plate color',
  );
  assert.ok(managedEdge[3]! > 0 && managedEdge[3]! < 255, 'color-managed neutral edge keeps a fractional matte');

  const shadedPlate = solid(21, 11, [195, 70, 110, 255]);
  for (let y = 0; y < shadedPlate.height; y++) {
    for (let x = 11; x < shadedPlate.width; x++) setPixel(shadedPlate, x, y, [235, 100, 140, 255]);
  }
  for (let y = 3; y <= 7; y++) {
    for (let x = 4; x <= 6; x++) setPixel(shadedPlate, x, y, [255, 255, 255, 255]);
    for (let x = 15; x <= 17; x++) setPixel(shadedPlate, x, y, [255, 255, 255, 255]);
  }
  setPixel(shadedPlate, 3, 5, [225, 163, 183, 255]); // 50% white over the left plate
  setPixel(shadedPlate, 14, 5, [245, 178, 198, 255]); // 50% white over the right plate
  const shadedResult = (await prepareColorKeySession([shadedPlate], {
    colorKey: { scope: 'edge-connected', edge: 'decontaminate' },
  })).render(shadedPlate).raster;
  const leftShadedAlpha = alphaAt(shadedResult, 3, 5);
  const rightShadedAlpha = alphaAt(shadedResult, 14, 5);
  assert.ok(leftShadedAlpha >= 118 && leftShadedAlpha <= 138, 'left edge uses its nearby plate color');
  assert.ok(rightShadedAlpha >= 118 && rightShadedAlpha <= 138, 'right edge uses its nearby plate color');
  assert.ok(
    Math.abs(leftShadedAlpha - rightShadedAlpha) <= 6,
    'the same foreground alpha stays stable across a spatially varying background',
  );

  const mutableOptions: ColorKeyOptions = { scope: 'edge-connected', edge: 'soft' };
  const mutableColor: [number, number, number] = [255, 255, 255];
  const immutableSession = await prepareColorKeySession([keyedSource], {
    colorKey: mutableOptions,
    manualColor: mutableColor,
  });
  const immutableBefore = [...immutableSession.render(keyedSource).raster.data];
  mutableOptions.edge = 'hard';
  mutableColor[0] = 0;
  assert.deepEqual(
    [...immutableSession.render(keyedSource).raster.data],
    immutableBefore,
    'prepared settings are cloned so caller mutation cannot change bytes under one identity',
  );

  const splitBorder = solid(8, 8, [207, 86, 123, 255]);
  for (let x = 4; x < 8; x++) {
    setPixel(splitBorder, x, 0, [0, 80, 255, 255]);
    setPixel(splitBorder, x, 7, [0, 80, 255, 255]);
  }
  for (let y = 1; y < 7; y++) setPixel(splitBorder, 7, y, [0, 80, 255, 255]);
  const lowConfidence = await prepareColorKeySession([splitBorder], {
    colorKey: { scope: 'edge-connected', edge: 'decontaminate' },
  });
  assert.ok(lowConfidence.diagnostics.confidence < 0.62, 'multimodal border reports low confidence');
  assert.ok(lowConfidence.diagnostics.warnings.length > 0, 'low confidence is visible through diagnostics');
  const manuallyCentered = await prepareColorKeySession([splitBorder], {
    manualColor: [207, 86, 123],
    colorKey: { scope: 'edge-connected', edge: 'decontaminate' },
  });
  assert.notEqual(manuallyCentered.identity, lowConfidence.identity, 'manual background color changes session identity');
  assert.deepEqual(manuallyCentered.diagnostics.detectedColor, [207, 86, 123]);

  const connectedSource = solid(5, 5, [255, 255, 255, 255]);
  for (let y = 1; y <= 3; y++) {
    for (let x = 1; x <= 3; x++) setPixel(connectedSource, x, y, [220, 40, 30, 255]);
  }
  setPixel(connectedSource, 2, 2, [255, 255, 255, 255]);
  setPixel(connectedSource, 4, 0, [245, 245, 245, 255]);
  const connected = (await colorSession.remove(connectedSource)).raster;
  assert.equal(alphaAt(connected, 0, 0), 0, 'edge-connected selected color is removed');
  assert.equal(alphaAt(connected, 4, 0), 0, 'edge-connected near-background color is removed');
  assert.equal(alphaAt(connected, 1, 1), 255, 'different-color subject remains opaque');
  assert.equal(alphaAt(connected, 2, 2), 255, 'enclosed matching subject detail remains opaque');

  const wholeExact = await renderColorKey(connectedSource, [255, 255, 255], {
    scope: 'whole-image',
    tolerancePercent: 0,
  });
  assert.equal(alphaAt(wholeExact, 2, 2), 0, '0.0% whole-image mode removes enclosed exact RGB matches');
  assert.equal(alphaAt(wholeExact, 4, 0), 255, '0.0% whole-image mode retains non-exact colors');
  assert.deepEqual(
    [...wholeExact.data.slice((1 * 5 + 1) * 4, (1 * 5 + 1) * 4 + 4)],
    [220, 40, 30, 255],
    'whole-image mode preserves unmatched RGBA bit-for-bit',
  );

  const toleranceSource = solid(4, 1, [255, 255, 255, 173]);
  setPixel(toleranceSource, 1, 0, [230, 230, 230, 200]);
  setPixel(toleranceSource, 2, 0, [229, 229, 229, 201]);
  setPixel(toleranceSource, 3, 0, [204, 204, 204, 202]);
  const wholeTen = await renderColorKey(toleranceSource, [255, 255, 255], {
    scope: 'whole-image',
    tolerancePercent: 10,
  });
  assert.deepEqual(
    [alphaAt(wholeTen, 0, 0), alphaAt(wholeTen, 1, 0), alphaAt(wholeTen, 2, 0)],
    [0, 0, 201],
    '10.0% uses inclusive Chebyshev distance <= 25.5 and never increases source alpha',
  );
  const wholeTwenty = await renderColorKey(toleranceSource, [255, 255, 255], {
    scope: 'whole-image',
    tolerancePercent: 20,
  });
  assert.equal(alphaAt(wholeTwenty, 3, 0), 0, '20.0% includes Chebyshev distance 51');

  const topologySource = solid(4, 4, [220, 40, 30, 255]);
  setPixel(topologySource, 0, 0, [255, 255, 255, 255]);
  setPixel(topologySource, 1, 1, [255, 255, 255, 173]);
  setPixel(topologySource, 3, 0, [235, 235, 235, 255]);
  setPixel(topologySource, 3, 1, [234, 234, 234, 200]);
  setPixel(topologySource, 3, 2, [192, 192, 192, 64]);
  setPixel(topologySource, 3, 3, [191, 191, 191, 100]);
  const topology = (await colorSession.remove(topologySource)).raster;
  assert.equal(alphaAt(topology, 0, 0), 0, 'exact border color is removed');
  assert.equal(alphaAt(topology, 1, 1), 173, 'diagonal-only matching detail is not four-way connected');
  assert.equal(alphaAt(topology, 3, 0), 0, 'distance 20 is fully transparent');
  assert.equal(alphaAt(topology, 3, 1), 6, 'distance 21 starts the soft matte');
  assert.equal(alphaAt(topology, 3, 2), 64, 'soft matte never increases source alpha');
  assert.equal(alphaAt(topology, 3, 3), 100, 'distance 64 is retained exactly');
  assert.deepEqual([...topology.data.slice((1 * 4 + 3) * 4, (1 * 4 + 3) * 4 + 3)], [234, 234, 234]);

  const decontaminateDiagonal = solid(11, 11, [220, 40, 30, 255]);
  setPixel(decontaminateDiagonal, 0, 0, [255, 255, 255, 255]);
  setPixel(decontaminateDiagonal, 1, 1, [255, 255, 255, 255]);
  const decontaminateDiagonalResult = await renderColorKey(
    decontaminateDiagonal,
    [255, 255, 255],
    { scope: 'edge-connected', edge: 'decontaminate' },
  );
  assert.deepEqual(
    [...decontaminateDiagonalResult.data.slice((1 * 11 + 1) * 4, (1 * 11 + 1) * 4 + 4)],
    [255, 255, 255, 255],
    'default decontaminate keeps diagonal-only matching foreground source-identical',
  );

  const compositeEdge = solid(1, 1, [213, 213, 213, 255]);
  const softEdge = await renderColorKey(
    compositeEdge,
    [255, 255, 255],
    { scope: 'edge-connected', edge: 'soft' },
  );
  const cleanEdge = await renderColorKey(
    compositeEdge,
    [255, 255, 255],
    { scope: 'edge-connected', edge: 'decontaminate' },
  );
  const hardEdge = await renderColorKey(
    compositeEdge,
    [255, 255, 255],
    { scope: 'edge-connected', edge: 'hard' },
  );
  assert.deepEqual([...softEdge.data.slice(0, 3)], [213, 213, 213], 'soft edge keeps composite RGB');
  assert.ok(alphaAt(softEdge, 0, 0) > 0 && alphaAt(softEdge, 0, 0) < 255, 'soft edge exposes a feathered matte');
  assert.ok(alphaAt(cleanEdge, 0, 0) > 0 && alphaAt(cleanEdge, 0, 0) <= alphaAt(softEdge, 0, 0), 'decontaminate keeps a bounded solved matte');
  assert.equal(cleanEdge.data[0], cleanEdge.data[1]);
  assert.equal(cleanEdge.data[1], cleanEdge.data[2], 'decontaminate keeps neutral foreground neutral');
  assert.deepEqual([...hardEdge.data], [213, 213, 213, 0], 'hard edge removes every in-scope candidate');

  const greenTopology = solid(5, 5, [20, 120, 20, 255]);
  for (let y = 1; y <= 3; y++) {
    for (let x = 1; x <= 3; x++) setPixel(greenTopology, x, y, [220, 40, 30, 255]);
  }
  setPixel(greenTopology, 2, 2, [20, 120, 20, 173]);
  const connectedGreen = await renderColorKey(greenTopology, [20, 120, 20], { scope: 'edge-connected', edge: 'decontaminate' });
  assert.equal(alphaAt(connectedGreen, 2, 2), 173, 'connected green key preserves enclosed green detail');
  assert.deepEqual(
    [...connectedGreen.data.slice((2 * 5 + 2) * 4, (2 * 5 + 2) * 4 + 4)],
    [20, 120, 20, 173],
    'connected green key preserves out-of-scope RGBA bit-for-bit',
  );
  const connectedGreenJob = await createBackgroundRemovalJob({
    mode: 'color-key',
    colorKey: { scope: 'edge-connected', edge: 'decontaminate' },
  });
  assert.equal(
    alphaAt((await (await connectedGreenJob.prepare([greenTopology])).remove(greenTopology)).raster, 2, 2),
    173,
    'auto-detected green background receives connected scope through the job dispatcher',
  );
  await assert.rejects(
    createBackgroundRemovalJob({
      mode: 'color-key',
      colorKey: { scope: 'all-matching', edge: 'decontaminate' } as unknown as ColorKeyOptions,
    }),
    /單色色鍵選項無效/,
    'retired all-image keying is rejected instead of silently punching through subject pixels',
  );
  await assert.rejects(
    () => renderColorKey(
      connectedSource,
      [255, 255, 255],
      { scope: 'all-matching', edge: 'soft' } as unknown as ColorKeyOptions,
    ),
    /單色色鍵選項無效/,
    'prepared raster sessions reject retired all-image settings',
  );
  await assert.rejects(
    createBackgroundRemovalJob({
      mode: 'color-key',
      colorKey: { scope: 'whole-image', tolerancePercent: 20.1 } as ColorKeyOptions,
    }),
    /0\.0–20\.0%/,
    'whole-image tolerance above 20.0% is rejected',
  );
  await connectedGreenJob.dispose();

  const greenThresholds = solid(4, 1, [80, 92, 50, 200]);
  setPixel(greenThresholds, 1, 0, [80, 93, 50, 255]);
  setPixel(greenThresholds, 2, 0, [50, 100, 20, 255]);
  setPixel(greenThresholds, 3, 0, [20, 110, 10, 255]);
  const softGreen = await renderColorKey(greenThresholds, [20, 110, 10], { scope: 'edge-connected', edge: 'soft' });
  const cleanGreen = await renderColorKey(greenThresholds, [20, 110, 10], { scope: 'edge-connected', edge: 'decontaminate' });
  const hardGreen = await renderColorKey(greenThresholds, [20, 110, 10], { scope: 'edge-connected', edge: 'hard' });
  assert.ok(alphaAt(softGreen, 0, 0) > 0, 'soft mode retains a transition matte');
  assert.ok(alphaAt(hardGreen, 0, 0) <= alphaAt(softGreen, 0, 0), 'hard mode is no softer than the prepared soft matte');
  assert.ok(cleanGreen.data[1]! <= softGreen.data[1]!, 'prepared decontaminate mode does not add green spill');

  await assert.rejects(
    createBackgroundRemovalJob({
      mode: 'none',
      colorKey: { scope: 'edge-connected', edge: 'soft' },
    }),
    /單色色鍵選項.*color-key/,
    'non-color-key jobs reject color-key-only options',
  );

  const emptySource = solid(0, 0, [255, 255, 255, 255]);
  const empty = (await colorSession.remove(emptySource)).raster;
  assert.equal(empty.data.length, 0, 'empty rasters remain empty');
  await colorJob.dispose();

  let animatedCalls = 0;
  const frames = Array.from({ length: 5 }, () => {
    const frame = solid(32, 32, [255, 255, 255, 255]);
    for (let y = 8; y < 24; y++) {
      for (let x = 8; x < 24; x++) setPixel(frame, x, y, [220, 40, 30, 255]);
    }
    return frame;
  });
  const animatedIdentities: string[] = [];
  const animated = await processAnimated(frames, {
    bounds: { width: 32, height: 32 },
    removeBackground: false,
    frameIdentities: frames.map((_, index) => `source-frame-${index}`),
    prepareBackgroundRaster: async (frame, identity) => {
      animatedCalls++;
      animatedIdentities.push(`${identity.sourceIdentity}:${identity.sourceIndex}:${identity.retainedIndex}`);
      const output = new Uint8ClampedArray(frame.data);
      for (let pixel = 0; pixel < frame.width * frame.height; pixel++) {
        const offset = pixel * 4;
        output[offset + 3] = output[offset]! > 240 && output[offset + 1]! > 240 ? 0 : 255;
      }
      return { data: output, width: frame.width, height: frame.height };
    },
    animation: makeAnimation({ loops: 1, durationSec: 1, stabilize: false }),
  });
  assert.equal(animatedCalls, 5, 'injected remover runs once for every retained animation frame');
  assert.deepEqual(animatedIdentities, frames.map((_, index) => `source-frame-${index}:${index}:${index}`), 'stable source identities reach correction before fitting');
  assert.equal(alphaAt(animated.fittedFrames[0]!, 0, 0), 0, 'removal happens before animation fitting');
  assert.equal(alphaAt(animated.fittedFrames[0]!, 16, 16), 255, 'foreground survives animation processing');

  const varyingFrames = [
    solid(8, 8, [255, 0, 255, 255]),
    ...Array.from({ length: 4 }, () => solid(4, 4, [255, 0, 255, 255])),
  ];
  let smallerCorrectionApplied = false;
  await processAnimated(varyingFrames, {
    bounds: { width: 8, height: 8 },
    removeBackground: false,
    frameIdentities: ['large', 'small', 'small-2', 'small-3', 'small-4'],
    prepareBackgroundRaster: async (frame, identity) => {
      if (identity.sourceIdentity === 'small') {
        assert.deepEqual([frame.width, frame.height], [4, 4], 'correction receives immutable source geometry before normalization');
        smallerCorrectionApplied = true;
      }
      return frame.width === 4 ? solid(8, 8, [255, 0, 255, 255]) : frame;
    },
    animation: makeAnimation({ loops: 1, durationSec: 1, stabilize: false }),
  });
  assert.equal(smallerCorrectionApplied, true, 'varying-size frame correction is not silently discarded');

  console.log('background-removal contract: PASS');
}

await main();
