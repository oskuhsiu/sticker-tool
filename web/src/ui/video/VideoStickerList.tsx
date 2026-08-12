import { emojiFileName, stickerFileName } from '@core/naming.js';
import type { VideoOutputTarget } from '@core/videoProject.js';
import type { VideoRenderSnapshot, VideoStickerSettings } from '../../webpipe/processMasterApngSticker.js';
import { PngPreview, kb } from '../common.jsx';

export function VideoStickerList(props: {
  target: VideoOutputTarget;
  settings: VideoStickerSettings[];
  current: Array<VideoRenderSnapshot | null>;
  posters: Uint8Array[];
  activeIndex: number;
  onSelect: (index: number) => void;
  isDirty: (index: number) => boolean;
  editedVisualCount?: (stickerId: string) => number;
}) {
  return (
    <div className="video-sticker-list">
      {props.settings.map((settings, index) => {
        const current = props.current[index];
        const dirty = props.isDirty(index);
        const editedVisuals = props.editedVisualCount?.(settings.stickerId) ?? 0;
        return (
          <button
            type="button"
            className={`video-sticker-list-item ${index === props.activeIndex ? 'active' : ''} ${dirty ? 'dirty' : ''}`}
            key={settings.stickerId}
            onClick={() => props.onSelect(index)}
          >
            {props.posters[index] && <PngPreview bytes={props.posters[index]!} caption="raw poster" />}
            <span><strong>{props.target === 'animated-emoji'
              ? emojiFileName(index + 1)
              : props.target === 'popup'
                ? `popup/${stickerFileName(index + 1)}`
                : stickerFileName(index + 1)}</strong></span>
            <span>{current ? `${current.metrics.outputFrames} 格 · ${kb(current.png.length)}` : '尚未產生成品'}</span>
            {editedVisuals > 0 && <span>● {editedVisuals} 個 raw visuals 有保留修正</span>}
            <span>{dirty ? '● draft' : current?.errors.length ? '⚠ 不合規' : '✓ current'}</span>
          </button>
        );
      })}
    </div>
  );
}
