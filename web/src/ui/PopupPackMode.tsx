import { useRef, useState } from 'react';
import { POPUP_STICKER_SPEC, STATIC_SPEC, ZIP_MAX_BYTES, maxBounds } from '@core/spec.js';
import { validatePopupPack } from '@core/validate.js';
import { inspectAnimatedBytes } from '../webpipe/apng.js';
import { processAnimated } from '../webpipe/processAnimated.js';
import { processStatic, type ProcessedSticker } from '../webpipe/processStatic.js';
import { createBackgroundRemovalJob, type BackgroundRemovalJob, type WebBackgroundRemovalMode } from '../webpipe/backgroundRemovalJob.js';
import { decodeBlob, yieldToUI } from '../webpipe/raster.js';
import { buildMainTab } from '../webpipe/mainTab.js';
import { buildPopupPackZip, downloadBytes, safeName } from '../webpipe/zip.js';
import { Field, FilePick, LogPane, PngPreview, Row, ValidationView, kb, sortFiles, useLogger } from './common.jsx';
import { BackgroundRemovalControl } from './BackgroundRemovalControl.jsx';
import { useColabBirefnetConnection } from './colabBirefnetConnection.jsx';
import { makeAnimation } from './defaults.js';
import type { ImageInfo } from '@core/validate.js';
import type { ValidationResult } from '@core/types.js';

type PopupStickerResult = {
  png: Uint8Array;
  info: ImageInfo;
  notes: string[];
};

type PopupPackResult = {
  name: string;
  main: Uint8Array;
  mainPopup: Uint8Array;
  tab: Uint8Array;
  staticStickers: PopupStickerResult[];
  popupStickers: PopupStickerResult[];
  zip: Uint8Array;
  validation: ValidationResult;
};

const POPUP_BOUNDS = maxBounds('popup');

export function PopupPackMode() {
  const [count, setCount] = useState(8);
  const [staticFiles, setStaticFiles] = useState<File[]>([]);
  const [frameSets, setFrameSets] = useState<File[][]>(() => Array.from({ length: 8 }, () => []));
  const [name, setName] = useState('My Popup Stickers');
  const [duration, setDuration] = useState(2);
  const [loops, setLoops] = useState(1);
  const [cover, setCover] = useState(1);
  const [stabilize, setStabilize] = useState(true);
  const [reduceColors, setReduceColors] = useState(false);
  const [removeBgMode, setRemoveBgMode] = useState<WebBackgroundRemovalMode>('none');
  const [backgroundColor, setBackgroundColor] = useState('#00ff00');
  const [busy, setBusy] = useState(false);
  const [modelStatus, setModelStatus] = useState<string | null>(null);
  const [result, setResult] = useState<PopupPackResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const logger = useLogger();
  const { connection: colabConnection, registerActiveRemoval } = useColabBirefnetConnection();

  const loopOptions = Array.from({ length: POPUP_STICKER_SPEC.maxLoops }, (_, index) => index + 1)
    .filter((value) => duration * value <= POPUP_STICKER_SPEC.maxDurationSec);
  const removalInferenceCount = Math.min(staticFiles.length, count)
    + frameSets.slice(0, count).reduce((sum, files) => sum + files.length, 0);

  function changeCount(nextCount: number) {
    setCount(nextCount);
    setFrameSets((previous) => {
      const next = previous.slice(0, nextCount);
      while (next.length < nextCount) next.push([]);
      return next;
    });
    setCover((previous) => Math.min(previous, nextCount));
    setResult(null);
  }

  function changeDuration(value: number) {
    setDuration(value);
    setLoops((previous) => Math.min(previous, Math.floor(POPUP_STICKER_SPEC.maxDurationSec / value), POPUP_STICKER_SPEC.maxLoops));
    setResult(null);
  }

  async function run(reduceColorsOverride = reduceColors) {
    logger.clear();
    setResult(null);
    setBusy(true);
    const abort = new AbortController();
    abortRef.current = abort;
    const unregister = removeBgMode === 'colab-birefnet' ? registerActiveRemoval(abort) : null;
    let removalJob: BackgroundRemovalJob | null = null;
    try {
      if (staticFiles.length < count) {
        logger.log('err', `靜態來源只有 ${staticFiles.length} 張，至少需要 ${count} 張`);
        return;
      }
      const pickedStatic = sortFiles(staticFiles).slice(0, count);
      if (staticFiles.length > count) {
        logger.log('warn', `靜態來源選了 ${staticFiles.length} 張，依檔名排序取前 ${count} 張`);
      }
      for (let index = 0; index < count; index++) {
        const files = sortFiles(frameSets[index] ?? []);
        if (files.length < POPUP_STICKER_SPEC.minFrames) {
          logger.log('err', `第 ${index + 1} 張動畫影格只有 ${files.length} 張，需要 ${POPUP_STICKER_SPEC.minFrames}–${POPUP_STICKER_SPEC.maxFrames} 張`);
          return;
        }
        if (files.length > POPUP_STICKER_SPEC.maxFrames) {
          logger.log('err', `第 ${index + 1} 張動畫影格有 ${files.length} 張，最多 ${POPUP_STICKER_SPEC.maxFrames} 張；請先刪除多餘影格`);
          return;
        }
      }
      if (duration * loops > POPUP_STICKER_SPEC.maxDurationSec || loops > POPUP_STICKER_SPEC.maxLoops) {
        logger.log(
          'err',
          `循環設定不符合 Pop-up Sticker：單輪時長 × 循環次數不得超過 ${POPUP_STICKER_SPEC.maxDurationSec} 秒，循環最多 ${POPUP_STICKER_SPEC.maxLoops} 次`,
        );
        return;
      }
      if (!Number.isInteger(cover) || cover < 1 || cover > count) {
        logger.log('err', `封面序號須為 1–${count} 的整數`);
        return;
      }

      const abortSignal = abort.signal;
      const parsedColor = hexToRgb(backgroundColor);
      removalJob = await createBackgroundRemovalJob({
        mode: removeBgMode,
        signal: abortSignal,
        pickColor: removeBgMode === 'color-key' ? parsedColor : null,
        colabConfig: colabConnection?.config,
        onStatus: setModelStatus,
      });

      const staticProcessed: ProcessedSticker[] = [];
      for (let index = 0; index < pickedStatic.length; index++) {
        if (abortSignal.aborted) throw new DOMException('處理已取消', 'AbortError');
        const source = pickedStatic[index]!;
        logger.log('step', `處理靜態貼圖 ${index + 1}/${count}：${source.name}`);
        const decoded = await decodeBlob(source);
        const removed = await removalJob.remove(decoded, abortSignal);
        const processed = await processStatic(removed, {
          bounds: maxBounds('static'),
          removeBackground: false,
          marginPx: 0,
          maxBytes: STATIC_SPEC.maxBytes,
          reduceColors: reduceColorsOverride,
          forbidPalette: true,
        });
        staticProcessed.push(processed);
        logger.log('info', `${String(index + 1).padStart(2, '0')}.png ${processed.info.width}×${processed.info.height} ${kb(processed.info.bytes)}`);
        await yieldToUI();
      }

      const animation = {
        ...makeAnimation({
          loops,
          durationSec: duration,
          stabilize,
          maxColors: reduceColorsOverride ? 256 : 0,
        }),
        maxBytes: POPUP_STICKER_SPEC.maxBytes,
      };
      const popupProcessed: PopupStickerResult[] = [];
      for (let index = 0; index < count; index++) {
        const files = sortFiles(frameSets[index]!);
        logger.log('step', `處理 Pop-up ${index + 1}/${count}（${files.length} 格）…`);
        const frames = [];
        for (const source of files) frames.push(await decodeBlob(source));
        const processed = await processAnimated(frames, {
          bounds: POPUP_BOUNDS,
          removeBackground: false,
          removeBackgroundRaster: removalJob.remove,
          signal: abortSignal,
          onBackgroundProgress: (done, total) => setModelStatus(
            `${removalJob!.label}：Pop-up ${index + 1}/${count}，影格 ${done}/${total}`,
          ),
          animation,
          preserveFrames: true,
          forbidPalette: true,
          limits: {
            minFrames: POPUP_STICKER_SPEC.minFrames,
            maxFrames: POPUP_STICKER_SPEC.maxFrames,
            maxDurationSec: POPUP_STICKER_SPEC.maxDurationSec,
          },
        });
        const info = inspectAnimatedBytes(processed.png, files.length).info;
        // Do not retain ProcessedAnimated.fittedFrames. At the legal pack maximum,
        // keeping every decoded 480×480 RGBA frame would consume hundreds of MiB.
        popupProcessed.push({ png: processed.png, info, notes: processed.notes });
        processed.fittedFrames.length = 0;
        frames.length = 0;
        logger.log('info', `popup/${String(index + 1).padStart(2, '0')}.png ${info.width}×${info.height} ${kb(info.bytes)}`);
        await yieldToUI();
      }

      const coverIndex = cover - 1;
      const staticCover = staticProcessed[coverIndex]!;
      const popupCover = popupProcessed[coverIndex]!;
      const { main, tab, mainInfo, tabInfo } = buildMainTab(staticCover.raster);
      const mainPopup = popupCover.png;
      const staticInfos = staticProcessed.map((item) => item.info);
      const popupInfos = popupProcessed.map((item) => item.info);
      const mainPopupInfo = popupInfos[coverIndex]!;
      const { zip, zipBytes } = buildPopupPackZip({
        main,
        popupMain: mainPopup,
        tab,
        stickers: staticProcessed.map((item) => item.png),
        popupStickers: popupProcessed.map((item) => item.png),
      });
      const validation = validatePopupPack({
        count,
        stickers: staticInfos,
        popupStickers: popupInfos,
        main: mainInfo,
        popupMain: mainPopupInfo,
        tab: tabInfo,
        zipBytes,
      });
      logger.log(
        validation.ok ? 'ok' : 'err',
        validation.ok
          ? `Pop-up ZIP 打包完成並通過技術規格檢查（${kb(zipBytes)}）`
          : `Pop-up ZIP 已產生，但技術規格檢查未通過；下載已停用（${kb(zipBytes)}）`,
      );
      if (!validation.ok && !reduceColorsOverride && hasByteLimitIssue(validation)) {
        logger.log('warn', '成品超過檔案或整包容量上限；未自動降色，可在結果區選擇「嘗試降色並重新打包」。');
      }
      setResult({
        name,
        main,
        mainPopup,
        tab,
        staticStickers: staticProcessed.map((item) => ({ png: item.png, info: item.info, notes: item.notes })),
        popupStickers: popupProcessed.map((item) => ({
          png: item.png,
          info: item.info,
          notes: item.notes,
        })),
        zip,
        validation,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') logger.log('warn', '處理已取消');
      else logger.log('err', error instanceof Error ? error.message : String(error));
    } finally {
      try {
        await removalJob?.dispose();
      } catch (error) {
        logger.log('err', `釋放去背模型失敗：${error instanceof Error ? error.message : String(error)}`);
      }
      unregister?.();
      if (abortRef.current === abort) abortRef.current = null;
      setModelStatus(null);
      setBusy(false);
    }
  }

  return (
    <section data-testid="popup-pack-mode">
      <p className="tab-desc">
        同時準備獨立的靜態貼圖與 Pop-up APNG 影格：兩組檔案會分別處理、驗證並放入同一個 ZIP。Pop-up 畫布固定 480×480；上／中／下顯示位置請稍後在 LINE My Page 選擇，不會寫入影像。
      </p>
      <p className="popup-limit-note" data-testid="popup-limits">
        Pop-up 限制：張數 8／16／24；影格 5–20；每輪 1／2／3 秒；循環 1–3 次且總長 ≤3 秒；單張 ≤{POPUP_STICKER_SPEC.maxBytes / 1_000_000}MB；整包 ≤{ZIP_MAX_BYTES / 1_000_000}MB；透明 RGB PNG/APNG（不接受索引色）。預設不降色，超標後才提供選用重試。
      </p>
      <Row>
        <Field label="張數">
          <select data-testid="popup-count" value={count} disabled={busy} onChange={(event) => changeCount(Number(event.target.value))}>
            {POPUP_STICKER_SPEC.counts.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </Field>
        <Field label="貼圖包名">
          <input data-testid="popup-name" value={name} disabled={busy} onChange={(event) => { setName(event.target.value); setResult(null); }} />
        </Field>
        <Field label="每輪時長（秒）">
          <select data-testid="popup-duration" value={duration} disabled={busy} onChange={(event) => changeDuration(Number(event.target.value))}>
            {POPUP_STICKER_SPEC.playbackDurationsSec.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </Field>
        <Field label="循環次數">
          <select data-testid="popup-loops" value={loops} disabled={busy} onChange={(event) => { setLoops(Number(event.target.value)); setResult(null); }}>
            {loopOptions.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </Field>
        <Field label="封面第幾張">
          <input data-testid="popup-cover" type="number" min={1} max={count} value={cover} disabled={busy} onChange={(event) => { setCover(Number(event.target.value)); setResult(null); }} />
        </Field>
        <Field label="主體穩定化">
          <input
            type="checkbox"
            aria-label="修正逐格主體漂移"
            checked={stabilize}
            disabled={busy}
            onChange={(event) => { setStabilize(event.target.checked); setResult(null); }}
          />
        </Field>
      </Row>
      <div data-testid="popup-static-picker">
        <FilePick label={`靜態來源（至少 ${count} 張；多選取排序後前 ${count} 張）`} multiple files={staticFiles} onChange={(files) => { setStaticFiles(files); setResult(null); }} />
      </div>
      <BackgroundRemovalControl
        value={removeBgMode}
        onChange={(mode) => { setRemoveBgMode(mode); setResult(null); }}
        disabled={busy}
        inferenceCount={removalInferenceCount}
        color={backgroundColor}
        onColorChange={(color) => { setBackgroundColor(color); setResult(null); }}
      />
      <div className="popup-frame-sets">
        {Array.from({ length: count }, (_, index) => (
          <div key={index} className="popup-frame-card" data-testid={`popup-frame-picker-${index + 1}`}>
            <h4>Pop-up 第 {String(index + 1).padStart(2, '0')} 張影格</h4>
            <FilePick
              label={`影格（需 ${POPUP_STICKER_SPEC.minFrames}–${POPUP_STICKER_SPEC.maxFrames} 張）`}
              multiple
              files={frameSets[index] ?? []}
              onChange={(files) => {
                setFrameSets((previous) => {
                  const next = [...previous];
                  next[index] = files;
                  return next;
                });
                setResult(null);
              }}
              hint="拖放同一張 Pop-up 貼圖的連續影格"
            />
          </div>
        ))}
      </div>
      <div className="run-row">
        <button data-testid="popup-run" className="btn primary" disabled={busy} onClick={() => void run()}>
          {busy ? '處理中…' : '打包全螢幕貼圖整包'}
        </button>
        {busy && <button data-testid="popup-cancel" className="btn" onClick={() => abortRef.current?.abort()}>取消</button>}
        {modelStatus && <span className="model-status">{modelStatus}</span>}
      </div>
      <LogPane lines={logger.lines} />
      {result && (
        <PopupResult
          data={result}
          colorReductionUsed={reduceColors}
          onReduceColors={() => {
            setReduceColors(true);
            void run(true);
          }}
        />
      )}
    </section>
  );
}

function PopupResult(props: {
  data: PopupPackResult;
  colorReductionUsed: boolean;
  onReduceColors: () => void;
}) {
  const { data, colorReductionUsed, onReduceColors } = props;
  const valid = data.validation.ok;
  const canOfferColorReduction = !valid && !colorReductionUsed && hasByteLimitIssue(data.validation);
  return (
    <div className="popup-pack-result" data-testid="popup-result">
      {canOfferColorReduction && (
        <div className="validation warn" data-testid="popup-color-reduction-prompt">
          成品超過單檔或整包容量上限。系統沒有自動降色；你可以保留原圖修改素材，或明確選擇降色後重試。
          <button className="btn" data-testid="popup-reduce-colors-retry" onClick={onReduceColors}>
            嘗試降色並重新打包
          </button>
        </div>
      )}
      <div className="pack-actions">
        <button
          data-testid="popup-download-zip"
          className="btn primary"
          disabled={!valid}
          onClick={() => downloadBytes(`${safeName(data.name)}.zip`, data.zip, 'application/zip')}
        >
          {valid ? `下載 Pop-up ZIP（${kb(data.zip.length)}）` : '驗證未通過，不能下載上傳包'}
        </button>
        <button className="btn" onClick={() => downloadBytes('main.png', data.main, 'image/png')}>main.png</button>
        <button className="btn" onClick={() => downloadBytes('main_popup.png', data.mainPopup, 'image/png')}>main_popup.png</button>
        <button className="btn" onClick={() => downloadBytes('tab.png', data.tab, 'image/png')}>tab.png</button>
      </div>
      <ValidationView result={data.validation} />
      <p className={valid ? 'popup-valid-note' : 'popup-invalid-note'}>
        {valid
          ? '技術規格檢查通過；這只代表目前檔案符合工具檢查，仍不保證 LINE 審核。上／中／下顯示位置請在 LINE My Page 選擇。'
          : '驗證未通過；這不是可上傳的整包，請先修正錯誤。上／中／下顯示位置仍需在 LINE My Page 選擇。'}
      </p>
      <div className="popup-root-previews">
        <div data-testid="popup-main-preview"><PngPreview bytes={data.main} caption="png/main.png 240×240" /></div>
        <div data-testid="popup-main-popup-preview"><PngPreview bytes={data.mainPopup} caption="popup/main_popup.png 480×480 APNG" /></div>
        <div data-testid="popup-tab-preview"><PngPreview bytes={data.tab} caption="png/tab.png 96×74" /></div>
      </div>
      <div className="popup-asset-groups">
        <div data-testid="popup-static-assets">
          <h3>靜態貼圖（{data.staticStickers.length}）</h3>
          <div className="sticker-grid">
            {data.staticStickers.map((item, index) => <PngPreview key={index} bytes={item.png} caption={`png/${String(index + 1).padStart(2, '0')}.png ${item.info.width}×${item.info.height}`} />)}
          </div>
        </div>
        <div data-testid="popup-animated-assets">
          <h3>Pop-up APNG（{data.popupStickers.length}）</h3>
          <div className="sticker-grid">
            {data.popupStickers.map((item, index) => <PngPreview key={index} bytes={item.png} caption={`popup/${String(index + 1).padStart(2, '0')}.png ${item.info.width}×${item.info.height}`} big />)}
          </div>
        </div>
      </div>
    </div>
  );
}

function hasByteLimitIssue(validation: ValidationResult): boolean {
  return validation.issues.some(
    (issue) => issue.level === 'error' && (issue.code === 'zip.bytes' || issue.code.endsWith('.bytes')),
  );
}

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  const normalized = value.length === 3 ? value.split('').map((part) => `${part}${part}`).join('') : value;
  const parsed = Number.parseInt(normalized, 16);
  if (!Number.isFinite(parsed)) return [0, 255, 0];
  return [(parsed >> 16) & 255, (parsed >> 8) & 255, parsed & 255];
}
