/**
 * LocalFlow measurement assembly.
 *
 * Builds the raw baseline and raw outcome evidence for a coordination loop and
 * assembles a canonical measurement record. This module never derives a
 * normalized entropy delta (deltaS_be); it only records raw observables and an
 * explicit normalization status.
 */

import { EntropyDomain } from '@extropy/contracts';
import type { MeasurementSource } from '@extropy/contracts';
import type {
  CoordinationBaseline,
  CoordinationMeasurementRecord,
  CoordinationOutcome,
  NormalizationStatus,
  NormalizedMeasurement,
  Task,
} from './types.js';

/** Default domain for LocalFlow coordination work when none is specified. */
export const DEFAULT_LOCALFLOW_DOMAIN = EntropyDomain.ECONOMIC;

/** True only for the eight canonical entropy domains. */
export function isCanonicalDomain(value: unknown): value is EntropyDomain {
  return (
    typeof value === 'string' &&
    (Object.values(EntropyDomain) as string[]).includes(value)
  );
}

function clientBaselineSource(): MeasurementSource {
  return { type: 'human_observation', identifier: 'localflow:client_request' };
}

function outcomeSource(): MeasurementSource {
  return { type: 'human_observation', identifier: 'localflow:loop_close' };
}

/**
 * Build the raw baseline captured at request opening.
 */
export function buildBaseline(task: Task): CoordinationBaseline {
  return {
    expectedDurationSeconds: task.expectedDurationSeconds,
    capturedAt: task.requestedBy,
    source: clientBaselineSource(),
  };
}

/**
 * Build the raw outcome captured at closing.
 *
 * `actualDurationSeconds` is raw elapsed wall time. It is explicitly not a
 * settlement-time factor and not an entropy delta.
 */
export function buildOutcome(task: Task): CoordinationOutcome {
  const openedAt = task.requestedBy;
  const closedAt = task.confirmedAt ?? new Date().toISOString();
  const elapsedMs = new Date(closedAt).getTime() - new Date(openedAt).getTime();
  const actualDurationSeconds = Math.max(0, elapsedMs / 1000);

  // Independent confirmation: the client confirming a driver's work is a party
  // distinct from the acting driver. We record presence only and never invent
  // a confirmation that did not happen.
  const confirmed = Boolean(task.confirmedAt && task.driverId && task.clientId);

  return {
    actualDurationSeconds,
    completionStatus: task.status === 'confirmed' || task.status === 'completed'
      ? 'completed'
      : 'failed',
    openedAt,
    closedAt,
    independentConfirmation: {
      confirmed,
      confirmerId: confirmed ? task.clientId : undefined,
      method: confirmed ? 'client_confirm' : undefined,
      confirmedAt: confirmed ? task.confirmedAt : undefined,
    },
    source: outcomeSource(),
  };
}

/**
 * Assemble a canonical measurement record for a task.
 *
 * When a validated normalized measurement is supplied, the record is marked
 * 'normalized'. Otherwise it is marked 'unavailable' (honest default) because
 * LocalFlow cannot itself produce a validated normalization.
 */
export function assembleMeasurementRecord(
  task: Task,
  normalized?: NormalizedMeasurement,
): CoordinationMeasurementRecord {
  const domain = isCanonicalDomain(task.domain)
    ? task.domain
    : DEFAULT_LOCALFLOW_DOMAIN;

  let status: NormalizationStatus = 'unavailable';
  if (normalized) {
    if (!isCanonicalDomain(normalized.domain)) {
      throw new Error(
        `Normalized measurement domain is not canonical: ${String(normalized.domain)}`,
      );
    }
    status = 'normalized';
  }

  return {
    taskId: task.id,
    domain,
    baseline: buildBaseline(task),
    outcome: buildOutcome(task),
    normalizationStatus: status,
    normalized,
  };
}
