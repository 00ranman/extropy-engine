# Extropy Engine — Technical Specification v3.0 (DEPRECATED)

> ⚠️ **DEPRECATED** — superseded by [`SPEC_v3.1.md`](./SPEC_v3.1.md) on 2026-05-01.
>
> v3.0 is preserved here as a historical record. Do not implement against this document.

## Why v3.0 was deprecated

v3.0 framed the architecture around a **central `epistemology-engine`** service that ingested claims, decomposed them into sub-claims, and scored them via Bayesian updating. That reading misunderstood what the engine actually was. The name and the engine are preserved in v3.1, but the engine is recognized for what it always should have been: **the mesh's emergent peer-review system**, observed and aggregated as a witness layer rather than a centralized decomposition service.

The redefinition is not a removal. It is the correction of a reading. Real peer review was never a microservice. Real peer review is what emerges when honest validators with reputation at stake evaluate falsifiable claims under incentive alignment. The mesh, running on incentives alone, *is* the engine. The package now wraps that emergent process with observability and aggregation, not control. See [`SPEC_v3.1.md`](./SPEC_v3.1.md) §13.4 for the full redefinition.

### Specifically, v3.0:

- Centralized claim decomposition in a single network service. This created a hidden ontology-control choke point and violated Digital Autarky.
- Did not specify an identity layer. Sybil resistance was assumed but never operationalized.
- Did not specify a per-node provenance log. Local decision history could not be audited without exposing it.
- Did not commit on the substrate question. The architecture was ambiguous between "build native" and "ship as a hApp on Holochain or another framework."
- Did not surface the micro-quest marketplace as a first-class operational primitive.
- Did not enumerate volunteer micro-validation (1/10th blind slices) as the default validation pattern.

## What v3.1 changes

| Area | v3.0 | v3.1 |
|---|---|---|
| Decomposition | Read as central `epistemology-engine` service | **Personal AI at the edge** (no central decomposition) |
| `epistemology-engine` package | Misread as decomposition pipeline | **Mesh observability + emergent peer-review witness layer** |
| Identity | Unspecified | **Mandatory** OAuth + on-device KYC + ZKP DID |
| Provenance | Implicit | **Personal Signed Local Log (PSLL)** mandatory per node |
| Substrate | Ambiguous | **Native, end-to-end.** Borrows three Holochain patterns, renamed |
| UX/Operations | Generic | **Micro-quest marketplace** with dynamic reward escalation |
| Validation | Validator nodes | **Volunteer 1/10th blind slices** default; validator nodes still supported |
| New services | n/a | `identity/`, `psll-sync/`, `quest-market/`, `validation-neighborhoods/` |
| Redefined services | n/a | `epistemology-engine` (preserved; redefined as mesh observability) |

## Cross-references

- Canonical spec: [`SPEC_v3.1.md`](./SPEC_v3.1.md)
- Migration notes: [`CHANGELOG.md`](./CHANGELOG.md)
- Open gaps inherited and added: [`GAPS.md`](./GAPS.md)

---

*This file is a tombstone. It exists for historical traceability and to catch links from external references that pointed at "v3.0" before the v3.1 cut.*
