import { useMemo, type ReactNode } from 'react';
import { emojiFileName, stickerFileName } from '@core/naming.js';
import { ANIMATED_EMOJI_SPEC, ANIMATED_SPEC, POPUP_STICKER_SPEC } from '@core/spec.js';
import { DEFAULT_COLOR_KEY_OPTIONS, colorKeyUsesEdge, copyColorKeyOptions } from '@core/colorKey.js';
import type { VideoBackgroundMode, VideoOutputTarget } from '@core/videoProject.js';
import {
  validateVideoStickerSettings,
  type VideoRenderSnapshot,
  type VideoStickerSettings,
} from '../../webpipe/processMasterApngSticker.js';
import { decodeApngFrames } from '../../webpipe/apng.js';
import { encodePng } from '../../webpipe/png.js';
import { Field, PngPreview, Row, kb } from '../common.jsx';
import { ColorKeyOptionFields } from '../BackgroundRemovalControl.jsx';
import { ApngTimelinePlayer } from './ApngTimelinePlayer.jsx';

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
  correctionPanel?: ReactNode;
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
        {settings.background.mode === 'color-key' && colorKeyUsesEdge(settings.background.colorKey) && (
          <Field label="背景中心"><label><input
            type="checkbox"
            checked={settings.background.color === undefined}
            disabled={props.legacyBaked}
            onChange={(event) => {
              if (settings.background.mode !== 'color-key') return;
              const { color: _color, ...background } = settings.background;
              props.onChange({
                ...settings,
                background: event.target.checked ? background : { ...background, color: '#00ff00' },
              });
            }}
          />自動取樣外框</label></Field>
        )}
        {settings.background.mode === 'color-key' && <Field label="背景色"><input
          type="color"
          value={settings.background.color ?? '#00ff00'}
          disabled={props.legacyBaked || (colorKeyUsesEdge(settings.background.colorKey) && settings.background.color === undefined)}
          onChange={(event) => {
            if (settings.background.mode !== 'color-key') return;
            props.onChange({ ...settings, background: { ...settings.background, color: event.target.value } });
          }}
        /></Field>}
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
              background: {
                ...settings.background,
                ...(colorKey.scope === 'whole-image' && settings.background.color === undefined
                  ? { color: '#00ff00' }
                  : {}),
                colorKey,
              },
            });
          }}
          disabled={props.legacyBaked}
        />
      )}
      {props.correctionPanel}
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
