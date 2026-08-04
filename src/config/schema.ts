/**
 * 設定檔 zod schema（驗證 raw YAML/JSON）。
 * 正規化（套來源相依預設、grid 解析、推導 kind）在 config/load.ts。
 */

import { z } from 'zod';
import { ANIMATED_EMOJI_SPEC, EMOJI_SPEC } from '../core/spec.js';

export const TextSchema = z.object({
  content: z.string(),
  x: z.number().default(50),
  y: z.number().default(50),
  size: z.number().positive().default(40),
  color: z.string().default('#000000'),
  font: z.string(),
  outlineColor: z.string().optional(),
  outlineWidth: z.number().optional(),
});

export const StrokeSchema = z.object({
  enabled: z.boolean().default(false),
  width: z.number().positive().default(8),
  color: z.string().default('#ffffff'),
});

/** grid："auto" 或 "4x3" */
export const GridSchema = z.union([
  z.literal('auto'),
  z.string().regex(/^\d+\s*[xX×]\s*\d+$/, 'grid 須為 "auto" 或 "4x3"'),
]);

export const AiSchema = z
  .object({
    style: z.string().default(''),
    transparent: z.boolean().default(true),
    isCharacter: z.boolean().default(true),
    grid: GridSchema.default('auto'),
    reference: z.string().optional(),
    crop: z.enum(['equal', 'equal+rembg']).default('equal'),
    forceOversizeSet: z.boolean().default(false),
    cellVariations: z.array(z.string()).optional(),
  })
  .default({});

export const ProcessingSchema = z
  .object({
    // 省略時依來源決定預設（local→true、ai→false），見 load.ts
    removeBackground: z.union([z.boolean(), z.literal('auto')]).optional(),
    stroke: StrokeSchema.default({}),
    maxSize: z.tuple([z.number().positive(), z.number().positive()]).optional(),
  })
  .default({});

export const LadderRungSchema = z.object({
  colors: z.number().int().positive(),
  frames: z.number().int().positive(),
});

export const StabilizeSchema = z
  .object({
    enabled: z.boolean().default(true),
    anchor: z.enum(['head', 'centroid', 'none']).default('head'),
    axis: z.enum(['x', 'xy']).default('xy'),
    darkThreshold: z.number().int().positive().default(70),
    topFraction: z.number().positive().max(1).default(0.5),
  })
  .default({});

const animationShape = {
  loops: z.number().int().min(1).max(4).default(1),
  durationSec: z.number().positive().default(2),
  priority: z.enum(['colors', 'frames', 'balanced']).default('balanced'),
  minColors: z.number().int().positive().default(16),
  maxColors: z.number().int().min(0).default(0),
  minFrames: z.number().int().min(5).default(5),
  ladder: z.union([z.literal('auto'), z.array(LadderRungSchema)]).default('auto'),
  stabilize: StabilizeSchema,
} as const;

/** Standalone animation defaults used by `anim --sheet` without a config file. */
export const AnimationSchema = z
  .object({
    maxBytes: z.number().int().positive().default(1_000_000),
    autoFit: z.boolean().default(true),
    ...animationShape,
  })
  .default({});

/** Config form keeps maxBytes optional until the product has been resolved. */
const ConfigAnimationSchema = z
  .object({
    maxBytes: z.number().int().positive().optional(),
    /** Resolved per product in load.ts: legacy Sticker=true, new Emoji=false. */
    autoFit: z.boolean().optional(),
    ...animationShape,
  })
  .default({});

export const StickerSchema = z.object({
  input: z.string().optional(),
  frames: z.array(z.string()).optional(),
  fps: z.number().positive().optional(),
  motion: z.string().optional(),
  text: TextSchema.optional(),
});

export const PackageProductSchema = z.enum(['sticker', 'emoji']);
export type PackageProduct = z.infer<typeof PackageProductSchema>;

export const ConfigSchema = z
  .object({
    package: z.object({
      name: z.string().default('My Stickers'),
      count: z.number().int().positive(),
      /** Legacy configs omit this and remain Sticker packs. */
      product: PackageProductSchema.default('sticker'),
      /** Emoji V1 supports only the official Regular Emoji set. */
      emojiSet: z.literal('regular').optional(),
      /** 明確標記動態包；亦可由 stickers[].frames 推導 */
      animated: z.boolean().optional(),
    }),
    source: z.enum(['ai', 'local']).default('ai'),
    ai: AiSchema,
    processing: ProcessingSchema,
    cover: z.number().int().positive().default(1),
    animation: ConfigAnimationSchema,
    stickers: z.array(StickerSchema).default([]),
  })
  .superRefine((config, context) => {
    const hasFrames = config.stickers.some(
      (sticker) => Array.isArray(sticker.frames) && sticker.frames.length > 0,
    );
    if (config.package.animated === false && hasFrames) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['package', 'animated'],
        message: 'animated=false 與 stickers[].frames 衝突',
      });
    }

    if (config.package.product === 'sticker') {
      if (config.package.emojiSet !== undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['package', 'emojiSet'],
          message: 'emojiSet 只能用於 product=emoji',
        });
      }
      return;
    }

    if (config.package.emojiSet !== 'regular') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['package', 'emojiSet'],
        message: 'product=emoji 時須明確設定 emojiSet=regular',
      });
    }
    if (
      config.package.count < EMOJI_SPEC.minCount ||
      config.package.count > EMOJI_SPEC.maxCount
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['package', 'count'],
        message: `Regular Emoji 張數須為 ${EMOJI_SPEC.minCount}–${EMOJI_SPEC.maxCount}`,
      });
    }
    if (
      config.processing.maxSize !== undefined &&
      (config.processing.maxSize[0] !== EMOJI_SPEC.width ||
        config.processing.maxSize[1] !== EMOJI_SPEC.height)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['processing', 'maxSize'],
        message: `Emoji 輸出畫布固定為 ${EMOJI_SPEC.width}×${EMOJI_SPEC.height}；不可指定其他 maxSize`,
      });
    }

    const animated = config.package.animated === true || hasFrames;
    if (!animated) return;

    if (
      config.animation.maxBytes !== undefined &&
      config.animation.maxBytes > ANIMATED_EMOJI_SPEC.maxBytes
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['animation', 'maxBytes'],
        message: `Animated Emoji maxBytes 不得超過 ${ANIMATED_EMOJI_SPEC.maxBytes}`,
      });
    }
    if (config.animation.minFrames > ANIMATED_EMOJI_SPEC.maxFrames) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['animation', 'minFrames'],
        message: `Animated Emoji minFrames 須為 ${ANIMATED_EMOJI_SPEC.minFrames}–${ANIMATED_EMOJI_SPEC.maxFrames}`,
      });
    }
    if (
      Array.isArray(config.animation.ladder) &&
      config.animation.ladder.some(
        (rung) =>
          rung.frames < ANIMATED_EMOJI_SPEC.minFrames ||
          rung.frames > ANIMATED_EMOJI_SPEC.maxFrames,
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['animation', 'ladder'],
        message: `Animated Emoji ladder 的 frames 須為 ${ANIMATED_EMOJI_SPEC.minFrames}–${ANIMATED_EMOJI_SPEC.maxFrames}`,
      });
    }
    if (!(ANIMATED_EMOJI_SPEC.playbackDurationsSec as readonly number[]).includes(
      config.animation.durationSec,
    )) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['animation', 'durationSec'],
        message: `Animated Emoji 單輪播放時間只能是 ${ANIMATED_EMOJI_SPEC.playbackDurationsSec.join('/')} 秒`,
      });
    }
    if (
      config.animation.durationSec * config.animation.loops >
      ANIMATED_EMOJI_SPEC.maxDurationSec
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['animation', 'loops'],
        message: `Animated Emoji 單輪時間 × loops 不得超過 ${ANIMATED_EMOJI_SPEC.maxDurationSec} 秒`,
      });
    }
  });

export type RawConfig = z.infer<typeof ConfigSchema>;
