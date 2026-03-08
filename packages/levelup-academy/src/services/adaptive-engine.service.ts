/**
 * @service AdaptiveEngineService
 * Physics-based adaptive learning engine for LevelUp Academy.
 *
 * Uses Bayesian inference over skill mastery probability and
 * entropy-aware difficulty selection to maximize learning rate.
 * XP awards are computed via @extropy/xp-formula.
 */

import { computeXPWithDecay } from '@extropy/xp-formula';

export interface SkillMastery {
  skillId: string;
  /** Bayesian posterior probability of mastery [0, 1] */
  masteryProb: number;
  /** Number of attempts */
  attempts: number;
  /** Number of successes */
  successes: number;
}

export interface LearningItem {
  id: string;
  skillId: string;
  /** Item difficulty [0, 1] */
  difficulty: number;
  /** Estimated cognitive effort */
  cognitiveLoad: number;
}

export interface AdaptiveRecommendation {
  item: LearningItem;
  reason: string;
  projectedXP: number;
}

/**
 * AdaptiveEngineService selects optimal learning items for a learner
 * based on their current skill mastery and entropy-reduction potential.
 */
export class AdaptiveEngineService {
  /**
   * Update mastery using Bayesian Beta-Binomial update.
   * Prior: Beta(alpha, beta). Posterior after observation.
   */
  updateMastery(
    mastery: SkillMastery,
    correct: boolean
  ): SkillMastery {
    const newSuccesses = mastery.successes + (correct ? 1 : 0);
    const newAttempts = mastery.attempts + 1;
    // Beta-Binomial posterior mean: (alpha + successes) / (alpha + beta + attempts)
    // Using flat prior: alpha=1, beta=1
    const masteryProb = (1 + newSuccesses) / (2 + newAttempts);
    return { ...mastery, masteryProb, successes: newSuccesses, attempts: newAttempts };
  }

  /**
   * Select the optimal next item for a learner given their mastery map.
   * Maximizes information gain (entropy reduction) while staying in the ZPD.
   */
  recommend(
    masteryMap: Map<string, SkillMastery>,
    availableItems: LearningItem[]
  ): AdaptiveRecommendation | null {
    if (availableItems.length === 0) return null;

    let best: LearningItem | null = null;
    let bestScore = -Infinity;

    for (const item of availableItems) {
      const mastery = masteryMap.get(item.skillId);
      const p = mastery?.masteryProb ?? 0.5;
      // Zone of Proximal Development: item difficulty near mastery probability
      const zpd = 1 - Math.abs(item.difficulty - (1 - p));
      // Information gain (entropy reduction): H = -p*log(p) - (1-p)*log(1-p)
      const H = -(p * Math.log(p + 1e-9) + (1 - p) * Math.log(1 - p + 1e-9));
      const score = zpd * H;
      if (score > bestScore) {
        bestScore = score;
        best = item;
      }
    }

    if (!best) return null;

    const mastery = masteryMap.get(best.skillId);
    const deltaS = bestScore; // entropy reduction as ΔS
    const result = computeXPWithDecay(
      { R: 1.0, F: 1.0, deltaS: Math.max(deltaS, 0.01), w: [1.0], E: [best.cognitiveLoad] },
      0 // immediate
    );

    return {
      item: best,
      reason: `ZPD match: mastery=${mastery?.masteryProb?.toFixed(2) ?? '0.50'}, difficulty=${best.difficulty}`,
      projectedXP: result.xp,
    };
  }

  /**
   * Compute XP earned for completing a learning item.
   */
  computeCompletionXP(
    item: LearningItem,
    mastery: SkillMastery,
    elapsedSeconds: number
  ): number {
    const deltaS = 1 - mastery.masteryProb; // entropy reduction proportional to remaining uncertainty
    const result = computeXPWithDecay(
      { R: 1.0, F: 1.0 / (mastery.attempts + 1), deltaS: Math.max(deltaS, 0.01), w: [1.0], E: [item.cognitiveLoad] },
      elapsedSeconds
    );
    return result.xp;
  }
}
