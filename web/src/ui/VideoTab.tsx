import { useEffect, useMemo, useRef, useState } from 'react';
import { emojiFileName, stickerFileName } from '@core/naming.js';
import {
  DEFAULT_COLOR_KEY_OPTIONS,
  copyColorKeyOptions,
  type ColorKeyOptions,
} from '@core/colorKey.js';
import { ANIMATED_EMOJI_SPEC, ANIMATED_SPEC, POPUP_STICKER_SPEC, STATIC_SPEC, maxBounds } from '@core/spec.js';
import {
  equalVideoAxisCuts,
  planVideoGrid,
  planVideoOutputCanvas,
  type VideoAxisCuts,
  type VideoGridPlan,
} from '@core/videoCrop.js';
import {
  cloneVideoStickerDraft,
  type VideoBackgroundMode,
  type VideoOutputTarget,
} from '@core/videoProject.js';
import { mergeResults, validateEmojiPack, validatePack, validatePopupPack, type ImageInfo } from '@core/validate.js';
import { createBackgroundRemovalJob, type BackgroundRemovalJob } from '../webpipe/backgroundRemovalJob.js';
import { colabBirefnetEndpointHost } from '../webpipe/colabBirefnet.js';
import { decodeApngFrames } from '../webpipe/apng.js';
import { buildAnimatedMainFromTimeline, buildMainTab, buildTab } from '../webpipe/mainTab.js';
import { decodeMasterPoster, type MasterApngSet } from '../webpipe/masterApng.js';
import { encodePng } from '../webpipe/png.js';
import {
  inspectAnimatedBytes,
  processMasterApngSticker,
  type VideoRenderSnapshot,
  type VideoStickerSettings,
} from '../webpipe/processMasterApngSticker.js';
import { buildRawVideoMaster } from '../webpipe/rawVideoMaster.js';
import {
  openBrowserVideo,
  type BrowserVideoSource,
  type VideoMetadata,
} from '../webpipe/videoSource.js';
import { VideoFrameRenderCache } from '../webpipe/videoFrameRenderCache.js';
import { createVideoMasterStore, type VideoMasterStore } from '../webpipe/videoMasterStore.js';
import { buildVideoProjectZip, importVideoProjectZip } from '../webpipe/videoProjectZip.js';
import { buildEmojiPackZip } from '../webpipe/emojiZip.js';
import { processStatic, type ProcessedSticker } from '../webpipe/processStatic.js';
import { buildPackZip, buildPopupPackZip, downloadBytes, safeName } from '../webpipe/zip.js';
import { LogPane, ValidationView, kb, useLogger } from './common.jsx';
import { ColorKeyOptionFields, LocalBirefnetRuntimeWarning } from './BackgroundRemovalControl.jsx';
import { useColabBirefnetConnection } from './colabBirefnetConnection.jsx';
import { VideoIngestProgress, type VideoIngestProgressValue } from './video/VideoIngestProgress.jsx';
import { VideoSourceStep } from './video/VideoSourceStep.jsx';
import { VideoStickerEditor } from './video/VideoStickerEditor.jsx';
import { VideoStickerList } from './video/VideoStickerList.jsx';

interface VideoProjectState {
  target: VideoOutputTarget;
  name: string;
  createdAt: string;
  cover: number;
  source: VideoMetadata;
  editableStartUs: number;
  editableEndUs: number;
  grid: VideoGridPlan;
  master: MasterApngSet;
  settings: VideoStickerSettings[];
  current: Array<VideoRenderSnapshot | null>;
}

interface LinePackState {
  target: VideoOutputTarget;
  zip: Uint8Array;
  main?: Uint8Array;
  popupMain?: Uint8Array;
  tab: Uint8Array;
  validation: ReturnType<typeof validatePack>;
}

const PREFLIGHT_HARD_BYTES = 512 * 1024 * 1024;
const RENDER_CACHE_BYTES = 96 * 1024 * 1024;

function videoTargetLabel(target: VideoOutputTarget): string {
  if (target === 'animated-emoji') return 'Animated Regular Emoji';
  if (target === 'popup') return 'Pop-up Sticker';
  return 'Animated Sticker';
}

function videoItemFileName(target: VideoOutputTarget, index: number): string {
  if (target === 'animated-emoji') return emojiFileName(index + 1);
  if (target === 'popup') return `popup/${stickerFileName(index + 1)}`;
  return stickerFileName(index + 1);
}

function hexToRgb(hex: string): [number, number, number] | null {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) return null;
  const value = Number.parseInt(match[1]!, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function settingsEqual(a: VideoStickerSettings, b: VideoStickerSettings): boolean {
  // staticFrameIndex selects a derived Popup static image; it does not change APNG bytes.
  return (
    a.stickerId === b.stickerId &&
    a.rangeStartUs === b.rangeStartUs &&
    a.rangeEndUs === b.rangeEndUs &&
    a.targetFrames === b.targetFrames &&
    a.perLoopDurationMs === b.perLoopDurationMs &&
    a.loops === b.loops &&
    (a.preserveColors ?? false) === (b.preserveColors ?? false) &&
    a.maxColors === b.maxColors &&
    a.background.mode === b.background.mode &&
    a.background.color === b.background.color &&
    a.background.tolerance === b.background.tolerance &&
    (a.background.mode !== 'color-key' || (
      a.background.colorKey?.scope === b.background.colorKey?.scope &&
      a.background.colorKey?.edge === b.background.colorKey?.edge
    ))
  );
}

export function invalidateColabVideoCurrent<T extends {
  settings: Pick<VideoStickerSettings, 'background'>;
}>(
  current: readonly (T | null)[],
): Array<T | null> | readonly (T | null)[] {
  let invalidated = false;
  const next = current.map((snapshot) => {
    if (snapshot?.settings.background.mode === 'colab-birefnet') {
      invalidated = true;
      return null;
    }
    return snapshot;
  });
  return invalidated ? next : current;
}

export function videoRemoverVersion(
  mode: VideoBackgroundMode,
  label: string | null,
  colabGeneration: number | null,
): string {
  if (mode === 'none') return 'none@1';
  if (!label) throw new Error(`${mode} remover 尚未啟用`);
  if (mode === 'color-key') return `${label}@2`;
  if (mode !== 'colab-birefnet') return `${label}@1`;
  if (!Number.isSafeInteger(colabGeneration) || colabGeneration === null || colabGeneration < 1) {
    throw new Error('Colab 多模型去背 connection generation 無效');
  }
  return `${label}@1:connection-${colabGeneration}`;
}

function defaultSettings(args: {
  target: VideoOutputTarget;
  stickerId: string;
  startUs: number;
  endUs: number;
  sourceFrames: number;
  backgroundMode: VideoBackgroundMode;
  color: string;
  colorKeyOptions: ColorKeyOptions;
}): VideoStickerSettings {
  const contract = args.target === 'animated-emoji'
    ? ANIMATED_EMOJI_SPEC
    : args.target === 'popup'
      ? POPUP_STICKER_SPEC
      : ANIMATED_SPEC;
  const roundedSeconds = Math.max(
    contract.playbackDurationsSec[0],
    Math.min(contract.maxDurationSec, Math.round((args.endUs - args.startUs) / 1_000_000)),
  );
  return {
    stickerId: args.stickerId,
    rangeStartUs: args.startUs,
    rangeEndUs: args.endUs,
    targetFrames: Math.max(contract.minFrames, Math.min(contract.maxFrames, args.sourceFrames)),
    perLoopDurationMs: (roundedSeconds * 1000) as VideoStickerSettings['perLoopDurationMs'],
    loops: 1,
    background: args.backgroundMode === 'color-key'
      ? { mode: 'color-key', color: args.color, colorKey: { ...args.colorKeyOptions } }
      : { mode: args.backgroundMode },
    staticFrameIndex: args.target === 'popup' ? 0 : undefined,
    preserveColors: false,
    maxColors: 0,
  };
}

async function posterPngs(master: MasterApngSet): Promise<Uint8Array[]> {
  const posters: Uint8Array[] = [];
  for (const sticker of master.stickers) posters.push(encodePng(await decodeMasterPoster(sticker, master.store)));
  return posters;
}

export function VideoTab() {
  const videoInput = useRef<HTMLInputElement>(null);
  const projectInput = useRef<HTMLInputElement>(null);
  const nameCustomizedRef = useRef(false);
  const sourceRef = useRef<BrowserVideoSource | null>(null);
  const masterStoreRef = useRef<VideoMasterStore | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const cacheRef = useRef(new VideoFrameRenderCache(RENDER_CACHE_BYTES));
  const logger = useLogger();
  const { connection: colabConnection, registerActiveRemoval } = useColabBirefnetConnection();
  const colabGeneration = colabConnection?.generation ?? null;
  const [metadata, setMetadata] = useState<VideoMetadata | null>(null);
  const [target, setTarget] = useState<VideoOutputTarget>('animated-sticker');
  const [count, setCount] = useState(8);
  const [cols, setCols] = useState(4);
  const [rows, setRows] = useState(2);
  const [xCuts, setXCuts] = useState<VideoAxisCuts | null>(null);
  const [yCuts, setYCuts] = useState<VideoAxisCuts | null>(null);
  const [rangeStartUs, setRangeStartUs] = useState(0);
  const [rangeEndUs, setRangeEndUs] = useState(4_000_000);
  const [scrubUs, setScrubUs] = useState(0);
  const [previews, setPreviews] = useState<Array<{ label: string; png: Uint8Array }>>([]);
  const [defaultBackground, setDefaultBackground] = useState<VideoBackgroundMode>('none');
  const [backgroundColor, setBackgroundColor] = useState('#00ff00');
  const [colorKeyOptions, setColorKeyOptions] = useState<ColorKeyOptions>(
    () => copyColorKeyOptions(DEFAULT_COLOR_KEY_OPTIONS),
  );
  const [name, setName] = useState('Video Animated Stickers');
  const [cover, setCover] = useState(1);
  const [project, setProject] = useState<VideoProjectState | null>(null);
  const [posters, setPosters] = useState<Uint8Array[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [linePack, setLinePack] = useState<LinePackState | null>(null);
  const [invalidDialogOpen, setInvalidDialogOpen] = useState(false);
  const [commonDurationMs, setCommonDurationMs] = useState<VideoStickerSettings['perLoopDurationMs']>(2000);
  const [commonLoops, setCommonLoops] = useState<VideoStickerSettings['loops']>(1);
  const [commonBackground, setCommonBackground] = useState<VideoBackgroundMode>('none');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [ingestProgress, setIngestProgress] = useState<VideoIngestProgressValue | null>(null);

  useEffect(() => () => {
    abortRef.current?.abort();
    sourceRef.current?.dispose();
    void masterStoreRef.current?.clear();
  }, []);

  useEffect(() => {
    cacheRef.current.clear();
    setProject((previous) => {
      if (!previous) return previous;
      const current = invalidateColabVideoCurrent(previous.current);
      return current === previous.current ? previous : { ...previous, current: [...current] };
    });
    setLinePack(null);
  }, [colabGeneration]);

  function resetSourceCuts(sourceWidth: number, sourceHeight: number, nextCols: number, nextRows: number): void {
    try {
      const nextXCuts = equalVideoAxisCuts(sourceWidth, nextCols);
      const nextYCuts = equalVideoAxisCuts(sourceHeight, nextRows);
      setXCuts(nextXCuts);
      setYCuts(nextYCuts);
    } catch {
      setXCuts(null);
      setYCuts(null);
    }
  }

  const gridPlan = useMemo(() => {
    if (!metadata || !xCuts || !yCuts) return null;
    try {
      return planVideoGrid({
        sourceWidth: metadata.width,
        sourceHeight: metadata.height,
        cols,
        rows,
        count,
        xCuts,
        yCuts,
      });
    } catch {
      return null;
    }
  }, [metadata, cols, rows, count, xCuts, yCuts]);

  const selectedSourceFrames = useMemo(() => {
    const source = sourceRef.current;
    if (!source || rangeEndUs <= rangeStartUs) return 0;
    return source.frameIndex.filter((frame) =>
      frame.timestampUs < rangeEndUs && frame.timestampUs + frame.durationUs > rangeStartUs,
    ).length;
  }, [metadata, rangeStartUs, rangeEndUs]);

  const estimatedBytes = useMemo(() => {
    if (!gridPlan) return 0;
    const bytesPerTimestamp = gridPlan.rects.reduce((sum, rect) => {
      const canvas = planVideoOutputCanvas(target, rect.width, rect.height);
      return sum + canvas.width * canvas.height * 4;
    }, 0);
    return bytesPerTimestamp * selectedSourceFrames;
  }, [gridPlan, selectedSourceFrames, target]);

  const preflightError = useMemo(() => {
    if (rangeEndUs <= rangeStartUs) return '結束時間必須大於開始時間。';
    if (selectedSourceFrames < 1) return '選取範圍內沒有 presentation frame。';
    if (estimatedBytes > PREFLIGHT_HARD_BYTES) {
      return `raw RGBA 上限估算 ${(estimatedBytes / 1024 / 1024).toFixed(0)} MiB 超過已驗證的 512 MiB beta 預算；請縮短 range 或減少格數。`;
    }
    return null;
  }, [estimatedBytes, rangeEndUs, rangeStartUs, selectedSourceFrames]);

  function updateSourceGrid(nextCols: number, nextRows: number): void {
    setCols(nextCols);
    setRows(nextRows);
    if (metadata) resetSourceCuts(metadata.width, metadata.height, nextCols, nextRows);
    else {
      setXCuts(null);
      setYCuts(null);
    }
    if (
      !Number.isSafeInteger(nextCols) ||
      !Number.isSafeInteger(nextRows) ||
      nextCols < 1 ||
      nextRows < 1
    ) return;
    const nextCount = nextCols * nextRows;
    setCount(nextCount);
    setCover((current) => Math.min(Math.max(1, current), nextCount));
  }

  function updateRangeStart(nextStartUs: number): void {
    setRangeStartUs(nextStartUs);
    setScrubUs((current) => Math.min(
      Math.max(current, nextStartUs),
      Math.max(nextStartUs, rangeEndUs - 1),
    ));
  }

  function updateRangeEnd(nextEndUs: number): void {
    setRangeEndUs(nextEndUs);
    setScrubUs((current) => Math.min(
      Math.max(current, rangeStartUs),
      Math.max(rangeStartUs, nextEndUs - 1),
    ));
  }

  function changeTarget(next: VideoOutputTarget): void {
    setTarget(next);
    setCover(1);
    if (!nameCustomizedRef.current) {
      setName(next === 'animated-emoji'
        ? 'Video Animated Emoji'
        : next === 'popup'
          ? 'Video Popup Stickers'
          : 'Video Animated Stickers');
    }
  }

  useEffect(() => {
    const source = sourceRef.current;
    if (!source || project || !metadata || rangeEndUs <= rangeStartUs) return;
    const controller = new AbortController();
    const timestamps = [
      { label: '開始', value: rangeStartUs },
      { label: '中間', value: Math.round((rangeStartUs + rangeEndUs) / 2) },
      { label: '結束', value: Math.max(rangeStartUs, rangeEndUs - 1) },
      { label: `自選 ${(scrubUs / 1_000_000).toFixed(3)} 秒`, value: scrubUs },
    ];
    void (async () => {
      const next: Array<{ label: string; png: Uint8Array }> = [];
      for (const timestamp of timestamps) {
        const frame = await source.sampleAt(timestamp.value, controller.signal);
        next.push({ label: timestamp.label, png: encodePng(frame.raster) });
      }
      setPreviews(next);
    })().catch((error) => {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        logger.log('err', error instanceof Error ? error.message : String(error));
      }
    });
    return () => controller.abort();
  }, [metadata, project, rangeStartUs, rangeEndUs, scrubUs]);

  async function clearCurrentProject(): Promise<void> {
    if (project) await project.master.store.clear();
    masterStoreRef.current = null;
    cacheRef.current.clear();
    setProject(null);
    setPosters([]);
    setLinePack(null);
  }

  async function loadVideo(file: File) {
    if (project && !window.confirm('開啟新影片會清除目前尚未下載的暫存 Project，要繼續嗎？')) return;
    logger.clear();
    setBusy(true);
    setPreviews([]);
    sourceRef.current?.dispose();
    sourceRef.current = null;
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      logger.log('step', `probe ${file.name} 的 container、codec 與完整 frame index…`);
      const source = await openBrowserVideo(file, controller.signal);
      await clearCurrentProject();
      sourceRef.current = source;
      setMetadata(source.metadata);
      resetSourceCuts(source.metadata.width, source.metadata.height, cols, rows);
      const startUs = Math.max(0, source.metadata.firstTimestampUs);
      const endUs = Math.min(source.metadata.endTimestampUs, startUs + 4_000_000);
      setRangeStartUs(startUs);
      setRangeEndUs(endUs);
      setScrubUs(startUs);
      setDefaultBackground('none');
      logger.log('ok', `已列出 ${source.metadata.frameCount} 個 presentation frames；像素不會上傳`);
    } catch (error) {
      logger.log('err', error instanceof Error ? error.message : String(error));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setBusy(false);
    }
  }

  async function buildMaster() {
    const source = sourceRef.current;
    if (!source || !metadata || !gridPlan || preflightError) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setLinePack(null);
    setIngestProgress({ sourceFrames: 0, totalSourceFrames: selectedSourceFrames, crops: 0, totalCrops: selectedSourceFrames * gridPlan.count, chunks: 0 });
    let store: Awaited<ReturnType<typeof createVideoMasterStore>> | null = null;
    try {
      store = await createVideoMasterStore({ estimatedBytes });
      logger.log('step', `依 presentation order 擷取 ${selectedSourceFrames} 格，建立 ${gridPlan.count} 張未去背 raw master…`);
      const master = await buildRawVideoMaster({
        source,
        grid: gridPlan,
        target,
        rangeStartUs,
        rangeEndUs,
        store,
        chunkFrames: 20,
        signal: controller.signal,
        onProgress: setIngestProgress,
      });
      const settings = master.stickers.map((sticker) => defaultSettings({
        target,
        stickerId: sticker.id,
        startUs: rangeStartUs,
        endUs: rangeEndUs,
        sourceFrames: master.sourceFrameCount,
        backgroundMode: defaultBackground,
        color: backgroundColor,
        colorKeyOptions,
      }));
      const created: VideoProjectState = {
        target,
        name,
        createdAt: new Date().toISOString(),
        cover,
        source: metadata,
        editableStartUs: rangeStartUs,
        editableEndUs: rangeEndUs,
        grid: gridPlan,
        master,
        settings,
        current: settings.map(() => null),
      };
      setPosters(await posterPngs(master));
      setProject(created);
      masterStoreRef.current = master.store;
      setCommonDurationMs(settings[0]?.perLoopDurationMs ?? 2000);
      setCommonLoops(settings[0]?.loops ?? 1);
      setCommonBackground(settings[0]?.background.mode ?? 'none');
      setBackgroundColor(settings[0]?.background.color ?? backgroundColor);
      setColorKeyOptions(settings[0]?.background.colorKey
        ? { ...settings[0].background.colorKey }
        : copyColorKeyOptions(DEFAULT_COLOR_KEY_OPTIONS));
      setActiveIndex(0);
      source.dispose();
      sourceRef.current = null;
      logger.log('ok', `${master.sourceFrameCount} 個 source samples 已寫入 ${master.visualFrameCount} 個 raw visuals；影片 decoder 已釋放`);
    } catch (error) {
      await store?.clear();
      logger.log('err', error instanceof Error ? error.message : String(error));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setBusy(false);
      setIngestProgress(null);
    }
  }

  function isDirty(index: number): boolean {
    if (!project) return false;
    const current = project.current[index];
    return !current || !settingsEqual(project.settings[index]!, current.settings);
  }

  async function renderSticker(index: number): Promise<VideoRenderSnapshot> {
    if (!project) throw new Error('Project 不存在');
    const settings = project.settings[index]!;
    const controller = abortRef.current ?? new AbortController();
    if (!abortRef.current) abortRef.current = controller;
    const mode = settings.background.mode;
    const colabConfig = mode === 'colab-birefnet' ? colabConnection?.config : null;
    if (mode === 'colab-birefnet' && !colabConfig) {
      throw new Error('Colab 多模型去背尚未設定；請先完成臨時 session 連線');
    }
    let job: BackgroundRemovalJob | null = null;
    const unregister = colabConfig ? registerActiveRemoval(controller) : null;
    try {
      if (mode !== 'none') {
        job = await createBackgroundRemovalJob({
          mode,
          signal: controller.signal,
          pickColor: mode === 'color-key' ? hexToRgb(settings.background.color ?? '#00ff00') : null,
          ...(mode === 'color-key' ? { colorKey: settings.background.colorKey } : {}),
          colabConfig,
          onStatus: (status) => status && setProgress(status),
        });
      }
      const snapshot = await processMasterApngSticker({
        target: project.target,
        master: project.master.stickers[index]!,
        store: project.master.store,
        settings,
        cache: cacheRef.current,
        removerVersion: videoRemoverVersion(mode, job?.label ?? null, colabGeneration),
        removeBackground: job?.remove,
        signal: controller.signal,
        onProgress: (stage) => setProgress(`第 ${index + 1} 張：${stage}`),
      });
      if (mode === 'colab-birefnet' && controller.signal.aborted) {
        throw new DOMException('Colab 多模型去背 session 已變更', 'AbortError');
      }
      return snapshot;
    } finally {
      await job?.dispose();
      unregister?.();
    }
  }

  async function rerenderOne(index: number) {
    if (!project) return;
    setBusy(true);
    setLinePack(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const snapshot = await renderSticker(index);
      setProject((previous) => {
        if (!previous) return previous;
        const current = [...previous.current];
        current[index] = snapshot;
        return { ...previous, current };
      });
      logger.log(snapshot.errors.length ? 'err' : 'ok', snapshot.errors.length
        ? `第 ${index + 1} 張已保存可預覽 bytes，但不符合 ${videoTargetLabel(project.target)} 規則`
        : `第 ${index + 1} 張 exact-target 成品已通過 final-byte gate`);
    } catch (error) {
      logger.log('err', `第 ${index + 1} 張：${error instanceof Error ? error.message : String(error)}；保留上一版 current`);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setBusy(false);
      setProgress('');
    }
  }

  async function rerenderAll() {
    if (!project) return;
    setBusy(true);
    setLinePack(null);
    const controller = new AbortController();
    abortRef.current = controller;
    let failures = 0;
    try {
      for (let index = 0; index < project.settings.length; index++) {
        if (!isDirty(index)) continue;
        setProgress(`貼圖 ${index + 1}/${project.settings.length}`);
        try {
          const snapshot = await renderSticker(index);
          setProject((previous) => {
            if (!previous) return previous;
            const current = [...previous.current];
            current[index] = snapshot;
            return { ...previous, current };
          });
          if (snapshot.errors.length) failures++;
        } catch (error) {
          failures++;
          logger.log('err', `第 ${index + 1} 張：${error instanceof Error ? error.message : String(error)}；繼續下一張`);
        }
      }
      logger.log(failures ? 'err' : 'ok', failures ? `批次完成，${failures} 張需要修正` : '所有 dirty previews 已通過');
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setBusy(false);
      setProgress('');
    }
  }

  async function downloadProject() {
    if (!project) return;
    setBusy(true);
    try {
      const built = await buildVideoProjectZip({
        target: project.target,
        name: project.name,
        createdAt: project.createdAt,
        cover: project.cover,
        source: project.source,
        editableStartUs: project.editableStartUs,
        editableEndUs: project.editableEndUs,
        grid: project.grid,
        master: project.master,
        settings: project.settings,
        current: project.current,
      });
      downloadBytes(`${safeName(project.name)}.video-apng-project-v4.zip`, built.zip, 'application/zip');
    } catch (error) {
      logger.log('err', error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function loadProject(file: File) {
    if (project && !window.confirm('開啟另一個 Project 會清除目前尚未下載的暫存 Project，要繼續嗎？')) return;
    logger.clear();
    setBusy(true);
    let imported: Awaited<ReturnType<typeof importVideoProjectZip>> | null = null;
    try {
      imported = await importVideoProjectZip(new Uint8Array(await file.arrayBuffer()));
      await project?.master.store.clear();
      sourceRef.current?.dispose();
      sourceRef.current = null;
      cacheRef.current.clear();
      const manifest = imported.manifest;
      const restoredSettings = manifest.settings.map(cloneVideoStickerDraft);
      const restored: VideoProjectState = {
        target: manifest.target,
        name: manifest.name,
        createdAt: manifest.createdAt,
        cover: manifest.cover,
        source: manifest.source,
        editableStartUs: manifest.source.editableStartUs,
        editableEndUs: manifest.source.editableEndUs,
        grid: manifest.grid,
        master: imported.master,
        settings: restoredSettings,
        current: [...invalidateColabVideoCurrent(imported.current)],
      };
      setMetadata(manifest.source);
      setTarget(manifest.target);
      setCount(manifest.grid.count);
      setCols(manifest.grid.cols);
      setRows(manifest.grid.rows);
      setXCuts(null);
      setYCuts(null);
      setRangeStartUs(manifest.source.editableStartUs);
      setRangeEndUs(manifest.source.editableEndUs);
      setName(manifest.name);
      nameCustomizedRef.current = true;
      setCover(manifest.cover);
      setProject(restored);
      masterStoreRef.current = imported.master.store;
      setCommonDurationMs(restored.settings[0]?.perLoopDurationMs ?? 2000);
      setCommonLoops(restored.settings[0]?.loops ?? 1);
      setCommonBackground(restored.settings[0]?.background.mode ?? 'none');
      setBackgroundColor(restored.settings[0]?.background.color ?? '#00ff00');
      setColorKeyOptions(restored.settings[0]?.background.colorKey
        ? { ...restored.settings[0].background.colorKey }
        : copyColorKeyOptions(DEFAULT_COLOR_KEY_OPTIONS));
      setPosters(await posterPngs(imported.master));
      setActiveIndex(0);
      setLinePack(null);
      logger.log('ok', manifest.legacy
        ? '已以 sampled/baked legacy 限制匯入 V1 Project，未製造缺失 frames 或 raw RGB'
        : `已恢復 Project V4（${videoTargetLabel(manifest.target)}）的 ${manifest.master.sourceFrameCount} 個 sample refs，未啟動影片 decoder`);
    } catch (error) {
      await imported?.master.store.clear();
      logger.log('err', error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function makeLinePack() {
    if (!project) return;
    if (project.current.some((snapshot) => !snapshot)) {
      logger.log('err', '缺少必要成品 bytes；請先產生所有成品預覽。這是結構性失敗，不能略過。');
      return;
    }
    setBusy(true);
    setInvalidDialogOpen(false);
    try {
      const snapshots = project.current as VideoRenderSnapshot[];
      const stickerInfos: ImageInfo[] = [];
      for (let index = 0; index < snapshots.length; index++) {
        setProgress(`打包驗證 ${index + 1}/${snapshots.length}：decode final bytes`);
        stickerInfos.push(inspectAnimatedBytes(snapshots[index]!.png, snapshots[index]!.settings.targetFrames).info);
      }
      const coverIndex = Math.min(Math.max(1, project.cover), snapshots.length) - 1;
      const coverSnapshot = snapshots[coverIndex]!;
      const coverDecoded = decodeApngFrames(coverSnapshot.png);
      let main: Uint8Array | undefined;
      let popupMain: Uint8Array | undefined;
      let tab: Uint8Array;
      let zip: Uint8Array;
      let zipBytes: number;
      let validation: ReturnType<typeof validatePack>;
      if (project.target === 'animated-emoji') {
        const builtTab = buildTab(coverDecoded.frames[0]!);
        tab = builtTab.tab;
        const built = buildEmojiPackZip({
          name: project.name,
          kind: 'animated-emoji',
          tab,
          items: snapshots.map((snapshot) => snapshot.png),
        });
        zip = built.zip;
        zipBytes = built.zipBytes;
        validation = validateEmojiPack({
          kind: 'animated-emoji',
          count: snapshots.length,
          items: stickerInfos,
          tab: builtTab.tabInfo,
          archivePaths: Object.keys(built.files),
          zipBytes,
        });
      } else if (project.target === 'popup') {
        const staticStickers: ProcessedSticker[] = [];
        for (let index = 0; index < snapshots.length; index++) {
          setProgress(`建立配對靜態圖 ${index + 1}/${snapshots.length}`);
          const frames = decodeApngFrames(snapshots[index]!.png).frames;
          const staticFrameIndex = project.settings[index]!.staticFrameIndex ?? 0;
          const frame = frames[staticFrameIndex];
          if (!frame) {
            throw new Error(`第 ${index + 1} 張指定的靜態 frame ${staticFrameIndex + 1} 不存在（成品只有 ${frames.length} 格）`);
          }
          staticStickers.push(await processStatic(frame, {
            bounds: maxBounds('static'),
            removeBackground: false,
            marginPx: 0,
            maxBytes: STATIC_SPEC.maxBytes,
            forbidPalette: true,
          }));
        }
        const supports = buildMainTab(staticStickers[coverIndex]!.raster);
        main = supports.main;
        tab = supports.tab;
        popupMain = coverSnapshot.png;
        const built = buildPopupPackZip({
          main,
          popupMain,
          tab,
          stickers: staticStickers.map((sticker) => sticker.png),
          popupStickers: snapshots.map((snapshot) => snapshot.png),
        });
        zip = built.zip;
        zipBytes = built.zipBytes;
        validation = validatePopupPack({
          count: snapshots.length,
          stickers: staticStickers.map((sticker) => sticker.info),
          popupStickers: stickerInfos,
          main: supports.mainInfo,
          popupMain: stickerInfos[coverIndex]!,
          tab: supports.tabInfo,
          zipBytes,
        });
      } else {
        const builtTab = buildTab(coverDecoded.frames[0]!);
        tab = builtTab.tab;
        const builtMain = buildAnimatedMainFromTimeline(
          coverDecoded.frames,
          coverDecoded.delaysMs,
          coverDecoded.loops,
        );
        main = builtMain.main;
        const built = buildPackZip({
          main,
          tab: builtTab.tab,
          stickers: snapshots.map((snapshot) => snapshot.png),
        });
        zip = built.zip;
        zipBytes = built.zipBytes;
        validation = validatePack({
          kind: 'animated',
          count: snapshots.length,
          stickers: stickerInfos,
          main: builtMain.mainInfo,
          tab: builtTab.tabInfo,
          zipBytes,
        });
      }
      const dirtyIndices = project.settings.flatMap((settings, index) =>
        settingsEqual(settings, snapshots[index]!.settings) ? [] : [index],
      );
      if (dirtyIndices.length > 0) {
        validation = mergeResults(validation, {
          ok: false,
          issues: dirtyIndices.map((index) => ({
            level: 'error' as const,
            code: 'video.dirty',
            target: videoItemFileName(project.target, index),
            message: 'draft 設定尚未產生 current bytes',
          })),
        });
      }
      setLinePack({ target: project.target, zip, main, popupMain, tab, validation });
      if (validation.ok) logger.log('ok', `所有 final bytes 驗證通過，${videoTargetLabel(project.target)} LINE ZIP 已完成（${kb(zipBytes)}）`);
      else {
        logger.log('err', `ZIP 內容可建立，但不符合 ${videoTargetLabel(project.target)} 規則；必須逐項確認才能下載標示為不合規的 ZIP`);
        setInvalidDialogOpen(true);
      }
    } catch (error) {
      logger.log('err', `結構性打包失敗：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
      setProgress('');
    }
  }

  const dirtyCount = project ? project.settings.filter((_, index) => isDirty(index)).length : 0;
  const projectContract = project?.target === 'animated-emoji'
    ? ANIMATED_EMOJI_SPEC
    : project?.target === 'popup'
      ? POPUP_STICKER_SPEC
      : ANIMATED_SPEC;
  const commonDurationsMs = projectContract.playbackDurationsSec.map((seconds) => seconds * 1000);
  const legalCommonLoops = [1, 2, 3, 4].filter((loops) =>
    loops <= projectContract.maxLoops && commonDurationMs * loops <= projectContract.maxDurationSec * 1000,
  ) as VideoStickerSettings['loops'][];

  function applyCommonSettings() {
    setProject((previous) => {
      if (!previous) return previous;
      return {
        ...previous,
        settings: previous.settings.map((settings) => ({
          ...settings,
          perLoopDurationMs: commonDurationMs,
          loops: commonLoops,
          background: previous.master.backgroundStage === 'baked-legacy'
            ? { ...settings.background }
            : commonBackground === 'color-key'
              ? { mode: 'color-key', color: backgroundColor, colorKey: { ...colorKeyOptions } }
              : { mode: commonBackground },
        })),
      };
    });
    setLinePack(null);
  }

  return (
    <section>
      <p className="tab-desc">
        Video → APNG beta：先選 Animated Sticker、Animated Emoji 或 Pop-up Sticker，再列出可編輯時間窗內所有 presentation frames，建立目標尺寸的未去背 raw master；之後逐張選時間、hard target 格數、播放與去背。Pop-up 可另外指定一格作為配對靜態貼圖；原始影片與音軌不寫入 Project ZIP。
      </p>
      <div className="video-source-actions">
        <input ref={videoInput} type="file" accept="video/*,.mp4,.mov,.m4v,.webm,.mkv" hidden onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void loadVideo(file); event.currentTarget.value = ''; }} />
        <input ref={projectInput} type="file" accept=".zip,application/zip" hidden onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void loadProject(file); event.currentTarget.value = ''; }} />
        <button className="btn primary" disabled={busy} onClick={() => videoInput.current?.click()}>上傳影片</button>
        <button className="btn" disabled={busy} onClick={() => projectInput.current?.click()}>上傳可調整 Project ZIP</button>
      </div>

      {metadata && !project && (
        <VideoSourceStep
          metadata={metadata}
          target={target}
          count={count}
          cols={cols}
          rows={rows}
          name={name}
          cover={cover}
          defaultBackground={defaultBackground}
          color={backgroundColor}
          colorKeyOptions={colorKeyOptions}
          grid={gridPlan}
          busy={busy}
          onTarget={changeTarget}
          onCount={(value) => { setCount(value); setCover((current) => Math.min(Math.max(1, current), Math.max(1, value))); }}
          onCols={(value) => updateSourceGrid(value, rows)}
          onRows={(value) => updateSourceGrid(cols, value)}
          onName={(value) => { nameCustomizedRef.current = true; setName(value); }}
          onCover={setCover}
          onBackground={setDefaultBackground}
          onColor={setBackgroundColor}
          onColorKeyOptions={setColorKeyOptions}
          onBuild={() => void buildMaster()}
          range={{
            target,
            firstTimestampUs: metadata.firstTimestampUs,
            endTimestampUs: metadata.endTimestampUs,
            rangeStartUs,
            rangeEndUs,
            scrubUs,
            grid: gridPlan,
            xCuts,
            yCuts,
            previews,
            sourceFrames: selectedSourceFrames,
            cropFrames: selectedSourceFrames * count,
            estimatedBytes,
            preflightError,
            disabled: busy,
            onRangeStartUs: updateRangeStart,
            onRangeEndUs: updateRangeEnd,
            onScrubUs: setScrubUs,
            onXCuts: setXCuts,
            onYCuts: setYCuts,
            onRestoreEqual: () => resetSourceCuts(metadata.width, metadata.height, cols, rows),
          }}
        />
      )}
      {ingestProgress && <VideoIngestProgress value={ingestProgress} onCancel={() => abortRef.current?.abort()} />}
      <LogPane lines={logger.lines} />

      {project && (
        <>
          <div className="video-project-summary">
            <h3>3. 逐張 exact-target 編輯（{videoTargetLabel(project.target)}）</h3>
            <p className="tab-desc">
              {videoTargetLabel(project.target)} · {project.name} · {project.master.sourceFrameCount} source samples · {project.master.visualFrameCount} raw visuals ·
              {project.master.store.kind} store · {project.master.frameCoverage}/{project.master.backgroundStage}。
              {dirtyCount ? `還有 ${dirtyCount} 張 draft。` : '所有 current 與 draft 一致。'}
            </p>
            <div className="video-common-settings">
              <label>共同單輪時間
                <select value={commonDurationMs} onChange={(event) => {
                  const duration = Number(event.target.value) as VideoStickerSettings['perLoopDurationMs'];
                  setCommonDurationMs(duration);
                  if (duration * commonLoops > projectContract.maxDurationSec * 1000) setCommonLoops(1);
                }}>
                  {commonDurationsMs.map((value) => <option key={value} value={value}>{value / 1000} 秒</option>)}
                </select>
              </label>
              <label>共同循環
                <select value={commonLoops} onChange={(event) => setCommonLoops(Number(event.target.value) as VideoStickerSettings['loops'])}>
                  {legalCommonLoops.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </label>
              <label>共同去背
                <select disabled={project.master.backgroundStage === 'baked-legacy'} value={commonBackground} onChange={(event) => setCommonBackground(event.target.value as VideoBackgroundMode)}>
                  <option value="none">不去背</option>
                  <option value="color-key">單色色鍵</option>
                  <option value="imgly">IMG.LY（本機）</option>
                  <option value="local-birefnet">本機 BiRefNet</option>
                  <option value="colab-birefnet">Colab 多模型去背</option>
                </select>
              </label>
              {commonBackground === 'color-key' && <label>共同背景色<input type="color" value={backgroundColor} onChange={(event) => setBackgroundColor(event.target.value)} /></label>}
              <button className="btn small" disabled={busy} onClick={applyCommonSettings}>套用共同設定到所有貼圖</button>
            </div>
            {commonBackground === 'color-key' && (
              <ColorKeyOptionFields
                value={colorKeyOptions}
                onChange={setColorKeyOptions}
                disabled={project.master.backgroundStage === 'baked-legacy'}
              />
            )}
            <LocalBirefnetRuntimeWarning
              active={commonBackground === 'local-birefnet'
                || project.settings.some((settings) => settings.background.mode === 'local-birefnet')}
            />
          </div>
          <div className="video-editor-layout">
            <VideoStickerList target={project.target} settings={project.settings} current={project.current} posters={posters} activeIndex={activeIndex} onSelect={setActiveIndex} isDirty={isDirty} />
            <VideoStickerEditor
              target={project.target}
              index={activeIndex}
              settings={project.settings[activeIndex]!}
              current={project.current[activeIndex] ?? null}
              rangeStartUs={project.editableStartUs}
              rangeEndUs={project.editableEndUs}
              legacyBaked={project.master.backgroundStage === 'baked-legacy'}
              busy={busy}
              dirty={isDirty(activeIndex)}
              onChange={(settings) => {
                setProject((previous) => {
                  if (!previous) return previous;
                  const next = [...previous.settings];
                  next[activeIndex] = settings;
                  return { ...previous, settings: next };
                });
                setLinePack(null);
              }}
              onRender={() => void rerenderOne(activeIndex)}
            />
          </div>
          <div className="run-row">
            <button className="btn primary" disabled={busy || dirtyCount === 0} onClick={() => void rerenderAll()}>依序產生所有 dirty previews</button>
            <button className="btn" disabled={busy} onClick={() => void downloadProject()}>下載 Project ZIP V4</button>
            <button className="btn" disabled={busy} onClick={() => void makeLinePack()}>建立 {videoTargetLabel(project.target)} LINE ZIP / 最終驗證</button>
            {busy && <button className="btn" onClick={() => abortRef.current?.abort()}>取消</button>}
            {progress && <span className="model-status">{progress}</span>}
          </div>
          {linePack && (
            <div className="pack-result">
              <ValidationView result={linePack.validation} />
              <div className="pack-actions">
                {linePack.validation.ok && <button className="btn primary" onClick={() => downloadBytes(`${safeName(project.name)}.zip`, linePack.zip, 'application/zip')}>下載 LINE ZIP（{kb(linePack.zip.length)}）</button>}
                {!linePack.validation.ok && <button className="btn" onClick={() => setInvalidDialogOpen(true)}>查看不合規項目與下載選項</button>}
                {linePack.main && <button className="btn" onClick={() => downloadBytes(project.target === 'popup' ? 'png/main.png' : 'main.png', linePack.main!, 'image/png')}>{project.target === 'popup' ? 'png/main.png' : 'main.png'}</button>}
                {linePack.popupMain && <button className="btn" onClick={() => downloadBytes('popup/main_popup.png', linePack.popupMain!, 'image/png')}>popup/main_popup.png</button>}
                <button className="btn" onClick={() => downloadBytes(project.target === 'popup' ? 'png/tab.png' : 'tab.png', linePack.tab, 'image/png')}>{project.target === 'popup' ? 'png/tab.png' : 'tab.png'}</button>
              </div>
            </div>
          )}
        </>
      )}

      {invalidDialogOpen && linePack && project && (
        <div className="ai-warning-backdrop">
          <div className="ai-warning-dialog" role="dialog" aria-modal="true" aria-labelledby="invalid-video-pack-title">
            <h3 id="invalid-video-pack-title">這不是符合 {videoTargetLabel(project.target)} 規則的 ZIP</h3>
            <ValidationView result={linePack.validation} />
            <p>預設動作是返回修正。只有必要 entry bytes 都存在時，才能明確確認下載不合規檔；此檔名與 UI 都不會宣稱可上架。</p>
            <div className="ai-warning-actions">
              <button className="btn primary" onClick={() => setInvalidDialogOpen(false)}>返回修正</button>
              <button className="btn" onClick={() => {
                downloadBytes(`${safeName(project.name)}.NOT-LINE-COMPLIANT.zip`, linePack.zip, 'application/zip');
                setInvalidDialogOpen(false);
              }}>我了解，下載標示為不合規的 ZIP</button>
            </div>
          </div>
        </div>
      )}
      {defaultBackground === 'colab-birefnet' && colabConnection && !project && (
        <p className="tab-desc">Colab session：{colabBirefnetEndpointHost(colabConnection.config.endpointUrl)}（endpoint/key 不寫入 Project）</p>
      )}
    </section>
  );
}
