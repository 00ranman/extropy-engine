/**
 * @module principles
 * Core ethical principles for the Extropy Engine ecosystem.
 *
 * Grounded in entropy-aware governance, Gödel-informed humility,
 * and decentralized agent accountability.
 */

export type PrincipleCategory =
  | 'autonomy'
  | 'transparency'
  | 'harm-prevention'
  | 'equity'
  | 'accountability'
  | 'epistemic-humility';

export interface EthicalPrinciple {
  id: string;
  category: PrincipleCategory;
  name: string;
  description: string;
  /** Severity weight 0-1 used during validation scoring */
  weight: number;
}

/**
 * Core principles enforced across all Extropy ecosystem agents.
 * Extensible — packages may register additional domain-specific principles.
 */
export const CORE_PRINCIPLES: EthicalPrinciple[] = [
  {
    id: 'EP-001',
    category: 'harm-prevention',
    name: 'Do No Harm',
    description:
      'Actions must not knowingly cause physical, psychological, economic, or systemic harm to agents or the commons.',
    weight: 1.0,
  },
  {
    id: 'EP-002',
    category: 'transparency',
    name: 'Radical Transparency',
    description:
      'All agent decisions and reasoning chains must be auditable and explainable to affected stakeholders.',
    weight: 0.9,
  },
  {
    id: 'EP-003',
    category: 'autonomy',
    name: 'Preserve Agent Autonomy',
    description:
      'No agent may coerce, manipulate, or override the informed consent of another autonomous agent.',
    weight: 0.85,
  },
  {
    id: 'EP-004',
    category: 'accountability',
    name: 'Accountability Chain',
    description:
      'Every action must be traceable to a responsible agent or governance node within the DAG substrate.',
    weight: 0.8,
  },
  {
    id: 'EP-005',
    category: 'equity',
    name: 'Equitable Access',
    description:
      'Resources, capabilities, and opportunities must be distributed without systemic bias or exclusion.',
    weight: 0.75,
  },
  {
    id: 'EP-006',
    category: 'epistemic-humility',
    name: 'Gödel Humility',
    description:
      'Agents must acknowledge the limits of their own reasoning systems and defer to external review under uncertainty.',
    weight: 0.7,
  },
];
