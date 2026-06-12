/**
 * 整包結果展示：貼圖預覽格、main/tab、驗證報告、zip 下載。
 */

import type { ValidationResult } from '@core/types.js';
import type { ImageInfo } from '@core/validate.js';
import { downloadBytes, safeName } from '../webpipe/zip.js';
import { kb, PngPreview, ValidationView } from './common.jsx';

export interface PackResultData {
  name: string;
  stickers: { png: Uint8Array; info: ImageInfo; notes: string[] }[];
  main: Uint8Array;
  tab: Uint8Array;
  zip: Uint8Array;
  validation: ValidationResult;
  /** 動態包 main 是 APNG */
  animated?: boolean;
}

export function PackResult({ data }: { data: PackResultData }) {
  return (
    <div className="pack-result">
      <div className="pack-actions">
        <button className="btn primary" onClick={() => downloadBytes(`${safeName(data.name)}.zip`, data.zip, 'application/zip')}>
          下載上架包 zip（{kb(data.zip.length)}）
        </button>
        <button className="btn" onClick={() => downloadBytes('main.png', data.main, 'image/png')}>
          main.png
        </button>
        <button className="btn" onClick={() => downloadBytes('tab.png', data.tab, 'image/png')}>
          tab.png
        </button>
      </div>
      <ValidationView result={data.validation} />
      <div className="sticker-grid">
        <PngPreview bytes={data.main} caption={`main.png ${kb(data.main.length)}${data.animated ? '（APNG）' : ''}`} />
        <PngPreview bytes={data.tab} caption={`tab.png ${kb(data.tab.length)}`} />
        {data.stickers.map((s, i) => (
          <PngPreview
            key={i}
            bytes={s.png}
            caption={`${String(i + 1).padStart(2, '0')}.png ${s.info.width}×${s.info.height} ${kb(s.info.bytes)}`}
          />
        ))}
      </div>
    </div>
  );
}
