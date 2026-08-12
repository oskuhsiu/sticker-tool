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

export interface EdgeAndWholeImageColorKeyOptions {
  scope: 'edge-and-whole-image';
  edge: ColorKeyEdge;
  /** Maximum RGB Chebyshev distance for the whole-image cleanup pass, normalized to 0–100%. */
  tolerancePercent: number;
}

/** Options that only apply to deterministic browser color-key removal. */
export type ColorKeyOptions =
  | EdgeConnectedColorKeyOptions
  | WholeImageColorKeyOptions
  | EdgeAndWholeImageColorKeyOptions;

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
  if (options.scope === 'whole-image') {
    return { scope: options.scope, tolerancePercent: options.tolerancePercent };
  }
  if (options.scope === 'edge-and-whole-image') {
    return {
      scope: options.scope,
      edge: options.edge,
      tolerancePercent: options.tolerancePercent,
    };
  }
  return { scope: options.scope, edge: options.edge };
}

export function colorKeyUsesEdge(
  options: Readonly<ColorKeyOptions>,
): options is EdgeConnectedColorKeyOptions | EdgeAndWholeImageColorKeyOptions {
  return options.scope === 'edge-connected' || options.scope === 'edge-and-whole-image';
}

export function colorKeyUsesWholeImage(
  options: Readonly<ColorKeyOptions>,
): options is WholeImageColorKeyOptions | EdgeAndWholeImageColorKeyOptions {
  return options.scope === 'whole-image' || options.scope === 'edge-and-whole-image';
}

export function colorKeyOptionsEqual(
  left: Readonly<ColorKeyOptions>,
  right: Readonly<ColorKeyOptions>,
): boolean {
  if (left.scope !== right.scope) return false;
  if (left.scope === 'edge-connected') {
    return right.scope === 'edge-connected' && left.edge === right.edge;
  }
  if (left.scope === 'whole-image') {
    return right.scope === 'whole-image' && left.tolerancePercent === right.tolerancePercent;
  }
  return (
    right.scope === 'edge-and-whole-image' &&
    left.edge === right.edge &&
    left.tolerancePercent === right.tolerancePercent
  );
}
