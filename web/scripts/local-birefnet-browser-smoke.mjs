/**
 * Real browser smoke for the local BiRefNet worker.
 * Requires a separately running Vite dev server because this imports the
 * source adapter directly. The first run downloads and caches ~94 MiB.
 *
 * Usage: node scripts/local-birefnet-browser-smoke.mjs http://127.0.0.1:4180/ [chromium|firefox]
 */

import { chromium, firefox } from 'playwright';

const BASE = process.argv[2] ?? 'http://127.0.0.1:4180/';
const BROWSER = process.argv[3] ?? 'chromium';
if (!['chromium', 'firefox'].includes(BROWSER)) {
  throw new Error(`unsupported browser: ${BROWSER}`);
}
const browser = BROWSER === 'firefox'
  ? await firefox.launch({ headless: true })
  : await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));
page.on('console', (message) => {
  if (message.text().startsWith('[local-birefnet]')) console.log(message.text());
});
page.on('requestfailed', (request) => {
  console.error(`[local-birefnet] request failed: ${request.url()} (${request.failure()?.errorText ?? 'unknown'})`);
});

try {
  await page.goto(BASE, { waitUntil: 'load' });
  // The COI service worker may register and reload once on a fresh profile.
  await page.waitForTimeout(2_000);
  await page.waitForLoadState('load');
  const result = await page.evaluate(async () => {
    console.log(`[local-birefnet] crossOriginIsolated=${crossOriginIsolated} webgpu=${'gpu' in navigator} serviceWorker=${Boolean(navigator.serviceWorker?.controller)}`);
    if ('gpu' in navigator) {
      const adapter = await navigator.gpu.requestAdapter();
      console.log(`[local-birefnet] adapter=${adapter ? 'available' : 'unavailable'} maxStorageBuffersPerShaderStage=${adapter?.limits.maxStorageBuffersPerShaderStage ?? 'n/a'}`);
    }
    const { createLocalBirefnetRemover } = await import('/src/webpipe/localBirefnet.ts');
    const width = 128;
    const height = 128;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * 4;
        const foreground = (x - 64) ** 2 + (y - 64) ** 2 < 38 ** 2;
        data[offset] = foreground ? 220 : 170;
        data[offset + 1] = foreground ? 45 : 215;
        data[offset + 2] = foreground ? 40 : 245;
        data[offset + 3] = 255;
      }
    }
    const progress = [];
    let lastDownloadFile = '';
    let lastDownloadDecile = -1;
    const initializedAt = performance.now();
    const remover = await createLocalBirefnetRemover({
      onProgress: (event) => {
        progress.push(event);
        if (event.stage !== 'download') {
          console.log(`[local-birefnet] progress ${JSON.stringify(event)}`);
          return;
        }
        if (event.file !== lastDownloadFile) {
          lastDownloadFile = event.file;
          lastDownloadDecile = -1;
        }
        const decile = event.percent === undefined ? -1 : Math.floor(event.percent / 10);
        if (decile > lastDownloadDecile) {
          lastDownloadDecile = decile;
          console.log(`[local-birefnet] download ${Math.min(decile * 10, 100)}% ${event.file}`);
        }
      },
    });
    const initializedMs = performance.now() - initializedAt;
    try {
      const inferenceAt = performance.now();
      const output = await remover.remove({ data, width, height });
      const inferenceMs = performance.now() - inferenceAt;
      const alpha = [];
      for (let offset = 3; offset < output.data.length; offset += 4) alpha.push(output.data[offset]);
      return {
        backend: remover.backend,
        width: output.width,
        height: output.height,
        alphaMin: Math.min(...alpha),
        alphaMax: Math.max(...alpha),
        sawReady: progress.some((event) => event.stage === 'ready'),
        initializedMs,
        inferenceMs,
      };
    } finally {
      await remover.dispose();
    }
  });

  if (pageErrors.length > 0) throw new Error(`page errors: ${pageErrors.join(' | ')}`);
  if (result.width !== 128 || result.height !== 128) throw new Error(`unexpected output: ${result.width}x${result.height}`);
  if (!['webgpu', 'wasm'].includes(result.backend)) throw new Error(`unexpected backend: ${result.backend}`);
  if (!result.sawReady) throw new Error('worker did not report ready');
  if (result.alphaMin >= result.alphaMax) throw new Error(`mask has no range: ${result.alphaMin}..${result.alphaMax}`);
  console.log(`local BiRefNet browser smoke OK (${BROWSER}/${result.backend}, alpha ${result.alphaMin}..${result.alphaMax}, init ${Math.round(result.initializedMs)} ms, inference ${Math.round(result.inferenceMs)} ms)`);
} finally {
  await browser.close();
}
