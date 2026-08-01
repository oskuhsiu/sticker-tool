import type { VideoGridPlan } from '@core/videoCrop.js';
import type { VideoBackgroundMode } from '@core/videoProject.js';
import type { VideoMetadata } from '../../webpipe/videoSource.js';
import { Field, Row } from '../common.jsx';
import { VideoCutRangeStep } from './VideoCutRangeStep.jsx';

export function VideoSourceStep(props: {
  metadata: VideoMetadata;
  count: number;
  cols: number;
  rows: number;
  name: string;
  cover: number;
  defaultBackground: VideoBackgroundMode;
  color: string;
  grid: VideoGridPlan | null;
  range: React.ComponentProps<typeof VideoCutRangeStep>;
  busy: boolean;
  onCount: (value: number) => void;
  onCols: (value: number) => void;
  onRows: (value: number) => void;
  onName: (value: string) => void;
  onCover: (value: number) => void;
  onBackground: (value: VideoBackgroundMode) => void;
  onColor: (value: string) => void;
  onBuild: () => void;
}) {
  const { metadata } = props;
  return (
    <div className="video-source-card">
      <h3>1. 影片 probe 與固定格線</h3>
      <p className="tab-desc">
        {metadata.fileName} · {metadata.container} · {metadata.codec} · {metadata.width}×{metadata.height}
        {metadata.rotation ? `（rotation ${metadata.rotation}°）` : ''} · {metadata.frameCount} 個 presentation frames ·
        平均 {metadata.averageFps.toFixed(2)} fps。功能目前為 beta，Chrome 是驗收基線。
      </p>
      <Row>
        <Field label="來源貼圖格數"><input type="number" min={1} max={props.cols * props.rows} value={props.count} onChange={(event) => props.onCount(Number(event.target.value))} /></Field>
        <Field label="欄"><input type="number" min={1} max={12} value={props.cols} onChange={(event) => props.onCols(Number(event.target.value))} /></Field>
        <Field label="列"><input type="number" min={1} max={12} value={props.rows} onChange={(event) => props.onRows(Number(event.target.value))} /></Field>
        <Field label="貼圖包名"><input value={props.name} onChange={(event) => props.onName(event.target.value)} /></Field>
        <Field label="封面第幾張"><input type="number" min={1} max={props.count} value={props.cover} onChange={(event) => props.onCover(Number(event.target.value))} /></Field>
      </Row>
      <Row>
        <Field label="專案預設去背">
          <select value={props.defaultBackground} onChange={(event) => props.onBackground(event.target.value as VideoBackgroundMode)}>
            <option value="none">不去背</option>
            <option value="color-key">單色色鍵</option>
            <option value="imgly">IMG.LY（本機）</option>
            <option value="local-birefnet">本機 BiRefNet（實驗性）</option>
            <option value="colab-birefnet">Colab BiRefNet（實驗性）</option>
          </select>
        </Field>
        {props.defaultBackground === 'color-key' && <Field label="背景色"><input type="color" value={props.color} onChange={(event) => props.onColor(event.target.value)} /></Field>}
      </Row>
      <p className="tab-desc">去背不在 ingest 執行；只在你產生單張預覽時處理實際候選格。</p>
      <VideoCutRangeStep {...props.range} />
      {!props.grid && <div className="video-inline-error">網格容量不足、數值無效，或網格大於 display size。</div>}
      <button className="btn primary" disabled={props.busy || !props.grid || !!props.range.preflightError} onClick={props.onBuild}>
        擷取範圍內所有 frames 並建立 raw master
      </button>
    </div>
  );
}
