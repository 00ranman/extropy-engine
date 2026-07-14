import { describe, it, expect, beforeEach } from 'vitest';
import { FORMULA_VERSION as CANONICAL_VERSION } from '@extropy/xp-formula';
import { EntropyDomain } from '@extropy/contracts';
import {
  assembleMeasurementRecord,
  buildBaseline,
  buildOutcome,
  isCanonicalDomain,
} from '../measurement.js';
import { simulateNormalizedMeasurement } from '../simulation.js';
import { emitLoopClose, getVerticesByTask, _resetVertexStore } from '../dag.js';
import type { CoordinationMeasurementRecord, NormalizedMeasurement, Task } from '../types.js';

function confirmedTask(overrides: Partial<Task> = {}): Task {
  const openedAt = '2026-07-11T10:00:00.000Z';
  const closedAt = '2026-07-11T11:00:00.000Z'; // 3600s later
  return {
    id: 'task-1',
    clientId: 'client-1',
    driverId: 'driver-1',
    type: 'errand',
    description: 'grocery run',
    status: 'confirmed',
    requestedBy: openedAt,
    completedAt: closedAt,
    confirmedAt: closedAt,
    zone: 'maxwell-tx',
    expectedDurationSeconds: 7200,
    domain: EntropyDomain.ECONOMIC,
    dagVertices: [],
    ...overrides,
  };
}

function validNormalized(): NormalizedMeasurement {
  return {
    domain: EntropyDomain.ECONOMIC,
    inputs: {
      R: 0.8,
      F: 1.0,
      deltaS: 0.7,
      w: [0, 0, 0, 0.5, 0, 0, 0, 0.5],
      E: [0, 0, 0, 0.5, 0, 0, 0, 0.5],
      Ts: 0.2,
    },
    normalizedBy: 'test-validator',
    simulated: false,
    normalizedAt: new Date().toISOString(),
  };
}

beforeEach(() => {
  _resetVertexStore();
});

describe('raw evidence capture', () => {
  it('captures baseline and outcome as raw observables, not deltaS', () => {
    const task = confirmedTask();
    const baseline = buildBaseline(task);
    const outcome = buildOutcome(task);

    expect(baseline.expectedDurationSeconds).toBe(7200);
    expect(baseline.source.type).toBe('human_observation');

    expect(outcome.actualDurationSeconds).toBe(3600);
    expect(outcome.completionStatus).toBe('completed');
    // Raw observables must not carry a normalized entropy field.
    expect(outcome).not.toHaveProperty('deltaS');
    expect(outcome).not.toHaveProperty('deltaS_be');
    expect(outcome).not.toHaveProperty('Ts');
  });

  it('records independent confirmation presence without fabricating it', () => {
    const withConfirmer = buildOutcome(confirmedTask());
    expect(withConfirmer.independentConfirmation.confirmed).toBe(true);
    expect(withConfirmer.independentConfirmation.confirmerId).toBe('client-1');

    const noDriver = buildOutcome(confirmedTask({ driverId: undefined }));
    expect(noDriver.independentConfirmation.confirmed).toBe(false);
    expect(noDriver.independentConfirmation.confirmerId).toBeUndefined();
  });
});

describe('canonical domain typing', () => {
  it('accepts only the eight canonical domains', () => {
    expect(isCanonicalDomain('economic')).toBe(true);
    expect(isCanonicalDomain('temporal')).toBe(true);
    expect(isCanonicalDomain('financial')).toBe(false);
    expect(isCanonicalDomain('')).toBe(false);
    expect(isCanonicalDomain(42)).toBe(false);
  });

  it('rejects a normalized measurement with a non-canonical domain', () => {
    const bad = { ...validNormalized(), domain: 'financial' as EntropyDomain };
    expect(() => assembleMeasurementRecord(confirmedTask(), bad)).toThrow(/not canonical/);
  });
});

describe('measurement record persistence through the in-memory path', () => {
  it('writes a MEASUREMENT vertex carrying baseline and outcome', () => {
    const task = confirmedTask();
    const result = emitLoopClose(task);
    expect(result).not.toBeNull();

    const vertices = getVerticesByTask(task.id);
    const measurement = vertices.find(v => v.type === 'MEASUREMENT');
    expect(measurement).toBeDefined();
    expect(measurement!.canonicalType).toBe('measurement');

    const record = measurement!.payload.record as CoordinationMeasurementRecord;
    expect(record.baseline.expectedDurationSeconds).toBe(7200);
    expect(record.outcome.actualDurationSeconds).toBe(3600);
    expect(record.domain).toBe(EntropyDomain.ECONOMIC);
  });
});

describe('settlement gating', () => {
  it('remains pending and does not mint when normalization is unavailable', () => {
    const task = confirmedTask();
    const result = emitLoopClose(task)!;

    expect(result.settlement).toBe('pending');
    expect(result.mintVertex).toBeNull();

    const record = result.measurementVertex.payload.record as CoordinationMeasurementRecord;
    expect(record.normalizationStatus).toBe('unavailable');
    expect(record.normalized).toBeUndefined();
  });

  it('does not treat elapsed time as a normalized deltaS', () => {
    const task = confirmedTask();
    const result = emitLoopClose(task)!;

    // The close vertex records raw elapsed seconds, never a deltaS.
    expect(result.closeVertex.payload).toHaveProperty('actualDurationSeconds', 3600);
    expect(result.closeVertex.payload).not.toHaveProperty('deltaS');
    expect(result.closeVertex.payload).not.toHaveProperty('Ts');
  });

  it('proceeds to mint with a valid explicitly normalized measurement', () => {
    const task = confirmedTask();
    const result = emitLoopClose(task, validNormalized())!;

    expect(result.settlement).toBe('minted');
    expect(result.mintVertex).not.toBeNull();
    expect(result.mintVertex!.xpProvisional).toBeGreaterThan(0);

    // Canonical formula package must be the source of the version stamp.
    expect(result.mintVertex!.payload.formulaVersion).toBe(CANONICAL_VERSION);

    const record = result.measurementVertex.payload.record as CoordinationMeasurementRecord;
    expect(record.normalizationStatus).toBe('normalized');
  });
});

describe('simulation adapter (demo only)', () => {
  it('flags its output as simulated and requires independent confirmation', () => {
    const task = confirmedTask();
    const normalized = simulateNormalizedMeasurement(
      buildBaseline(task),
      buildOutcome(task),
      task.domain,
    );
    expect(normalized.simulated).toBe(true);
    expect(normalized.normalizedBy).toContain('simulation');

    const noConfirm = confirmedTask({ driverId: undefined });
    expect(() =>
      simulateNormalizedMeasurement(buildBaseline(noConfirm), buildOutcome(noConfirm)),
    ).toThrow(/independent confirmation/);
  });
});
