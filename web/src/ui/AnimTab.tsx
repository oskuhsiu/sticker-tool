/**
 * 動態貼圖（APNG）——對應 CLI `anim` 的兩種模式：
 *   單組圖：一張 frames-sheet 切格 → 穩定化 → fit → 一段動畫 APNG。
 *   整包：每張貼圖一組連續影格 → 8/16/24 張動態貼圖上架包（main 為 APNG）。
 */

import { useState } from 'react';
import { ANIMATED_SPEC, maxBounds } from '@core/spec.js';
import type { RemoveBgMode } from '@core/types.js';
import { validateAnimatedImage, validateCount, validatePack } from '@core/validate.js';
import { decodeBlob, yieldToUI, type Raster } from '../webpipe/raster.js';
import { cutSheet } from '../webpipe/sheetAnalysis.js';
import { processAnimated, type ProcessedAnimated } from '../webpipe/processAnimated.js';
import { buildAnimatedMain, buildTab } from '../webpipe/mainTab.js';
import { buildPackZip, downloadBytes, safeName } from '../webpipe/zip.js';
import { Field, FilePick, LogPane, PngPreview, Row, ValidationView, kb, sortFiles, useLogger } from './common.jsx';
import { PackResult, type PackResultData } from './packResult.jsx';
import { DEFAULT_TEXT_STYLE, makeAnimation, makeStroke, makeText, parseGridText, type SharedTextStyle } from './defaults.js';
import { reportCut } from './cutReport.js';
import { useModelProgress } from './modelProgress.js';
import type { ValidationResult } from '@core/types.js';

type Mode = 'sheet' | 'pack';

export function AnimTab() {
  const [mode, setMode] = useState<Mode>('sheet');
  return (
    <section>
      <div className="mode-switch">
        <label>
          <input type="radio" checked={mode === 'sheet'} onChange={() => setMode('sheet')} />
          單張組圖 → 一段動畫
        </label>
        <label>
          <input type="radio" checked={mode === 'pack'} onChange={() => setMode('pack')} />
          整包（每張貼圖一組影格）
        </label>
      </div>
      {mode === 'sheet' ? <SheetMode /> : <PackMode />}
    </section>
  );
}

// ---------- 單組圖模式 ----------

function SheetMode() {
  const [sheet, setSheet] = useState<File[]>([]);
  const [gridText, setGridText] = useState('4x4');
  const [framesN, setFramesN] = useState<string>('');
  const [duration, setDuration] = useState(2);
  const [loops, setLoops] = useState(1);
  const [name, setName] = useState('anim');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ png: Uint8Array; caption: string; validation: ValidationResult } | null>(null);
  const logger = useLogger();
  const modelStatus = useModelProgress();

  async function run() {
    logger.clear();
    setResult(null);
    setBusy(true);
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

      logger.log('step', `切格 ${grid.cols}×${grid.rows}（取前 ${count} 格）← ${file.name}`);
      const raster = await decodeBlob(file);
      // align 'grid'：元件式抽格＋按原圖等分格座標對齊——場景固定不閃，
      // 不再做頭錨點穩定化（錨點平移會把場景物件推出畫布）
      const cut = await cutSheet(raster, { cols: grid.cols, rows: grid.rows, count, align: 'grid' });
      reportCut(cut, logger);
      logger.log('info', '影格已按原圖格線對齊（場景固定）→ 跳過錨點穩定化');

      const proc = await processAnimated(cut.cells, {
        bounds: maxBounds('animated'),
        removeBackground: false, // cutSheet 已去背
        animation: makeAnimation({ loops, durationSec: duration, stabilize: false }),
      });
      for (const n of proc.notes) logger.log('info', n);

      const validation = validateAnimatedImage(proc.info);
      logger.log(
        'ok',
        `動畫 APNG：${proc.info.width}×${proc.info.height}  ${proc.info.frames}格×${proc.info.loops}loop  ${kb(proc.info.bytes)}`,
      );
      setResult({
        png: proc.png,
        caption: `${name}.png  ${proc.info.width}×${proc.info.height}  ${proc.info.frames}格  ${kb(proc.info.bytes)}`,
        validation,
      });
    } catch (e) {
      logger.log('err', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p className="tab-desc">
        把一張「連續影格組圖」（每格是動作的一個影格）按元件偵測逐格實際範圍（格線僅參照、越線不切斷）→
        按原圖格線對齊（場景固定不閃）→ 編成一段 APNG。影格組圖可用「產圖 Prompt」分頁的動態模式產 prompt。
      </p>
      <FilePick label="影格組圖（frames-sheet）" files={sheet} onChange={setSheet} />
      <Row>
        <Field label="網格（如 4x4）">
          <input value={gridText} onChange={(e) => setGridText(e.target.value)} style={{ width: '6em' }} />
        </Field>
        <Field label="取前 N 格（空＝全部）">
          <input value={framesN} onChange={(e) => setFramesN(e.target.value)} style={{ width: '6em' }} />
        </Field>
        <Field label="單輪時長（秒）">
          <input type="number" min={0.2} max={4} step={0.1} value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
        </Field>
        <Field label="循環次數（1–4）">
          <input type="number" min={1} max={4} value={loops} onChange={(e) => setLoops(Number(e.target.value))} />
        </Field>
        <Field label="輸出檔名">
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
      </Row>
      <div className="run-row">
        <button className="btn primary" disabled={busy || sheet.length === 0} onClick={() => void run()}>
          {busy ? '處理中…' : '切格並產生動畫'}
        </button>
        {modelStatus && <span className="model-status">{modelStatus}</span>}
      </div>
      <LogPane lines={logger.lines} />
      {result && (
        <div className="pack-result">
          <div className="pack-actions">
            <button className="btn primary" onClick={() => downloadBytes(`${safeName(name)}.png`, result.png, 'image/png')}>
              下載 APNG（{kb(result.png.length)}）
            </button>
          </div>
          <ValidationView result={result.validation} />
          <div className="sticker-grid">
            <PngPreview bytes={result.png} caption={result.caption} big />
          </div>
        </div>
      )}
    </>
  );
}

// ---------- 整包模式 ----------

function PackMode() {
  const [count, setCount] = useState(8);
  const [frameSets, setFrameSets] = useState<File[][]>(() => Array.from({ length: 8 }, () => []));
  const [name, setName] = useState('My Animated Stickers');
  const [duration, setDuration] = useState(2);
  const [loops, setLoops] = useState(1);
  const [stabilize, setStabilize] = useState(true);
  const [removeBgMode, setRemoveBgMode] = useState<'false' | 'auto' | 'true'>('false');
  const [strokeOn, setStrokeOn] = useState(false);
  const [strokeWidth, setStrokeWidth] = useState(8);
  const [strokeColor, setStrokeColor] = useState('#ffffff');
  const [textsRaw, setTextsRaw] = useState('');
  const [textStyle, setTextStyle] = useState<SharedTextStyle>(DEFAULT_TEXT_STYLE);
  const [cover, setCover] = useState(1);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PackResultData | null>(null);
  const logger = useLogger();
  const modelStatus = useModelProgress();

  function changeCount(n: number) {
    setCount(n);
    setFrameSets((prev) => {
      const next = prev.slice(0, n);
      while (next.length < n) next.push([]);
      return next;
    });
  }

  async function run() {
    logger.clear();
    setResult(null);
    setBusy(true);
    try {
      const cv = validateCount('animated', count);
      if (!cv.ok) {
        for (const i of cv.issues) logger.log('err', i.message);
        return;
      }
      const removeBackground: RemoveBgMode = removeBgMode === 'auto' ? 'auto' : removeBgMode === 'true';
      const animation = makeAnimation({ loops, durationSec: duration, stabilize });
      const stroke = makeStroke(strokeOn, strokeWidth, strokeColor);
      const texts = textsRaw.split('\n');
      const bounds = maxBounds('animated');

      const processedList: ProcessedAnimated[] = [];
      for (let i = 0; i < count; i++) {
        const files = frameSets[i] ?? [];
        if (files.length === 0) {
          logger.log('err', `第 ${i + 1} 張：尚未選擇影格（需 ${ANIMATED_SPEC.minFrames}–${ANIMATED_SPEC.maxFrames} 格）`);
          return;
        }
        logger.log('step', `處理第 ${i + 1}/${count} 張（${files.length} 格）…`);
        const frames: Raster[] = [];
        for (const f of sortFiles(files)) frames.push(await decodeBlob(f));
        const proc = await processAnimated(frames, {
          bounds,
          removeBackground,
          stroke,
          text: makeText(texts[i] ?? '', textStyle),
          animation,
        });
        const note = proc.notes.length ? `（${proc.notes.join('；')}）` : '';
        logger.log('info', `${String(i + 1).padStart(2, '0')}.png  ${proc.info.width}×${proc.info.height}  ${proc.info.frames}格×${proc.info.loops}loop  ${kb(proc.info.bytes)} ${note}`);
        processedList.push(proc);
        await yieldToUI();
      }

      // main（APNG）+ tab（封面首格靜態）
      const coverIdx = Math.min(Math.max(1, cover), count) - 1;
      const coverProc = processedList[coverIdx]!;
      const { main, mainInfo } = buildAnimatedMain(coverProc.fittedFrames, animation);
      const { tab, tabInfo } = buildTab(coverProc.fittedFrames[0]!);
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
      logger.log('err', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p className="tab-desc">
        每張貼圖給一組連續影格（{ANIMATED_SPEC.minFrames}–{ANIMATED_SPEC.maxFrames} 格，檔名排序），
        各自穩定化 → fit → APNG，最後組成 8/16/24 張的動態貼圖上架包（main.png 為 APNG）。
      </p>
      <Row>
        <Field label="張數">
          <select value={count} onChange={(e) => changeCount(Number(e.target.value))}>
            {ANIMATED_SPEC.counts.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        <Field label="貼圖包名">
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="單輪時長（秒）">
          <input type="number" min={0.2} max={4} step={0.1} value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
        </Field>
        <Field label="循環次數（1–4）">
          <input type="number" min={1} max={4} value={loops} onChange={(e) => setLoops(Number(e.target.value))} />
        </Field>
        <Field label="封面用第幾張">
          <input type="number" min={1} max={count} value={cover} onChange={(e) => setCover(Number(e.target.value))} />
        </Field>
      </Row>
      <Row>
        <Field label="去背">
          <select value={removeBgMode} onChange={(e) => setRemoveBgMode(e.target.value as typeof removeBgMode)}>
            <option value="false">不去背（影格已透明）</option>
            <option value="auto">自動偵測殘留才去背</option>
            <option value="true">每格強制去背（慢）</option>
          </select>
        </Field>
        <Field label="主體穩定化">
          <input type="checkbox" checked={stabilize} onChange={(e) => setStabilize(e.target.checked)} />
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
            label={`第 ${String(i + 1).padStart(2, '0')} 張的影格`}
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
        <p className="tab-desc">每行對應一張貼圖（第 1 行 → 01.png…），空行＝不疊字；會疊在每個影格上。</p>
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
          {busy ? '處理中…' : '打包動態貼圖'}
        </button>
        {modelStatus && <span className="model-status">{modelStatus}</span>}
      </div>
      <LogPane lines={logger.lines} />
      {result && <PackResult data={result} />}
    </>
  );
}
