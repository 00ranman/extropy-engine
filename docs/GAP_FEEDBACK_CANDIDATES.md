# Gap Feedback Candidates (Candidate Analysis, Not Adopted Protocol)

Status: **candidate analysis only.** Nothing in this document is adopted protocol. Do not treat any proposal here as a normative requirement. Adoption of any candidate would require its own design document, review, and governance loop.

Purpose: [EMERGENT_EXCHANGE_RATES.md](./EMERGENT_EXCHANGE_RATES.md) applied one recurring mechanism to the cross-domain equivalence defect: replace a hardened proxy, a fixed coefficient, a static threshold, or a central assertion with an observable, bounded, provenance-carrying, reversible corrective-feedback loop. This document inspects [GAPS.md](./GAPS.md) and the architecture docs for other places where the same mechanism might apply, and evaluates each honestly, including whether it would genuinely reduce a gap or merely relocate it.

For each candidate: (1) gap ID or name; (2) current fixed assumption or brittle proxy; (3) proposed emergent variable or loop; (4) independent evidence needed to avoid circularity; (5) halt/revert rule; (6) reduce or relocate; (7) recommendation.

---

## Candidate 1: Gap 8, Cartel threshold (>50% domain rep)

1. **Gap:** 8, cartel threshold formal analysis.
2. **Current fixed assumption:** a static "greater than 50% of domain reputation equals cartel" line. A single hard threshold applied uniformly across domains and time.
3. **Proposed emergent loop:** a per-domain cartel-risk coefficient that tracks observed concentration and coordination signals, held fixed within an epoch and adjusted only through a bounded, quorum-gated repricing, with provenance.
4. **Independent evidence to avoid circularity:** concentration must be estimated from evidence not derived from the same reputation totals the threshold governs. Candidate signals: observed voting-bloc co-movement, outcome diversity, independent audits of identity clustering (gap 47 and I2 in PROTOCOL.md). Using the reputation distribution alone to both define and detect cartels is circular.
5. **Halt/revert rule:** if the coefficient moves without independent corroboration, or concentration data density falls below a declared minimum, freeze the coefficient at its last corroborated value and fall back to the conservative static threshold rather than a looser learned one.
6. **Reduce or relocate:** partially relocates. It moves the problem from "pick the right number" to "measure concentration independently," which is itself hard (Sybil clustering is unsolved, gap 18 and 47). It reduces brittleness but does not create the missing measurement.
7. **Recommendation:** prototype. Do not implement in normative docs until independent concentration measurement exists.

## Candidate 2: Gap 14, Validator 4-factor weighting

1. **Gap:** 14, 4-factor weighting tuning (domain, rep, load, accuracy).
2. **Current fixed assumption:** fixed weights on the four factors, hand-tuned and static.
3. **Proposed emergent loop:** treat the weight vector as a managed float adjusted by observed selection quality per epoch, bounded per epoch, reversible.
4. **Independent evidence to avoid circularity:** selection quality must be measured against outcomes independent of the weights, for example retroactive burn rate of loops the selection admitted (PROTOCOL.md §9), or held-out validator accuracy on adjudicated-truth cases. Tuning weights to maximize a score computed from the same weights is circular.
5. **Halt/revert rule:** if burn-rate or held-out-accuracy signal density is insufficient in an epoch, revert to the last corroborated weight vector; do not adjust on noise.
6. **Reduce or relocate:** genuinely reduces, provided an outcome signal (burn rate) already exists in the protocol. It leans on retroactive validation, which is specified, so it relocates less than Candidate 1.
7. **Recommendation:** prototype, with retroactive-burn outcome as the independent signal.
8. **Status (2026-07-12): prototype built, not adopted production behavior.** An offline analysis harness was added in `packages/validator-weight-lab/`. It reads an explicit event dataset through a documented schema, classifies the dataset source (production historical, test fixture, simulation, or absent), evaluates a candidate weight vector against independent outcomes (retroactive burns, reversals, held-out verdict accuracy) with train and holdout separation, enforces bounded candidate updates symbolically with no invented production defaults, and emits a provenance-carrying advisory report. It fails closed when no real historical dataset exists, never writes production weights, and cannot claim validation from fixtures. This is a prototype for gap 14 in [GAPS.md](./GAPS.md); it is not adopted protocol.

## Candidate 3: Gap 41, IT 5%/mo decay rate

1. **Gap:** 41, IT 5%/mo decay rate validation.
2. **Current fixed assumption:** a fixed 5% per month decay coefficient, asserted rather than derived.
3. **Proposed emergent loop:** a decay coefficient adjusted toward the rate that keeps observed token velocity and hoarding within a governed band, bounded per epoch, reversible.
4. **Independent evidence to avoid circularity:** velocity and hoarding must be measured from actual usage, not from the decay parameter's intended effect. Candidate signals: realized draw/contribution ratios (NON_EXTRACTION.md ρ), threshold-crossing frequency, dormancy distributions.
5. **Halt/revert rule:** if usage data is sparse or an adjustment overshoots the governed band, revert to the last corroborated coefficient. Never let decay accelerate faster than one bounded step per epoch.
6. **Reduce or relocate:** reduces. The independent signal (realized usage) is genuinely exogenous to the coefficient, so circularity is avoidable. Main residual risk is reflexivity: actors may anticipate and game a visible adjustable decay.
7. **Recommendation:** prototype, and study reflexivity before any implementation.

## Candidate 4: Gap 23, Calibration drift detection and auto-replace

1. **Gap:** 23, calibration drift detection plus auto-replace policy.
2. **Current fixed assumption:** an assumed static calibration for each M_d, replaced only by manual intervention.
3. **Proposed emergent loop:** this gap is itself the general form of the mechanism. A calibration that is monitored for drift and corrected through a bounded, provenance-carrying, reversible replace loop.
4. **Independent evidence to avoid circularity:** drift must be detected against independent replicated measurements or persistent-outcome checks, not against the calibration's own prior outputs. This is the same evidence-independence rule as EMERGENT_EXCHANGE_RATES.md §6.
5. **Halt/revert rule:** if drift is detected but corroborating replication is unavailable, halt auto-replace and revert to the last corroborated calibration; escalate to governance.
6. **Reduce or relocate:** reduces if independent replication exists; relocates onto "who supplies independent replication" if it does not. This is the closest structural sibling to the adopted X_d loop.
7. **Recommendation:** prototype in tandem with M_d construction. This is the most natural next application of the mechanism.
8. **Status (2026-07-12): architecture adopted, implementation and external replication open.** Promoted from candidate to adopted architecture in [CALIBRATION_LIFECYCLE.md](./CALIBRATION_LIFECYCLE.md), which specifies the CalibrationRecord schema, the calibration state machine, independent-evidence drift detection, shadow evaluation with bounded replacement, freeze and rollback, and the anti-circularity rule. No code enforces the lifecycle yet and no numeric threshold, bound, or epoch length was set. The "who supplies independent replication" relocation risk is retained honestly as falsifier CF2 in that document. Gap 23 in [GAPS.md](./GAPS.md) remains open (not closed).

## Candidate 5: Gap named by PROTOCOL.md §11, verdict tolerance ε_d

1. **Gap:** ε_d verdict tolerance (PROTOCOL.md §5, §11). Not separately numbered in GAPS.md.
2. **Current fixed assumption:** a fixed per-domain tolerance ε_d deciding when two validator measurements "agree."
3. **Proposed emergent loop:** ε_d adjusted toward the observed reproducibility of the domain's M_d, bounded per epoch, reversible.
4. **Independent evidence to avoid circularity:** reproducibility must come from blind re-measurement by disjoint validator sets on the same evidence, not from the accept-rate that ε_d itself produces. Widening ε_d to raise accept rates and then citing the higher accept rate as justification is circular.
5. **Halt/revert rule:** if blind re-measurement coverage is too thin in an epoch, freeze ε_d; never widen ε_d on an epoch with insufficient independent re-measurement.
6. **Reduce or relocate:** reduces, but with a real hazard: a self-widening tolerance directly weakens falsifier F3 in NORMALIZATION.md (validator disagreement dominating signal). The halt rule must be strict.
7. **Recommendation:** leave alone for now. The downside (masking F3) outweighs the benefit until F3 monitoring is in place.

## Candidate 6: Gap named by PROTOCOL.md §7, settlement floor T_floor

1. **Gap:** T_floor settlement-time floor (PROTOCOL.md §7, GOVERNANCE_DEFAULTS). Default 0.01 was set in v3.1.3 as an anti-speed-farming cap.
2. **Current fixed assumption:** a single global floor coefficient.
3. **Proposed emergent loop:** a per-domain floor adjusted toward each domain's honest median settlement time, bounded, reversible.
4. **Independent evidence to avoid circularity:** honest median settlement must be estimated from loops independently confirmed as legitimate (survived retroactive validation), not from all mints, because gamed fast loops are exactly what the floor is meant to suppress. Estimating the floor from unfiltered timings would relegitimize the attack.
5. **Halt/revert rule:** if confirmed-legitimate settlement data is sparse, revert to the conservative global floor; never lower a domain's floor on thin evidence.
6. **Reduce or relocate:** relocates more than it reduces. The floor exists precisely because timing is gameable; making the floor itself data-driven reintroduces a channel for the same attack unless the independent-legitimacy filter is airtight, which it is not yet (retroactive validation edge cases, gap 32).
7. **Recommendation:** leave alone. The fixed floor is a deliberate safety constant; do not make it emergent until retroactive validation is hardened.

---

## Summary

| Candidate | Reduce or relocate | Recommendation |
| --------- | ------------------ | -------------- |
| 1. Cartel threshold (gap 8) | partially relocates | prototype |
| 2. Validator weighting (gap 14) | reduces | prototype built 2026-07-12, not adopted |
| 3. IT decay rate (gap 41) | reduces | prototype |
| 4. Calibration drift (gap 23) | reduces if replication exists | architecture adopted 2026-07-12, implementation open |
| 5. Verdict tolerance ε_d | reduces but hazards F3 | leave alone |
| 6. Settlement floor T_floor | relocates | leave alone |

General caution: the corrective-feedback-loop mechanism is powerful precisely where an honest, independent, exogenous signal already exists. Where it does not, applying the mechanism relocates the gap from "choose a number" to "manufacture an independent signal," which can be worse if the substitute signal is itself gameable. Two candidates (5 and 6) are cases where making a safety constant emergent would weaken an existing defense, and are recommended against. None of these are adopted; all require their own review.
