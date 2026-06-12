/**
 * 設定檔 zod schema（驗證 raw YAML/JSON）。
 * 正規化（套來源相依預設、grid 解析、推導 kind）在 config/load.ts。
 */

import { z } from 'zod';

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

export const AnimationSchema = z
  .object({
    maxBytes: z.number().int().positive().default(1_000_000),
    loops: z.number().int().min(1).max(4).default(1),
    durationSec: z.number().positive().default(2),
    autoFit: z.boolean().default(true),
    priority: z.enum(['colors', 'frames', 'balanced']).default('balanced'),
    minColors: z.number().int().positive().default(16),
    minFrames: z.number().int().min(5).default(5),
    ladder: z.union([z.literal('auto'), z.array(LadderRungSchema)]).default('auto'),
    stabilize: StabilizeSchema,
  })
  .default({});

export const StickerSchema = z.object({
  input: z.string().optional(),
  frames: z.array(z.string()).optional(),
  fps: z.number().positive().optional(),
  motion: z.string().optional(),
  text: TextSchema.optional(),
});

export const ConfigSchema = z.object({
  package: z.object({
    name: z.string().default('My Stickers'),
    count: z.number().int().positive(),
    /** 明確標記動態包；亦可由 stickers[].frames 推導 */
    animated: z.boolean().optional(),
  }),
  source: z.enum(['ai', 'local']).default('ai'),
  ai: AiSchema,
  processing: ProcessingSchema,
  cover: z.number().int().positive().default(1),
  animation: AnimationSchema,
  stickers: z.array(StickerSchema).default([]),
});

export type RawConfig = z.infer<typeof ConfigSchema>;
