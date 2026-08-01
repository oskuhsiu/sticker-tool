/** Contract test for the downloadable Colab Notebook and browser adapter. */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  COLAB_BIREFNET_MAX_INPUT_PIXELS,
  createColabBirefnetConnectionConfig,
  planColabBirefnetUploadSize,
  removeBackgroundWithColabBirefnet,
} from '../src/webpipe/colabBirefnet.js';
import { encodePng } from '../src/webpipe/png.js';
import type { Raster } from '../src/webpipe/raster.js';
import { createColabBirefnetRemovalRegistry } from '../src/ui/colabBirefnetConnection.js';

const notebookPath = new URL(
  '../../examples/colab/sticker-tool-birefnet-colab.ipynb',
  import.meta.url,
);
const notebookText = fs.readFileSync(notebookPath, 'utf8');
const notebook = JSON.parse(notebookText);
assert.equal(notebook.nbformat, 4);
assert.equal(notebook.cells.length, 10);
assert.equal(notebook.metadata.accelerator, undefined);

const notebookSource = notebook.cells
  .flatMap((cell: { source: string[] }) => cell.source)
  .join('');
assert.match(notebookSource, /MODEL_CHOICE = "lite"/);
assert.match(notebookSource, /"lite", "full", "dynamic"/);
assert.match(notebookSource, /DEVICE_CHOICE = "auto"/);
assert.match(notebookSource, /"auto", "gpu", "cpu"/);
assert.match(notebookSource, /pip uninstall -q -y google-adk gradio python-fasthtml/);
assert.match(notebookSource, /transformers==4\.48\.3/);
assert.match(notebookSource, /fastapi==0\.115\.6/);
assert.match(notebookSource, /ZhengPeng7\/BiRefNet_lite/);
assert.match(notebookSource, /7838f1c3472f827cd8ce13ab5ccc2ce48077360f/);
assert.match(notebookSource, /ZhengPeng7\/BiRefNet_dynamic/);
assert.match(notebookSource, /280306042f57b7a33854319da62fd86aaa89ec4c/);
assert.match(notebookSource, /scale = min\(1\.0, INPUT_SIZE \/ max\(source\.width, source\.height\)\)/);
assert.match(notebookSource, /int\(source\.width \* scale\) \/\/ 32 \* 32/);
assert.match(notebookSource, /int\(source\.height \* scale\) \/\/ 32 \* 32/);
assert.match(notebookSource, /"input_mode": MODEL_INPUT_MODE/);
assert.match(notebookSource, /data\.astronaut\(\)/);
assert.match(notebookSource, /Median: .*s \/ crop/);
assert.match(notebookSource, /@api\.post\("\/remove"\)/);
assert.match(notebookSource, /X-Sticker-Tool-Key/);
assert.match(notebookSource, /allow_origins=\["\*"\]/);
assert.match(notebookSource, /2026\.5\.2/);
assert.match(notebookSource, /5286698547f03df745adb2355f04c12dde52ef425491e81f433642d695521886/);
assert.match(notebookSource, /\.trycloudflare\\?\.com/);
assert.doesNotMatch(notebookSource, /Modal/i);

const config = createColabBirefnetConnectionConfig({
  endpointUrl: 'https://quiet-river-example.trycloudflare.com/remove/',
  sessionKey: 'example_session_key_1234567890',
});
assert.equal(
  config.endpointUrl,
  'https://quiet-river-example.trycloudflare.com/remove',
);
assert.throws(
  () => createColabBirefnetConnectionConfig({
    ...config,
    endpointUrl: 'http://quiet-river-example.trycloudflare.com/remove',
  }),
  /HTTPS/,
);
assert.throws(
  () => createColabBirefnetConnectionConfig({
    ...config,
    endpointUrl: 'https://attacker.example/remove',
  }),
  /trycloudflare/,
);
assert.throws(
  () => createColabBirefnetConnectionConfig({
    ...config,
    endpointUrl: 'https://quiet-river-example.trycloudflare.com/health',
  }),
  /\/remove/,
);
assert.throws(
  () => createColabBirefnetConnectionConfig({ ...config, sessionKey: 'short' }),
  /session key/,
);

const nearLimitSize = planColabBirefnetUploadSize(2026, 1975);
assert.ok(nearLimitSize.width * nearLimitSize.height <= COLAB_BIREFNET_MAX_INPUT_PIXELS);
assert.deepEqual(nearLimitSize, { width: 2025, height: 1974 });

const removalRegistry = createColabBirefnetRemovalRegistry();
const activeRemoval = new AbortController();
removalRegistry.register(activeRemoval);
removalRegistry.invalidate();
assert.equal(activeRemoval.signal.aborted, true);

const inputData = new Uint8ClampedArray(16 * 16 * 4);
const maskData = new Uint8ClampedArray(16 * 16 * 4);
for (let pixel = 0; pixel < 16 * 16; pixel++) {
  const offset = pixel * 4;
  inputData.set([100, 110, 120, 255], offset);
  maskData.set([255, 255, 255, 255], offset);
}
inputData.set([10, 20, 30, 128, 40, 50, 60, 255]);
maskData.set([128, 128, 128, 255, 64, 64, 64, 255]);
const input: Raster = { width: 16, height: 16, data: inputData };
const mask: Raster = { width: 16, height: 16, data: maskData };

const originalFetch = globalThis.fetch;
let request: RequestInit | undefined;
let fetchCall = 0;
globalThis.fetch = async (_url, init) => {
  request = init;
  fetchCall++;
  if (fetchCall === 2) {
    const oversizedChunk = new Uint8Array(8 * 1024 * 1024 + 1);
    return new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(oversizedChunk);
        controller.close();
      },
    }), { headers: { 'content-type': 'image/png' } });
  }
  const bytes = encodePng(mask);
  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new Response(body, { headers: { 'content-type': 'image/png' } });
};

try {
  const output = await removeBackgroundWithColabBirefnet(input, config);
  assert.deepEqual([...output.data.subarray(0, 8)], [10, 20, 30, 64, 40, 50, 60, 64]);
  assert.equal(request?.method, 'POST');
  assert.equal(request?.redirect, 'error');
  assert.equal(request?.credentials, 'omit');
  const headers = new Headers(request?.headers);
  assert.equal(headers.get('X-Sticker-Tool-Key'), config.sessionKey);
  assert.ok(request?.body instanceof FormData);
  await assert.rejects(
    () => removeBackgroundWithColabBirefnet(input, config),
    /超過允許大小/,
  );
} finally {
  globalThis.fetch = originalFetch;
}

console.log('✓ Colab BiRefNet: notebook choices/benchmark/API, URL guard, request, mask alpha, abort registry');
