/**
 * 規格驗證：張數、偶數長寬、尺寸/檔案上限、透明、main/tab、動態影格/循環。
 * 純函式：輸入為平台無關的 ImageInfo（pipeline 用 sharp/upng 蒐集），輸出結構化問題清單。
 */

import {
  ANIMATED_EMOJI_SPEC,
  ANIMATED_SPEC,
  BIG_STICKER_SPEC,
  EMOJI_SPEC,
  MAIN,
  POPUP_MAIN,
  POPUP_STICKER_SPEC,
  STATIC_SPEC,
  TAB,
  ZIP_MAX_BYTES,
  allowedCounts,
  isEmojiKind,
  isEmojiZipBytesAllowed,
  isAllowedCount,
  type EmojiKind,
  type LinePackKind,
  type StickerKind,
} from './spec.js';
import {
  POPUP_ANIMATION_MAIN_PATH,
  POPUP_STATIC_MAIN_PATH,
  POPUP_STATIC_TAB_PATH,
  TAB_FILE,
  emojiFileName,
  emojiPackManifest,
  popupAnimationFilePath,
  popupStaticFilePath,
} from './naming.js';
import type { ValidationIssue, ValidationResult } from './types.js';
import type { ColorKeyOptions } from './colorKey.js';

export function isColorKeyOptions(value: unknown): value is ColorKeyOptions {
  if (!value || typeof value !== 'object') return false;
  const options = value as Partial<ColorKeyOptions> & { scope?: unknown };
  return (
    options.scope === undefined &&
    (options.edge === 'soft' || options.edge === 'decontaminate' || options.edge === 'hard')
  );
}

export function assertSupportedColorKeyOptions(value: unknown): asserts value is ColorKeyOptions {
  if (!isColorKeyOptions(value)) {
    throw new Error('單色色鍵不支援全圖相近色去背；請使用外框連通去背');
  }
}

/** 平台無關的影像中繼資料（pipeline 蒐集後餵入驗證） */
export interface ImageInfo {
  width: number;
  height: number;
  /** 檔案位元組數 */
  bytes: number;
  hasAlpha: boolean;
  channels: number;
  /** Final decoded file format, such as `png`. */
  format?: string;
  /** Archive filename/path evidence when available. */
  filename?: string;
  /** Final PNG density metadata in dots per inch, when present. */
  densityDpi?: number;
  /** PNG color type from final bytes (6 = RGBA; optional for legacy validators). */
  colorType?: number;
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

/** 驗張數是否符合該貼圖／Emoji 類型規則 */
export function validateCount(kind: LinePackKind, count: number): ValidationResult {
  if (!isAllowedCount(kind, count)) {
    if (isEmojiKind(kind)) {
      return result([
        err(
          'count',
          `${kind} 張數須為 ${EMOJI_SPEC.minCount}–${EMOJI_SPEC.maxCount}，收到 ${count}`,
        ),
      ]);
    }
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
  if (info.format !== undefined && info.format.toLowerCase() !== 'png') {
    issues.push(err('static.format', `靜態貼圖必須是 PNG，收到 ${info.format}`, target));
  }
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
  if (info.colorType !== undefined && info.colorType !== 6) {
    issues.push(
      err(
        'static.rgb',
        `靜態貼圖必須是 RGBA PNG（PNG color type 6），收到 ${info.colorType}`,
        target,
      ),
    );
  }
  if (info.transparentPixels !== undefined && info.transparentPixels < 1) {
    issues.push(err('static.transparentPixels', '靜態貼圖沒有任何透明像素，背景可能尚未去除', target));
  }
  if (info.foregroundPixels !== undefined && info.foregroundPixels < 1) {
    issues.push(err('static.empty', '靜態貼圖沒有可見前景', target));
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
  if (info.colorType !== 6) {
    issues.push(
      err(
        'big.rgb',
        `大貼圖必須是 RGBA PNG（PNG color type 6），收到 ${info.colorType ?? '缺少證據'}`,
        target,
      ),
    );
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

/**
 * 驗 Popup Sticker 的靜態 png/ 貼圖。
 * 這條軌道仍使用一般靜態尺寸上限，但最終 PNG 必須提供 RGBA 與內容證據。
 */
export function validatePopupStaticImage(info: ImageInfo, target?: string): ValidationResult {
  const issues = validateStaticImage(info, target).issues;
  if (info.colorType !== 6) {
    issues.push(
      err(
        'popupStatic.rgb',
        `Popup 靜態貼圖必須是 RGBA PNG（PNG color type 6），收到 ${info.colorType ?? '缺少證據'}`,
        target,
      ),
    );
  }
  if (info.transparentPixels === undefined) {
    issues.push(err('popupStatic.transparentEvidence', 'Popup 靜態貼圖缺少透明像素證據', target));
  } else if (info.transparentPixels < 1) {
    issues.push(err('popupStatic.transparentPixels', 'Popup 靜態貼圖沒有任何透明像素', target));
  }
  if (info.foregroundPixels === undefined) {
    issues.push(err('popupStatic.foregroundEvidence', 'Popup 靜態貼圖缺少前景像素證據', target));
  } else if (info.foregroundPixels < 1) {
    issues.push(err('popupStatic.empty', 'Popup 靜態貼圖沒有可見前景', target));
  }
  return result(issues);
}

/**
 * 驗單張 LINE Popup Sticker APNG。
 * Popup 的最終 APNG metadata 必須完整提供，不能把缺失證據當作通過。
 */
export function validatePopupImage(info: ImageInfo, target?: string): ValidationResult {
  const issues: ValidationIssue[] = [];
  const popup = POPUP_STICKER_SPEC;

  if (info.isApng !== true) {
    issues.push(err('popup.apng', 'Popup Sticker 必須是 APNG（缺少有效 APNG 證據）', target));
  }

  const withinMax = info.width <= popup.maxWidth && info.height <= popup.maxHeight;
  const hasLegalSide = info.width === popup.maxWidth || info.height === popup.maxHeight;
  const legalWidthSide = info.width !== popup.maxWidth || info.height >= popup.minHeightAtMaxWidth;
  const legalHeightSide = info.height !== popup.maxHeight || info.width >= popup.minWidthAtMaxHeight;
  if (!withinMax || !hasLegalSide || !legalWidthSide || !legalHeightSide) {
    issues.push(
      err(
        'popup.size',
        `Popup 尺寸須不超過 ${popup.maxWidth}×${popup.maxHeight}，且寬 480 時高至少 ${popup.minHeightAtMaxWidth}px、或高 480 時寬至少 ${popup.minWidthAtMaxHeight}px；收到 ${info.width}×${info.height}`,
        target,
      ),
    );
  }
  if (!isEven(info.width) || !isEven(info.height)) {
    issues.push(err('popup.even', `Popup 長寬須為偶數，收到 ${info.width}×${info.height}`, target));
  }
  if (!info.hasAlpha) {
    issues.push(err('popup.alpha', 'Popup Sticker 必須含透明 alpha 通道', target));
  }
  if (info.colorType !== 6) {
    issues.push(
      err(
        'popup.rgb',
        `Popup Sticker 必須是 RGBA PNG/APNG（PNG color type 6），收到 ${info.colorType ?? '缺少證據'}`,
        target,
      ),
    );
  }
  if (info.transparentPixels === undefined) {
    issues.push(err('popup.transparentEvidence', 'Popup Sticker 缺少透明像素證據', target));
  } else if (info.transparentPixels < 1) {
    issues.push(err('popup.transparentPixels', 'Popup Sticker 沒有任何透明像素', target));
  }
  if (info.foregroundPixels === undefined) {
    issues.push(err('popup.foregroundEvidence', 'Popup Sticker 缺少前景像素證據', target));
  } else if (info.foregroundPixels < 1) {
    issues.push(err('popup.empty', 'Popup Sticker 沒有可見前景', target));
  }

  if (info.frames === undefined) {
    issues.push(err('popup.framesEvidence', 'Popup Sticker 缺少最終影格數證據', target));
  } else if (
    !Number.isInteger(info.frames) ||
    info.frames < popup.minFrames ||
    info.frames > popup.maxFrames
  ) {
    issues.push(
      err(
        'popup.frames',
        `Popup 影格數須為 ${popup.minFrames}–${popup.maxFrames}，收到 ${info.frames}`,
        target,
      ),
    );
  }

  if (info.loops === undefined) {
    issues.push(err('popup.loopsEvidence', 'Popup Sticker 缺少循環次數證據', target));
  } else if (
    !Number.isInteger(info.loops) ||
    info.loops < popup.minLoops ||
    info.loops > popup.maxLoops
  ) {
    issues.push(
      err(
        'popup.loops',
        `Popup 循環次數須為 ${popup.minLoops}–${popup.maxLoops}，收到 ${info.loops}`,
        target,
      ),
    );
  }

  if (info.durationMs === undefined) {
    issues.push(err('popup.durationEvidence', 'Popup Sticker 缺少單輪播放時間證據', target));
  } else {
    const allowedMs = popup.playbackDurationsSec.map((seconds) => seconds * 1000);
    if (!allowedMs.includes(info.durationMs)) {
      issues.push(
        err(
          'popup.duration',
          `Popup 單輪播放時間須為 1000/2000/3000ms，收到 ${info.durationMs}ms`,
          target,
        ),
      );
    } else if (info.loops !== undefined && Number.isInteger(info.loops)) {
      if (info.durationMs * info.loops > popup.maxDurationSec * 1000) {
        issues.push(
          err(
            'popup.totalDuration',
            `Popup 單輪 ${info.durationMs}ms × ${info.loops} loops 超過總播放 ${popup.maxDurationSec} 秒`,
            target,
          ),
        );
      }
    }
  }

  if (info.distinctFrames === undefined) {
    issues.push(err('popup.distinctEvidence', 'Popup Sticker 缺少不同畫格證據', target));
  } else if (!Number.isInteger(info.distinctFrames) || info.distinctFrames < 2) {
    issues.push(err('popup.identical', 'Popup Sticker 至少需要兩個不同的視覺畫格', target));
  }
  if (info.bytes > popup.maxBytes) {
    issues.push(
      err(
        'popup.bytes',
        `檔案 ${(info.bytes / 1024).toFixed(0)}KB 超過單張上限 ${popup.maxBytes / 1024}KB`,
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

function validateEmojiRaster(
  info: ImageInfo,
  options: {
    prefix: 'emoji' | 'animatedEmoji';
    label: string;
    maxBytes: number;
    target?: string;
  },
): ValidationIssue[] {
  const { prefix, label, maxBytes, target } = options;
  const issues: ValidationIssue[] = [];

  if (info.format !== 'png') {
    issues.push(
      err(
        `${prefix}.format`,
        `${label} 必須提供最終 PNG 格式證據，收到 ${info.format ?? '缺少證據'}`,
        target,
      ),
    );
  }
  if (info.width !== EMOJI_SPEC.width || info.height !== EMOJI_SPEC.height) {
    issues.push(
      err(
        `${prefix}.size`,
        `${label} 尺寸須為 ${EMOJI_SPEC.width}×${EMOJI_SPEC.height}，收到 ${info.width}×${info.height}`,
        target,
      ),
    );
  }
  if (!info.hasAlpha) {
    issues.push(err(`${prefix}.alpha`, `${label} 必須含透明 alpha 通道`, target));
  }
  if (info.channels !== EMOJI_SPEC.channels || info.colorType !== 6) {
    issues.push(
      err(
        `${prefix}.rgb`,
        `${label} 必須是 RGBA PNG（4 channels、PNG color type 6），收到 ${info.channels} channels、color type ${info.colorType ?? '缺少證據'}`,
        target,
      ),
    );
  }
  if (info.transparentPixels === undefined) {
    issues.push(err(`${prefix}.transparentEvidence`, `${label} 缺少透明像素證據`, target));
  } else if (info.transparentPixels < 1) {
    issues.push(err(`${prefix}.transparentPixels`, `${label} 沒有任何透明像素`, target));
  }
  if (info.foregroundPixels === undefined) {
    issues.push(err(`${prefix}.foregroundEvidence`, `${label} 缺少前景像素證據`, target));
  } else if (info.foregroundPixels < 1) {
    issues.push(err(`${prefix}.empty`, `${label} 沒有可見前景`, target));
  }
  if (info.bytes > maxBytes) {
    issues.push(
      err(
        `${prefix}.bytes`,
        `${label} ${info.bytes} bytes 超過單張上限 ${maxBytes} bytes`,
        target,
      ),
    );
  }
  if (info.densityDpi === undefined) {
    issues.push(
      warn(
        `${prefix}.densityEvidence`,
        `${label} 缺少 PNG density 證據；本機驗證未宣稱已證明 ${EMOJI_SPEC.minDpi} dpi`,
        target,
      ),
    );
  } else if (!Number.isFinite(info.densityDpi) || info.densityDpi < EMOJI_SPEC.minDpi) {
    issues.push(
      err(
        `${prefix}.density`,
        `${label} density 須至少 ${EMOJI_SPEC.minDpi} dpi，收到 ${info.densityDpi}`,
        target,
      ),
    );
  }
  if (info.filename !== undefined && target !== undefined && info.filename !== target) {
    issues.push(
      err(
        `${prefix}.filename`,
        `${label} 檔名須為 ${target}，收到 ${info.filename}`,
        target,
      ),
    );
  }

  return issues;
}

/** 驗單張 LINE Regular Emoji 靜態 PNG。 */
export function validateEmojiImage(info: ImageInfo, target?: string): ValidationResult {
  const issues = validateEmojiRaster(info, {
    prefix: 'emoji',
    label: 'Emoji',
    maxBytes: EMOJI_SPEC.maxBytes,
    target,
  });
  if (info.isApng === undefined) {
    issues.push(err('emoji.apngEvidence', '靜態 Emoji 缺少 APNG 排除證據', target));
  } else if (info.isApng) {
    issues.push(err('emoji.apng', '靜態 Emoji 不可包含 APNG 動畫區塊', target));
  }
  return result(issues);
}

/** 驗單張 LINE Animated Regular Emoji APNG。 */
export function validateAnimatedEmojiImage(
  info: ImageInfo,
  target?: string,
): ValidationResult {
  const issues = validateEmojiRaster(info, {
    prefix: 'animatedEmoji',
    label: 'Animated Emoji',
    maxBytes: ANIMATED_EMOJI_SPEC.maxBytes,
    target,
  });
  const spec = ANIMATED_EMOJI_SPEC;

  if (info.isApng !== true) {
    issues.push(err('animatedEmoji.apng', 'Animated Emoji 必須提供有效 APNG 證據', target));
  }

  if (info.frames === undefined) {
    issues.push(err('animatedEmoji.framesEvidence', 'Animated Emoji 缺少最終影格數證據', target));
  } else if (
    !Number.isInteger(info.frames) ||
    info.frames < spec.minFrames ||
    info.frames > spec.maxFrames
  ) {
    issues.push(
      err(
        'animatedEmoji.frames',
        `Animated Emoji 影格數須為 ${spec.minFrames}–${spec.maxFrames}，收到 ${info.frames}`,
        target,
      ),
    );
  }
  if (
    info.requestedFrames !== undefined &&
    info.frames !== undefined &&
    info.frames !== info.requestedFrames
  ) {
    issues.push(
      err(
        'animatedEmoji.targetFrames',
        `Animated Emoji 最終影格數 ${info.frames} 與設定目標 ${info.requestedFrames} 不一致`,
        target,
      ),
    );
  }

  if (info.loops === undefined) {
    issues.push(err('animatedEmoji.loopsEvidence', 'Animated Emoji 缺少循環次數證據', target));
  } else if (
    !Number.isInteger(info.loops) ||
    info.loops < spec.minLoops ||
    info.loops > spec.maxLoops
  ) {
    issues.push(
      err(
        'animatedEmoji.loops',
        `Animated Emoji 循環次數須為 ${spec.minLoops}–${spec.maxLoops}，收到 ${info.loops}`,
        target,
      ),
    );
  }

  if (info.durationMs === undefined) {
    issues.push(
      err('animatedEmoji.durationEvidence', 'Animated Emoji 缺少解碼後單輪播放時間證據', target),
    );
  } else {
    const durationAllowed =
      Number.isInteger(info.durationMs) &&
      spec.playbackDurationsSec.some(
        (seconds) =>
          Math.abs(info.durationMs! - seconds * 1_000) <= spec.durationToleranceMs,
      );
    if (!durationAllowed) {
      issues.push(
        err(
          'animatedEmoji.duration',
          `Animated Emoji 單輪播放時間須為 1000/2000/3000/4000ms（容許 ±${spec.durationToleranceMs}ms），收到 ${info.durationMs}ms`,
          target,
        ),
      );
    }
    if (
      info.loops !== undefined &&
      Number.isInteger(info.loops) &&
      info.durationMs * info.loops > spec.maxDurationSec * 1_000
    ) {
      issues.push(
        err(
          'animatedEmoji.totalDuration',
          `Animated Emoji 單輪 ${info.durationMs}ms × ${info.loops} loops 超過總播放 ${spec.maxDurationSec} 秒`,
          target,
        ),
      );
    }
  }

  if (info.distinctFrames === undefined) {
    issues.push(
      err('animatedEmoji.distinctEvidence', 'Animated Emoji 缺少不同畫格證據', target),
    );
  } else if (!Number.isInteger(info.distinctFrames)) {
    issues.push(
      err('animatedEmoji.distinctFrames', 'Animated Emoji 不同畫格數必須是整數', target),
    );
  } else if (info.distinctFrames < 2) {
    issues.push(
      err('animatedEmoji.identical', 'Animated Emoji 至少需要兩個不同的視覺畫格', target),
    );
  } else if (info.frames !== undefined && info.distinctFrames > info.frames) {
    issues.push(
      err(
        'animatedEmoji.distinctFrames',
        `Animated Emoji 不同畫格數 ${info.distinctFrames} 不可超過總影格數 ${info.frames}`,
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

/** 驗 Popup Sticker 的 main_popup.png（必須是完整 480×480 APNG）。 */
export function validatePopupMain(info: ImageInfo, target?: string): ValidationResult {
  const issues = validatePopupImage(info, target).issues;
  if (info.width !== POPUP_MAIN.width || info.height !== POPUP_MAIN.height) {
    issues.push(
      err(
        'popupMain.size',
        `main_popup.png 須為 ${POPUP_MAIN.width}×${POPUP_MAIN.height}，收到 ${info.width}×${info.height}`,
        target,
      ),
    );
  }
  return result(issues);
}

/** Require final-byte RGB/alpha/content evidence for Popup pack static support assets. */
function validatePopupStaticSupportImage(info: ImageInfo, target: string): ValidationResult {
  const issues: ValidationIssue[] = [];
  if (info.colorType !== 6) {
    issues.push(
      err(
        'popupSupport.rgb',
        `Popup 封面／縮圖必須是 RGBA PNG（PNG color type 6），收到 ${info.colorType ?? '缺少證據'}`,
        target,
      ),
    );
  }
  if (info.transparentPixels === undefined) {
    issues.push(err('popupSupport.transparentEvidence', 'Popup 封面／縮圖缺少透明像素證據', target));
  } else if (info.transparentPixels < 1) {
    issues.push(err('popupSupport.transparentPixels', 'Popup 封面／縮圖沒有任何透明像素', target));
  }
  if (info.foregroundPixels === undefined) {
    issues.push(err('popupSupport.foregroundEvidence', 'Popup 封面／縮圖缺少前景像素證據', target));
  } else if (info.foregroundPixels < 1) {
    issues.push(err('popupSupport.empty', 'Popup 封面／縮圖沒有可見前景', target));
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

function validateEmojiTab(info: ImageInfo): ValidationResult {
  const issues = validateTab(info).issues;
  if (info.format !== 'png') {
    issues.push(
      err(
        'emojiTab.format',
        `Emoji tab.png 必須提供最終 PNG 格式證據，收到 ${info.format ?? '缺少證據'}`,
        TAB_FILE,
      ),
    );
  }
  if (info.isApng !== false) {
    issues.push(err('emojiTab.apng', 'Emoji tab.png 必須是靜態 PNG', TAB_FILE));
  }
  if (info.channels !== 4 || info.colorType !== 6) {
    issues.push(
      err(
        'emojiTab.rgb',
        `Emoji tab.png 必須是 RGBA PNG（4 channels、PNG color type 6），收到 ${info.channels} channels、color type ${info.colorType ?? '缺少證據'}`,
        TAB_FILE,
      ),
    );
  }
  if (info.transparentPixels === undefined) {
    issues.push(err('emojiTab.transparentEvidence', 'Emoji tab.png 缺少透明像素證據', TAB_FILE));
  } else if (info.transparentPixels < 1) {
    issues.push(err('emojiTab.transparentPixels', 'Emoji tab.png 沒有任何透明像素', TAB_FILE));
  }
  if (info.foregroundPixels === undefined) {
    issues.push(err('emojiTab.foregroundEvidence', 'Emoji tab.png 缺少前景像素證據', TAB_FILE));
  } else if (info.foregroundPixels < 1) {
    issues.push(err('emojiTab.empty', 'Emoji tab.png 沒有可見前景', TAB_FILE));
  }
  if (info.densityDpi === undefined) {
    issues.push(
      warn(
        'emojiTab.densityEvidence',
        `Emoji tab.png 缺少 PNG density 證據；本機驗證未宣稱已證明 ${EMOJI_SPEC.minDpi} dpi`,
        TAB_FILE,
      ),
    );
  } else if (!Number.isFinite(info.densityDpi) || info.densityDpi < EMOJI_SPEC.minDpi) {
    issues.push(
      err(
        'emojiTab.density',
        `Emoji tab.png density 須至少 ${EMOJI_SPEC.minDpi} dpi，收到 ${info.densityDpi}`,
        TAB_FILE,
      ),
    );
  }
  if (info.filename !== undefined && info.filename !== TAB_FILE) {
    issues.push(
      err('emojiTab.filename', `Emoji 聊天縮圖檔名須為 ${TAB_FILE}，收到 ${info.filename}`, TAB_FILE),
    );
  }
  return result(issues);
}

function validateEmojiManifest(
  archivePaths: readonly string[],
  count: number,
): ValidationResult {
  if (!Number.isInteger(count) || count < 0 || count > 999) {
    return result([
      err('emoji.manifest.count', `無法為不合法張數 ${count} 建立 Emoji manifest`),
    ]);
  }

  const issues: ValidationIssue[] = [];
  const expected = emojiPackManifest(count);
  const expectedSet = new Set(expected);
  const actualSet = new Set<string>();

  for (const path of archivePaths) {
    if (actualSet.has(path)) {
      issues.push(err('emoji.manifest.duplicate', `Emoji ZIP 含重複路徑 ${path}`, path));
    }
    actualSet.add(path);
  }
  for (const path of expected) {
    if (!actualSet.has(path)) {
      issues.push(err('emoji.manifest.missing', `Emoji ZIP 缺少必要路徑 ${path}`, path));
    }
  }
  for (const path of actualSet) {
    if (!expectedSet.has(path)) {
      issues.push(err('emoji.manifest.unexpected', `Emoji ZIP 含非預期路徑 ${path}`, path));
    }
  }

  return result(issues);
}

/**
 * 驗 Regular Emoji 整包：只有 tab.png、三位數 items 與 product-specific ZIP 規則。
 * 此 input 刻意沒有 main 欄位，避免把 Sticker archive shape 弱化成 optional main。
 */
export function validateEmojiPack(args: {
  kind: EmojiKind;
  count: number;
  items: ImageInfo[];
  tab: ImageInfo;
  archivePaths: readonly string[];
  zipBytes?: number;
}): ValidationResult {
  const { kind, count, items, tab, archivePaths, zipBytes } = args;
  const results: ValidationResult[] = [validateCount(kind, count)];

  if (items.length !== count) {
    results.push(
      result([
        err('emoji.pack.count', `實際 Emoji 張數 ${items.length} 與宣告 ${count} 不符`),
      ]),
    );
  }

  const validateOne = kind === 'animated-emoji'
    ? validateAnimatedEmojiImage
    : validateEmojiImage;
  items.forEach((item, index) => {
    const target = index < 999 ? emojiFileName(index + 1) : undefined;
    results.push(validateOne(item, target));
  });

  results.push(validateEmojiTab(tab));
  results.push(validateEmojiManifest(archivePaths, count));

  if (zipBytes !== undefined && !isEmojiZipBytesAllowed(kind, zipBytes)) {
    const spec = kind === 'animated-emoji' ? ANIMATED_EMOJI_SPEC : EMOJI_SPEC;
    const comparator = spec.zipMaxInclusive ? '不得超過' : '必須小於';
    results.push(
      result([
        err(
          'emoji.zip.bytes',
          `${kind} ZIP ${zipBytes} bytes ${comparator} ${spec.zipMaxBytes} bytes`,
        ),
      ]),
    );
  }

  return mergeResults(...results);
}

/**
 * 驗 Popup Sticker 雙軌整包：靜態 png/ 與動畫 popup/ 必須各有 count 張。
 * Popup 單軌呼叫請使用 validatePack 以外的專用 API，避免誤把一組檔案當完整包。
 */
export function validatePopupPack(args: {
  count: number;
  stickers: ImageInfo[];
  popupStickers: ImageInfo[];
  main: ImageInfo;
  popupMain: ImageInfo;
  tab: ImageInfo;
  zipBytes?: number;
}): ValidationResult {
  const { count, stickers, popupStickers, main, popupMain, tab, zipBytes } = args;
  const results: ValidationResult[] = [validateCount('popup', count)];

  if (stickers.length !== count) {
    results.push(
      result([
        err(
          'popup.staticCount',
          `靜態 Popup 貼圖張數 ${stickers.length} 與宣告 ${count} 不符`,
        ),
      ]),
    );
  }
  if (popupStickers.length !== count) {
    results.push(
      result([
        err(
          'popup.animationCount',
          `動畫 Popup 貼圖張數 ${popupStickers.length} 與宣告 ${count} 不符`,
        ),
      ]),
    );
  }

  stickers.forEach((sticker, index) => {
    results.push(validatePopupStaticImage(sticker, popupStaticFilePath(index + 1)));
  });
  popupStickers.forEach((sticker, index) => {
    results.push(validatePopupImage(sticker, popupAnimationFilePath(index + 1)));
  });

  // Static cover/tab retain shared size/byte rules and add strict final-byte Popup evidence.
  results.push(validateMain(main, 'static'));
  results.push(validatePopupStaticSupportImage(main, POPUP_STATIC_MAIN_PATH));
  results.push(validatePopupMain(popupMain, POPUP_ANIMATION_MAIN_PATH));
  results.push(validateTab(tab));
  results.push(validatePopupStaticSupportImage(tab, POPUP_STATIC_TAB_PATH));

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
  if (kind === 'popup') {
    return result([
      err(
        'pack.popupPairRequired',
        'Popup Sticker 必須同時提供靜態 png/ 與動畫 popup/ 貼圖，請使用 validatePopupPack()',
      ),
    ]);
  }
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
