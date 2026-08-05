/// <reference lib="webworker" />

import {
  RawImage,
  env,
  pipeline,
  type ProgressInfo,
} from '@huggingface/transformers';
import {
  combineLocalBirefnetAlpha,
  LOCAL_BIREFNET_MODEL_FILE,
  LOCAL_BIREFNET_MODEL_ID,
  LOCAL_BIREFNET_MODEL_REVISION,
  type LocalBirefnetBackend,
  type LocalBirefnetProgress,
} from './localBirefnetContract.js';

interface InitRequest {
  type: 'init';
  id: number;
  preferWebgpu: boolean;
  wasmPath: string;
}

interface RemoveRequest {
  type: 'remove';
  id: number;
  data: ArrayBuffer;
  width: number;
  height: number;
}

interface DisposeRequest {
  type: 'dispose';
  id: number;
}

type WorkerRequest = InitRequest | RemoveRequest | DisposeRequest;

type BirefnetPipeline = ((image: RawImage) => Promise<RawImage[]>) & {
  dispose: () => Promise<unknown>;
};

let remover: BirefnetPipeline | null = null;
let backend: LocalBirefnetBackend | null = null;

function postProgress(progress: LocalBirefnetProgress) {
  self.postMessage({ type: 'progress', progress });
}

function transformerProgress(info: ProgressInfo, target: LocalBirefnetBackend) {
  if (info.status === 'initiate' || info.status === 'download') {
    postProgress({ stage: 'download', file: info.file });
  } else if (info.status === 'progress') {
    postProgress({
      stage: 'download',
      file: info.file,
      loaded: info.loaded,
      total: info.total,
      percent: info.progress,
    });
  } else if (info.status === 'done' && info.file === LOCAL_BIREFNET_MODEL_FILE) {
    postProgress({ stage: 'compiling', backend: target });
  }
}

async function loadPipeline(target: LocalBirefnetBackend): Promise<BirefnetPipeline> {
  postProgress({ stage: 'initializing', backend: target });
  const createPipeline = pipeline as unknown as (
    task: 'background-removal',
    model: string,
    options: {
      revision: string;
      dtype: 'fp16';
      device: LocalBirefnetBackend;
      progress_callback: (info: ProgressInfo) => void;
    },
  ) => Promise<BirefnetPipeline>;
  return createPipeline('background-removal', LOCAL_BIREFNET_MODEL_ID, {
    revision: LOCAL_BIREFNET_MODEL_REVISION,
    dtype: 'fp16',
    device: target,
    progress_callback: (info) => transformerProgress(info, target),
  }) as Promise<BirefnetPipeline>;
}

async function initialize(request: InitRequest) {
  env.allowLocalModels = false;
  const wasm = env.backends.onnx.wasm;
  if (!wasm) throw new Error('Transformers.js 沒有提供 ONNX WASM runtime');
  wasm.wasmPaths = request.wasmPath;

  const firstBackend: LocalBirefnetBackend = request.preferWebgpu ? 'webgpu' : 'wasm';
  try {
    remover = await loadPipeline(firstBackend);
    backend = firstBackend;
  } catch (error) {
    if (firstBackend !== 'webgpu') throw error;
    const reason = error instanceof Error ? error.message : String(error);
    postProgress({ stage: 'fallback', reason });
    await remover?.dispose();
    remover = await loadPipeline('wasm');
    backend = 'wasm';
  }
  postProgress({ stage: 'ready', backend });
  self.postMessage({ type: 'result', id: request.id, backend });
}

async function removeBackground(request: RemoveRequest) {
  if (!remover || !backend) throw new Error('本機 BiRefNet 尚未初始化');
  const source = new Uint8ClampedArray(request.data);
  if (source.length !== request.width * request.height * 4) {
    throw new Error('本機 BiRefNet 收到無效的 crop buffer');
  }
  const outputs = await remover(new RawImage(source, request.width, request.height, 4));
  const removed = outputs[0];
  if (!removed || removed.width !== request.width || removed.height !== request.height || removed.channels !== 4) {
    throw new Error('本機 BiRefNet 回傳的影像尺寸或 channel 無效');
  }
  const data = combineLocalBirefnetAlpha(source, removed.data);
  self.postMessage(
    { type: 'result', id: request.id, data: data.buffer, width: request.width, height: request.height },
    { transfer: [data.buffer] },
  );
}

async function dispose(request: DisposeRequest) {
  await remover?.dispose();
  remover = null;
  backend = null;
  self.postMessage({ type: 'result', id: request.id });
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  const action = request.type === 'init'
    ? initialize(request)
    : request.type === 'remove'
      ? removeBackground(request)
      : dispose(request);
  void action.catch((error) => {
    self.postMessage({
      type: 'error',
      id: request.id,
      message: error instanceof Error ? error.message : String(error),
    });
  });
};
