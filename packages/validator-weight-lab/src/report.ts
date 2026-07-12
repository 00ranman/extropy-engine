/**
 * Report assembly for the validator-weight harness.
 *
 * The report is advisory and reversible. It never writes production weights.
 * The recommendation status is deliberately conservative and fails closed:
 * the harness never returns an "adopt" status, and it never claims
 * validation from fixture or simulation data.
 */

import { loadDataset, type LoadedDataset } from './provenance.js';
import { evaluate, type EvaluationConfig, type EvaluationResult } from './evaluate.js';
import { DatasetError, type SourceClassification, type WeightVector } from './schema.js';

export type RecommendationStatus =
  | 'insufficient_evidence'
  | 'shadow_only'
  | 'candidate_for_review'
  | 'reject';

export interface Report {
  generated_at: string;
  dataset: {
    path: string;
    dataset_id: string | null;
    dataset_hash: string | null;
    source_classification: SourceClassification;
  };
  prior_weights: WeightVector | null;
  candidate_weights: WeightVector;
  min_admissible_samples: number | null;
  evaluation: EvaluationResult | null;
  recommendation: RecommendationStatus;
  reasons: string[];
  claims_validation: false;
  writes_production_weights: false;
}

function decide(
  loaded: LoadedDataset,
  evalResult: EvaluationResult | null,
  cfg: EvaluationConfig,
): { status: RecommendationStatus; reasons: string[] } {
  const reasons: string[] = [];

  if (loaded.classification === 'absent') {
    reasons.push('no dataset file found at the given path; fail closed');
    return { status: 'insufficient_evidence', reasons };
  }
  if (!evalResult) {
    reasons.push('evaluation could not be performed');
    return { status: 'insufficient_evidence', reasons };
  }

  const integ = evalResult.integrity;

  if (!integ.candidate_vector_valid) {
    reasons.push('candidate weight vector is not a finite four-factor vector');
    return { status: 'reject', reasons };
  }
  if (integ.circularity_detected) {
    reasons.push(
      `${integ.circular_events} event(s) carry outcomes derived from the candidate weights; circular evidence is inadmissible`,
    );
    return { status: 'reject', reasons };
  }
  if (integ.bounded_update_checked && !integ.bounded_update_ok) {
    reasons.push('candidate exceeds the caller-supplied per-factor update bound');
    return { status: 'reject', reasons };
  }
  if (cfg.priorWeights && !integ.bounded_update_checked) {
    reasons.push(
      'a prior weight vector was supplied but no maxAbsFactorDelta bound was given; the update cannot be certified as bounded',
    );
    return { status: 'insufficient_evidence', reasons };
  }
  if (evalResult.holdout_fraction === null) {
    reasons.push('no holdout fraction supplied; train and holdout separation was not performed');
    return { status: 'insufficient_evidence', reasons };
  }
  if (typeof cfg.minAdmissibleSamples !== 'number') {
    reasons.push(
      'no minAdmissibleSamples threshold supplied; evidence sufficiency cannot be certified',
    );
    return { status: 'insufficient_evidence', reasons };
  }
  if (evalResult.total_admissible_samples < cfg.minAdmissibleSamples) {
    reasons.push(
      `admissible sample count ${evalResult.total_admissible_samples} is below the required minimum ${cfg.minAdmissibleSamples}`,
    );
    return { status: 'insufficient_evidence', reasons };
  }

  if (loaded.classification === 'production_historical') {
    reasons.push(
      'production historical data with sufficient admissible samples, no circularity, and a bounded update; forwarded for governance review',
    );
    return { status: 'candidate_for_review', reasons };
  }

  // test_fixture or simulation
  reasons.push(
    `dataset source is ${loaded.classification}; this is not production historical evidence and cannot validate a weight change; shadow only`,
  );
  return { status: 'shadow_only', reasons };
}

export function buildReport(path: string, cfg: EvaluationConfig): Report {
  let loaded: LoadedDataset;
  let evalResult: EvaluationResult | null = null;
  const preReasons: string[] = [];

  try {
    loaded = loadDataset(path);
  } catch (err) {
    if (err instanceof DatasetError) {
      // A present but malformed dataset fails closed as insufficient evidence.
      return {
        generated_at: new Date().toISOString(),
        dataset: {
          path,
          dataset_id: null,
          dataset_hash: null,
          source_classification: 'absent',
        },
        prior_weights: cfg.priorWeights ?? null,
        candidate_weights: cfg.candidateWeights,
        min_admissible_samples: cfg.minAdmissibleSamples ?? null,
        evaluation: null,
        recommendation: 'insufficient_evidence',
        reasons: [`dataset is present but malformed: ${err.message}; fail closed`],
        claims_validation: false,
        writes_production_weights: false,
      };
    }
    throw err;
  }

  if (loaded.dataset) {
    evalResult = evaluate(loaded.dataset, cfg);
  } else {
    preReasons.push('dataset absent');
  }

  const { status, reasons } = decide(loaded, evalResult, cfg);

  return {
    generated_at: new Date().toISOString(),
    dataset: {
      path: loaded.path,
      dataset_id: loaded.dataset_id,
      dataset_hash: loaded.dataset_hash,
      source_classification: loaded.classification,
    },
    prior_weights: cfg.priorWeights ?? null,
    candidate_weights: cfg.candidateWeights,
    min_admissible_samples: cfg.minAdmissibleSamples ?? null,
    evaluation: evalResult,
    recommendation: status,
    reasons: [...preReasons, ...reasons],
    claims_validation: false,
    writes_production_weights: false,
  };
}
