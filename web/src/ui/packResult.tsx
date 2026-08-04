/** Pack result display for Sticker packs and main-less Emoji packs. */

import { useEffect, useMemo } from 'react';
import type { ValidationResult } from '@core/types.js';
import type { ImageInfo } from '@core/validate.js';
import { downloadBytes, safeName } from '../webpipe/zip.js';
import { kb, PngPreview, ValidationView } from './common.jsx';

interface PackResultBase {
  name: string;
  stickers: { png: Uint8Array; info: ImageInfo; notes: string[] }[];
  tab: Uint8Array;
  zip: Uint8Array;
  validation: ValidationResult;
}

/** Legacy callers can omit `kind` and remain on the Sticker archive shape. */
export interface StickerPackResultData extends PackResultBase {
  kind?: 'sticker';
  main: Uint8Array;
  /** 動態包 main 是 APNG */
  animated?: boolean;
}

/** Emoji archives intentionally have no uploaded main.png. */
export interface EmojiPackResultData extends PackResultBase {
  kind: 'emoji' | 'animated-emoji';
  animated?: boolean;
}

export type PackResultData = StickerPackResultData | EmojiPackResultData;

export function PackResult(props: { data: PackResultData; onReduceColors?: () => void }) {
  const { data, onReduceColors } = props;
  const valid = data.validation.ok;
  const emoji = data.kind === 'emoji' || data.kind === 'animated-emoji';
  const main = 'main' in data ? data.main : undefined;
  const canOfferColorReduction = !valid && !!onReduceColors && hasByteLimitIssue(data.validation);
  return (
    <div className="pack-result">
      {canOfferColorReduction && (
        <ColorReductionPrompt onRetry={onReduceColors} />
      )}
      <div className="pack-actions">
        <button
          className="btn primary"
          disabled={!valid}
          onClick={() => downloadBytes(`${safeName(data.name)}.zip`, data.zip, 'application/zip')}
        >
          {valid ? `下載上架包 zip（${kb(data.zip.length)}）` : '驗證未通過，不能下載上架包'}
        </button>
        {main && (
          <button className="btn" onClick={() => downloadBytes('main.png', main, 'image/png')}>
            main.png
          </button>
        )}
        <button className="btn" onClick={() => downloadBytes('tab.png', data.tab, 'image/png')}>
          tab.png
        </button>
      </div>
      <ValidationView result={data.validation} />
      {emoji && data.stickers[0] && (
        <EmojiScalePreview bytes={data.stickers[0].png} animated={data.kind === 'animated-emoji'} />
      )}
      <div className="sticker-grid">
        {main && (
          <PngPreview bytes={main} caption={`main.png ${kb(main.length)}${data.animated ? '（APNG）' : ''}`} />
        )}
        <PngPreview bytes={data.tab} caption={`tab.png ${kb(data.tab.length)}`} />
        {data.stickers.map((s, i) => (
          <PngPreview
            key={i}
            bytes={s.png}
            caption={`${String(i + 1).padStart(emoji ? 3 : 2, '0')}.png ${s.info.width}×${s.info.height} ${kb(s.info.bytes)}`}
          />
        ))}
      </div>
    </div>
  );
}

export function ColorReductionPrompt(props: { onRetry?: () => void; message?: string }) {
  const { onRetry, message } = props;
  return (
    <div className="validation warn" data-testid="color-reduction-prompt">
      {message ?? '成品超過單檔或整包容量上限。系統沒有自動降色；你可以修改素材，或明確選擇降色後重試。'}
      {onRetry && (
        <button className="btn" data-testid="reduce-colors-retry" onClick={onRetry}>
          嘗試降色並重新打包
        </button>
      )}
    </div>
  );
}

function EmojiScalePreview(props: { bytes: Uint8Array; animated: boolean }) {
  const { bytes, animated } = props;
  const url = useMemo(() => {
    const exactBytes = new Uint8Array(bytes.byteLength);
    exactBytes.set(bytes);
    return URL.createObjectURL(new Blob([exactBytes.buffer], { type: 'image/png' }));
  }, [bytes]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const imageStyle = {
    objectFit: 'contain',
    maxWidth: 'none',
    maxHeight: 'none',
  } as const;
  return (
    <div className="sticker-grid" data-testid="emoji-scale-preview">
      <figure className="png-preview">
        <img
          src={url}
          alt="第一張 Emoji 的 180×180 預覽"
          width={180}
          height={180}
          style={imageStyle}
        />
        <figcaption>第一張：完整 180×180{animated ? '（APNG）' : ''}</figcaption>
      </figure>
      <figure className="png-preview">
        <img
          src={url}
          alt="第一張 Emoji 的聊天尺寸預覽"
          width={32}
          height={32}
          style={imageStyle}
        />
        <figcaption>聊天尺寸模擬 32×32</figcaption>
      </figure>
    </div>
  );
}

function hasByteLimitIssue(validation: ValidationResult): boolean {
  return validation.issues.some(
    (issue) => issue.level === 'error' && (issue.code === 'zip.bytes' || issue.code.endsWith('.bytes')),
  );
}
