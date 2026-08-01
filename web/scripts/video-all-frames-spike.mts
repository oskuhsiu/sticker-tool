import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  ALL_FORMATS,
  EncodedPacketSink,
  FilePathSource,
  Input,
} from 'mediabunny';
import { encodeApng } from '../src/webpipe/apng.js';

const ffmpeg = '/usr/local/bin/ffmpeg';
const ffprobe = '/usr/local/bin/ffprobe';
const work = mkdtempSync(path.join(tmpdir(), 'sticker-tool-video-v2-'));

function run(program: string, args: string[]): string {
  return execFileSync(program, args, { encoding: 'utf8' });
}

function makeFixtures() {
  const cfr = path.join(work, 'cfr-12.mp4');
  const vfr = path.join(work, 'vfr.mp4');
  const rotated = path.join(work, 'rotated.mov');
  const nonZero = path.join(work, 'non-zero-first.mp4');
  const unsupported = path.join(work, 'unsupported-ffv1.mkv');
  run(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=12:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', cfr]);
  run(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30:duration=1', '-vf', "select='eq(n,0)+eq(n,1)+eq(n,4)+eq(n,9)+eq(n,15)+eq(n,22)+eq(n,29)'", '-fps_mode', 'vfr', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', vfr]);
  run(ffmpeg, ['-y', '-loglevel', 'error', '-display_rotation:v:0', '-90', '-i', cfr, '-c', 'copy', rotated]);
  run(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=5:duration=1', '-vf', 'setpts=PTS+0.5/TB', '-c:v', 'libx264', '-bf', '0', '-pix_fmt', 'yuv420p', '-copyts', nonZero]);
  run(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=2:duration=1', '-c:v', 'ffv1', unsupported]);
  return { cfr, vfr, rotated, nonZero, unsupported };
}

function ffprobePresentationTimestamps(file: string): number[] {
  const parsed = JSON.parse(run(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_frames', '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'json', file])) as {
    frames: Array<{ best_effort_timestamp_time: string }>;
  };
  return parsed.frames
    .map((frame) => Math.round(Number(frame.best_effort_timestamp_time) * 1_000_000))
    .sort((a, b) => a - b);
}

async function mediabunnyTiming(file: string) {
  const input = new Input({ formats: ALL_FORMATS, source: new FilePathSource(file) });
  try {
    const track = await input.getPrimaryVideoTrack();
    assert.ok(track);
    const packets = [] as Array<{ timestampUs: number; durationUs: number; sequence: number }>;
    const iterator = new EncodedPacketSink(track).packets(undefined, undefined, { metadataOnly: true });
    for await (const packet of iterator) {
      packets.push({ timestampUs: packet.microsecondTimestamp, durationUs: packet.microsecondDuration, sequence: packet.sequenceNumber });
    }
    packets.sort((a, b) => a.timestampUs - b.timestampUs || a.sequence - b.sequence);
    const trackEndUs = Math.round((await track.computeDuration()) * 1_000_000);
    const visiblePackets = packets.filter((packet, index) =>
      packet.durationUs > 0 || packet.timestampUs < trackEndUs || index < packets.length - 1,
    );
    return {
      timing: visiblePackets.map((packet, index) => {
        const nextTimestampUs = visiblePackets[index + 1]?.timestampUs ?? trackEndUs;
        return {
          timestampUs: packet.timestampUs,
          durationUs: packet.durationUs > 0
            ? Math.min(packet.durationUs, Math.max(1, nextTimestampUs - packet.timestampUs))
            : Math.max(1, nextTimestampUs - packet.timestampUs),
        };
      }),
      width: await track.getDisplayWidth(),
      height: await track.getDisplayHeight(),
      rotation: await track.getRotation(),
    };
  } finally {
    input.dispose();
  }
}

async function canDecode(file: string): Promise<boolean> {
  const input = new Input({ formats: ALL_FORMATS, source: new FilePathSource(file) });
  try {
    assert.equal(await input.canRead(), true);
    const track = await input.getPrimaryVideoTrack();
    assert.ok(track);
    return track.canDecode();
  } finally {
    input.dispose();
  }
}

function benchmarkMaster(crops: number, fps: 30 | 60) {
  const width = 320;
  const height = 270;
  const chunkFrames = 20;
  const totalFrames = fps * 4;
  const before = process.memoryUsage();
  const pending = Array.from({ length: crops }, (_, crop) =>
    Array.from({ length: chunkFrames }, (_, frame) => {
      const data = new Uint8ClampedArray(width * height * 4);
      for (let pixel = 0; pixel < width * height; pixel++) {
        data[pixel * 4] = (pixel + crop * 17 + frame * 5) & 255;
        data[pixel * 4 + 1] = (pixel * 3 + frame * 11) & 255;
        data[pixel * 4 + 2] = (crop * 23 + frame * 13) & 255;
        data[pixel * 4 + 3] = pixel % 11 === 0 ? 0 : 255;
      }
      return { data, width, height };
    }),
  );
  const allocated = process.memoryUsage();
  const started = performance.now();
  let oneChunkBytes = 0;
  for (const frames of pending) {
    oneChunkBytes += encodeApng(frames, { loops: 1, delaysMs: frames.map(() => 1), colors: 0, forbidPalette: true }).length;
  }
  const chunkEncodeMs = performance.now() - started;
  const chunksPerSticker = Math.ceil(totalFrames / chunkFrames);
  return {
    crops,
    fps,
    sourceFrames: totalFrames,
    cropFrames: totalFrames * crops,
    measuredPendingBytes: allocated.arrayBuffers - before.arrayBuffers,
    measuredExternalBytes: allocated.external - before.external,
    estimatedPeakBytes: crops * chunkFrames * width * height * 4,
    estimatedMasterBytes: oneChunkBytes * chunksPerSticker,
    estimatedEncodeMs: chunkEncodeMs * chunksPerSticker,
  };
}

const fixtures = makeFixtures();
for (const file of [fixtures.cfr, fixtures.vfr, fixtures.nonZero]) {
  const expectedTimestamps = ffprobePresentationTimestamps(file);
  const actual = await mediabunnyTiming(file);
  assert.equal(actual.timing.length, expectedTimestamps.length, `${path.basename(file)} frame count`);
  actual.timing.forEach((frame, index) => {
    assert.ok(
      Math.abs(frame.timestampUs - expectedTimestamps[index]!) <= 1,
      `${path.basename(file)} frame ${index} timestamp differs by more than 1us`,
    );
    if (index + 1 < expectedTimestamps.length) {
      const expectedHoldUs = expectedTimestamps[index + 1]! - expectedTimestamps[index]!;
      assert.ok(
        Math.abs(frame.durationUs - expectedHoldUs) <= 1,
        `${path.basename(file)} frame ${index} presentation duration differs by more than 1us`,
      );
    } else {
      assert.ok(frame.durationUs > 0, `${path.basename(file)} final frame duration must be positive`);
    }
  });
}
const nonZero = await mediabunnyTiming(fixtures.nonZero);
assert.ok(nonZero.timing[0]!.timestampUs > 0, 'non-zero fixture must retain its positive first timestamp');
const rotated = await mediabunnyTiming(fixtures.rotated);
assert.equal(rotated.rotation, 90);
assert.deepEqual([rotated.width, rotated.height], [180, 320]);
assert.equal(await canDecode(fixtures.unsupported), false, 'FFV1 fixture must exercise unsupported codec rejection');

const cancelInput = new Input({ formats: ALL_FORMATS, source: new FilePathSource(fixtures.cfr) });
const cancelTrack = await cancelInput.getPrimaryVideoTrack();
assert.ok(cancelTrack);
const cancelIterator = new EncodedPacketSink(cancelTrack).packets(undefined, undefined, { metadataOnly: true });
await cancelIterator.next();
await cancelIterator.return();
cancelInput.dispose();

const benchmarks = [
  benchmarkMaster(8, 30),
  benchmarkMaster(8, 60),
  benchmarkMaster(24, 30),
  benchmarkMaster(24, 60),
];
console.log(JSON.stringify({
  fixtures: {
    cfrFrames: ffprobePresentationTimestamps(fixtures.cfr).length,
    vfrTiming: (await mediabunnyTiming(fixtures.vfr)).timing,
    nonZeroFirstTimestampUs: nonZero.timing[0]!.timestampUs,
    rotation: { degrees: rotated.rotation, display: [rotated.width, rotated.height] },
    unsupportedCodec: 'FFV1 rejected by canDecode',
    cancellation: 'iterator.return + input.dispose completed',
  },
  benchmarks,
  selectedBetaHardBudgetBytes: 512 * 1024 * 1024,
}, null, 2));
