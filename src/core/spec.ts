/**
 * LINE Creators Market 規格常數（已向官方文件確認，寫死為常數）。
 *
 * 來源：
 *   creator.line.me/en/guideline/sticker          （靜態，查證 2026-06-09）
 *   creator.line.me/en/guideline/animationsticker （動態，查證 2026-06-09）
 *   creator.line.me/en/guideline/bigsticker       （大貼圖，查證 2026-08-04）
 *   creator.line.me/en/guideline/popupsticker     （Popup Sticker，查證 2026-08-04）
 *   creator.line.me/en/guideline/emoji            （Emoji，查證 2026-08-04）
 *   creator.line.me/en/guideline/animationemoji   （動態 Emoji，查證 2026-08-04）
 *
 * 本檔為純常數/純函式，平台無關（mobile 可直接重用）。
 */

/** 靜態貼圖規格 */
export const STATIC_SPEC = {
  /** 單張最大寬（px） */
  maxWidth: 370,
  /** 單張最大高（px） */
  maxHeight: 320,
  /** 單張檔案上限（bytes）；1MB */
  maxBytes: 1_000_000,
  /** 建議四周留白（px） */
  recommendedMarginPx: 10,
  /** 最低 dpi */
  minDpi: 72,
  /** 允許的張數 */
  counts: [8, 16, 24, 32, 40] as const,
  /** 透明 RGBA PNG */
  channels: 4 as const,
} as const;

/** LINE Big Sticker 規格 */
export const BIG_STICKER_SPEC = {
  /** 單張最小寬（px） */
  minWidth: 80,
  /** 單張最小高（px） */
  minHeight: 524,
  /** 單張最大寬（px） */
  maxWidth: 396,
  /** 單張最大高（px） */
  maxHeight: 660,
  /** 單張檔案上限（bytes）；1MB */
  maxBytes: 1_000_000,
  /** 不主動預留外圍留白（px） */
  recommendedMarginPx: 0,
  /** 允許的張數 */
  counts: [8, 16, 24, 32, 40] as const,
  /** 透明 RGBA PNG */
  channels: 4 as const,
} as const;

/**
 * LINE Popup Sticker 規格。
 * Source: creator.line.me/en/guideline/popupsticker/ and /detail/ (verified 2026-08-04).
 */
export const POPUP_STICKER_SPEC = {
  /** Popup 單張最大寬（px） */
  maxWidth: 480,
  /** Popup 單張最大高（px） */
  maxHeight: 480,
  /** 寬為 480 時的最小高（px） */
  minHeightAtMaxWidth: 320,
  /** 高為 480 時的最小寬（px） */
  minWidthAtMaxHeight: 200,
  /** 單張檔案上限（bytes）；1MB */
  maxBytes: 1_000_000,
  /** APNG 最少影格 */
  minFrames: 5,
  /** APNG 最多影格 */
  maxFrames: 20,
  /** 每張 Popup APNG 最少循環次數 */
  minLoops: 1,
  /** 每張 Popup APNG 最多循環次數 */
  maxLoops: 3,
  /** 允許的單輪播放時間（秒） */
  playbackDurationsSec: [1, 2, 3] as const,
  /** 總播放長度上限（秒）：loops × 單輪時長 ≤ 3s */
  maxDurationSec: 3,
  /** 允許的張數 */
  counts: [8, 16, 24] as const,
  /** 透明 RGBA PNG/APNG */
  channels: 4 as const,
} as const;

/** 動態貼圖規格 */
export const ANIMATED_SPEC = {
  /** 單格最大寬（px） */
  maxWidth: 320,
  /** 單格最大高（px） */
  maxHeight: 270,
  /**
   * 寬或高「至少一邊」須達此值。因 maxHeight 也是 270，
   * 故「高為長邊時須剛好 270」自然成立。
   */
  minLongSide: 270,
  /** 單檔上限（bytes）；⚠️ 是 1MB，不是先前誤記的 300KB */
  maxBytes: 1_000_000,
  /** 影格數下限（LINE 動態最少 5 格） */
  minFrames: 5,
  /** 影格數上限 */
  maxFrames: 20,
  /** 總播放長度上限（秒）：loops × 單輪時長 ≤ 4s */
  maxDurationSec: 4,
  /** LINE accepts only these per-loop playback durations. */
  playbackDurationsSec: [1, 2, 3, 4] as const,
  /** 循環次數下限（LINE 不接受無限循環/0） */
  minLoops: 1,
  /** 循環次數上限 */
  maxLoops: 4,
  /** 允許的張數（動態僅 8/16/24） */
  counts: [8, 16, 24] as const,
  channels: 4 as const,
} as const;

/** Emoji 整包 ZIP 上限（bytes）；20MB。靜態與動態使用不同邊界比較。 */
export const EMOJI_ZIP_MAX_BYTES = 20_000_000;

/** Emoji 序號圖檔名位數（"001.png"…）。 */
export const EMOJI_SEQ_DIGITS = 3;

/** LINE Regular Emoji 規格。 */
export const EMOJI_SPEC = {
  /** 每張固定寬度（px） */
  width: 180,
  /** 每張固定高度（px） */
  height: 180,
  /** 單張檔案上限（bytes）；1MB */
  maxBytes: 1_000_000,
  /** 最低 dpi */
  minDpi: 72,
  /** Regular Emoji 最少張數 */
  minCount: 8,
  /** Regular Emoji 最多張數 */
  maxCount: 40,
  /** 透明 RGBA PNG */
  channels: 4 as const,
  /** 三位數序號 */
  sequenceDigits: EMOJI_SEQ_DIGITS,
  /** 整包 ZIP 上限 */
  zipMaxBytes: EMOJI_ZIP_MAX_BYTES,
  /** 靜態 Emoji 規定 ZIP 必須嚴格小於上限。 */
  zipMaxInclusive: false,
  /** Emoji 不上傳獨立 main.png。 */
  requiresMain: false,
} as const;

/** LINE Animated Regular Emoji 規格。 */
export const ANIMATED_EMOJI_SPEC = {
  ...EMOJI_SPEC,
  /** 單張檔案上限（bytes）；300KB */
  maxBytes: 300_000,
  /** APNG 最少影格 */
  minFrames: 5,
  /** APNG 最多影格 */
  maxFrames: 20,
  /** 循環次數下限 */
  minLoops: 1,
  /** 循環次數上限 */
  maxLoops: 4,
  /** 允許的單輪播放時間（秒） */
  playbackDurationsSec: [1, 2, 3, 4] as const,
  /** 解碼後整數 delay 累計容許誤差（ms） */
  durationToleranceMs: 1,
  /** loops × 單輪時長上限（秒） */
  maxDurationSec: 4,
  /** 動態 Emoji ZIP 可等於 20MB。 */
  zipMaxInclusive: true,
} as const;

/** main.png（封面）：動態包必須是 APNG，首格當靜態縮圖 */
export const MAIN = { width: 240, height: 240 } as const;

/** main_popup.png（Popup Sticker 封面）：固定 480×480 APNG */
export const POPUP_MAIN = { width: 480, height: 480 } as const;

/** tab.png：系統自動加播放符號，勿自畫 */
export const TAB = { width: 96, height: 74 } as const;

/** 整包 zip 上限（bytes）；60MB */
export const ZIP_MAX_BYTES = 60_000_000;

/** 序號圖檔名位數（"01.png"…） */
export const SEQ_DIGITS = 2;

export type StickerKind = 'static' | 'animated' | 'big' | 'popup';
export type EmojiKind = 'emoji' | 'animated-emoji';
export type LinePackKind = StickerKind | EmojiKind;
export type EmojiSetType = 'regular';

const REGULAR_EMOJI_COUNTS: readonly number[] = Object.freeze(
  Array.from(
    { length: EMOJI_SPEC.maxCount - EMOJI_SPEC.minCount + 1 },
    (_, index) => EMOJI_SPEC.minCount + index,
  ),
);

/** 判斷是否為 Emoji product kind。 */
export function isEmojiKind(kind: LinePackKind): kind is EmojiKind {
  return kind === 'emoji' || kind === 'animated-emoji';
}

/** 取得某種貼圖類型的張數白名單 */
export function allowedCounts(kind: LinePackKind): readonly number[] {
  if (isEmojiKind(kind)) return REGULAR_EMOJI_COUNTS;
  if (kind === 'animated') return ANIMATED_SPEC.counts;
  if (kind === 'big') return BIG_STICKER_SPEC.counts;
  if (kind === 'popup') return POPUP_STICKER_SPEC.counts;
  return STATIC_SPEC.counts;
}

/** 該張數對該貼圖類型是否合法 */
export function isAllowedCount(kind: LinePackKind, count: number): boolean {
  return allowedCounts(kind).includes(count);
}

/** 只有 exact-canvas 產品會回傳固定尺寸；既有 Sticker 仍使用各自 bounds 規則。 */
export function exactItemBounds(
  kind: LinePackKind,
): { width: number; height: number } | undefined {
  if (isEmojiKind(kind)) {
    return { width: EMOJI_SPEC.width, height: EMOJI_SPEC.height };
  }
  return undefined;
}

/** Emoji ZIP 是否符合該 product 的嚴格／含等號邊界。 */
export function isEmojiZipBytesAllowed(kind: EmojiKind, bytes: number): boolean {
  if (!Number.isInteger(bytes) || bytes < 0) return false;
  const spec = kind === 'animated-emoji' ? ANIMATED_EMOJI_SPEC : EMOJI_SPEC;
  return spec.zipMaxInclusive ? bytes <= spec.zipMaxBytes : bytes < spec.zipMaxBytes;
}

/** 大於等於 n 的最小偶數（向上取偶） */
export function ceilEven(n: number): number {
  const r = Math.ceil(n);
  return r % 2 === 0 ? r : r + 1;
}

/** 小於等於 n 的最大偶數（向下取偶）；至少回傳 2 */
export function floorEven(n: number): number {
  const r = Math.floor(n);
  const e = r % 2 === 0 ? r : r - 1;
  return Math.max(2, e);
}

/** 單格最大尺寸（依類型） */
export function maxBounds(kind: LinePackKind): { width: number; height: number } {
  if (isEmojiKind(kind)) {
    return { width: EMOJI_SPEC.width, height: EMOJI_SPEC.height };
  }
  if (kind === 'animated') {
    return { width: ANIMATED_SPEC.maxWidth, height: ANIMATED_SPEC.maxHeight };
  }
  if (kind === 'big') {
    return { width: BIG_STICKER_SPEC.maxWidth, height: BIG_STICKER_SPEC.maxHeight };
  }
  if (kind === 'popup') {
    return { width: POPUP_STICKER_SPEC.maxWidth, height: POPUP_STICKER_SPEC.maxHeight };
  }
  return { width: STATIC_SPEC.maxWidth, height: STATIC_SPEC.maxHeight };
}
