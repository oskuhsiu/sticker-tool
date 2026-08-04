/**
 * 領域型別（resolved/normalized 形態，pipeline 直接消費）。
 * 純型別、平台無關。raw YAML/JSON 由 config/ 的 zod schema 驗證並正規化成這些型別。
 */

import type { EmojiSetType, LinePackKind } from './spec.js';

export type { EmojiKind, EmojiSetType, LinePackKind, StickerKind } from './spec.js';

/** 來源：AI 生成 或 本機圖片 */
export type Source = 'ai' | 'local';

/** 裁切策略（detect 已砍除，見 issues S-1） */
export type CropStrategy = 'equal' | 'equal+rembg';

/** 去背模式 */
export type RemoveBgMode = boolean | 'auto';

/** 文字疊加設定。x/y 為畫布百分比（0–100），錨點為文字中心。 */
export interface TextSpec {
  content: string;
  /** 水平位置，畫布寬度百分比 0–100（50 = 置中） */
  x: number;
  /** 垂直位置，畫布高度百分比 0–100（88 = 接近底部） */
  y: number;
  /** 字級（px） */
  size: number;
  /** 文字顏色（CSS 色，如 "#000"） */
  color: string;
  /** 字族名或字型檔路徑（見 I-7：建議用 .otf/.ttf 路徑以免靜默 fallback） */
  font: string;
  /** 內描邊/外框（讓文字在任何底色上可讀），預設白色細邊 */
  outlineColor?: string;
  outlineWidth?: number;
}

/** 白色描邊設定 */
export interface StrokeSpec {
  enabled: boolean;
  /** 描邊寬度（px） */
  width: number;
  /** 描邊顏色（預設白） */
  color: string;
}

/** 動態貼圖 auto-fit 降級優先序 */
export type AnimPriority = 'colors' | 'frames' | 'balanced';

/** 品質階梯一階 */
export interface LadderRung {
  colors: number;
  frames: number;
}

/**
 * 動態影格主體穩定化（殺跨格漂移）。
 * codex 逐格產的連續影格，主體位置/比例不會自動對齊（左右漂移可達畫面 20–25%）。
 * 在 fit 前以「穩定錨點」把各格對齊，主體鎖定不動，手腳/道具相對它移動。
 */
export interface StabilizeConfig {
  /** 預設開（連續影格常漂） */
  enabled: boolean;
  /**
   * 錨點選法：
   *  'head'     上半部「暗且不透明」像素質心——對深髮角色＋淺/透明底最準（預設）。
   *  'centroid' 整體不透明像素質心——備用；會被伸出的手腳拉歪，慎用。
   *  'none'     不穩定化。
   */
  anchor: 'head' | 'centroid' | 'none';
  /** 對齊軸：'x' 只水平、'xy' 水平+垂直（預設 xy） */
  axis: 'x' | 'xy';
  /** 'head' 的暗度門檻（灰階 < 此值視為頭髮/眉眼），預設 70 */
  darkThreshold: number;
  /** 只在上半部（避開印花/手/道具）找錨點的高度比例，預設 0.5 */
  topFraction: number;
}

/** 動態貼圖設定 */
export interface AnimationConfig {
  maxBytes: number;
  /** 循環次數 1–4（LINE 不接受無限循環） */
  loops: number;
  /** 總播放長度（秒）≤4 */
  durationSec: number;
  /** 超標時逐步降色/減格直到達標 */
  autoFit: boolean;
  priority: AnimPriority;
  /** 量化色數下限（品質地板） */
  minColors: number;
  /** 量化色數上限：0=不設限（容許無損）；如 256＝一開始就減色（檔案小） */
  maxColors: number;
  /** 影格下限（LINE 動態最少 5） */
  minFrames: number;
  /** 'auto'=內建品質階梯；或自訂階梯 */
  ladder: 'auto' | LadderRung[];
  /** 主體穩定化（殺跨格漂移）；fit 前對齊 */
  stabilize: StabilizeConfig;
}

/** AI 產圖設定 */
export interface AiConfig {
  style: string;
  /** 請 codex 直接輸出透明背景 PNG */
  transparent: boolean;
  /** 角色包→強制單次呼叫產完（保證同一人） */
  isCharacter: boolean;
  /** 'auto'（由張數決定）| {cols,rows} */
  grid: 'auto' | { cols: number; rows: number };
  /** 選填：種子/角色參考圖路徑 */
  reference?: string;
  crop: CropStrategy;
  /** 角色包超限（>16 張）時須明確開啟才允許 */
  forceOversizeSet: boolean;
  /** 每格的提示變化（表情/姿勢）；長度不足時自動補通用變化 */
  cellVariations?: string[];
}

/** 影像處理設定 */
export interface ProcessingConfig {
  removeBackground: RemoveBgMode;
  stroke: StrokeSpec;
  /** 單格輸出上限 [w,h] */
  maxSize: [number, number];
}

/** 單張貼圖項目（local 來源或逐張覆寫用） */
export interface StickerItem {
  /** 靜態：單張輸入圖路徑 */
  input?: string;
  /** 動態：連續影格路徑（有 frames → APNG） */
  frames?: string[];
  /** 動態影格率 */
  fps?: number;
  /** AI 動態：動作描述（codex 產影格用，如 "waving hand"） */
  motion?: string;
  /** 文字疊加 */
  text?: TextSpec;
}

/** 正規化後的完整貼圖包設定 */
export interface PackConfig {
  name: string;
  count: number;
  source: Source;
  /** 由 product 與是否含動畫影格正規化後的輸出類型 */
  kind: LinePackKind;
  /** Emoji V1 僅支援 regular；Sticker 不設定此欄位。 */
  emojiSet?: EmojiSetType;
  ai: AiConfig;
  processing: ProcessingConfig;
  /** 用第幾張產 main/tab（1-based） */
  cover: number;
  animation: AnimationConfig;
  stickers: StickerItem[];
}

/** sprite sheet 網格配置 */
export interface GridLayout {
  count: number;
  cols: number;
  rows: number;
  /** 需要幾張大圖（sprite sheet）；角色包恆為 1 */
  sheets: number;
  /** 每張大圖最多容納格數 */
  cellsPerSheet: number;
}

/** 網格決策結果（含警告/擋下） */
export interface GridDecision {
  layout: GridLayout;
  warnings: string[];
  blocked: boolean;
  blockReason?: string;
}

/** 矩形邊界 */
export interface Bounds {
  width: number;
  height: number;
}

/** 驗證單筆結果 */
export interface ValidationIssue {
  level: 'error' | 'warning';
  code: string;
  message: string;
  /** 相關檔案/項目（選填） */
  target?: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}
