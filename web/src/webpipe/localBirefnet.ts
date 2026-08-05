import type { Raster } from './raster.js';
import type {
  LocalBirefnetBackend,
  LocalBirefnetProgress,
} from './localBirefnetContract.js';
import { hasLocalBirefnetWebgpu } from './localBirefnetContract.js';

interface LocalBirefnetRemoverOptions {
  signal?: AbortSignal;
  onProgress?: (progress: LocalBirefnetProgress) => void;
}

export interface LocalBirefnetRemover {
  backend: LocalBirefnetBackend;
  remove: (input: Raster, signal?: AbortSignal) => Promise<Raster>;
  dispose: () => Promise<void>;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  removeAbortListener?: () => void;
}

export async function createLocalBirefnetRemover(
  options: LocalBirefnetRemoverOptions = {},
): Promise<LocalBirefnetRemover> {
  const worker = new Worker(new URL('./localBirefnet.worker.ts', import.meta.url), { type: 'module' });
  const pending = new Map<number, PendingRequest>();
  let nextId = 1;
  let closed = false;

  const stop = (reason: unknown) => {
    if (closed) return;
    closed = true;
    worker.terminate();
    for (const request of pending.values()) {
      request.removeAbortListener?.();
      request.reject(reason);
    }
    pending.clear();
  };

  const request = <T>(
    message: Record<string, unknown>,
    transfer: Transferable[] = [],
    signal?: AbortSignal,
  ): Promise<T> => {
    if (closed) return Promise.reject(new Error('本機 BiRefNet worker 已關閉'));
    if (signal?.aborted) return Promise.reject(new DOMException('本機 BiRefNet 已取消', 'AbortError'));
    const id = nextId++;
    return new Promise<T>((resolve, reject) => {
      const abort = () => stop(new DOMException('本機 BiRefNet 已取消', 'AbortError'));
      if (signal) signal.addEventListener('abort', abort, { once: true });
      pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        removeAbortListener: signal ? () => signal.removeEventListener('abort', abort) : undefined,
      });
      worker.postMessage({ ...message, id }, transfer);
    });
  };

  worker.onmessage = (event: MessageEvent<Record<string, unknown>>) => {
    const message = event.data;
    if (message.type === 'progress') {
      options.onProgress?.(message.progress as LocalBirefnetProgress);
      return;
    }
    const id = message.id as number;
    const item = pending.get(id);
    if (!item) return;
    pending.delete(id);
    item.removeAbortListener?.();
    if (message.type === 'error') item.reject(new Error(String(message.message)));
    else item.resolve(message);
  };
  worker.onerror = (event) => {
    stop(new Error(event.message || '本機 BiRefNet worker 發生錯誤'));
  };

  try {
    const initialized = await request<{ backend: LocalBirefnetBackend }>({
      type: 'init',
      preferWebgpu: hasLocalBirefnetWebgpu(navigator),
      wasmPath: new URL('transformers/', document.baseURI).href,
    }, [], options.signal);

    return {
      backend: initialized.backend,
      remove: async (input, signal) => {
        const data = input.data.slice();
        const result = await request<{
          data: ArrayBuffer;
          width: number;
          height: number;
        }>({
          type: 'remove',
          data: data.buffer,
          width: input.width,
          height: input.height,
        }, [data.buffer], signal);
        return {
          data: new Uint8ClampedArray(result.data),
          width: result.width,
          height: result.height,
        };
      },
      dispose: async () => {
        if (closed) return;
        try {
          await request({ type: 'dispose' });
        } finally {
          stop(new Error('本機 BiRefNet worker 已關閉'));
        }
      },
    };
  } catch (error) {
    stop(error);
    throw error;
  }
}

export function localBirefnetProgressText(progress: LocalBirefnetProgress): string {
  if (progress.stage === 'fallback') return 'WebGPU 無法啟動，改用較慢的 WASM 本機推論…';
  if (progress.stage === 'ready') return `本機 BiRefNet 已就緒（${progress.backend.toUpperCase()}）`;
  if (progress.stage === 'compiling') {
    return `本機 BiRefNet 下載完成，正在建立 ${progress.backend.toUpperCase()} 推論環境…`;
  }
  if (progress.stage === 'initializing') {
    return `初始化本機 BiRefNet（${progress.backend.toUpperCase()}）…`;
  }
  const total = progress.total;
  const loaded = progress.loaded;
  if (total && loaded !== undefined) {
    const percent = progress.percent ?? loaded / total * 100;
    return `下載本機 BiRefNet：${percent.toFixed(0)}%（${(loaded / 1024 / 1024).toFixed(1)} / ${(total / 1024 / 1024).toFixed(1)} MiB）`;
  }
  return `下載本機 BiRefNet：${progress.file}…`;
}
