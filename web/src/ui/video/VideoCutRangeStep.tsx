import { useEffect, useMemo } from 'react';
import type { VideoGridPlan } from '@core/videoCrop.js';
import { Field, Row } from '../common.jsx';

function GridImage(props: { png: Uint8Array; grid: VideoGridPlan; label: string }) {
  const url = useMemo(
    () => URL.createObjectURL(new Blob([props.png.slice().buffer], { type: 'image/png' })),
    [props.png],
  );
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return (
    <figure className="video-grid-preview">
      <div className="video-grid-preview-media">
        <img src={url} alt={props.label} />
        <svg viewBox={`0 0 ${props.grid.sourceWidth} ${props.grid.sourceHeight}`} aria-label="裁切格線">
          {props.grid.rects.map((rect) => (
            <g key={rect.id}>
              <rect x={rect.left} y={rect.top} width={rect.width} height={rect.height} />
              <text x={rect.left + 8} y={rect.top + 22}>{String(rect.index + 1).padStart(2, '0')}</text>
            </g>
          ))}
        </svg>
      </div>
      <figcaption>{props.label}</figcaption>
    </figure>
  );
}

export function VideoCutRangeStep(props: {
  firstTimestampUs: number;
  endTimestampUs: number;
  rangeStartUs: number;
  rangeEndUs: number;
  scrubUs: number;
  grid: VideoGridPlan | null;
  previews: Array<{ label: string; png: Uint8Array }>;
  sourceFrames: number;
  cropFrames: number;
  estimatedBytes: number;
  preflightError: string | null;
  onRangeStartUs: (value: number) => void;
  onRangeEndUs: (value: number) => void;
  onScrubUs: (value: number) => void;
}) {
  const seconds = (value: number) => value / 1_000_000;
  return (
    <div className="video-cut-range-step">
      <h4>2. 切割示意與全域可編輯範圍</h4>
      <Row>
        <Field label="可編輯開始秒">
          <input type="number" step={0.001} min={seconds(props.firstTimestampUs)} max={seconds(props.endTimestampUs)} value={seconds(props.rangeStartUs)} onChange={(event) => props.onRangeStartUs(Math.round(Number(event.target.value) * 1_000_000))} />
        </Field>
        <Field label="可編輯結束秒">
          <input type="number" step={0.001} min={seconds(props.firstTimestampUs)} max={seconds(props.endTimestampUs)} value={seconds(props.rangeEndUs)} onChange={(event) => props.onRangeEndUs(Math.round(Number(event.target.value) * 1_000_000))} />
        </Field>
        <Field label="預覽時間">
          <input type="range" min={props.firstTimestampUs} max={props.endTimestampUs - 1} step={1000} value={props.scrubUs} onChange={(event) => props.onScrubUs(Number(event.target.value))} />
        </Field>
      </Row>
      <div className="video-preflight">
        實際來源 frames：<strong>{props.sourceFrames}</strong> · crop-frames：<strong>{props.cropFrames}</strong> ·
        raw RGBA 上限估算：<strong>{(props.estimatedBytes / 1024 / 1024).toFixed(1)} MiB</strong>
      </div>
      {props.preflightError && <div className="video-inline-error">{props.preflightError}</div>}
      {props.grid && (
        <div className="video-range-previews">
          {props.previews.map((preview) => <GridImage key={preview.label} {...preview} grid={props.grid!} />)}
        </div>
      )}
    </div>
  );
}
