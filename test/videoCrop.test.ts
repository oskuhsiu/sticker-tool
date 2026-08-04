import assert from 'node:assert/strict';
import test from 'node:test';
import {
  planAnimatedCanvas,
  planVideoOutputCanvas,
} from '../src/core/videoCrop.js';

test('Video output canvas is selected before ingest without stretching product contracts', () => {
  assert.deepEqual(planVideoOutputCanvas('animated-sticker', 160, 160), { width: 270, height: 270 });
  assert.deepEqual(planVideoOutputCanvas('animated-sticker', 320, 160), planAnimatedCanvas(320, 160));
  assert.deepEqual(planVideoOutputCanvas('animated-emoji', 320, 160), { width: 180, height: 180 });
  assert.deepEqual(planVideoOutputCanvas('animated-emoji', 160, 320), { width: 180, height: 180 });
  assert.deepEqual(planVideoOutputCanvas('popup', 320, 160), { width: 480, height: 480 });
  assert.deepEqual(planVideoOutputCanvas('popup', 160, 320), { width: 480, height: 480 });
});

test('Video output canvas rejects unknown products and invalid crop geometry', () => {
  assert.throws(
    () => planVideoOutputCanvas('effect' as never, 160, 160),
    /unsupported Video output target/,
  );
  assert.throws(() => planVideoOutputCanvas('animated-sticker', 0, 160), /cropWidth/);
});
