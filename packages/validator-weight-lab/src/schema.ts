/**
 * Dataset schema for the validator-weight analysis harness (gap 14).
 *
 * This is a prototype schema for offline analysis. It is not a protocol
 * contract and it is not adopted production behavior. See README.md.
 *
 * The harness reads an explicit event dataset and must be able to tell,
 * from the dataset itself, what kind of data it is looking at. Source is
 * declared in the manifest and is never guessed from content.
 */

/** How a dataset classifies its own origin. Declared, not inferred. */
export type SourceClassification =
  | 'production_historical'
  | 'test_fixture'
  | 'simulation'
  | 'absent';

/** The declared source values a present dataset may carry. */
export const DECLARABLE_SOURCES: readonly SourceClassification[] = [
  'production_historical',
  'test_fixture',
  'simulation',
];

/** Canonical domains. Mirrors EntropyDomain in @extropy/contracts. */
export type Domain =
  | 'cognitive'
  | 'code'
  | 'social'
  | 'economic'
  | 'thermodynamic'
  | 'informational'
  | 'governance'
  | 'temporal';

/**
 * The four validator-selection factors named in gap 14:
 * domain fit, reputation, load, and historical accuracy.
 * These are analysis inputs, not production weights.
 */
export interface WeightVector {
  domain: number;
  rep: number;
  load: number;
  accuracy: number;
}

export const WEIGHT_FACTORS: readonly (keyof WeightVector)[] = [
  'domain',
  'rep',
  'load',
  'accuracy',
];

/** Per-validator selection features for one loop event. */
export interface SelectionFeatures {
  domain: number;
  rep: number;
  load: number;
  accuracy: number;
}

/**
 * An independent outcome for a loop. These are the signals the harness
 * evaluates a candidate weight vector against. They must be independent
 * of the candidate weights.
 *
 * `derived_from_candidate_weights` is a mandatory honesty flag. If an
 * outcome was itself produced by applying the candidate weights, it is
 * inadmissible and triggers circularity rejection.
 */
export interface LoopOutcome {
  /** Retroactive burn of the mint (PROTOCOL.md section 9). */
  burned: boolean;
  /** Reversal recorded downstream. */
  reversed: boolean;
  /**
   * Optional adjudicated held-out verdict truth for accuracy scoring.
   * Absent means accuracy is not scorable for this event.
   */
  verdict_truth?: 'confirmed' | 'denied' | 'insufficient_evidence' | 'undecidable';
  /** Honesty flag. True poisons the outcome as circular evidence. */
  derived_from_candidate_weights: boolean;
}

/** One recorded loop event with the validators that were selected. */
export interface LoopEvent {
  event_id: string;
  loop_id: string;
  domain: Domain;
  /** Validators selected for this loop. */
  selected_validators: string[];
  /** Selection features per validator id. */
  selection_features: Record<string, SelectionFeatures>;
  /** Optional per-validator verdicts, for held-out accuracy scoring. */
  verdicts?: Record<string, 'confirmed' | 'denied' | 'insufficient_evidence' | 'undecidable'>;
  outcome: LoopOutcome;
}

export interface DatasetManifest {
  dataset_id: string;
  source: 'production_historical' | 'test_fixture' | 'simulation';
  generated_at: string;
  notes?: string;
}

export interface Dataset {
  manifest: DatasetManifest;
  events: LoopEvent[];
}

/** Raised when a present file is not a well-formed dataset. */
export class DatasetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatasetError';
  }
}

function isFiniteNumber(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

function assertFeatures(where: string, f: unknown): SelectionFeatures {
  if (typeof f !== 'object' || f === null) {
    throw new DatasetError(`${where}: selection features must be an object`);
  }
  const rec = f as Record<string, unknown>;
  for (const k of WEIGHT_FACTORS) {
    if (!isFiniteNumber(rec[k])) {
      throw new DatasetError(`${where}: feature '${k}' must be a finite number`);
    }
  }
  return {
    domain: rec.domain as number,
    rep: rec.rep as number,
    load: rec.load as number,
    accuracy: rec.accuracy as number,
  };
}

/**
 * Parse and validate raw JSON into a Dataset. Throws DatasetError on any
 * structural problem. The source field must be one of the declarable
 * values; an unlabeled or unknown source is rejected, never guessed.
 */
export function parseDataset(raw: unknown): Dataset {
  if (typeof raw !== 'object' || raw === null) {
    throw new DatasetError('dataset must be a JSON object');
  }
  const obj = raw as Record<string, unknown>;
  const manifest = obj.manifest as Record<string, unknown> | undefined;
  if (!manifest || typeof manifest !== 'object') {
    throw new DatasetError('dataset.manifest is required');
  }
  if (typeof manifest.dataset_id !== 'string' || manifest.dataset_id.length === 0) {
    throw new DatasetError('manifest.dataset_id must be a non-empty string');
  }
  const source = manifest.source;
  if (
    typeof source !== 'string' ||
    !DECLARABLE_SOURCES.includes(source as SourceClassification)
  ) {
    throw new DatasetError(
      `manifest.source must be one of ${DECLARABLE_SOURCES.join(', ')}; a present dataset must declare its source and it is never guessed`,
    );
  }
  if (typeof manifest.generated_at !== 'string') {
    throw new DatasetError('manifest.generated_at must be a string');
  }
  if (!Array.isArray(obj.events)) {
    throw new DatasetError('dataset.events must be an array');
  }

  const events: LoopEvent[] = obj.events.map((e, i) => {
    const where = `events[${i}]`;
    if (typeof e !== 'object' || e === null) {
      throw new DatasetError(`${where} must be an object`);
    }
    const ev = e as Record<string, unknown>;
    if (typeof ev.event_id !== 'string') throw new DatasetError(`${where}.event_id required`);
    if (typeof ev.loop_id !== 'string') throw new DatasetError(`${where}.loop_id required`);
    if (typeof ev.domain !== 'string') throw new DatasetError(`${where}.domain required`);
    if (!Array.isArray(ev.selected_validators)) {
      throw new DatasetError(`${where}.selected_validators must be an array`);
    }
    const sf = ev.selection_features as Record<string, unknown> | undefined;
    if (!sf || typeof sf !== 'object') {
      throw new DatasetError(`${where}.selection_features must be an object`);
    }
    const features: Record<string, SelectionFeatures> = {};
    for (const vid of Object.keys(sf)) {
      features[vid] = assertFeatures(`${where}.selection_features['${vid}']`, sf[vid]);
    }
    const outcomeRaw = ev.outcome as Record<string, unknown> | undefined;
    if (!outcomeRaw || typeof outcomeRaw !== 'object') {
      throw new DatasetError(`${where}.outcome must be an object`);
    }
    if (typeof outcomeRaw.burned !== 'boolean') {
      throw new DatasetError(`${where}.outcome.burned must be a boolean`);
    }
    if (typeof outcomeRaw.reversed !== 'boolean') {
      throw new DatasetError(`${where}.outcome.reversed must be a boolean`);
    }
    if (typeof outcomeRaw.derived_from_candidate_weights !== 'boolean') {
      throw new DatasetError(
        `${where}.outcome.derived_from_candidate_weights must be a boolean (honesty flag for circularity detection)`,
      );
    }
    const outcome: LoopOutcome = {
      burned: outcomeRaw.burned,
      reversed: outcomeRaw.reversed,
      derived_from_candidate_weights: outcomeRaw.derived_from_candidate_weights,
    };
    if (typeof outcomeRaw.verdict_truth === 'string') {
      outcome.verdict_truth = outcomeRaw.verdict_truth as LoopOutcome['verdict_truth'];
    }
    const event: LoopEvent = {
      event_id: ev.event_id,
      loop_id: ev.loop_id,
      domain: ev.domain as Domain,
      selected_validators: ev.selected_validators as string[],
      selection_features: features,
      outcome,
    };
    if (ev.verdicts && typeof ev.verdicts === 'object') {
      event.verdicts = ev.verdicts as LoopEvent['verdicts'];
    }
    return event;
  });

  return {
    manifest: {
      dataset_id: manifest.dataset_id,
      source: source as DatasetManifest['source'],
      generated_at: manifest.generated_at,
      notes: typeof manifest.notes === 'string' ? manifest.notes : undefined,
    },
    events,
  };
}
