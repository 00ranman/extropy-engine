/**
 * v3.1.x backwards-compat shim.
 *
 * The Beta(alpha, beta) conjugate math now lives in @extropy/bayesian so
 * personal-AI edge agents and other services can consume it without
 * depending on the full epistemology-engine surface. Internal callers that
 * still import from './bayesian.js' keep working through this re-export.
 */

export * from '@extropy/bayesian';
