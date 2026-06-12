/**
 * 產 main.png（240×240）與 tab.png（96×74）。
 * 靜態包：兩者皆靜態 PNG，由封面貼圖 fit 到固定畫布。
 * 動態包：main 須為 APNG（見 M5，buildAnimatedMain），tab 仍為靜態。
 */

import sharp from 'sharp';
import { MAIN, TAB } from '../core/spec.js';
import type { AnimationConfig } from '../core/types.js';
import type { ImageInfo } from '../core/validate.js';
import { fitCanvas } from '../pipeline/fitCanvas.js';
import { encodeApngAutoFit, readApngInfo } from '../pipeline/apng.js';

export interface MainTabResult {
  main: Buffer;
  tab: Buffer;
  mainInfo: ImageInfo;
  tabInfo: ImageInfo;
}

async function infoOf(buffer: Buffer, isApng = false): Promise<ImageInfo> {
  const meta = await sharp(buffer).metadata();
  return {
    width: meta.width ?? 0,
    height: meta.height ?? 0,
    bytes: buffer.length,
    hasAlpha: meta.hasAlpha ?? false,
    channels: meta.channels ?? 0,
    isApng,
  };
}

/** 靜態 main/tab */
export async function buildMainTab(coverStatic: Buffer): Promise<MainTabResult> {
  const mainFit = await fitCanvas(coverStatic, {
    bounds: { width: MAIN.width, height: MAIN.height },
    mode: 'exact',
    marginPx: 10,
  });
  const tabFit = await fitCanvas(coverStatic, {
    bounds: { width: TAB.width, height: TAB.height },
    mode: 'exact',
    marginPx: 4,
  });
  return {
    main: mainFit.buffer,
    tab: tabFit.buffer,
    mainInfo: await infoOf(mainFit.buffer),
    tabInfo: await infoOf(tabFit.buffer),
  };
}

/** tab.png 單獨產（動態包用：tab 仍是靜態，取封面首格） */
export async function buildTab(coverFrame: Buffer): Promise<{ tab: Buffer; tabInfo: ImageInfo }> {
  const tabFit = await fitCanvas(coverFrame, {
    bounds: { width: TAB.width, height: TAB.height },
    mode: 'exact',
    marginPx: 4,
  });
  return { tab: tabFit.buffer, tabInfo: await infoOf(tabFit.buffer) };
}

/**
 * 動態包的 main.png：必須是 APNG（首格當靜態縮圖）。
 * 取封面動態貼圖的對齊影格，縮到 240×240（exact，維持對齊）再編 APNG。
 */
export async function buildAnimatedMain(
  coverFrames: Buffer[],
  animation: AnimationConfig,
): Promise<{ main: Buffer; mainInfo: ImageInfo }> {
  const framesMain: Buffer[] = [];
  for (const f of coverFrames) {
    framesMain.push(
      (await fitCanvas(f, { bounds: { width: MAIN.width, height: MAIN.height }, mode: 'exact', marginPx: 0 })).buffer,
    );
  }
  // main 縮圖較小，沿用同樣的 loops/時長與 auto-fit（240² 幾乎不會超標）
  const perLoopSec = animation.durationSec;
  const delayMs = (perLoopSec * 1000) / framesMain.length;
  const fit = await encodeApngAutoFit(framesMain, {
    loops: animation.loops,
    delayMs,
    maxBytes: animation.maxBytes,
    minColors: animation.minColors,
    minFrames: animation.minFrames,
    priority: animation.priority,
    ladder: animation.ladder,
  });
  const apngInfo = readApngInfo(fit.buffer);
  const meta = await sharp(fit.buffer).metadata();
  const mainInfo: ImageInfo = {
    width: apngInfo.width,
    height: apngInfo.height,
    bytes: fit.bytes,
    hasAlpha: meta.hasAlpha ?? true,
    channels: meta.channels ?? 4,
    isApng: apngInfo.isApng,
    frames: apngInfo.frames,
    loops: apngInfo.loops,
  };
  return { main: fit.buffer, mainInfo };
}
