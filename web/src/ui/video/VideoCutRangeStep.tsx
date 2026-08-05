import { useState } from 'react';
import type { VideoAxisCuts, VideoGridPlan } from '@core/videoCrop.js';
import type { VideoOutputTarget } from '@core/videoProject.js';
import { Field, Row } from '../common.jsx';
import { VideoGridEditor } from './VideoGridEditor.jsx';

export function VideoCutRangeStep(props: {
  target: VideoOutputTarget;
  firstTimestampUs: number;
  endTimestampUs: number;
  rangeStartUs: number;
  rangeEndUs: number;
  scrubUs: number;
  grid: VideoGridPlan | null;
  xCuts: VideoAxisCuts | null;
  yCuts: VideoAxisCuts | null;
  previews: Array<{ label: string; png: Uint8Array }>;
  sourceFrames: number;
  cropFrames: number;
  estimatedBytes: number;
  preflightError: string | null;
  disabled: boolean;
  onRangeStartUs: (value: number) => void;
  onRangeEndUs: (value: number) => void;
  onScrubUs: (value: number) => void;
  onXCuts: (cuts: number[]) => void;
  onYCuts: (cuts: number[]) => void;
  onRestoreEqual: () => void;
}) {
  const [selectedPreview, setSelectedPreview] = useState(0);
  const seconds = (value: number) => value / 1_000_000;
  const activePreview = props.previews[selectedPreview] ?? props.previews[0];
  return (
    <div className="video-cut-range-step">
      <h4>2. 切割示意與全域可編輯範圍</h4>
      <Row>
        <Field label="可編輯開始秒">
          <input disabled={props.disabled} type="number" step={0.001} min={seconds(props.firstTimestampUs)} max={seconds(props.endTimestampUs)} value={seconds(props.rangeStartUs)} onChange={(event) => props.onRangeStartUs(Math.round(Number(event.target.value) * 1_000_000))} />
        </Field>
        <Field label="可編輯結束秒">
          <input disabled={props.disabled} type="number" step={0.001} min={seconds(props.firstTimestampUs)} max={seconds(props.endTimestampUs)} value={seconds(props.rangeEndUs)} onChange={(event) => props.onRangeEndUs(Math.round(Number(event.target.value) * 1_000_000))} />
        </Field>
        <Field label="自選網格預覽時間">
          <input
            type="range"
            min={props.rangeStartUs}
            max={Math.max(props.rangeStartUs, props.rangeEndUs - 1)}
            step={1000}
            value={props.scrubUs}
            disabled={props.disabled}
            onChange={(event) => props.onScrubUs(Number(event.target.value))}
          />
          <output className="video-scrub-value">{seconds(props.scrubUs).toFixed(3)} 秒</output>
        </Field>
      </Row>
      <p className="layout-hint video-scrub-help">
        用開始／中間／結束／自選按鈕切換同一個大型編輯畫面；自選滑桿不會改變可編輯範圍或成品播放時間。
      </p>
      <div className="video-preflight">
        實際來源 frames：<strong>{props.sourceFrames}</strong> · crop-frames：<strong>{props.cropFrames}</strong> ·
        raw RGBA 上限估算：<strong>{(props.estimatedBytes / 1024 / 1024).toFixed(1)} MiB</strong>
      </div>
      {props.preflightError && <div className="video-inline-error">{props.preflightError}</div>}
      {props.grid && props.xCuts && props.yCuts && props.previews.length > 0 && (
        <div className="video-grid-editor-shell">
          <div className="video-grid-time-selectors" role="group" aria-label="格線檢查時間">
            {props.previews.map((preview, index) => (
              <button
                key={index}
                type="button"
                className={`btn small ${index === selectedPreview ? 'primary' : ''}`}
                aria-pressed={index === selectedPreview}
                onClick={() => setSelectedPreview(index)}
              >
                {preview.label}
              </button>
            ))}
          </div>
          {activePreview && (
            <VideoGridEditor
              {...activePreview}
              target={props.target}
              grid={props.grid}
              xCuts={props.xCuts}
              yCuts={props.yCuts}
              disabled={props.disabled}
              onXCuts={props.onXCuts}
              onYCuts={props.onYCuts}
              onRestoreEqual={props.onRestoreEqual}
            />
          )}
        </div>
      )}
    </div>
  );
}
