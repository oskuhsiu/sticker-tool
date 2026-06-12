/**
 * 產 main.png（240×240）與 tab.png（96×74）（瀏覽器版）。
 * 靜態包：兩者皆靜態 PNG。動態包：main 須為 APNG、tab 仍為靜態。
 */

import { MAIN, TAB } from '@core/spec.js';
import type { AnimationConfig } from '@core/types.js';
import type { ImageInfo } from '@core/validate.js';
import { fitCanvas } from './fitCanvas.js';
import { encodeApngAutoFit, readApngInfo } from './apng.js';
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
  const main = encodePng(mainFit);
  const tab = encodePng(tabFit);
  return { main, tab, mainInfo: pngImageInfo(main), tabInfo: pngImageInfo(tab) };
}

/** tab.png 單獨產（動態包用：tab 仍是靜態，取封面首格） */
export function buildTab(coverFrame: Raster): { tab: Uint8Array; tabInfo: ImageInfo } {
  const tabFit = fitCanvas(coverFrame, {
    bounds: { width: TAB.width, height: TAB.height },
    mode: 'exact',
    marginPx: 4,
  });
  const tab = encodePng(tabFit);
  return { tab, tabInfo: pngImageInfo(tab) };
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
