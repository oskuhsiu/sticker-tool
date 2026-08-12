import { useEffect, useRef } from 'react';
import type { ColorKeyCalibrationDiagnostics } from '../../webpipe/preparedColorKey.js';
import type { KeepMask } from '../../webpipe/foregroundCorrection.js';
import type { VideoRawVisualFrame } from '../../webpipe/processMasterApngSticker.js';
import type { Raster } from '../../webpipe/raster.js';
import { ForegroundCorrectionEditor } from '../ForegroundCorrectionEditor.jsx';

function RasterCanvas(props: { raster: Raster; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    canvas.width = props.raster.width;
    canvas.height = props.raster.height;
    canvas.getContext('2d')?.putImageData(
      new ImageData(new Uint8ClampedArray(props.raster.data), props.raster.width, props.raster.height),
      0,
      0,
    );
  }, [props.raster]);
  return <canvas className="video-key-canvas small" ref={ref} role="img" aria-label={props.label} />;
}

export interface VideoCorrectionPreview {
  readonly visual: VideoRawVisualFrame;
  readonly automatic: Raster;
  readonly mask: KeepMask;
  readonly diagnostics?: ColorKeyCalibrationDiagnostics;
}

export function VideoForegroundCorrectionPanel(props: {
  mode: string;
  visuals: readonly VideoRawVisualFrame[];
  selectedVisualFrameId: string | null;
  preview: VideoCorrectionPreview | null;
  editedVisualIds: ReadonlySet<string>;
  loading: boolean;
  error: string | null;
  busy: boolean;
  onSelect: (visualFrameId: string) => void;
  onMaskChange: (mask: KeepMask) => void;
  onCopyToRange: () => void;
  onClearSticker: () => void;
}) {
  const selectedIndex = props.visuals.findIndex((visual) => visual.visualFrameId === props.selectedVisualFrameId);
  return (
    <section className="video-key-preview" data-testid="video-foreground-correction">
      <h4>Raw visual 去背與保留筆刷</h4>
      <p className="tab-desc">
        這裡顯示目前時間範圍內的唯一 raw visuals；重複的 presentation samples 共用同一筆修正。
        複製到全範圍是固定座標複製，不是物件追蹤。
      </p>
      {props.loading && <div role="status">正在載入並校準 raw visuals…</div>}
      {props.error && <div className="video-inline-error">Raw visual 載入失敗：{props.error}</div>}
      {!props.loading && props.visuals.length > 0 && (
        <>
          <div className="video-key-frame-selector" role="group" aria-label="Raw visual 選擇">
            {props.visuals.map((visual, index) => {
              const edited = props.editedVisualIds.has(visual.visualFrameId);
              return (
                <button
                  type="button"
                  className={visual.visualFrameId === props.selectedVisualFrameId ? 'selected' : ''}
                  aria-pressed={visual.visualFrameId === props.selectedVisualFrameId}
                  aria-label={`選擇 raw visual ${index + 1}${edited ? '，已有保留修正' : ''}`}
                  key={visual.visualFrameId}
                  onClick={() => props.onSelect(visual.visualFrameId)}
                >
                  <RasterCanvas raster={visual.frame} label={`Raw visual ${index + 1}`} />
                  <span>{edited ? '● ' : ''}{index + 1}/{props.visuals.length} · {(visual.timestampUs / 1_000_000).toFixed(3)}s</span>
                </button>
              );
            })}
          </div>
          <div className="run-row">
            <button
              className="btn small"
              type="button"
              disabled={props.busy || !props.preview}
              onClick={props.onCopyToRange}
            >
              將目前保留區複製到這個時間範圍
            </button>
            <span>
              {selectedIndex >= 0 ? `目前第 ${selectedIndex + 1} 個 visual` : '尚未選取'}；
              {props.editedVisualIds.size} 個 visual 有修正
            </span>
          </div>
        </>
      )}
      {props.mode === 'none' && (
        <p className="tab-desc">目前是「不去背」；既有保留修正會保留，但不需要套用。</p>
      )}
      {props.preview && props.mode !== 'none' && (
        <ForegroundCorrectionEditor
          source={props.preview.visual.frame}
          automatic={props.preview.automatic}
          mask={props.preview.mask}
          onMaskChange={props.onMaskChange}
          sourceIdentity={props.preview.visual.visualFrameId}
          label={`raw visual ${selectedIndex + 1}`}
          disabled={props.busy}
          status={`校準：${props.preview.diagnostics?.detectedColor?.join(', ') ?? '語意模型'}；修正只作用於此 raw visual`}
          diagnostics={props.preview.diagnostics?.warnings.length
            ? <span>{props.preview.diagnostics.warnings.join('；')}</span>
            : undefined}
          onClearAll={props.onClearSticker}
        />
      )}
    </section>
  );
}
