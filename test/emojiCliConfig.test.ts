/** CLI/config regression tests for the Regular Emoji product selector. */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import YAML from 'yaml';

import { normalizeConfig } from '../src/config/load.js';
import { ConfigSchema } from '../src/config/schema.js';
import { EXAMPLE_EMOJI_CONFIG } from '../src/cli/commands/init.js';
import { buildFramesPrompt, buildSheetPrompt } from '../src/core/prompt.js';

function parse(input: unknown) {
  return ConfigSchema.parse(input);
}

test('legacy configs default to sticker and preserve frame-based animation inference', () => {
  const staticConfig = normalizeConfig(parse({ package: { name: 'legacy', count: 8 } }));
  assert.equal(staticConfig.kind, 'static');
  assert.equal(staticConfig.emojiSet, undefined);
  assert.deepEqual(staticConfig.processing.maxSize, [370, 320]);
  assert.equal(staticConfig.animation.maxBytes, 1_000_000);
  assert.equal(staticConfig.animation.autoFit, true);

  const animatedConfig = normalizeConfig(parse({
    package: { name: 'legacy anim', count: 8 },
    stickers: [{ frames: ['01.png', '02.png', '03.png', '04.png', '05.png'] }],
  }));
  assert.equal(animatedConfig.kind, 'animated');
  assert.deepEqual(animatedConfig.processing.maxSize, [320, 270]);
  assert.equal(animatedConfig.animation.maxBytes, 1_000_000);
});

test('regular emoji resolves exact static and animated product defaults once', () => {
  const staticConfig = normalizeConfig(parse({
    package: { name: 'emoji', product: 'emoji', emojiSet: 'regular', count: 9 },
  }));
  assert.equal(staticConfig.kind, 'emoji');
  assert.equal(staticConfig.emojiSet, 'regular');
  assert.deepEqual(staticConfig.processing.maxSize, [180, 180]);
  assert.equal(staticConfig.animation.maxBytes, 300_000);
  assert.equal(staticConfig.animation.autoFit, false);

  const animatedConfig = normalizeConfig(parse({
    package: {
      name: 'animated emoji',
      product: 'emoji',
      emojiSet: 'regular',
      animated: true,
      count: 40,
    },
    animation: { maxBytes: 250_000, durationSec: 1, loops: 4 },
  }));
  assert.equal(animatedConfig.kind, 'animated-emoji');
  assert.deepEqual(animatedConfig.processing.maxSize, [180, 180]);
  assert.equal(animatedConfig.animation.maxBytes, 250_000);
  assert.equal(animatedConfig.animation.durationSec, 1);
  assert.equal(animatedConfig.animation.loops, 4);
  assert.equal(animatedConfig.animation.autoFit, false);

  const explicitFit = normalizeConfig(parse({
    package: {
      name: 'explicit compression',
      product: 'emoji',
      emojiSet: 'regular',
      animated: true,
      count: 8,
    },
    animation: { autoFit: true, durationSec: 1 },
  }));
  assert.equal(explicitFit.animation.autoFit, true);
});

test('emoji config rejects missing set identity, invalid counts, and sticker-only conflicts', () => {
  const invalidInputs: Array<[string, unknown, RegExp]> = [
    [
      'missing set',
      { package: { product: 'emoji', count: 8 } },
      /emojiSet=regular/,
    ],
    [
      'count below range',
      { package: { product: 'emoji', emojiSet: 'regular', count: 7 } },
      /8–40/,
    ],
    [
      'count above range',
      { package: { product: 'emoji', emojiSet: 'regular', count: 41 } },
      /8–40/,
    ],
    [
      'emoji field on sticker',
      { package: { product: 'sticker', emojiSet: 'regular', count: 8 } },
      /只能用於 product=emoji/,
    ],
    [
      'explicit static conflicts with frames',
      {
        package: { animated: false, count: 8 },
        stickers: [{ frames: ['01.png'] }],
      },
      /animated=false/,
    ],
  ];

  for (const [label, input, message] of invalidInputs) {
    const parsed = ConfigSchema.safeParse(input);
    assert.equal(parsed.success, false, label);
    if (!parsed.success) assert.match(parsed.error.message, message, label);
  }
});

test('animated emoji rejects looser output limits instead of silently coercing them', () => {
  const base = {
    package: {
      product: 'emoji',
      emojiSet: 'regular',
      animated: true,
      count: 8,
    },
  } as const;
  const invalidInputs: Array<[string, unknown, RegExp]> = [
    [
      'non-exact canvas',
      { ...base, processing: { maxSize: [180, 178] } },
      /180×180/,
    ],
    [
      'oversized animation budget',
      { ...base, animation: { maxBytes: 300_001 } },
      /300000/,
    ],
    [
      'minimum frame floor over official maximum',
      { ...base, animation: { minFrames: 21 } },
      /minFrames 須為 5–20/,
    ],
    [
      'ladder frame rung below official minimum',
      { ...base, animation: { ladder: [{ colors: 128, frames: 4 }] } },
      /ladder 的 frames 須為 5–20/,
    ],
    [
      'fractional duration',
      { ...base, animation: { durationSec: 1.5 } },
      /1\/2\/3\/4/,
    ],
    [
      'total playback over four seconds',
      { ...base, animation: { durationSec: 2, loops: 3 } },
      /不得超過 4 秒/,
    ],
  ];

  for (const [label, input, message] of invalidInputs) {
    const parsed = ConfigSchema.safeParse(input);
    assert.equal(parsed.success, false, label);
    if (!parsed.success) assert.match(parsed.error.message, message, label);
  }
});

test('emoji init template parses and target-aware prompts preserve semantic guidance', () => {
  const config = normalizeConfig(parse(YAML.parse(EXAMPLE_EMOJI_CONFIG)));
  assert.equal(config.kind, 'emoji');
  assert.deepEqual(config.processing.maxSize, [180, 180]);
  assert.equal(config.animation.autoFit, false);

  const layout = { count: 8, cols: 4, rows: 2, sheets: 1, cellsPerSheet: 8 };
  const sheet = buildSheetPrompt({
    style: 'simple',
    layout,
    isCharacter: true,
    transparent: true,
    product: 'emoji',
  });
  assert.match(sheet, /LINE-emoji sprite sheet/);
  assert.match(sheet, /very small inline chat image/);
  assert.match(sheet, /exact 180×180 transparent output canvas/);

  const frames = buildFramesPrompt({
    style: 'simple',
    layout,
    motion: 'wave hello',
    isCharacter: true,
    transparent: true,
    product: 'emoji',
  });
  assert.match(frames, /ANIMATED EMOJI/);
  assert.match(frames, /FIRST-FRAME MEANING/);
  assert.match(frames, /frame 1 must communicate/);

  const legacy = buildSheetPrompt({
    style: 'simple',
    layout,
    isCharacter: true,
    transparent: true,
  });
  assert.match(legacy, /LINE-sticker sprite sheet/);
  assert.doesNotMatch(legacy, /EMOJI READABILITY/);
});
