/**
 * ════════════════════════════════════════════════════════════════════════════════
 *  EXTROPY ENGINE — Database Contract
 * ════════════════════════════════════════════════════════════════════════════════
 *
 *  Defines the shared database interface contract that all services use.
 *  Each service gets its own database but shares this contract for type safety.
 *
 * ════════════════════════════════════════════════════════════════════════════════
 */

import type { LoopRow, ClaimRow, SubClaimRow, ValidatorRow } from './types';

/**
 * Generic repository interface — all service-specific repos extend this.
 */
export interface Repository<T, ID = string> {
  findById(id: ID): Promise<T | null>;
  findMany(filter: Partial<T>): Promise<T[]>;
  save(entity: T): Promise<T>;
  update(id: ID, partial: Partial<T>): Promise<T>;
  delete(id: ID): Promise<void>;
}

export interface LoopRepository extends Repository<LoopRow> {
  findByStatus(status: string): Promise<LoopRow[]>;
  findByDomain(domain: string): Promise<LoopRow[]>;
  findOpenLoops(): Promise<LoopRow[]>;
}

export interface ClaimRepository extends Repository<ClaimRow> {
  findByLoopId(loopId: string): Promise<ClaimRow[]>;
  findByStatus(status: string): Promise<ClaimRow[]>;
}

export interface SubClaimRepository extends Repository<SubClaimRow> {
  findByClaimId(claimId: string): Promise<SubClaimRow[]>;
  findByValidatorId(validatorId: string): Promise<SubClaimRow[]>;
  findPendingByDomain(domain: string): Promise<SubClaimRow[]>;
}

export interface ValidatorRepository extends Repository<ValidatorRow> {
  findActiveByDomain(domain: string): Promise<ValidatorRow[]>;
  findByReputation(minReputation: number): Promise<ValidatorRow[]>;
}

/**
 * Health-check shape returned by each service's /health endpoint.
 */
export interface ServiceHealth {
  service: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  version: string;
  uptime: number;
  checks: HealthCheck[];
}

export interface HealthCheck {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  message?: string;
  durationMs?: number;
}
