import assert from 'node:assert/strict';
import {
  combineLocalBirefnetAlpha,
  LOCAL_BIREFNET_MODEL_BYTES,
  LOCAL_BIREFNET_MODEL_FILE,
  LOCAL_BIREFNET_MODEL_ID,
  LOCAL_BIREFNET_MODEL_REVISION,
  LOCAL_BIREFNET_PARAMETER_COUNT,
} from '../src/webpipe/localBirefnetContract.js';
import { localBirefnetProgressText } from '../src/webpipe/localBirefnet.js';

assert.equal(LOCAL_BIREFNET_MODEL_ID, 'studioludens/birefnet-lite-512');
assert.equal(LOCAL_BIREFNET_MODEL_REVISION.length, 40);
assert.equal(LOCAL_BIREFNET_MODEL_FILE, 'onnx/model_fp16.onnx');
assert.equal(LOCAL_BIREFNET_PARAMETER_COUNT, 44_400_000);
assert.equal(LOCAL_BIREFNET_MODEL_BYTES, 98_484_532);

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

console.log('local BiRefNet contract OK (pinned fp16 model metadata, alpha composition, progress copy)');
