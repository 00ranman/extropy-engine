/**
 * xp-mint: calculateXP wrapper around the canonical @extropy/xp-formula.
 *
 * The XP formula is owned by @extropy/xp-formula. xp-mint MUST NOT
 * reimplement it. This module preserves the historical xp-mint input
 * surface (scalar domainWeight + essentiality, settlementTimeSeconds)
 * and the additional non-positive-input guards by adapting to the
 * canonical computeXP({ R, F, deltaS, w, E, Ts }) signature:
 *   - scalar w, E -> one-element vectors [w], [E] (dot product = w * E)
 *   - settlementTimeSeconds -> Ts
 *
 * Behavior is intentionally byte-identical to the previous in-file
 * implementation; see __tests__/calculate-xp.test.ts for parity coverage.
 */

import type { XPFormulaInputs } from '@extropy/contracts';
import { computeXP } from '@extropy/xp-formula';

export function calculateXP(inputs: XPFormulaInputs): number {
  const { rarity, frequencyOfDecay, deltaS, domainWeight, essentiality, settlementTimeSeconds } = inputs;
  // Preserve historical xp-mint input guards. The canonical formula
  // clamps the final XP at 0 but does not reject non-positive R/F/w/E
  // individually; xp-mint has always rejected them up front to avoid
  // double-negative combinations producing positive XP.
  if (deltaS <= 0) return 0;
  if (rarity <= 0 || frequencyOfDecay <= 0 || domainWeight <= 0 || essentiality <= 0) return 0;
  if (settlementTimeSeconds <= 0) return 0;
  const result = computeXP({
    R: rarity,
    F: frequencyOfDecay,
    deltaS,
    w: [domainWeight],
    E: [essentiality],
    Ts: settlementTimeSeconds,
  });
  // Historical xp-mint returned 0 whenever settlementFactor <= 0 (i.e.
  // Ts >= 1). Canonical computeXP rejects Ts > 1 (valid=false) and
  // returns xp=0 when Ts == 1 (log(1/1) = 0). Match the legacy zero by
  // also returning 0 when the canonical result is invalid.
  if (!result.valid) return 0;
  return Math.max(0, result.xp);
}
