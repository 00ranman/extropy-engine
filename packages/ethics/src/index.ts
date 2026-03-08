/**
 * @package ethics
 * Extropy Engine — Ethics Package
 *
 * Provides ethical constraint evaluation, principle enforcement,
 * and governance guardrails for all Extropy ecosystem agents.
 */

export { EthicsValidator, ValidationResult } from './validator';
export { EthicalPrinciple, CORE_PRINCIPLES, PrincipleCategory } from './principles';

/**
 * Evaluate an action against all registered ethical principles.
 * Returns a ValidationResult indicating pass/fail with reasons.
 */
export { evaluate } from './validator';
