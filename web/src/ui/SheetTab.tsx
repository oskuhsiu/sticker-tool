/**
 * 組圖（sprite sheet）→ 切格 → 靜態貼圖上架包（對應 CLI `gen`）。
 * 組圖來源：外部 AI 工具（搭配「產圖 Prompt」分頁產的 prompt）或任何現成大圖。
 */

import { useMemo, useRef, useState } from 'react';
import { BIG_STICKER_SPEC, STATIC_SPEC, allowedCounts, maxBounds } from '@core/spec.js';
import { planGrid } from '@core/grid.js';
import type { GridLayout } from '@core/types.js';
import { validatePack } from '@core/validate.js';
import { decodeBlob, yieldToUI, type Raster } from '../webpipe/raster.js';
import {
  createBackgroundRemovalJob,
  type BackgroundRemovalJob,
  type WebBackgroundRemovalMode,
} from '../webpipe/backgroundRemovalJob.js';
import { removeSheetBackgroundByCells } from '../webpipe/sheetBackgroundRemoval.js';
import { cutSheet } from '../webpipe/sheetAnalysis.js';
import { processStatic, type ProcessedSticker } from '../webpipe/processStatic.js';
import { buildMainTab } from '../webpipe/mainTab.js';
import { buildPackZip } from '../webpipe/zip.js';
import { registerUploadedFont } from '../webpipe/text.js';
import { Field, FilePick, LogPane, Row, kb, sortFiles, useLogger } from './common.jsx';
import { PackResult, type PackResultData } from './packResult.jsx';
import { DEFAULT_TEXT_STYLE, makeStroke, makeText, parseGridText, type SharedTextStyle } from './defaults.js';
import { reportCut } from './cutReport.js';
import { BackgroundRemovalControl } from './BackgroundRemovalControl.jsx';
import { useColabBirefnetConnection } from './colabBirefnetConnection.jsx';
import { SheetCutPreview } from './SheetCutPreview.jsx';

export function SheetTab() {
  const [sheets, setSheets] = useState<File[]>([]);
  const [stickerKind, setStickerKind] = useState<'static' | 'big'>('static');
  const [count, setCount] = useState(8);
  const [name, setName] = useState('My Stickers');
  const [isCharacter, setIsCharacter] = useState(true);
  const [gridText, setGridText] = useState('auto');
  const [removeBgMode, setRemoveBgMode] = useState<WebBackgroundRemovalMode>('color-key');
  const [strokeOn, setStrokeOn] = useState(false);
  const [strokeWidth, setStrokeWidth] = useState(8);
  const [strokeColor, setStrokeColor] = useState('#ffffff');
  const [cover, setCover] = useState(1);
  // 逐格疊字：每行一格（空行＝不疊字）；位置/大小/顏色共用
  const [textsRaw, setTextsRaw] = useState('');
  const [textStyle, setTextStyle] = useState<SharedTextStyle>(DEFAULT_TEXT_STYLE);
  const [fontName, setFontName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [modelStatus, setModelStatus] = useState<string | null>(null);
  const [result, setResult] = useState<PackResultData | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const logger = useLogger();
  const { connection: colabConnection, registerActiveRemoval } = useColabBirefnetConnection();

  async function run() {
    logger.clear();
    setResult(null);
    setBusy(true);
    const abort = new AbortController();
    abortRef.current = abort;
    const unregister = removeBgMode === 'colab-birefnet' ? registerActiveRemoval(abort) : null;
    let removalJob: BackgroundRemovalJob | null = null;
    try {
      if (sheets.length === 0) {
        logger.log('err', '請先選擇組圖（一張大圖含多格貼圖）');
        return;
      }

      // 1) 版面決策（與 CLI gen 一致：blocked 僅警告，不擋打包——產圖已在外部完成）
      const decision = planGrid(count, { isCharacter, forceOversizeSet: false });
      for (const w of decision.warnings) logger.log('warn', w);
      if (decision.blocked) {
        logger.log('warn', decision.blockReason ?? '張數超出角色一致性建議範圍；組圖已在外部產好，仍繼續打包。');
      }
      let layout = decision.layout;
      const override = parseGridText(gridText);
      if (override && layout.sheets === 1) {
        if (override.cols * override.rows < layout.count) {
          logger.log('warn', `設定的網格 ${override.cols}×${override.rows} 容不下 ${layout.count} 張，改用自動版面`);
        } else {
          layout = { ...layout, cols: override.cols, rows: override.rows };
        }
      }
      const ordered = sortFiles(sheets);
      if (ordered.length !== layout.sheets) {
        logger.log('err', `版面需要 ${layout.sheets} 張組圖，但選了 ${ordered.length} 張`);
        return;
      }
      removalJob = await createBackgroundRemovalJob({
        mode: removeBgMode,
        signal: abort.signal,
        colabConfig: colabConnection?.config,
        onStatus: setModelStatus,
      });

      // 2) 逐張組圖切格
      const cells: Raster[] = [];
      for (let s = 0; s < layout.sheets; s++) {
        const remaining = count - s * layout.cellsPerSheet;
        const thisCount = Math.min(layout.cellsPerSheet, remaining);
        logger.log('step', `切格 ${s + 1}/${layout.sheets}（${layout.cols}×${layout.rows}，${thisCount} 格）← ${ordered[s]!.name}`);
        const raster = await decodeBlob(ordered[s]!);
        const semantic = removeBgMode === 'imgly'
          || removeBgMode === 'local-birefnet'
          || removeBgMode === 'colab-birefnet';
        const prepared = semantic
          ? await removeSheetBackgroundByCells(raster, {
              cols: layout.cols,
              rows: layout.rows,
              remove: removalJob.remove,
              signal: abort.signal,
              onProgress: (done, total) => setModelStatus(
                `${removalJob!.label}：組圖 ${s + 1}/${layout.sheets}，crop ${done}/${total}`,
              ),
            })
          : raster;
        const cut = await cutSheet(prepared, {
          cols: layout.cols,
          rows: layout.rows,
          count: thisCount,
          key: semantic
            ? { autoRemove: false, preRemovedLabel: removalJob.label }
            : { autoRemove: removeBgMode === 'color-key' },
        });
        reportCut(cut, logger);
        cells.push(...cut.cells);
        await yieldToUI();
      }
      logger.log('ok', `共切出 ${cells.length} 格`);

      // 3) 逐格處理（cutSheet 已整張去背 → 不重複去背）
      const spec = stickerKind === 'big' ? BIG_STICKER_SPEC : STATIC_SPEC;
      const bounds = maxBounds(stickerKind);
      const stroke = makeStroke(strokeOn, strokeWidth, strokeColor);
      const texts = textsRaw.split('\n');
      const style: SharedTextStyle = { ...textStyle, font: fontName ?? '' };
      const processed: ProcessedSticker[] = [];
      for (let i = 0; i < cells.length; i++) {
        const r = await processStatic(cells[i]!, {
          bounds,
          removeBackground: false,
          ...(stickerKind === 'big'
            ? {
                minCanvas: { width: BIG_STICKER_SPEC.minWidth, height: BIG_STICKER_SPEC.minHeight },
                marginPx: 0,
              }
            : {}),
          stroke,
          text: makeText(texts[i] ?? '', style),
          maxBytes: spec.maxBytes,
        });
        const note = r.notes.length ? `（${r.notes.join('；')}）` : '';
        logger.log('info', `${String(i + 1).padStart(2, '0')}.png  ${r.info.width}×${r.info.height}  ${kb(r.info.bytes)} ${note}`);
        processed.push(r);
        await yieldToUI();
      }

      // 4) main/tab + 打包 + 驗證
      const coverIdx = Math.min(Math.max(1, cover), count) - 1;
      const { main, tab, mainInfo, tabInfo } = buildMainTab(processed[coverIdx]!.raster);
      const { zip, zipBytes } = buildPackZip({ main, tab, stickers: processed.map((p) => p.png) });
      logger.log('ok', `zip 打包完成（${kb(zipBytes)}）`);

      const validation = validatePack({
        kind: stickerKind,
        count,
        stickers: processed.map((p) => p.info),
        main: mainInfo,
        tab: tabInfo,
        zipBytes,
      });
      setResult({ name, stickers: processed, main, tab, zip, validation });
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

  const previewLayout = useMemo(() => {
    try {
      const d = planGrid(count, { isCharacter, forceOversizeSet: false });
      const g = parseGridText(gridText);
      return g && d.layout.sheets === 1 && g.cols * g.rows >= count
        ? ({ ...d.layout, ...g } satisfies GridLayout)
        : d.layout;
    } catch {
      return null;
    }
  }, [count, gridText, isCharacter]);
  const layoutHint = previewLayout
    ? `版面：${previewLayout.cols}×${previewLayout.rows}${previewLayout.sheets > 1 ? ` × ${previewLayout.sheets} 張組圖` : ''}`
    : '';

  return (
    <section>
      <p className="tab-desc">
        把一張（或多張）含網格的組圖切成個別貼圖再打包：偵測背景（透明/綠幕/不透明）→ 去背 →
        切線吸附到真實透明縫 → 校正 → 打包。組圖可用「產圖 Prompt」分頁產的 prompt 餵給任何 AI 產圖工具取得。
      </p>
      <FilePick label="組圖（sprite sheet）" multiple files={sheets} onChange={setSheets} />
      <SheetCutPreview sheets={sheets} layout={previewLayout} />
      <BackgroundRemovalControl
        value={removeBgMode}
        onChange={setRemoveBgMode}
        disabled={busy}
        inferenceCount={count}
        colorHelp={<span className="layout-hint">自動偵測綠幕或邊框背景色</span>}
      />
      <Row>
        <Field label="貼圖規格">
          <select
            data-testid="sheet-spec-select"
            aria-label="貼圖規格"
            value={stickerKind}
            onChange={(e) => {
              setStickerKind(e.target.value as 'static' | 'big');
              setResult(null);
            }}
          >
            <option value="static">一般靜態貼圖</option>
            <option value="big">大貼圖</option>
          </select>
        </Field>
        <Field label="張數">
          <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
            {allowedCounts(stickerKind).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        <Field label="角色包（單張組圖）">
          <input type="checkbox" checked={isCharacter} onChange={(e) => setIsCharacter(e.target.checked)} />
        </Field>
        <Field label="網格（auto 或 4x2）">
          <input value={gridText} onChange={(e) => setGridText(e.target.value)} style={{ width: '6em' }} />
        </Field>
        <span className="layout-hint">{layoutHint}</span>
      </Row>
      {stickerKind === 'big' && (
        <p className="layout-hint" data-testid="sheet-big-limits">
          {`大貼圖限制：${BIG_STICKER_SPEC.minWidth}×${BIG_STICKER_SPEC.minHeight}–${BIG_STICKER_SPEC.maxWidth}×${BIG_STICKER_SPEC.maxHeight} px；寬高皆須為偶數；透明 PNG；單張 ≤${BIG_STICKER_SPEC.maxBytes / 1_000_000}MB；不需預留 margin。`}
        </p>
      )}
      <Row>
        <Field label="貼圖包名">
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="封面用第幾張">
          <input type="number" min={1} max={count} value={cover} onChange={(e) => setCover(Number(e.target.value))} />
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
      <details className="advanced">
        <summary>逐格疊字（選用）</summary>
        <p className="tab-desc">每行對應一格（第 1 行 → 01.png…），空行＝該格不疊字。</p>
        <textarea
          rows={4}
          placeholder={'嗨\n讚\n（空行＝不疊字）'}
          value={textsRaw}
          onChange={(e) => setTextsRaw(e.target.value)}
        />
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
          <Field label="字型檔（選用）">
            <input
              type="file"
              accept=".otf,.ttf,.woff,.woff2"
              onChange={(e) => {
                const f = e.currentTarget.files?.[0];
                if (!f) return;
                void registerUploadedFont(f).then((family) => {
                  setFontName(family);
                  logger.log('ok', `已載入字型：${f.name}`);
                });
              }}
            />
          </Field>
        </Row>
      </details>
      <div className="run-row">
        <button className="btn primary" disabled={busy || sheets.length === 0} onClick={() => void run()}>
          {busy ? '處理中…' : '切格並打包'}
        </button>
        {busy && <button className="btn" onClick={() => abortRef.current?.abort()}>取消</button>}
        {modelStatus && <span className="model-status">{modelStatus}</span>}
      </div>
      <LogPane lines={logger.lines} />
      {result && <PackResult data={result} />}
    </section>
  );
}
