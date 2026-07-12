/**
 * Dataset loading, hashing, and source classification.
 *
 * Provenance is mandatory. Every report carries the dataset identity and a
 * content hash so an analysis can be tied to the exact bytes it ran on.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseDataset, type Dataset, type SourceClassification, DatasetError } from './schema.js';

export interface LoadedDataset {
  /** 'absent' when no file was found; otherwise the declared source. */
  classification: SourceClassification;
  /** sha256 of the exact file bytes, or null when absent. */
  dataset_hash: string | null;
  /** dataset id from the manifest, or null when absent. */
  dataset_id: string | null;
  /** Parsed dataset, or null when absent. */
  dataset: Dataset | null;
  /** Absolute or relative path the loader was pointed at. */
  path: string;
}

export function sha256Hex(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Load a dataset from a path. A missing file is not an error: it is the
 * 'absent' classification, which the harness treats as fail-closed with an
 * insufficient-evidence outcome. A present but malformed file is a
 * DatasetError, because a present dataset must be well formed and must
 * declare its own source.
 */
export function loadDataset(path: string): LoadedDataset {
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return {
        classification: 'absent',
        dataset_hash: null,
        dataset_id: null,
        dataset: null,
        path,
      };
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new DatasetError(`dataset at ${path} is not valid JSON`);
  }

  const dataset = parseDataset(parsed);
  return {
    classification: dataset.manifest.source,
    dataset_hash: sha256Hex(bytes),
    dataset_id: dataset.manifest.dataset_id,
    dataset,
    path,
  };
}
