/**
 * 組裝產圖 prompt（風格區塊 + 一致性指示 + 透明背景 + 排版規則 + 每格內容）。
 *
 * ★ 這是 mobile 唯一重用的 pipeline 鄰接層：mobile 不直接生圖，只用本檔產 prompt
 *   給使用者貼到外部產圖工具。（CLI 已不自帶 codex 產圖——AI 產圖改由 char-gen skill 負責；
 *   OutputContract 仍保留供未來需要時注入「輸出契約」。）
 *
 * 純字串組裝、平台無關。
 */

import type { GridLayout, StickerKind } from './types.js';

/** codex 端的輸出契約（CLI-only；mobile 省略）。讓 codex 的隨機性只剩「像素長相」。 */
export interface OutputContract {
  /** codex 必須存檔的確切路徑（事後檢查存在；缺檔→重試） */
  sheetPath: string;
  /** 是否要求 codex 回傳結構化 JSON（搭配 codex exec --output-schema） */
  returnsJson: boolean;
}

export interface SheetPromptOptions {
  /** 風格描述（如 "flat cartoon, bold black outline, pastel palette"） */
  style: string;
  layout: GridLayout;
  /** 角色包→強調身份鎖定 */
  isCharacter: boolean;
  /** 透明背景（true）或綠幕去背（false） */
  transparent: boolean;
  /** 每格的表情/姿勢變化；長度不足時自動補通用變化 */
  cellVariations?: string[];
  /** 是否附了參考圖（-i），prompt 內提醒沿用參考角色 */
  hasReference?: boolean;
  /** 輸出契約（CLI 注入；mobile 省略） */
  output?: OutputContract;
}

export interface FramesPromptOptions {
  style: string;
  /** 影格網格（count = 影格數 5–20，由呼叫端用 gridDimsFor 決定 cols/rows） */
  layout: GridLayout;
  /** 動作描述（如 "waving hand", "blinking and nodding"） */
  motion: string;
  isCharacter: boolean;
  transparent: boolean;
  hasReference?: boolean;
  output?: OutputContract;
}

/** 通用貼圖表情/情境（不足時補位用；夠表達日常聊天情緒） */
const DEFAULT_EXPRESSIONS: string[] = [
  'happy smiling, waving hello',
  'laughing out loud with joy',
  'crying with big teardrops',
  'angry with steam, frowning',
  'surprised with wide eyes, mouth open',
  'love struck with heart eyes',
  'sleeping with a "Zzz" bubble',
  'giving a thumbs up, confident',
  'thinking with a finger on chin, question mark',
  'sad and disappointed, slumped',
  'winking and making an OK sign',
  'blowing a kiss',
  'shocked / speechless',
  'excited and jumping',
  'embarrassed, blushing',
  'saying goodbye, waving',
  'pleading with puppy eyes',
  'celebrating with confetti',
  'sulking / pouting',
  'relieved and relaxed',
  'cheering with both arms up',
  'shy, peeking',
  'determined / fired up',
  'sick with a face mask',
];

/** 取得 N 個每格內容（優先用自訂，不足補通用，再不足循環） */
export function expressionsFor(count: number, custom?: string[]): string[] {
  const out: string[] = [];
  const custOk = (custom ?? []).filter((s) => s.trim().length > 0);
  for (let i = 0; i < count; i++) {
    if (i < custOk.length) {
      out.push(custOk[i]!);
    } else {
      const fallback = DEFAULT_EXPRESSIONS[(i - custOk.length) % DEFAULT_EXPRESSIONS.length]!;
      out.push(fallback);
    }
  }
  return out;
}

function styleBlock(style: string): string {
  return `STYLE (apply uniformly to every cell):\n${style}`;
}

function consistencyBlock(isCharacter: boolean, hasReference: boolean): string {
  const lines: string[] = [];
  if (isCharacter) {
    lines.push(
      'CHARACTER CONSISTENCY (critical): every cell must be the EXACT SAME character —',
      'identical face shape, eye shape, nose, hairstyle, hair color, outfit, color palette,',
      'line weight and art style. Only the pose/expression changes between cells. Do NOT',
      'redesign the character per cell. Keep proportions and head-to-body ratio constant.',
    );
    if (hasReference) {
      lines.push(
        'A reference image of the character is provided — reproduce that same character faithfully.',
      );
    }
  } else {
    lines.push(
      'STYLE CONSISTENCY: keep the same art style, line weight, and color palette across all cells.',
    );
    if (hasReference) {
      lines.push('A reference image is provided — match its style and subject.');
    }
  }
  return lines.join('\n');
}

function backgroundBlock(transparent: boolean): string {
  if (transparent) {
    return [
      'BACKGROUND: fully transparent (RGBA, alpha = 0 outside the subject).',
      'No drop shadows, no background fills, no checkerboard — clean transparent edges.',
    ].join('\n');
  }
  return [
    'BACKGROUND: solid pure chroma green (#00FF00) filling the whole sheet behind subjects.',
    'Keep the green flat and uniform (no green tint on the subjects) so it can be keyed out cleanly.',
  ].join('\n');
}

function layoutBlock(layout: GridLayout): string {
  const { cols, rows, count } = layout;
  const cells = cols * rows;
  const lines = [
    `LAYOUT: a single sprite sheet, a strict ${cols}×${rows} grid (cols×rows = ${cells} cells).`,
    `Fill the first ${count} cells, one distinct sticker per cell, reading left-to-right, top-to-bottom.`,
    'Each cell: subject centered with even margins; subject fully inside its cell; no overlap or bleed',
    'between cells; equal cell sizes; consistent subject scale across cells.',
  ];
  if (cells > count) {
    lines.push(`Leave the remaining ${cells - count} cell(s) empty (transparent / background only).`);
  }
  return lines.join('\n');
}

function outputBlock(output: OutputContract, layout: GridLayout): string {
  const lines = [
    `OUTPUT: save the finished sprite sheet as a PNG to exactly: ${output.sheetPath}`,
    'Use that exact filename and path — do not rename or save elsewhere.',
  ];
  if (output.returnsJson) {
    lines.push(
      'Then return ONLY a JSON object describing what you produced:',
      `{"sheetPath": "${output.sheetPath}", "cols": ${layout.cols}, "rows": ${layout.rows}, ` +
        `"count": ${layout.count}, "background": "transparent" | "green"}`,
    );
  }
  return lines.join('\n');
}

/**
 * 組裝「靜態 sprite sheet」prompt：同一角色的 N 個不同表情/姿勢貼圖排成網格。
 * mobile 省略 output → 得到純創意 prompt 給使用者貼到外部工具。
 */
export function buildSheetPrompt(opts: SheetPromptOptions): string {
  const { style, layout, isCharacter, transparent, cellVariations, hasReference = false, output } =
    opts;
  const exprs = expressionsFor(layout.count, cellVariations);
  const perCell = exprs.map((e, i) => `  Cell ${i + 1}: ${e}`).join('\n');

  const blocks = [
    `Create a LINE-sticker sprite sheet of ${layout.count} stickers.`,
    styleBlock(style),
    consistencyBlock(isCharacter, hasReference),
    backgroundBlock(transparent),
    layoutBlock(layout),
    `PER-CELL CONTENT (same character, different pose/expression):\n${perCell}`,
    'Make each sticker expressive, readable at small size, and friendly for chat use.',
  ];
  if (output) blocks.push(outputBlock(output, layout));
  return blocks.join('\n\n');
}

/**
 * 組裝「動態貼圖影格序列」prompt：同一角色的一段動作，拆成 N 張連續影格排成網格。
 * 各影格須角色一致、物件邊界對齊，疊起來才不會抖動/殘影（見 M5）。
 */
export function buildFramesPrompt(opts: FramesPromptOptions): string {
  const { style, layout, motion, isCharacter, transparent, hasReference = false, output } = opts;
  const frames = layout.count;

  const blocks = [
    `Create ${frames} CONSECUTIVE ANIMATION FRAMES of a single looping motion: "${motion}".`,
    styleBlock(style),
    consistencyBlock(isCharacter, hasReference),
    backgroundBlock(transparent),
    layoutBlock(layout),
    [
      'FRAME RULES: frames are time-ordered (cell 1 = first frame … last cell = last frame).',
      'The subject must stay in the SAME position and scale across frames — only the moving parts',
      `change — so the frames align when stacked (no jitter/ghosting). Make frame ${frames} loop`,
      'smoothly back into frame 1.',
    ].join('\n'),
  ];
  if (output) blocks.push(outputBlock(output, layout));
  return blocks.join('\n\n');
}
