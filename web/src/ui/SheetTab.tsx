/** Sprite sheet to a Static Sticker, Big Sticker, or Regular Emoji upload pack. */

import { useMemo, useRef, useState } from 'react';
import { BIG_STICKER_SPEC, EMOJI_SPEC, STATIC_SPEC, ZIP_MAX_BYTES, allowedCounts, maxBounds } from '@core/spec.js';
import { emojiFileName, stickerFileName } from '@core/naming.js';
import { planGrid } from '@core/grid.js';
import { parseColor } from '@core/color.js';
import { DEFAULT_COLOR_KEY_OPTIONS, type ColorKeyOptions } from '@core/colorKey.js';
import type { GridLayout } from '@core/types.js';
import { validateEmojiPack, validatePack } from '@core/validate.js';
import { decodeBlob, yieldToUI, type Raster } from '../webpipe/raster.js';
import {
  createBackgroundRemovalJob,
  type BackgroundRemovalJob,
  type WebBackgroundRemovalMode,
} from '../webpipe/backgroundRemovalJob.js';
import { removeSheetBackgroundByCells } from '../webpipe/sheetBackgroundRemoval.js';
import { cutSheet } from '../webpipe/sheetAnalysis.js';
import { processStatic, type ProcessedSticker } from '../webpipe/processStatic.js';
import { buildMainTab, buildTab } from '../webpipe/mainTab.js';
import { buildEmojiPackZip } from '../webpipe/emojiZip.js';
import { buildPackZip } from '../webpipe/zip.js';
import { registerUploadedFont } from '../webpipe/text.js';
import { Field, FilePick, LogPane, Row, kb, sortFiles, useLogger } from './common.jsx';
import { ColorReductionPrompt, PackResult, type PackResultData } from './packResult.jsx';
import {
  DEFAULT_TEXT_STYLE,
  customGridIssue,
  makeStroke,
  makeText,
  parseGridText,
  type SharedTextStyle,
} from './defaults.js';
import { reportCut } from './cutReport.js';
import { BackgroundRemovalControl } from './BackgroundRemovalControl.jsx';
import { useColabBirefnetConnection } from './colabBirefnetConnection.jsx';
import { SheetCutPreview } from './SheetCutPreview.jsx';

type SheetTarget = 'static' | 'big' | 'emoji';
const EMOJI_MARGIN_PX = 4;

export function SheetTab() {
  const [sheets, setSheets] = useState<File[]>([]);
  const [stickerKind, setStickerKind] = useState<SheetTarget>('static');
  const [count, setCount] = useState(8);
  const [name, setName] = useState('My Stickers');
  const [isCharacter, setIsCharacter] = useState(true);
  const [gridText, setGridText] = useState('auto');
  const [removeBgMode, setRemoveBgMode] = useState<WebBackgroundRemovalMode>('color-key');
  const [backgroundColor, setBackgroundColor] = useState('#00ff00');
  const [colorKeyOptions, setColorKeyOptions] = useState<ColorKeyOptions>(() => ({ ...DEFAULT_COLOR_KEY_OPTIONS }));
  const [strokeOn, setStrokeOn] = useState(false);
  const [strokeWidth, setStrokeWidth] = useState(8);
  const [strokeColor, setStrokeColor] = useState('#ffffff');
  const [cover, setCover] = useState(1);
  const [reduceColors, setReduceColors] = useState(false);
  // 逐格疊字：每行一格（空行＝不疊字）；位置/大小/顏色共用
  const [textsRaw, setTextsRaw] = useState('');
  const [textStyle, setTextStyle] = useState<SharedTextStyle>(DEFAULT_TEXT_STYLE);
  const [fontName, setFontName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [modelStatus, setModelStatus] = useState<string | null>(null);
  const [result, setResult] = useState<PackResultData | null>(null);
  const [zipOverBudget, setZipOverBudget] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const logger = useLogger();
  const { connection: colabConnection, registerActiveRemoval } = useColabBirefnetConnection();

  async function run(reduceColorsOverride = reduceColors) {
    logger.clear();
    setResult(null);
    setZipOverBudget(null);
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
      const overrideIssue = override ? customGridIssue(override) : null;
      if (overrideIssue) {
        logger.log('err', overrideIssue);
        return;
      }
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
      const parsedBackgroundColor = parseColor(backgroundColor);
      const wholeImageColor: [number, number, number] = [
        parsedBackgroundColor.r,
        parsedBackgroundColor.g,
        parsedBackgroundColor.b,
      ];
      removalJob = await createBackgroundRemovalJob({
        mode: removeBgMode,
        signal: abort.signal,
        pickColor: removeBgMode === 'color-key' && colorKeyOptions.scope === 'whole-image'
          ? wholeImageColor
          : null,
        ...(removeBgMode === 'color-key' ? { colorKey: colorKeyOptions } : {}),
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
            : removeBgMode === 'color-key'
              ? {
                  autoRemove: true,
                  colorKey: colorKeyOptions,
                  ...(colorKeyOptions.scope === 'whole-image' ? { pickColor: wholeImageColor } : {}),
                }
              : { autoRemove: false },
        });
        reportCut(cut, logger);
        cells.push(...cut.cells);
        await yieldToUI();
      }
      logger.log('ok', `共切出 ${cells.length} 格`);

      // 3) 逐格處理（cutSheet 已整張去背 → 不重複去背）
      const spec = stickerKind === 'big'
        ? BIG_STICKER_SPEC
        : stickerKind === 'emoji'
          ? EMOJI_SPEC
          : STATIC_SPEC;
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
            : stickerKind === 'emoji'
              ? {
                  canvasMode: 'exact' as const,
                  trimInput: true,
                  marginPx: EMOJI_MARGIN_PX,
                }
            : {}),
          stroke,
          text: makeText(texts[i] ?? '', style),
          maxBytes: spec.maxBytes,
          reduceColors: reduceColorsOverride,
          forbidPalette: true,
        });
        const note = r.notes.length ? `（${r.notes.join('；')}）` : '';
        const filename = stickerKind === 'emoji' ? emojiFileName(i + 1) : stickerFileName(i + 1);
        logger.log('info', `${filename}  ${r.info.width}×${r.info.height}  ${kb(r.info.bytes)} ${note}`);
        processed.push(r);
        await yieldToUI();
      }

      // 4) main/tab + 打包 + 驗證
      const coverIdx = Math.min(Math.max(1, cover), count) - 1;
      if (stickerKind === 'emoji') {
        const { tab, tabInfo: rawTabInfo } = buildTab(processed[coverIdx]!.raster);
        const tabInfo = { ...rawTabInfo, format: 'png' as const, isApng: false as const };
        let built: ReturnType<typeof buildEmojiPackZip>;
        try {
          built = buildEmojiPackZip({
            name,
            kind: 'emoji',
            tab,
            items: processed.map((item) => item.png),
          });
        } catch (error) {
          if (error instanceof RangeError) {
            setZipOverBudget(error.message);
            logger.log('err', error.message);
            return;
          }
          throw error;
        }
        logger.log('ok', `Emoji zip 打包完成（${kb(built.zipBytes)}）`);
        const validation = validateEmojiPack({
          kind: 'emoji',
          count,
          items: processed.map((item) => item.info),
          tab: tabInfo,
          archivePaths: Object.keys(built.files),
          zipBytes: built.zipBytes,
        });
        setResult({
          kind: 'emoji',
          name,
          stickers: processed,
          tab,
          zip: built.zip,
          validation,
        });
        return;
      }

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
      setResult({ kind: stickerKind === 'big' ? 'big' : 'sticker', name, stickers: processed, main, tab, zip, validation });
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

  function changeTarget(next: SheetTarget) {
    setStickerKind(next);
    setCount(8);
    setCover(1);
    setReduceColors(false);
    setResult(null);
    setZipOverBudget(null);
    logger.clear();
  }

  function retryWithColorReduction() {
    setReduceColors(true);
    void run(true);
  }

  const previewState = useMemo((): { layout: GridLayout | null; issue: string | null } => {
    try {
      const d = planGrid(count, { isCharacter, forceOversizeSet: false });
      const g = parseGridText(gridText);
      const issue = g ? customGridIssue(g) : null;
      if (issue) return { layout: null, issue };
      return {
        layout: g && d.layout.sheets === 1 && g.cols * g.rows >= count
          ? ({ ...d.layout, ...g } satisfies GridLayout)
          : d.layout,
        issue: null,
      };
    } catch (error) {
      return { layout: null, issue: error instanceof Error ? error.message : String(error) };
    }
  }, [count, gridText, isCharacter]);
  const previewLayout = previewState.layout;
  const layoutHint = previewLayout
    ? `版面：${previewLayout.cols}×${previewLayout.rows}${previewLayout.sheets > 1 ? ` × ${previewLayout.sheets} 張組圖` : ''}`
    : previewState.issue ?? '';

  return (
    <section>
      <p className="tab-desc">
        把一張（或多張）含網格的組圖切成個別貼圖或 Regular Emoji 再打包：偵測背景（透明/綠幕/不透明）→ 去背 →
        切線吸附到真實透明縫 → 校正 → 打包。組圖可用「產圖 Prompt」分頁產的 prompt 餵給任何 AI 產圖工具取得。
      </p>
      <FilePick label="組圖（sprite sheet）" multiple files={sheets} onChange={setSheets} />
      <SheetCutPreview sheets={sheets} layout={previewLayout} />
      <BackgroundRemovalControl
        value={removeBgMode}
        onChange={setRemoveBgMode}
        disabled={busy}
        inferenceCount={count}
        color={backgroundColor}
        onColorChange={setBackgroundColor}
        colorHelp={<span className="layout-hint">外框模式可自動偵測；全圖模式使用這個色碼</span>}
        colorKeyOptions={colorKeyOptions}
        onColorKeyOptionsChange={setColorKeyOptions}
      />
      <Row>
        <Field label="輸出規格">
          <select
            data-testid="sheet-spec-select"
            aria-label="貼圖規格"
            value={stickerKind}
            disabled={busy}
            onChange={(e) => {
              changeTarget(e.target.value as SheetTarget);
            }}
          >
            <option value="static">一般靜態貼圖</option>
            <option value="big">大貼圖</option>
            <option value="emoji">Regular Emoji</option>
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
        <span className="layout-hint" data-testid={previewState.issue ? 'sheet-grid-error' : undefined}>{layoutHint}</span>
      </Row>
      {stickerKind === 'big' && (
        <p className="layout-hint" data-testid="sheet-big-limits">
          {`大貼圖限制：${BIG_STICKER_SPEC.minWidth}×${BIG_STICKER_SPEC.minHeight}–${BIG_STICKER_SPEC.maxWidth}×${BIG_STICKER_SPEC.maxHeight} px；8／16／24／32／40 張；寬高皆須為偶數；透明 truecolor PNG；單張 ≤${BIG_STICKER_SPEC.maxBytes / 1_000_000}MB、整包 ≤${ZIP_MAX_BYTES / 1_000_000}MB；不需預留 margin。預設不降色，超標後才提供選用重試。`}
        </p>
      )}
      {stickerKind === 'emoji' && (
        <p className="layout-hint" data-testid="sheet-emoji-limits">
          {`Regular Emoji：每張固定 ${EMOJI_SPEC.width}×${EMOJI_SPEC.height}px；可選 ${EMOJI_SPEC.minCount}–${EMOJI_SPEC.maxCount} 張；單張 ≤${EMOJI_SPEC.maxBytes / 1_000_000}MB；ZIP 必須小於 ${EMOJI_SPEC.zipMaxBytes / 1_000_000}MB；使用三位數檔名且不含 main.png。`}
        </p>
      )}
      <Row>
        <Field label={stickerKind === 'emoji' ? 'Emoji 包名' : '貼圖包名'}>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={stickerKind === 'emoji' ? '聊天室縮圖用第幾張' : '封面用第幾張'}>
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
        <p className="tab-desc">每行對應一格（第 1 行 → {stickerKind === 'emoji' ? '001.png' : '01.png'}…），空行＝該格不疊字。</p>
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
      {zipOverBudget && (
        <ColorReductionPrompt
          message={`Emoji ZIP 超過上限，未保留可下載結果。${zipOverBudget}`}
          onRetry={reduceColors ? undefined : retryWithColorReduction}
        />
      )}
      {result && (
        <PackResult
          data={result}
          onReduceColors={reduceColors ? undefined : retryWithColorReduction}
        />
      )}
    </section>
  );
}
