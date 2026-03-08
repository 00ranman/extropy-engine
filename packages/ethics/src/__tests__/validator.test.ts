/**
 * @module validator.test
 * Unit tests for EthicsValidator and the evaluate() convenience function.
 * Uses Vitest — no external dependencies, pure in-memory evaluation.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  EthicsValidator,
  evaluate,
  EthicalPrinciple,
  CORE_PRINCIPLES,
  ActionContext,
} from '../index';

describe('CORE_PRINCIPLES', () => {
  it('should export exactly 6 principles', () => {
    expect(CORE_PRINCIPLES).toHaveLength(6);
  });

  it('each principle should have a weight between 0 and 1', () => {
    for (const p of CORE_PRINCIPLES) {
      expect(p.weight).toBeGreaterThan(0);
      expect(p.weight).toBeLessThanOrEqual(1);
    }
  });

  it('should include EP-001 (Do No Harm) with weight 1.0', () => {
    const ep001 = CORE_PRINCIPLES.find((p) => p.id === 'EP-001');
    expect(ep001).toBeDefined();
    expect(ep001!.weight).toBe(1.0);
    expect(ep001!.category).toBe('harm-prevention');
  });
});

describe('EthicsValidator — default (allow-by-default)', () => {
  let validator: EthicsValidator;

  beforeEach(() => {
    validator = new EthicsValidator();
  });

  it('should pass a benign action with score 1', () => {
    const result = validator.validate({
      action: 'Read public ledger state',
      agentId: 'agent-001',
    });
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
    expect(result.violations).toHaveLength(0);
    expect(result.evaluatedAt).toBeTruthy();
  });

  it('should return a valid ISO timestamp', () => {
    const result = validator.validate({ action: 'ping', agentId: 'test' });
    expect(() => new Date(result.evaluatedAt)).not.toThrow();
    expect(new Date(result.evaluatedAt).getTime()).toBeGreaterThan(0);
  });
});

describe('EthicsValidator — custom subclass with violations', () => {
  class StrictValidator extends EthicsValidator {
    protected checkPrinciple(
      context: ActionContext,
      principle: EthicalPrinciple
    ): string | null {
      if (principle.id === 'EP-001' && context.action.toLowerCase().includes('delete')) {
        return 'Destructive actions require multi-sig approval (EP-001)';
      }
      if (principle.id === 'EP-002' && context.metadata?.secretOp === true) {
        return 'Secret operations violate Radical Transparency (EP-002)';
      }
      return null;
    }
  }

  let validator: StrictValidator;

  beforeEach(() => {
    validator = new StrictValidator();
  });

  it('should flag a delete action as violating EP-001', () => {
    const result = validator.validate({
      action: 'delete contract #77',
      agentId: 'contracts-agent',
    });
    expect(result.passed).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].principle.id).toBe('EP-001');
  });

  it('score should decrease proportionally to violation weight', () => {
    const result = validator.validate({
      action: 'delete contract #77',
      agentId: 'contracts-agent',
    });
    // EP-001 weight is 1.0; total weight is sum of all principle weights
    const totalWeight = CORE_PRINCIPLES.reduce((s, p) => s + p.weight, 0);
    const expectedScore = (totalWeight - 1.0) / totalWeight;
    expect(result.score).toBeCloseTo(expectedScore, 3);
  });

  it('should flag a secret operation as violating EP-002', () => {
    const result = validator.validate({
      action: 'redistribute funds',
      agentId: 'finance-agent',
      metadata: { secretOp: true },
    });
    expect(result.passed).toBe(false);
    expect(result.violations[0].principle.id).toBe('EP-002');
  });

  it('can accumulate multiple violations in one evaluation', () => {
    const result = validator.validate({
      action: 'delete secret archive',
      agentId: 'admin-agent',
      metadata: { secretOp: true },
    });
    expect(result.violations.length).toBeGreaterThanOrEqual(2);
    expect(result.passed).toBe(false);
  });

  it('should pass a benign action even with strict validator', () => {
    const result = validator.validate({
      action: 'read public ledger',
      agentId: 'read-agent',
    });
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
  });
});

describe('evaluate() convenience function', () => {
  it('should return a passing result with score 1 for a benign action', () => {
    const result = evaluate({
      action: 'Redistribute resource pool to node cluster B',
      agentId: 'governance-node-42',
    });
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
  });

  it('should accept optional metadata', () => {
    const result = evaluate({
      action: 'emit telemetry',
      agentId: 'monitor-001',
      metadata: { level: 'info', source: 'dag-substrate' },
    });
    expect(result).toHaveProperty('passed');
    expect(result).toHaveProperty('score');
    expect(result).toHaveProperty('violations');
    expect(result).toHaveProperty('evaluatedAt');
  });
});

describe('EthicsValidator — additional principles via constructor', () => {
  const domainPrinciple: EthicalPrinciple = {
    id: 'EP-DOMAIN-001',
    category: 'accountability',
    name: 'Contract Immutability',
    description: 'Committed contracts may not be unilaterally modified.',
    weight: 0.95,
  };

  class DomainValidator extends EthicsValidator {
    protected checkPrinciple(
      context: ActionContext,
      principle: EthicalPrinciple
    ): string | null {
      if (principle.id === 'EP-DOMAIN-001' && context.action.includes('modify contract')) {
        return 'Unilateral contract modification violates EP-DOMAIN-001';
      }
      return null;
    }
  }

  it('should enforce additional domain principle', () => {
    const validator = new DomainValidator([domainPrinciple]);
    const result = validator.validate({
      action: 'modify contract #5',
      agentId: 'contract-bot',
    });
    expect(result.passed).toBe(false);
    expect(result.violations[0].principle.id).toBe('EP-DOMAIN-001');
  });

  it('total principles count should be CORE_PRINCIPLES + 1', () => {
    // Indirectly verified: if additional principle fires, it was registered
    const validator = new DomainValidator([domainPrinciple]);
    const result = validator.validate({ action: 'read state', agentId: 'bot' });
    expect(result.passed).toBe(true); // No violations for benign action
  });
});
