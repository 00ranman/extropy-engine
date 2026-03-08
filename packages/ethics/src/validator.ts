/**
 * @module validator
 * Ethics validation engine for Extropy ecosystem agents.
 *
 * Evaluates proposed actions against registered ethical principles
 * and returns structured results with violation details and a score.
 */

import { EthicalPrinciple, CORE_PRINCIPLES } from './principles';

export interface ActionContext {
  /** Human-readable description of the proposed action */
  action: string;
  /** Originating agent ID */
  agentId: string;
  /** Optional metadata payload */
  metadata?: Record<string, unknown>;
}

export interface PrincipleViolation {
  principle: EthicalPrinciple;
  reason: string;
}

export interface ValidationResult {
  /** true if no violations were found */
  passed: boolean;
  /** Normalized ethics score 0-1 (1 = fully compliant) */
  score: number;
  violations: PrincipleViolation[];
  /** ISO timestamp of evaluation */
  evaluatedAt: string;
}

/**
 * EthicsValidator evaluates actions against a configurable set of principles.
 * By default it uses CORE_PRINCIPLES; extend by passing additional principles.
 */
export class EthicsValidator {
  private principles: EthicalPrinciple[];

  constructor(additionalPrinciples: EthicalPrinciple[] = []) {
    this.principles = [...CORE_PRINCIPLES, ...additionalPrinciples];
  }

  /**
   * Synchronously evaluate an ActionContext.
   * Override `checkPrinciple` in subclasses for domain-specific logic.
   */
  validate(context: ActionContext): ValidationResult {
    const violations: PrincipleViolation[] = [];

    for (const principle of this.principles) {
      const violation = this.checkPrinciple(context, principle);
      if (violation) {
        violations.push({ principle, reason: violation });
      }
    }

    const totalWeight = this.principles.reduce((sum, p) => sum + p.weight, 0);
    const penaltyWeight = violations.reduce((sum, v) => sum + v.principle.weight, 0);
    const score = totalWeight > 0 ? Math.max(0, (totalWeight - penaltyWeight) / totalWeight) : 1;

    return {
      passed: violations.length === 0,
      score: Math.round(score * 1000) / 1000,
      violations,
      evaluatedAt: new Date().toISOString(),
    };
  }

  /**
   * Override this method to provide domain-specific principle checks.
   * Return a violation reason string, or null if the principle is satisfied.
   */
  protected checkPrinciple(
    _context: ActionContext,
    _principle: EthicalPrinciple
  ): string | null {
    // Default implementation: no violations (allow-by-default).
    // Concrete validators should override and inspect context.
    return null;
  }
}

/**
 * Convenience function: evaluate an action with the default validator.
 */
export function evaluate(context: ActionContext): ValidationResult {
  return new EthicsValidator().validate(context);
}
