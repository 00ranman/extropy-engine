# @extropy/epistemology-engine

> **v3.1 Redefinition Notice**
>
> This package has been **redefined**, not removed. The name and concept of "epistemology engine" are preserved because they describe what this layer always should have been: an *engine of epistemology*, not a decomposition pipeline.
>
> v3.0 read this service as the place where claim decomposition happens. That reading was wrong. Decomposition is a personal-AI responsibility at the edge — see `architecture/AUTARKY.md` and `docs/SPEC_v3.1.md` §7.
>
> v3.1 recognizes the epistemology engine for what it is: **the mesh's emergent peer-review system**, exposed as an observability and aggregation layer over the network's reputation-weighted validation activity.

---

## What this package is

The `epistemology-engine` is a **mesh observability layer** over the emergent peer-review process that arises when:

- Personal AIs submit falsifiable claims
- Volunteer validators run 1/10th blind slices
- Reputation-weighted consensus forms
- Provisional XP mints, retroactive validation/burn closes the loop

The engine does not perform peer review. **The mesh performs peer review.** This package witnesses, indexes, and surfaces that emergent epistemology so it can be queried, audited, and used by governance.

## What this package is not

- **Not** a decomposition service. Personal AIs decompose claims locally.
- **Not** a truth arbiter. The mesh, running on incentives, decides what holds up.
- **Not** a private world model. The engine indexes only public mesh state.
- **Not** required for claim flow. The mesh runs without it; this package only observes.

## What it does

| Function | Description |
|---|---|
| Validation aggregation | Surfaces consensus drift, dissent clusters, and contested-claim patterns across the DAG |
| Falsifiability statistics | Computes mesh-wide F-distributions per domain, per DFAO, per cycle |
| Reputation graph analysis | Tracks reputation evolution, exposes Sybil-suspicious clusters |
| Emergent ontology surfacing | Detects recurring claim patterns, naming convergence, instrument standardization across DFAOs |
| Governance hooks | Provides queryable surfaces for governance proposals (e.g., "show all claims in domain X with contested validation in last cycle") |
| Goodhart watchdog | Surfaces metric-gaming patterns by correlating XP scores with independently observed outcomes |

## Architectural posture

- **Read-mostly.** Writes only metadata about network state, never new claims.
- **Indexes, does not extend.** Reads from the DAG and reputation graph; doesn't write to them.
- **Stateless under restart.** Can be rebuilt from DAG replay.
- **Multi-instance.** Multiple engines can run independently — no canonical instance, by design.
- **Optional but recommended.** The mesh runs without it; the network is harder to reason about without it.

## Migration from v3.0

The current source code in `src/` still contains v3.0-era decomposition logic (`/claims` POST, sub-claim atomization, Bayesian update endpoints). These endpoints will be:

1. **Phase 1 (v3.1):** Marked deprecated. Continue to function for backwards compatibility. Decomposition responsibility is officially shifted to personal AIs.
2. **Phase 2 (v3.1.x):** New observability endpoints added (`/mesh/consensus`, `/mesh/falsifiability`, `/mesh/sybil-clusters`, `/mesh/ontology-drift`, `/mesh/goodhart-signals`).
3. **Phase 3 (v3.2):** v3.0 decomposition endpoints removed. Engine becomes pure observability + aggregation.

See [`docs/SPEC_v3.1.md`](../../docs/SPEC_v3.1.md) §13.4 for the full redefinition.

## Why this name

The name carries the actual purpose. *Epistemology engine* — an engine that produces (or rather, witnesses the production of) knowledge of what holds up under peer review. v3.0 implemented half the name. v3.1 honors all of it.

## Run

```bash
pnpm --filter @extropy/epistemology-engine dev    # local dev
pnpm --filter @extropy/epistemology-engine build  # production build
```

Port: `4001` (default). See `Dockerfile` for container build.

## Open questions

- Exact aggregation cadence (currently event-driven; periodic snapshot may be required at scale)
- Sybil-cluster surfacing thresholds (governance-tunable)
- Whether the engine should publish derived metadata back to the DAG as its own vertex type, or keep all derived state ephemeral
- Goodhart watchdog formalization — what cross-correlations rise to "intervene" status

These are tracked in [`docs/GAPS.md`](../../docs/GAPS.md).
