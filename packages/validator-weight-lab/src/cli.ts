/**
 * Command line entry for the validator-weight harness.
 *
 * Usage:
 *   tsx src/cli.ts --data <path> --config <path> [--out <path>]
 *
 * The config file is a JSON EvaluationConfig. The candidate weight vector
 * is required. Prior weights, the per-factor bound, the minimum admissible
 * sample count, and the holdout fraction are all caller-supplied; the
 * harness invents none of them. The report is printed to stdout as JSON and
 * optionally written to --out. No production weights are ever written.
 *
 * Exit code is 0 when a report was produced. A produced report may still
 * carry an insufficient_evidence or reject recommendation; that is the
 * expected fail-closed outcome, not a harness error.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { buildReport } from './report.js';
import type { EvaluationConfig } from './evaluate.js';

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

function main(): void {
  const dataPath = arg('--data');
  const configPath = arg('--config');
  const outPath = arg('--out');

  if (!dataPath || !configPath) {
    process.stderr.write(
      'usage: tsx src/cli.ts --data <dataset.json> --config <config.json> [--out <report.json>]\n',
    );
    process.exit(2);
    return;
  }

  const cfg = JSON.parse(readFileSync(configPath, 'utf8')) as EvaluationConfig;
  if (!cfg.candidateWeights) {
    process.stderr.write('config error: candidateWeights is required\n');
    process.exit(2);
    return;
  }

  const report = buildReport(dataPath, cfg);
  const json = JSON.stringify(report, null, 2);
  if (outPath) writeFileSync(outPath, json + '\n');
  process.stdout.write(json + '\n');
  process.stdout.write(`recommendation: ${report.recommendation}\n`);
}

main();
