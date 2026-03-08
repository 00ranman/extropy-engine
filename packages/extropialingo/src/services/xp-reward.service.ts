/**
 * @service XPRewardService
 * Physics-based XP reward calculator for ExtroPiaLingo.
 *
 * Computes XP for language learning activities using the canonical
 * Extropy formula: XP = R × F × ΔS × (w · E) × log(1/Tₛ)
 */

import { computeXPWithDecay, computeXP } from '@extropy/xp-formula';

export type ExerciseType =
  | 'vocabulary'
  | 'grammar'
  | 'listening'
  | 'speaking'
  | 'writing'
  | 'translation'
  | 'cultural-context';

const EXERCISE_RARITY: Record<ExerciseType, number> = {
  vocabulary: 1.0,
  grammar: 1.2,
  listening: 1.3,
  speaking: 1.5,
  writing: 1.4,
  translation: 1.6,
  'cultural-context': 1.8,
};

const COGNITIVE_LOAD: Record<ExerciseType, number> = {
  vocabulary: 0.4,
  grammar: 0.6,
  listening: 0.5,
  speaking: 0.7,
  writing: 0.8,
  translation: 0.9,
  'cultural-context': 1.0,
};

export interface XPRewardInput {
  exerciseType: ExerciseType;
  /** Verified entropy reduction from completing this exercise [0, 1] */
  entropyDelta: number;
  /** Number of times this exercise type attempted this session */
  sessionFrequency: number;
  /** Elapsed seconds since exercise was presented */
  responseTimeSeconds: number;
  /** Optional: override cognitive load */
  cognitiveLoadOverride?: number;
}

export interface XPRewardResult {
  xp: number;
  exerciseType: ExerciseType;
  breakdown: {
    R: number;
    F: number;
    deltaS: number;
    wDotE: number;
    logDecay: number;
  };
}

/**
 * XPRewardService computes physics-based XP for language learning exercises.
 */
export class XPRewardService {
  /**
   * Compute XP for a completed language exercise.
   */
  computeExerciseXP(input: XPRewardInput): XPRewardResult {
    const R = EXERCISE_RARITY[input.exerciseType];
    // Frequency penalty: diminishing returns for repeated exercise types
    const F = 1 / (1 + Math.log1p(input.sessionFrequency - 1));
    const cogLoad = input.cognitiveLoadOverride ?? COGNITIVE_LOAD[input.exerciseType];

    const result = computeXPWithDecay(
      {
        R,
        F,
        deltaS: Math.max(input.entropyDelta, 0.01),
        w: [cogLoad],
        E: [1.0],
      },
      input.responseTimeSeconds
    );

    return {
      xp: result.xp,
      exerciseType: input.exerciseType,
      breakdown: result.breakdown,
    };
  }

  /**
   * Compute streak bonus XP. Consecutive days reduce linguistic entropy faster.
   */
  computeStreakBonus(streakDays: number, baseXP: number): number {
    // Logarithmic streak bonus: bonus = baseXP * 0.1 * log(1 + streak)
    return baseXP * 0.1 * Math.log1p(streakDays);
  }

  /**
   * Compute total session XP including streak bonus.
   */
  computeSessionTotal(rewards: XPRewardResult[], streakDays: number): number {
    const baseTotal = rewards.reduce((sum, r) => sum + r.xp, 0);
    return baseTotal + this.computeStreakBonus(streakDays, baseTotal);
  }
}
