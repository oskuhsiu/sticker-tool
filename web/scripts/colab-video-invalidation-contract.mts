import assert from 'node:assert/strict';
import {
  invalidateColabVideoCurrent,
  videoRemoverVersion,
} from '../src/ui/VideoTab.js';

const colabRender = {
  id: 'old-colab-render',
  settings: { background: { mode: 'colab-birefnet' } },
} as const;
const localRender = {
  id: 'local-render',
  settings: { background: { mode: 'local-birefnet' } },
} as const;

assert.deepEqual(
  invalidateColabVideoCurrent([colabRender, localRender]),
  [null, localRender],
);
const unchanged = [null, localRender] as const;
assert.equal(invalidateColabVideoCurrent(unchanged), unchanged);

// The helper deliberately accepts only snapshot provenance, never mutable drafts.
// A Colab render is therefore invalidated even if its draft temporarily changed.
assert.deepEqual(invalidateColabVideoCurrent([colabRender]), [null]);

assert.equal(
  videoRemoverVersion('colab-birefnet', 'Colab 多模型去背', 7),
  'Colab 多模型去背@1:connection-7',
);
assert.notEqual(
  videoRemoverVersion('colab-birefnet', 'Colab 多模型去背', 7),
  videoRemoverVersion('colab-birefnet', 'Colab 多模型去背', 8),
);
assert.equal(videoRemoverVersion('local-birefnet', 'Local BiRefNet', null), 'Local BiRefNet@1');
assert.throws(
  () => videoRemoverVersion('colab-birefnet', 'Colab 多模型去背', null),
  /generation/,
);

console.log('✓ Video Colab connection generation changes cache identity and invalidates old currents');
