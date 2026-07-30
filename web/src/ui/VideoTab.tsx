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
import { Field, LogPane, PngPreview, Row, ValidationView, kb, useLogger } from './common.jsx';
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

  const [metadata, setMetadata] = useState<VideoMetadata | null>(null);
  const [previewPng, setPreviewPng] = useState<Uint8Array | null>(null);
  const [count, setCount] = useState(8);
  const [cols, setCols] = useState(4);
  const [rows, setRows] = useState(2);
  const [editableStartSec, setEditableStartSec] = useState(0);
  const [editableEndSec, setEditableEndSec] = useState(4);
  const [masterFrames, setMasterFrames] = useState(30);
  const [autoRemoveBackground, setAutoRemoveBackground] = useState(false);
  const [usePickColor, setUsePickColor] = useState(false);
  const [pickColor, setPickColor] = useState('#00ff00');
  const [name, setName] = useState('Video Animated Stickers');
  const [cover, setCover] = useState(1);
  const [project, setProject] = useState<VideoProjectState | null>(null);
  const [linePack, setLinePack] = useState<LinePackState | null>(null);
  const [busy, setBusy] = useState(false);
  const [renderIndex, setRenderIndex] = useState<number | null>(null);
  const [progress, setProgress] = useState('');

  useEffect(() => () => {
    abortRef.current?.abort();
    sourceRef.current?.dispose();
  }, []);

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
    setAutoRemoveBackground(false);
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
    try {
      logger.log(
        'step',
        `逐時間點解碼 ${timestampsMs.length} 格；每格同時裁成 ${count} 張，並每 10 格寫入 master APNG…`,
      );
      const master = await buildMasterApngSet({
        source,
        grid: gridPlan,
        timestampsMs,
        autoRemoveBackground,
        pickColor: usePickColor ? hexToRgb(pickColor) : null,
        chunkFrames: 10,
        signal: abort.signal,
        onProgress: (done, total) => setProgress(`建立 master：${done}/${total} 個來源時間點`),
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
            <Field label="單色色鍵去背">
              <input type="checkbox" checked={autoRemoveBackground} onChange={(event) => setAutoRemoveBackground(event.target.checked)} />
            </Field>
            {autoRemoveBackground && (
              <>
                <Field label="指定背景色">
                  <input type="checkbox" checked={usePickColor} onChange={(event) => setUsePickColor(event.target.checked)} />
                </Field>
                {usePickColor && <input type="color" value={pickColor} onChange={(event) => setPickColor(event.target.value)} />}
              </>
            )}
          </Row>
          <p className="tab-desc">
            單色色鍵預設關閉；它只適合主體完全不含背景色的素材。黑底影片若含黑髮、眼睛或文字描邊，請保持關閉。
          </p>
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
    </section>
  );
}
