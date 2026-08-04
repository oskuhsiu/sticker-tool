/** Dedicated Node/browser archive-shape tests for Regular Emoji packs. */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { buildEmojiPack } from '../src/package/buildEmojiZip.js';
import {
  ANIMATED_EMOJI_SPEC,
  EMOJI_SPEC,
  isEmojiZipBytesAllowed,
} from '../src/core/spec.js';
import { buildEmojiPackZip } from '../web/src/webpipe/emojiZip.js';

const expectedEight = [
  'tab.png',
  '001.png',
  '002.png',
  '003.png',
  '004.png',
  '005.png',
  '006.png',
  '007.png',
  '008.png',
];

function browserItems(count: number): Uint8Array[] {
  return Array.from({ length: count }, (_, index) => new Uint8Array([index + 1]));
}

function nodeItems(count: number): Buffer[] {
  return Array.from({ length: count }, (_, index) => Buffer.from([index + 1]));
}

function zipEntryNames(bytes: Uint8Array): string[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let endOffset = bytes.length - 22;
  while (endOffset >= 0 && view.getUint32(endOffset, true) !== 0x06054b50) endOffset--;
  assert.ok(endOffset >= 0, 'ZIP end-of-central-directory record is missing');

  const entryCount = view.getUint16(endOffset + 10, true);
  let offset = view.getUint32(endOffset + 16, true);
  const names: string[] = [];
  for (let index = 0; index < entryCount; index++) {
    assert.equal(view.getUint32(offset, true), 0x02014b50, 'invalid ZIP central-directory entry');
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    names.push(new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength)));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

test('browser emoji ZIP contains only tab.png and a gap-free three-digit item sequence', () => {
  for (const kind of ['emoji', 'animated-emoji'] as const) {
    const result = buildEmojiPackZip({
      name: 'hello / emoji',
      kind,
      tab: new Uint8Array([99]),
      items: browserItems(8),
    });

    assert.equal(result.filename, 'hello_emoji.zip');
    assert.equal(result.zipBytes, result.zip.length);
    assert.deepEqual(Object.keys(result.files), expectedEight);
    assert.ok(!('main.png' in result.files));
    assert.ok(!('01.png' in result.files));

    assert.deepEqual(zipEntryNames(result.zip).sort(), [...expectedEight].sort());
    assert.deepEqual(result.files['tab.png'], new Uint8Array([99]));
    assert.deepEqual(result.files['008.png'], new Uint8Array([8]));
  }
});

test('Node emoji ZIP writes and archives the same exact manifest', async (context) => {
  const outDir = await mkdtemp(path.join(tmpdir(), 'sticker-tool-emoji-zip-'));
  context.after(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  const result = await buildEmojiPack({
    outDir,
    name: 'node emoji',
    kind: 'emoji',
    tab: Buffer.from([99]),
    items: nodeItems(8),
  });

  assert.equal(path.basename(result.zipPath), 'node_emoji.zip');
  assert.deepEqual(result.files, expectedEight);
  assert.deepEqual(
    (await readdir(outDir)).sort(),
    [...expectedEight, 'node_emoji.zip'].sort(),
  );

  const zip = new Uint8Array(await readFile(result.zipPath));
  assert.equal(result.zipBytes, zip.length);
  assert.deepEqual(zipEntryNames(zip).sort(), [...expectedEight].sort());
  assert.deepEqual(await readFile(path.join(outDir, 'tab.png')), Buffer.from([99]));
  assert.deepEqual(await readFile(path.join(outDir, '008.png')), Buffer.from([8]));
});

test('emoji ZIP builders reject counts outside 8-40 and sparse ordered items', async () => {
  const base = {
    name: 'invalid',
    kind: 'emoji' as const,
    tab: new Uint8Array([99]),
  };

  assert.throws(
    () => buildEmojiPackZip({ ...base, items: browserItems(7) }),
    /item count must be an integer from 8 through 40; received 7/,
  );
  assert.throws(
    () => buildEmojiPackZip({ ...base, items: browserItems(41) }),
    /item count must be an integer from 8 through 40; received 41/,
  );

  const forty = buildEmojiPackZip({ ...base, items: browserItems(40) });
  assert.equal(Object.keys(forty.files).at(-1), '040.png');

  const sparse = browserItems(8);
  delete sparse[3];
  assert.throws(
    () => buildEmojiPackZip({ ...base, items: sparse }),
    /Missing emoji item bytes at ordered position 4/,
  );

  await assert.rejects(
    buildEmojiPack({
      outDir: path.join(tmpdir(), 'must-not-be-created-for-invalid-count'),
      name: 'invalid',
      kind: 'animated-emoji',
      tab: Buffer.from([99]),
      items: nodeItems(7),
    }),
    /item count must be an integer from 8 through 40; received 7/,
  );
});

test('emoji ZIP size policies retain distinct static and animated boundaries', () => {
  assert.ok(isEmojiZipBytesAllowed('emoji', EMOJI_SPEC.zipMaxBytes - 1));
  assert.ok(!isEmojiZipBytesAllowed('emoji', EMOJI_SPEC.zipMaxBytes));

  assert.ok(isEmojiZipBytesAllowed('animated-emoji', ANIMATED_EMOJI_SPEC.zipMaxBytes));
  assert.ok(!isEmojiZipBytesAllowed('animated-emoji', ANIMATED_EMOJI_SPEC.zipMaxBytes + 1));
});
