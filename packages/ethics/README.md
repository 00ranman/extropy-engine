# @extropy/ethics

Ethical constraint evaluation and governance guardrails for the [Extropy Engine](https://github.com/00ranman/extropy-engine) ecosystem.

## Overview

This package provides a principled, extensible framework for evaluating agent actions against a curated set of ethical principles. It is designed to integrate as a lightweight middleware layer across all Extropy ecosystem packages — from `dag-substrate` governance nodes to `academia-bridge` research agents.

## Core Principles

| ID | Category | Name | Weight |
|----|----------|------|--------|
| EP-001 | harm-prevention | Do No Harm | 1.0 |
| EP-002 | transparency | Radical Transparency | 0.9 |
| EP-003 | autonomy | Preserve Agent Autonomy | 0.85 |
| EP-004 | accountability | Accountability Chain | 0.8 |
| EP-005 | equity | Equitable Access | 0.75 |
| EP-006 | epistemic-humility | Godel Humility | 0.7 |

Weights are used to compute a normalized ethics score (0-1) on each validation run.

## Installation

```bash
pnpm add @extropy/ethics
```

## Usage

### Quick evaluate

```typescript
import { evaluate } from '@extropy/ethics';

const result = evaluate({
  action: 'Redistribute resource pool to node cluster B',
  agentId: 'governance-node-42',
});

console.log(result.passed);  // true
console.log(result.score);   // 1
```

### Extend with domain-specific principles

```typescript
import { EthicsValidator, CORE_PRINCIPLES } from '@extropy/ethics';

class ContractsValidator extends EthicsValidator {
  protected checkPrinciple(context, principle) {
    if (principle.id === 'EP-001' && context.action.includes('delete')) {
      return 'Destructive contract mutations require multi-sig approval';
    }
    return null;
  }
}

const validator = new ContractsValidator();
const result = validator.validate({ action: 'delete contract #77', agentId: 'contracts-agent' });
```

## Ecosystem Integration

- **dag-substrate** — attach validator as a pre-execution hook on all DAG state transitions
- **contracts** — subclass `EthicsValidator` to enforce contract-specific rules
- **governance** — use `ValidationResult.score` as an input signal to on-chain quorum decisions
- **credentials** — validate credential issuance actions before committing to the ledger
- **epistemology-engine** — EP-006 (Godel Humility) is surfaced during belief-revision cycles

## API

### `evaluate(context: ActionContext): ValidationResult`

Convenience function using the default validator with all `CORE_PRINCIPLES`.

### `EthicsValidator`

Extensible class. Override `checkPrinciple(context, principle)` to add domain logic.

### `CORE_PRINCIPLES`

Array of `EthicalPrinciple` objects. Import and extend for custom validators.

## License

MIT — part of the Extropy Engine monorepo.
