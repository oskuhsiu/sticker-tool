import { clipFrameIntervals, type SourceFrameTiming } from '@core/videoTimeline.js';
import {
  ALL_FORMATS,
  BlobSource,
  Input,
  InputDisposedError,
  VideoSampleSink,
  type InputVideoTrack,
  type VideoSample,
} from 'mediabunny';
import type { Raster } from './raster.js';
import type {
  BrowserVideoSource,
  DecodedVideoFrame,
  VideoMetadata,
} from './videoSourceTypes.js';

export type { BrowserVideoSource, DecodedVideoFrame, VideoMetadata } from './videoSourceTypes.js';

function abortError(): DOMException {
  return new DOMException('影片處理已取消', 'AbortError');
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function createInput(file: File): Input<BlobSource> {
  return new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
}

async function requireVideoTrack(input: Input<BlobSource>): Promise<InputVideoTrack> {
  if (!(await input.canRead())) throw new Error('無法辨識影片容器或檔案已損壞');
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error('影片沒有可使用的 video track');
  if (!(await track.canDecode())) {
    const codec = await track.getCodecParameterString();
    throw new Error(`目前瀏覽器無法解碼 video codec${codec ? ` ${codec}` : ''}`);
  }
  return track;
}

function rasterFromSample(sample: VideoSample, width: number, height: number): Raster {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('無法取得影片擷取用的 2D canvas');
  sample.draw(context, 0, 0, width, height);
  const image = context.getImageData(0, 0, width, height);
  return { data: image.data, width, height };
}

async function buildFrameIndex(track: InputVideoTrack): Promise<SourceFrameTiming[]> {
  const samples: Array<{ timestampUs: number; durationUs: number }> = [];
  for await (const sample of new VideoSampleSink(track).samples()) {
    try {
      samples.push({
        timestampUs: sample.microsecondTimestamp,
        durationUs: sample.microsecondDuration,
      });
    } finally {
      sample.close();
    }
  }
  const trackEndUs = Math.round((await track.computeDuration()) * 1_000_000);
  return samples.map((sample, index) => {
    if (index > 0 && sample.timestampUs <= samples[index - 1]!.timestampUs) {
      throw new Error(`video track 在第 ${index + 1} 格含有重複或逆序 presentation timestamp`);
    }
    const nextTimestampUs = samples[index + 1]?.timestampUs ?? trackEndUs;
    const durationUs = sample.durationUs > 0
      ? Math.min(sample.durationUs, Math.max(1, nextTimestampUs - sample.timestampUs))
      : Math.max(1, nextTimestampUs - sample.timestampUs);
    return { sourceIndex: index, timestampUs: sample.timestampUs, durationUs };
  });
}

async function probeVideo(file: File, signal?: AbortSignal): Promise<{
  metadata: VideoMetadata;
  frameIndex: SourceFrameTiming[];
}> {
  const input = createInput(file);
  const onAbort = () => input.dispose();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    throwIfAborted(signal);
    const track = await requireVideoTrack(input);
    const [
      frameIndex,
      displayWidth,
      displayHeight,
      codedWidth,
      codedHeight,
      rotation,
      pixelAspectRatio,
      codec,
      format,
    ] = await Promise.all([
      buildFrameIndex(track),
      track.getDisplayWidth(),
      track.getDisplayHeight(),
      track.getCodedWidth(),
      track.getCodedHeight(),
      track.getRotation(),
      track.getPixelAspectRatio(),
      track.getCodecParameterString(),
      input.getFormat(),
    ]);
    throwIfAborted(signal);
    if (frameIndex.length === 0) throw new Error('video track 不含任何 presentation frame');
    const firstTimestampUs = frameIndex[0]!.timestampUs;
    const last = frameIndex[frameIndex.length - 1]!;
    const endTimestampUs = last.timestampUs + last.durationUs;
    const durationUs = endTimestampUs - firstTimestampUs;
    return {
      frameIndex,
      metadata: {
        fileName: file.name,
        mimeType: file.type || await input.getMimeType(),
        container: format.constructor.name.replace(/InputFormat$/, ''),
        codec: codec ?? 'unknown',
        durationMs: Math.round(durationUs / 1000),
        durationUs,
        firstTimestampUs,
        endTimestampUs,
        width: displayWidth,
        height: displayHeight,
        codedWidth,
        codedHeight,
        rotation,
        pixelAspectRatio,
        frameCount: frameIndex.length,
        averageFps: durationUs > 0 ? (frameIndex.length * 1_000_000) / durationUs : 0,
      },
    };
  } catch (error) {
    if (signal?.aborted || error instanceof InputDisposedError) throw abortError();
    throw error;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    input.dispose();
  }
}

/** Open and index every presentation sample without uploading or decoding the whole video. */
export async function openBrowserVideo(file: File, signal?: AbortSignal): Promise<BrowserVideoSource> {
  const probed = await probeVideo(file, signal);
  let disposed = false;

  const ensureOpen = () => {
    if (disposed) throw new Error('影片來源已釋放');
  };

  const decodeAt = async (timing: SourceFrameTiming, decodeSignal?: AbortSignal): Promise<DecodedVideoFrame> => {
    ensureOpen();
    throwIfAborted(decodeSignal);
    const input = createInput(file);
    const onAbort = () => input.dispose();
    decodeSignal?.addEventListener('abort', onAbort, { once: true });
    try {
      const track = await requireVideoTrack(input);
      const sample = await new VideoSampleSink(track).getSample(
        probed.frameIndex[timing.sourceIndex]!.timestampUs / 1_000_000,
      );
      if (!sample) throw new Error(`無法解碼 source frame ${timing.sourceIndex}`);
      try {
        return {
          ...timing,
          raster: rasterFromSample(sample, probed.metadata.width, probed.metadata.height),
        };
      } finally {
        sample.close();
      }
    } catch (error) {
      if (decodeSignal?.aborted || error instanceof InputDisposedError) throw abortError();
      throw error;
    } finally {
      decodeSignal?.removeEventListener('abort', onAbort);
      input.dispose();
    }
  };

  return {
    metadata: probed.metadata,
    frameIndex: probed.frameIndex,
    async sampleAt(timestampUs, sampleSignal) {
      ensureOpen();
      if (!Number.isSafeInteger(timestampUs)) throw new RangeError('timestampUs must be a safe integer');
      let index = 0;
      for (let candidate = 1; candidate < probed.frameIndex.length; candidate++) {
        if (probed.frameIndex[candidate]!.timestampUs > timestampUs) break;
        index = candidate;
      }
      return decodeAt(probed.frameIndex[index]!, sampleSignal);
    },
    async *frames(startUs, endUs, frameSignal) {
      ensureOpen();
      const timings = clipFrameIntervals(probed.frameIndex, startUs, endUs);
      if (timings.length === 0) return;
      const input = createInput(file);
      const onAbort = () => input.dispose();
      frameSignal?.addEventListener('abort', onAbort, { once: true });
      try {
        const track = await requireVideoTrack(input);
        const sink = new VideoSampleSink(track);
        const originals = timings.map((timing) => probed.frameIndex[timing.sourceIndex]!);
        let index = 0;
        const firstTimestamp = originals[0]!.timestampUs / 1_000_000;
        const finalTimestampExclusive = (originals[originals.length - 1]!.timestampUs + 1) / 1_000_000;
        for await (const sample of sink.samples(firstTimestamp, finalTimestampExclusive)) {
          throwIfAborted(frameSignal);
          const timing = timings[index];
          const original = originals[index];
          if (!timing || !original) {
            sample.close();
            throw new Error('decoder 回傳多於 frame index 的 presentation samples');
          }
          if (Math.abs(sample.microsecondTimestamp - original.timestampUs) > 1) {
            sample.close();
            throw new Error(`source frame ${timing.sourceIndex} 的 decoder timestamp 與 index 不一致`);
          }
          let raster: Raster;
          try {
            raster = rasterFromSample(sample, probed.metadata.width, probed.metadata.height);
          } finally {
            sample.close();
          }
          yield { ...timings[index]!, raster };
          index++;
        }
        if (index !== timings.length) throw new Error(`decoder 只回傳 ${index}/${timings.length} 個 presentation samples`);
      } catch (error) {
        if (frameSignal?.aborted || error instanceof InputDisposedError) throw abortError();
        throw error;
      } finally {
        frameSignal?.removeEventListener('abort', onAbort);
        input.dispose();
      }
    },
    dispose() {
      disposed = true;
    },
  };
}
