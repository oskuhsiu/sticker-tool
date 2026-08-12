import {
  DEFAULT_COLOR_KEY_OPTIONS,
  colorKeyUsesEdge,
  colorKeyUsesWholeImage,
  copyColorKeyOptions,
  edgeToleranceScalePercent,
  type ColorKeyOptions,
} from '@core/colorKey.js';
import { assertSupportedColorKeyOptions } from '@core/validate.js';
import type { Raster } from './raster.js';

export const PREPARED_COLOR_KEY_VERSION = 'prepared-color-key@2';

type Rgb = readonly [number, number, number];

interface BorderSample {
  r: number;
  g: number;
  b: number;
}

interface BackgroundCluster {
  center: Rgb;
  spread: number;
  dominance: number;
  definiteDistance: number;
  transitionDistance: number;
}

export interface ColorKeyCalibrationDiagnostics {
  detectedColor: Rgb | null;
  confidence: number;
  dominance: number;
  spread: number;
  borderSampleCount: number;
  transparentBorderFraction: number;
  definiteDistance: number;
  transitionDistance: number;
  warnings: readonly string[];
}

export interface ColorKeyRenderDiagnostics extends ColorKeyCalibrationDiagnostics {
  backgroundPixelCount: number;
  unknownPixelCount: number;
  changedPixelCount: number;
}

export interface PreparedColorKeyRenderResult {
  raster: Raster;
  automaticMatte: Uint8ClampedArray<ArrayBuffer>;
  sessionIdentity: string;
  diagnostics: ColorKeyRenderDiagnostics;
}

export interface PreparedColorKeySession {
  readonly identity: string;
  readonly diagnostics: ColorKeyCalibrationDiagnostics;
  render(input: Raster): PreparedColorKeyRenderResult;
}

export interface PrepareColorKeySessionOptions {
  colorKey?: ColorKeyOptions;
  manualColor?: [number, number, number] | null;
}

const VISIBLE_ALPHA = 32;
const BASE_DEFINITE_DISTANCE = 20;
const BASE_TRANSITION_DISTANCE = 64;
const TRIMAP_INWARD_RADIUS = 3;
const FOREGROUND_SEARCH_RADIUS = 8;

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function rgbDistance(a: Rgb, b: Rgb): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) / Math.sqrt(3);
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))]!;
}

function immutableRgb(value: Rgb | null): Rgb | null {
  return value === null ? null : Object.freeze([value[0], value[1], value[2]] as [number, number, number]);
}

function collectBorderSamples(rasters: readonly Raster[]): {
  visible: BorderSample[];
  total: number;
  transparent: number;
} {
  const visible: BorderSample[] = [];
  let total = 0;
  let transparent = 0;
  const sample = (raster: Raster, x: number, y: number): void => {
    const offset = (y * raster.width + x) * 4;
    total++;
    if (raster.data[offset + 3]! < VISIBLE_ALPHA) {
      transparent++;
      return;
    }
    visible.push({
      r: raster.data[offset]!,
      g: raster.data[offset + 1]!,
      b: raster.data[offset + 2]!,
    });
  };
  for (const raster of rasters) {
    if (raster.width < 1 || raster.height < 1) continue;
    for (let x = 0; x < raster.width; x++) {
      sample(raster, x, 0);
      if (raster.height > 1) sample(raster, x, raster.height - 1);
    }
    for (let y = 1; y + 1 < raster.height; y++) {
      sample(raster, 0, y);
      if (raster.width > 1) sample(raster, raster.width - 1, y);
    }
  }
  return { visible, total, transparent };
}

/** Fit one radial RGB cluster; per-channel min/max boxes are deliberately not used. */
function fitDominantCluster(samples: readonly BorderSample[]): BackgroundCluster | null {
  if (samples.length === 0) return null;
  const bins = new Map<number, { count: number; r: number; g: number; b: number }>();
  for (const sample of samples) {
    const key = (sample.r >> 4) << 8 | (sample.g >> 4) << 4 | (sample.b >> 4);
    const bin = bins.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    bin.count++;
    bin.r += sample.r;
    bin.g += sample.g;
    bin.b += sample.b;
    bins.set(key, bin);
  }

  let seed: Rgb = [samples[0]!.r, samples[0]!.g, samples[0]!.b];
  let bestDensity = -1;
  let bestCount = -1;
  for (const [key, bin] of bins) {
    const qr = key >> 8;
    const qg = key >> 4 & 15;
    const qb = key & 15;
    let density = 0;
    for (const [otherKey, other] of bins) {
      const dr = qr - (otherKey >> 8);
      const dg = qg - (otherKey >> 4 & 15);
      const db = qb - (otherKey & 15);
      if (dr * dr + dg * dg + db * db <= 4) density += other.count;
    }
    if (density > bestDensity || (density === bestDensity && bin.count > bestCount)) {
      bestDensity = density;
      bestCount = bin.count;
      seed = [bin.r / bin.count, bin.g / bin.count, bin.b / bin.count];
    }
  }

  let inliers = samples.filter((sample) => rgbDistance([sample.r, sample.g, sample.b], seed) <= 40);
  if (inliers.length === 0) inliers = [samples[0]!];
  const medianCenter: Rgb = [
    percentile(inliers.map((sample) => sample.r), 0.5),
    percentile(inliers.map((sample) => sample.g), 0.5),
    percentile(inliers.map((sample) => sample.b), 0.5),
  ];
  const firstDistances = inliers.map((sample) => rgbDistance([sample.r, sample.g, sample.b], medianCenter));
  const robustRadius = clamp(Math.ceil(percentile(firstDistances, 0.9) + 6), 12, 40);
  inliers = samples.filter((sample) => rgbDistance([sample.r, sample.g, sample.b], medianCenter) <= robustRadius);

  const center: Rgb = [
    Math.round(inliers.reduce((sum, sample) => sum + sample.r, 0) / inliers.length),
    Math.round(inliers.reduce((sum, sample) => sum + sample.g, 0) / inliers.length),
    Math.round(inliers.reduce((sum, sample) => sum + sample.b, 0) / inliers.length),
  ];
  const distances = inliers.map((sample) => rgbDistance([sample.r, sample.g, sample.b], center));
  const spread = percentile(distances, 0.5) * 1.4826;
  const observedRadius = percentile(distances, 0.95);
  const definiteDistance = clamp(
    Math.ceil(Math.max(BASE_DEFINITE_DISTANCE, observedRadius + Math.max(4, spread))),
    BASE_DEFINITE_DISTANCE,
    40,
  );
  const transitionDistance = clamp(
    Math.ceil(Math.max(BASE_TRANSITION_DISTANCE, definiteDistance + Math.max(28, spread * 3))),
    BASE_TRANSITION_DISTANCE,
    96,
  );
  return {
    center,
    spread,
    dominance: inliers.length / samples.length,
    definiteDistance,
    transitionDistance,
  };
}

function selectEdgeConnected(
  width: number,
  height: number,
  isCandidate: (pixel: number) => boolean,
): Uint8Array<ArrayBuffer> {
  const pixels = width * height;
  const state = new Uint8Array(pixels);
  if (pixels === 0) return state;
  const queue = new Uint32Array(pixels);
  let head = 0;
  let tail = 0;
  const visit = (pixel: number): void => {
    if (state[pixel]) return;
    if (!isCandidate(pixel)) {
      state[pixel] = 1;
      return;
    }
    state[pixel] = 2;
    queue[tail++] = pixel;
  };
  for (let x = 0; x < width; x++) {
    visit(x);
    visit((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    visit(y * width);
    visit(y * width + width - 1);
  }
  while (head < tail) {
    const pixel = queue[head++]!;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    if (x > 0) visit(pixel - 1);
    if (x + 1 < width) visit(pixel + 1);
    if (y > 0) visit(pixel - width);
    if (y + 1 < height) visit(pixel + width);
  }
  return state;
}

function buildInwardBand(
  width: number,
  height: number,
  connected: Uint8Array,
): Uint8Array<ArrayBuffer> {
  const pixels = width * height;
  const distance = new Uint8Array(pixels);
  distance.fill(255);
  const queue = new Uint32Array(pixels);
  let head = 0;
  let tail = 0;
  for (let pixel = 0; pixel < pixels; pixel++) {
    if (connected[pixel] === 2) {
      distance[pixel] = 0;
      queue[tail++] = pixel;
    }
  }
  const visit = (pixel: number, nextDistance: number): void => {
    if (distance[pixel]! <= nextDistance) return;
    distance[pixel] = nextDistance;
    queue[tail++] = pixel;
  };
  while (head < tail) {
    const pixel = queue[head++]!;
    const nextDistance = distance[pixel]! + 1;
    if (nextDistance > TRIMAP_INWARD_RADIUS) continue;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    if (x > 0) visit(pixel - 1, nextDistance);
    if (x + 1 < width) visit(pixel + 1, nextDistance);
    if (y > 0) visit(pixel - width, nextDistance);
    if (y + 1 < height) visit(pixel + width, nextDistance);
    // The background classification remains strictly four-connected. The
    // repair band is eight-connected so curved/diagonal antialias pixels are
    // not skipped merely because their Manhattan distance is larger.
    if (x > 0 && y > 0) visit(pixel - width - 1, nextDistance);
    if (x + 1 < width && y > 0) visit(pixel - width + 1, nextDistance);
    if (x > 0 && y + 1 < height) visit(pixel + width - 1, nextDistance);
    if (x + 1 < width && y + 1 < height) visit(pixel + width + 1, nextDistance);
  }
  return distance;
}

/** Estimate the plate behind one trimap pixel from nearby strict-background evidence. */
function localBackgroundEstimate(
  input: Raster,
  pixel: number,
  definite: Uint8Array,
  fallback: Rgb,
): Rgb {
  const x0 = pixel % input.width;
  const y0 = Math.floor(pixel / input.width);
  for (let radius = 1; radius <= FOREGROUND_SEARCH_RADIUS; radius++) {
    let weight = 0;
    let red = 0;
    let green = 0;
    let blue = 0;
    const sample = (x: number, y: number): void => {
      if (x < 0 || x >= input.width || y < 0 || y >= input.height) return;
      const candidate = y * input.width + x;
      if (definite[candidate] !== 2) return;
      const offset = candidate * 4;
      const alpha = input.data[offset + 3]!;
      if (alpha < VISIBLE_ALPHA) return;
      red += input.data[offset]! * alpha;
      green += input.data[offset + 1]! * alpha;
      blue += input.data[offset + 2]! * alpha;
      weight += alpha;
    };
    for (let dx = -radius; dx <= radius; dx++) {
      sample(x0 + dx, y0 - radius);
      sample(x0 + dx, y0 + radius);
    }
    for (let dy = -radius + 1; dy < radius; dy++) {
      sample(x0 - radius, y0 + dy);
      sample(x0 + radius, y0 + dy);
    }
    if (weight > 0) return [red / weight, green / weight, blue / weight];
  }
  return fallback;
}

function foregroundEstimate(
  input: Raster,
  pixel: number,
  connected: Uint8Array,
  inwardDistance: Uint8Array,
  background: Rgb,
  observed: Rgb,
): Rgb | null {
  const x0 = pixel % input.width;
  const y0 = Math.floor(pixel / input.width);
  const candidates: Array<{ color: Rgb; alpha: number; contrast: number; radius: number }> = [];
  for (let radius = 1; radius <= FOREGROUND_SEARCH_RADIUS; radius++) {
    const sample = (x: number, y: number): void => {
      if (x < 0 || x >= input.width || y < 0 || y >= input.height) return;
      const candidate = y * input.width + x;
      if (connected[candidate] === 2 || inwardDistance[candidate] !== 255) return;
      const offset = candidate * 4;
      const alpha = input.data[offset + 3]!;
      if (alpha < VISIBLE_ALPHA) return;
      const color: Rgb = [input.data[offset]!, input.data[offset + 1]!, input.data[offset + 2]!];
      candidates.push({ color, alpha, contrast: rgbDistance(color, background), radius });
    };
    for (let dx = -radius; dx <= radius; dx++) {
      sample(x0 + dx, y0 - radius);
      sample(x0 + dx, y0 + radius);
    }
    for (let dy = -radius + 1; dy < radius; dy++) {
      sample(x0 - radius, y0 + dy);
      sample(x0 + radius, y0 + dy);
    }
  }
  const solvedCandidates = candidates
    .map((candidate) => ({ ...candidate, solution: solveAlpha(observed, candidate.color, background) }))
    .filter((candidate) => candidate.solution.reliable && candidate.solution.alpha >= 0.04)
    .sort((a, b) => (
      a.solution.residual + a.radius * 0.4 - a.contrast * 0.02
      - (b.solution.residual + b.radius * 0.4 - b.contrast * 0.02)
    ));
  const best = solvedCandidates[0];
  if (best) {
    const selected = solvedCandidates.filter((candidate) => (
      candidate.solution.residual <= best.solution.residual + 3
      && rgbDistance(candidate.color, best.color) <= 24
    ));
    const weight = selected.reduce((sum, candidate) => sum + candidate.alpha / Math.max(1, candidate.radius), 0);
    if (weight > 0) return [
      selected.reduce((sum, candidate) => sum + candidate.color[0] * candidate.alpha / Math.max(1, candidate.radius), 0) / weight,
      selected.reduce((sum, candidate) => sum + candidate.color[1] * candidate.alpha / Math.max(1, candidate.radius), 0) / weight,
      selected.reduce((sum, candidate) => sum + candidate.color[2] * candidate.alpha / Math.max(1, candidate.radius), 0) / weight,
    ];
  }
  if (candidates.length > 0) {
    const strongest = Math.max(...candidates.map((candidate) => candidate.contrast));
    const selected = candidates.filter((candidate) => candidate.contrast >= Math.max(24, strongest - 12));
    const weight = selected.reduce((sum, candidate) => sum + candidate.alpha / Math.max(1, candidate.radius), 0);
    if (weight > 0) return [
      selected.reduce((sum, candidate) => sum + candidate.color[0] * candidate.alpha / Math.max(1, candidate.radius), 0) / weight,
      selected.reduce((sum, candidate) => sum + candidate.color[1] * candidate.alpha / Math.max(1, candidate.radius), 0) / weight,
      selected.reduce((sum, candidate) => sum + candidate.color[2] * candidate.alpha / Math.max(1, candidate.radius), 0) / weight,
    ];
  }
  return null;
}

interface AlphaSolution {
  alpha: number;
  reliable: boolean;
  residual: number;
}

interface NeutralForegroundSolution {
  foreground: Rgb;
  solution: AlphaSolution;
}

/**
 * Screenshot color management and video subsampling can move one channel in
 * the wrong direction even when the source edge was neutral white or black.
 * Accept a small bounded residual for those two common outline colors instead
 * of amplifying the channel error into a pink/cyan fringe.
 */
function neutralForegroundEstimate(observed: Rgb, background: Rgb): NeutralForegroundSolution | null {
  const candidates: Rgb[] = [[255, 255, 255], [0, 0, 0]];
  let best: NeutralForegroundSolution | null = null;
  for (const foreground of candidates) {
    const towardWhite = foreground[0] === 255;
    const signCompatible = observed.every((value, channel) => towardWhite
      ? value - background[channel]! >= -6
      : value - background[channel]! <= 6);
    if (!signCompatible) continue;
    const solution = solveAlpha(observed, foreground, background, 36);
    if (!solution.reliable || solution.alpha < 0.05 || solution.alpha >= 0.995) continue;
    if (best === null || solution.residual < best.solution.residual) best = { foreground, solution };
  }
  return best;
}

function boundedRayForegroundEstimate(observed: Rgb, background: Rgb): Rgb | null {
  const differences = observed.map((value, channel) => value - background[channel]!) as [number, number, number];
  const allPositive = differences.every((value) => value > 2);
  const allNegative = differences.every((value) => value < -2);
  if (!allPositive && !allNegative) return null;
  let alpha = 0;
  for (let channel = 0; channel < 3; channel++) {
    const available = differences[channel]! >= 0 ? 255 - background[channel]! : background[channel]!;
    if (available > 0) alpha = Math.max(alpha, Math.abs(differences[channel]!) / available);
  }
  if (alpha < 0.08) return null;
  const foreground: [number, number, number] = [
    clamp(background[0] + differences[0] / alpha, 0, 255),
    clamp(background[1] + differences[1] / alpha, 0, 255),
    clamp(background[2] + differences[2] / alpha, 0, 255),
  ];
  const minimum = Math.min(...foreground);
  const maximum = Math.max(...foreground);
  if (minimum >= 220) return [maximum, maximum, maximum];
  if (maximum <= 35) return [minimum, minimum, minimum];
  return foreground;
}

function solveAlpha(
  observed: Rgb,
  foreground: Rgb,
  background: Rgb,
  maximumResidual = 20,
): AlphaSolution {
  const fr = foreground[0] - background[0];
  const fg = foreground[1] - background[1];
  const fb = foreground[2] - background[2];
  const denominator = fr * fr + fg * fg + fb * fb;
  if (denominator < 64) return { alpha: 1, reliable: false, residual: Number.POSITIVE_INFINITY };
  const cr = observed[0] - background[0];
  const cg = observed[1] - background[1];
  const cb = observed[2] - background[2];
  const rawAlpha = (cr * fr + cg * fg + cb * fb) / denominator;
  const alpha = clamp(rawAlpha, 0, 1);
  const residual = Math.hypot(
    observed[0] - (background[0] + alpha * fr),
    observed[1] - (background[1] + alpha * fg),
    observed[2] - (background[2] + alpha * fb),
  );
  return { alpha, reliable: rawAlpha >= -0.08 && rawAlpha <= 1.08 && residual <= maximumResidual, residual };
}

function reconstructChannel(
  observed: number,
  background: number,
  foreground: number,
  alpha: number,
): number {
  if (alpha < 0.08) return Math.round(clamp(foreground, 0, 255));
  const reconstructed = (observed - (1 - alpha) * background) / alpha;
  return Math.round(clamp(reconstructed, Math.max(0, foreground - 48), Math.min(255, foreground + 48)));
}

function matteOf(raster: Raster): Uint8ClampedArray<ArrayBuffer> {
  const matte = new Uint8ClampedArray(raster.width * raster.height);
  for (let pixel = 0; pixel < matte.length; pixel++) matte[pixel] = raster.data[pixel * 4 + 3]!;
  return matte;
}

function renderWholeImage(input: Raster, center: Rgb | null, tolerancePercent: number): Raster {
  if (center === null) return input;
  const maximumDistance = tolerancePercent * 255 / 100;
  const output = new Uint8ClampedArray(input.data);
  for (let pixel = 0; pixel < input.width * input.height; pixel++) {
    const offset = pixel * 4;
    const distance = Math.max(
      Math.abs(input.data[offset]! - center[0]),
      Math.abs(input.data[offset + 1]! - center[1]),
      Math.abs(input.data[offset + 2]! - center[2]),
    );
    if (distance <= maximumDistance) output[offset + 3] = 0;
  }
  return { data: output, width: input.width, height: input.height };
}

function countRemovedSourcePixels(source: Raster, output: Raster): number {
  let removed = 0;
  for (let pixel = 0; pixel < source.width * source.height; pixel++) {
    if (source.data[pixel * 4 + 3]! > 0 && output.data[pixel * 4 + 3] === 0) removed++;
  }
  return removed;
}

function renderEdgeConnected(
  input: Raster,
  cluster: BackgroundCluster,
  edge: 'soft' | 'decontaminate' | 'hard',
): { raster: Raster; backgroundPixelCount: number; unknownPixelCount: number } {
  const pixels = input.width * input.height;
  if (pixels === 0) return { raster: input, backgroundPixelCount: 0, unknownPixelCount: 0 };
  const center = cluster.center;
  const distanceAt = (pixel: number): number => {
    const offset = pixel * 4;
    return rgbDistance([
      input.data[offset]!,
      input.data[offset + 1]!,
      input.data[offset + 2]!,
    ], center);
  };
  const transparentOrWithin = (pixel: number, maximum: number): boolean => (
    input.data[pixel * 4 + 3]! < VISIBLE_ALPHA || distanceAt(pixel) <= maximum
  );
  const definite = selectEdgeConnected(
    input.width,
    input.height,
    (pixel) => transparentOrWithin(pixel, cluster.definiteDistance),
  );
  const connected = selectEdgeConnected(
    input.width,
    input.height,
    (pixel) => transparentOrWithin(pixel, cluster.transitionDistance),
  );
  const inwardDistance = buildInwardBand(input.width, input.height, connected);
  const output = new Uint8ClampedArray(input.data);
  let backgroundPixelCount = 0;
  let unknownPixelCount = 0;

  for (let pixel = 0; pixel < pixels; pixel++) {
    const offset = pixel * 4;
    const sourceAlpha = input.data[offset + 3]!;
    if (definite[pixel] === 2) {
      output[offset + 3] = 0;
      if (sourceAlpha > 0) backgroundPixelCount++;
      continue;
    }
    const connectedTransition = connected[pixel] === 2;
    // A key-compatible pixel that did not join the strict four-way flood is
    // protected foreground (for example, diagonal-only lettering). The inward
    // repair band exists only for higher-contrast composite edge pixels.
    const disconnectedCandidate = !connectedTransition
      && transparentOrWithin(pixel, cluster.transitionDistance);
    const inwardUnknown = !connectedTransition
      && !disconnectedCandidate
      && cluster.transitionDistance > 0
      && inwardDistance[pixel]! > 0
      && inwardDistance[pixel]! <= TRIMAP_INWARD_RADIUS;
    if (!connectedTransition && !inwardUnknown) continue;
    unknownPixelCount++;

    if (edge === 'hard') {
      if (connectedTransition) {
        output[offset + 3] = 0;
        if (sourceAlpha > 0) backgroundPixelCount++;
      }
      continue;
    }

    const distanceAlpha = clamp(
      (distanceAt(pixel) - cluster.definiteDistance) /
        Math.max(1, cluster.transitionDistance - cluster.definiteDistance),
      0,
      1,
    );
    if (edge === 'soft') {
      if (connectedTransition) output[offset + 3] = Math.min(sourceAlpha, Math.round(distanceAlpha * 255));
      continue;
    }

    const observed: Rgb = [input.data[offset]!, input.data[offset + 1]!, input.data[offset + 2]!];
    const localBackground = localBackgroundEstimate(input, pixel, definite, center);
    const neutral = neutralForegroundEstimate(observed, localBackground);
    const foreground = neutral?.foreground
      ?? foregroundEstimate(input, pixel, connected, inwardDistance, localBackground, observed)
      ?? boundedRayForegroundEstimate(observed, localBackground);
    const solved = foreground === null
      ? { alpha: inwardUnknown ? 1 : distanceAlpha, reliable: false, residual: Number.POSITIVE_INFINITY }
      : neutral?.solution ?? solveAlpha(observed, foreground, localBackground);
    const alpha = solved.reliable ? solved.alpha : inwardUnknown ? 1 : distanceAlpha;
    const resultAlpha = Math.min(sourceAlpha, Math.round(alpha * 255));
    if (resultAlpha === sourceAlpha && alpha >= 0.995) continue;
    if (foreground !== null && resultAlpha > 0) {
      if (solved.reliable) {
        if (solved.residual > 4) {
          // Color-managed screenshots and compressed video often do not obey
          // one exact linear RGB composite. Inverting each channel in that
          // case preserves the plate as a colored rim; the nearby definite
          // foreground is the safer despilled RGB estimate.
          output[offset] = Math.round(foreground[0]);
          output[offset + 1] = Math.round(foreground[1]);
          output[offset + 2] = Math.round(foreground[2]);
        } else {
          output[offset] = reconstructChannel(observed[0], localBackground[0], foreground[0], alpha);
          output[offset + 1] = reconstructChannel(observed[1], localBackground[1], foreground[1], alpha);
          output[offset + 2] = reconstructChannel(observed[2], localBackground[2], foreground[2], alpha);
        }
      } else {
        // An unstable low-alpha inverse composite amplifies channel noise and
        // leaves the keyed hue in RGB. Use the bounded nearby foreground
        // estimate directly; this branch is confined to the trimap band.
        output[offset] = Math.round(foreground[0]);
        output[offset + 1] = Math.round(foreground[1]);
        output[offset + 2] = Math.round(foreground[2]);
      }
    }
    output[offset + 3] = resultAlpha;
  }
  return {
    raster: { data: output, width: input.width, height: input.height },
    backgroundPixelCount,
    unknownPixelCount,
  };
}

function countChanged(source: Raster, output: Raster): number {
  let changed = 0;
  for (let pixel = 0; pixel < source.width * source.height; pixel++) {
    const offset = pixel * 4;
    if (
      source.data[offset] !== output.data[offset]
      || source.data[offset + 1] !== output.data[offset + 1]
      || source.data[offset + 2] !== output.data[offset + 2]
      || source.data[offset + 3] !== output.data[offset + 3]
    ) changed++;
  }
  return changed;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function calibrationIdentity(
  rasters: readonly Raster[],
  colorKey: ColorKeyOptions,
  manualColor: Rgb | null,
  diagnostics: ColorKeyCalibrationDiagnostics,
): Promise<string> {
  const rasterHashes: string[] = [];
  for (const raster of rasters) {
    const dimensionBytes = new TextEncoder().encode(`${raster.width}x${raster.height}:`);
    const payload = new Uint8Array(dimensionBytes.length + raster.data.length);
    payload.set(dimensionBytes);
    payload.set(raster.data, dimensionBytes.length);
    rasterHashes.push(await sha256Hex(payload));
  }
  const descriptor = new TextEncoder().encode(JSON.stringify({
    version: PREPARED_COLOR_KEY_VERSION,
    colorKey,
    manualColor,
    rasterHashes,
    model: {
      center: diagnostics.detectedColor,
      spread: diagnostics.spread,
      dominance: diagnostics.dominance,
      definiteDistance: diagnostics.definiteDistance,
      transitionDistance: diagnostics.transitionDistance,
    },
  }));
  return `${PREPARED_COLOR_KEY_VERSION}:${await sha256Hex(descriptor)}`;
}

/** Prepare one immutable color model for every preview/final render in a session. */
export async function prepareColorKeySession(
  calibrationRasters: readonly Raster[],
  options: PrepareColorKeySessionOptions = {},
): Promise<PreparedColorKeySession> {
  if (calibrationRasters.length === 0) throw new Error('單色色鍵至少需要一張校正影像');
  const colorKey = copyColorKeyOptions(options.colorKey ?? DEFAULT_COLOR_KEY_OPTIONS);
  assertSupportedColorKeyOptions(colorKey);
  const manualColor = immutableRgb(options.manualColor ?? null);
  const border = collectBorderSamples(calibrationRasters);
  const transparentBorderFraction = border.total > 0 ? border.transparent / border.total : 1;
  const sampledCluster = fitDominantCluster(border.visible);
  const treatAsTransparent = manualColor === null && transparentBorderFraction > 0.5;
  const detectedColor = treatAsTransparent
    ? null
    : immutableRgb(manualColor ?? sampledCluster?.center ?? null);
  const spread = sampledCluster?.spread ?? 0;
  const dominance = sampledCluster?.dominance ?? 0;
  const learnedDefiniteDistance = sampledCluster?.definiteDistance ?? BASE_DEFINITE_DISTANCE;
  const learnedTransitionDistance = sampledCluster?.transitionDistance ?? BASE_TRANSITION_DISTANCE;
  const edgeScale = colorKeyUsesEdge(colorKey) ? edgeToleranceScalePercent(colorKey) / 100 : 1;
  const definiteDistance = clamp(learnedDefiniteDistance * edgeScale, 0, 255);
  const transitionDistance = Math.max(
    definiteDistance,
    clamp(learnedTransitionDistance * edgeScale, 0, 255),
  );
  const uniformity = 1 - clamp(spread / 32, 0, 1);
  const confidence = treatAsTransparent
    ? 1
    : clamp(dominance * (0.6 + uniformity * 0.4), 0, 1);
  const warnings: string[] = [];
  if (!treatAsTransparent && (sampledCluster === null || confidence < 0.62)) {
    warnings.push('外框顏色不一致，背景偵測信心偏低；已保持保守範圍，請檢查預覽或手動指定背景色。');
  }
  if (manualColor !== null && sampledCluster === null) {
    warnings.push('外框缺少足夠的不透明取樣；使用手動背景色與保守的預設範圍。');
  }
  const diagnostics: ColorKeyCalibrationDiagnostics = Object.freeze({
    detectedColor,
    confidence,
    dominance,
    spread,
    borderSampleCount: border.visible.length,
    transparentBorderFraction,
    definiteDistance,
    transitionDistance,
    warnings: Object.freeze(warnings),
  });
  const identity = await calibrationIdentity(calibrationRasters, colorKey, manualColor, diagnostics);
  const cluster = detectedColor === null ? null : Object.freeze({
    center: detectedColor,
    spread,
    dominance,
    definiteDistance,
    transitionDistance,
  });

  return Object.freeze({
    identity,
    diagnostics,
    render(input: Raster): PreparedColorKeyRenderResult {
      let raster = input;
      let backgroundPixelCount = 0;
      let unknownPixelCount = 0;
      if (colorKeyUsesEdge(colorKey) && cluster !== null) {
        const rendered = renderEdgeConnected(input, cluster, colorKey.edge);
        raster = rendered.raster;
        backgroundPixelCount = rendered.backgroundPixelCount;
        unknownPixelCount = rendered.unknownPixelCount;
      }
      if (colorKeyUsesWholeImage(colorKey)) {
        raster = renderWholeImage(raster, detectedColor, colorKey.tolerancePercent);
        backgroundPixelCount = countRemovedSourcePixels(input, raster);
      }
      const renderDiagnostics: ColorKeyRenderDiagnostics = Object.freeze({
        ...diagnostics,
        backgroundPixelCount,
        unknownPixelCount,
        changedPixelCount: countChanged(input, raster),
      });
      return {
        raster,
        automaticMatte: matteOf(raster),
        sessionIdentity: identity,
        diagnostics: renderDiagnostics,
      };
    },
  });
}
