/** Local images to a Static Sticker or Regular Emoji upload pack. */

import { useRef, useState } from 'react';
import { EMOJI_SPEC, STATIC_SPEC, allowedCounts, maxBounds } from '@core/spec.js';
import { emojiFileName, stickerFileName } from '@core/naming.js';
import { parseColor } from '@core/color.js';
import { validateCount, validateEmojiPack, validatePack } from '@core/validate.js';
import { decodeBlob, yieldToUI } from '../webpipe/raster.js';
import {
  createBackgroundRemovalJob,
  type BackgroundRemovalJob,
  type WebBackgroundRemovalMode,
} from '../webpipe/backgroundRemovalJob.js';
import { processStatic, type ProcessedSticker } from '../webpipe/processStatic.js';
import { buildMainTab, buildTab } from '../webpipe/mainTab.js';
import { buildEmojiPackZip } from '../webpipe/emojiZip.js';
import { buildPackZip } from '../webpipe/zip.js';
import { Field, FilePick, LogPane, Row, kb, sortFiles, useLogger } from './common.jsx';
import { ColorReductionPrompt, PackResult, type PackResultData } from './packResult.jsx';
import { makeStroke } from './defaults.js';
import { BackgroundRemovalControl } from './BackgroundRemovalControl.jsx';
import { useColabBirefnetConnection } from './colabBirefnetConnection.jsx';

type BuildTarget = 'static' | 'emoji';
const EMOJI_MARGIN_PX = 4;

export function BuildTab() {
  const [files, setFiles] = useState<File[]>([]);
  const [target, setTarget] = useState<BuildTarget>('static');
  const [count, setCount] = useState(8);
  const [name, setName] = useState('My Stickers');
  const [removeBgMode, setRemoveBgMode] = useState<WebBackgroundRemovalMode>('none');
  const [backgroundColor, setBackgroundColor] = useState('#00ff00');
  const [strokeOn, setStrokeOn] = useState(false);
  const [strokeWidth, setStrokeWidth] = useState(8);
  const [strokeColor, setStrokeColor] = useState('#ffffff');
  const [cover, setCover] = useState(1);
  const [reduceColors, setReduceColors] = useState(false);
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
      const cv = validateCount(target, count);
      if (!cv.ok) {
        for (const i of cv.issues) logger.log('err', i.message);
        return;
      }
      if (files.length < count) {
        logger.log('err', `只選了 ${files.length} 張圖，少於要求的 ${count} 張`);
        return;
      }
      const picked = sortFiles(files).slice(0, count);
      if (files.length > count) logger.log('warn', `選了 ${files.length} 張，取前 ${count} 張（檔名排序）`);

      const bounds = maxBounds(target);
      const spec = target === 'emoji' ? EMOJI_SPEC : STATIC_SPEC;
      const stroke = makeStroke(strokeOn, strokeWidth, strokeColor);
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

      logger.log('step', `處理 ${count} 張${target === 'emoji' ? ' Regular Emoji' : '靜態貼圖'}（${removalJob.label}）…`);
      const processed: ProcessedSticker[] = [];
      for (let i = 0; i < picked.length; i++) {
        const decoded = await decodeBlob(picked[i]!);
        const raster = await removalJob.remove(decoded, abort.signal);
        setModelStatus(`${removalJob.label}：${i + 1}/${picked.length} 張完成`);
        const r = await processStatic(raster, {
          bounds,
          removeBackground: false,
          ...(target === 'emoji'
            ? {
                canvasMode: 'exact' as const,
                trimInput: true,
                marginPx: EMOJI_MARGIN_PX,
                forbidPalette: true,
              }
            : {}),
          stroke,
          maxBytes: spec.maxBytes,
          reduceColors: reduceColorsOverride,
        });
        const note = r.notes.length ? `（${r.notes.join('；')}）` : '';
        const filename = target === 'emoji' ? emojiFileName(i + 1) : stickerFileName(i + 1);
        logger.log('info', `${filename}  ${r.info.width}×${r.info.height}  ${kb(r.info.bytes)} ${note}`);
        processed.push(r);
        await yieldToUI();
      }

      const coverIdx = Math.min(Math.max(1, cover), count) - 1;
      if (target === 'emoji') {
        const { tab, tabInfo: rawTabInfo } = buildTab(processed[coverIdx]!.raster);
        const tabInfo = { ...rawTabInfo, format: 'png' as const, isApng: false as const };
        logger.log('step', `tab.png ${tabInfo.width}×${tabInfo.height}（聊天室縮圖用第 ${coverIdx + 1} 張）`);

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
      logger.log('step', `main.png ${mainInfo.width}×${mainInfo.height}、tab.png ${tabInfo.width}×${tabInfo.height}（封面用第 ${coverIdx + 1} 張）`);

      const { zip, zipBytes } = buildPackZip({ main, tab, stickers: processed.map((p) => p.png) });
      logger.log('ok', `zip 打包完成（${kb(zipBytes)}）`);

      const validation = validatePack({
        kind: 'static',
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

  function changeTarget(next: BuildTarget) {
    setTarget(next);
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

  return (
    <section>
      <p className="tab-desc">
        把本機照片/圖片處理成 LINE 靜態貼圖或 Regular Emoji：去背 → 裁切置中 → 縮放 → 描邊 →
        support image → zip。Emoji 固定輸出 180×180，只上傳 tab.png，不產生 main.png。預設保留原色；超過容量才提示是否降色重試。
        預設只在瀏覽器處理；只有選擇 Colab BiRefNet 時，處理用圖片才會送到你自己的臨時 session。
      </p>
      <FilePick label={`輸入圖片（需 ≥ ${count} 張）`} multiple files={files} onChange={setFiles} />
      <Row>
        <Field label="輸出規格">
          <select
            data-testid="build-spec-select"
            aria-label="輸出規格"
            value={target}
            disabled={busy}
            onChange={(event) => changeTarget(event.target.value as BuildTarget)}
          >
            <option value="static">一般靜態貼圖</option>
            <option value="emoji">Regular Emoji</option>
          </select>
        </Field>
        <Field label="張數">
          <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
            {allowedCounts(target).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        <Field label={target === 'emoji' ? 'Emoji 包名' : '貼圖包名'}>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={target === 'emoji' ? '聊天室縮圖用第幾張' : '封面用第幾張'}>
          <input
            type="number"
            min={1}
            max={count}
            value={cover}
            onChange={(e) => setCover(Number(e.target.value))}
          />
        </Field>
      </Row>
      {target === 'emoji' && (
        <p className="layout-hint" data-testid="build-emoji-limits">
          {`Regular Emoji：每張固定 ${EMOJI_SPEC.width}×${EMOJI_SPEC.height}px；可選 ${EMOJI_SPEC.minCount}–${EMOJI_SPEC.maxCount} 張；單張 ≤${EMOJI_SPEC.maxBytes / 1_000_000}MB；ZIP 必須小於 ${EMOJI_SPEC.zipMaxBytes / 1_000_000}MB；使用三位數檔名且不含 main.png。`}
        </p>
      )}
      <BackgroundRemovalControl
        value={removeBgMode}
        onChange={setRemoveBgMode}
        disabled={busy}
        inferenceCount={count}
        color={backgroundColor}
        onColorChange={setBackgroundColor}
      />
      <Row>
        <Field label="白色描邊">
          <input type="checkbox" checked={strokeOn} onChange={(e) => setStrokeOn(e.target.checked)} />
        </Field>
        {strokeOn && (
          <>
            <Field label="描邊寬度(px)">
              <input
                type="number"
                min={1}
                max={24}
                value={strokeWidth}
                onChange={(e) => setStrokeWidth(Number(e.target.value))}
              />
            </Field>
            <Field label="描邊顏色">
              <input type="color" value={strokeColor} onChange={(e) => setStrokeColor(e.target.value)} />
            </Field>
          </>
        )}
      </Row>
      <div className="run-row">
        <button className="btn primary" disabled={busy || files.length === 0} onClick={() => void run()}>
          {busy ? '處理中…' : '開始打包'}
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
