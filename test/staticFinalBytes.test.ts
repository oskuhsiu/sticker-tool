import assert from 'node:assert/strict';
import test from 'node:test';
import { validateStaticImage, type ImageInfo } from '../src/core/validate.js';

const finalStatic: ImageInfo = {
  width: 320,
  height: 270,
  bytes: 100_000,
  hasAlpha: true,
  channels: 4,
  format: 'png',
  colorType: 6,
  transparentPixels: 1,
  foregroundPixels: 1,
};

test('Regular Sticker final-byte evidence accepts truecolor PNG with visible transparent content', () => {
  assert.equal(validateStaticImage(finalStatic).ok, true);
});

for (const [label, overrides, code] of [
  ['non-PNG format', { format: 'webp' }, 'static.format'],
  ['indexed PNG', { colorType: 3 }, 'static.rgb'],
  ['opaque output', { transparentPixels: 0 }, 'static.transparentPixels'],
  ['blank output', { foregroundPixels: 0 }, 'static.empty'],
] as const) {
  test(`Regular Sticker final-byte evidence rejects ${label}`, () => {
    const validation = validateStaticImage({ ...finalStatic, ...overrides });
    assert.equal(validation.ok, false);
    assert.ok(validation.issues.some((issue) => issue.code === code));
  });
}

test('legacy metadata without optional final-byte evidence remains diagnosable', () => {
  const { format, colorType, transparentPixels, foregroundPixels, ...legacy } = finalStatic;
  assert.equal(validateStaticImage(legacy).ok, true);
});
