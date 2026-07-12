/**
 * @extropy/validator-weight-lab
 *
 * Offline analysis prototype for gap 14 (validator 4-factor weighting).
 * Advisory only. Not adopted production behavior. Never writes production
 * weights. Fails closed when no real historical dataset exists.
 *
 * See README.md and docs/GAP_FEEDBACK_CANDIDATES.md Candidate 2.
 */

export * from './schema.js';
export * from './provenance.js';
export * from './evaluate.js';
export * from './report.js';
