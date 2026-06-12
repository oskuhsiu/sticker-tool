/**
 * 本機圖片 → 靜態貼圖上架包（對應 CLI `build`）。
 * 去背 → trim+置中+10px 邊 → [描邊] → ≤1MB → main/tab → zip。
 */

import { useState } from 'react';
import { STATIC_SPEC, maxBounds } from '@core/spec.js';
import { validateCount, validatePack } from '@core/validate.js';
import { decodeBlob, yieldToUI } from '../webpipe/raster.js';
import { processStatic, type ProcessedSticker } from '../webpipe/processStatic.js';
import { buildMainTab } from '../webpipe/mainTab.js';
import { buildPackZip } from '../webpipe/zip.js';
import { Field, FilePick, LogPane, Row, kb, sortFiles, useLogger } from './common.jsx';
import { PackResult, type PackResultData } from './packResult.jsx';
import { makeStroke } from './defaults.js';
import { useModelProgress } from './modelProgress.js';

export function BuildTab() {
  const [files, setFiles] = useState<File[]>([]);
  const [count, setCount] = useState(8);
  const [name, setName] = useState('My Stickers');
  const [removeBg, setRemoveBg] = useState(true);
  const [strokeOn, setStrokeOn] = useState(false);
  const [strokeWidth, setStrokeWidth] = useState(8);
  const [strokeColor, setStrokeColor] = useState('#ffffff');
  const [cover, setCover] = useState(1);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PackResultData | null>(null);
  const logger = useLogger();
  const modelStatus = useModelProgress();

  async function run() {
    logger.clear();
    setResult(null);
    setBusy(true);
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

      logger.log('step', `處理 ${count} 張靜態貼圖…`);
      const processed: ProcessedSticker[] = [];
      for (let i = 0; i < picked.length; i++) {
        const raster = await decodeBlob(picked[i]!);
        const r = await processStatic(raster, {
          bounds,
          removeBackground: removeBg,
          stroke,
          maxBytes: STATIC_SPEC.maxBytes,
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
      logger.log('err', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <p className="tab-desc">
        把本機照片/圖片處理成符合 LINE 規格的靜態貼圖包：去背 → 裁切置中 → 縮放 → 描邊 → 壓到 ≤1MB →
        main/tab → zip。全程在瀏覽器內運算，圖片不會上傳到任何伺服器。
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
      <Row>
        <Field label="去背">
          <input type="checkbox" checked={removeBg} onChange={(e) => setRemoveBg(e.target.checked)} />
        </Field>
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
        {modelStatus && <span className="model-status">{modelStatus}</span>}
      </div>
      <LogPane lines={logger.lines} />
      {result && <PackResult data={result} />}
    </section>
  );
}
