import { useEffect, useMemo, useRef, useState } from 'react';
import { ANIMATED_SPEC } from '@core/spec.js';
import {
  planSampleTimestamps,
  planVideoGrid,
  type VideoGridPlan,
} from '@core/videoCrop.js';
import { validatePack } from '@core/validate.js';
import { decodeApngFrames } from '../webpipe/apng.js';
import { buildAnimatedMain, buildTab } from '../webpipe/mainTab.js';
import {
  buildMasterApngSet,
  type MasterApngSet,
} from '../webpipe/masterApng.js';
import { encodePng } from '../webpipe/png.js';
import {
  processMasterApngSticker,
  validateVideoStickerSettings,
  type VideoRenderSnapshot,
  type VideoStickerSettings,
} from '../webpipe/processMasterApngSticker.js';
import { buildPackZip, downloadBytes, safeName } from '../webpipe/zip.js';
import {
  buildVideoProjectZip,
  importVideoProjectZip,
} from '../webpipe/videoProjectZip.js';
import {
  openBrowserVideo,
  type BrowserVideoSource,
  type VideoMetadata,
} from '../webpipe/videoSource.js';
import {
  colabBirefnetEndpointHost,
} from '../webpipe/colabBirefnet.js';
import {
  createBackgroundRemovalJob,
  type BackgroundRemovalJob,
  type WebBackgroundRemovalMode,
} from '../webpipe/backgroundRemovalJob.js';
import { IMGLY_MEDIUM_MODEL_BYTES } from '../webpipe/removeBackground.js';
import {
  LOCAL_BIREFNET_MODEL_BYTES,
  LOCAL_BIREFNET_PARAMETER_COUNT,
} from '../webpipe/localBirefnetContract.js';
import { Field, LogPane, PngPreview, Row, ValidationView, kb, useLogger } from './common.jsx';
import { useColabBirefnetConnection } from './colabBirefnetConnection.jsx';
import { currentDeviceHint } from './deviceHints.js';
import { makeAnimation } from './defaults.js';

interface VideoProjectState {
  name: string;
  createdAt: string;
  cover: number;
  source: VideoMetadata;
  editableStartMs: number;
  editableEndMs: number;
  grid: VideoGridPlan;
  master: MasterApngSet;
  settings: VideoStickerSettings[];
  baseline: VideoRenderSnapshot[];
  current: VideoRenderSnapshot[];
}

interface LinePackState {
  zip: Uint8Array;
  main: Uint8Array;
  tab: Uint8Array;
  validation: ReturnType<typeof validatePack>;
}

type VideoBackgroundRemovalMode = WebBackgroundRemovalMode;
type ModelWarningMode = Extract<VideoBackgroundRemovalMode, 'imgly' | 'local-birefnet' | 'colab-birefnet'>;

const IMGLY_MODEL_MIB = Math.round(IMGLY_MEDIUM_MODEL_BYTES / 1024 / 1024);
const LOCAL_BIREFNET_MODEL_MIB = Math.round(LOCAL_BIREFNET_MODEL_BYTES / 1024 / 1024);
const LOCAL_BIREFNET_PARAMETERS_MILLION = LOCAL_BIREFNET_PARAMETER_COUNT / 1_000_000;

function seconds(ms: number): number {
  return Math.round(ms / 100) / 10;
}

function milliseconds(sec: number): number {
  return Math.round(sec * 1000);
}

function hexToRgb(hex: string): [number, number, number] | null {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) return null;
  const value = Number.parseInt(match[1]!, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function defaultSettings(startMs: number, endMs: number, masterFrames: number): VideoStickerSettings {
  return {
    startMs,
    endMs,
    targetFrames: Math.min(ANIMATED_SPEC.maxFrames, masterFrames),
    playbackSec: 2,
    loops: 1,
    maxColors: 0,
  };
}

function settingsEqual(a: VideoStickerSettings, b: VideoStickerSettings): boolean {
  return (
    a.startMs === b.startMs &&
    a.endMs === b.endMs &&
    a.targetFrames === b.targetFrames &&
    a.playbackSec === b.playbackSec &&
    a.loops === b.loops &&
    a.maxColors === b.maxColors
  );
}

function GridPreview(props: { png: Uint8Array; grid: VideoGridPlan }) {
  const { png, grid } = props;
  const url = useMemo(
    () => URL.createObjectURL(new Blob([png.buffer as ArrayBuffer], { type: 'image/png' })),
    [png],
  );
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return (
    <div className="video-grid-preview">
      <img src={url} alt="影片首格與裁切格線" />
      <svg viewBox={`0 0 ${grid.sourceWidth} ${grid.sourceHeight}`} aria-label="裁切格線">
        {grid.rects.map((rect) => (
          <g key={rect.id}>
            <rect x={rect.left} y={rect.top} width={rect.width} height={rect.height} />
            <text x={rect.left + 8} y={rect.top + 22}>{String(rect.index + 1).padStart(2, '0')}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function SettingsEditor(props: {
  project: VideoProjectState;
  busy: boolean;
  renderIndex: number | null;
  onChange: (index: number, value: VideoStickerSettings) => void;
  onRender: (index: number) => void;
  onReset: (index: number) => void;
}) {
  const { project, busy, renderIndex, onChange, onRender, onReset } = props;
  return (
    <div className="video-settings-list">
      {project.settings.map((settings, index) => {
        const saved = project.current[index]!;
        const dirty = !settingsEqual(settings, saved.settings);
        const errors = validateVideoStickerSettings(settings);
        return (
          <article className={`video-settings-card ${dirty ? 'dirty' : ''}`} key={index}>
            <div className="video-settings-head">
              <strong>{String(index + 1).padStart(2, '0')}.png</strong>
              <span>{dirty ? '尚未套用' : '已保存'}</span>
            </div>
            <Row>
              <Field label="開始秒">
                <input
                  type="number"
                  min={seconds(project.editableStartMs)}
                  max={seconds(project.editableEndMs)}
                  step={0.1}
                  value={seconds(settings.startMs)}
                  onChange={(event) => onChange(index, { ...settings, startMs: milliseconds(Number(event.target.value)) })}
                />
              </Field>
              <Field label="結束秒">
                <input
                  type="number"
                  min={seconds(project.editableStartMs)}
                  max={seconds(project.editableEndMs)}
                  step={0.1}
                  value={seconds(settings.endMs)}
                  onChange={(event) => onChange(index, { ...settings, endMs: milliseconds(Number(event.target.value)) })}
                />
              </Field>
              <Field label="目標格數">
                <input
                  type="number"
                  min={5}
                  max={20}
                  value={settings.targetFrames}
                  onChange={(event) => onChange(index, { ...settings, targetFrames: Number(event.target.value) })}
                />
              </Field>
              <Field label="單輪">
                <select
                  value={settings.playbackSec}
                  onChange={(event) =>
                    onChange(index, {
                      ...settings,
                      playbackSec: Number(event.target.value) as VideoStickerSettings['playbackSec'],
                    })
                  }
                >
                  {[1, 2, 3, 4].map((value) => (
                    <option key={value} value={value}>{value} 秒</option>
                  ))}
                </select>
              </Field>
              <Field label="循環">
                <select
                  value={settings.loops}
                  onChange={(event) =>
                    onChange(index, {
                      ...settings,
                      loops: Number(event.target.value) as VideoStickerSettings['loops'],
                    })
                  }
                >
                  {[1, 2, 3, 4].map((value) => (
                    <option key={value} value={value}>{value}</option>
                  ))}
                </select>
              </Field>
              <Field label="減色">
                <select
                  value={settings.maxColors}
                  onChange={(event) => onChange(index, { ...settings, maxColors: Number(event.target.value) })}
                >
                  <option value={0}>自動</option>
                  <option value={256}>256 色</option>
                  <option value={128}>128 色</option>
                  <option value={64}>64 色</option>
                </select>
              </Field>
            </Row>
            {errors.length > 0 && <div className="video-inline-error">{errors.join('；')}</div>}
            <div className="run-row">
              <button
                className="btn small primary"
                disabled={busy || errors.length > 0 || !dirty}
                onClick={() => onRender(index)}
              >
                {renderIndex === index ? '重編中…' : '套用這張'}
              </button>
              <button className="btn small" disabled={busy} onClick={() => onReset(index)}>回復原切版本</button>
              <span className="layout-status">
                master {saved.metrics.masterFramesInRange} 格 → 成品 {saved.metrics.outputFrames} 格，
                {kb(saved.metrics.bytes)}，單輪 {saved.metrics.perLoopDurationMs}ms
              </span>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function CompareGrid(props: { baseline: VideoRenderSnapshot[]; current: VideoRenderSnapshot[] }) {
  return (
    <div className="video-compare-grid">
      {props.current.map((current, index) => {
        const baseline = props.baseline[index]!;
        const changed = !settingsEqual(baseline.settings, current.settings);
        return (
          <article className="video-compare-card" key={index}>
            <h4>{String(index + 1).padStart(2, '0')}.png {changed ? '（已調整）' : ''}</h4>
            <div className="video-compare-pair">
              <PngPreview bytes={baseline.png} caption={`原切 ${baseline.metrics.outputFrames}格 ${kb(baseline.png.length)}`} />
              <PngPreview bytes={current.png} caption={`目前 ${current.metrics.outputFrames}格 ${kb(current.png.length)}`} />
            </div>
            <details>
              <summary>詳細數據</summary>
              <div className="video-metrics">
                來源時間：{seconds(current.settings.startMs)}–{seconds(current.settings.endMs)} 秒<br />
                master 範圍格數：{current.metrics.masterFramesInRange}<br />
                輸出格數：{current.metrics.outputFrames}（丟棄 {current.metrics.droppedFrames}）<br />
                不同畫格：{current.metrics.distinctFrames}；透明 pixels：{current.metrics.transparentPixels}；
                前景 pixels：{current.metrics.foregroundPixels}<br />
                delays：{current.metrics.frameDelaysMs.join(', ')} ms<br />
                timestamps：{current.metrics.selectedTimestampsMs.map((time) => seconds(time)).join(', ')} 秒
              </div>
            </details>
            <button
              className="btn small"
              onClick={() => downloadBytes(`${String(index + 1).padStart(2, '0')}.png`, current.png, 'image/png')}
            >
              下載這張
            </button>
          </article>
        );
      })}
    </div>
  );
}

export function VideoTab() {
  const videoInput = useRef<HTMLInputElement>(null);
  const projectInput = useRef<HTMLInputElement>(null);
  const sourceRef = useRef<BrowserVideoSource | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const logger = useLogger();
  const {
    connection: colabBirefnetConnection,
    registerActiveRemoval,
  } = useColabBirefnetConnection();
  const [metadata, setMetadata] = useState<VideoMetadata | null>(null);
  const [previewPng, setPreviewPng] = useState<Uint8Array | null>(null);
  const [count, setCount] = useState(8);
  const [cols, setCols] = useState(4);
  const [rows, setRows] = useState(2);
  const [editableStartSec, setEditableStartSec] = useState(0);
  const [editableEndSec, setEditableEndSec] = useState(4);
  const [masterFrames, setMasterFrames] = useState<number>(ANIMATED_SPEC.maxFrames);
  const [backgroundRemovalMode, setBackgroundRemovalMode] = useState<VideoBackgroundRemovalMode>('none');
  const [usePickColor, setUsePickColor] = useState(false);
  const [pickColor, setPickColor] = useState('#00ff00');
  const [name, setName] = useState('Video Animated Stickers');
  const [cover, setCover] = useState(1);
  const [project, setProject] = useState<VideoProjectState | null>(null);
  const [linePack, setLinePack] = useState<LinePackState | null>(null);
  const [busy, setBusy] = useState(false);
  const [renderIndex, setRenderIndex] = useState<number | null>(null);
  const [progress, setProgress] = useState('');
  const [aiWarningOpen, setAiWarningOpen] = useState(false);
  const [aiWarningMode, setAiWarningMode] = useState<ModelWarningMode>('local-birefnet');
  const aiWarningTriggerRef = useRef<HTMLButtonElement>(null);
  const aiWarningDialogRef = useRef<HTMLDivElement>(null);
  const aiWarningCloseRef = useRef<HTMLButtonElement>(null);
  const mobileOrTablet = useMemo(() => currentDeviceHint() !== 'unknown', []);
  useEffect(() => () => {
    abortRef.current?.abort();
    sourceRef.current?.dispose();
  }, []);

  useEffect(() => {
    if (!aiWarningOpen) return;
    const dialog = aiWarningDialogRef.current;
    const focusFrame = window.requestAnimationFrame(() => aiWarningCloseRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setAiWarningOpen(false);
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ));
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
      if (event.shiftKey && currentIndex <= 0) {
        event.preventDefault();
        focusable[focusable.length - 1]!.focus();
      } else if (!event.shiftKey && currentIndex === focusable.length - 1) {
        event.preventDefault();
        focusable[0]!.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', handleKeyDown);
      aiWarningTriggerRef.current?.focus();
    };
  }, [aiWarningOpen]);

  const gridPlan = useMemo(() => {
    if (!metadata) return null;
    try {
      return planVideoGrid({ sourceWidth: metadata.width, sourceHeight: metadata.height, cols, rows, count });
    } catch {
      return null;
    }
  }, [metadata, cols, rows, count]);

  async function loadVideo(file: File) {
    logger.clear();
    setBusy(true);
    setProject(null);
    setLinePack(null);
    setPreviewPng(null);
    setBackgroundRemovalMode('none');
    setUsePickColor(false);
    sourceRef.current?.dispose();
    sourceRef.current = null;
    const abort = new AbortController();
    abortRef.current = abort;
    try {
      logger.log('step', `開啟影片 ${file.name}…`);
      const source = await openBrowserVideo(file, abort.signal);
      sourceRef.current = source;
      const frame = await source.frameAt(0, abort.signal);
      setMetadata(source.metadata);
      setPreviewPng(encodePng(frame));
      setEditableStartSec(0);
      setEditableEndSec(seconds(source.metadata.durationMs));
      logger.log(
        'ok',
        `${source.metadata.width}×${source.metadata.height}，${seconds(source.metadata.durationMs)} 秒；影片只在本機瀏覽器解碼`,
      );
    } catch (error) {
      logger.log('err', error instanceof Error ? error.message : String(error));
    } finally {
      if (abortRef.current === abort) abortRef.current = null;
      setBusy(false);
      setProgress('');
    }
  }

  async function buildMaster() {
    const source = sourceRef.current;
    if (!source || !metadata || !gridPlan) {
      logger.log('err', '請先上傳可解碼的影片並設定有效網格');
      return;
    }
    const colabConfig = backgroundRemovalMode === 'colab-birefnet'
      ? colabBirefnetConnection?.config
      : null;
    if (backgroundRemovalMode === 'colab-birefnet' && !colabConfig) {
      logger.log('err', 'Colab BiRefNet 尚未設定；請先開啟「Colab + BiRefNet 教學」並貼入目前 runtime 的 endpoint 與 session key');
      return;
    }
    const startMs = milliseconds(editableStartSec);
    const endMs = Math.min(metadata.durationMs, milliseconds(editableEndSec));
    let timestampsMs: number[];
    try {
      timestampsMs = planSampleTimestamps(startMs, endMs, masterFrames);
    } catch (error) {
      logger.log('err', error instanceof Error ? error.message : String(error));
      return;
    }
    if (timestampsMs.length < 5) {
      logger.log('err', '可編輯時間窗至少要能建立 5 個不同毫秒時間點');
      return;
    }

    logger.clear();
    setBusy(true);
    setLinePack(null);
    const abort = new AbortController();
    abortRef.current = abort;
    const unregisterActiveRemoval = colabConfig ? registerActiveRemoval(abort) : null;
    let removalJob: BackgroundRemovalJob | null = null;
    try {
      const semanticMode = backgroundRemovalMode === 'imgly'
        || backgroundRemovalMode === 'local-birefnet'
        || backgroundRemovalMode === 'colab-birefnet';
      if (semanticMode) {
        removalJob = await createBackgroundRemovalJob({
          mode: backgroundRemovalMode,
          signal: abort.signal,
          colabConfig,
          onStatus: (status) => setProgress(status ?? ''),
        });
      }
      const removalLabel = removalJob?.label ?? null;
      logger.log(
        'step',
        removalLabel
          ? `逐時間點解碼 ${timestampsMs.length} 格；每格裁成 ${count} 張後，依序交給${removalLabel}（共 ${timestampsMs.length * count} 個 crop）…`
          : `逐時間點解碼 ${timestampsMs.length} 格；每格同時裁成 ${count} 張，並每 10 格寫入 master APNG…`,
      );
      const master = await buildMasterApngSet({
        source,
        grid: gridPlan,
        timestampsMs,
        autoRemoveBackground: backgroundRemovalMode === 'color-key',
        pickColor: backgroundRemovalMode === 'color-key' && usePickColor ? hexToRgb(pickColor) : null,
        removeCropBackground: removalJob?.remove,
        chunkFrames: 10,
        signal: abort.signal,
        onProgress: (done, total) => setProgress(
          removalLabel
            ? `${removalLabel}：${done * count}/${total * count} 個裁切格完成`
            : `建立 master：${done}/${total} 個來源時間點`,
        ),
        onRemovalProgress: removalLabel
          ? (done, total) => setProgress(`${removalLabel}：${done}/${total} 個裁切格完成`)
          : undefined,
      });
      const baseSettings = master.stickers.map(() => defaultSettings(startMs, endMs, timestampsMs.length));
      const baseline: VideoRenderSnapshot[] = [];
      for (let index = 0; index < master.stickers.length; index++) {
        setProgress(`建立原切版本：${index + 1}/${master.stickers.length}`);
        baseline.push(await processMasterApngSticker(master.stickers[index]!, baseSettings[index]!));
      }
      const createdAt = new Date().toISOString();
      setProject({
        name,
        createdAt,
        cover,
        source: metadata,
        editableStartMs: startMs,
        editableEndMs: endMs,
        grid: gridPlan,
        master,
        settings: baseSettings,
        baseline,
        current: baseline.map((snapshot) => ({
          ...snapshot,
          png: snapshot.png.slice(),
          settings: { ...snapshot.settings },
          metrics: {
            ...snapshot.metrics,
            selectedTimestampsMs: [...snapshot.metrics.selectedTimestampsMs],
            frameDelaysMs: [...snapshot.metrics.frameDelaysMs],
          },
          notes: [...snapshot.notes],
        })),
      });
      logger.log('ok', `master 與 ${count} 張原切 APNG 已完成；後續調整不再讀影片`);
      source.dispose();
      sourceRef.current = null;
    } catch (error) {
      logger.log('err', error instanceof Error ? error.message : String(error));
    } finally {
      if (removalJob) {
        try {
          await removalJob.dispose();
        } catch (error) {
          logger.log('err', `釋放去背模型失敗：${error instanceof Error ? error.message : String(error)}`);
        }
      }
      unregisterActiveRemoval?.();
      if (abortRef.current === abort) abortRef.current = null;
      setBusy(false);
      setProgress('');
    }
  }

  async function rerenderOne(index: number) {
    if (!project) return;
    setBusy(true);
    setRenderIndex(index);
    setLinePack(null);
    try {
      const snapshot = await processMasterApngSticker(project.master.stickers[index]!, project.settings[index]!);
      setProject((previous) => {
        if (!previous) return previous;
        const current = [...previous.current];
        current[index] = snapshot;
        return { ...previous, current };
      });
      logger.log('ok', `第 ${index + 1} 張已從 master APNG 重編，不需原影片`);
    } catch (error) {
      logger.log('err', error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
      setRenderIndex(null);
    }
  }

  async function rerenderAll() {
    if (!project) return;
    setBusy(true);
    setLinePack(null);
    try {
      const next = [...project.current];
      for (let index = 0; index < project.settings.length; index++) {
        const errors = validateVideoStickerSettings(project.settings[index]!);
        if (errors.length > 0) throw new Error(`第 ${index + 1} 張：${errors.join('；')}`);
        setProgress(`套用全部調整：${index + 1}/${project.settings.length}`);
        next[index] = await processMasterApngSticker(project.master.stickers[index]!, project.settings[index]!);
      }
      setProject({ ...project, current: next });
      logger.log('ok', '全部調整已套用');
    } catch (error) {
      logger.log('err', error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
      setProgress('');
    }
  }

  function resetOne(index: number) {
    setLinePack(null);
    setProject((previous) => {
      if (!previous) return previous;
      const settings = [...previous.settings];
      const current = [...previous.current];
      settings[index] = { ...previous.baseline[index]!.settings };
      current[index] = previous.baseline[index]!;
      return { ...previous, settings, current };
    });
  }

  async function makeLinePack() {
    if (!project) return;
    if (project.settings.some((settings, index) => !settingsEqual(settings, project.current[index]!.settings))) {
      logger.log('err', '仍有尚未套用的調整，請先「套用全部調整」');
      return;
    }
    setBusy(true);
    try {
      const coverIndex = Math.min(Math.max(1, project.cover), project.current.length) - 1;
      const coverSnapshot = project.current[coverIndex]!;
      const decoded = decodeApngFrames(coverSnapshot.png);
      const animation = makeAnimation({
        loops: coverSnapshot.settings.loops,
        durationSec: coverSnapshot.settings.playbackSec,
        stabilize: false,
        maxColors: coverSnapshot.settings.maxColors,
      });
      const { main, mainInfo } = buildAnimatedMain(decoded.frames, animation);
      const { tab, tabInfo } = buildTab(decoded.frames[0]!);
      const built = buildPackZip({
        main,
        tab,
        stickers: project.current.map((snapshot) => snapshot.png),
      });
      const validation = validatePack({
        kind: 'animated',
        count: project.current.length,
        stickers: project.current.map((snapshot) => snapshot.info),
        main: mainInfo,
        tab: tabInfo,
        zipBytes: built.zipBytes,
      });
      setLinePack({ zip: built.zip, main, tab, validation });
      logger.log(validation.ok ? 'ok' : 'err', validation.ok ? `LINE ZIP 已完成（${kb(built.zipBytes)}）` : 'LINE ZIP 驗證失敗，已停用上架包下載');
    } catch (error) {
      logger.log('err', error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  function downloadProject() {
    if (!project) return;
    const built = buildVideoProjectZip({
      name: project.name,
      createdAt: project.createdAt,
      cover: project.cover,
      source: project.source,
      editableStartMs: project.editableStartMs,
      editableEndMs: project.editableEndMs,
      grid: project.grid,
      master: project.master,
      settings: project.settings,
      baseline: project.baseline,
      current: project.current,
    });
    downloadBytes(`${safeName(project.name)}.video-apng-project.zip`, built.zip, 'application/zip');
  }

  async function loadProject(file: File) {
    logger.clear();
    setBusy(true);
    sourceRef.current?.dispose();
    sourceRef.current = null;
    abortRef.current?.abort();
    try {
      const imported = importVideoProjectZip(new Uint8Array(await file.arrayBuffer()));
      const manifest = imported.manifest;
      setMetadata(manifest.source);
      setPreviewPng(null);
      setCount(manifest.grid.count);
      setCols(manifest.grid.cols);
      setRows(manifest.grid.rows);
      setEditableStartSec(seconds(manifest.source.editableStartMs));
      setEditableEndSec(seconds(manifest.source.editableEndMs));
      setMasterFrames(manifest.master.masterFrameCount);
      setName(manifest.name);
      setCover(manifest.cover);
      setProject({
        name: manifest.name,
        createdAt: manifest.createdAt,
        cover: manifest.cover,
        source: manifest.source,
        editableStartMs: manifest.source.editableStartMs,
        editableEndMs: manifest.source.editableEndMs,
        grid: manifest.grid,
        master: imported.master,
        settings: manifest.settings.map((settings) => ({ ...settings })),
        baseline: imported.baseline,
        current: imported.current,
      });
      setLinePack(null);
      logger.log('ok', `已恢復 ${manifest.name}：直接顯示已調整版本，未啟動影片 decoder`);
    } catch (error) {
      logger.log('err', error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  const dirtyCount = project
    ? project.settings.filter((settings, index) => !settingsEqual(settings, project.current[index]!.settings)).length
    : 0;
  const birefnetInferenceEstimate = Number.isInteger(masterFrames) && Number.isInteger(count)
    && masterFrames > 0 && count > 0
    ? masterFrames * count
    : null;

  return (
    <section>
      <p className="tab-desc">
        獨立流程：影片只用來建立分段 master APNG；完成後釋放影片，時間、格數與壓縮調整都只從 master APNG
        解碼再編碼。來源音軌不使用；Project ZIP 不含原影片。
      </p>
      <div className="video-source-actions">
        <input
          ref={videoInput}
          type="file"
          accept="video/*,.mp4,.mov,.m4v,.webm"
          hidden
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file) void loadVideo(file);
            event.currentTarget.value = '';
          }}
        />
        <input
          ref={projectInput}
          type="file"
          accept=".zip,application/zip"
          hidden
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file) void loadProject(file);
            event.currentTarget.value = '';
          }}
        />
        <button className="btn primary" disabled={busy} onClick={() => videoInput.current?.click()}>上傳影片</button>
        <button className="btn" disabled={busy} onClick={() => projectInput.current?.click()}>上傳可調整 Project ZIP</button>
      </div>

      {metadata && !project && (
        <div className="video-source-card">
          <h3>1. 建立可編輯 master APNG</h3>
          <p className="tab-desc">
            {metadata.fileName} · {metadata.width}×{metadata.height} · {seconds(metadata.durationMs)} 秒。
            瀏覽器會依下列時間點逐格擷取；不是估算影片原生 FPS，也不會默默降低你設定的 master 格數。
            來源格數只控制裁切與 Project，可少於 8；LINE ZIP 仍只接受 8、16 或 24 張。
          </p>
          <Row>
            <Field label="來源貼圖格數">
              <input
                type="number"
                min={1}
                max={cols * rows}
                value={count}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  setCount(value);
                  if (Number.isInteger(value) && value > 0) {
                    setCover(Math.min(Math.max(1, cover), value));
                  }
                }}
              />
            </Field>
            <Field label="欄">
              <input type="number" min={1} max={12} value={cols} onChange={(event) => setCols(Number(event.target.value))} />
            </Field>
            <Field label="列">
              <input type="number" min={1} max={12} value={rows} onChange={(event) => setRows(Number(event.target.value))} />
            </Field>
            <Field label="可編輯開始秒">
              <input type="number" min={0} max={seconds(metadata.durationMs)} step={0.1} value={editableStartSec} onChange={(event) => setEditableStartSec(Number(event.target.value))} />
            </Field>
            <Field label="可編輯結束秒">
              <input type="number" min={0} max={seconds(metadata.durationMs)} step={0.1} value={editableEndSec} onChange={(event) => setEditableEndSec(Number(event.target.value))} />
            </Field>
            <Field label="master 取樣格數">
              <select value={masterFrames} onChange={(event) => setMasterFrames(Number(event.target.value))}>
                {[10, 20, 30, 40, 60].map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </Field>
          </Row>
          <Row>
            <Field label="貼圖包名">
              <input value={name} onChange={(event) => setName(event.target.value)} />
            </Field>
            <Field label="封面第幾張">
              <input type="number" min={1} max={count} value={cover} onChange={(event) => setCover(Number(event.target.value))} />
            </Field>
            <Field label="去背方式">
              <select
                value={backgroundRemovalMode}
                aria-describedby={backgroundRemovalMode === 'local-birefnet'
                  ? 'local-birefnet-notice'
                  : backgroundRemovalMode === 'imgly'
                    ? 'imgly-notice'
                    : undefined}
                onChange={(event) => {
                  const next = event.target.value as VideoBackgroundRemovalMode;
                  if (next === 'imgly' || next === 'local-birefnet' || next === 'colab-birefnet') {
                    setAiWarningMode(next);
                    setAiWarningOpen(true);
                    return;
                  }
                  setBackgroundRemovalMode(next);
                  if (next !== 'color-key') setUsePickColor(false);
                }}
              >
                <option value="none">不去背</option>
                <option value="color-key">單色色鍵</option>
                <option value="imgly">IMG.LY（本機瀏覽器）</option>
                <option value="local-birefnet">本機 BiRefNet（實驗性）</option>
                <option value="colab-birefnet">Colab BiRefNet（實驗性，臨時 session）</option>
              </select>
            </Field>
            {backgroundRemovalMode === 'color-key' && (
              <>
                <Field label="指定背景色">
                  <input type="checkbox" checked={usePickColor} onChange={(event) => setUsePickColor(event.target.checked)} />
                </Field>
                {usePickColor && <input type="color" value={pickColor} onChange={(event) => setPickColor(event.target.value)} />}
              </>
            )}
            <button
              ref={aiWarningTriggerRef}
              type="button"
              className="btn small"
              disabled={busy}
              aria-haspopup="dialog"
              aria-expanded={aiWarningOpen}
              onClick={() => {
                setAiWarningMode(
                  backgroundRemovalMode === 'imgly'
                    ? 'imgly'
                    : backgroundRemovalMode === 'local-birefnet'
                      ? 'local-birefnet'
                      : 'colab-birefnet',
                );
                setAiWarningOpen(true);
              }}
            >
              {backgroundRemovalMode === 'imgly'
                ? 'IMG.LY 說明'
                : backgroundRemovalMode === 'local-birefnet'
                ? '本機 BiRefNet 說明'
                : backgroundRemovalMode === 'colab-birefnet'
                  ? 'Colab 去背設定'
                  : 'BiRefNet 說明'}
            </button>
            {backgroundRemovalMode === 'colab-birefnet' && colabBirefnetConnection && (
              <span className="ai-warning-option-status">
                已啟用：{colabBirefnetEndpointHost(colabBirefnetConnection.config.endpointUrl)}
              </span>
            )}
          </Row>
          <p className="tab-desc">
            單色色鍵預設關閉；它只適合主體完全不含背景色的素材。黑底影片若含黑髮、眼睛或文字描邊，請保持關閉。
            IMG.LY、本機 BiRefNet 與 Colab BiRefNet 都只在你明確確認後啟用，並逐張處理裁切格；IMG.LY 沒有 Colab 模式。
          </p>
          {backgroundRemovalMode === 'imgly' && (
            <div id="imgly-notice" className="ai-local-notice" role="status" aria-live="polite">
              <strong>IMG.LY：</strong>首次開始時下載約 {IMGLY_MODEL_MIB} MiB medium 模型，另需 WASM runtime，
              並依序推論約 {birefnetInferenceEstimate ?? '設定完成後計算'} 個 crop。影像不會上傳；桌面實測 8 張約 116 秒，
              但裝置差異很大。行動裝置可能耗電、記憶體不足或跑不完。
              {mobileOrTablet && <> 目前裝置看起來是行動裝置，建議改用桌面 Chrome／Edge。</>}
            </div>
          )}
          {backgroundRemovalMode === 'local-birefnet' && (
            <div id="local-birefnet-notice" className="ai-local-notice" role="status" aria-live="polite">
              <strong>本機 BiRefNet：</strong>首次開始時下載約 {LOCAL_BIREFNET_MODEL_MIB} MiB 的 fp16 模型
              （{LOCAL_BIREFNET_PARAMETERS_MILLION}M 是參數數量，不是檔案 MB），並快取在這個瀏覽器。
              影像不會上傳；目前設定需依序推論約 {birefnetInferenceEstimate ?? '設定完成後計算'} 個 crop，可能跑很久。
              行動裝置可能非常耗電、因記憶體不足停止，甚至跑不完。
              {mobileOrTablet && <> 目前裝置看起來是行動裝置，建議改用桌面 Chrome／Edge，但不會禁止你嘗試。</>}
            </div>
          )}
          {!gridPlan && <div className="video-inline-error">網格容量不足、數值無效，或網格大於影片尺寸。</div>}
          {previewPng && gridPlan && <GridPreview png={previewPng} grid={gridPlan} />}
          <div className="run-row">
            <button className="btn primary" disabled={busy || !gridPlan} onClick={() => void buildMaster()}>
              {busy ? '處理中…' : '切影片並建立 master / 原切版本'}
            </button>
            {busy && <button className="btn" onClick={() => abortRef.current?.abort()}>取消</button>}
            {progress && <span className="model-status">{progress}</span>}
          </div>
        </div>
      )}

      <LogPane lines={logger.lines} />

      {project && (
        <>
          <div className="video-project-summary">
            <h3>2. APNG 調整模式</h3>
            <p className="tab-desc">
              {project.name} · {project.master.masterFrameCount} 個 master 時間點 ·
              {project.master.stickers.reduce((sum, sticker) => sum + sticker.chunks.length, 0)} 個 chunks ·
              可調範圍 {seconds(project.editableStartMs)}–{seconds(project.editableEndMs)} 秒。
              {dirtyCount > 0 ? ` 尚有 ${dirtyCount} 張未套用。` : ' 所有設定已保存。'}
            </p>
            <Row>
              <Field label="貼圖包名">
                <input
                  value={project.name}
                  onChange={(event) => setProject({ ...project, name: event.target.value })}
                />
              </Field>
              <Field label="封面第幾張">
                <input
                  type="number"
                  min={1}
                  max={project.current.length}
                  value={project.cover}
                  onChange={(event) => setProject({ ...project, cover: Number(event.target.value) })}
                />
              </Field>
            </Row>
          </div>
          <SettingsEditor
            project={project}
            busy={busy}
            renderIndex={renderIndex}
            onChange={(index, value) =>
              setProject((previous) => {
                if (!previous) return previous;
                const settings = [...previous.settings];
                settings[index] = value;
                return { ...previous, settings };
              })
            }
            onRender={(index) => void rerenderOne(index)}
            onReset={resetOne}
          />
          <div className="run-row">
            <button className="btn primary" disabled={busy || dirtyCount === 0} onClick={() => void rerenderAll()}>
              套用全部調整
            </button>
            <button className="btn" disabled={busy} onClick={downloadProject}>下載可再調整 Project ZIP</button>
            <button className="btn" disabled={busy || dirtyCount > 0} onClick={() => void makeLinePack()}>建立 LINE 上架包</button>
            {progress && <span className="model-status">{progress}</span>}
          </div>
          {linePack && (
            <div className="pack-result">
              <ValidationView result={linePack.validation} />
              <div className="pack-actions">
                <button
                  className="btn primary"
                  disabled={!linePack.validation.ok}
                  onClick={() => downloadBytes(`${safeName(project.name)}.zip`, linePack.zip, 'application/zip')}
                >
                  下載 LINE ZIP（{kb(linePack.zip.length)}）
                </button>
                <button className="btn" onClick={() => downloadBytes('main.png', linePack.main, 'image/png')}>main.png</button>
                <button className="btn" onClick={() => downloadBytes('tab.png', linePack.tab, 'image/png')}>tab.png</button>
              </div>
            </div>
          )}
          <h3>3. 原切版本 / 目前版本</h3>
          <CompareGrid baseline={project.baseline} current={project.current} />
        </>
      )}
      {aiWarningOpen && (
        <div
          className="ai-warning-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setAiWarningOpen(false);
          }}
        >
          <div
            ref={aiWarningDialogRef}
            className="ai-warning-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="birefnet-warning-title"
            aria-describedby="birefnet-warning-description"
          >
            <h3 id="birefnet-warning-title">
              {aiWarningMode === 'imgly'
                ? '在這台裝置執行 IMG.LY 去背？'
                : aiWarningMode === 'local-birefnet'
                  ? '在這台裝置執行實驗性 BiRefNet？'
                  : '啟用實驗性 Colab BiRefNet 去背？'}
            </h3>
            <div id="birefnet-warning-description">
              {aiWarningMode === 'imgly' ? (
                <>
                  <p>
                    IMG.LY 只在瀏覽器本機執行，不會上傳，也沒有 Colab 模式。首次開始時下載約
                    {' '}{IMGLY_MODEL_MIB} MiB medium 模型，另需 WASM runtime，之後由瀏覽器快取。
                  </p>
                  {birefnetInferenceEstimate !== null && (
                    <p className="ai-warning-mobile">
                      依目前設定，這次要依序執行約 <strong>{birefnetInferenceEstimate}</strong> 次推論
                      （{masterFrames} 個時間點 × {count} 個裁切格）。桌面實測 8 張約 116 秒；裝置差異很大，
                      這個數字不能當完成時間保證。
                    </p>
                  )}
                  <p className="ai-warning-mobile">
                    手機或平板可能非常耗電、因記憶體不足停止，甚至跑不完。建議使用桌面 Chrome／Edge；
                    這是風險提示，不會封鎖你繼續。
                  </p>
                </>
              ) : aiWarningMode === 'local-birefnet' ? (
                <>
                  <p>
                    首次開始時會從固定版本的 Hugging Face 模型庫下載約 {LOCAL_BIREFNET_MODEL_MIB} MiB
                    的 fp16 ONNX 模型，並由瀏覽器快取。44.4M 指模型參數數量，不是 44 MB 下載檔。
                  </p>
                  <p>
                    模型在 Web Worker 內逐一處理已裁切的 crop；影像、影片、音訊與 Project ZIP
                    都不會上傳。可用時優先跑 WebGPU，否則會嘗試較慢的 WASM。
                  </p>
                  {birefnetInferenceEstimate !== null && (
                    <p className="ai-warning-mobile">
                      依目前設定，這次要依序執行約 <strong>{birefnetInferenceEstimate}</strong> 次本機推論
                      （{masterFrames} 個時間點 × {count} 個裁切格）。沒有可靠的跨裝置分鐘數可預估，可能需要等很久。
                    </p>
                  )}
                  <p className="ai-warning-mobile">
                    手機或平板可能非常耗電、因記憶體不足停止，甚至跑不完。建議使用桌面 Chrome／Edge；
                    這是風險提示，不會封鎖你繼續。
                  </p>
                </>
              ) : (
                <>
                  <p>
                    你必須先開啟自己的 Google Colab runtime，在
                    <a href="#/colab-birefnet" onClick={() => setAiWarningOpen(false)}> Colab + BiRefNet 教學</a>
                    跑完 astronaut benchmark；只有結果與速度可接受時，才啟動臨時 API 並貼回連線資料。
                  </p>
                  <p>
                    啟用後，瀏覽器會先本機解碼影片，再依序將每張已裁切 PNG 透過 HTTPS 送到
                    {colabBirefnetConnection
                      ? ` ${colabBirefnetEndpointHost(colabBirefnetConnection.config.endpointUrl)}`
                      : ' 你的臨時 Colab endpoint'}。
                    原始影片、完整來源 frame、音訊與 Project ZIP 都不會上傳。
                  </p>
                  {birefnetInferenceEstimate !== null && (
                    <p className="ai-warning-mobile">
                      依目前設定，這次會發出約 <strong>{birefnetInferenceEstimate}</strong> 次去背請求
                      （{masterFrames} 個時間點 × {count} 個裁切格）。估計純推論時間約是 Notebook
                      顯示的每 crop 秒數乘以這個數字。
                    </p>
                  )}
                  <p className="ai-warning-mobile">
                    免費 Colab runtime 與 Quick Tunnel 都可能中斷，沒有 SLA，也不是永久 endpoint。
                    請先用 1 個裁切格與 10 個時間點完成 smoke test。
                  </p>
                  {mobileOrTablet && (
                    <p className="ai-warning-mobile">
                      行動裝置仍要本機解碼影片、逐格壓縮與上傳，可能很久、耗電或因記憶體不足停止。
                      建議先用桌面版 Chrome／Edge。
                    </p>
                  )}
                  <p>
                    Endpoint 與 session key 只存在這次頁面的 React 記憶體；不會寫入 URL、storage、
                    cookie、Project ZIP、下載檔或處理記錄。重新整理或 runtime 重啟後要重新輸入。
                  </p>
                </>
              )}
            </div>
            <div className="ai-warning-actions">
              {aiWarningMode === 'imgly' && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setBackgroundRemovalMode('imgly');
                    setUsePickColor(false);
                    setAiWarningOpen(false);
                  }}
                >
                  我了解，使用 IMG.LY
                </button>
              )}
              {aiWarningMode === 'local-birefnet' && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setBackgroundRemovalMode('local-birefnet');
                    setUsePickColor(false);
                    setAiWarningOpen(false);
                  }}
                >
                  我了解，使用本機去背
                </button>
              )}
              {aiWarningMode === 'colab-birefnet' && colabBirefnetConnection && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setBackgroundRemovalMode('colab-birefnet');
                    setUsePickColor(false);
                    setAiWarningOpen(false);
                  }}
                >
                  我已測速，啟用去背
                </button>
              )}
              <button
                ref={aiWarningCloseRef}
                type="button"
                className="btn primary"
                onClick={() => setAiWarningOpen(false)}
              >
                {aiWarningMode === 'imgly' || aiWarningMode === 'local-birefnet' || colabBirefnetConnection
                  ? '取消'
                  : '知道了'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
