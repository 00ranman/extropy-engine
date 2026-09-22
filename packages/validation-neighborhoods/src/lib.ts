/** Volunteer LOOK slices. Not a validator class. */

export const DEFAULT_SLICE_DENOMINATOR = 10;

export interface LookSlice {
  parts: number;
  index: number;
  blind: true;
}

export function lookSlice(parts = DEFAULT_SLICE_DENOMINATOR): LookSlice {
  const n = Math.max(1, Math.floor(parts));
  return {
    parts: n,
    index: Math.floor(Math.random() * n),
    blind: true,
  };
}
