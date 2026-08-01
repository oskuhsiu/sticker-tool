import {
  AsyncUnzipInflate,
  AsyncZipDeflate,
  strFromU8,
  strToU8,
  Unzip,
  UnzipInflate,
  Zip,
  ZipPassThrough,
} from 'fflate';
import type { VideoGridPlan } from '@core/videoCrop.js';
import {
  VIDEO_PROJECT_SCHEMA,
  VIDEO_PROJECT_VERSION,
  isVideoProjectManifestHeader,
  type VideoBackgroundStage,
  type VideoFrameCoverage,
  type VideoSelectionPlanV2,
} from '@core/videoProject.js';
import { pngImageInfo } from './png.js';
import {
  type MasterApngChunk,
  type MasterApngSet,
  type MasterApngSticker,
} from './masterApng.js';
import {
  inspectAnimatedBytes,
  type VideoRenderMetrics,
  type VideoRenderSnapshot,
  type VideoStickerSettings,
} from './processMasterApngSticker.js';
import type { VideoMetadata } from './videoSource.js';
import { createVideoMasterStore, type VideoMasterStore } from './videoMasterStore.js';

const MANIFEST_PATH = 'sticker-project.json';
const REPORT_PATH = 'reports/metrics.json';
const MAX_ARCHIVE_ENTRIES = 700;
const MAX_UNCOMPRESSED_BYTES = 600_000_000;

interface ChunkManifestV2 extends Omit<MasterApngChunk, 'storeKey'> {
  path: string;
}

interface RenderManifestV2 {
  path: string;
  sha256: string;
  bytes: number;
  settings: VideoStickerSettings;
  metrics: VideoRenderMetrics;
  selection: VideoSelectionPlanV2;
  notes: string[];
  errors: string[];
}

export interface VideoProjectManifestV2 {
  schema: typeof VIDEO_PROJECT_SCHEMA;
  version: typeof VIDEO_PROJECT_VERSION;
  createdAt: string;
  name: string;
  cover: number;
  sourceTimingUnit: 'microseconds';
  frameCoverage: VideoFrameCoverage;
  backgroundStage: VideoBackgroundStage;
  source: VideoMetadata & {
    embedded: false;
    editableStartUs: number;
    editableEndUs: number;
  };
  grid: VideoGridPlan;
  master: {
    sourceFrameCount: number;
    visualFrameCount: number;
    chunkFrames: number;
    stickers: Array<{
      id: string;
      index: number;
      width: number;
      height: number;
      chunks: ChunkManifestV2[];
    }>;
  };
  settings: VideoStickerSettings[];
  current: Array<RenderManifestV2 | null>;
  versions: {
    app: string;
    decoder: string;
    demuxer: string;
    removers: Record<string, string>;
  };
  legacy?: {
    importedFromVersion: 1;
    limitations: string[];
  };
}

export interface VideoProjectRuntime {
  manifest: VideoProjectManifestV2;
  master: MasterApngSet;
  current: Array<VideoRenderSnapshot | null>;
}

interface VideoProjectManifestV1 {
  schema: typeof VIDEO_PROJECT_SCHEMA;
  version: 1;
  createdAt: string;
  name: string;
  cover: number;
  source: {
    fileName: string;
    mimeType: string;
    durationMs: number;
    width: number;
    height: number;
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
      chunks: Array<{
        path: string;
        id: string;
        index: number;
        timestampsMs: number[];
        delaysMs: number[];
        width: number;
        height: number;
        bytes: number;
      }>;
    }>;
  };
  settings: Array<{
    startMs: number;
    endMs: number;
    targetFrames: number;
    playbackSec: 1 | 2 | 3 | 4;
    loops: 1 | 2 | 3 | 4;
    maxColors: number;
  }>;
  current: Array<{
    path: string;
    settings: VideoProjectManifestV1['settings'][number];
    metrics: {
      masterFramesInRange: number;
      requestedFrames: number;
      outputFrames: number;
      droppedFrames: number;
      selectedTimestampsMs: number[];
      frameDelaysMs: number[];
      perLoopDurationMs: number;
      totalPlaybackMs: number;
      bytes: number;
      width: number;
      height: number;
      distinctFrames: number;
      transparentPixels: number;
      foregroundPixels: number;
    };
    notes: string[];
  }>;
}

interface ArchiveContents {
  retained: Map<string, Uint8Array>;
  paths: Set<string>;
}

function safeEntryPath(path: string): boolean {
  return (
    path.length > 0 &&
    path.length <= 240 &&
    !path.startsWith('/') &&
    !path.endsWith('/') &&
    !path.includes('\\') &&
    !path.includes('//') &&
    !/[\u0000-\u001f\u007f]/.test(path) &&
    !path.split('/').includes('..')
  );
}

function concatChunks(chunks: Uint8Array[], total: number): Uint8Array {
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function addZipFile(zip: Zip, path: string, bytes: Uint8Array, compress: boolean): void {
  const file = compress ? new AsyncZipDeflate(path, { level: 6 }) : new ZipPassThrough(path);
  zip.add(file);
  file.push(bytes, true);
}

async function finishZip(addFiles: (zip: Zip) => Promise<void>): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let total = 0;
    const zip = new Zip((error, chunk, final) => {
      if (error) {
        reject(error);
        return;
      }
      chunks.push(chunk);
      total += chunk.length;
      if (final) resolve(concatChunks(chunks, total));
    });
    void addFiles(zip).then(() => zip.end(), (error) => {
      zip.terminate();
      reject(error);
    });
  });
}

function renderPath(index: number): string {
  return `renders/current/${String(index + 1).padStart(2, '0')}.png`;
}

export async function buildVideoProjectZip(args: {
  name: string;
  createdAt?: string;
  cover: number;
  source: VideoMetadata;
  editableStartUs: number;
  editableEndUs: number;
  grid: VideoGridPlan;
  master: MasterApngSet;
  settings: VideoStickerSettings[];
  current: Array<VideoRenderSnapshot | null>;
}): Promise<{ zip: Uint8Array; manifest: VideoProjectManifestV2 }> {
  if (args.master.stickers.length !== args.current.length || args.current.length !== args.settings.length) {
    throw new Error('Project ZIP 無法建立：master、settings、current 張數不一致');
  }
  const masterStickers = args.master.stickers.map((sticker) => ({
    id: sticker.id,
    index: sticker.index,
    width: sticker.width,
    height: sticker.height,
    chunks: sticker.chunks.map((chunk): ChunkManifestV2 => ({
      path: chunk.storeKey,
      id: chunk.id,
      stickerId: chunk.stickerId,
      index: chunk.index,
      sampleRefs: chunk.sampleRefs.map((sample) => ({ ...sample })),
      visualRefs: chunk.visualRefs.map((visual) => ({ ...visual })),
      width: chunk.width,
      height: chunk.height,
      bytes: chunk.bytes,
      sha256: chunk.sha256,
    })),
  }));
  const current: Array<RenderManifestV2 | null> = [];
  for (let index = 0; index < args.current.length; index++) {
    const snapshot = args.current[index];
    if (!snapshot) {
      current.push(null);
      continue;
    }
    current.push({
      path: renderPath(index),
      sha256: await sha256(snapshot.png),
      bytes: snapshot.png.length,
      settings: { ...snapshot.settings, background: { ...snapshot.settings.background } },
      metrics: { ...snapshot.metrics, selectedSourceIndices: [...snapshot.metrics.selectedSourceIndices], selectedTimestampsUs: [...snapshot.metrics.selectedTimestampsUs], frameDelaysMs: [...snapshot.metrics.frameDelaysMs] },
      selection: {
        ...snapshot.selection,
        candidateSourceIndices: [...snapshot.selection.candidateSourceIndices],
        selectedSourceIndices: [...snapshot.selection.selectedSourceIndices],
        removedAdjacentSourceIndices: [...snapshot.selection.removedAdjacentSourceIndices],
        replacementSourceIndices: [...snapshot.selection.replacementSourceIndices],
        sourceTimestampsUs: [...snapshot.selection.sourceTimestampsUs],
        sourceDurationsUs: [...snapshot.selection.sourceDurationsUs],
        finalDelaysMs: [...snapshot.selection.finalDelaysMs],
      },
      notes: [...snapshot.notes],
      errors: [...snapshot.errors],
    });
  }
  const manifest: VideoProjectManifestV2 = {
    schema: VIDEO_PROJECT_SCHEMA,
    version: VIDEO_PROJECT_VERSION,
    createdAt: args.createdAt ?? new Date().toISOString(),
    name: args.name,
    cover: args.cover,
    sourceTimingUnit: 'microseconds',
    frameCoverage: args.master.frameCoverage,
    backgroundStage: args.master.backgroundStage,
    source: {
      ...args.source,
      embedded: false,
      editableStartUs: args.editableStartUs,
      editableEndUs: args.editableEndUs,
    },
    grid: args.grid,
    master: {
      sourceFrameCount: args.master.sourceFrameCount,
      visualFrameCount: args.master.visualFrameCount,
      chunkFrames: args.master.chunkFrames,
      stickers: masterStickers,
    },
    settings: args.settings.map((settings) => ({ ...settings, background: { ...settings.background } })),
    current,
    versions: {
      app: '0.2.0-beta',
      decoder: 'mediabunny@1.51.0',
      demuxer: 'mediabunny@1.51.0',
      removers: {
        imgly: '@imgly/background-removal@1.4.5',
        'local-birefnet': 'studioludens/birefnet-lite-512@4a3c40c36c94093cc1e724d9ea428b8fa4b57dc7',
        'colab-birefnet': 'user-session',
      },
    },
  };
  const report = strToU8(JSON.stringify({
    generatedAt: new Date().toISOString(),
    frameCoverage: manifest.frameCoverage,
    backgroundStage: manifest.backgroundStage,
    current: current.map((render) => render ? {
      metrics: render.metrics,
      selection: render.selection,
      errors: render.errors,
    } : null),
  }, null, 2));
  const manifestBytes = strToU8(JSON.stringify(manifest, null, 2));
  const zip = await finishZip(async (writer) => {
    addZipFile(writer, MANIFEST_PATH, manifestBytes, true);
    addZipFile(writer, REPORT_PATH, report, true);
    for (const sticker of args.master.stickers) {
      for (const chunk of sticker.chunks) {
        const bytes = await args.master.store.get(chunk.storeKey);
        if (bytes.length !== chunk.bytes || await sha256(bytes) !== chunk.sha256) {
          throw new Error(`${chunk.storeKey} 與 master index 不一致`);
        }
        addZipFile(writer, chunk.storeKey, bytes, false);
      }
    }
    for (let index = 0; index < args.current.length; index++) {
      const snapshot = args.current[index];
      if (snapshot) addZipFile(writer, renderPath(index), snapshot.png, false);
    }
  });
  return { zip, manifest };
}

async function streamArchive(zipBytes: Uint8Array, store: VideoMasterStore): Promise<ArchiveContents> {
  const retained = new Map<string, Uint8Array>();
  const paths = new Set<string>();
  const writes: Promise<void>[] = [];
  let entryCount = 0;
  let totalBytes = 0;
  let streamError: Error | null = null;
  let pendingFiles = 0;
  let pushFinished = false;
  let settle: (() => void) | null = null;
  let fail: ((error: Error) => void) | null = null;
  const completed = new Promise<void>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  const maybeSettle = () => {
    if (pushFinished && pendingFiles === 0) settle?.();
  };
  const unzip = new Unzip((file) => {
    if (streamError) return;
    entryCount++;
    if (entryCount > MAX_ARCHIVE_ENTRIES) {
      streamError = new Error(`Project ZIP 檔案數超過 ${MAX_ARCHIVE_ENTRIES}`);
      fail?.(streamError);
      file.terminate();
      return;
    }
    if (!safeEntryPath(file.name) || paths.has(file.name)) {
      streamError = new Error(`Project ZIP 含不安全或重複路徑：${file.name}`);
      fail?.(streamError);
      file.terminate();
      return;
    }
    paths.add(file.name);
    pendingFiles++;
    const chunks: Uint8Array[] = [];
    let entryBytes = 0;
    file.ondata = (error, chunk, final) => {
      if (error) {
        streamError = error;
        fail?.(error);
        return;
      }
      entryBytes += chunk.length;
      totalBytes += chunk.length;
      if (totalBytes > MAX_UNCOMPRESSED_BYTES) {
        streamError = new Error('Project ZIP 解壓後超過 600MB 安全上限');
        fail?.(streamError);
        file.terminate();
        return;
      }
      chunks.push(chunk);
      if (!final) return;
      const bytes = concatChunks(chunks, entryBytes);
      if (file.name.startsWith('master/')) writes.push(store.put(file.name, bytes));
      else retained.set(file.name, bytes);
      pendingFiles--;
      maybeSettle();
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  unzip.register(AsyncUnzipInflate);
  unzip.push(zipBytes, true);
  pushFinished = true;
  maybeSettle();
  await completed;
  await Promise.all(writes);
  if (streamError) throw streamError;
  return { retained, paths };
}

function requireRetained(files: Map<string, Uint8Array>, path: string): Uint8Array {
  const bytes = files.get(path);
  if (!bytes) throw new Error(`Project ZIP 缺少 ${path}`);
  return bytes;
}

function parseJson(bytes: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(strFromU8(bytes));
  } catch {
    throw new Error(`${label} 不是有效 JSON`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${path} 必須是 object`);
  return value;
}

function requireString(value: unknown, path: string, pattern?: RegExp): string {
  if (typeof value !== 'string' || value.length === 0 || (pattern && !pattern.test(value))) {
    throw new Error(`${path} 必須是有效字串`);
  }
  return value;
}

function requireFinite(value: unknown, path: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) {
    throw new Error(`${path} 必須是 >= ${minimum} 的有限數值`);
  }
  return value;
}

function requireInteger(value: unknown, path: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new Error(`${path} 必須是 >= ${minimum} 的安全整數`);
  }
  return value as number;
}

function requireSafeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value)) throw new Error(`${path} 必須是安全整數`);
  return value as number;
}

function requireStringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${path} 必須是 array`);
  return value.map((entry, index) => {
    if (typeof entry !== 'string') throw new Error(`${path}[${index}] 必須是 string`);
    return entry;
  });
}

function assertBackground(value: unknown, path: string): void {
  const background = requireRecord(value, path);
  const mode = requireString(background.mode, `${path}.mode`);
  if (!['none', 'color-key', 'imgly', 'local-birefnet', 'colab-birefnet'].includes(mode)) {
    throw new Error(`${path}.mode 不支援`);
  }
  if (background.color !== undefined && (typeof background.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(background.color))) {
    throw new Error(`${path}.color 必須是 #RRGGBB`);
  }
  if (background.tolerance !== undefined) requireFinite(background.tolerance, `${path}.tolerance`);
}

function assertSettings(value: unknown, path: string, stickerId: string): void {
  const settings = requireRecord(value, path);
  if (requireString(settings.stickerId, `${path}.stickerId`) !== stickerId) {
    throw new Error(`${path}.stickerId 與 master 不一致`);
  }
  const startUs = requireInteger(settings.rangeStartUs, `${path}.rangeStartUs`);
  const endUs = requireInteger(settings.rangeEndUs, `${path}.rangeEndUs`, 1);
  if (endUs <= startUs) throw new Error(`${path} range 無效`);
  const targetFrames = requireInteger(settings.targetFrames, `${path}.targetFrames`, 5);
  if (targetFrames > 20) throw new Error(`${path}.targetFrames 必須是 5–20`);
  if (![1000, 2000, 3000, 4000].includes(requireInteger(settings.perLoopDurationMs, `${path}.perLoopDurationMs`, 1))) {
    throw new Error(`${path}.perLoopDurationMs 不合法`);
  }
  const loops = requireInteger(settings.loops, `${path}.loops`, 1);
  if (loops > 4 || (settings.perLoopDurationMs as number) * loops > 4000) throw new Error(`${path}.loops 不合法`);
  requireInteger(settings.maxColors, `${path}.maxColors`);
  assertBackground(settings.background, `${path}.background`);
}

function requireIntegerArray(value: unknown, path: string, minimum = 0): number[] {
  if (!Array.isArray(value)) throw new Error(`${path} 必須是 array`);
  return value.map((entry, index) => requireInteger(entry, `${path}[${index}]`, minimum));
}

function requireSafeIntegerArray(value: unknown, path: string): number[] {
  if (!Array.isArray(value)) throw new Error(`${path} 必須是 array`);
  return value.map((entry, index) => requireSafeInteger(entry, `${path}[${index}]`));
}

function assertSelection(value: unknown, path: string): void {
  const selection = requireRecord(value, path);
  const selected = requireIntegerArray(selection.selectedSourceIndices, `${path}.selectedSourceIndices`);
  requireIntegerArray(selection.candidateSourceIndices, `${path}.candidateSourceIndices`);
  requireIntegerArray(selection.removedAdjacentSourceIndices, `${path}.removedAdjacentSourceIndices`);
  requireIntegerArray(selection.replacementSourceIndices, `${path}.replacementSourceIndices`);
  const timestamps = requireSafeIntegerArray(selection.sourceTimestampsUs, `${path}.sourceTimestampsUs`);
  const durations = requireIntegerArray(selection.sourceDurationsUs, `${path}.sourceDurationsUs`, 1);
  const delays = requireIntegerArray(selection.finalDelaysMs, `${path}.finalDelaysMs`, 1);
  if (selected.length < 1 || timestamps.length !== selected.length || durations.length !== selected.length || delays.length !== selected.length) {
    throw new Error(`${path} selected/timing/delay 長度不一致`);
  }
  for (let index = 1; index < selected.length; index++) {
    if (selected[index]! <= selected[index - 1]! || timestamps[index]! <= timestamps[index - 1]!) {
      throw new Error(`${path} selected indices/timestamps 必須嚴格遞增`);
    }
  }
}

function assertMetrics(value: unknown, path: string): void {
  const metrics = requireRecord(value, path);
  for (const key of ['masterFramesInRange', 'requestedFrames', 'outputFrames', 'droppedFrames', 'perLoopDurationMs', 'totalPlaybackMs', 'bytes', 'width', 'height', 'distinctFrames', 'adjacentDuplicateFrames', 'transparentPixels', 'foregroundPixels'] as const) {
    requireInteger(metrics[key], `${path}.${key}`);
  }
  const selected = requireIntegerArray(metrics.selectedSourceIndices, `${path}.selectedSourceIndices`);
  const timestamps = requireSafeIntegerArray(metrics.selectedTimestampsUs, `${path}.selectedTimestampsUs`);
  const delays = requireIntegerArray(metrics.frameDelaysMs, `${path}.frameDelaysMs`, 1);
  if (selected.length !== timestamps.length || selected.length !== delays.length) throw new Error(`${path} timeline 長度不一致`);
}

function assertSource(value: unknown): void {
  const source = requireRecord(value, 'source');
  requireString(source.fileName, 'source.fileName');
  if (typeof source.mimeType !== 'string') throw new Error('source.mimeType 必須是 string');
  requireString(source.container, 'source.container');
  requireString(source.codec, 'source.codec');
  requireInteger(source.durationMs, 'source.durationMs');
  requireInteger(source.durationUs, 'source.durationUs', 1);
  const firstUs = requireSafeInteger(source.firstTimestampUs, 'source.firstTimestampUs');
  const endUs = requireSafeInteger(source.endTimestampUs, 'source.endTimestampUs');
  if (endUs <= firstUs) throw new Error('source timestamp range 無效');
  for (const key of ['width', 'height', 'codedWidth', 'codedHeight', 'frameCount'] as const) requireInteger(source[key], `source.${key}`, 1);
  requireFinite(source.averageFps, 'source.averageFps', Number.MIN_VALUE);
  if (![0, 90, 180, 270].includes(requireInteger(source.rotation, 'source.rotation'))) throw new Error('source.rotation 不合法');
  const ratio = requireRecord(source.pixelAspectRatio, 'source.pixelAspectRatio');
  requireInteger(ratio.num, 'source.pixelAspectRatio.num', 1);
  requireInteger(ratio.den, 'source.pixelAspectRatio.den', 1);
  if (source.embedded !== false) throw new Error('Project 不得內嵌 source video');
  const editableStartUs = requireSafeInteger(source.editableStartUs, 'source.editableStartUs');
  const editableEndUs = requireSafeInteger(source.editableEndUs, 'source.editableEndUs');
  if (editableStartUs < firstUs || editableEndUs > endUs || editableEndUs <= editableStartUs) {
    throw new Error('source editable range 超出來源時間軸');
  }
}

function assertGrid(value: unknown, source: Record<string, unknown>): void {
  const grid = requireRecord(value, 'grid');
  const sourceWidth = requireInteger(grid.sourceWidth, 'grid.sourceWidth', 1);
  const sourceHeight = requireInteger(grid.sourceHeight, 'grid.sourceHeight', 1);
  if (sourceWidth !== source.width || sourceHeight !== source.height) throw new Error('grid source size 與 source metadata 不一致');
  const cols = requireInteger(grid.cols, 'grid.cols', 1);
  const rows = requireInteger(grid.rows, 'grid.rows', 1);
  const count = requireInteger(grid.count, 'grid.count', 1);
  if (count > cols * rows || !Array.isArray(grid.rects) || grid.rects.length !== count) throw new Error('grid count/rects 不一致');
  grid.rects.forEach((entry, index) => {
    const rect = requireRecord(entry, `grid.rects[${index}]`);
    requireString(rect.id, `grid.rects[${index}].id`);
    if (requireInteger(rect.index, `grid.rects[${index}].index`) !== index) throw new Error(`grid.rects[${index}].index 不連續`);
    const left = requireInteger(rect.left, `grid.rects[${index}].left`);
    const top = requireInteger(rect.top, `grid.rects[${index}].top`);
    const width = requireInteger(rect.width, `grid.rects[${index}].width`, 1);
    const height = requireInteger(rect.height, `grid.rects[${index}].height`, 1);
    requireInteger(rect.row, `grid.rects[${index}].row`);
    requireInteger(rect.col, `grid.rects[${index}].col`);
    if (left + width > sourceWidth || top + height > sourceHeight) throw new Error(`grid.rects[${index}] 超出 source`);
  });
}

function assertV2Manifest(value: unknown): asserts value is VideoProjectManifestV2 {
  if (!isVideoProjectManifestHeader(value) || value.version !== 2) throw new Error('不支援的 Project ZIP schema 或版本');
  const manifest = value as Partial<VideoProjectManifestV2>;
  if (
    manifest.sourceTimingUnit !== 'microseconds' ||
    !['all-presentation-frames', 'sampled-legacy'].includes(manifest.frameCoverage ?? '') ||
    !['raw', 'baked-legacy'].includes(manifest.backgroundStage ?? '') ||
    typeof manifest.name !== 'string' ||
    !manifest.source ||
    !manifest.grid ||
    !manifest.master ||
    !Array.isArray(manifest.master.stickers) ||
    !Array.isArray(manifest.settings) ||
    !Array.isArray(manifest.current) ||
    manifest.master.stickers.length < 1 ||
    manifest.settings.length !== manifest.master.stickers.length ||
    manifest.current.length !== manifest.master.stickers.length
  ) {
    throw new Error('Project ZIP V2 manifest 缺少或含有無效的必要欄位');
  }
  const createdAt = Date.parse(requireString(manifest.createdAt, 'createdAt'));
  if (!Number.isFinite(createdAt)) throw new Error('createdAt 不是有效日期');
  const cover = requireInteger(manifest.cover, 'cover', 1);
  assertSource(manifest.source);
  assertGrid(manifest.grid, manifest.source as unknown as Record<string, unknown>);
  requireInteger(manifest.master.sourceFrameCount, 'master.sourceFrameCount', 1);
  requireInteger(manifest.master.visualFrameCount, 'master.visualFrameCount', 1);
  requireInteger(manifest.master.chunkFrames, 'master.chunkFrames', 1);
  if (cover > manifest.master.stickers.length) throw new Error('cover 超出貼圖數');
  if (manifest.master.sourceFrameCount > manifest.source.frameCount) throw new Error('master sourceFrameCount 超過 source frameCount');
  if (
    (manifest.frameCoverage === 'all-presentation-frames' && manifest.backgroundStage !== 'raw') ||
    (manifest.frameCoverage === 'sampled-legacy' && manifest.backgroundStage !== 'baked-legacy')
  ) {
    throw new Error('frameCoverage/backgroundStage 組合無效');
  }
  const stickerIds = new Set<string>();
  manifest.master.stickers.forEach((stickerValue, stickerIndex) => {
    const sticker = requireRecord(stickerValue, `master.stickers[${stickerIndex}]`);
    const stickerId = requireString(sticker.id, `master.stickers[${stickerIndex}].id`, /^[a-zA-Z0-9_-]+$/);
    if (stickerIds.has(stickerId)) throw new Error(`重複 sticker id：${stickerId}`);
    stickerIds.add(stickerId);
    if (requireInteger(sticker.index, `master.stickers[${stickerIndex}].index`) !== stickerIndex) throw new Error(`sticker ${stickerId} index 不連續`);
    requireInteger(sticker.width, `master.stickers[${stickerIndex}].width`, 1);
    requireInteger(sticker.height, `master.stickers[${stickerIndex}].height`, 1);
    if (!Array.isArray(sticker.chunks) || sticker.chunks.length < 1) throw new Error(`sticker ${stickerId} 沒有 chunk`);
    assertSettings(manifest.settings![stickerIndex], `settings[${stickerIndex}]`, stickerId);
    const render = manifest.current![stickerIndex];
    if (render !== null) {
      const renderRecord = requireRecord(render, `current[${stickerIndex}]`);
      requireString(renderRecord.path, `current[${stickerIndex}].path`);
      requireString(renderRecord.sha256, `current[${stickerIndex}].sha256`, /^[0-9a-f]{64}$/);
      requireInteger(renderRecord.bytes, `current[${stickerIndex}].bytes`, 1);
      assertSettings(renderRecord.settings, `current[${stickerIndex}].settings`, stickerId);
      assertMetrics(renderRecord.metrics, `current[${stickerIndex}].metrics`);
      assertSelection(renderRecord.selection, `current[${stickerIndex}].selection`);
      requireStringArray(renderRecord.notes, `current[${stickerIndex}].notes`);
      requireStringArray(renderRecord.errors, `current[${stickerIndex}].errors`);
    }
  });
  const versions = requireRecord(manifest.versions, 'versions');
  requireString(versions.app, 'versions.app');
  requireString(versions.decoder, 'versions.decoder');
  requireString(versions.demuxer, 'versions.demuxer');
  requireRecord(versions.removers, 'versions.removers');
}

async function restoreV2(
  manifest: VideoProjectManifestV2,
  archive: ArchiveContents,
  store: VideoMasterStore,
): Promise<VideoProjectRuntime> {
  const { retained } = archive;
  requireRetained(retained, REPORT_PATH);
  const declaredPaths = new Set<string>([MANIFEST_PATH, REPORT_PATH]);
  const stickers: MasterApngSticker[] = [];
  let sampleCount: number | null = null;
  let canonicalTimeline: Array<{ sourceIndex: number; timestampUs: number; durationUs: number }> | null = null;
  let visualFrameCount = 0;
  for (const [stickerIndex, sticker] of manifest.master.stickers.entries()) {
    const chunks: MasterApngChunk[] = [];
    let stickerSamples = 0;
    const stickerTimeline: Array<{ sourceIndex: number; timestampUs: number; durationUs: number }> = [];
    const chunkIds = new Set<string>();
    for (const [chunkIndex, chunk] of sticker.chunks.entries()) {
      const path = `master.stickers[${stickerIndex}].chunks[${chunkIndex}]`;
      requireString(chunk.id, `${path}.id`, /^[a-zA-Z0-9_-]+$/);
      if (chunkIds.has(chunk.id)) throw new Error(`${path}.id 重複`);
      chunkIds.add(chunk.id);
      if (chunk.stickerId !== sticker.id) throw new Error(`${path}.stickerId 與父層不一致`);
      if (requireInteger(chunk.index, `${path}.index`) !== chunkIndex) throw new Error(`${path}.index 不連續`);
      if (requireInteger(chunk.width, `${path}.width`, 1) !== sticker.width || requireInteger(chunk.height, `${path}.height`, 1) !== sticker.height) {
        throw new Error(`${path} 尺寸與 sticker 不一致`);
      }
      requireInteger(chunk.bytes, `${path}.bytes`, 1);
      requireString(chunk.sha256, `${path}.sha256`, /^[0-9a-f]{64}$/);
      if (!safeEntryPath(chunk.path) || !chunk.path.startsWith(`master/${sticker.id}/`) || declaredPaths.has(chunk.path)) {
        throw new Error(`manifest 含重複、不安全或跨 sticker 的路徑：${chunk.path}`);
      }
      declaredPaths.add(chunk.path);
      const bytes = await store.get(chunk.path);
      if (bytes.length !== chunk.bytes || await sha256(bytes) !== chunk.sha256) {
        throw new Error(`${chunk.path} bytes/checksum 與 manifest 不一致`);
      }
      if (!Array.isArray(chunk.sampleRefs) || !Array.isArray(chunk.visualRefs) || chunk.sampleRefs.length < 1 || chunk.visualRefs.length < 1) {
        throw new Error(`${chunk.path} index 為空`);
      }
      const visualIds = new Set<string>();
      const framePositions = new Set<number>();
      chunk.visualRefs.forEach((visualValue, visualIndex) => {
        const visual = requireRecord(visualValue, `${path}.visualRefs[${visualIndex}]`);
        const visualFrameId = requireString(visual.visualFrameId, `${path}.visualRefs[${visualIndex}].visualFrameId`);
        if (visualIds.has(visualFrameId)) throw new Error(`${path} visualFrameId 重複`);
        visualIds.add(visualFrameId);
        requireString(visual.rgbaHash, `${path}.visualRefs[${visualIndex}].rgbaHash`);
        if (visual.chunkId !== chunk.id) throw new Error(`${path} visual chunkId 不一致`);
        const frameInChunk = requireInteger(visual.frameInChunk, `${path}.visualRefs[${visualIndex}].frameInChunk`);
        if (frameInChunk >= chunk.visualRefs.length || framePositions.has(frameInChunk)) throw new Error(`${path} visual frameInChunk 無效或重複`);
        framePositions.add(frameInChunk);
      });
      if (framePositions.size !== chunk.visualRefs.length) throw new Error(`${path} visual frame index 有缺口`);
      const decoded = inspectAnimatedBytes(bytes);
      if (decoded.frames.length !== chunk.visualRefs.length || decoded.info.width !== chunk.width || decoded.info.height !== chunk.height) {
        throw new Error(`${chunk.path} decoded visual count/size 與 manifest 不一致`);
      }
      chunk.sampleRefs.forEach((sampleValue, sampleIndex) => {
        const sample = requireRecord(sampleValue, `${path}.sampleRefs[${sampleIndex}]`);
        const sourceIndex = requireInteger(sample.sourceIndex, `${path}.sampleRefs[${sampleIndex}].sourceIndex`);
        const timestampUs = requireSafeInteger(sample.timestampUs, `${path}.sampleRefs[${sampleIndex}].timestampUs`);
        const durationUs = requireInteger(sample.durationUs, `${path}.sampleRefs[${sampleIndex}].durationUs`, 1);
        if (sample.chunkId !== chunk.id || typeof sample.visualFrameId !== 'string' || !visualIds.has(sample.visualFrameId)) {
          throw new Error(`${path} sampleRef chunk/visual 對應無效`);
        }
        const previous = stickerTimeline[stickerTimeline.length - 1];
        if (previous && (sourceIndex !== previous.sourceIndex + 1 || timestampUs <= previous.timestampUs)) {
          throw new Error(`${path} sample source index 有缺口、重複或 timestamp 逆序`);
        }
        stickerTimeline.push({ sourceIndex, timestampUs, durationUs });
      });
      stickerSamples += chunk.sampleRefs.length;
      visualFrameCount += chunk.visualRefs.length;
      chunks.push({ ...chunk, storeKey: chunk.path });
    }
    if (sampleCount === null) sampleCount = stickerSamples;
    else if (sampleCount !== stickerSamples) throw new Error('Project ZIP 各張 raw master sample 數不一致');
    if (canonicalTimeline === null) canonicalTimeline = stickerTimeline;
    else if (JSON.stringify(canonicalTimeline) !== JSON.stringify(stickerTimeline)) {
      throw new Error('Project ZIP 各張 raw master timeline 不一致');
    }
    stickers.push({ id: sticker.id, index: sticker.index, width: sticker.width, height: sticker.height, chunks });
  }
  if (sampleCount !== manifest.master.sourceFrameCount) throw new Error('Project ZIP sourceFrameCount 與 sample index 不一致');
  if (visualFrameCount !== manifest.master.visualFrameCount) throw new Error('Project ZIP visualFrameCount 與 visual index 不一致');
  const current: Array<VideoRenderSnapshot | null> = [];
  for (const [renderIndex, render] of manifest.current.entries()) {
    if (!render) {
      current.push(null);
      continue;
    }
    if (!safeEntryPath(render.path) || declaredPaths.has(render.path)) throw new Error(`render 路徑無效：${render.path}`);
    declaredPaths.add(render.path);
    const png = requireRetained(retained, render.path);
    if (png.length !== render.bytes || await sha256(png) !== render.sha256) throw new Error(`${render.path} checksum 不一致`);
    const evidence = inspectAnimatedBytes(png, render.settings.targetFrames);
    if (
      evidence.info.frames !== render.metrics.outputFrames ||
      evidence.info.durationMs !== render.metrics.perLoopDurationMs ||
      evidence.loops !== render.settings.loops ||
      evidence.info.bytes !== render.metrics.bytes ||
      evidence.info.width !== render.metrics.width ||
      evidence.info.height !== render.metrics.height ||
      evidence.adjacentDuplicateFrames !== render.metrics.adjacentDuplicateFrames ||
      JSON.stringify(evidence.delaysMs) !== JSON.stringify(render.metrics.frameDelaysMs) ||
      JSON.stringify(evidence.delaysMs) !== JSON.stringify(render.selection.finalDelaysMs)
    ) {
      throw new Error(`current[${renderIndex}] final-byte evidence 與 manifest 不一致`);
    }
    current.push({
      png,
      info: evidence.info,
      settings: { ...render.settings, background: { ...render.settings.background } },
      metrics: { ...render.metrics },
      selection: { ...render.selection },
      notes: [...render.notes],
      errors: [...render.errors],
    });
  }
  for (const path of archive.paths) {
    if (!declaredPaths.has(path)) throw new Error(`Project ZIP 含未宣告 entry：${path}`);
  }
  for (const path of declaredPaths) {
    if (!archive.paths.has(path)) throw new Error(`Project ZIP 缺少 manifest 宣告 entry：${path}`);
  }
  return {
    manifest,
    master: {
      rangeStartUs: manifest.source.editableStartUs,
      rangeEndUs: manifest.source.editableEndUs,
      sourceFrameCount: manifest.master.sourceFrameCount,
      visualFrameCount: manifest.master.visualFrameCount,
      chunkFrames: manifest.master.chunkFrames,
      frameCoverage: manifest.frameCoverage,
      backgroundStage: manifest.backgroundStage,
      stickers,
      store,
    },
    current,
  };
}

function isV1(value: unknown): value is VideoProjectManifestV1 {
  return isVideoProjectManifestHeader(value) && value.version === 1;
}

async function restoreV1(
  legacy: VideoProjectManifestV1,
  retained: Map<string, Uint8Array>,
  store: VideoMasterStore,
): Promise<VideoProjectRuntime> {
  if (
    !legacy.master?.stickers?.length ||
    legacy.settings.length !== legacy.master.stickers.length ||
    legacy.current.length !== legacy.master.stickers.length
  ) {
    throw new Error('Project ZIP V1 manifest 不完整');
  }
  const stickers: MasterApngSticker[] = [];
  for (const sticker of legacy.master.stickers) {
    const chunks: MasterApngChunk[] = [];
    for (const chunk of sticker.chunks) {
      const bytes = await store.get(chunk.path);
      const decoded = inspectAnimatedBytes(bytes);
      if (decoded.frames.length !== chunk.timestampsMs.length) throw new Error(`${chunk.path} V1 格數不一致`);
      const visualRefs = decoded.frames.map((_, index) => ({
        visualFrameId: `${chunk.id}-legacy-visual-${index + 1}`,
        rgbaHash: `legacy-${index}`,
        chunkId: chunk.id,
        frameInChunk: index,
      }));
      const sampleRefs = chunk.timestampsMs.map((timestampMs, index) => ({
        sourceIndex: sticker.chunks.slice(0, chunk.index).reduce((sum, item) => sum + item.timestampsMs.length, 0) + index,
        timestampUs: timestampMs * 1000,
        durationUs: Math.max(1000, (chunk.delaysMs[index] ?? 1) * 1000),
        chunkId: chunk.id,
        visualFrameId: visualRefs[index]!.visualFrameId,
      }));
      chunks.push({
        id: chunk.id,
        stickerId: sticker.id,
        index: chunk.index,
        sampleRefs,
        visualRefs,
        width: chunk.width,
        height: chunk.height,
        storeKey: chunk.path,
        bytes: bytes.length,
        sha256: await sha256(bytes),
      });
    }
    stickers.push({ ...sticker, chunks });
  }
  const settings: VideoStickerSettings[] = legacy.settings.map((setting, index) => ({
    stickerId: stickers[index]!.id,
    rangeStartUs: setting.startMs * 1000,
    rangeEndUs: setting.endMs * 1000,
    targetFrames: setting.targetFrames,
    perLoopDurationMs: (setting.playbackSec * 1000) as 1000 | 2000 | 3000 | 4000,
    loops: setting.loops,
    background: { mode: 'none' },
    maxColors: setting.maxColors,
  }));
  const current: Array<VideoRenderSnapshot | null> = [];
  for (let index = 0; index < legacy.current.length; index++) {
    const render = legacy.current[index]!;
    const png = requireRetained(retained, render.path);
    const evidence = inspectAnimatedBytes(png, settings[index]!.targetFrames);
    const selectedSourceIndices = render.metrics.selectedTimestampsMs.map((_, sourceIndex) => sourceIndex);
    current.push({
      png,
      info: evidence.info,
      settings: settings[index]!,
      metrics: {
        ...render.metrics,
        selectedSourceIndices,
        selectedTimestampsUs: render.metrics.selectedTimestampsMs.map((value) => value * 1000),
        adjacentDuplicateFrames: evidence.adjacentDuplicateFrames,
      },
      selection: {
        candidateSourceIndices: selectedSourceIndices,
        selectedSourceIndices,
        removedAdjacentSourceIndices: [],
        replacementSourceIndices: [],
        sourceTimestampsUs: render.metrics.selectedTimestampsMs.map((value) => value * 1000),
        sourceDurationsUs: render.metrics.frameDelaysMs.map((value) => value * 1000),
        finalDelaysMs: [...render.metrics.frameDelaysMs],
      },
      notes: [...render.notes, '舊版取樣 Project：無法補回缺失 frame 或未去背 RGB'],
      errors: [],
    });
  }
  const source: VideoMetadata = {
    ...legacy.source,
    container: 'legacy',
    codec: 'unknown',
    durationUs: legacy.source.durationMs * 1000,
    firstTimestampUs: 0,
    endTimestampUs: legacy.source.durationMs * 1000,
    codedWidth: legacy.source.width,
    codedHeight: legacy.source.height,
    rotation: 0,
    pixelAspectRatio: { num: 1, den: 1 },
    frameCount: legacy.master.masterFrameCount,
    averageFps: legacy.master.masterFrameCount / Math.max(0.001, legacy.source.durationMs / 1000),
  };
  const manifest: VideoProjectManifestV2 = {
    schema: VIDEO_PROJECT_SCHEMA,
    version: VIDEO_PROJECT_VERSION,
    createdAt: legacy.createdAt,
    name: legacy.name,
    cover: legacy.cover,
    sourceTimingUnit: 'microseconds',
    frameCoverage: 'sampled-legacy',
    backgroundStage: 'baked-legacy',
    source: {
      ...source,
      embedded: false,
      editableStartUs: legacy.source.editableStartMs * 1000,
      editableEndUs: legacy.source.editableEndMs * 1000,
    },
    grid: legacy.grid,
    master: {
      sourceFrameCount: legacy.master.masterFrameCount,
      visualFrameCount: stickers.reduce((sum, sticker) => sum + sticker.chunks.reduce((inner, chunk) => inner + chunk.visualRefs.length, 0), 0),
      chunkFrames: legacy.master.chunkFrames,
      stickers: stickers.map((sticker) => ({
        ...sticker,
        chunks: sticker.chunks.map(({ storeKey, ...chunk }) => ({ ...chunk, path: storeKey })),
      })),
    },
    settings,
    current: current.map(() => null),
    versions: { app: 'legacy-v1', decoder: 'html-video-seek', demuxer: 'none', removers: {} },
    legacy: {
      importedFromVersion: 1,
      limitations: [
        '只保存 V1 的 time-uniform 取樣格',
        'master 背景可能已烙入，無法回復未去背 RGB',
      ],
    },
  };
  return {
    manifest,
    master: {
      rangeStartUs: manifest.source.editableStartUs,
      rangeEndUs: manifest.source.editableEndUs,
      sourceFrameCount: manifest.master.sourceFrameCount,
      visualFrameCount: manifest.master.visualFrameCount,
      chunkFrames: manifest.master.chunkFrames,
      frameCoverage: 'sampled-legacy',
      backgroundStage: 'baked-legacy',
      stickers,
      store,
    },
    current,
  };
}

export async function importVideoProjectZip(zipBytes: Uint8Array): Promise<VideoProjectRuntime> {
  const store = await createVideoMasterStore({
    estimatedBytes: 33 * 1024 * 1024,
    forceMemory: typeof indexedDB === 'undefined',
  });
  try {
    const archive = await streamArchive(zipBytes, store);
    const parsed = parseJson(requireRetained(archive.retained, MANIFEST_PATH), 'Project ZIP 的 sticker-project.json');
    if (isV1(parsed)) return restoreV1(parsed, archive.retained, store);
    assertV2Manifest(parsed);
    return restoreV2(parsed, archive, store);
  } catch (error) {
    await store.clear();
    throw error;
  }
}
