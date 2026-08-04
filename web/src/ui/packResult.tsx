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

export function PackResult(props: { data: PackResultData; onReduceColors?: () => void }) {
  const { data, onReduceColors } = props;
  const valid = data.validation.ok;
  const canOfferColorReduction = !valid && !!onReduceColors && hasByteLimitIssue(data.validation);
  return (
    <div className="pack-result">
      {canOfferColorReduction && (
        <div className="validation warn" data-testid="color-reduction-prompt">
          成品超過單檔或整包容量上限。系統沒有自動降色；你可以修改素材，或明確選擇降色後重試。
          <button className="btn" data-testid="reduce-colors-retry" onClick={onReduceColors}>
            嘗試降色並重新打包
          </button>
        </div>
      )}
      <div className="pack-actions">
        <button
          className="btn primary"
          disabled={!valid}
          onClick={() => downloadBytes(`${safeName(data.name)}.zip`, data.zip, 'application/zip')}
        >
          {valid ? `下載上架包 zip（${kb(data.zip.length)}）` : '驗證未通過，不能下載上架包'}
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

function hasByteLimitIssue(validation: ValidationResult): boolean {
  return validation.issues.some(
    (issue) => issue.level === 'error' && (issue.code === 'zip.bytes' || issue.code.endsWith('.bytes')),
  );
}
