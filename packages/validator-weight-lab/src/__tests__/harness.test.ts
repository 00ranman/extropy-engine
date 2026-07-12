/**
 * Tests for the validator-weight harness (gap 14 prototype).
 *
 * Coverage:
 *   - no-data failure (absent path fails closed)
 *   - source classification (fixture, simulation, production)
 *   - provenance and hash determinism
 *   - train and holdout separation
 *   - circularity rejection
 *   - bounded update enforcement
 *   - report recommendation status transitions
 */

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildReport } from '../report.js';
import { loadDataset, sha256Hex } from '../provenance.js';
import { parseDataset, DatasetError } from '../schema.js';
import type { EvaluationConfig } from '../evaluate.js';

const FIXTURE = fileURLToPath(new URL('../../fixtures/sample-fixture.json', import.meta.url));

const baseCfg: EvaluationConfig = {
  candidateWeights: { domain: 0.4, rep: 0.3, load: 0.1, accuracy: 0.2 },
  priorWeights: { domain: 0.35, rep: 0.3, load: 0.15, accuracy: 0.2 },
  maxAbsFactorDelta: 0.1,
  minAdmissibleSamples: 6,
  holdoutFraction: 0.3,
};

let dir: string;

function writeDataset(name: string, obj: unknown): string {
  const p = join(dir, name);
  writeFileSync(p, JSON.stringify(obj));
  return p;
}

function makeEvents(
  n: number,
  opts: { derived?: boolean } = {},
): unknown[] {
  const events = [];
  for (let i = 0; i < n; i++) {
    events.push({
      event_id: `e${i}`,
      loop_id: `loop-${i}`,
      domain: 'code',
      selected_validators: ['v1'],
      selection_features: {
        v1: { domain: 0.8, rep: 0.7, load: 0.3, accuracy: 0.75 },
      },
      verdicts: { v1: 'confirmed' },
      outcome: {
        burned: i % 3 === 0,
        reversed: false,
        verdict_truth: 'confirmed',
        derived_from_candidate_weights: !!opts.derived,
      },
    });
  }
  return events;
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'vwlab-'));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('no-data failure', () => {
  it('classifies a missing file as absent and fails closed', () => {
    const report = buildReport(join(dir, 'does-not-exist.json'), baseCfg);
    expect(report.dataset.source_classification).toBe('absent');
    expect(report.dataset.dataset_hash).toBeNull();
    expect(report.recommendation).toBe('insufficient_evidence');
    expect(report.claims_validation).toBe(false);
    expect(report.writes_production_weights).toBe(false);
  });
});

describe('source classification', () => {
  it('reads test_fixture from the manifest, never guessed', () => {
    const loaded = loadDataset(FIXTURE);
    expect(loaded.classification).toBe('test_fixture');
  });

  it('reads simulation and production_historical from the manifest', () => {
    const sim = writeDataset('sim.json', {
      manifest: { dataset_id: 'sim-1', source: 'simulation', generated_at: 'now' },
      events: makeEvents(6),
    });
    const prod = writeDataset('prod.json', {
      manifest: { dataset_id: 'prod-1', source: 'production_historical', generated_at: 'now' },
      events: makeEvents(6),
    });
    expect(loadDataset(sim).classification).toBe('simulation');
    expect(loadDataset(prod).classification).toBe('production_historical');
  });

  it('rejects a present dataset with an unlabeled or unknown source', () => {
    const bad = writeDataset('bad-source.json', {
      manifest: { dataset_id: 'x', source: 'mystery', generated_at: 'now' },
      events: [],
    });
    expect(() => loadDataset(bad)).toThrow(DatasetError);
    // fails closed as a report
    const report = buildReport(bad, baseCfg);
    expect(report.recommendation).toBe('insufficient_evidence');
  });
});

describe('provenance and hash', () => {
  it('carries a deterministic sha256 of the file bytes', () => {
    const a = loadDataset(FIXTURE);
    const b = loadDataset(FIXTURE);
    expect(a.dataset_hash).toBe(b.dataset_hash);
    expect(a.dataset_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.dataset_id).toBe('sample-fixture-001');
  });

  it('changes the hash when the bytes change', () => {
    const p1 = writeDataset('h1.json', {
      manifest: { dataset_id: 'h', source: 'test_fixture', generated_at: 'now' },
      events: makeEvents(1),
    });
    const p2 = writeDataset('h2.json', {
      manifest: { dataset_id: 'h', source: 'test_fixture', generated_at: 'now' },
      events: makeEvents(2),
    });
    expect(loadDataset(p1).dataset_hash).not.toBe(loadDataset(p2).dataset_hash);
    expect(sha256Hex('a')).not.toBe(sha256Hex('b'));
  });
});

describe('train and holdout separation', () => {
  it('partitions events deterministically into both splits', () => {
    const p = writeDataset('split.json', {
      manifest: { dataset_id: 's', source: 'production_historical', generated_at: 'now' },
      events: makeEvents(40),
    });
    const report = buildReport(p, { ...baseCfg, minAdmissibleSamples: 1 });
    const ev = report.evaluation!;
    expect(ev.holdout_fraction).toBe(0.3);
    expect(ev.train.event_count).toBeGreaterThan(0);
    expect(ev.holdout.event_count).toBeGreaterThan(0);
    expect(ev.train.event_count + ev.holdout.event_count).toBe(40);
    expect(ev.split_method).toContain('deterministic');
  });

  it('fails closed when no holdout fraction is supplied', () => {
    const p = writeDataset('nosplit.json', {
      manifest: { dataset_id: 's', source: 'production_historical', generated_at: 'now' },
      events: makeEvents(40),
    });
    const cfg = { ...baseCfg };
    delete (cfg as Partial<EvaluationConfig>).holdoutFraction;
    const report = buildReport(p, cfg);
    expect(report.recommendation).toBe('insufficient_evidence');
  });
});

describe('circularity rejection', () => {
  it('rejects when outcomes are derived from the candidate weights', () => {
    const p = writeDataset('circular.json', {
      manifest: { dataset_id: 'c', source: 'production_historical', generated_at: 'now' },
      events: makeEvents(10, { derived: true }),
    });
    const report = buildReport(p, { ...baseCfg, minAdmissibleSamples: 1 });
    expect(report.evaluation!.integrity.circularity_detected).toBe(true);
    expect(report.recommendation).toBe('reject');
  });
});

describe('bounded update enforcement', () => {
  it('rejects a candidate that exceeds the per-factor bound', () => {
    const p = writeDataset('bound.json', {
      manifest: { dataset_id: 'b', source: 'production_historical', generated_at: 'now' },
      events: makeEvents(10),
    });
    const cfg: EvaluationConfig = {
      ...baseCfg,
      candidateWeights: { domain: 0.9, rep: 0.3, load: 0.15, accuracy: 0.2 },
      priorWeights: { domain: 0.35, rep: 0.3, load: 0.15, accuracy: 0.2 },
      maxAbsFactorDelta: 0.1,
      minAdmissibleSamples: 1,
    };
    const report = buildReport(p, cfg);
    expect(report.evaluation!.integrity.bounded_update_ok).toBe(false);
    expect(report.recommendation).toBe('reject');
  });

  it('cannot certify an update when a prior is given without a bound', () => {
    const p = writeDataset('nobound.json', {
      manifest: { dataset_id: 'nb', source: 'production_historical', generated_at: 'now' },
      events: makeEvents(10),
    });
    const cfg: EvaluationConfig = { ...baseCfg, minAdmissibleSamples: 1 };
    delete (cfg as Partial<EvaluationConfig>).maxAbsFactorDelta;
    const report = buildReport(p, cfg);
    expect(report.recommendation).toBe('insufficient_evidence');
  });
});

describe('report recommendation status', () => {
  it('caps fixture data at shadow_only and never claims validation', () => {
    const report = buildReport(FIXTURE, { ...baseCfg, minAdmissibleSamples: 4 });
    expect(report.dataset.source_classification).toBe('test_fixture');
    expect(report.recommendation).toBe('shadow_only');
    expect(report.claims_validation).toBe(false);
  });

  it('returns insufficient_evidence when samples are below the minimum', () => {
    const report = buildReport(FIXTURE, { ...baseCfg, minAdmissibleSamples: 1000 });
    expect(report.recommendation).toBe('insufficient_evidence');
  });

  it('forwards clean production data for review, never adopts it', () => {
    const p = writeDataset('review.json', {
      manifest: { dataset_id: 'r', source: 'production_historical', generated_at: 'now' },
      events: makeEvents(30),
    });
    const report = buildReport(p, { ...baseCfg, minAdmissibleSamples: 5 });
    expect(report.recommendation).toBe('candidate_for_review');
    expect(report.writes_production_weights).toBe(false);
  });

  it('rejects an invalid candidate vector', () => {
    const p = writeDataset('badvec.json', {
      manifest: { dataset_id: 'bv', source: 'production_historical', generated_at: 'now' },
      events: makeEvents(10),
    });
    const cfg = {
      ...baseCfg,
      candidateWeights: { domain: Number.NaN, rep: 0.3, load: 0.1, accuracy: 0.2 },
      minAdmissibleSamples: 1,
    } as EvaluationConfig;
    const report = buildReport(p, cfg);
    expect(report.recommendation).toBe('reject');
  });
});

describe('schema parsing', () => {
  it('parses the shipped fixture without error', () => {
    const loaded = loadDataset(FIXTURE);
    expect(loaded.dataset).not.toBeNull();
    const reparsed = parseDataset(JSON.parse(JSON.stringify(loaded.dataset)));
    expect(reparsed.events.length).toBe(8);
  });
});
