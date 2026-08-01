import { useEffect, useMemo, useRef, useState } from 'react';
import { ANIMATED_SPEC } from '@core/spec.js';
import { planAnimatedCanvas, planVideoGrid, type VideoGridPlan } from '@core/videoCrop.js';
import type { VideoBackgroundMode } from '@core/videoProject.js';
import { mergeResults, validatePack, type ImageInfo } from '@core/validate.js';
import { createBackgroundRemovalJob, type BackgroundRemovalJob } from '../webpipe/backgroundRemovalJob.js';
import { colabBirefnetEndpointHost } from '../webpipe/colabBirefnet.js';
import { decodeApngFrames } from '../webpipe/apng.js';
import { buildAnimatedMainFromTimeline, buildTab } from '../webpipe/mainTab.js';
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
import { buildPackZip, downloadBytes, safeName } from '../webpipe/zip.js';
import { LogPane, ValidationView, kb, useLogger } from './common.jsx';
import { useColabBirefnetConnection } from './colabBirefnetConnection.jsx';
import { VideoIngestProgress, type VideoIngestProgressValue } from './video/VideoIngestProgress.jsx';
import { VideoSourceStep } from './video/VideoSourceStep.jsx';
import { VideoStickerEditor } from './video/VideoStickerEditor.jsx';
import { VideoStickerList } from './video/VideoStickerList.jsx';

interface VideoProjectState {
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
  zip: Uint8Array;
  main: Uint8Array;
  tab: Uint8Array;
  validation: ReturnType<typeof validatePack>;
}

const PREFLIGHT_HARD_BYTES = 512 * 1024 * 1024;
const RENDER_CACHE_BYTES = 96 * 1024 * 1024;

function hexToRgb(hex: string): [number, number, number] | null {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) return null;
  const value = Number.parseInt(match[1]!, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function cloneSettings(settings: VideoStickerSettings): VideoStickerSettings {
  return { ...settings, background: { ...settings.background } };
}

function settingsEqual(a: VideoStickerSettings, b: VideoStickerSettings): boolean {
  return (
    a.stickerId === b.stickerId &&
    a.rangeStartUs === b.rangeStartUs &&
    a.rangeEndUs === b.rangeEndUs &&
    a.targetFrames === b.targetFrames &&
    a.perLoopDurationMs === b.perLoopDurationMs &&
    a.loops === b.loops &&
    a.maxColors === b.maxColors &&
    a.background.mode === b.background.mode &&
    a.background.color === b.background.color &&
    a.background.tolerance === b.background.tolerance
  );
}

function defaultSettings(args: {
  stickerId: string;
  startUs: number;
  endUs: number;
  sourceFrames: number;
  backgroundMode: VideoBackgroundMode;
  color: string;
}): VideoStickerSettings {
  const roundedSeconds = Math.max(1, Math.min(4, Math.round((args.endUs - args.startUs) / 1_000_000)));
  return {
    stickerId: args.stickerId,
    rangeStartUs: args.startUs,
    rangeEndUs: args.endUs,
    targetFrames: Math.max(ANIMATED_SPEC.minFrames, Math.min(ANIMATED_SPEC.maxFrames, args.sourceFrames)),
    perLoopDurationMs: (roundedSeconds * 1000) as VideoStickerSettings['perLoopDurationMs'],
    loops: 1,
    background: {
      mode: args.backgroundMode,
      color: args.backgroundMode === 'color-key' ? args.color : undefined,
    },
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
  const sourceRef = useRef<BrowserVideoSource | null>(null);
  const masterStoreRef = useRef<VideoMasterStore | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const cacheRef = useRef(new VideoFrameRenderCache(RENDER_CACHE_BYTES));
  const logger = useLogger();
  const { connection: colabConnection, registerActiveRemoval } = useColabBirefnetConnection();
  const [metadata, setMetadata] = useState<VideoMetadata | null>(null);
  const [count, setCount] = useState(8);
  const [cols, setCols] = useState(4);
  const [rows, setRows] = useState(2);
  const [rangeStartUs, setRangeStartUs] = useState(0);
  const [rangeEndUs, setRangeEndUs] = useState(4_000_000);
  const [scrubUs, setScrubUs] = useState(0);
  const [previews, setPreviews] = useState<Array<{ label: string; png: Uint8Array }>>([]);
  const [defaultBackground, setDefaultBackground] = useState<VideoBackgroundMode>('none');
  const [backgroundColor, setBackgroundColor] = useState('#00ff00');
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

  const gridPlan = useMemo(() => {
    if (!metadata) return null;
    try {
      return planVideoGrid({ sourceWidth: metadata.width, sourceHeight: metadata.height, cols, rows, count });
    } catch {
      return null;
    }
  }, [metadata, cols, rows, count]);

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
      const canvas = planAnimatedCanvas(rect.width, rect.height);
      return sum + canvas.width * canvas.height * 4;
    }, 0);
    return bytesPerTimestamp * selectedSourceFrames;
  }, [gridPlan, selectedSourceFrames]);

  const preflightError = useMemo(() => {
    if (rangeEndUs <= rangeStartUs) return '結束時間必須大於開始時間。';
    if (selectedSourceFrames < 1) return '選取範圍內沒有 presentation frame。';
    if (estimatedBytes > PREFLIGHT_HARD_BYTES) {
      return `raw RGBA 上限估算 ${(estimatedBytes / 1024 / 1024).toFixed(0)} MiB 超過已驗證的 512 MiB beta 預算；請縮短 range 或減少格數。`;
    }
    return null;
  }, [estimatedBytes, rangeEndUs, rangeStartUs, selectedSourceFrames]);

  useEffect(() => {
    const source = sourceRef.current;
    if (!source || project || !metadata || rangeEndUs <= rangeStartUs) return;
    const controller = new AbortController();
    const timestamps = [
      { label: '開始', value: rangeStartUs },
      { label: '中間', value: Math.round((rangeStartUs + rangeEndUs) / 2) },
      { label: '結束', value: Math.max(rangeStartUs, rangeEndUs - 1) },
      { label: `scrub ${(scrubUs / 1_000_000).toFixed(3)}s`, value: scrubUs },
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
    setIngestProgress({ sourceFrames: 0, totalSourceFrames: selectedSourceFrames, crops: 0, totalCrops: selectedSourceFrames * count, chunks: 0 });
    let store: Awaited<ReturnType<typeof createVideoMasterStore>> | null = null;
    try {
      store = await createVideoMasterStore({ estimatedBytes });
      logger.log('step', `依 presentation order 擷取 ${selectedSourceFrames} 格，建立 ${count} 張未去背 raw master…`);
      const master = await buildRawVideoMaster({
        source,
        grid: gridPlan,
        rangeStartUs,
        rangeEndUs,
        store,
        chunkFrames: 20,
        signal: controller.signal,
        onProgress: setIngestProgress,
      });
      const settings = master.stickers.map((sticker) => defaultSettings({
        stickerId: sticker.id,
        startUs: rangeStartUs,
        endUs: rangeEndUs,
        sourceFrames: master.sourceFrameCount,
        backgroundMode: defaultBackground,
        color: backgroundColor,
      }));
      const created: VideoProjectState = {
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
      throw new Error('Colab BiRefNet 尚未設定；請先完成臨時 session 連線');
    }
    let job: BackgroundRemovalJob | null = null;
    const unregister = colabConfig ? registerActiveRemoval(controller) : null;
    try {
      if (mode !== 'none') {
        job = await createBackgroundRemovalJob({
          mode,
          signal: controller.signal,
          pickColor: mode === 'color-key' ? hexToRgb(settings.background.color ?? '#00ff00') : null,
          colabConfig,
          onStatus: (status) => status && setProgress(status),
        });
      }
      return await processMasterApngSticker({
        master: project.master.stickers[index]!,
        store: project.master.store,
        settings,
        cache: cacheRef.current,
        removerVersion: mode === 'none' ? 'none@1' : `${job!.label}@1`,
        removeBackground: job?.remove,
        signal: controller.signal,
        onProgress: (stage) => setProgress(`第 ${index + 1} 張：${stage}`),
      });
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
        ? `第 ${index + 1} 張已保存可預覽 bytes，但不符合 LINE Sticker 規則`
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
      downloadBytes(`${safeName(project.name)}.video-apng-project-v2.zip`, built.zip, 'application/zip');
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
      const restored: VideoProjectState = {
        name: manifest.name,
        createdAt: manifest.createdAt,
        cover: manifest.cover,
        source: manifest.source,
        editableStartUs: manifest.source.editableStartUs,
        editableEndUs: manifest.source.editableEndUs,
        grid: manifest.grid,
        master: imported.master,
        settings: manifest.settings.map(cloneSettings),
        current: imported.current,
      };
      setMetadata(manifest.source);
      setCount(manifest.grid.count);
      setCols(manifest.grid.cols);
      setRows(manifest.grid.rows);
      setRangeStartUs(manifest.source.editableStartUs);
      setRangeEndUs(manifest.source.editableEndUs);
      setName(manifest.name);
      setCover(manifest.cover);
      setProject(restored);
      masterStoreRef.current = imported.master.store;
      setCommonDurationMs(restored.settings[0]?.perLoopDurationMs ?? 2000);
      setCommonLoops(restored.settings[0]?.loops ?? 1);
      setCommonBackground(restored.settings[0]?.background.mode ?? 'none');
      setBackgroundColor(restored.settings[0]?.background.color ?? '#00ff00');
      setPosters(await posterPngs(imported.master));
      setActiveIndex(0);
      setLinePack(null);
      logger.log('ok', manifest.legacy
        ? '已以 sampled/baked legacy 限制匯入 V1 Project，未製造缺失 frames 或 raw RGB'
        : `已恢復 Project V2 的 ${manifest.master.sourceFrameCount} 個 sample refs，未啟動影片 decoder`);
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
      logger.log('err', '缺少必要 sticker bytes；請先產生所有成品預覽。這是結構性失敗，不能略過。');
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
      const { main, mainInfo } = buildAnimatedMainFromTimeline(
        coverDecoded.frames,
        coverDecoded.delaysMs,
        coverDecoded.loops,
      );
      const { tab, tabInfo } = buildTab(coverDecoded.frames[0]!);
      const built = buildPackZip({ main, tab, stickers: snapshots.map((snapshot) => snapshot.png) });
      let validation = validatePack({
        kind: 'animated',
        count: snapshots.length,
        stickers: stickerInfos,
        main: mainInfo,
        tab: tabInfo,
        zipBytes: built.zipBytes,
      });
      const dirtyIndices = project.settings.flatMap((settings, index) =>
        settingsEqual(settings, snapshots[index]!.settings) ? [] : [index],
      );
      if (dirtyIndices.length > 0) {
        validation = mergeResults(validation, {
          ok: false,
          issues: dirtyIndices.map((index) => ({
            level: 'error' as const,
            code: 'video.dirty',
            target: `${String(index + 1).padStart(2, '0')}.png`,
            message: 'draft 設定尚未產生 current bytes',
          })),
        });
      }
      setLinePack({ zip: built.zip, main, tab, validation });
      if (validation.ok) logger.log('ok', `所有 final bytes 驗證通過，LINE ZIP 已完成（${kb(built.zipBytes)}）`);
      else {
        logger.log('err', 'ZIP 內容可建立，但不符合 LINE Sticker 規則；必須逐項確認才能下載標示為不合規的 ZIP');
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
  const legalCommonLoops = [1, 2, 3, 4].filter((loops) => commonDurationMs * loops <= 4000) as VideoStickerSettings['loops'][];

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
            : {
                mode: commonBackground,
                color: commonBackground === 'color-key' ? backgroundColor : undefined,
              },
        })),
      };
    });
    setLinePack(null);
  }

  return (
    <section>
      <p className="tab-desc">
        Video → APNG V2 beta：先列出可編輯時間窗內所有 presentation frames，建立未去背 raw master；之後逐張選時間、hard target 格數、播放與去背。原始影片與音軌不寫入 Project ZIP。
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
          count={count}
          cols={cols}
          rows={rows}
          name={name}
          cover={cover}
          defaultBackground={defaultBackground}
          color={backgroundColor}
          grid={gridPlan}
          busy={busy}
          onCount={(value) => { setCount(value); setCover((current) => Math.min(Math.max(1, current), Math.max(1, value))); }}
          onCols={setCols}
          onRows={setRows}
          onName={setName}
          onCover={setCover}
          onBackground={setDefaultBackground}
          onColor={setBackgroundColor}
          onBuild={() => void buildMaster()}
          range={{
            firstTimestampUs: metadata.firstTimestampUs,
            endTimestampUs: metadata.endTimestampUs,
            rangeStartUs,
            rangeEndUs,
            scrubUs,
            grid: gridPlan,
            previews,
            sourceFrames: selectedSourceFrames,
            cropFrames: selectedSourceFrames * count,
            estimatedBytes,
            preflightError,
            onRangeStartUs: setRangeStartUs,
            onRangeEndUs: setRangeEndUs,
            onScrubUs: setScrubUs,
          }}
        />
      )}
      {ingestProgress && <VideoIngestProgress value={ingestProgress} onCancel={() => abortRef.current?.abort()} />}
      <LogPane lines={logger.lines} />

      {project && (
        <>
          <div className="video-project-summary">
            <h3>3. 逐張 exact-target 編輯</h3>
            <p className="tab-desc">
              {project.name} · {project.master.sourceFrameCount} source samples · {project.master.visualFrameCount} raw visuals ·
              {project.master.store.kind} store · {project.master.frameCoverage}/{project.master.backgroundStage}。
              {dirtyCount ? `還有 ${dirtyCount} 張 draft。` : '所有 current 與 draft 一致。'}
            </p>
            <div className="video-common-settings">
              <label>共同單輪時間
                <select value={commonDurationMs} onChange={(event) => {
                  const duration = Number(event.target.value) as VideoStickerSettings['perLoopDurationMs'];
                  setCommonDurationMs(duration);
                  if (duration * commonLoops > 4000) setCommonLoops(1);
                }}>
                  {[1000, 2000, 3000, 4000].map((value) => <option key={value} value={value}>{value / 1000} 秒</option>)}
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
                  <option value="colab-birefnet">Colab BiRefNet</option>
                </select>
              </label>
              {commonBackground === 'color-key' && <label>共同背景色<input type="color" value={backgroundColor} onChange={(event) => setBackgroundColor(event.target.value)} /></label>}
              <button className="btn small" disabled={busy} onClick={applyCommonSettings}>套用共同設定到所有貼圖</button>
            </div>
          </div>
          <div className="video-editor-layout">
            <VideoStickerList settings={project.settings} current={project.current} posters={posters} activeIndex={activeIndex} onSelect={setActiveIndex} isDirty={isDirty} />
            <VideoStickerEditor
              index={activeIndex}
              settings={project.settings[activeIndex]!}
              current={project.current[activeIndex] ?? null}
              rangeStartUs={project.editableStartUs}
              rangeEndUs={project.editableEndUs}
              legacyBaked={project.master.backgroundStage === 'baked-legacy'}
              busy={busy}
              dirty={isDirty(activeIndex)}
              onChange={(settings) => setProject((previous) => {
                if (!previous) return previous;
                const next = [...previous.settings];
                next[activeIndex] = settings;
                return { ...previous, settings: next };
              })}
              onRender={() => void rerenderOne(activeIndex)}
            />
          </div>
          <div className="run-row">
            <button className="btn primary" disabled={busy || dirtyCount === 0} onClick={() => void rerenderAll()}>依序產生所有 dirty previews</button>
            <button className="btn" disabled={busy} onClick={() => void downloadProject()}>下載 Project ZIP V2</button>
            <button className="btn" disabled={busy} onClick={() => void makeLinePack()}>建立 LINE ZIP / 最終驗證</button>
            {busy && <button className="btn" onClick={() => abortRef.current?.abort()}>取消</button>}
            {progress && <span className="model-status">{progress}</span>}
          </div>
          {linePack && (
            <div className="pack-result">
              <ValidationView result={linePack.validation} />
              <div className="pack-actions">
                {linePack.validation.ok && <button className="btn primary" onClick={() => downloadBytes(`${safeName(project.name)}.zip`, linePack.zip, 'application/zip')}>下載 LINE ZIP（{kb(linePack.zip.length)}）</button>}
                {!linePack.validation.ok && <button className="btn" onClick={() => setInvalidDialogOpen(true)}>查看不合規項目與下載選項</button>}
                <button className="btn" onClick={() => downloadBytes('main.png', linePack.main, 'image/png')}>main.png</button>
                <button className="btn" onClick={() => downloadBytes('tab.png', linePack.tab, 'image/png')}>tab.png</button>
              </div>
            </div>
          )}
        </>
      )}

      {invalidDialogOpen && linePack && project && (
        <div className="ai-warning-backdrop">
          <div className="ai-warning-dialog" role="dialog" aria-modal="true" aria-labelledby="invalid-video-pack-title">
            <h3 id="invalid-video-pack-title">這不是符合 LINE Sticker 規則的 ZIP</h3>
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
