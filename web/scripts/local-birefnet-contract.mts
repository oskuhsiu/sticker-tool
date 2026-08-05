import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import {
  combineLocalBirefnetAlpha,
  LOCAL_BIREFNET_MODEL_BYTES,
  LOCAL_BIREFNET_MODEL_FILE,
  LOCAL_BIREFNET_MODEL_ID,
  LOCAL_BIREFNET_MODEL_REVISION,
  LOCAL_BIREFNET_PARAMETER_COUNT,
  probeLocalBirefnetWebgpu,
} from '../src/webpipe/localBirefnetContract.js';
import { localBirefnetProgressText } from '../src/webpipe/localBirefnet.js';

assert.equal(LOCAL_BIREFNET_MODEL_ID, 'studioludens/birefnet-lite-512');
assert.equal(LOCAL_BIREFNET_MODEL_REVISION.length, 40);
assert.equal(LOCAL_BIREFNET_MODEL_FILE, 'onnx/model_fp16.onnx');
assert.equal(LOCAL_BIREFNET_PARAMETER_COUNT, 44_400_000);
assert.equal(LOCAL_BIREFNET_MODEL_BYTES, 98_484_532);
assert.equal(await probeLocalBirefnetWebgpu({}), false);
assert.equal(await probeLocalBirefnetWebgpu({ gpu: undefined }), false);
assert.equal(await probeLocalBirefnetWebgpu({ gpu: {} }), false);
assert.equal(await probeLocalBirefnetWebgpu({
  gpu: { requestAdapter: async () => null },
}), false, 'navigator.gpu without a usable adapter must warn about WASM');
assert.equal(await probeLocalBirefnetWebgpu({
  gpu: { requestAdapter: async () => ({ name: 'adapter' }) },
}), true);
assert.equal(await probeLocalBirefnetWebgpu({
  gpu: { requestAdapter: async () => { throw new Error('blocked by policy'); } },
}), false, 'a rejected adapter request must warn about WASM');

const source = new Uint8ClampedArray([
  10, 20, 30, 128,
  40, 50, 60, 255,
]);
const removed = new Uint8ClampedArray([
  1, 2, 3, 128,
  4, 5, 6, 0,
]);
const combined = combineLocalBirefnetAlpha(source, removed);
assert.deepEqual([...combined], [10, 20, 30, 64, 40, 50, 60, 0]);
assert.throws(
  () => combineLocalBirefnetAlpha(source, removed.subarray(0, 4)),
  /尺寸與來源 crop 不一致/,
);

assert.match(localBirefnetProgressText({
  stage: 'download',
  file: LOCAL_BIREFNET_MODEL_FILE,
  loaded: LOCAL_BIREFNET_MODEL_BYTES / 2,
  total: LOCAL_BIREFNET_MODEL_BYTES,
  percent: 50,
}), /50%.*47\.0 \/ 93\.9 MiB/);
assert.match(localBirefnetProgressText({ stage: 'fallback', reason: 'no adapter' }), /WASM/);
assert.match(localBirefnetProgressText({ stage: 'compiling', backend: 'wasm' }), /下載完成.*WASM/);

const serviceWorkerSource = readFileSync(new URL('../public/coi-serviceworker.js', import.meta.url), 'utf8');
let fetchHandler: ((event: {
  request: { mode: string; url: string; cache: string };
  respondWith: (response: Promise<Response>) => void;
}) => void) | undefined;
const workerSelf = {
  location: { origin: 'https://example.test' },
  skipWaiting: () => undefined,
  clients: { claim: () => Promise.resolve() },
  addEventListener: (type: string, handler: typeof fetchHandler) => {
    if (type === 'fetch') fetchHandler = handler;
  },
};
runInNewContext(serviceWorkerSource, {
  self: workerSelf,
  URL,
  Headers,
  Response,
  console,
  fetch: async () => new Response('ok'),
});
assert.ok(fetchHandler, 'COI service worker registers a fetch handler');
let corsWasProxied = false;
fetchHandler({
  request: {
    mode: 'cors',
    url: 'https://huggingface.co/studioludens/birefnet-lite-512/resolve/revision/onnx/model_fp16.onnx',
    cache: 'default',
  },
  respondWith: () => { corsWasProxied = true; },
});
assert.equal(corsWasProxied, false, 'large CORS model downloads bypass the COI response proxy');

console.log('local BiRefNet contract OK (pinned model, alpha, progress, Firefox-safe CORS download)');
