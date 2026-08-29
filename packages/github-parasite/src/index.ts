/**
 * @package @extropy/github-parasite
 *
 * SCAFFOLD (v0.1). Not runtime yet.
 *
 * GitHub App overlay that emits Extropy loop events from PR / review / CI
 * webhooks. Downstream substrate mints XP through @extropy/xp-formula.
 *
 * Non-extraction invariant (see docs/NON_EXTRACTION.md):
 *   - Emits evidence events only. Never returns a transferable claim.
 *   - No balance endpoint. No withdrawal endpoint.
 *   - Contribution ratio ρ is the only reciprocity signal.
 */

import type { XPFormulaInputs } from '@extropy/contracts';
import { FORMULA_VERSION } from '@extropy/xp-formula';

/** GitHub webhook events this package will subscribe to. v0.1 planning list. */
export const SUBSCRIBED_EVENTS = [
  'pull_request',           // .closed with merged=true → open code-contribution loop
  'pull_request_review',    // .submitted → validator verdict
  'check_suite',            // .completed → tamper-evident CI evidence
  'push',                   // fallback signal for direct-to-branch commits
] as const;

export type SubscribedEvent = (typeof SUBSCRIBED_EVENTS)[number];

/**
 * A minimal PR-merge fact from a GitHub webhook, projected onto the
 * fields the Extropy substrate cares about. All fields except `evidence`
 * are directly evidence-verifiable by any validator with GitHub API read
 * access to the host repo.
 */
export interface MergedPRFact {
  repoFullName: string;             // owner/name
  prNumber: number;
  headSha: string;
  baseSha: string;
  authorActorId: string;            // resolved by identity layer, not raw GitHub login
  openedAtIso: string;
  mergedAtIso: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  reviews: ReviewFact[];
  ciCheckSuiteConclusion: 'success' | 'failure' | 'neutral' | 'cancelled' | 'skipped' | 'timed_out' | 'action_required' | 'startup_failure' | 'stale' | null;
  languageBreakdownAdds: Record<string, number>;
  languageBreakdownDels: Record<string, number>;
}

export interface ReviewFact {
  reviewerActorId: string;
  state: 'approved' | 'changes_requested' | 'commented' | 'dismissed' | 'pending';
  submittedAtIso: string;
}

/**
 * ΔS-in-code estimator for the `informational` domain.
 *
 * v0.1: a first-order proxy, not yet a calibrated M_d per NORMALIZATION.md.
 * Additions weighted by language weight, penalised by an anti-inflation
 * factor for very large diffs, minus a bounded credit for deletions (net
 * removal has positive information value only up to a cap).
 *
 * The point of shipping this as a proxy is to surface the calibration
 * problem so that validator disagreement (F3 in NORMALIZATION.md §5) can
 * be measured on real diffs, not on hypothetical ones.
 */
export function estimateDeltaSInBits(fact: MergedPRFact): number {
  const langWeight: Record<string, number> = {
    typescript: 1.0,
    javascript: 0.9,
    python: 1.0,
    rust: 1.1,
    go: 1.0,
    solidity: 1.2,
    markdown: 0.2,
    json: 0.1,
    yaml: 0.15,
  };

  const w = (lang: string): number => langWeight[lang.toLowerCase()] ?? 0.5;

  let raw = 0;
  for (const [lang, n] of Object.entries(fact.languageBreakdownAdds)) {
    raw += w(lang) * n;
  }
  for (const [lang, n] of Object.entries(fact.languageBreakdownDels)) {
    raw += 0.3 * w(lang) * n;
  }

  // Anti-inflation: large diffs are rarely high-information per line.
  // Diminishing-returns cap kicks in above 500 weighted lines.
  const diminished = raw <= 500 ? raw : 500 + Math.log(1 + (raw - 500)) * 50;

  return diminished;
}

/**
 * Placeholder for the outbound event emitter. Actual implementation will
 * publish to the Extropy event bus (see @extropy/contracts EventBus).
 */
export interface ParasiteEmitter {
  loopOpened(input: {
    loopClass: 'code-contribution';
    domain: 'informational';
    authorActorId: string;
    openedAtIso: string;
    evidenceRef: string;                 // content-addressed reference to the PR fact
  }): Promise<void>;

  evidenceAdded(input: {
    prHeadSha: string;
    kind: 'review' | 'ci' | 'merge';
    evidenceRef: string;
  }): Promise<void>;
}

/**
 * v0.1 formula-input builder. Returns the shape the Extropy substrate
 * expects on `LOOP_CLOSED`, letting `xp-mint` route it through
 * `computeXPFromElapsedSeconds` under the informational domain's λ.
 *
 * The substrate is authoritative for R and F; the parasite only reports
 * the ΔS estimate and the elapsed time. This is intentional: the parasite
 * MUST NOT be able to bump its own R.
 */
export function buildLoopClosureReport(fact: MergedPRFact): {
  loopClass: 'code-contribution';
  domain: 'informational';
  deltaS_bits_equivalent: number;
  elapsedSeconds: number;
  formulaVersionExpected: typeof FORMULA_VERSION;
  proposedFormulaInputs: Pick<XPFormulaInputs, 'deltaS'> & { elapsedSeconds: number };
} {
  const elapsedSeconds = Math.max(
    0,
    (new Date(fact.mergedAtIso).getTime() - new Date(fact.openedAtIso).getTime()) / 1000,
  );
  const deltaS = estimateDeltaSInBits(fact);

  return {
    loopClass: 'code-contribution',
    domain: 'informational',
    deltaS_bits_equivalent: deltaS,
    elapsedSeconds,
    formulaVersionExpected: FORMULA_VERSION,
    proposedFormulaInputs: {
      deltaS,
      elapsedSeconds,
    },
  };
}
