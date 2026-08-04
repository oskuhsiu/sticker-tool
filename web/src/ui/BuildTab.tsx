/**
 * 本機圖片 → 靜態貼圖上架包（對應 CLI `build`）。
 * 去背 → trim+置中+10px 邊 → [描邊] → 原色編碼 → main/tab → zip。
 * 超過容量時才提示使用者選擇是否降色重試。
 */

import { useRef, useState } from 'react';
import { STATIC_SPEC, maxBounds } from '@core/spec.js';
import { parseColor } from '@core/color.js';
import { validateCount, validatePack } from '@core/validate.js';
import { decodeBlob, yieldToUI } from '../webpipe/raster.js';
import {
  createBackgroundRemovalJob,
  type BackgroundRemovalJob,
  type WebBackgroundRemovalMode,
} from '../webpipe/backgroundRemovalJob.js';
import { processStatic, type ProcessedSticker } from '../webpipe/processStatic.js';
import { buildMainTab } from '../webpipe/mainTab.js';
import { buildPackZip } from '../webpipe/zip.js';
import { Field, FilePick, LogPane, Row, kb, sortFiles, useLogger } from './common.jsx';
import { PackResult, type PackResultData } from './packResult.jsx';
import { makeStroke } from './defaults.js';
import { BackgroundRemovalControl } from './BackgroundRemovalControl.jsx';
import { useColabBirefnetConnection } from './colabBirefnetConnection.jsx';

export function BuildTab() {
  const [files, setFiles] = useState<File[]>([]);
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
  const abortRef = useRef<AbortController | null>(null);
  const logger = useLogger();
  const { connection: colabConnection, registerActiveRemoval } = useColabBirefnetConnection();

  async function run(reduceColorsOverride = reduceColors) {
    logger.clear();
    setResult(null);
    setBusy(true);
    const abort = new AbortController();
    abortRef.current = abort;
    const unregister = removeBgMode === 'colab-birefnet' ? registerActiveRemoval(abort) : null;
    let removalJob: BackgroundRemovalJob | null = null;
    try {
      const cv = validateCount('static', count);
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

      const bounds = maxBounds('static');
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

      logger.log('step', `處理 ${count} 張靜態貼圖（${removalJob.label}）…`);
      const processed: ProcessedSticker[] = [];
      for (let i = 0; i < picked.length; i++) {
        const decoded = await decodeBlob(picked[i]!);
        const raster = await removalJob.remove(decoded, abort.signal);
        setModelStatus(`${removalJob.label}：${i + 1}/${picked.length} 張完成`);
        const r = await processStatic(raster, {
          bounds,
          removeBackground: false,
          stroke,
          maxBytes: STATIC_SPEC.maxBytes,
          reduceColors: reduceColorsOverride,
        });
        const note = r.notes.length ? `（${r.notes.join('；')}）` : '';
        logger.log('info', `${String(i + 1).padStart(2, '0')}.png  ${r.info.width}×${r.info.height}  ${kb(r.info.bytes)} ${note}`);
        processed.push(r);
        await yieldToUI();
      }

      const coverIdx = Math.min(Math.max(1, cover), count) - 1;
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

  return (
    <section>
      <p className="tab-desc">
        把本機照片/圖片處理成符合 LINE 規格的靜態貼圖包：去背 → 裁切置中 → 縮放 → 描邊 →
        main/tab → zip。預設保留原色；打包後若超過容量才會提示是否降色重試。預設只在瀏覽器處理；只有選擇 Colab BiRefNet 時，處理用圖片才會送到你自己的臨時 session。
      </p>
      <FilePick label={`輸入圖片（需 ≥ ${count} 張）`} multiple files={files} onChange={setFiles} />
      <Row>
        <Field label="張數">
          <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
            {STATIC_SPEC.counts.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        <Field label="貼圖包名">
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="封面用第幾張">
          <input
            type="number"
            min={1}
            max={count}
            value={cover}
            onChange={(e) => setCover(Number(e.target.value))}
          />
        </Field>
      </Row>
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
      {result && (
        <PackResult
          data={result}
          onReduceColors={reduceColors ? undefined : () => {
            setReduceColors(true);
            void run(true);
          }}
        />
      )}
    </section>
  );
}
