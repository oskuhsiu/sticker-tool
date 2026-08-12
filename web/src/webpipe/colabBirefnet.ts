/**
 * Legacy-named browser adapter for the user's temporary Colab multi-model session.
 *
 * It accepts only Cloudflare Quick Tunnel URLs, keeps the session key outside
 * persistent storage, and sends one already-cropped PNG per request.
 */

import { decodePng, encodePng } from './png.js';
import { resizeRaster, type Raster } from './raster.js';

export const COLAB_BIREFNET_MAX_INPUT_BYTES = 8 * 1024 * 1024;
export const COLAB_BIREFNET_MAX_INPUT_EDGE = 2048;
export const COLAB_BIREFNET_MAX_INPUT_PIXELS = 4_000_000;
const QUICK_TUNNEL_SUFFIX = '.trycloudflare.com';
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

export interface ColabBirefnetConnectionConfig {
  endpointUrl: string;
  sessionKey: string;
}

export interface ColabBirefnetUploadInfo {
  originalWidth: number;
  originalHeight: number;
  uploadedWidth: number;
  uploadedHeight: number;
  uploadedBytes: number;
}

export interface ColabBirefnetRemoveOptions {
  signal?: AbortSignal;
  onPrepared?: (info: ColabBirefnetUploadInfo) => void;
}

interface PreparedCrop {
  raster: Raster;
  png: Uint8Array;
}

export function normalizeColabBirefnetEndpointUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('請貼上 Colab 輸出的完整 HTTPS endpoint URL');
  }
  if (url.protocol !== 'https:') throw new Error('Colab endpoint 必須使用 HTTPS');
  if (
    !url.hostname.endsWith(QUICK_TUNNEL_SUFFIX)
    || url.hostname.length === QUICK_TUNNEL_SUFFIX.length
  ) {
    throw new Error('只接受 Notebook 輸出的 *.trycloudflare.com Quick Tunnel URL');
  }
  if (url.port || url.username || url.password || url.search || url.hash) {
    throw new Error('endpoint URL 不可含 port、帳密、query 或 hash');
  }
  const pathname = url.pathname.replace(/\/+$/, '');
  if (pathname !== '/remove') throw new Error('請貼上以 /remove 結尾的完整 endpoint URL');
  url.pathname = pathname;
  return url.href;
}

export function createColabBirefnetConnectionConfig(
  values: ColabBirefnetConnectionConfig,
): ColabBirefnetConnectionConfig {
  const endpointUrl = normalizeColabBirefnetEndpointUrl(values.endpointUrl);
  const sessionKey = values.sessionKey.trim();
  if (!/^[A-Za-z0-9_-]{20,}$/.test(sessionKey)) {
    throw new Error('請貼上 Notebook 輸出的完整 session key');
  }
  return { endpointUrl, sessionKey };
}

export function colabBirefnetEndpointHost(endpointUrl: string): string {
  return new URL(endpointUrl).host;
}

export function planColabBirefnetUploadSize(
  width: number,
  height: number,
): { width: number; height: number } {
  const sourceWidth = Math.max(1, Math.floor(width));
  const sourceHeight = Math.max(1, Math.floor(height));
  const scale = Math.min(
    1,
    COLAB_BIREFNET_MAX_INPUT_EDGE / Math.max(sourceWidth, sourceHeight),
    Math.sqrt(COLAB_BIREFNET_MAX_INPUT_PIXELS / (sourceWidth * sourceHeight)),
  );
  if (scale >= 1) return { width: sourceWidth, height: sourceHeight };
  return {
    width: Math.max(1, Math.floor(sourceWidth * scale)),
    height: Math.max(1, Math.floor(sourceHeight * scale)),
  };
}

function resizeWithinLimit(input: Raster, scale = 1): Raster {
  const size = planColabBirefnetUploadSize(input.width * scale, input.height * scale);
  if (size.width === input.width && size.height === input.height) return input;
  return resizeRaster(input, size.width, size.height);
}

function prepareCrop(input: Raster): PreparedCrop {
  let raster = resizeWithinLimit(input);
  for (let attempt = 0; attempt < 6; attempt++) {
    const png = encodePng(raster);
    if (png.length <= COLAB_BIREFNET_MAX_INPUT_BYTES) return { raster, png };
    if (raster.width === 1 && raster.height === 1) break;
    raster = resizeWithinLimit(raster, 0.75);
  }
  throw new Error('裁切格壓縮後仍超過 Colab endpoint 的 8 MB 上限');
}

function responseError(response: Response): Error {
  if (response.status === 401 || response.status === 403) {
    return new Error('Colab worker 拒絕 session key；請重新複製目前 runtime 的連線資料');
  }
  if (response.status === 413) return new Error('Colab worker 拒絕此裁切格：它超過輸入限制');
  if (response.status === 429) return new Error('Colab tunnel 目前繁忙；請稍後再試');
  if (response.status >= 500) return new Error('Colab worker 推論失敗；請回 Notebook 查看錯誤輸出');
  return new Error(`Colab endpoint 回傳 HTTP ${response.status}`);
}

function maskResponseTooLarge(): Error {
  return new Error('Colab endpoint 回傳的 mask 超過允許大小');
}

async function readMaskBody(response: Response): Promise<Uint8Array> {
  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(contentLength) && contentLength > COLAB_BIREFNET_MAX_INPUT_BYTES) {
    throw maskResponseTooLarge();
  }
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > COLAB_BIREFNET_MAX_INPUT_BYTES) {
        await reader.cancel();
        throw maskResponseTooLarge();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function readPngDimension(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset]! << 24)
    | (bytes[offset + 1]! << 16)
    | (bytes[offset + 2]! << 8)
    | bytes[offset + 3]!
  ) >>> 0;
}

function assertExpectedMaskPng(bytes: Uint8Array, width: number, height: number): void {
  if (
    bytes.length < 33
    || !PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)
    || String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR'
  ) {
    throw new Error('Colab endpoint 回傳的 PNG mask 格式無效');
  }
  const actualWidth = readPngDimension(bytes, 16);
  const actualHeight = readPngDimension(bytes, 20);
  if (actualWidth !== width || actualHeight !== height) {
    throw new Error('Colab endpoint 回傳的 mask 尺寸與送出的裁切格不一致');
  }
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

async function postCrop(
  config: ColabBirefnetConnectionConfig,
  png: Uint8Array,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const form = new FormData();
  const bytes = png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer;
  form.append('image', new Blob([bytes], { type: 'image/png' }), 'crop.png');

  let response: Response;
  try {
    response = await fetch(config.endpointUrl, {
      method: 'POST',
      headers: {
        Accept: 'image/png',
        'X-Sticker-Tool-Key': config.sessionKey,
      },
      body: form,
      signal,
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
    });
  } catch (error) {
    if (isAbort(error)) throw error;
    throw new Error('無法呼叫 Colab endpoint；請確認最後一格仍在執行，並重新複製本次 URL');
  }
  if (!response.ok) throw responseError(response);
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.startsWith('image/png')) {
    throw new Error('Colab endpoint 沒有回傳 PNG mask；請確認貼的是 /remove URL');
  }
  return readMaskBody(response);
}

function applyMask(original: Raster, mask: Raster): Raster {
  if (mask.width !== original.width || mask.height !== original.height) {
    throw new Error('Colab endpoint 回傳的 mask 尺寸與送出的裁切格不一致');
  }
  const out = new Uint8ClampedArray(original.data);
  for (let pixel = 0; pixel < original.width * original.height; pixel++) {
    const offset = pixel * 4;
    const red = mask.data[offset]!;
    const green = mask.data[offset + 1]!;
    const blue = mask.data[offset + 2]!;
    if (Math.abs(red - green) > 1 || Math.abs(red - blue) > 1) {
      throw new Error('Colab endpoint 回傳的 PNG 不是灰階 mask');
    }
    out[offset + 3] = Math.round((original.data[offset + 3]! * red) / 255);
  }
  return { data: out, width: original.width, height: original.height };
}

function restoreMaskGeometry(mask: Raster, width: number, height: number): Raster {
  if (mask.width === width && mask.height === height) return mask;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sourceY = (y + 0.5) * mask.height / height - 0.5;
    const y0 = Math.max(0, Math.min(mask.height - 1, Math.floor(sourceY)));
    const y1 = Math.min(mask.height - 1, y0 + 1);
    const fy = Math.max(0, Math.min(1, sourceY - y0));
    for (let x = 0; x < width; x++) {
      const sourceX = (x + 0.5) * mask.width / width - 0.5;
      const x0 = Math.max(0, Math.min(mask.width - 1, Math.floor(sourceX)));
      const x1 = Math.min(mask.width - 1, x0 + 1);
      const fx = Math.max(0, Math.min(1, sourceX - x0));
      const sample = (sx: number, sy: number): number => mask.data[(sy * mask.width + sx) * 4]!;
      const top = sample(x0, y0) * (1 - fx) + sample(x1, y0) * fx;
      const bottom = sample(x0, y1) * (1 - fx) + sample(x1, y1) * fx;
      const value = Math.round(top * (1 - fy) + bottom * fy);
      data.set([value, value, value, 255], (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

export function applyColabMaskToSource(input: Raster, uploadedMask: Raster): Raster {
  return applyMask(input, restoreMaskGeometry(uploadedMask, input.width, input.height));
}

export async function removeBackgroundWithColabBirefnet(
  input: Raster,
  config: ColabBirefnetConnectionConfig,
  options: ColabBirefnetRemoveOptions = {},
): Promise<Raster> {
  const prepared = prepareCrop(input);
  options.onPrepared?.({
    originalWidth: input.width,
    originalHeight: input.height,
    uploadedWidth: prepared.raster.width,
    uploadedHeight: prepared.raster.height,
    uploadedBytes: prepared.png.length,
  });
  const bytes = await postCrop(config, prepared.png, options.signal);
  assertExpectedMaskPng(bytes, prepared.raster.width, prepared.raster.height);
  return applyColabMaskToSource(input, decodePng(bytes));
}
