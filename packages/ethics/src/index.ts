/**
 * @package ethics
 * Extropy Engine — Ethics Package
 *
 * Provides ethical constraint evaluation, principle enforcement,
 * governance guardrails, HTTP service, and audit log persistence
 * for all Extropy ecosystem agents.
 */

// Core types and constants
export { EthicsValidator, ValidationResult, ActionContext, PrincipleViolation } from './validator';
export { EthicalPrinciple, CORE_PRINCIPLES, PrincipleCategory } from './principles';

// Convenience evaluate function
export { evaluate } from './validator';

// HTTP service layer
export { createApp, ServiceOptions } from './service';
export { router } from './routes';

// Database / audit log
export { initDb, insertAuditRecord, queryAuditLog, closePool, AuditRecord } from './db';
