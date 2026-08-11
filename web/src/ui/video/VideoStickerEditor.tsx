import { useEffect, useMemo, useRef, useState } from 'react';
import { parseColor } from '@core/color.js';
import { emojiFileName, stickerFileName } from '@core/naming.js';
import { ANIMATED_EMOJI_SPEC, ANIMATED_SPEC, POPUP_STICKER_SPEC } from '@core/spec.js';
import { DEFAULT_COLOR_KEY_OPTIONS, copyColorKeyOptions } from '@core/colorKey.js';
import type { VideoBackgroundMode, VideoOutputTarget } from '@core/videoProject.js';
import {
  validateVideoStickerSettings,
  type VideoRepresentativeFrame,
  type VideoRenderSnapshot,
  type VideoStickerSettings,
} from '../../webpipe/processMasterApngSticker.js';
import { decodeApngFrames } from '../../webpipe/apng.js';
import { encodePng } from '../../webpipe/png.js';
import { chromaKeySolid } from '../../webpipe/sheetAnalysis.js';
import type { Raster } from '../../webpipe/raster.js';
import { Field, PngPreview, Row, kb } from '../common.jsx';
import { ColorKeyOptionFields } from '../BackgroundRemovalControl.jsx';
import { ApngTimelinePlayer } from './ApngTimelinePlayer.jsx';

function RasterCanvas(props: { raster: Raster; label: string; small?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    canvas.width = props.raster.width;
    canvas.height = props.raster.height;
    const context = canvas.getContext('2d');
    context?.putImageData(
      new ImageData(new Uint8ClampedArray(props.raster.data), props.raster.width, props.raster.height),
      0,
      0,
    );
  }, [props.raster]);
  return <canvas className={props.small ? 'video-key-canvas small' : 'video-key-canvas'} ref={ref} role="img" aria-label={props.label} />;
}

export function VideoStickerEditor(props: {
  target: VideoOutputTarget;
  index: number;
  settings: VideoStickerSettings;
  current: VideoRenderSnapshot | null;
  rangeStartUs: number;
  rangeEndUs: number;
  legacyBaked: boolean;
  busy: boolean;
  dirty: boolean;
  representativeFrames: VideoRepresentativeFrame[];
  representativeFramesLoading: boolean;
  representativeFramesError: string | null;
  onChange: (settings: VideoStickerSettings) => void;
  onRender: () => void;
}) {
  const { settings } = props;
  const contract = props.target === 'animated-emoji'
    ? ANIMATED_EMOJI_SPEC
    : props.target === 'popup'
      ? POPUP_STICKER_SPEC
      : ANIMATED_SPEC;
  const errors = validateVideoStickerSettings(settings, props.target);
  const seconds = (value: number) => value / 1_000_000;
  const setBackgroundMode = (mode: VideoBackgroundMode) => props.onChange({
    ...settings,
    background: mode === 'color-key'
      ? {
          mode,
          color: settings.background.color ?? '#00ff00',
          colorKey: settings.background.colorKey ?? copyColorKeyOptions(DEFAULT_COLOR_KEY_OPTIONS),
        }
      : { mode },
  });
  const legalLoops = [1, 2, 3, 4].filter((loops) =>
    loops <= contract.maxLoops && settings.perLoopDurationMs * loops <= contract.maxDurationSec * 1000,
  );
  const durationsMs = contract.playbackDurationsSec.map((seconds) => seconds * 1000);
  const sourceSpanMs = (settings.rangeEndUs - settings.rangeStartUs) / 1000;
  const speed = sourceSpanMs > 0 ? sourceSpanMs / settings.perLoopDurationMs : 0;
  const colorMode = settings.preserveColors ? 'original' : String(settings.maxColors);
  const staticFrameIndex = settings.staticFrameIndex ?? 0;
  const [representativeIndex, setRepresentativeIndex] = useState(0);
  useEffect(() => setRepresentativeIndex(0), [settings.stickerId, props.representativeFrames]);
  const representative = props.representativeFrames[
    Math.min(representativeIndex, Math.max(0, props.representativeFrames.length - 1))
  ];
  const wholeImagePreview = useMemo(() => {
    if (
      !representative ||
      settings.background.mode !== 'color-key' ||
      settings.background.colorKey.scope !== 'whole-image'
    ) return null;
    const parsed = parseColor(settings.background.color ?? '#00ff00');
    const keyed = chromaKeySolid(
      representative.frame,
      [parsed.r, parsed.g, parsed.b],
      settings.background.colorKey,
    );
    let removedPixels = 0;
    for (let index = 3; index < keyed.data.length; index += 4) {
      if (representative.frame.data[index]! > 0 && keyed.data[index] === 0) removedPixels++;
    }
    return { keyed, removedPixels, totalPixels: keyed.width * keyed.height };
  }, [representative, settings.background]);
  const staticFramePreview = useMemo(() => {
    if (props.target !== 'popup' || !props.current) return null;
    const frames = decodeApngFrames(props.current.png).frames;
    const frame = frames[Math.min(staticFrameIndex, Math.max(0, frames.length - 1))];
    return frame ? encodePng(frame, 0, true) : null;
  }, [props.current, props.target, staticFrameIndex]);
  const editorName = props.target === 'animated-emoji'
    ? emojiFileName(props.index + 1)
    : props.target === 'popup'
      ? `popup/${stickerFileName(props.index + 1)}`
      : stickerFileName(props.index + 1);
  return (
    <article className="video-sticker-editor">
      <h3>{editorName} 編輯器</h3>
      {props.legacyBaked && (
        <div className="video-inline-error">舊版 sampled/baked Project：只能使用已保存時間點，不能恢復未去背 RGB 或更換去背模式。</div>
      )}
      <Row>
        <Field label="本張開始秒"><input type="number" step={0.001} min={seconds(props.rangeStartUs)} max={seconds(props.rangeEndUs)} value={seconds(settings.rangeStartUs)} onChange={(event) => props.onChange({ ...settings, rangeStartUs: Math.round(Number(event.target.value) * 1_000_000) })} /></Field>
        <Field label="本張結束秒"><input type="number" step={0.001} min={seconds(props.rangeStartUs)} max={seconds(props.rangeEndUs)} value={seconds(settings.rangeEndUs)} onChange={(event) => props.onChange({ ...settings, rangeEndUs: Math.round(Number(event.target.value) * 1_000_000) })} /></Field>
        <Field label="目標格數"><input type="number" min={contract.minFrames} max={contract.maxFrames} value={settings.targetFrames} onChange={(event) => {
          const targetFrames = Number(event.target.value);
          props.onChange({
            ...settings,
            targetFrames,
            staticFrameIndex: props.target === 'popup'
              ? Math.min(staticFrameIndex, Math.max(0, targetFrames - 1))
              : settings.staticFrameIndex,
          });
        }} /></Field>
        <Field label="單輪播放"><select value={settings.perLoopDurationMs} onChange={(event) => props.onChange({ ...settings, perLoopDurationMs: Number(event.target.value) as VideoStickerSettings['perLoopDurationMs'] })}>{durationsMs.map((value) => <option key={value} value={value}>{value / 1000} 秒</option>)}</select></Field>
        <Field label="循環"><select value={settings.loops} onChange={(event) => props.onChange({ ...settings, loops: Number(event.target.value) as VideoStickerSettings['loops'] })}>{legalLoops.map((value) => <option key={value} value={value}>{value}</option>)}</select></Field>
        {props.target === 'popup' && (
          <Field label="配對靜態圖使用 frame">
            <select
              aria-label="配對靜態圖使用 frame"
              value={staticFrameIndex}
              onChange={(event) => props.onChange({ ...settings, staticFrameIndex: Number(event.target.value) })}
            >
              {Array.from({ length: Math.max(0, settings.targetFrames) }, (_, index) => (
                <option key={index} value={index}>第 {index + 1} 格</option>
              ))}
            </select>
          </Field>
        )}
      </Row>
      <Row>
        <Field label="去背模式"><select disabled={props.legacyBaked} value={settings.background.mode} onChange={(event) => setBackgroundMode(event.target.value as VideoBackgroundMode)}><option value="none">不去背</option><option value="color-key">單色色鍵</option><option value="imgly">IMG.LY（本機）</option><option value="local-birefnet">本機 BiRefNet</option><option value="colab-birefnet">Colab 多模型去背</option></select></Field>
        {settings.background.mode === 'color-key' && <Field label="背景色"><input type="color" value={settings.background.color ?? '#00ff00'} onChange={(event) => {
          if (settings.background.mode !== 'color-key') return;
          props.onChange({ ...settings, background: { ...settings.background, color: event.target.value } });
        }} /></Field>}
        <details>
          <summary>進階壓縮</summary>
          <Field label="減色上限"><select value={colorMode} onChange={(event) => {
            const preserveColors = event.target.value === 'original';
            props.onChange({
              ...settings,
              preserveColors,
              maxColors: preserveColors ? 0 : Number(event.target.value),
            });
          }}><option value="0">自動</option><option value="original">不減色（原色）</option><option value="256">256</option><option value="128">128</option><option value="64">64</option><option value="32">32</option></select></Field>
        </details>
      </Row>
      {settings.background.mode === 'color-key' && (
        <ColorKeyOptionFields
          value={settings.background.colorKey}
          onChange={(colorKey) => {
            if (settings.background.mode !== 'color-key') return;
            props.onChange({
              ...settings,
              background: { ...settings.background, colorKey },
            });
          }}
          disabled={props.legacyBaked}
        />
      )}
      {settings.background.mode === 'color-key' && settings.background.colorKey.scope === 'whole-image' && (
        <section className="video-key-preview" data-testid="video-whole-image-preview">
          <h4>全圖色碼即時預覽</h4>
          <p className="tab-desc">從目前目標格數的初選候選中取最多 3 張代表影格；拖動容差只重算選中的原始 Raster，不重新編碼 APNG。</p>
          {props.representativeFramesLoading && <div role="status">正在載入代表影格…</div>}
          {props.representativeFramesError && <div className="video-inline-error">代表影格載入失敗：{props.representativeFramesError}</div>}
          {!props.representativeFramesLoading && props.representativeFrames.length > 0 && (
            <>
              <div className="video-key-frame-selector" role="group" aria-label="全圖色碼預覽影格">
                {props.representativeFrames.map((item, index) => (
                  <button
                    type="button"
                    className={index === representativeIndex ? 'selected' : ''}
                    aria-pressed={index === representativeIndex}
                    aria-label={`選擇全圖色碼預覽影格 ${index + 1}`}
                    key={`${item.sourceIndex}-${item.timestampUs}`}
                    onClick={() => setRepresentativeIndex(index)}
                  >
                    <RasterCanvas raster={item.frame} label={`初選第 ${item.candidateIndex + 1} 格原圖`} small />
                    <span>初選第 {item.candidateIndex + 1} 格 · {(item.timestampUs / 1_000_000).toFixed(3)}s</span>
                  </button>
                ))}
              </div>
              {representative && wholeImagePreview && (
                <div className="video-key-preview-result">
                  <figure>
                    <RasterCanvas raster={representative.frame} label="全圖色碼處理前" />
                    <figcaption>處理前</figcaption>
                  </figure>
                  <figure>
                    <RasterCanvas raster={wholeImagePreview.keyed} label="全圖色碼即時處理後" />
                    <figcaption>即時結果：挖除 {wholeImagePreview.removedPixels.toLocaleString()} / {wholeImagePreview.totalPixels.toLocaleString()} pixels</figcaption>
                  </figure>
                </div>
              )}
            </>
          )}
        </section>
      )}
      <p className="tab-desc">
        來源 {(sourceSpanMs / 1000).toFixed(3)} 秒 → 成品 {(settings.perLoopDurationMs / 1000).toFixed(0)} 秒（{speed.toFixed(2)}× 播放速度）。
        {props.target === 'popup' ? ` 打包時會把第 ${staticFrameIndex + 1} 格等比轉成 png/${stickerFileName(props.index + 1)}。` : ''}
      </p>
      {errors.length > 0 && <div className="video-inline-error">{errors.join('；')}</div>}
      <div className="run-row">
        <button className="btn primary" disabled={props.busy || errors.length > 0 || !props.dirty} onClick={props.onRender}>
          {props.busy ? '處理中…' : '產生這張預覽'}
        </button>
        <span>{props.dirty ? 'draft 尚未套用' : 'current 與設定一致'}</span>
      </div>
      {props.current && (
        <div className="video-current-render">
          <ApngTimelinePlayer png={props.current.png} active label={`第 ${props.index + 1} 張成品預覽`} />
          <div className="video-metrics">
            {props.current.metrics.width}×{props.current.metrics.height} · final {props.current.metrics.outputFrames}/{props.current.metrics.requestedFrames} 格 · {kb(props.current.png.length)} ·
            delays {props.current.metrics.frameDelaysMs.join(', ')}ms · distinct {props.current.metrics.distinctFrames} ·
            adjacent duplicates {props.current.metrics.adjacentDuplicateFrames}
          </div>
          <div className="video-first-frame-note">請確認預覽第一格即使靜止顯示，仍能表達貼圖含意。</div>
          {props.target === 'popup' && staticFramePreview && (
            <div className="video-popup-static-preview">
              <PngPreview
                bytes={staticFramePreview}
                caption={`配對靜態來源：第 ${staticFrameIndex + 1} 格（打包時轉成普通靜態貼圖尺寸）`}
              />
            </div>
          )}
          {props.current.notes.length > 0 && <ul>{props.current.notes.map((note, index) => <li key={index}>{note}</li>)}</ul>}
        </div>
      )}
    </article>
  );
}
