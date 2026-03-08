/**
 * @package ethics
 * Extropy Engine — Ethics Package
 *
 * Provides ethical constraint evaluation, principle enforcement,
 * governance guardrails, HTTP service, and audit log persistence
 * for all Extropy ecosystem agents.
 */

// Core types and constants
export { EthicsValidator } from './validator';
export type { ValidationResult, ActionContext, PrincipleViolation } from './validator';
export { CORE_PRINCIPLES } from './principles';
export type { EthicalPrinciple, PrincipleCategory } from './principles';

// Convenience evaluate function
export { evaluate } from './validator';

// HTTP service layer
export { createApp } from './service';
export type { ServiceOptions } from './service';
export { router } from './routes';

// Database / audit log
export { initDb, insertAuditRecord, queryAuditLog, closePool } from './db';
export type { AuditRecord } from './db';
