export type ColorKeyScope = 'edge-connected' | 'all-matching';

export type ColorKeyEdge = 'soft' | 'decontaminate' | 'hard';

/** Options that only apply to deterministic browser color-key removal. */
export interface ColorKeyOptions {
  scope: ColorKeyScope;
  edge: ColorKeyEdge;
}

/** New color-key jobs favor subject safety while removing composite color halos. */
export const DEFAULT_COLOR_KEY_OPTIONS: Readonly<ColorKeyOptions> = Object.freeze({
  scope: 'edge-connected',
  edge: 'decontaminate',
});

/** Historical browser color-key behavior, used only when migrating old projects. */
export const LEGACY_COLOR_KEY_OPTIONS: Readonly<ColorKeyOptions> = Object.freeze({
  scope: 'all-matching',
  edge: 'soft',
});

export function isColorKeyOptions(value: unknown): value is ColorKeyOptions {
  if (!value || typeof value !== 'object') return false;
  const options = value as Partial<ColorKeyOptions>;
  return (
    (options.scope === 'edge-connected' || options.scope === 'all-matching') &&
    (options.edge === 'soft' || options.edge === 'decontaminate' || options.edge === 'hard')
  );
}

export function copyColorKeyOptions(options: Readonly<ColorKeyOptions>): ColorKeyOptions {
  return { scope: options.scope, edge: options.edge };
}
