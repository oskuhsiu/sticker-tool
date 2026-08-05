export const LOCAL_BIREFNET_MODEL_ID = 'studioludens/birefnet-lite-512';
export const LOCAL_BIREFNET_MODEL_REVISION = '4a3c40c36c94093cc1e724d9ea428b8fa4b57dc7';
export const LOCAL_BIREFNET_MODEL_FILE = 'onnx/model_fp16.onnx';
export const LOCAL_BIREFNET_MODEL_BYTES = 98_484_532;
export const LOCAL_BIREFNET_PARAMETER_COUNT = 44_400_000;

export type LocalBirefnetBackend = 'webgpu' | 'wasm';

export type LocalBirefnetProgress =
  | { stage: 'initializing'; backend: LocalBirefnetBackend }
  | { stage: 'download'; file: string; loaded?: number; total?: number; percent?: number }
  | { stage: 'compiling'; backend: LocalBirefnetBackend }
  | { stage: 'fallback'; reason: string }
  | { stage: 'ready'; backend: LocalBirefnetBackend };

export function hasLocalBirefnetWebgpu(value: object | null | undefined): boolean {
  return value !== null && value !== undefined && 'gpu' in value
    && (value as { gpu?: unknown }).gpu !== undefined;
}

export function combineLocalBirefnetAlpha(
  sourceRgba: Uint8ClampedArray,
  removedRgba: Uint8Array | Uint8ClampedArray,
): Uint8ClampedArray<ArrayBuffer> {
  if (sourceRgba.length !== removedRgba.length || sourceRgba.length % 4 !== 0) {
    throw new Error('BiRefNet 輸出尺寸與來源 crop 不一致');
  }
  const output = new Uint8ClampedArray(sourceRgba.length);
  for (let offset = 0; offset < sourceRgba.length; offset += 4) {
    output[offset] = sourceRgba[offset]!;
    output[offset + 1] = sourceRgba[offset + 1]!;
    output[offset + 2] = sourceRgba[offset + 2]!;
    output[offset + 3] = Math.round(sourceRgba[offset + 3]! * removedRgba[offset + 3]! / 255);
  }
  return output;
}
