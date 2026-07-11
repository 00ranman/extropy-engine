/**
 * SIMULATION ONLY. NOT PRODUCTION MEASUREMENT.
 *
 * This adapter fabricates a normalized measurement from raw observables so the
 * LocalFlow demo can exercise the full mint path without a real validator or a
 * real M_d normalization. Everything it produces is marked `simulated: true`.
 *
 * The coefficients and vectors below are the legacy prototype values. They are
 * NOT a validated normalization. They live here, behind an explicit opt-in, so
 * that no production code path can silently treat elapsed time as deltaS.
 *
 * A production deployment supplies a real NormalizedMeasurement from a
 * validator and never calls this module.
 */

import { normalizeSettlementTime } from '@extropy/xp-formula';
import { DEFAULT_LOCALFLOW_DOMAIN, isCanonicalDomain } from './measurement.js';
import type {
  CoordinationBaseline,
  CoordinationOutcome,
  EntropyDomain,
  NormalizedMeasurement,
} from './types.js';

/**
 * Legacy prototype domain weight and evidence vectors. Order:
 *   [cognitive, code, social, economic, thermodynamic, informational,
 *    governance, temporal]
 * These are demo placeholders, not a validated normalization.
 */
const SIM_WEIGHTS = [0.05, 0, 0.1, 0.45, 0.05, 0.1, 0.05, 0.2];
const SIM_EVIDENCE = [0, 0, 0.1, 0.5, 0.05, 0.1, 0.05, 0.2];
const SIM_RARITY = 0.8;
const SIM_FREQUENCY = 1.0;
const SIM_LAMBDA = 1e-4;

/**
 * Fabricate a normalized measurement for the demo path only.
 *
 * Throws if independent confirmation is absent, mirroring the honest rule that
 * an outcome without an independent confirmer cannot be settled even in the
 * simulation.
 */
export function simulateNormalizedMeasurement(
  baseline: CoordinationBaseline,
  outcome: CoordinationOutcome,
  domain: EntropyDomain = DEFAULT_LOCALFLOW_DOMAIN,
): NormalizedMeasurement {
  if (!outcome.independentConfirmation.confirmed) {
    throw new Error('Cannot simulate normalization without independent confirmation');
  }
  if (!isCanonicalDomain(domain)) {
    throw new Error(`Simulation domain is not canonical: ${String(domain)}`);
  }

  // Demo proxy only: treat completing faster than the expected baseline as a
  // positive coordination signal. This is a stand-in for a real M_d and is not
  // a validated entropy delta.
  const expected = baseline.expectedDurationSeconds ?? outcome.actualDurationSeconds;
  const ratio = expected > 0 ? outcome.actualDurationSeconds / expected : 1;
  const deltaS = Math.max(0.01, 1.0 - Math.min(1, ratio) + 0.1);

  const Ts = normalizeSettlementTime(outcome.actualDurationSeconds, SIM_LAMBDA);

  return {
    domain,
    inputs: {
      R: SIM_RARITY,
      F: SIM_FREQUENCY,
      deltaS,
      w: SIM_WEIGHTS,
      E: SIM_EVIDENCE,
      Ts,
    },
    normalizedBy: 'localflow:simulation-adapter',
    simulated: true,
    normalizedAt: new Date().toISOString(),
  };
}
