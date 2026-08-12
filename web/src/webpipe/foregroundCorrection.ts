import type { Raster } from './raster.js';

export interface KeepMask {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array<ArrayBuffer>;
}

export interface MaskRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface MaskStrokeDiff {
  readonly width: number;
  readonly height: number;
  readonly rect: MaskRect;
  readonly before: Uint8Array<ArrayBuffer>;
  readonly after: Uint8Array<ArrayBuffer>;
}

export interface KeepStroke {
  readonly mode: 'restore' | 'clear';
  readonly points: readonly { readonly x: number; readonly y: number }[];
  /** Radius in source-raster pixels. */
  readonly radius: number;
  /** 0 is fully feathered; 1 has a hard edge. */
  readonly hardness: number;
  /** Maximum 8-bit change contributed by this stroke. */
  readonly strength?: number;
}

export interface PaintedKeepStroke {
  readonly mask: KeepMask;
  readonly diff: MaskStrokeDiff;
}

export interface IncrementalKeepStroke {
  /** Gesture-local mask. Its data is updated by addPoint without replacing the array. */
  readonly mask: KeepMask;
  addPoint(point: { readonly x: number; readonly y: number }): MaskRect;
  finish(): PaintedKeepStroke;
}

export interface CorrectionViewTransform {
  readonly clientLeft: number;
  readonly clientTop: number;
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly backingWidth: number;
  readonly backingHeight: number;
  readonly zoom: number;
  /** Pan in backing-canvas pixels. */
  readonly panX: number;
  readonly panY: number;
  /** Informational only: CSS/backing geometry already accounts for DPR. */
  readonly devicePixelRatio?: number;
}

export interface CroppedKeepMask {
  readonly format: 'keep-mask-u8-crop-v1';
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly sourceContentHash: string;
  readonly bounds: MaskRect;
  readonly data: Uint8Array<ArrayBuffer>;
}

/** Strong, geometry-bound identity for a source raster used by persisted corrections. */
export async function hashRasterContent(raster: Raster): Promise<string> {
  assertRaster(raster, 'source');
  const bytes = new Uint8Array(8 + raster.data.byteLength);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, raster.width, false);
  view.setUint32(4, raster.height, false);
  bytes.set(new Uint8Array(
    raster.data.buffer,
    raster.data.byteOffset,
    raster.data.byteLength,
  ), 8);
  const digest = await crypto.subtle.digest('SHA-256', bytes.buffer);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

function assertDimension(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new RangeError(`${name} must be an unsigned 32-bit integer`);
  }
}

function assertMask(mask: KeepMask): void {
  assertDimension(mask.width, 'mask width');
  assertDimension(mask.height, 'mask height');
  if (mask.data.length !== mask.width * mask.height) {
    throw new RangeError('Keep mask data length does not match its geometry');
  }
}

function assertRaster(raster: Raster, name: string): void {
  assertDimension(raster.width, `${name} width`);
  assertDimension(raster.height, `${name} height`);
  if (raster.data.length !== raster.width * raster.height * 4) {
    throw new RangeError(`${name} RGBA data length does not match its geometry`);
  }
}

export function createKeepMask(width: number, height: number, fill = 0): KeepMask {
  assertDimension(width, 'mask width');
  assertDimension(height, 'mask height');
  if (!Number.isInteger(fill) || fill < 0 || fill > 255) {
    throw new RangeError('Keep mask fill must be an 8-bit integer');
  }
  const data = new Uint8Array(width * height);
  if (fill !== 0) data.fill(fill);
  return { width, height, data };
}

/**
 * Composes automatic output toward source without mutating any input.
 * Automatic alpha above source alpha is rejected because it cannot satisfy both
 * the exact-zero endpoint and the source-alpha upper bound.
 */
export function applyForegroundCorrection(
  source: Raster,
  automatic: Raster,
  keep: KeepMask,
): Raster {
  assertRaster(source, 'source');
  assertRaster(automatic, 'automatic');
  assertMask(keep);
  if (
    source.width !== automatic.width
    || source.height !== automatic.height
    || source.width !== keep.width
    || source.height !== keep.height
  ) {
    throw new RangeError('Foreground correction geometry must match');
  }

  let allZero = true;
  for (let pixel = 0; pixel < keep.data.length; pixel++) {
    const sourceAlpha = source.data[pixel * 4 + 3]!;
    const automaticAlpha = automatic.data[pixel * 4 + 3]!;
    if (automaticAlpha > sourceAlpha) {
      throw new RangeError('Automatic alpha cannot exceed source alpha');
    }
    if (keep.data[pixel] !== 0) allZero = false;
  }
  if (allZero) return automatic;

  const data = new Uint8ClampedArray(automatic.data);
  for (let pixel = 0; pixel < keep.data.length; pixel++) {
    const strengthByte = keep.data[pixel]!;
    if (strengthByte === 0) continue;
    const offset = pixel * 4;
    if (strengthByte === 255) {
      data.set(source.data.subarray(offset, offset + 4), offset);
      continue;
    }

    const strength = strengthByte / 255;
    const automaticAlpha = automatic.data[offset + 3]!;
    const sourceAlpha = source.data[offset + 3]!;
    const outputAlpha = automaticAlpha + (sourceAlpha - automaticAlpha) * strength;
    for (let channel = 0; channel < 3; channel++) {
      const automaticPremultiplied = automatic.data[offset + channel]! * automaticAlpha;
      const sourcePremultiplied = source.data[offset + channel]! * sourceAlpha;
      const outputPremultiplied = automaticPremultiplied
        + (sourcePremultiplied - automaticPremultiplied) * strength;
      data[offset + channel] = outputAlpha === 0 ? 0 : Math.round(outputPremultiplied / outputAlpha);
    }
    data[offset + 3] = Math.round(outputAlpha);
  }
  return { width: source.width, height: source.height, data };
}

export function mapClientToSource(
  point: { readonly x: number; readonly y: number },
  view: CorrectionViewTransform,
): { x: number; y: number } {
  const values = [
    point.x,
    point.y,
    view.clientLeft,
    view.clientTop,
    view.cssWidth,
    view.cssHeight,
    view.backingWidth,
    view.backingHeight,
    view.zoom,
    view.panX,
    view.panY,
  ];
  if (!values.every(Number.isFinite) || view.cssWidth <= 0 || view.cssHeight <= 0 || view.zoom <= 0) {
    throw new RangeError('Correction view transform must contain finite positive geometry and zoom');
  }
  const backingX = (point.x - view.clientLeft) * (view.backingWidth / view.cssWidth);
  const backingY = (point.y - view.clientTop) * (view.backingHeight / view.cssHeight);
  return {
    x: (backingX - view.panX) / view.zoom,
    y: (backingY - view.panY) / view.zoom,
  };
}

function distanceToSegment(
  x: number,
  y: number,
  start: { readonly x: number; readonly y: number },
  end: { readonly x: number; readonly y: number },
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(x - start.x, y - start.y);
  const position = Math.max(0, Math.min(1, ((x - start.x) * dx + (y - start.y) * dy) / lengthSquared));
  return Math.hypot(x - (start.x + dx * position), y - (start.y + dy * position));
}

function strokeBounds(mask: KeepMask, stroke: KeepStroke): MaskRect {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of stroke.points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  const left = Math.max(0, Math.floor(minX - stroke.radius));
  const top = Math.max(0, Math.floor(minY - stroke.radius));
  const right = Math.min(mask.width - 1, Math.ceil(maxX + stroke.radius));
  const bottom = Math.min(mask.height - 1, Math.ceil(maxY + stroke.radius));
  return {
    left,
    top,
    width: Math.max(0, right - left + 1),
    height: Math.max(0, bottom - top + 1),
  };
}

function unionRects(first: MaskRect | null, second: MaskRect): MaskRect {
  if (!first) return second;
  const left = Math.min(first.left, second.left);
  const top = Math.min(first.top, second.top);
  const right = Math.max(first.left + first.width, second.left + second.width);
  const bottom = Math.max(first.top + first.height, second.top + second.height);
  return { left, top, width: right - left, height: bottom - top };
}

function readTile(mask: KeepMask, rect: MaskRect): Uint8Array<ArrayBuffer> {
  const tile = new Uint8Array(rect.width * rect.height);
  for (let y = 0; y < rect.height; y++) {
    const start = (rect.top + y) * mask.width + rect.left;
    tile.set(mask.data.subarray(start, start + rect.width), y * rect.width);
  }
  return tile;
}

export function paintKeepStroke(mask: KeepMask, stroke: KeepStroke): PaintedKeepStroke {
  assertMask(mask);
  if (stroke.points.length === 0 || !stroke.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))) {
    throw new RangeError('A Keep stroke requires finite source-coordinate points');
  }
  if (!Number.isFinite(stroke.radius) || stroke.radius <= 0) {
    throw new RangeError('Keep stroke radius must be positive');
  }
  if (!Number.isFinite(stroke.hardness) || stroke.hardness < 0 || stroke.hardness > 1) {
    throw new RangeError('Keep stroke hardness must be between 0 and 1');
  }
  const strength = stroke.strength ?? 255;
  if (!Number.isInteger(strength) || strength < 0 || strength > 255) {
    throw new RangeError('Keep stroke strength must be an 8-bit integer');
  }

  const rect = strokeBounds(mask, stroke);
  const before = readTile(mask, rect);
  const data = new Uint8Array(mask.data);
  const segments = stroke.points.length === 1
    ? [[stroke.points[0]!, stroke.points[0]!] as const]
    : stroke.points.slice(1).map((point, index) => [stroke.points[index]!, point] as const);
  const innerRadius = stroke.radius * stroke.hardness;
  for (let y = rect.top; y < rect.top + rect.height; y++) {
    for (let x = rect.left; x < rect.left + rect.width; x++) {
      let distance = Number.POSITIVE_INFINITY;
      for (const [start, end] of segments) {
        distance = Math.min(distance, distanceToSegment(x, y, start, end));
      }
      if (distance > stroke.radius) continue;
      const falloff = distance <= innerRadius || innerRadius === stroke.radius
        ? 1
        : (stroke.radius - distance) / (stroke.radius - innerRadius);
      const contribution = Math.round(strength * Math.max(0, Math.min(1, falloff)));
      const index = y * mask.width + x;
      data[index] = stroke.mode === 'restore'
        ? Math.min(255, data[index]! + contribution)
        : Math.max(0, data[index]! - contribution);
    }
  }
  const next = { width: mask.width, height: mask.height, data };
  return {
    mask: next,
    diff: {
      width: mask.width,
      height: mask.height,
      rect,
      before,
      after: readTile(next, rect),
    },
  };
}

/**
 * Builds one brush stroke segment-by-segment. Each pixel keeps the strongest
 * coverage seen during the gesture, matching paintKeepStroke without replaying
 * every earlier point for every pointer event.
 */
export function createIncrementalKeepStroke(
  mask: KeepMask,
  stroke: Omit<KeepStroke, 'points'>,
): IncrementalKeepStroke {
  assertMask(mask);
  if (!Number.isFinite(stroke.radius) || stroke.radius <= 0) {
    throw new RangeError('Keep stroke radius must be positive');
  }
  if (!Number.isFinite(stroke.hardness) || stroke.hardness < 0 || stroke.hardness > 1) {
    throw new RangeError('Keep stroke hardness must be between 0 and 1');
  }
  const strength = stroke.strength ?? 255;
  if (!Number.isInteger(strength) || strength < 0 || strength > 255) {
    throw new RangeError('Keep stroke strength must be an 8-bit integer');
  }

  const data = new Uint8Array(mask.data);
  const workingMask: KeepMask = { width: mask.width, height: mask.height, data };
  const coverage = new Uint8Array(mask.data.length);
  const innerRadius = stroke.radius * stroke.hardness;
  let previousPoint: { readonly x: number; readonly y: number } | null = null;
  let affectedBounds: MaskRect | null = null;

  return {
    mask: workingMask,
    addPoint(point) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
        throw new RangeError('A Keep stroke requires finite source-coordinate points');
      }
      const start = previousPoint ?? point;
      const rect = strokeBounds(mask, { ...stroke, points: [start, point] });
      for (let y = rect.top; y < rect.top + rect.height; y++) {
        for (let x = rect.left; x < rect.left + rect.width; x++) {
          const distance = distanceToSegment(x, y, start, point);
          if (distance > stroke.radius) continue;
          const falloff = distance <= innerRadius || innerRadius === stroke.radius
            ? 1
            : (stroke.radius - distance) / (stroke.radius - innerRadius);
          const contribution = Math.round(strength * Math.max(0, Math.min(1, falloff)));
          const index = y * mask.width + x;
          if (contribution <= coverage[index]!) continue;
          coverage[index] = contribution;
          data[index] = stroke.mode === 'restore'
            ? Math.min(255, mask.data[index]! + contribution)
            : Math.max(0, mask.data[index]! - contribution);
        }
      }
      previousPoint = point;
      affectedBounds = unionRects(affectedBounds, rect);
      return rect;
    },
    finish() {
      if (!affectedBounds) throw new RangeError('A Keep stroke requires at least one point');
      return {
        mask: workingMask,
        diff: {
          width: mask.width,
          height: mask.height,
          rect: affectedBounds,
          before: readTile(mask, affectedBounds),
          after: readTile(workingMask, affectedBounds),
        },
      };
    },
  };
}

function applyDiffTile(mask: KeepMask, diff: MaskStrokeDiff, tile: Uint8Array<ArrayBuffer>): KeepMask {
  assertMask(mask);
  if (mask.width !== diff.width || mask.height !== diff.height) {
    throw new RangeError('Mask stroke diff geometry must match');
  }
  const { rect } = diff;
  if (
    rect.left < 0
    || rect.top < 0
    || rect.width < 0
    || rect.height < 0
    || rect.left + rect.width > mask.width
    || rect.top + rect.height > mask.height
    || tile.length !== rect.width * rect.height
  ) {
    throw new RangeError('Mask stroke diff tile geometry or length is invalid');
  }
  const data = new Uint8Array(mask.data);
  for (let y = 0; y < rect.height; y++) {
    data.set(tile.subarray(y * rect.width, (y + 1) * rect.width), (rect.top + y) * mask.width + rect.left);
  }
  return { width: mask.width, height: mask.height, data };
}

export function undoMaskStroke(mask: KeepMask, diff: MaskStrokeDiff): KeepMask {
  return applyDiffTile(mask, diff, diff.before);
}

export function redoMaskStroke(mask: KeepMask, diff: MaskStrokeDiff): KeepMask {
  return applyDiffTile(mask, diff, diff.after);
}

export function maskBounds(mask: KeepMask): MaskRect | null {
  assertMask(mask);
  let left = mask.width;
  let top = mask.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      if (mask.data[y * mask.width + x] === 0) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < 0) return null;
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

export function copyKeepMask(mask: KeepMask, targetWidth: number, targetHeight: number): KeepMask {
  assertMask(mask);
  assertDimension(targetWidth, 'target width');
  assertDimension(targetHeight, 'target height');
  if (mask.width !== targetWidth || mask.height !== targetHeight) {
    throw new RangeError('Keep mask can only be copied to matching geometry');
  }
  return { width: mask.width, height: mask.height, data: new Uint8Array(mask.data) };
}

export function encodeCroppedKeepMask(mask: KeepMask, sourceContentHash: string): CroppedKeepMask | null {
  assertMask(mask);
  const bounds = maskBounds(mask);
  if (!bounds) return null;
  const data = readTile(mask, bounds);
  return {
    format: 'keep-mask-u8-crop-v1',
    sourceWidth: mask.width,
    sourceHeight: mask.height,
    sourceContentHash,
    bounds,
    data,
  };
}

function assertCroppedMask(encoded: CroppedKeepMask): void {
  if (encoded.format !== 'keep-mask-u8-crop-v1') throw new RangeError('Unknown Keep mask format');
  assertDimension(encoded.sourceWidth, 'source width');
  assertDimension(encoded.sourceHeight, 'source height');
  const { bounds } = encoded;
  if (
    !Number.isSafeInteger(bounds.left)
    || !Number.isSafeInteger(bounds.top)
    || !Number.isSafeInteger(bounds.width)
    || !Number.isSafeInteger(bounds.height)
    || bounds.left < 0
    || bounds.top < 0
    || bounds.width <= 0
    || bounds.height <= 0
    || bounds.left + bounds.width > encoded.sourceWidth
    || bounds.top + bounds.height > encoded.sourceHeight
  ) {
    throw new RangeError('Cropped Keep mask geometry is invalid');
  }
  if (encoded.data.length !== bounds.width * bounds.height) {
    throw new RangeError('Cropped Keep mask data length is invalid');
  }
}

export function decodeCroppedKeepMask(encoded: CroppedKeepMask): KeepMask {
  assertCroppedMask(encoded);
  const mask = createKeepMask(encoded.sourceWidth, encoded.sourceHeight);
  const data = new Uint8Array(mask.data);
  for (let y = 0; y < encoded.bounds.height; y++) {
    const sourceStart = y * encoded.bounds.width;
    data.set(
      encoded.data.subarray(sourceStart, sourceStart + encoded.bounds.width),
      (encoded.bounds.top + y) * encoded.sourceWidth + encoded.bounds.left,
    );
  }
  return { width: mask.width, height: mask.height, data };
}

/** Hashes the lossless mask asset, excluding the source target so identical assets deduplicate. */
export async function hashCroppedKeepMask(encoded: CroppedKeepMask): Promise<string> {
  assertCroppedMask(encoded);
  const prefix = new TextEncoder().encode('keep-mask-u8-crop-v1\0');
  const header = new Uint8Array(6 * 4);
  const view = new DataView(header.buffer);
  const values = [
    encoded.sourceWidth,
    encoded.sourceHeight,
    encoded.bounds.left,
    encoded.bounds.top,
    encoded.bounds.width,
    encoded.bounds.height,
  ];
  values.forEach((value, index) => view.setUint32(index * 4, value, false));
  const bytes = new Uint8Array(prefix.length + header.length + encoded.data.length);
  bytes.set(prefix, 0);
  bytes.set(header, prefix.length);
  bytes.set(encoded.data, prefix.length + header.length);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}
