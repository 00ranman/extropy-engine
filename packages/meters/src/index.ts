/**
 * @extropy/meters — meter-first facade for CT, EP, L, CAT, IT.
 *
 * All math delegates to @extropy/xp-formula. Do not reimplement.
 * Product apps (GrantFlow / HomeFlow) import this for types + helpers;
 * they never own mint math.
 */

export {
  computeXP,
  computeL,
  computeEP,
  computeIT,
  sparkTill,
  sparkVote,
  leakXP,
  leakCT,
  hCapFromCash,
  clip01,
  DEFAULT_EP_FLOOR,
  CT_MONTHLY_KEEP,
  POCKET_KEEP,
  H_WINDOW_DAYS,
  LEAK_DAYS,
} from '@extropy/xp-formula';

export type {
  XPFormulaInputs,
  XPFormulaResult,
  LocalStandingInputs,
  TillSparkResult,
  VoteSparkResult,
  GovStandingInputs,
} from '@extropy/xp-formula';

export type {
  Did,
  WebId,
  LaneId,
  CTMeter,
  CATRecord,
  LTicketInputs,
  EPSpark,
  ITSpark,
  MeterObject,
} from './types';

export { METER_OBJECTS, DT_IS_NOT_A_BAG } from './types';

import { sparkTill, sparkVote, leakCT } from '@extropy/xp-formula';
import type { LocalStandingInputs, GovStandingInputs } from '@extropy/xp-formula';
import type { CATRecord, CTMeter, EPSpark, ITSpark } from './types';

/** β from active (non-revoked) CAT in the door's required lane; else 1 if no lane required. */
export function betaFromCAT(
  cats: CATRecord[],
  opts: { lane?: string } = {},
): number {
  const active = cats.filter((c) => !c.revokedAt);
  if (!opts.lane) return 1;
  return active.some((c) => c.lane === opts.lane) ? 1 : 0;
}

/** Credit CT after successful loop close — never from a failed/rejected loop. */
export function creditCT(meter: CTMeter, delta: number, atIso: string): CTMeter {
  if (!(delta > 0)) return meter;
  return {
    ...meter,
    value: Math.max(0, meter.value + delta),
    updatedAt: atIso,
  };
}

/** Apply idle leak to CT (n = idle 10-day counts). */
export function applyCTLeak(meter: CTMeter, idlePeriods: number, atIso: string): CTMeter {
  return {
    ...meter,
    value: leakCT(meter.value, idlePeriods),
    updatedAt: atIso,
  };
}

/** Build EP spark from XP + standing. Caller must not persist as a transferable balance. */
export function mintEPSpark(xp: number, standing: LocalStandingInputs): EPSpark {
  const result = sparkTill(xp, standing);
  return { kind: 'EP', xp, L: result.L, EP: result.EP, burned: true };
}

/** Build IT spark for one proposal. Burns in tally. */
export function mintITSpark(gov: GovStandingInputs): ITSpark {
  const result = sparkVote(gov);
  return { kind: 'IT', IT: result.IT, burned: true };
}

/** Fail-closed gate: only mint XP / credit meters when loop closed successfully. */
export function mayMintMeters(loop: {
  status: string;
  bothEdgesSigned?: boolean;
  quorumMet?: boolean;
}): boolean {
  if (loop.status !== 'closed' && loop.status !== 'closed_success') return false;
  if (loop.bothEdgesSigned === false) return false;
  if (loop.quorumMet === false) return false;
  return true;
}

export function describeMeterLoop(): string {
  return [
    'claim → route → both-edges verify → consensus close',
    '→ mint XP → credit CT → spark EP (L) → CAT→β → spark IT → leak',
  ].join(' ');
}
