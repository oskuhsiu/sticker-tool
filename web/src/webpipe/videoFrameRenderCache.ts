import type { VideoBackgroundSettings } from '@core/videoProject.js';
import { cloneRaster, type Raster } from './raster.js';

interface CacheEntry {
  raster: Raster;
  bytes: number;
  lastUsed: number;
}

export class VideoFrameRenderCache {
  private readonly entries = new Map<string, CacheEntry>();
  private totalBytes = 0;
  private clock = 0;

  constructor(readonly maxBytes: number) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
      throw new RangeError('VideoFrameRenderCache maxBytes must be positive');
    }
  }

  static key(args: {
    stickerId: string;
    rawFrameHash: string;
    removerVersion: string;
    background: VideoBackgroundSettings;
  }): string {
    const background = {
      mode: args.background.mode,
      color: args.background.color ?? null,
      tolerance: args.background.tolerance ?? null,
      ...(args.background.mode === 'color-key'
        ? { colorKey: args.background.colorKey ?? null }
        : {}),
    };
    return `${args.stickerId}|${args.rawFrameHash}|${args.removerVersion}|${JSON.stringify(background)}`;
  }

  get(key: string): Raster | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    entry.lastUsed = ++this.clock;
    return cloneRaster(entry.raster);
  }

  set(key: string, raster: Raster): void {
    const existing = this.entries.get(key);
    if (existing) {
      this.totalBytes -= existing.bytes;
      this.entries.delete(key);
    }
    const copy = cloneRaster(raster);
    const entry = { raster: copy, bytes: copy.data.byteLength, lastUsed: ++this.clock };
    if (entry.bytes > this.maxBytes) return;
    this.entries.set(key, entry);
    this.totalBytes += entry.bytes;
    while (this.totalBytes > this.maxBytes && this.entries.size > 0) {
      let oldestKey: string | null = null;
      let oldestUse = Number.POSITIVE_INFINITY;
      for (const [candidateKey, candidate] of this.entries) {
        if (candidate.lastUsed < oldestUse) {
          oldestKey = candidateKey;
          oldestUse = candidate.lastUsed;
        }
      }
      if (!oldestKey) break;
      this.totalBytes -= this.entries.get(oldestKey)!.bytes;
      this.entries.delete(oldestKey);
    }
  }

  clear(): void {
    this.entries.clear();
    this.totalBytes = 0;
  }

  get bytesUsed(): number {
    return this.totalBytes;
  }
}
