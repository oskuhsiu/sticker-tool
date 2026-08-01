import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { VideoGridPlan } from '@core/videoCrop.js';
import { pngImageInfo } from './png.js';
import {
  type MasterApngChunk,
  type MasterApngSet,
  type MasterApngSticker,
} from './masterApng.js';
import type {
  VideoRenderMetrics,
  VideoRenderSnapshot,
  VideoStickerSettings,
} from './processMasterApngSticker.js';
import type { VideoMetadata } from './videoSource.js';

const MANIFEST_PATH = 'sticker-project.json';
const MAX_ARCHIVE_ENTRIES = 600;
const MAX_UNCOMPRESSED_BYTES = 600_000_000;

interface ChunkManifest {
  path: string;
  id: string;
  index: number;
  timestampsMs: number[];
  delaysMs: number[];
  width: number;
  height: number;
  bytes: number;
}

interface RenderManifest {
  path: string;
  settings: VideoStickerSettings;
  metrics: VideoRenderMetrics;
  notes: string[];
}

export interface VideoProjectManifestV1 {
  schema: 'sticker-tool/video-apng-project';
  version: 1;
  createdAt: string;
  name: string;
  cover: number;
  source: VideoMetadata & {
    embedded: false;
    editableStartMs: number;
    editableEndMs: number;
    sampling: 'time-uniform';
  };
  grid: VideoGridPlan;
  master: {
    sourceFrameCount: number;
    masterFrameCount: number;
    chunkFrames: number;
    stickers: Array<{
      id: string;
      index: number;
      width: number;
      height: number;
      chunks: ChunkManifest[];
    }>;
  };
  settings: VideoStickerSettings[];
  baseline: RenderManifest[];
  current: RenderManifest[];
}

export interface VideoProjectRuntime {
  manifest: VideoProjectManifestV1;
  master: MasterApngSet;
  baseline: VideoRenderSnapshot[];
  current: VideoRenderSnapshot[];
}

function renderPath(kind: 'original' | 'adjusted', index: number): string {
  return `renders/${kind}/${String(index + 1).padStart(2, '0')}.png`;
}

export function buildVideoProjectZip(args: {
  name: string;
  createdAt?: string;
  cover: number;
  source: VideoMetadata;
  editableStartMs: number;
  editableEndMs: number;
  grid: VideoGridPlan;
  master: MasterApngSet;
  settings: VideoStickerSettings[];
  baseline: VideoRenderSnapshot[];
  current: VideoRenderSnapshot[];
}): { zip: Uint8Array; manifest: VideoProjectManifestV1 } {
  if (
    args.master.stickers.length !== args.baseline.length ||
    args.baseline.length !== args.current.length ||
    args.current.length !== args.settings.length
  ) {
    throw new Error('Project ZIP 無法建立：master、settings、baseline、current 張數不一致');
  }
  const files: Record<string, Uint8Array> = {};
  const masterStickers = args.master.stickers.map((sticker) => ({
    id: sticker.id,
    index: sticker.index,
    width: sticker.width,
    height: sticker.height,
    chunks: sticker.chunks.map((chunk) => {
      const path = `master/${sticker.id}/chunk_${String(chunk.index + 1).padStart(3, '0')}.png`;
      files[path] = chunk.png;
      return {
        path,
        id: chunk.id,
        index: chunk.index,
        timestampsMs: [...chunk.timestampsMs],
        delaysMs: [...chunk.delaysMs],
        width: chunk.width,
        height: chunk.height,
        bytes: chunk.png.length,
      };
    }),
  }));
  const baseline = args.baseline.map((snapshot, index) => {
    const path = renderPath('original', index);
    files[path] = snapshot.png;
    return {
      path,
      settings: snapshot.settings,
      metrics: snapshot.metrics,
      notes: snapshot.notes,
    };
  });
  const current = args.current.map((snapshot, index) => {
    const path = renderPath('adjusted', index);
    files[path] = snapshot.png;
    return {
      path,
      settings: snapshot.settings,
      metrics: snapshot.metrics,
      notes: snapshot.notes,
    };
  });
  const manifest: VideoProjectManifestV1 = {
    schema: 'sticker-tool/video-apng-project',
    version: 1,
    createdAt: args.createdAt ?? new Date().toISOString(),
    name: args.name,
    cover: args.cover,
    source: {
      ...args.source,
      embedded: false,
      editableStartMs: args.editableStartMs,
      editableEndMs: args.editableEndMs,
      sampling: 'time-uniform',
    },
    grid: args.grid,
    master: {
      sourceFrameCount: args.master.sourceFrameCount,
      masterFrameCount: args.master.masterFrameCount,
      chunkFrames: args.master.chunkFrames,
      stickers: masterStickers,
    },
    settings: args.settings.map((settings) => ({ ...settings })),
    baseline,
    current,
  };
  files['reports/metrics.json'] = strToU8(
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      baseline: baseline.map((render) => render.metrics),
      current: current.map((render) => render.metrics),
    }, null, 2),
  );
  files[MANIFEST_PATH] = strToU8(JSON.stringify(manifest, null, 2));
  return { zip: zipSync(files, { level: 6 }), manifest };
}

function safeEntryPath(path: string): boolean {
  return !path.startsWith('/') && !path.includes('\\') && !path.split('/').includes('..');
}

function requireFile(files: Record<string, Uint8Array>, path: string): Uint8Array {
  const bytes = files[path];
  if (!bytes) throw new Error(`Project ZIP 缺少 ${path}`);
  return new Uint8Array(bytes);
}

function parseManifest(files: Record<string, Uint8Array>): VideoProjectManifestV1 {
  const raw = requireFile(files, MANIFEST_PATH);
  let parsed: unknown;
  try {
    parsed = JSON.parse(strFromU8(raw));
  } catch {
    throw new Error('Project ZIP 的 sticker-project.json 不是有效 JSON');
  }
  const value = parsed as Partial<VideoProjectManifestV1>;
  if (value.schema !== 'sticker-tool/video-apng-project' || value.version !== 1) {
    throw new Error('不支援的 Project ZIP schema 或版本');
  }
  if (
    typeof value.name !== 'string' ||
    !value.source ||
    !value.grid ||
    !value.master ||
    !Array.isArray(value.master.stickers) ||
    !Array.isArray(value.settings) ||
    !Array.isArray(value.baseline) ||
    !Array.isArray(value.current)
  ) {
    throw new Error('Project ZIP manifest 缺少必要欄位');
  }
  const count = value.master.stickers.length;
  if (count < 1 || value.settings.length !== count || value.baseline.length !== count || value.current.length !== count) {
    throw new Error('Project ZIP manifest 的 master/settings/render 張數不一致');
  }
  return value as VideoProjectManifestV1;
}

function restoreRender(files: Record<string, Uint8Array>, render: RenderManifest): VideoRenderSnapshot {
  const png = requireFile(files, render.path);
  const info = pngImageInfo(png);
  return {
    png,
    info: {
      ...info,
      durationMs: render.metrics.perLoopDurationMs,
      distinctFrames: render.metrics.distinctFrames,
      transparentPixels: render.metrics.transparentPixels,
      foregroundPixels: render.metrics.foregroundPixels,
    },
    settings: { ...render.settings },
    metrics: { ...render.metrics },
    notes: [...render.notes],
  };
}

export function importVideoProjectZip(zipBytes: Uint8Array): VideoProjectRuntime {
  const files = unzipSync(zipBytes);
  const paths = Object.keys(files);
  if (paths.length > MAX_ARCHIVE_ENTRIES) throw new Error(`Project ZIP 檔案數超過 ${MAX_ARCHIVE_ENTRIES}`);
  let total = 0;
  for (const path of paths) {
    if (!safeEntryPath(path)) throw new Error(`Project ZIP 含不安全路徑：${path}`);
    total += files[path]!.length;
    if (total > MAX_UNCOMPRESSED_BYTES) throw new Error('Project ZIP 解壓後超過 600MB 安全上限');
  }
  const manifest = parseManifest(files);
  const stickers: MasterApngSticker[] = manifest.master.stickers.map((sticker) => ({
    id: sticker.id,
    index: sticker.index,
    width: sticker.width,
    height: sticker.height,
    chunks: sticker.chunks.map((chunk): MasterApngChunk => {
      const png = requireFile(files, chunk.path);
      if (png.length !== chunk.bytes) throw new Error(`${chunk.path} bytes 與 manifest 不一致`);
      return {
        id: chunk.id,
        stickerId: sticker.id,
        index: chunk.index,
        timestampsMs: [...chunk.timestampsMs],
        delaysMs: [...chunk.delaysMs],
        width: chunk.width,
        height: chunk.height,
        png,
      };
    }),
  }));
  return {
    manifest,
    master: {
      timestampsMs: stickers[0]?.chunks.flatMap((chunk) => chunk.timestampsMs) ?? [],
      sourceFrameCount: manifest.master.sourceFrameCount,
      masterFrameCount: manifest.master.masterFrameCount,
      chunkFrames: manifest.master.chunkFrames,
      stickers,
    },
    baseline: manifest.baseline.map((render) => restoreRender(files, render)),
    current: manifest.current.map((render) => restoreRender(files, render)),
  };
}
