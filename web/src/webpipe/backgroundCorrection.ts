import {
  applyForegroundCorrection,
  createKeepMask,
  type KeepMask,
} from './foregroundCorrection.js';
import type {
  BackgroundRemovalJob,
  BackgroundRemovalRender,
  PreparedBackgroundRemovalSession,
} from './backgroundRemovalJob.js';
import type { ColorKeyCalibrationDiagnostics } from './preparedColorKey.js';
import type { Raster } from './raster.js';
import { unzlibSync, zlibSync } from 'fflate';

export interface ForegroundCorrectionRecord {
  readonly sourceIdentity: string;
  readonly label: string;
  readonly width: number;
  readonly height: number;
  readonly keepMask?: KeepMask;
  /** Lossless RGBA cache; avoids retaining one full decoded raster per source. */
  readonly automaticCompressed?: Uint8Array;
  readonly automaticByteLength?: number;
  readonly automaticConfigurationIdentity?: string;
  readonly sessionIdentity?: string;
  readonly diagnostics?: ColorKeyCalibrationDiagnostics;
}

export type ForegroundCorrectionRecords = ReadonlyMap<string, ForegroundCorrectionRecord>;

export interface CorrectedBackgroundRemoval extends BackgroundRemovalRender {
  corrected: Raster;
  reusedAutomatic: boolean;
}

function sameGeometry(raster: Raster, width: number, height: number): boolean {
  return raster.width === width && raster.height === height;
}

export function compatibleKeepMask(
  record: ForegroundCorrectionRecord | undefined,
  source: Raster,
  sourceIdentity?: string,
): KeepMask {
  if (
    record?.sourceIdentity
    && (sourceIdentity === undefined || record.sourceIdentity === sourceIdentity)
    && record.width === source.width
    && record.height === source.height
    && record.keepMask?.width === source.width
    && record.keepMask.height === source.height
  ) return record.keepMask;
  return createKeepMask(source.width, source.height);
}

export function cacheAutomaticRaster(raster: Raster): Pick<
  ForegroundCorrectionRecord,
  'automaticCompressed' | 'automaticByteLength'
> {
  const bytes = new Uint8Array(raster.data.buffer, raster.data.byteOffset, raster.data.byteLength);
  return {
    automaticCompressed: zlibSync(bytes, { level: 6 }),
    automaticByteLength: bytes.byteLength,
  };
}

export function cachedAutomaticRaster(
  record: ForegroundCorrectionRecord | undefined,
): Raster | null {
  if (!record?.automaticCompressed || record.automaticByteLength !== record.width * record.height * 4) return null;
  const bytes = unzlibSync(record.automaticCompressed);
  if (bytes.byteLength !== record.automaticByteLength) return null;
  return {
    width: record.width,
    height: record.height,
    data: new Uint8ClampedArray(bytes.buffer, bytes.byteOffset, bytes.byteLength).slice(),
  };
}

/**
 * Reuse an immutable automatic snapshot when it belongs to the same source and
 * background configuration. Mask-only edits therefore never rerun a model.
 */
export async function removeWithForegroundCorrection(args: {
  input: Raster;
  sourceIdentity: string;
  configurationIdentity: string;
  job: BackgroundRemovalJob;
  record?: ForegroundCorrectionRecord;
  preparedSession?: PreparedBackgroundRemovalSession;
  removeAutomatic?: () => Promise<BackgroundRemovalRender>;
  signal?: AbortSignal;
}): Promise<CorrectedBackgroundRemoval> {
  const { input, record } = args;
  const cachedAutomatic = record?.sourceIdentity === args.sourceIdentity
    && record.automaticConfigurationIdentity === args.configurationIdentity
    ? cachedAutomaticRaster(record)
    : null;
  const reusable = cachedAutomatic !== null && sameGeometry(cachedAutomatic, input.width, input.height);
  const automatic = reusable
    ? {
        raster: cachedAutomatic,
        automaticMatte: alphaMatte(cachedAutomatic),
        sessionIdentity: record?.sessionIdentity ?? 'cached-automatic',
        diagnostics: record?.diagnostics,
      }
    : args.removeAutomatic
      ? await args.removeAutomatic()
      : args.preparedSession
        ? await args.preparedSession.remove(input, args.signal)
        : await (await args.job.prepare([input], args.signal)).remove(input, args.signal);
  const keepMask = compatibleKeepMask(record, input, args.sourceIdentity);
  return {
    ...automatic,
    corrected: applyForegroundCorrection(input, automatic.raster, keepMask),
    reusedAutomatic: reusable,
  };
}

export function backgroundRemovalRenderFromRaster(
  raster: Raster,
  sessionIdentity: string,
  diagnostics?: ColorKeyCalibrationDiagnostics,
): BackgroundRemovalRender {
  return {
    raster,
    automaticMatte: alphaMatte(raster),
    sessionIdentity,
    ...(diagnostics ? { diagnostics } : {}),
  };
}

export function invalidateAutomaticCorrections(
  records: ForegroundCorrectionRecords,
): Map<string, ForegroundCorrectionRecord> {
  return new Map([...records].map(([identity, record]) => [identity, {
    sourceIdentity: record.sourceIdentity,
    label: record.label,
    width: record.width,
    height: record.height,
    ...(record.keepMask ? { keepMask: record.keepMask } : {}),
  }]));
}

function alphaMatte(raster: Raster): Uint8ClampedArray<ArrayBuffer> {
  const matte = new Uint8ClampedArray(raster.width * raster.height);
  for (let pixel = 0; pixel < matte.length; pixel++) matte[pixel] = raster.data[pixel * 4 + 3]!;
  return matte;
}
