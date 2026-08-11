import { useEffect, useState } from 'react';
import type { ColorKeyOptions } from '@core/colorKey.js';
import {
  LOCAL_BIREFNET_MODEL_BYTES,
  LOCAL_BIREFNET_PARAMETER_COUNT,
  probeLocalBirefnetWebgpu,
} from '../webpipe/localBirefnetContract.js';
import { IMGLY_MEDIUM_MODEL_BYTES } from '../webpipe/removeBackground.js';
import type { WebBackgroundRemovalMode } from '../webpipe/backgroundRemovalJob.js';
import { colabBirefnetEndpointHost } from '../webpipe/colabBirefnet.js';
import { Field, Row } from './common.jsx';
import { useColabBirefnetConnection } from './colabBirefnetConnection.jsx';
import { currentDeviceHint } from './deviceHints.js';

export interface BackgroundRemovalControlProps {
  value: WebBackgroundRemovalMode;
  onChange: (mode: WebBackgroundRemovalMode) => void;
  disabled?: boolean;
  inferenceCount?: number | null;
  color?: string;
  onColorChange?: (color: string) => void;
  colorHelp?: React.ReactNode;
  colorKeyOptions: ColorKeyOptions;
  onColorKeyOptionsChange: (options: ColorKeyOptions) => void;
}

export interface ColorKeyOptionFieldsProps {
  value: ColorKeyOptions;
  onChange: (options: ColorKeyOptions) => void;
  disabled?: boolean;
}

export function ColorKeyOptionFields(props: ColorKeyOptionFieldsProps) {
  return (
    <Row>
      <Field label="去背範圍">
        <select
          aria-label="單色色鍵去背範圍"
          value={props.value.scope}
          disabled={props.disabled}
          onChange={(event) => props.onChange({
            ...props.value,
            scope: event.target.value as ColorKeyOptions['scope'],
          })}
        >
          <option value="edge-connected">外框連通（保護主體）</option>
          <option value="all-matching">全圖相近色（可能挖空主體）</option>
        </select>
      </Field>
      <Field label="邊緣處理">
        <select
          aria-label="單色色鍵邊緣處理"
          value={props.value.edge}
          disabled={props.disabled}
          onChange={(event) => props.onChange({
            ...props.value,
            edge: event.target.value as ColorKeyOptions['edge'],
          })}
        >
          <option value="decontaminate">清除色暈（建議）</option>
          <option value="soft">柔和邊緣（可能留背景圈）</option>
          <option value="hard">硬邊（可能鋸齒）</option>
        </select>
      </Field>
    </Row>
  );
}

const imglyMib = Math.round(IMGLY_MEDIUM_MODEL_BYTES / 1024 / 1024);
const birefnetMib = Math.round(LOCAL_BIREFNET_MODEL_BYTES / 1024 / 1024);
const birefnetParamsM = LOCAL_BIREFNET_PARAMETER_COUNT / 1_000_000;

export function LocalBirefnetRuntimeWarning(props: { active: boolean }) {
  const [webgpuAvailable, setWebgpuAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    if (!props.active) {
      setWebgpuAvailable(null);
      return;
    }
    let cancelled = false;
    setWebgpuAvailable(null);
    void probeLocalBirefnetWebgpu(typeof navigator === 'undefined' ? null : navigator).then((available) => {
      if (!cancelled) setWebgpuAvailable(available);
    });
    return () => { cancelled = true; };
  }, [props.active]);

  if (!props.active || webgpuAvailable) return null;
  if (webgpuAvailable === null) {
    return (
      <div className="ai-local-notice" role="status" data-testid="local-birefnet-webgpu-check">
        正在確認是否能取得 WebGPU adapter…
      </div>
    );
  }
  return (
    <div className="ai-local-notice" role="alert" data-testid="local-birefnet-wasm-warning">
      <strong>⚠ 無法取得可用的 WebGPU adapter：</strong>本機 BiRefNet 將改用 WASM。首次建立模型與每張推論都可能需要數分鐘，
      多張處理會非常慢；建議改用支援 WebGPU 的 Chrome／Edge，或改選 Colab 多模型去背。
    </div>
  );
}

export function BackgroundRemovalControl(props: BackgroundRemovalControlProps) {
  const { connection } = useColabBirefnetConnection();
  const mobileOrTablet = currentDeviceHint() !== 'unknown';
  const countText = props.inferenceCount && props.inferenceCount > 0
    ? `這次約 ${props.inferenceCount} 次推論。`
    : '';

  return (
    <>
      <Row>
        <Field label="去背方式">
          <select
            value={props.value}
            disabled={props.disabled}
            onChange={(event) => props.onChange(event.target.value as WebBackgroundRemovalMode)}
          >
            <option value="none">不去背</option>
            <option value="color-key">單色色鍵（快速）</option>
            <option value="imgly">IMG.LY（本機瀏覽器）</option>
            <option value="local-birefnet">BiRefNet（本機）</option>
            <option value="colab-birefnet">Colab 多模型去背</option>
          </select>
        </Field>
        {props.value === 'color-key' && props.color && props.onColorChange && (
          <Field label="背景色">
            <input
              type="color"
              value={props.color}
              disabled={props.disabled}
              onChange={(event) => props.onColorChange?.(event.target.value)}
            />
          </Field>
        )}
        {props.value === 'color-key' && props.colorHelp}
        {props.value === 'colab-birefnet' && connection && (
          <span className="ai-warning-option-status">
            已連線：{colabBirefnetEndpointHost(connection.config.endpointUrl)}
          </span>
        )}
      </Row>
      {props.value === 'color-key' && (
        <ColorKeyOptionFields
          value={props.colorKeyOptions}
          onChange={props.onColorKeyOptionsChange}
          disabled={props.disabled}
        />
      )}
      {props.value === 'color-key' && (
        <div className="ai-local-notice" role="status">
          <strong>單色色鍵：</strong>速度最快、不下載模型。外框連通可保留被主體包住的同色細節；全圖相近色也會清除
          不與外框相連的區域，但可能挖空主體。清除色暈可減少背景圈；硬邊可能產生鋸齒。
        </div>
      )}
      {props.value === 'imgly' && (
        <div className="ai-local-notice" role="status">
          <strong>IMG.LY：</strong>只在瀏覽器本機執行，不會上傳，也沒有 Colab 模式。首次需下載約 {imglyMib} MiB
          的 medium 模型，另有 WASM runtime；{countText}桌面實測 8 張約 116 秒，但裝置差異很大。
          手機或平板可能耗電、記憶體不足或跑不完。{mobileOrTablet && ' 目前裝置看起來是行動裝置，建議改用桌面 Chrome／Edge。'}
        </div>
      )}
      {props.value === 'local-birefnet' && (
        <div className="ai-local-notice" role="status">
          <strong>本機 BiRefNet：</strong>首次需下載約 {birefnetMib} MiB fp16 模型；{birefnetParamsM}M 是參數數量，
          不是檔案 MB。影像不會上傳；{countText}WebGPU 不可用時會改跑較慢的 WASM。
          手機或平板可能耗電、記憶體不足或跑不完。{mobileOrTablet && ' 目前裝置看起來是行動裝置，建議改用桌面 Chrome／Edge。'}
        </div>
      )}
      <LocalBirefnetRuntimeWarning active={props.value === 'local-birefnet'} />
      {props.value === 'colab-birefnet' && (
        <div className="ai-local-notice" role="status">
          <strong>Colab 多模型去背：</strong>{countText}每張處理用 crop 會透過 HTTPS 傳到你自己啟動的臨時 Colab session；
          免費 runtime 與 tunnel 可能中斷，沒有 SLA。連線資料只保留在目前頁面記憶體。
          {!connection && <> 尚未連線，請先開啟 <a href="#/colab-birefnet">Colab 多模型去背教學</a>。</>}
        </div>
      )}
    </>
  );
}
