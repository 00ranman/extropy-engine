/**
 * SignalFlow packager — the only router.
 * Faces call this. They do not mint. They do not score themselves.
 */

import {
  computeXP,
  computeTimestampDecay,
  sparkTill,
  type LocalStandingInputs,
  type TillSparkResult,
} from '@extropy/xp-formula';
import { lookSlice, type LookSlice } from '@extropy/validation-neighborhoods';

export type FaceId = 'localflow' | 'homeflow' | 'quest-market' | 'merchant-till';

export interface ClassStrip {
  class: string;
  mapper: string;
  deltaS: number;
  U: number;
  buckets: string[];
  evidence_root: string;
  state: 'open' | 'closed' | 'failed';
  parents: string[];
}

export interface PackagedClaim {
  face: FaceId;
  strip: ClassStrip;
  identityBound: true;
  sealed: true;
  proposedDeltaS: number;
  look: LookSlice;
}

const CLASS_PRIORS: Record<string, number> = {
  'errand.ride': 0.4,
  'errand.grocery': 0.35,
  'home.chore': 0.3,
  'home.automation.thermo': 0.3,
  'quest.micro': 0.2,
  'till.sale': 0,
};

export function proposeDeltaS(actionClass: string, instrument?: number): number {
  if (typeof instrument === 'number' && instrument > 0) return instrument;
  return CLASS_PRIORS[actionClass] ?? 0.25;
}

export function packageClaim(input: {
  face: FaceId;
  class: string;
  evidenceRoot?: string;
  parents?: string[];
  instrumentDeltaS?: number;
}): PackagedClaim {
  const proposedDeltaS = proposeDeltaS(input.class, input.instrumentDeltaS);
  return {
    face: input.face,
    strip: {
      class: input.class,
      mapper: 'signalflow.v1',
      deltaS: proposedDeltaS,
      U: 0.5,
      buckets: [input.class.split('.')[0] ?? input.class],
      evidence_root: input.evidenceRoot ?? '',
      state: 'open',
      parents: input.parents ?? [],
    },
    identityBound: true,
    sealed: true,
    proposedDeltaS,
    look: lookSlice(),
  };
}

export type CloseResult =
  | { minted: false; reason: string; xp: 0 }
  | { minted: true; xp: number; Ts: number; look: LookSlice };

export function closeLoop(
  claim: PackagedClaim,
  edges: {
    bothSigned: boolean;
    deltaTSeconds: number;
    R?: number;
    F?: number;
    w?: number[];
    E?: number[];
  },
): CloseResult {
  if (!edges.bothSigned) {
    return { minted: false, reason: 'fail-closed: both edges', xp: 0 };
  }
  if (claim.proposedDeltaS <= 0) {
    return { minted: false, reason: 'fail-closed: deltaS', xp: 0 };
  }
  const Ts = computeTimestampDecay(edges.deltaTSeconds);
  const w = edges.w ?? [1];
  const E = edges.E ?? [1];
  const result = computeXP({
    R: edges.R ?? 1,
    F: edges.F ?? 1,
    deltaS: claim.proposedDeltaS,
    w,
    E,
    Ts,
  });
  if (!result.valid || result.xp <= 0) {
    return { minted: false, reason: result.reason ?? 'fail-closed: mint', xp: 0 };
  }
  return { minted: true, xp: result.xp, Ts, look: claim.look };
}

export function tillSpark(xp: number, standing: LocalStandingInputs): TillSparkResult {
  return sparkTill(xp, standing);
}

export { lookSlice };
