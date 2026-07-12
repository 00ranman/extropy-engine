# @extropy/validator-weight-lab

Offline advisory analysis harness for **gap 14** (validator 4-factor weighting:
domain, reputation, load, accuracy). This is a **prototype**, not adopted
production behavior. It is the build recommended by Candidate 2 in
[../../docs/GAP_FEEDBACK_CANDIDATES.md](../../docs/GAP_FEEDBACK_CANDIDATES.md).

## What it does

Given an explicit event dataset and a caller-supplied candidate weight vector,
the harness evaluates that vector against **independent outcomes** (retroactive
burns, reversals, and held-out adjudicated verdict accuracy) with train and
holdout separation, and emits a provenance-carrying report.

## What it will not do

- It will **not** write production weights. The report is advisory and reversible.
- It will **not** invent production defaults. Every bound, sufficiency minimum,
  and split fraction is caller-supplied. There is no built-in optimizer, so there
  is no invented objective.
- It will **not** claim validation from fixture or simulation data. Those sources
  are capped at a `shadow_only` recommendation.
- It will **not** report success when there is no real historical dataset. A
  missing dataset classifies as `absent` and the report fails closed with
  `insufficient_evidence`.

## Dataset schema

A dataset is a JSON object with a `manifest` and an `events` array. The manifest
must declare its own `source`; the source is never guessed from content.

```
{
  "manifest": {
    "dataset_id": "string, required",
    "source": "production_historical | test_fixture | simulation",
    "generated_at": "ISO timestamp",
    "notes": "optional"
  },
  "events": [
    {
      "event_id": "string",
      "loop_id": "string",
      "domain": "one of the 8 canonical domains",
      "selected_validators": ["validatorId", "..."],
      "selection_features": {
        "validatorId": { "domain": 0.0, "rep": 0.0, "load": 0.0, "accuracy": 0.0 }
      },
      "verdicts": { "validatorId": "confirmed | denied | insufficient_evidence | undecidable" },
      "outcome": {
        "burned": false,
        "reversed": false,
        "verdict_truth": "optional adjudicated held-out truth",
        "derived_from_candidate_weights": false
      }
    }
  ]
}
```

`outcome.derived_from_candidate_weights` is a mandatory honesty flag. If any
admissible outcome was itself produced by applying the candidate weights, the
evidence is circular and the report is `reject`.

## Source classification (four values)

- `production_historical`: a real export from the running substrate.
- `test_fixture`: hand-written or synthetic data for exercising the harness.
- `simulation`: model-generated data.
- `absent`: no dataset file was found. Fails closed.

The report never conflates these. A simulation or fixture cannot be called
historical evidence.

## Recommendation statuses

- `insufficient_evidence`: absent data, missing required config, or too few
  admissible samples. Fail closed.
- `reject`: invalid candidate vector, circular evidence, or a candidate that
  exceeds the caller-supplied per-factor update bound.
- `shadow_only`: fixture or simulation data. Run in shadow, do not affect
  production. Cannot claim validation.
- `candidate_for_review`: production historical data with sufficient admissible
  samples, no circularity, and a bounded update. Forwarded for governance
  review. This is the highest status the harness returns; it never adopts.

## Running it

Install workspace dependencies once from the repo root, then run the harness
from this package directory.

Against the shipped fixture (demonstration only, cannot validate anything):

```
pnpm --filter @extropy/validator-weight-lab exec tsx src/cli.ts \
  --data fixtures/sample-fixture.json \
  --config fixtures/example-config.json \
  --out /tmp/validator-weight-report.json
```

The values in `fixtures/example-config.json` are illustrative analysis
parameters for the demo, not adopted production defaults.

### Against a future real export

When a real historical export exists, point `--data` at it. The export must
declare `"source": "production_historical"` in its manifest. Supply a config
with the candidate vector, the current production vector as `priorWeights`, a
governance-decided `maxAbsFactorDelta` bound, a governance-decided
`minAdmissibleSamples` threshold, and a `holdoutFraction`:

```
pnpm --filter @extropy/validator-weight-lab exec tsx src/cli.ts \
  --data /path/to/production-export.json \
  --config /path/to/governance-config.json \
  --out /path/to/report.json
```

Exit code is 0 whenever a report is produced. A produced report may still say
`insufficient_evidence` or `reject`; that is the expected fail-closed outcome,
not a harness error.

## Tests

```
pnpm --filter @extropy/validator-weight-lab test
```

Covers no-data failure, source classification, provenance and hash, train and
holdout separation, circularity rejection, bounded update enforcement, and the
report status transitions.

## Status

Prototype for gap 14. Not adopted protocol. See
[../../docs/GAPS.md](../../docs/GAPS.md) and
[../../docs/GAP_FEEDBACK_CANDIDATES.md](../../docs/GAP_FEEDBACK_CANDIDATES.md).
The calibration-lifecycle architecture for gap 23 is a separate, normative
document at [../../docs/CALIBRATION_LIFECYCLE.md](../../docs/CALIBRATION_LIFECYCLE.md).
