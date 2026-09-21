import { describe, expect, it } from 'vitest';
import {
  computeL,
  computeEP,
  computeIT,
  mayMintMeters,
  mintEPSpark,
  mintITSpark,
  betaFromCAT,
  creditCT,
  applyCTLeak,
  DT_IS_NOT_A_BAG,
  describeMeterLoop,
} from './index';
import type { CATRecord, CTMeter } from './types';

describe('meter-first facade', () => {
  it('computeL matches SPEC clip(H_cap·S·κ·CT·β)', () => {
    const L = computeL({ H_cap: 0.5, S: 1, kappa: 1, CT: 1, beta: 1 });
    expect(L).toBeCloseTo(0.5, 6);
  });

  it('computeEP uses XP·L + λ·L', () => {
    const L = 0.5;
    const EP = computeEP(10, L, 0.15);
    expect(EP).toBeCloseTo(10 * 0.5 + 0.15 * 0.5, 6);
  });

  it('EP spark is burned and not a bag', () => {
    const spark = mintEPSpark(8, { H_cap: 0.5, S: 1, kappa: 1, CT: 1, beta: 1 });
    expect(spark.burned).toBe(true);
    expect(spark.kind).toBe('EP');
    expect(spark.L).toBeGreaterThan(0);
  });

  it('IT spark burns in tally', () => {
    const spark = mintITSpark({
      H_gov: 1,
      S_gov: 1,
      kappa: 1,
      CT: 0.8,
      beta_gov: 1,
    });
    expect(spark.burned).toBe(true);
    expect(spark.IT).toBeCloseTo(0.8, 6);
    expect(
      computeIT({ H_gov: 1, S_gov: 1, kappa: 1, CT: 0.8, beta_gov: 1 }),
    ).toBeCloseTo(0.8, 6);
  });

  it('fails closed when quorum missing', () => {
    expect(
      mayMintMeters({ status: 'closed', quorumMet: false, bothEdgesSigned: true }),
    ).toBe(false);
    expect(
      mayMintMeters({ status: 'closed_success', quorumMet: true, bothEdgesSigned: true }),
    ).toBe(true);
  });

  it('CAT feeds beta for a required lane', () => {
    const cats: CATRecord[] = [
      {
        did: 'did:ex:1',
        lane: 'kitchen',
        level: 2,
        issuer: 'did:ex:issuer',
        issuedAt: '2026-01-01T00:00:00Z',
      },
    ];
    expect(betaFromCAT(cats, { lane: 'kitchen' })).toBe(1);
    expect(betaFromCAT(cats, { lane: 'welding' })).toBe(0);
  });

  it('CT credit and leak', () => {
    const m: CTMeter = {
      webId: 'w1',
      did: 'did:ex:1',
      value: 10,
      updatedAt: '2026-01-01T00:00:00Z',
    };
    const credited = creditCT(m, 2, '2026-01-02T00:00:00Z');
    expect(credited.value).toBe(12);
    const leaked = applyCTLeak(credited, 1, '2026-01-12T00:00:00Z');
    expect(leaked.value).toBeLessThan(12);
  });

  it('documents DT is not a bag and meter loop order', () => {
    expect(DT_IS_NOT_A_BAG.toLowerCase()).toContain('not a bag');
    expect(describeMeterLoop()).toContain('mint XP');
    expect(describeMeterLoop()).toContain('credit CT');
  });
});
