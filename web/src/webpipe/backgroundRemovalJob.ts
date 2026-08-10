import type { ColabBirefnetConnectionConfig } from './colabBirefnet.js';
import { removeBackgroundWithColabBirefnet } from './colabBirefnet.js';
import {
  createLocalBirefnetRemover,
  localBirefnetProgressText,
  type LocalBirefnetRemover,
} from './localBirefnet.js';
import { removeBackgroundLocal, type ModelProgress } from './removeBackground.js';
import { detectBackground, keyBackground } from './sheetAnalysis.js';
import type { Raster } from './raster.js';

export type WebBackgroundRemovalMode =
  | 'none'
  | 'color-key'
  | 'imgly'
  | 'local-birefnet'
  | 'colab-birefnet';

export interface BackgroundRemovalJob {
  label: string;
  remove: (input: Raster, signal?: AbortSignal) => Promise<Raster>;
  dispose: () => Promise<void>;
}

export interface BackgroundRemovalJobOptions {
  mode: WebBackgroundRemovalMode;
  signal?: AbortSignal;
  pickColor?: [number, number, number] | null;
  colabConfig?: ColabBirefnetConnectionConfig | null;
  onStatus?: (status: string | null) => void;
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

export async function createBackgroundRemovalJob(
  options: BackgroundRemovalJobOptions,
): Promise<BackgroundRemovalJob> {
  const { mode, signal, onStatus } = options;
  assertNotAborted(signal);

  let localRemover: LocalBirefnetRemover | null = null;
  if (mode === 'local-birefnet') {
    localRemover = await createLocalBirefnetRemover({
      signal,
      onProgress: (progress) => onStatus?.(localBirefnetProgressText(progress)),
    });
  }
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
  return {
    label: labels[mode],
    remove: async (input, requestSignal = signal) => {
      assertNotAborted(requestSignal);
      if (mode === 'none') return input;
      if (mode === 'color-key') {
        return keyBackground(input, detectBackground(input), {
          autoRemove: true,
          pickColor: options.pickColor,
        });
      }
      if (mode === 'imgly') {
        return removeBackgroundLocal(input, {
          signal: requestSignal,
          onProgress: imglyStatus(onStatus),
        });
      }
      if (mode === 'local-birefnet') return localRemover!.remove(input, requestSignal);
      return removeBackgroundWithColabBirefnet(input, options.colabConfig!, { signal: requestSignal });
    },
    dispose: async () => {
      onStatus?.(null);
      await localRemover?.dispose();
    },
  };
}
