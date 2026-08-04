import { useEffect, useState } from 'react';
import type { VideoGridPlan } from '@core/videoCrop.js';
import { emojiFileName, stickerFileName } from '@core/naming.js';
import type { VideoOutputTarget } from '@core/videoProject.js';
import { Field, Row } from '../common.jsx';

function GridImage(props: { png: Uint8Array; grid: VideoGridPlan; label: string; target: VideoOutputTarget }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const next = URL.createObjectURL(new Blob([props.png.slice().buffer], { type: 'image/png' }));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [props.png]);
  return (
    <figure className="video-grid-preview">
      <div className="video-grid-preview-media">
        {url && (
          <>
            <img src={url} alt={props.label} />
            <svg viewBox={`0 0 ${props.grid.sourceWidth} ${props.grid.sourceHeight}`} aria-label="裁切格線">
              {props.grid.rects.map((rect) => (
                <g key={rect.id}>
                  <rect x={rect.left} y={rect.top} width={rect.width} height={rect.height} />
                  <text x={rect.left + 8} y={rect.top + 22}>
                    {props.target === 'animated-emoji' ? emojiFileName(rect.index + 1) : stickerFileName(rect.index + 1)}
                  </text>
                </g>
              ))}
            </svg>
          </>
        )}
      </div>
      <figcaption>{props.label}</figcaption>
    </figure>
  );
}

export function VideoCutRangeStep(props: {
  target: VideoOutputTarget;
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
        <Field label="自選網格預覽時間">
          <input
            type="range"
            min={props.rangeStartUs}
            max={Math.max(props.rangeStartUs, props.rangeEndUs - 1)}
            step={1000}
            value={props.scrubUs}
            onChange={(event) => props.onScrubUs(Number(event.target.value))}
          />
          <output className="video-scrub-value">{seconds(props.scrubUs).toFixed(3)} 秒</output>
        </Field>
      </Row>
      <p className="layout-hint video-scrub-help">
        只會更新下方「自選」時間點的網格畫面，方便檢查切格；不會改變可編輯範圍或成品播放時間。
      </p>
      <div className="video-preflight">
        實際來源 frames：<strong>{props.sourceFrames}</strong> · crop-frames：<strong>{props.cropFrames}</strong> ·
        raw RGBA 上限估算：<strong>{(props.estimatedBytes / 1024 / 1024).toFixed(1)} MiB</strong>
      </div>
      {props.preflightError && <div className="video-inline-error">{props.preflightError}</div>}
      {props.grid && (
        <div className="video-range-previews">
          {props.previews.map((preview) => <GridImage key={preview.label} {...preview} grid={props.grid!} target={props.target} />)}
        </div>
      )}
    </div>
  );
}
