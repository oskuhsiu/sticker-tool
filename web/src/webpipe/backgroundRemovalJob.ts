import { DEFAULT_COLOR_KEY_OPTIONS, type ColorKeyOptions } from '@core/colorKey.js';
import { assertSupportedColorKeyOptions } from '@core/validate.js';
import type { ColabBirefnetConnectionConfig } from './colabBirefnet.js';
import { removeBackgroundWithColabBirefnet } from './colabBirefnet.js';
import {
  createLocalBirefnetRemover,
  localBirefnetProgressText,
  type LocalBirefnetRemover,
} from './localBirefnet.js';
import { LOCAL_BIREFNET_MODEL_ID, LOCAL_BIREFNET_MODEL_REVISION } from './localBirefnetContract.js';
import {
  PREPARED_COLOR_KEY_VERSION,
  prepareColorKeySession,
  type ColorKeyCalibrationDiagnostics,
} from './preparedColorKey.js';
import { removeBackgroundLocal, type ModelProgress } from './removeBackground.js';
import type { Raster } from './raster.js';

export type WebBackgroundRemovalMode =
  | 'none'
  | 'color-key'
  | 'imgly'
  | 'local-birefnet'
  | 'colab-birefnet';

export interface BackgroundRemovalJob {
  label: string;
  prepare: (calibration: readonly Raster[], signal?: AbortSignal) => Promise<PreparedBackgroundRemovalSession>;
  dispose: () => Promise<void>;
}

export interface BackgroundRemovalRender {
  raster: Raster;
  automaticMatte: Uint8ClampedArray<ArrayBuffer>;
  sessionIdentity: string;
  diagnostics?: ColorKeyCalibrationDiagnostics;
}

export interface PreparedBackgroundRemovalSession {
  readonly identity: string;
  readonly diagnostics?: ColorKeyCalibrationDiagnostics;
  remove(input: Raster, signal?: AbortSignal): Promise<BackgroundRemovalRender>;
}

export interface BackgroundRemovalJobOptions {
  mode: WebBackgroundRemovalMode;
  signal?: AbortSignal;
  pickColor?: [number, number, number] | null;
  /** Valid only when mode is color-key. */
  colorKey?: ColorKeyOptions;
  colabConfig?: ColabBirefnetConnectionConfig | null;
  onStatus?: (status: string | null) => void;
}

export interface BackgroundRemovalIdentityOptions {
  mode: WebBackgroundRemovalMode;
  pickColor?: readonly [number, number, number] | null;
  colorKey?: ColorKeyOptions;
  /** Rotates when the user's temporary Colab runtime is reconfigured. */
  colabGeneration?: number | null;
}

export function backgroundRemovalConfigurationIdentity(
  options: BackgroundRemovalIdentityOptions,
): string {
  if (options.mode === 'none') return 'background-none@1';
  if (options.mode === 'color-key') {
    const colorKey = options.colorKey ?? DEFAULT_COLOR_KEY_OPTIONS;
    assertSupportedColorKeyOptions(colorKey);
    return JSON.stringify({
      remover: PREPARED_COLOR_KEY_VERSION,
      colorKey,
      manualColor: options.pickColor ?? null,
    });
  }
  if (options.mode === 'imgly') return 'imgly-medium@1.4.5';
  if (options.mode === 'local-birefnet') {
    return `local-birefnet:${LOCAL_BIREFNET_MODEL_ID}@${LOCAL_BIREFNET_MODEL_REVISION}`;
  }
  return `colab-remover:generation-${options.colabGeneration ?? 0}`;
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('去背已取消', 'AbortError');
}

function imglyStatus(onStatus?: (status: string | null) => void): ModelProgress | undefined {
  if (!onStatus) return undefined;
  return (key, current, total) => {
    if (total > 0 && current >= total) {
      onStatus(null);
      return;
    }
    const percent = total > 0 ? Math.round(current / total * 100) : 0;
    const file = key.replace(/^fetch:/, '').split('/').pop() ?? key;
    onStatus(`下載 IMG.LY：${file} ${percent}%（首次使用後由瀏覽器快取）`);
  };
}

function matteOf(raster: Raster): Uint8ClampedArray<ArrayBuffer> {
  const matte = new Uint8ClampedArray(raster.width * raster.height);
  for (let pixel = 0; pixel < matte.length; pixel++) matte[pixel] = raster.data[pixel * 4 + 3]!;
  return matte;
}

export async function createBackgroundRemovalJob(
  options: BackgroundRemovalJobOptions,
): Promise<BackgroundRemovalJob> {
  const { mode, signal, onStatus } = options;
  assertNotAborted(signal);
  if (mode !== 'color-key' && options.colorKey !== undefined) {
    throw new Error('單色色鍵選項只能用於 color-key 模式');
  }
  if (mode === 'color-key' && options.colorKey !== undefined) assertSupportedColorKeyOptions(options.colorKey);

  let localRemover: LocalBirefnetRemover | null = null;
  let localRemoverPromise: Promise<LocalBirefnetRemover> | null = null;
  let disposed = false;
  const getLocalRemover = async (requestSignal?: AbortSignal): Promise<LocalBirefnetRemover> => {
    if (disposed) throw new Error('本機 BiRefNet job 已關閉');
    if (localRemover) return localRemover;
    const starting = localRemoverPromise ?? createLocalBirefnetRemover({
      signal: requestSignal,
      onProgress: (progress) => onStatus?.(localBirefnetProgressText(progress)),
    });
    localRemoverPromise = starting;
    try {
      const created = await starting;
      if (disposed) {
        await created.dispose();
        throw new Error('本機 BiRefNet job 已關閉');
      }
      localRemover = created;
      return created;
    } catch (error) {
      if (localRemoverPromise === starting) localRemoverPromise = null;
      throw error;
    }
  };
  if (mode === 'colab-birefnet' && !options.colabConfig) {
    throw new Error('Colab 多模型去背尚未設定；請先開啟「Colab 多模型去背教學」完成連線');
  }

  const labels: Record<WebBackgroundRemovalMode, string> = {
    none: '不去背',
    'color-key': '單色色鍵',
    imgly: 'IMG.LY',
    'local-birefnet': '本機 BiRefNet',
    'colab-birefnet': 'Colab 多模型去背',
  };
  const prepare = async (
    calibration: readonly Raster[],
    requestSignal = signal,
  ): Promise<PreparedBackgroundRemovalSession> => {
    assertNotAborted(requestSignal);
    if (calibration.length === 0) throw new Error('去背至少需要一張來源影像');
    if (mode === 'color-key') {
      const prepared = await prepareColorKeySession(calibration, {
        manualColor: options.pickColor,
        colorKey: options.colorKey ?? DEFAULT_COLOR_KEY_OPTIONS,
      });
      return Object.freeze({
        identity: prepared.identity,
        diagnostics: prepared.diagnostics,
        async remove(input: Raster, renderSignal = requestSignal): Promise<BackgroundRemovalRender> {
          assertNotAborted(renderSignal);
          const rendered = prepared.render(input);
          return {
            raster: rendered.raster,
            automaticMatte: rendered.automaticMatte,
            sessionIdentity: rendered.sessionIdentity,
            diagnostics: rendered.diagnostics,
          };
        },
      });
    }

    const identity = mode === 'none'
      ? 'background-none@1'
      : mode === 'imgly'
        ? 'imgly-medium@1'
        : mode === 'local-birefnet'
          ? `local-birefnet:${LOCAL_BIREFNET_MODEL_ID}@${LOCAL_BIREFNET_MODEL_REVISION}`
          : `colab-remover:${new URL(options.colabConfig!.endpointUrl).host}`;
    return Object.freeze({
      identity,
      async remove(input: Raster, renderSignal = requestSignal): Promise<BackgroundRemovalRender> {
        assertNotAborted(renderSignal);
        let raster: Raster;
        if (mode === 'none') raster = input;
        else if (mode === 'imgly') {
          raster = await removeBackgroundLocal(input, {
            signal: renderSignal,
            onProgress: imglyStatus(onStatus),
          });
        } else if (mode === 'local-birefnet') {
          raster = await (await getLocalRemover(renderSignal)).remove(input, renderSignal);
        }
        else raster = await removeBackgroundWithColabBirefnet(input, options.colabConfig!, { signal: renderSignal });
        return { raster, automaticMatte: matteOf(raster), sessionIdentity: identity };
      },
    });
  };

  return {
    label: labels[mode],
    prepare,
    dispose: async () => {
      disposed = true;
      onStatus?.(null);
      const remover = localRemover ?? await localRemoverPromise?.catch(() => null) ?? null;
      localRemover = null;
      localRemoverPromise = null;
      await remover?.dispose();
    },
  };
}
