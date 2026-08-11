export type ColorKeyEdge = 'soft' | 'decontaminate' | 'hard';

export interface EdgeConnectedColorKeyOptions {
  scope: 'edge-connected';
  edge: ColorKeyEdge;
}

export interface WholeImageColorKeyOptions {
  scope: 'whole-image';
  /** Maximum RGB Chebyshev distance, normalized to 0–100%. */
  tolerancePercent: number;
}

/** Options that only apply to deterministic browser color-key removal. */
export type ColorKeyOptions = EdgeConnectedColorKeyOptions | WholeImageColorKeyOptions;

/** New color-key jobs favor subject safety while removing composite color halos. */
export const DEFAULT_COLOR_KEY_OPTIONS: Readonly<ColorKeyOptions> = Object.freeze({
  scope: 'edge-connected',
  edge: 'decontaminate',
});

export const DEFAULT_WHOLE_IMAGE_TOLERANCE_PERCENT = 0;

/** Historical V3 browser behavior. Import upgrades consume this shape but new jobs reject it. */
export const LEGACY_COLOR_KEY_OPTIONS = Object.freeze({
  scope: 'all-matching',
  edge: 'soft',
} as const);

export function copyColorKeyOptions(options: Readonly<ColorKeyOptions>): ColorKeyOptions {
  return options.scope === 'whole-image'
    ? { scope: options.scope, tolerancePercent: options.tolerancePercent }
    : { scope: options.scope, edge: options.edge };
}
