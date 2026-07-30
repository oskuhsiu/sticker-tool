import type { Raster } from './raster.js';

export interface VideoMetadata {
  fileName: string;
  mimeType: string;
  durationMs: number;
  width: number;
  height: number;
}

export interface BrowserVideoSource {
  metadata: VideoMetadata;
  frameAt: (timestampMs: number, signal?: AbortSignal) => Promise<Raster>;
  dispose: () => void;
}

function abortError(): DOMException {
  return new DOMException('影片處理已取消', 'AbortError');
}

function waitForMediaEvent(
  video: HTMLVideoElement,
  success: keyof HTMLMediaElementEventMap,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const cleanup = () => {
      video.removeEventListener(success, onSuccess);
      video.removeEventListener('error', onError);
      signal?.removeEventListener('abort', onAbort);
    };
    const onSuccess = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(video.error?.message ?? '瀏覽器無法解碼這支影片'));
    };
    const onAbort = () => {
      cleanup();
      reject(abortError());
    };
    video.addEventListener(success, onSuccess, { once: true });
    video.addEventListener('error', onError, { once: true });
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Open a local video without uploading it. Frames are decoded through the browser media stack. */
export async function openBrowserVideo(file: File, signal?: AbortSignal): Promise<BrowserVideoSource> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.src = url;
  try {
    await waitForMediaEvent(video, 'loadedmetadata', signal);
    if (!Number.isFinite(video.duration) || video.duration <= 0 || video.videoWidth < 1 || video.videoHeight < 1) {
      throw new Error('影片 metadata 不完整（時長或畫面尺寸無效）');
    }
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      await waitForMediaEvent(video, 'loadeddata', signal);
    }
  } catch (error) {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
    throw error;
  }

  let disposed = false;
  const metadata: VideoMetadata = {
    fileName: file.name,
    mimeType: file.type || 'application/octet-stream',
    durationMs: Math.max(1, Math.floor(video.duration * 1000)),
    width: video.videoWidth,
    height: video.videoHeight,
  };

  return {
    metadata,
    async frameAt(timestampMs, frameSignal) {
      if (disposed) throw new Error('影片來源已釋放');
      if (frameSignal?.aborted) throw abortError();
      const clampedMs = Math.max(0, Math.min(metadata.durationMs - 1, Math.round(timestampMs)));
      const targetSec = clampedMs / 1000;
      if (Math.abs(video.currentTime - targetSec) > 0.0005 || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        const ready = waitForMediaEvent(video, 'seeked', frameSignal);
        video.currentTime = targetSec;
        await ready;
      }
      if (frameSignal?.aborted) throw abortError();
      const canvas = new OffscreenCanvas(metadata.width, metadata.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('無法取得影片擷取用的 2D canvas');
      ctx.drawImage(video, 0, 0, metadata.width, metadata.height);
      const image = ctx.getImageData(0, 0, metadata.width, metadata.height);
      return { data: image.data, width: metadata.width, height: metadata.height };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      video.pause();
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
    },
  };
}
