import type { VideoGridPlan } from '@core/videoCrop.js';
import { colorKeyUsesEdge, type ColorKeyOptions } from '@core/colorKey.js';
import type { VideoBackgroundMode, VideoOutputTarget } from '@core/videoProject.js';
import type { VideoMetadata } from '../../webpipe/videoSource.js';
import { Field, Row } from '../common.jsx';
import { ColorKeyOptionFields, LocalBirefnetRuntimeWarning } from '../BackgroundRemovalControl.jsx';
import { VideoCutRangeStep } from './VideoCutRangeStep.jsx';

export function VideoSourceStep(props: {
  metadata: VideoMetadata;
  target: VideoOutputTarget;
  count: number;
  cols: number;
  rows: number;
  name: string;
  cover: number;
  defaultBackground: VideoBackgroundMode;
  color: string;
  colorAutomatic: boolean;
  colorKeyOptions: ColorKeyOptions;
  grid: VideoGridPlan | null;
  range: React.ComponentProps<typeof VideoCutRangeStep>;
  busy: boolean;
  onTarget: (value: VideoOutputTarget) => void;
  onCount: (value: number) => void;
  onCols: (value: number) => void;
  onRows: (value: number) => void;
  onName: (value: string) => void;
  onCover: (value: number) => void;
  onBackground: (value: VideoBackgroundMode) => void;
  onColor: (value: string) => void;
  onColorAutomatic: (value: boolean) => void;
  onColorKeyOptions: (value: ColorKeyOptions) => void;
  onBuild: () => void;
}) {
  const { metadata } = props;
  return (
    <div className="video-source-card">
      <h3>1. 影片 probe 與可調整固定格線</h3>
      <p className="tab-desc">
        {metadata.fileName} · {metadata.container} · {metadata.codec} · {metadata.width}×{metadata.height}
        {metadata.rotation ? `（rotation ${metadata.rotation}°）` : ''} · {metadata.frameCount} 個 presentation frames ·
        平均 {metadata.averageFps.toFixed(2)} fps。功能目前為 beta，Chrome 是驗收基線。
      </p>
      <Row>
        <Field label="輸出產品">
          <select disabled={props.busy} value={props.target} onChange={(event) => props.onTarget(event.target.value as VideoOutputTarget)}>
            <option value="animated-sticker">Animated Sticker（完整 LINE ZIP）</option>
            <option value="animated-emoji">Animated Emoji（完整 LINE ZIP）</option>
            <option value="popup">Pop-up Sticker（從每張動畫挑靜態 frame）</option>
            <option value="effect" disabled>Effect Sticker（尚未實作）</option>
          </select>
        </Field>
        <Field label="來源貼圖格數"><input disabled={props.busy} type="number" min={1} max={props.cols * props.rows} value={props.count} onChange={(event) => props.onCount(Number(event.target.value))} /></Field>
        <Field label="欄"><input disabled={props.busy} type="number" min={1} max={12} value={props.cols} onChange={(event) => props.onCols(Number(event.target.value))} /></Field>
        <Field label="列"><input disabled={props.busy} type="number" min={1} max={12} value={props.rows} onChange={(event) => props.onRows(Number(event.target.value))} /></Field>
        <Field label="貼圖包名"><input disabled={props.busy} value={props.name} onChange={(event) => props.onName(event.target.value)} /></Field>
        <Field label={props.target === 'animated-emoji' ? '縮圖來源第幾張' : '封面第幾張'}><input disabled={props.busy} type="number" min={1} max={props.count} value={props.cover} onChange={(event) => props.onCover(Number(event.target.value))} /></Field>
      </Row>
      <Row>
        <Field label="專案預設去背">
          <select disabled={props.busy} value={props.defaultBackground} onChange={(event) => props.onBackground(event.target.value as VideoBackgroundMode)}>
            <option value="none">不去背</option>
            <option value="color-key">單色色鍵</option>
            <option value="imgly">IMG.LY（本機）</option>
            <option value="local-birefnet">本機 BiRefNet（實驗性）</option>
            <option value="colab-birefnet">Colab 多模型去背（實驗性）</option>
          </select>
        </Field>
        {props.defaultBackground === 'color-key' && colorKeyUsesEdge(props.colorKeyOptions) && (
          <Field label="背景中心"><label><input
            type="checkbox"
            checked={props.colorAutomatic}
            disabled={props.busy}
            onChange={(event) => props.onColorAutomatic(event.target.checked)}
          />自動取樣外框</label></Field>
        )}
        {props.defaultBackground === 'color-key' && <Field label="背景色"><input
          disabled={props.busy || (colorKeyUsesEdge(props.colorKeyOptions) && props.colorAutomatic)}
          type="color"
          value={props.color}
          onChange={(event) => { props.onColor(event.target.value); props.onColorAutomatic(false); }}
        /></Field>}
      </Row>
      {props.defaultBackground === 'color-key' && (
        <ColorKeyOptionFields
          value={props.colorKeyOptions}
          onChange={props.onColorKeyOptions}
          disabled={props.busy}
        />
      )}
      <LocalBirefnetRuntimeWarning active={props.defaultBackground === 'local-birefnet'} />
      <p className="tab-desc">
        產品會決定 raw master 與最終輸出尺寸，建立後不可切換。Effect Sticker 尚未實作，不會假裝輸出可上傳包。
        {props.target === 'animated-emoji'
          ? ' Animated Emoji 每張固定為 180×180、300KB 上限，ZIP 使用 001.png 起的三位數檔名且沒有 main.png。'
          : props.target === 'popup'
            ? ' Pop-up 動畫固定輸出 480×480；建立預覽後，每張可指定一個 frame 轉成配對的普通靜態貼圖，ZIP 同時包含 png/ 與 popup/。'
            : ' Animated Sticker 依來源比例 fit 到 320×270 範圍，至少一邊為 270px，單張 1MB 上限。'}
        外框與內部分隔線都可在 ingest 前調整；同一組來源像素邊界會固定套用到每個 presentation frame。去背不在 ingest 執行；只在你產生單張預覽時處理實際候選格。
      </p>
      <VideoCutRangeStep {...props.range} />
      {!props.grid && <div className="video-inline-error">網格容量不足、數值無效，或網格大於 display size。</div>}
      <button className="btn primary" disabled={props.busy || !props.grid || !!props.range.preflightError} onClick={props.onBuild}>
        擷取範圍內所有 frames 並建立 raw master
      </button>
    </div>
  );
}
