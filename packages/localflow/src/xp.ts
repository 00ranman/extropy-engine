/**
 * LocalFlow does not own mint math. Errands go through SignalFlow.
 */

import { closeLoop, packageClaim, tillSpark } from '@extropy/signalflow';

export function computeLocalflowLoop(input: {
  deltaS: number;
  deltaTSeconds?: number;
  bothSigned?: boolean;
}): { xp: number; ep: number; L: number; minted: boolean } {
  const packed = packageClaim({
    face: 'localflow',
    class: 'errand.ride',
    instrumentDeltaS: input.deltaS,
  });
  const closed = closeLoop(packed, {
    bothSigned: input.bothSigned !== false,
    deltaTSeconds: input.deltaTSeconds ?? 120,
  });
  const xp = closed.minted ? closed.xp : 0;
  const spark = tillSpark(xp, { CT: 1, H_cap: 1, S: 1 });
  return { xp, ep: spark.EP, L: spark.L, minted: closed.minted };
}
