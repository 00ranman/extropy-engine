/**
 *  Tests for the v3.1 observability scaffold.
 *
 *  These tests exercise:
 *
 *    1. selectBackend() environment parsing.
 *    2. DagSubstrateSource throws DagSubstrateNotWiredError on every read.
 *    3. PostgresSource enforces init() before queries.
 *    4. Mesh router mounts and returns the expected 501 + planning shapes.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import express, { type Express } from 'express';
import {
  selectBackend,
  DagSubstrateSource,
  DagSubstrateNotWiredError,
  PostgresSource,
} from '../observability/index.js';
import { createMeshRouter } from '../routes/mesh/index.js';

describe('selectBackend', () => {
  it('defaults to postgres when env is unset', () => {
    expect(selectBackend({})).toBe('postgres');
  });

  it('respects EPISTEMOLOGY_SOURCE=dag-substrate', () => {
    expect(selectBackend({ EPISTEMOLOGY_SOURCE: 'dag-substrate' })).toBe('dag-substrate');
  });

  it('throws on unknown source', () => {
    expect(() => selectBackend({ EPISTEMOLOGY_SOURCE: 'mongo' })).toThrow(/Unknown/);
  });
});

describe('DagSubstrateSource', () => {
  it('init does not throw, reads do', async () => {
    const s = new DagSubstrateSource();
    await s.init();
    await expect(s.listValidationObservations({})).rejects.toBeInstanceOf(
      DagSubstrateNotWiredError,
    );
    await expect(s.computeFalsifiability({})).rejects.toBeInstanceOf(DagSubstrateNotWiredError);
    await expect(s.listValidatorDids({})).rejects.toBeInstanceOf(DagSubstrateNotWiredError);
  });

  it('refuses queries before init', async () => {
    const s = new DagSubstrateSource();
    await expect(s.listValidationObservations({})).rejects.toThrow(/init/);
  });
});

describe('PostgresSource', () => {
  it('refuses queries before init', async () => {
    // We pass a fake pool because init is what would touch it.
    const fakePool = { query: async () => ({ rows: [] }) } as unknown as import('pg').Pool;
    const s = new PostgresSource({ pool: fakePool });
    await expect(s.listValidationObservations({})).rejects.toThrow(/init/);
  });

  it('returns empty placeholders after init', async () => {
    const fakePool = { query: async () => ({ rows: [] }) } as unknown as import('pg').Pool;
    const s = new PostgresSource({ pool: fakePool });
    await s.init();
    expect(await s.listValidationObservations({})).toEqual([]);
    expect(await s.getClaimConsensus('claim-1' as never)).toBeNull();
    const stat = await s.computeFalsifiability({});
    expect(stat.score).toBe(0);
    expect(stat.claimCount).toBe(0);
  });
});

describe('mesh router', () => {
  let app: Express;
  let baseUrl: string;
  let server: ReturnType<Express['listen']>;

  beforeAll(async () => {
    const fakePool = { query: async () => ({ rows: [] }) } as unknown as import('pg').Pool;
    const source = new PostgresSource({ pool: fakePool });
    await source.init();
    app = express();
    app.use(express.json());
    app.use('/mesh', createMeshRouter({ source }));

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('no address');
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  it('reports the active source kind', async () => {
    const r = await fetch(`${baseUrl}/mesh/source`);
    expect(r.status).toBe(200);
    const json = await r.json();
    expect(json.kind).toBe('postgres');
  });

  it('returns 501 with planning info for unimplemented endpoints', async () => {
    const consensus = await fetch(`${baseUrl}/mesh/consensus/claim-1`);
    expect(consensus.status).toBe(501);
    const consensusJson = await consensus.json();
    expect(consensusJson.planned).toBe('commit 2');
    expect(consensusJson.sourceMethod).toBe('getClaimConsensus');

    const sybil = await fetch(`${baseUrl}/mesh/sybil/rank`);
    expect(sybil.status).toBe(501);
    const sybilJson = await sybil.json();
    expect(sybilJson.planned).toBe('commit 3');
  });
});
