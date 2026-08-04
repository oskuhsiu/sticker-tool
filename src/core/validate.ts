/**
 * 規格驗證：張數、偶數長寬、尺寸/檔案上限、透明、main/tab、動態影格/循環。
 * 純函式：輸入為平台無關的 ImageInfo（pipeline 用 sharp/upng 蒐集），輸出結構化問題清單。
 */

import {
  ANIMATED_SPEC,
  BIG_STICKER_SPEC,
  MAIN,
  STATIC_SPEC,
  TAB,
  ZIP_MAX_BYTES,
  allowedCounts,
  isAllowedCount,
  type StickerKind,
} from './spec.js';
import type { ValidationIssue, ValidationResult } from './types.js';

/** 平台無關的影像中繼資料（pipeline 蒐集後餵入驗證） */
export interface ImageInfo {
  width: number;
  height: number;
  /** 檔案位元組數 */
  bytes: number;
  hasAlpha: boolean;
  channels: number;
  /** 動態：是否為 APNG（含 acTL） */
  isApng?: boolean;
  /** 動態：影格數 */
  frames?: number;
  /** 動態：使用者要求的 hard target 格數。 */
  requestedFrames?: number;
  /** 動態：循環次數（acTL num_plays；0 = 無限） */
  loops?: number;
  /** 動態：解碼後單輪總長（ms）。提供時必須精確為 1/2/3/4 秒。 */
  durationMs?: number;
  /** 解碼後不同視覺畫格數；提供時至少為 2。 */
  distinctFrames?: number;
  /** 解碼後所有畫格的透明像素總數。 */
  transparentPixels?: number;
  /** 解碼後所有畫格的非透明前景像素總數。 */
  foregroundPixels?: number;
  /** 最終解碼 RGBA 序列中與前一格相同的格數。 */
  adjacentDuplicateFrames?: number;
}

function err(code: string, message: string, target?: string): ValidationIssue {
  return { level: 'error', code, message, target };
}
function warn(code: string, message: string, target?: string): ValidationIssue {
  return { level: 'warning', code, message, target };
}

function result(issues: ValidationIssue[]): ValidationResult {
  return { ok: !issues.some((i) => i.level === 'error'), issues };
}

/** 合併多個驗證結果 */
export function mergeResults(...results: ValidationResult[]): ValidationResult {
  const issues = results.flatMap((r) => r.issues);
  return result(issues);
}

const isEven = (n: number) => n % 2 === 0;

/** 驗張數是否符合該貼圖類型白名單 */
export function validateCount(kind: StickerKind, count: number): ValidationResult {
  if (!isAllowedCount(kind, count)) {
    const allowed = allowedCounts(kind).join('/');
    return result([
      err('count', `${kind} 貼圖張數須為 ${allowed}，收到 ${count}`),
    ]);
  }
  return result([]);
}

/** 驗單張靜態貼圖 */
export function validateStaticImage(info: ImageInfo, target?: string): ValidationResult {
  const issues: ValidationIssue[] = [];
  if (info.width > STATIC_SPEC.maxWidth || info.height > STATIC_SPEC.maxHeight) {
    issues.push(
      err(
        'static.size',
        `尺寸 ${info.width}×${info.height} 超過上限 ${STATIC_SPEC.maxWidth}×${STATIC_SPEC.maxHeight}`,
        target,
      ),
    );
  }
  if (!isEven(info.width) || !isEven(info.height)) {
    issues.push(err('static.even', `長寬須為偶數，收到 ${info.width}×${info.height}`, target));
  }
  if (!info.hasAlpha) {
    issues.push(err('static.alpha', '靜態貼圖須為透明 RGBA PNG（缺 alpha 通道）', target));
  }
  if (info.bytes > STATIC_SPEC.maxBytes) {
    issues.push(
      err(
        'static.bytes',
        `檔案 ${(info.bytes / 1024).toFixed(0)}KB 超過單張上限 ${STATIC_SPEC.maxBytes / 1024}KB`,
        target,
      ),
    );
  }
  return result(issues);
}

/** 驗單張 LINE Big Sticker 靜態貼圖 */
export function validateBigStickerImage(info: ImageInfo, target?: string): ValidationResult {
  const issues: ValidationIssue[] = [];
  if (
    info.width < BIG_STICKER_SPEC.minWidth ||
    info.height < BIG_STICKER_SPEC.minHeight ||
    info.width > BIG_STICKER_SPEC.maxWidth ||
    info.height > BIG_STICKER_SPEC.maxHeight
  ) {
    issues.push(
      err(
        'big.size',
        `尺寸 ${info.width}×${info.height} 須介於 ${BIG_STICKER_SPEC.minWidth}×${BIG_STICKER_SPEC.minHeight} 與 ${BIG_STICKER_SPEC.maxWidth}×${BIG_STICKER_SPEC.maxHeight} 之間`,
        target,
      ),
    );
  }
  if (!isEven(info.width) || !isEven(info.height)) {
    issues.push(err('big.even', `長寬須為偶數，收到 ${info.width}×${info.height}`, target));
  }
  if (!info.hasAlpha) {
    issues.push(err('big.alpha', '大貼圖須為透明 RGBA PNG（缺 alpha 通道）', target));
  }
  if (info.transparentPixels !== undefined && info.transparentPixels < 1) {
    issues.push(err('big.transparentPixels', '大貼圖沒有任何透明像素，背景可能尚未去除', target));
  }
  if (info.foregroundPixels !== undefined && info.foregroundPixels < 1) {
    issues.push(err('big.empty', '大貼圖沒有可見前景', target));
  }
  if (info.bytes > BIG_STICKER_SPEC.maxBytes) {
    issues.push(
      err(
        'big.bytes',
        `檔案 ${(info.bytes / 1024).toFixed(0)}KB 超過單張上限 ${BIG_STICKER_SPEC.maxBytes / 1024}KB`,
        target,
      ),
    );
  }
  return result(issues);
}

/** 驗單張動態貼圖（APNG） */
export function validateAnimatedImage(info: ImageInfo, target?: string): ValidationResult {
  const issues: ValidationIssue[] = [];
  if (info.isApng === false) {
    issues.push(err('anim.apng', '動態貼圖須為 APNG（缺 acTL 動畫區塊）', target));
  }
  if (info.width > ANIMATED_SPEC.maxWidth || info.height > ANIMATED_SPEC.maxHeight) {
    issues.push(
      err(
        'anim.size',
        `尺寸 ${info.width}×${info.height} 超過上限 ${ANIMATED_SPEC.maxWidth}×${ANIMATED_SPEC.maxHeight}`,
        target,
      ),
    );
  }
  // 寬或高至少一邊須 ≥ 270
  if (info.width < ANIMATED_SPEC.minLongSide && info.height < ANIMATED_SPEC.minLongSide) {
    issues.push(
      err(
        'anim.minSide',
        `寬或高至少一邊須 ≥${ANIMATED_SPEC.minLongSide}，收到 ${info.width}×${info.height}`,
        target,
      ),
    );
  }
  if (!isEven(info.width) || !isEven(info.height)) {
    issues.push(err('anim.even', `長寬須為偶數，收到 ${info.width}×${info.height}`, target));
  }
  if (!info.hasAlpha) {
    issues.push(err('anim.alpha', '動態貼圖須有透明 alpha 通道', target));
  }
  if (info.transparentPixels !== undefined && info.transparentPixels < 1) {
    issues.push(err('anim.transparentPixels', '動態貼圖沒有任何透明像素，背景可能尚未去除', target));
  }
  if (info.foregroundPixels !== undefined && info.foregroundPixels < 1) {
    issues.push(err('anim.empty', '動態貼圖所有畫格皆為空白', target));
  }
  if (info.distinctFrames !== undefined && info.distinctFrames < 2) {
    issues.push(err('anim.identical', '動態貼圖至少需要兩個不同的視覺畫格', target));
  }
  if (info.frames !== undefined) {
    if (info.frames < ANIMATED_SPEC.minFrames || info.frames > ANIMATED_SPEC.maxFrames) {
      issues.push(
        err(
          'anim.frames',
          `影格數須為 ${ANIMATED_SPEC.minFrames}–${ANIMATED_SPEC.maxFrames}，收到 ${info.frames}`,
          target,
        ),
      );
    }
  }
  if (
    info.requestedFrames !== undefined &&
    info.frames !== undefined &&
    info.frames !== info.requestedFrames
  ) {
    issues.push(
      err(
        'anim.targetFrames',
        `最終影格數 ${info.frames} 與設定目標 ${info.requestedFrames} 不一致`,
        target,
      ),
    );
  }
  if (info.adjacentDuplicateFrames !== undefined && info.adjacentDuplicateFrames > 0) {
    issues.push(
      err(
        'anim.adjacentDuplicate',
        `最終序列仍有 ${info.adjacentDuplicateFrames} 個相鄰重複畫格`,
        target,
      ),
    );
  }
  if (info.loops !== undefined) {
    if (info.loops < ANIMATED_SPEC.minLoops || info.loops > ANIMATED_SPEC.maxLoops) {
      issues.push(
        err(
          'anim.loops',
          `循環次數須為 ${ANIMATED_SPEC.minLoops}–${ANIMATED_SPEC.maxLoops}（不可無限循環），收到 ${info.loops}`,
          target,
        ),
      );
    }
  }
  if (info.durationMs !== undefined) {
    const allowedMs = ANIMATED_SPEC.playbackDurationsSec.map((seconds) => seconds * 1000);
    if (!allowedMs.includes(info.durationMs)) {
      issues.push(err('anim.duration', `單輪播放時間須為 1000/2000/3000/4000ms，收到 ${info.durationMs}ms`, target));
    } else if (info.loops !== undefined && info.durationMs * info.loops > ANIMATED_SPEC.maxDurationSec * 1000) {
      issues.push(
        err(
          'anim.totalDuration',
          `單輪 ${info.durationMs}ms × ${info.loops} loops 超過總播放 ${ANIMATED_SPEC.maxDurationSec} 秒`,
          target,
        ),
      );
    }
  }
  if (info.bytes > ANIMATED_SPEC.maxBytes) {
    issues.push(
      err(
        'anim.bytes',
        `檔案 ${(info.bytes / 1024).toFixed(0)}KB 超過單檔上限 ${ANIMATED_SPEC.maxBytes / 1024}KB`,
        target,
      ),
    );
  }
  return result(issues);
}

/** 驗 main.png（封面）。動態包的 main 必須是 APNG。 */
export function validateMain(info: ImageInfo, kind: StickerKind): ValidationResult {
  const issues: ValidationIssue[] = [];
  if (info.width !== MAIN.width || info.height !== MAIN.height) {
    issues.push(
      err('main.size', `main.png 須為 ${MAIN.width}×${MAIN.height}，收到 ${info.width}×${info.height}`),
    );
  }
  if (kind === 'animated' && info.isApng === false) {
    issues.push(err('main.apng', '動態包的 main.png 必須是 APNG（首格當靜態縮圖）'));
  }
  if (!info.hasAlpha) issues.push(err('main.alpha', 'main.png 必須含透明 alpha'));
  if (info.transparentPixels !== undefined && info.transparentPixels < 1) {
    issues.push(err('main.transparentPixels', 'main.png 沒有任何透明像素'));
  }
  if (info.foregroundPixels !== undefined && info.foregroundPixels < 1) {
    issues.push(err('main.empty', 'main.png 沒有可見前景'));
  }
  if (info.bytes > ANIMATED_SPEC.maxBytes) {
    issues.push(err('main.bytes', `main.png ${(info.bytes / 1024).toFixed(0)}KB 超過 1MB`));
  }
  if (kind === 'animated') {
    if (info.frames !== undefined && (info.frames < ANIMATED_SPEC.minFrames || info.frames > ANIMATED_SPEC.maxFrames)) {
      issues.push(err('main.frames', `main.png 影格數須為 5–20，收到 ${info.frames}`));
    }
    if (info.requestedFrames !== undefined && info.frames !== info.requestedFrames) {
      issues.push(err('main.targetFrames', `main.png 影格數 ${info.frames} 與封面 ${info.requestedFrames} 不一致`));
    }
    if (info.loops !== undefined && (info.loops < 1 || info.loops > 4)) {
      issues.push(err('main.loops', `main.png loops 須為 1–4，收到 ${info.loops}`));
    }
    if (info.durationMs !== undefined && ![1000, 2000, 3000, 4000].includes(info.durationMs)) {
      issues.push(err('main.duration', `main.png 單輪時間不合法：${info.durationMs}ms`));
    }
    if (info.adjacentDuplicateFrames !== undefined && info.adjacentDuplicateFrames > 0) {
      issues.push(err('main.adjacentDuplicate', `main.png 仍有 ${info.adjacentDuplicateFrames} 個相鄰重複格`));
    }
  }
  return result(issues);
}

/** 驗 tab.png */
export function validateTab(info: ImageInfo): ValidationResult {
  const issues: ValidationIssue[] = [];
  if (info.width !== TAB.width || info.height !== TAB.height) {
    issues.push(
      err('tab.size', `tab.png 須為 ${TAB.width}×${TAB.height}，收到 ${info.width}×${info.height}`),
    );
  }
  if (!info.hasAlpha) issues.push(err('tab.alpha', 'tab.png 必須含透明 alpha'));
  if (info.transparentPixels !== undefined && info.transparentPixels < 1) {
    issues.push(err('tab.transparentPixels', 'tab.png 沒有任何透明像素'));
  }
  if (info.foregroundPixels !== undefined && info.foregroundPixels < 1) {
    issues.push(err('tab.empty', 'tab.png 沒有可見前景'));
  }
  if (info.bytes > STATIC_SPEC.maxBytes) {
    issues.push(err('tab.bytes', `tab.png ${(info.bytes / 1024).toFixed(0)}KB 超過 1MB`));
  }
  return result(issues);
}

/** 驗整包：張數 + 每張 + main/tab + 不可混包 + zip 大小 */
export function validatePack(args: {
  kind: StickerKind;
  count: number;
  stickers: ImageInfo[];
  main: ImageInfo;
  tab: ImageInfo;
  zipBytes?: number;
}): ValidationResult {
  const { kind, count, stickers, main, tab, zipBytes } = args;
  const results: ValidationResult[] = [validateCount(kind, count)];

  if (stickers.length !== count) {
    results.push(result([err('pack.count', `實際貼圖張數 ${stickers.length} 與宣告 ${count} 不符`)]));
  }

  const validateOne =
    kind === 'animated'
      ? validateAnimatedImage
      : kind === 'big'
        ? validateBigStickerImage
        : validateStaticImage;
  stickers.forEach((s, i) => {
    results.push(validateOne(s, `${String(i + 1).padStart(2, '0')}.png`));
  });

  results.push(validateMain(main, kind));
  results.push(validateTab(tab));

  if (zipBytes !== undefined && zipBytes > ZIP_MAX_BYTES) {
    results.push(
      result([
        err(
          'zip.bytes',
          `整包 ${(zipBytes / 1_000_000).toFixed(1)}MB 超過上限 ${ZIP_MAX_BYTES / 1_000_000}MB`,
        ),
      ]),
    );
  }

  return mergeResults(...results);
}

/** 把驗證結果格式化成人類可讀字串（CLI 用） */
export function formatValidation(r: ValidationResult): string {
  if (r.issues.length === 0) return '✓ 全部符合 LINE 規格';
  return r.issues
    .map((i) => {
      const icon = i.level === 'error' ? '✗' : '⚠';
      const tgt = i.target ? `[${i.target}] ` : '';
      return `${icon} ${tgt}${i.message}`;
    })
    .join('\n');
}

export { warn, err };
