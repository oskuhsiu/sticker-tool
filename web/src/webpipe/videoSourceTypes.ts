import type { SourceFrameTiming } from '@core/videoTimeline.js';
import type { Raster } from './raster.js';

export interface VideoMetadata {
  fileName: string;
  mimeType: string;
  container: string;
  codec: string;
  durationMs: number;
  durationUs: number;
  firstTimestampUs: number;
  endTimestampUs: number;
  width: number;
  height: number;
  codedWidth: number;
  codedHeight: number;
  rotation: 0 | 90 | 180 | 270;
  pixelAspectRatio: { num: number; den: number };
  frameCount: number;
  averageFps: number;
}
export interface DecodedVideoFrame extends SourceFrameTiming {
  raster: Raster;
}

export interface BrowserVideoSource {
  metadata: VideoMetadata;
  frameIndex: readonly SourceFrameTiming[];
  sampleAt: (timestampUs: number, signal?: AbortSignal) => Promise<DecodedVideoFrame>;
  frames: (
    startUs: number,
    endUs: number,
    signal?: AbortSignal,
  ) => AsyncGenerator<DecodedVideoFrame, void, unknown>;
  dispose: () => void;
}
