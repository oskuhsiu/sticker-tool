/** Browser-side LINE Emoji ZIP assembly. */

import { emojiPackManifest } from '../../../src/core/naming.js';
import {
  ANIMATED_EMOJI_SPEC,
  EMOJI_SPEC,
  isEmojiZipBytesAllowed,
  type EmojiKind,
} from '../../../src/core/spec.js';
import { zipSync } from 'fflate';

export interface EmojiPackFiles {
  /** Package name used for the suggested download filename. */
  name: string;
  /** Selects the static or animated ZIP boundary rule. */
  kind: EmojiKind;
  /** The 96x74 chat thumbnail bytes. */
  tab: Uint8Array;
  /** Ordered item bytes, mapped to `001.png` onward. */
  items: Uint8Array[];
}

export interface BuiltEmojiZip {
  filename: string;
  zip: Uint8Array;
  zipBytes: number;
  files: Record<string, Uint8Array>;
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

function assertDenseItems(items: Uint8Array[]): void {
  for (let index = 0; index < items.length; index++) {
    if (!(index in items) || !(items[index] instanceof Uint8Array)) {
      throw new TypeError(`Missing emoji item bytes at ordered position ${index + 1}`);
    }
  }
}

function zipLimitDescription(kind: EmojiKind): string {
  const spec = kind === 'animated-emoji' ? ANIMATED_EMOJI_SPEC : EMOJI_SPEC;
  return `${spec.zipMaxInclusive ? 'at most' : 'less than'} ${spec.zipMaxBytes} bytes`;
}

/** Build the exact flat upload manifest and reject an over-limit final ZIP. */
export function buildEmojiPackZip(pack: EmojiPackFiles): BuiltEmojiZip {
  assertEmojiItemCount(pack.kind, pack.items.length);
  assertDenseItems(pack.items);

  const manifest = emojiPackManifest(pack.items.length);
  const files: Record<string, Uint8Array> = {
    [manifest[0]!]: pack.tab,
  };
  for (let index = 0; index < pack.items.length; index++) {
    files[manifest[index + 1]!] = pack.items[index]!;
  }

  const zip = zipSync(files, { level: 9 });
  if (!isEmojiZipBytesAllowed(pack.kind, zip.length)) {
    throw new RangeError(
      `${pack.kind} ZIP is ${zip.length} bytes; it must be ${zipLimitDescription(pack.kind)}`,
    );
  }

  return {
    filename: `${safeName(pack.name)}.zip`,
    zip,
    zipBytes: zip.length,
    files,
  };
}
