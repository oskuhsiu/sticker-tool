/**
 * 產 main.png（240×240）與 tab.png（96×74）（瀏覽器版）。
 * 靜態包：兩者皆靜態 PNG。動態包：main 須為 APNG、tab 仍為靜態。
 */

import { MAIN, TAB } from '@core/spec.js';
import { equalRgbaFrames } from '@core/frameSequence.js';
import type { AnimationConfig } from '@core/types.js';
import type { ImageInfo } from '@core/validate.js';
import { fitCanvas } from './fitCanvas.js';
import { decodeApngFrames, encodeApngAutoFit, encodeApngExactFrames, readApngInfo } from './apng.js';
import { encodePng, pngImageInfo } from './png.js';
import type { Raster } from './raster.js';

export interface MainTabResult {
  main: Uint8Array;
  tab: Uint8Array;
  mainInfo: ImageInfo;
  tabInfo: ImageInfo;
}

/** 靜態 main/tab（由封面貼圖的 fit 後點陣產生） */
export function buildMainTab(coverStatic: Raster): MainTabResult {
  const mainFit = fitCanvas(coverStatic, {
    bounds: { width: MAIN.width, height: MAIN.height },
    mode: 'exact',
    marginPx: 10,
  });
  const tabFit = fitCanvas(coverStatic, {
    bounds: { width: TAB.width, height: TAB.height },
    mode: 'exact',
    marginPx: 4,
  });
  const main = encodePng(mainFit, 0, true);
  const tab = encodePng(tabFit, 0, true);
  return {
    main,
    tab,
    mainInfo: { ...pngImageInfo(main), ...contentEvidence(mainFit) },
    tabInfo: { ...pngImageInfo(tab), ...contentEvidence(tabFit) },
  };
}

/** tab.png 單獨產（動態包用：tab 仍是靜態，取封面首格） */
export function buildTab(coverFrame: Raster): { tab: Uint8Array; tabInfo: ImageInfo } {
  const tabFit = fitCanvas(coverFrame, {
    bounds: { width: TAB.width, height: TAB.height },
    mode: 'exact',
    marginPx: 4,
  });
  const tab = encodePng(tabFit, 0, true);
  const tabInfo = pngImageInfo(tab);
  return { tab, tabInfo: { ...tabInfo, ...contentEvidence(tabFit) } };
}

function contentEvidence(raster: Raster): Pick<ImageInfo, 'transparentPixels' | 'foregroundPixels'> {
  let transparentPixels = 0;
  let foregroundPixels = 0;
  for (let index = 3; index < raster.data.length; index += 4) {
    if (raster.data[index]! < 255) transparentPixels++;
    if (raster.data[index]! > 10) foregroundPixels++;
  }
  return { transparentPixels, foregroundPixels };
}

/** Video v2 main: preserve the cover sticker's actual frames, delays, and loop count. */
export function buildAnimatedMainFromTimeline(
  coverFrames: Raster[],
  delaysMs: number[],
  loops: number,
): { main: Uint8Array; mainInfo: ImageInfo; frames: Raster[] } {
  const framesMain = coverFrames.map((frame) =>
    fitCanvas(frame, { bounds: { width: MAIN.width, height: MAIN.height }, mode: 'exact', marginPx: 0 }),
  );
  const encoded = encodeApngExactFrames(framesMain, {
    loops,
    delaysMs,
    maxBytes: 1_000_000,
    minColors: 16,
  });
  const decoded = decodeApngFrames(encoded.png);
  const distinct: Raster[] = [];
  let transparentPixels = 0;
  let foregroundPixels = 0;
  let adjacentDuplicateFrames = 0;
  decoded.frames.forEach((frame, frameIndex) => {
    if (!distinct.some((candidate) => equalRgbaFrames(candidate, frame))) distinct.push(frame);
    if (frameIndex > 0 && equalRgbaFrames(decoded.frames[frameIndex - 1]!, frame)) adjacentDuplicateFrames++;
    for (let index = 3; index < frame.data.length; index += 4) {
      if (frame.data[index]! < 255) transparentPixels++;
      if (frame.data[index]! > 10) foregroundPixels++;
    }
  });
  return {
    main: encoded.png,
    frames: decoded.frames,
    mainInfo: {
      width: MAIN.width,
      height: MAIN.height,
      bytes: encoded.png.length,
      hasAlpha: true,
      channels: 4,
      isApng: decoded.frames.length > 1,
      frames: decoded.frames.length,
      requestedFrames: coverFrames.length,
      loops: decoded.loops,
      durationMs: decoded.delaysMs.reduce((sum, delay) => sum + delay, 0),
      distinctFrames: distinct.length,
      adjacentDuplicateFrames,
      transparentPixels,
      foregroundPixels,
    },
  };
}

/** 動態包的 main.png：APNG（首格當靜態縮圖） */
export function buildAnimatedMain(
  coverFrames: Raster[],
  animation: AnimationConfig,
): { main: Uint8Array; mainInfo: ImageInfo } {
  const framesMain = coverFrames.map((f) =>
    fitCanvas(f, { bounds: { width: MAIN.width, height: MAIN.height }, mode: 'exact', marginPx: 0 }),
  );
  const perLoopSec = animation.durationSec;
  const delayMs = (perLoopSec * 1000) / framesMain.length;
  const fit = encodeApngAutoFit(framesMain, {
    loops: animation.loops,
    delayMs,
    maxBytes: animation.maxBytes,
    minColors: animation.minColors,
    maxColors: animation.maxColors,
    minFrames: animation.minFrames,
    priority: animation.priority,
    ladder: animation.ladder,
  });
  const apngInfo = readApngInfo(fit.png);
  const mainInfo: ImageInfo = {
    width: apngInfo.width,
    height: apngInfo.height,
    bytes: fit.bytes,
    hasAlpha: true,
    channels: 4,
    isApng: apngInfo.isApng,
    frames: apngInfo.frames,
    loops: apngInfo.loops,
  };
  return { main: fit.png, mainInfo };
}
