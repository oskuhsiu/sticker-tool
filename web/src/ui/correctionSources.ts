import { decodeBlob, type Raster } from '../webpipe/raster.js';

export interface ForegroundCorrectionSourceItem {
  readonly identity: string;
  readonly label: string;
  load(): Promise<Raster>;
}

const fileIdentities = new WeakMap<File, string>();
let nextFileIdentity = 1;

export function fileSourceIdentity(file: File): string {
  const existing = fileIdentities.get(file);
  if (existing) return existing;
  const identity = `file-${nextFileIdentity++}`;
  fileIdentities.set(file, identity);
  return identity;
}

export function fileCorrectionSource(
  file: File,
  label = file.name,
): ForegroundCorrectionSourceItem {
  return {
    identity: fileSourceIdentity(file),
    label,
    load: () => decodeBlob(file),
  };
}
