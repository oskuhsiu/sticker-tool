import type { ForegroundCorrectionRecord } from './backgroundCorrection.js';
import { VIDEO_CORRECTION_LIMITS } from '@core/videoProject.js';
import { applyForegroundCorrection, copyKeepMask, createKeepMask, type KeepMask } from './foregroundCorrection.js';
import type { Raster } from './raster.js';

export interface VideoFrameCorrectionRecord extends ForegroundCorrectionRecord {
  readonly stickerId: string;
  readonly visualFrameId: string;
  readonly sourceContentHash: string;
  readonly keepMask: KeepMask;
}

export type VideoFrameCorrectionMap = ReadonlyMap<string, VideoFrameCorrectionRecord>;

export function videoCorrectionTargetKey(stickerId: string, visualFrameId: string): string {
  if (!stickerId || !visualFrameId) throw new Error('Video correction target requires sticker and visual IDs');
  return `${stickerId}\u0000${visualFrameId}`;
}

export function createVideoFrameCorrection(args: {
  stickerId: string;
  visualFrameId: string;
  sourceContentHash: string;
  label: string;
  source: Raster;
  mask?: KeepMask;
  /** Bulk coordinate-copy may share an immutable mask across equal geometry. */
  copyMask?: boolean;
}): VideoFrameCorrectionRecord {
  const identity = videoCorrectionTargetKey(args.stickerId, args.visualFrameId);
  const mask = args.mask ?? createKeepMask(args.source.width, args.source.height);
  if (mask.width !== args.source.width || mask.height !== args.source.height) {
    throw new RangeError('Video Keep mask geometry must match its raw visual');
  }
  return {
    stickerId: args.stickerId,
    visualFrameId: args.visualFrameId,
    sourceContentHash: args.sourceContentHash,
    sourceIdentity: identity,
    label: args.label,
    width: args.source.width,
    height: args.source.height,
    keepMask: args.copyMask === false ? mask : copyKeepMask(mask, mask.width, mask.height),
  };
}

export function assertVideoCorrectionBudget(corrections: VideoFrameCorrectionMap): void {
  let edits = 0;
  let decodedPixels = 0;
  for (const correction of corrections.values()) {
    if (!correction.keepMask.data.some((value) => value !== 0)) continue;
    edits++;
    decodedPixels += correction.width * correction.height;
    if (edits > VIDEO_CORRECTION_LIMITS.maxEdits) throw new Error('影片保留筆刷超過可保存的 edit 上限');
    if (decodedPixels > VIDEO_CORRECTION_LIMITS.maxDecodedPixels) {
      throw new Error('影片保留筆刷超過可保存的遮罩像素上限');
    }
  }
}

export function applyVideoFrameCorrection(
  source: Raster,
  automatic: Raster,
  correction: VideoFrameCorrectionRecord | undefined,
  sourceContentHash: string,
): Raster {
  if (!correction) return automatic;
  if (
    correction.sourceContentHash !== sourceContentHash
    || correction.width !== source.width
    || correction.height !== source.height
  ) {
    return automatic;
  }
  return applyForegroundCorrection(source, automatic, correction.keepMask);
}

function updateHash(hash: bigint, value: number): bigint {
  return BigInt.asUintN(64, (hash ^ BigInt(value & 0xff)) * 0x100000001b3n);
}

function updateText(hash: bigint, value: string): bigint {
  const bytes = new TextEncoder().encode(value);
  let next = hash;
  for (const byte of bytes) next = updateHash(next, byte);
  return updateHash(next, 0xff);
}

/**
 * Synchronous draft-freshness identity. Persisted mask assets still use SHA-256;
 * this compact identity exists so React can reject stale current bytes immediately.
 */
export function videoCorrectionSetIdentity(
  corrections: VideoFrameCorrectionMap,
  stickerId: string,
  activeVisualFrameIds: readonly string[],
): string {
  let hash = 0xcbf29ce484222325n;
  const uniqueIds = [...new Set(activeVisualFrameIds)].sort();
  let edited = 0;
  for (const visualFrameId of uniqueIds) {
    const correction = corrections.get(videoCorrectionTargetKey(stickerId, visualFrameId));
    if (!correction || !correction.keepMask.data.some((value) => value !== 0)) continue;
    edited++;
    hash = updateText(hash, stickerId);
    hash = updateText(hash, visualFrameId);
    hash = updateText(hash, correction.sourceContentHash);
    hash = updateText(hash, `${correction.width}x${correction.height}`);
    for (const value of correction.keepMask.data) hash = updateHash(hash, value);
  }
  return `video-keep-set@1:${edited}:${hash.toString(16).padStart(16, '0')}`;
}

export function countEditedVideoVisuals(
  corrections: VideoFrameCorrectionMap,
  stickerId: string,
): number {
  let count = 0;
  for (const correction of corrections.values()) {
    if (correction.stickerId === stickerId && correction.keepMask.data.some((value) => value !== 0)) count++;
  }
  return count;
}

export function cloneVideoCorrectionMap(
  corrections: VideoFrameCorrectionMap,
): Map<string, VideoFrameCorrectionRecord> {
  return new Map([...corrections].map(([key, correction]) => [key, {
    ...correction,
    keepMask: copyKeepMask(correction.keepMask, correction.width, correction.height),
  }]));
}
