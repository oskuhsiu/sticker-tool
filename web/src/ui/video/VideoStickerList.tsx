import type { VideoRenderSnapshot, VideoStickerSettings } from '../../webpipe/processMasterApngSticker.js';
import { PngPreview, kb } from '../common.jsx';

export function VideoStickerList(props: {
  settings: VideoStickerSettings[];
  current: Array<VideoRenderSnapshot | null>;
  posters: Uint8Array[];
  activeIndex: number;
  onSelect: (index: number) => void;
  isDirty: (index: number) => boolean;
}) {
  return (
    <div className="video-sticker-list">
      {props.settings.map((settings, index) => {
        const current = props.current[index];
        const dirty = props.isDirty(index);
        return (
          <button
            type="button"
            className={`video-sticker-list-item ${index === props.activeIndex ? 'active' : ''} ${dirty ? 'dirty' : ''}`}
            key={settings.stickerId}
            onClick={() => props.onSelect(index)}
          >
            {props.posters[index] && <PngPreview bytes={props.posters[index]!} caption="raw poster" />}
            <span><strong>{String(index + 1).padStart(2, '0')}.png</strong></span>
            <span>{current ? `${current.metrics.outputFrames} 格 · ${kb(current.png.length)}` : '尚未產生成品'}</span>
            <span>{dirty ? '● draft' : current?.errors.length ? '⚠ 不合規' : '✓ current'}</span>
          </button>
        );
      })}
    </div>
  );
}
