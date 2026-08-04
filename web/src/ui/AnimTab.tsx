/**
 * 動態貼圖（APNG）——同一分頁內的三種模式：
 *   單組圖：一張 frames-sheet 切格 → 穩定化 → fit → 一段 Sticker／Emoji APNG。
 *   整包：每個項目一組連續影格 → 動態貼圖或 Animated Regular Emoji 上架包。
 *   全螢幕貼圖整包：獨立靜態貼圖 + 每張 Pop-up APNG 影格 → 雙軌 ZIP。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { ANIMATED_EMOJI_SPEC, ANIMATED_SPEC, allowedCounts, maxBounds } from '@core/spec.js';
import { emojiFileName, stickerFileName } from '@core/naming.js';
import { parseColor } from '@core/color.js';
import {
  validateAnimatedEmojiImage,
  validateAnimatedImage,
  validateCount,
  validateEmojiPack,
  validatePack,
} from '@core/validate.js';
import { decodeBlob, yieldToUI, type Raster } from '../webpipe/raster.js';
import {
  createBackgroundRemovalJob,
  type BackgroundRemovalJob,
  type WebBackgroundRemovalMode,
} from '../webpipe/backgroundRemovalJob.js';
import { removeSheetBackgroundByCells } from '../webpipe/sheetBackgroundRemoval.js';
import { cutSheet } from '../webpipe/sheetAnalysis.js';
import { setApngNumPlays } from '../webpipe/apng.js';
import { processAnimated, type ProcessedAnimated } from '../webpipe/processAnimated.js';
import { buildAnimatedMain, buildTab } from '../webpipe/mainTab.js';
import { buildEmojiPackZip } from '../webpipe/emojiZip.js';
import { buildPackZip, downloadBytes, safeName } from '../webpipe/zip.js';
import { Field, FilePick, LogPane, PngPreview, Row, ValidationView, kb, sortFiles, useLogger } from './common.jsx';
import { PackResult, type PackResultData } from './packResult.jsx';
import { DEFAULT_TEXT_STYLE, makeAnimation, makeStroke, makeText, parseGridText, type SharedTextStyle } from './defaults.js';
import { ManualLayout } from './ManualLayout.jsx';
import { reportCut } from './cutReport.js';
import { BackgroundRemovalControl } from './BackgroundRemovalControl.jsx';
import { useColabBirefnetConnection } from './colabBirefnetConnection.jsx';
import type { ValidationResult } from '@core/types.js';
import { PopupPackMode } from './PopupPackMode.jsx';

type Mode = 'sheet' | 'pack' | 'popup';
type AnimatedTarget = 'animated' | 'animated-emoji';

const EMOJI_MARGIN_PX = 4;
const ANIMATED_EMOJI_LIMITS = {
  minFrames: ANIMATED_EMOJI_SPEC.minFrames,
  maxFrames: ANIMATED_EMOJI_SPEC.maxFrames,
  maxDurationSec: ANIMATED_EMOJI_SPEC.maxDurationSec,
  playbackDurationsSec: ANIMATED_EMOJI_SPEC.playbackDurationsSec,
  label: 'Animated Regular Emoji',
} as const;

function assertAnimatedEmojiFrameCount(frameCount: number): void {
  if (
    !Number.isInteger(frameCount)
    || frameCount < ANIMATED_EMOJI_SPEC.minFrames
    || frameCount > ANIMATED_EMOJI_SPEC.maxFrames
  ) {
    throw new RangeError(
      `Animated Regular Emoji 影格數須為 ${ANIMATED_EMOJI_SPEC.minFrames}–${ANIMATED_EMOJI_SPEC.maxFrames}，收到 ${frameCount}；不會自動抽格`,
    );
  }
}

export function AnimTab() {
  const [mode, setMode] = useState<Mode>('sheet');
  return (
    <section>
      <div className="mode-switch">
        <label data-testid="anim-mode-sheet">
          <input type="radio" checked={mode === 'sheet'} onChange={() => setMode('sheet')} />
          單張組圖 → 一段動畫
        </label>
        <label data-testid="anim-mode-pack">
          <input type="radio" checked={mode === 'pack'} onChange={() => setMode('pack')} />
          整包（每個項目一組影格）
        </label>
        <label data-testid="anim-mode-popup">
          <input
            type="radio"
            aria-label="全螢幕貼圖整包"
            checked={mode === 'popup'}
            onChange={() => setMode('popup')}
          />
          全螢幕貼圖整包
        </label>
      </div>
      {mode === 'sheet' ? <SheetMode /> : mode === 'pack' ? <PackMode /> : <PopupPackMode />}
    </section>
  );
}

// ---------- 單組圖模式 ----------

function SheetMode() {
  const [target, setTarget] = useState<AnimatedTarget>('animated');
  const [sheet, setSheet] = useState<File[]>([]);
  const [gridText, setGridText] = useState('4x4');
  const [framesN, setFramesN] = useState<string>('');
  const [duration, setDuration] = useState(2);
  const [loops, setLoops] = useState(1);
  const [name, setName] = useState('anim');
  const nameCustomizedRef = useRef(false);
  const [removeBgMode, setRemoveBgMode] = useState<WebBackgroundRemovalMode>('color-key');
  const [pickColor, setPickColor] = useState<[number, number, number] | null>(null);
  const [gridGuard, setGridGuard] = useState(true);
  const [loopPreview, setLoopPreview] = useState(true);
  const [maxColors, setMaxColors] = useState(0);
  const [replayKey, setReplayKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [modelStatus, setModelStatus] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // 切好的影格（手動排版用）；id 區分每次切格，讓編輯器重設偏移
  const [editor, setEditor] = useState<{ frames: Raster[]; id: number } | null>(null);
  const [result, setResult] = useState<{ png: Uint8Array; caption: string; validation: ValidationResult } | null>(null);
  const logger = useLogger();
  const { connection: colabConnection, registerActiveRemoval } = useColabBirefnetConnection();
  const isEmoji = target === 'animated-emoji';

  // 編好的 APNG 循環次數是 LINE 規格的 1–4；預覽循環＝把副本的 acTL num_plays 改 0（無限）
  const previewPng = useMemo(
    () => (result && loopPreview ? setApngNumPlays(result.png.slice(), 0) : result?.png),
    [result, loopPreview],
  );

  /** 影格 → fit → APNG → 結果（切格流程與手動排版共用） */
  async function buildFrom(frames: Raster[], label: string): Promise<void> {
    if (isEmoji) assertAnimatedEmojiFrameCount(frames.length);
    const animation = makeAnimation({ loops, durationSec: duration, stabilize: false, maxColors });
    const proc = await processAnimated(frames, {
      bounds: maxBounds(target),
      removeBackground: false, // cutSheet 已去背
      animation: isEmoji
        ? { ...animation, maxBytes: ANIMATED_EMOJI_SPEC.maxBytes }
        : animation,
      ...(isEmoji
        ? {
            limits: ANIMATED_EMOJI_LIMITS,
            requireConsistentFrameSize: true,
            trimTransparentPadding: true,
            marginPx: EMOJI_MARGIN_PX,
            forbidPalette: true,
          }
        : {}),
      preserveFrames: true,
    });
    for (const n of proc.notes) logger.log('info', n);
    const validation = isEmoji
      ? validateAnimatedEmojiImage(proc.info)
      : validateAnimatedImage(proc.info);
    const durationEvidence = proc.info.durationMs === undefined
      ? '單輪時長未知'
      : `單輪 ${proc.info.durationMs}ms`;
    const distinctEvidence = proc.info.distinctFrames === undefined
      ? '不同畫格未知'
      : `${proc.info.distinctFrames} 種不同畫格`;
    logger.log(
      validation.ok ? 'ok' : 'err',
      `${label}：${proc.info.width}×${proc.info.height}  ${proc.info.frames}格×${proc.info.loops}loop  ${durationEvidence}  ${distinctEvidence}  ${proc.info.bytes} bytes（${kb(proc.info.bytes)}）`,
    );
    setResult({
      png: proc.png,
      caption: `${name}.png  ${proc.info.width}×${proc.info.height}  ${proc.info.frames}格×${proc.info.loops}loop  ${durationEvidence}  ${distinctEvidence}  ${proc.info.bytes} bytes（${kb(proc.info.bytes)}）`,
      validation,
    });
  }

  function changeTarget(next: AnimatedTarget) {
    setTarget(next);
    if (!nameCustomizedRef.current) {
      setName(next === 'animated-emoji' ? '001' : 'anim');
    }
    setDuration(2);
    setLoops(1);
    setMaxColors(0);
    setReplayKey(0);
    setEditor(null);
    setResult(null);
    logger.clear();
  }

  function changeDuration(next: number) {
    setDuration(next);
    if (target === 'animated-emoji') {
      const maxLoops = Math.max(1, Math.floor(ANIMATED_EMOJI_SPEC.maxDurationSec / next));
      setLoops((current) => Math.min(current, maxLoops));
    }
  }

  async function run() {
    logger.clear();
    setResult(null);
    setEditor(null);
    setBusy(true);
    const abort = new AbortController();
    abortRef.current = abort;
    const unregister = removeBgMode === 'colab-birefnet' ? registerActiveRemoval(abort) : null;
    let removalJob: BackgroundRemovalJob | null = null;
    try {
      const file = sheet[0];
      if (!file) {
        logger.log('err', '請先選擇影格組圖（frames-sheet）');
        return;
      }
      const grid = parseGridText(gridText);
      if (!grid) {
        logger.log('err', '單組圖模式需要明確網格（如 4x4）');
        return;
      }
      const count = framesN.trim() ? Number(framesN) : grid.cols * grid.rows;
      if (isEmoji) assertAnimatedEmojiFrameCount(count);
      removalJob = await createBackgroundRemovalJob({
        mode: removeBgMode,
        signal: abort.signal,
        pickColor: removeBgMode === 'color-key' ? pickColor : null,
        colabConfig: colabConnection?.config,
        onStatus: setModelStatus,
      });

      logger.log('step', `切格 ${grid.cols}×${grid.rows}（取前 ${count} 格）← ${file.name}`);
      const raster = await decodeBlob(file);
      const semantic = removeBgMode === 'imgly'
        || removeBgMode === 'local-birefnet'
        || removeBgMode === 'colab-birefnet';
      const prepared = semantic
        ? await removeSheetBackgroundByCells(raster, {
            cols: grid.cols,
            rows: grid.rows,
            remove: removalJob.remove,
            signal: abort.signal,
            onProgress: (done, total) => setModelStatus(`${removalJob!.label}：crop ${done}/${total}`),
          })
        : raster;
      // align 'grid'：元件式抽格＋按原圖等分格座標對齊——場景固定不閃，
      // 不再做頭錨點穩定化（錨點平移會把場景物件推出畫布）
      const cut = await cutSheet(prepared, {
        cols: grid.cols,
        rows: grid.rows,
        count,
        align: 'grid',
        key: semantic
          ? { autoRemove: false, preRemovedLabel: removalJob.label }
          : {
              autoRemove: removeBgMode === 'color-key',
              pickColor: removeBgMode === 'color-key' ? pickColor : null,
            },
      });
      reportCut(cut, logger);

      const inf = cut.analysis.inferredGrid;
      const mismatch =
        (inf.cols !== null && inf.cols !== grid.cols) || (inf.rows !== null && inf.rows !== grid.rows);
      if (gridGuard && mismatch) {
        logger.log(
          'err',
          `網格防呆：內容看起來是 ${inf.cols ?? grid.cols}×${inf.rows ?? grid.rows}，與指定的 ` +
            `${grid.cols}×${grid.rows} 不符，已停止（切下去會嚴重漂移）。請修正網格再跑；` +
            `確定網格沒錯的話，取消勾選「網格防呆」即可強制繼續。`,
        );
        return;
      }
      logger.log('info', '影格已按原圖格線對齊（場景固定）→ 跳過錨點穩定化');

      if (isEmoji) assertAnimatedEmojiFrameCount(cut.cells.length);
      setEditor({ frames: cut.cells, id: Date.now() });
      await buildFrom(cut.cells, '動畫 APNG');
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') logger.log('warn', '處理已取消');
      else logger.log('err', e instanceof Error ? e.message : String(e));
    } finally {
      try {
        await removalJob?.dispose();
      } catch (e) {
        logger.log('err', `釋放去背模型失敗：${e instanceof Error ? e.message : String(e)}`);
      }
      unregister?.();
      if (abortRef.current === abort) abortRef.current = null;
      setModelStatus(null);
      setBusy(false);
    }
  }

  async function packManual(frames: Raster[]) {
    setBusy(true);
    try {
      logger.log('step', `手動排版打包（${frames.length} 格，畫布 ${frames[0]?.width}×${frames[0]?.height}）…`);
      await buildFrom(frames, '手動排版 APNG');
    } catch (e) {
      logger.log('err', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const estimateGrid = parseGridText(gridText);
  const sheetInferenceEstimate = estimateGrid
    ? estimateGrid.cols * estimateGrid.rows
    : null;
  const emojiLoopMax = isEmoji
    ? Math.max(1, Math.floor(ANIMATED_EMOJI_SPEC.maxDurationSec / duration))
    : ANIMATED_SPEC.maxLoops;

  return (
    <>
      <p className="tab-desc">
        把一張「連續影格組圖」（每格是動作的一個影格）按元件偵測逐格實際範圍（格線僅參照、越線不切斷）→
        按原圖格線對齊（場景固定不閃）→ 編成一段{isEmoji ? ' Animated Regular Emoji' : '動態貼圖'} APNG。
        影格組圖可用「產圖 Prompt」分頁的動態模式產 prompt。
        自動對齊不滿意時可用「手動排版」逐格拖曳對位再打包。
      </p>
      <FilePick
        label="影格組圖（frames-sheet）"
        files={sheet}
        onChange={(files) => {
          setSheet(files);
          setPickColor(null); // 換圖後點選色失效
        }}
      />
      <BackgroundRemovalControl
        value={removeBgMode}
        onChange={setRemoveBgMode}
        disabled={busy}
        inferenceCount={sheetInferenceEstimate}
        colorHelp={<span className="layout-hint">可自動偵測，或在下方直接點選背景色</span>}
      />
      <Row>
        <Field label="輸出規格">
          <select
            data-testid="anim-sheet-spec-select"
            aria-label="動畫輸出規格"
            value={target}
            disabled={busy}
            onChange={(event) => changeTarget(event.target.value as AnimatedTarget)}
          >
            <option value="animated">Animated Sticker</option>
            <option value="animated-emoji">Animated Regular Emoji</option>
          </select>
        </Field>
        <Field label="網格（如 4x4）">
          <input value={gridText} onChange={(e) => setGridText(e.target.value)} style={{ width: '6em' }} />
        </Field>
        <Field label="取前 N 格（空＝全部）">
          <input
            type="number"
            min={ANIMATED_EMOJI_SPEC.minFrames}
            max={ANIMATED_EMOJI_SPEC.maxFrames}
            value={framesN}
            onChange={(e) => setFramesN(e.target.value)}
            style={{ width: '6em' }}
          />
        </Field>
        <Field label="單輪時長（秒）">
          {isEmoji ? (
            <select value={duration} onChange={(e) => changeDuration(Number(e.target.value))}>
              {ANIMATED_EMOJI_SPEC.playbackDurationsSec.map((seconds) => (
                <option key={seconds} value={seconds}>{seconds}</option>
              ))}
            </select>
          ) : (
            <input type="number" min={0.2} max={4} step={0.1} value={duration} onChange={(e) => changeDuration(Number(e.target.value))} />
          )}
        </Field>
        <Field label={`循環次數（1–${emojiLoopMax}）`}>
          <input
            type="number"
            min={1}
            max={emojiLoopMax}
            value={loops}
            onChange={(e) => {
              const next = Number(e.target.value);
              setLoops(isEmoji ? Math.max(1, Math.min(next, emojiLoopMax)) : next);
            }}
          />
        </Field>
        <Field label="輸出檔名">
          <input
            value={name}
            onChange={(e) => {
              nameCustomizedRef.current = true;
              setName(e.target.value);
            }}
          />
        </Field>
      </Row>
      {isEmoji && (
        <p className="layout-hint" data-testid="anim-sheet-emoji-limits">
          {`Animated Regular Emoji：固定 ${ANIMATED_EMOJI_SPEC.width}×${ANIMATED_EMOJI_SPEC.height}px；${ANIMATED_EMOJI_SPEC.minFrames}–${ANIMATED_EMOJI_SPEC.maxFrames} 格；單輪只可 ${ANIMATED_EMOJI_SPEC.playbackDurationsSec.join('/')} 秒，loops × 單輪 ≤${ANIMATED_EMOJI_SPEC.maxDurationSec} 秒；單檔 ≤${ANIMATED_EMOJI_SPEC.maxBytes / 1000}KB；保留影格並輸出 truecolor RGBA APNG。`}
        </p>
      )}
      <Row>
        <Field label="網格防呆（網格與內容不符時擋下）">
          <input type="checkbox" checked={gridGuard} onChange={(e) => setGridGuard(e.target.checked)} />
        </Field>
        <Field label="預覽循環播放">
          <input type="checkbox" checked={loopPreview} onChange={(e) => setLoopPreview(e.target.checked)} />
        </Field>
        <Field label="減色（檔案較小）">
          <select value={maxColors} onChange={(e) => setMaxColors(Number(e.target.value))}>
            <option value={0}>不降色（超過 {isEmoji ? '300KB' : '1MB'} 時提示）</option>
            <option value={256}>最多 256 色</option>
            <option value={128}>最多 128 色</option>
            <option value={64}>最多 64 色</option>
          </select>
        </Field>
      </Row>
      {removeBgMode === 'color-key' && <ColorPickFromImage file={sheet[0] ?? null} value={pickColor} onChange={setPickColor} />}
      <div className="run-row">
        <button className="btn primary" disabled={busy || sheet.length === 0} onClick={() => void run()}>
          {busy ? '處理中…' : `切格並產生${isEmoji ? ' Animated Emoji' : '動畫'}`}
        </button>
        {busy && <button className="btn" onClick={() => abortRef.current?.abort()}>取消</button>}
        {modelStatus && <span className="model-status">{modelStatus}</span>}
      </div>
      <LogPane lines={logger.lines} />
      {editor && (
        <ManualLayout
          key={editor.id}
          frames={editor.frames}
          durationSec={duration}
          busy={busy}
          onPack={(frames) => void packManual(frames)}
        />
      )}
      {result && previewPng && (
        <div className="pack-result">
          <div className="pack-actions">
            <button
              className="btn primary"
              disabled={!result.validation.ok}
              onClick={() => downloadBytes(`${safeName(name)}.png`, result.png, 'image/png')}
            >
              {result.validation.ok ? `下載 APNG（${kb(result.png.length)}）` : '驗證未通過，不能下載 APNG'}
            </button>
            <button className="btn" onClick={() => setReplayKey((k) => k + 1)}>
              ↻ 重播
            </button>
          </div>
          <ValidationView result={result.validation} />
          <div className="sticker-grid">
            <PngPreview
              key={`${replayKey}-${loopPreview}`}
              bytes={previewPng}
              caption={`${result.caption}${loopPreview ? '（預覽循環播放；下載檔為設定的循環次數）' : ''}`}
              big
            />
          </div>
        </div>
      )}
    </>
  );
}

/** 從上傳的組圖點選背景色（非綠幕、自動偵測選錯色時手動指定色鍵顏色） */
function ColorPickFromImage(props: {
  file: File | null;
  value: [number, number, number] | null;
  onChange: (c: [number, number, number] | null) => void;
}) {
  const { file, value, onChange } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !file || !open) return;
    let cancelled = false;
    void createImageBitmap(file).then((bmp) => {
      if (cancelled || !canvasRef.current) {
        bmp.close();
        return;
      }
      canvasRef.current.width = bmp.width;
      canvasRef.current.height = bmp.height;
      canvasRef.current.getContext('2d')?.drawImage(bmp, 0, 0);
      bmp.close();
    });
    return () => {
      cancelled = true;
    };
  }, [file, open]);

  if (!file) return null;
  return (
    <details className="colorpick" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        背景色：{value ? `rgb(${value.join(',')})（點選色）` : '自動偵測（綠幕→綠；其他→邊框平均色）'}
      </summary>
      <p className="tab-desc">背景不是綠幕、或自動偵測的顏色不對時，直接點圖中的「背景」處指定色鍵顏色。</p>
      <div className="run-row">
        {value && <span className="swatch" style={{ background: `rgb(${value.join(',')})` }} />}
        {value && (
          <button className="btn small" onClick={() => onChange(null)}>
            清除（回自動偵測）
          </button>
        )}
      </div>
      <canvas
        ref={canvasRef}
        className="pick-canvas"
        onClick={(e) => {
          const canvas = e.currentTarget;
          const rect = canvas.getBoundingClientRect();
          const x = Math.floor((e.clientX - rect.left) * (canvas.width / rect.width));
          const y = Math.floor((e.clientY - rect.top) * (canvas.height / rect.height));
          const d = canvas.getContext('2d')?.getImageData(x, y, 1, 1).data;
          if (d) onChange([d[0]!, d[1]!, d[2]!]);
        }}
      />
    </details>
  );
}

// ---------- 整包模式 ----------

function PackMode() {
  const [target, setTarget] = useState<AnimatedTarget>('animated');
  const [count, setCount] = useState(8);
  const [frameSets, setFrameSets] = useState<File[][]>(() => Array.from({ length: 8 }, () => []));
  const [name, setName] = useState('My Animated Stickers');
  const [duration, setDuration] = useState(2);
  const [loops, setLoops] = useState(1);
  const [stabilize, setStabilize] = useState(true);
  const [maxColorsPack, setMaxColorsPack] = useState(0);
  const [removeBgMode, setRemoveBgMode] = useState<WebBackgroundRemovalMode>('none');
  const [backgroundColor, setBackgroundColor] = useState('#00ff00');
  const [strokeOn, setStrokeOn] = useState(false);
  const [strokeWidth, setStrokeWidth] = useState(8);
  const [strokeColor, setStrokeColor] = useState('#ffffff');
  const [textsRaw, setTextsRaw] = useState('');
  const [textStyle, setTextStyle] = useState<SharedTextStyle>(DEFAULT_TEXT_STYLE);
  const [cover, setCover] = useState(1);
  const [busy, setBusy] = useState(false);
  const [modelStatus, setModelStatus] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [result, setResult] = useState<PackResultData | null>(null);
  const logger = useLogger();
  const { connection: colabConnection, registerActiveRemoval } = useColabBirefnetConnection();
  const isEmoji = target === 'animated-emoji';

  function changeCount(n: number) {
    setCount(n);
    setFrameSets((prev) => {
      const next = prev.slice(0, n);
      while (next.length < n) next.push([]);
      return next;
    });
  }

  function changeTarget(next: AnimatedTarget) {
    setTarget(next);
    setCount(8);
    setFrameSets((prev) => {
      const resized = prev.slice(0, 8);
      while (resized.length < 8) resized.push([]);
      return resized;
    });
    setCover(1);
    setDuration(2);
    setLoops(1);
    setMaxColorsPack(0);
    setResult(null);
    logger.clear();
  }

  function changeDuration(next: number) {
    setDuration(next);
    if (target === 'animated-emoji') {
      const maxLoops = Math.max(1, Math.floor(ANIMATED_EMOJI_SPEC.maxDurationSec / next));
      setLoops((current) => Math.min(current, maxLoops));
    }
  }

  async function run() {
    logger.clear();
    setResult(null);
    setBusy(true);
    const abort = new AbortController();
    abortRef.current = abort;
    const unregister = removeBgMode === 'colab-birefnet' ? registerActiveRemoval(abort) : null;
    let removalJob: BackgroundRemovalJob | null = null;
    try {
      const cv = validateCount(target, count);
      if (!cv.ok) {
        for (const i of cv.issues) logger.log('err', i.message);
        return;
      }
      let invalidFrameSet = false;
      for (let index = 0; index < count; index++) {
        const frameCount = frameSets[index]?.length ?? 0;
        if (
          frameCount < ANIMATED_EMOJI_SPEC.minFrames
          || (isEmoji && frameCount > ANIMATED_EMOJI_SPEC.maxFrames)
        ) {
          const filename = isEmoji ? emojiFileName(index + 1) : stickerFileName(index + 1);
          const range = isEmoji
            ? `${ANIMATED_EMOJI_SPEC.minFrames}–${ANIMATED_EMOJI_SPEC.maxFrames}`
            : `至少 ${ANIMATED_SPEC.minFrames}`;
          const suffix = isEmoji ? '；不會自動抽格' : '';
          logger.log(
            'err',
            `${filename} 影格數須為 ${range}，收到 ${frameCount}${suffix}`,
          );
          invalidFrameSet = true;
        }
      }
      if (invalidFrameSet) return;

      const baseAnimation = makeAnimation({ loops, durationSec: duration, stabilize, maxColors: maxColorsPack });
      const animation = isEmoji
        ? { ...baseAnimation, maxBytes: ANIMATED_EMOJI_SPEC.maxBytes }
        : baseAnimation;
      const stroke = makeStroke(strokeOn, strokeWidth, strokeColor);
      const texts = textsRaw.split('\n');
      const bounds = maxBounds(target);
      const parsedColor = parseColor(backgroundColor);
      removalJob = await createBackgroundRemovalJob({
        mode: removeBgMode,
        signal: abort.signal,
        pickColor: removeBgMode === 'color-key'
          ? [parsedColor.r, parsedColor.g, parsedColor.b]
          : null,
        colabConfig: colabConnection?.config,
        onStatus: setModelStatus,
      });

      const processedList: ProcessedAnimated[] = [];
      for (let i = 0; i < count; i++) {
        const files = frameSets[i] ?? [];
        logger.log('step', `處理第 ${i + 1}/${count} 張（${files.length} 格）…`);
        const frames: Raster[] = [];
        for (const f of sortFiles(files)) frames.push(await decodeBlob(f));
        const proc = await processAnimated(frames, {
          bounds,
          removeBackground: false,
          removeBackgroundRaster: removeBgMode === 'none' ? undefined : removalJob.remove,
          signal: abort.signal,
          onBackgroundProgress: (done, total) => setModelStatus(
            `${removalJob!.label}：第 ${i + 1}/${count} 張，影格 ${done}/${total}`,
          ),
          stroke,
          text: makeText(texts[i] ?? '', textStyle),
          animation,
          ...(isEmoji
            ? {
                limits: ANIMATED_EMOJI_LIMITS,
                requireConsistentFrameSize: true,
                trimTransparentPadding: true,
                marginPx: EMOJI_MARGIN_PX + (stroke?.enabled ? stroke.width : 0),
                forbidPalette: true,
              }
            : {}),
          preserveFrames: true,
        });
        const note = proc.notes.length ? `（${proc.notes.join('；')}）` : '';
        const filename = isEmoji ? emojiFileName(i + 1) : stickerFileName(i + 1);
        const durationEvidence = proc.info.durationMs === undefined
          ? '單輪時長未知'
          : `單輪 ${proc.info.durationMs}ms`;
        const distinctEvidence = proc.info.distinctFrames === undefined
          ? '不同畫格未知'
          : `${proc.info.distinctFrames} 種不同畫格`;
        logger.log(
          'info',
          `${filename}  ${proc.info.width}×${proc.info.height}  ${proc.info.frames}格×${proc.info.loops}loop  ${durationEvidence}  ${distinctEvidence}  ${proc.info.bytes} bytes（${kb(proc.info.bytes)}） ${note}`,
        );
        processedList.push(proc);
        await yieldToUI();
      }

      // Sticker 有 APNG main；Emoji 只有封面首格產生的靜態 tab。
      const coverIdx = Math.min(Math.max(1, cover), count) - 1;
      const coverProc = processedList[coverIdx]!;
      const { tab, tabInfo: rawTabInfo } = buildTab(coverProc.fittedFrames[0]!);

      if (isEmoji) {
        const tabInfo = { ...rawTabInfo, format: 'png' as const, isApng: false as const };
        logger.log('step', `tab.png ${tabInfo.width}×${tabInfo.height}（聊天室縮圖用第 ${coverIdx + 1} 張首格）`);
        const built = buildEmojiPackZip({
          name,
          kind: 'animated-emoji',
          tab,
          items: processedList.map((item) => item.png),
        });
        logger.log('ok', `Animated Regular Emoji zip 打包完成（${kb(built.zipBytes)}）`);
        const validation = validateEmojiPack({
          kind: 'animated-emoji',
          count,
          items: processedList.map((item) => item.info),
          tab: tabInfo,
          archivePaths: Object.keys(built.files),
          zipBytes: built.zipBytes,
        });
        setResult({
          kind: 'animated-emoji',
          name,
          stickers: processedList.map((item) => ({ png: item.png, info: item.info, notes: item.notes })),
          tab,
          zip: built.zip,
          validation,
          animated: true,
        });
        return;
      }

      const { main, mainInfo } = buildAnimatedMain(coverProc.fittedFrames, animation);
      const tabInfo = rawTabInfo;
      logger.log('step', `main.png（APNG）${mainInfo.width}×${mainInfo.height} ${mainInfo.frames}格、tab.png ${tabInfo.width}×${tabInfo.height}`);

      const { zip, zipBytes } = buildPackZip({ main, tab, stickers: processedList.map((p) => p.png) });
      logger.log('ok', `zip 打包完成（${kb(zipBytes)}）`);

      const validation = validatePack({
        kind: 'animated',
        count,
        stickers: processedList.map((p) => p.info),
        main: mainInfo,
        tab: tabInfo,
        zipBytes,
      });
      setResult({
        name,
        stickers: processedList.map((p) => ({ png: p.png, info: p.info, notes: p.notes })),
        main,
        tab,
        zip,
        validation,
        animated: true,
      });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') logger.log('warn', '處理已取消');
      else logger.log('err', e instanceof Error ? e.message : String(e));
    } finally {
      try {
        await removalJob?.dispose();
      } catch (e) {
        logger.log('err', `釋放去背模型失敗：${e instanceof Error ? e.message : String(e)}`);
      }
      unregister?.();
      if (abortRef.current === abort) abortRef.current = null;
      setModelStatus(null);
      setBusy(false);
    }
  }

  const inferenceEstimate = frameSets
    .slice(0, count)
    .reduce((sum, files) => sum + Math.min(files.length, ANIMATED_EMOJI_SPEC.maxFrames), 0);
  const emojiLoopMax = isEmoji
    ? Math.max(1, Math.floor(ANIMATED_EMOJI_SPEC.maxDurationSec / duration))
    : ANIMATED_SPEC.maxLoops;

  return (
    <>
      <p className="tab-desc">
        每個項目給一組連續影格（{ANIMATED_EMOJI_SPEC.minFrames}–{ANIMATED_EMOJI_SPEC.maxFrames} 格，檔名排序），
        各自穩定化 → fit → APNG，最後組成
        {isEmoji
          ? ` ${ANIMATED_EMOJI_SPEC.minCount}–${ANIMATED_EMOJI_SPEC.maxCount} 張的 Animated Regular Emoji 上架包（只有 tab.png，不含 main.png）。`
          : ' 8/16/24 張的動態貼圖上架包（main.png 為 APNG）。'}
      </p>
      <Row>
        <Field label="輸出規格">
          <select
            data-testid="anim-pack-spec-select"
            aria-label="動畫整包輸出規格"
            value={target}
            disabled={busy}
            onChange={(event) => changeTarget(event.target.value as AnimatedTarget)}
          >
            <option value="animated">Animated Sticker</option>
            <option value="animated-emoji">Animated Regular Emoji</option>
          </select>
        </Field>
        <Field label="張數">
          <select value={count} onChange={(e) => changeCount(Number(e.target.value))}>
            {allowedCounts(target).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        <Field label={isEmoji ? 'Emoji 包名' : '貼圖包名'}>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="單輪時長（秒）">
          {isEmoji ? (
            <select value={duration} onChange={(e) => changeDuration(Number(e.target.value))}>
              {ANIMATED_EMOJI_SPEC.playbackDurationsSec.map((seconds) => (
                <option key={seconds} value={seconds}>{seconds}</option>
              ))}
            </select>
          ) : (
            <input type="number" min={0.2} max={4} step={0.1} value={duration} onChange={(e) => changeDuration(Number(e.target.value))} />
          )}
        </Field>
        <Field label={`循環次數（1–${emojiLoopMax}）`}>
          <input
            type="number"
            min={1}
            max={emojiLoopMax}
            value={loops}
            onChange={(e) => {
              const next = Number(e.target.value);
              setLoops(isEmoji ? Math.max(1, Math.min(next, emojiLoopMax)) : next);
            }}
          />
        </Field>
        <Field label={isEmoji ? '聊天室縮圖用第幾張' : '封面用第幾張'}>
          <input type="number" min={1} max={count} value={cover} onChange={(e) => setCover(Number(e.target.value))} />
        </Field>
      </Row>
      {isEmoji && (
        <p className="layout-hint" data-testid="anim-pack-emoji-limits">
          {`Animated Regular Emoji：每張固定 ${ANIMATED_EMOJI_SPEC.width}×${ANIMATED_EMOJI_SPEC.height}px；${ANIMATED_EMOJI_SPEC.minCount}–${ANIMATED_EMOJI_SPEC.maxCount} 張；單張 ≤${ANIMATED_EMOJI_SPEC.maxBytes / 1000}KB；${ANIMATED_EMOJI_SPEC.minFrames}–${ANIMATED_EMOJI_SPEC.maxFrames} 格；單輪 ${ANIMATED_EMOJI_SPEC.playbackDurationsSec.join('/')} 秒且 loops × 單輪 ≤${ANIMATED_EMOJI_SPEC.maxDurationSec} 秒；ZIP ≤${ANIMATED_EMOJI_SPEC.zipMaxBytes / 1_000_000}MB；三位數檔名、不含 main.png。`}
        </p>
      )}
      <BackgroundRemovalControl
        value={removeBgMode}
        onChange={setRemoveBgMode}
        disabled={busy}
        inferenceCount={inferenceEstimate}
        color={backgroundColor}
        onColorChange={setBackgroundColor}
      />
      <Row>
        <Field label="主體穩定化">
          <input type="checkbox" checked={stabilize} onChange={(e) => setStabilize(e.target.checked)} />
        </Field>
        <Field label="減色（檔案較小）">
          <select value={maxColorsPack} onChange={(e) => setMaxColorsPack(Number(e.target.value))}>
            <option value={0}>不降色（超過 {isEmoji ? '300KB' : '1MB'} 時提示）</option>
            <option value={256}>最多 256 色</option>
            <option value={128}>最多 128 色</option>
            <option value={64}>最多 64 色</option>
          </select>
        </Field>
        <Field label="白色描邊">
          <input type="checkbox" checked={strokeOn} onChange={(e) => setStrokeOn(e.target.checked)} />
        </Field>
        {strokeOn && (
          <>
            <Field label="描邊寬度(px)">
              <input type="number" min={1} max={24} value={strokeWidth} onChange={(e) => setStrokeWidth(Number(e.target.value))} />
            </Field>
            <Field label="描邊顏色">
              <input type="color" value={strokeColor} onChange={(e) => setStrokeColor(e.target.value)} />
            </Field>
          </>
        )}
      </Row>
      <div className="frame-sets">
        {Array.from({ length: count }, (_, i) => (
          <FilePick
            key={i}
            label={`第 ${isEmoji ? emojiFileName(i + 1) : stickerFileName(i + 1)} 的影格`}
            multiple
            files={frameSets[i] ?? []}
            onChange={(files) =>
              setFrameSets((prev) => {
                const next = [...prev];
                next[i] = files;
                return next;
              })
            }
            hint="拖放這張貼圖的連續影格（5–20 張）"
          />
        ))}
      </div>
      <details className="advanced">
        <summary>逐張疊字（選用）</summary>
        <p className="tab-desc">
          每行對應一個項目（第 1 行 → {isEmoji ? '001.png' : '01.png'}…），空行＝不疊字；會疊在每個影格上。
        </p>
        <textarea rows={4} value={textsRaw} onChange={(e) => setTextsRaw(e.target.value)} />
        <Row>
          <Field label="水平位置 %">
            <input type="number" min={0} max={100} value={textStyle.x} onChange={(e) => setTextStyle({ ...textStyle, x: Number(e.target.value) })} />
          </Field>
          <Field label="垂直位置 %">
            <input type="number" min={0} max={100} value={textStyle.y} onChange={(e) => setTextStyle({ ...textStyle, y: Number(e.target.value) })} />
          </Field>
          <Field label="字級 px">
            <input type="number" min={8} max={200} value={textStyle.size} onChange={(e) => setTextStyle({ ...textStyle, size: Number(e.target.value) })} />
          </Field>
          <Field label="顏色">
            <input type="color" value={textStyle.color} onChange={(e) => setTextStyle({ ...textStyle, color: e.target.value })} />
          </Field>
        </Row>
      </details>
      <div className="run-row">
        <button className="btn primary" disabled={busy} onClick={() => void run()}>
          {busy ? '處理中…' : `打包${isEmoji ? ' Animated Emoji' : '動態貼圖'}`}
        </button>
        {busy && <button className="btn" onClick={() => abortRef.current?.abort()}>取消</button>}
        {modelStatus && <span className="model-status">{modelStatus}</span>}
      </div>
      <LogPane lines={logger.lines} />
      {result && (
        <>
          <div className="validation" data-testid="animated-pack-final-evidence">
            <strong>最終 APNG 解碼結果</strong>
            {result.stickers.map((item, index) => {
              const filename = result.kind === 'animated-emoji'
                ? emojiFileName(index + 1)
                : stickerFileName(index + 1);
              return (
                <div key={filename} className="v-issue">
                  {filename}：{item.info.frames ?? '未知'} 格、{item.info.loops ?? '未知'} loops、
                  單輪 {item.info.durationMs ?? '未知'}ms、{item.info.distinctFrames ?? '未知'} 種不同畫格、
                  {item.info.bytes} bytes（{kb(item.info.bytes)}）
                </div>
              );
            })}
          </div>
          <PackResult data={result} />
        </>
      )}
    </>
  );
}
