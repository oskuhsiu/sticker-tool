/** Build a LINE Emoji upload ZIP with `tab.png` and three-digit item names. */

import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import archiver from 'archiver';
import { emojiPackManifest } from '../core/naming.js';
import {
  ANIMATED_EMOJI_SPEC,
  EMOJI_SPEC,
  isEmojiZipBytesAllowed,
  type EmojiKind,
} from '../core/spec.js';

export interface BuildEmojiPackArgs {
  /** Output directory for the upload files and ZIP. */
  outDir: string;
  /** Package name used for the ZIP filename. */
  name: string;
  /** Selects the static or animated ZIP boundary rule. */
  kind: EmojiKind;
  /** The 96x74 chat thumbnail bytes. */
  tab: Buffer;
  /** Ordered item bytes, mapped to `001.png` onward. */
  items: Buffer[];
}

export interface BuildEmojiPackResult {
  dir: string;
  zipPath: string;
  zipBytes: number;
  files: string[];
}

function safeName(name: string): string {
  const safe = name.trim().replace(/[^\w一-鿿.-]+/g, '_').replace(/^_+|_+$/g, '');
  return safe.length > 0 ? safe : 'stickers';
}

function assertEmojiItemCount(kind: EmojiKind, count: number): void {
  const spec = kind === 'animated-emoji' ? ANIMATED_EMOJI_SPEC : EMOJI_SPEC;
  if (!Number.isInteger(count) || count < spec.minCount || count > spec.maxCount) {
    throw new RangeError(
      `${kind} item count must be an integer from ${spec.minCount} through ${spec.maxCount}; received ${count}`,
    );
  }
}

function assertDenseItems(items: Buffer[]): void {
  for (let index = 0; index < items.length; index++) {
    if (!(index in items) || !Buffer.isBuffer(items[index])) {
      throw new TypeError(`Missing emoji item bytes at ordered position ${index + 1}`);
    }
  }
}

function zipLimitDescription(kind: EmojiKind): string {
  const spec = kind === 'animated-emoji' ? ANIMATED_EMOJI_SPEC : EMOJI_SPEC;
  return `${spec.zipMaxInclusive ? 'at most' : 'less than'} ${spec.zipMaxBytes} bytes`;
}

async function removeTemporaryFile(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

/** Write the emoji files and produce a ZIP only when its final byte size is valid. */
export async function buildEmojiPack(args: BuildEmojiPackArgs): Promise<BuildEmojiPackResult> {
  const { outDir, name, kind, tab, items } = args;
  assertEmojiItemCount(kind, items.length);
  assertDenseItems(items);

  const manifest = emojiPackManifest(items.length);
  const itemPaths = manifest.slice(1);
  await mkdir(outDir, { recursive: true });

  const written: { abs: string; entry: string }[] = [];
  const put = async (entry: string, bytes: Buffer) => {
    const abs = path.join(outDir, entry);
    await writeFile(abs, bytes);
    written.push({ abs, entry });
  };

  await put(manifest[0]!, tab);
  for (let index = 0; index < items.length; index++) {
    await put(itemPaths[index]!, items[index]!);
  }

  const zipPath = path.join(outDir, `${safeName(name)}.zip`);
  const temporaryZipPath = `${zipPath}.${randomUUID()}.tmp`;
  try {
    const zipBytes = await zipFiles(temporaryZipPath, written);
    if (!isEmojiZipBytesAllowed(kind, zipBytes)) {
      throw new RangeError(
        `${kind} ZIP is ${zipBytes} bytes; it must be ${zipLimitDescription(kind)}`,
      );
    }
    await rename(temporaryZipPath, zipPath);
    return {
      dir: outDir,
      zipPath,
      zipBytes,
      files: manifest,
    };
  } catch (error) {
    await removeTemporaryFile(temporaryZipPath);
    throw error;
  }
}

function zipFiles(zipPath: string, files: { abs: string; entry: string }[]): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const output = createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', () => resolve(archive.pointer()));
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);
    for (const file of files) archive.file(file.abs, { name: file.entry });
    void archive.finalize();
  });
}
