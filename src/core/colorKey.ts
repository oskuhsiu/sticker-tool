export type ColorKeyEdge = 'soft' | 'decontaminate' | 'hard';

/** Options that only apply to deterministic browser color-key removal. */
export interface ColorKeyOptions {
  edge: ColorKeyEdge;
}

/** New color-key jobs favor subject safety while removing composite color halos. */
export const DEFAULT_COLOR_KEY_OPTIONS: Readonly<ColorKeyOptions> = Object.freeze({
  edge: 'decontaminate',
});

/** Historical V3 browser behavior. Import upgrades consume this shape but new jobs reject it. */
export const LEGACY_COLOR_KEY_OPTIONS = Object.freeze({
  scope: 'all-matching',
  edge: 'soft',
} as const);

export function copyColorKeyOptions(options: Readonly<ColorKeyOptions>): ColorKeyOptions {
  return { edge: options.edge };
}
