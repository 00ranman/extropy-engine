# Calibration Lifecycle for Domain Measurement Operators

Status: **adopted architecture, implementation open, external replication open.**

Version: aligns with formula version `canonical-v3.1.3`. No formula-code change in this document.

Related: [NORMALIZATION.md](./NORMALIZATION.md), [PROTOCOL.md](./PROTOCOL.md), [EMERGENT_EXCHANGE_RATES.md](./EMERGENT_EXCHANGE_RATES.md), [GAPS.md](./GAPS.md), [GAP_FEEDBACK_CANDIDATES.md](./GAP_FEEDBACK_CANDIDATES.md), [NON_EXTRACTION.md](./NON_EXTRACTION.md), [GOVERNANCE_DEFAULTS.md](./GOVERNANCE_DEFAULTS.md), [VALIDATION_IS_EMERGENT.md](./VALIDATION_IS_EMERGENT.md).

## 1. Scope

This document specifies how the calibration of a domain measurement operator M_d is monitored for drift and, when drift is confirmed against independent evidence, replaced under bounded, provenance-carrying, reversible control. It is the normative form of the mechanism sketched as Candidate 4 in [GAP_FEEDBACK_CANDIDATES.md](./GAP_FEEDBACK_CANDIDATES.md), and it addresses gap 23 in [GAPS.md](./GAPS.md).

A calibration is the concrete, versioned configuration that turns a domain's M_d from an abstract operator into a running measurement: reference sets, fitted parameters, instrument settings, and the mapping to bits-equivalent bₑ. NORMALIZATION.md §4 states the invariants any M_d must satisfy. This document specifies what happens across time as the calibration behind a conformant M_d ages, drifts, and must be corrected without silently rewriting the ledger's measurement basis.

In scope:

- The CalibrationRecord schema and its provenance requirements.
- The calibration state machine and the transitions between states.
- Drift detection restricted to evidence independent of the calibration's own accepted outputs.
- Shadow-mode evaluation of a proposed replacement beside the active calibration.
- Bounded replacement, so that large discontinuities require wider review rather than silent auto-replacement.
- Freeze and rollback behavior when drift is detected without adequate replication.
- The anti-circularity rule that forbids a calibration from validating its own successor using only its own accepted outputs.

Out of scope:

- Any numeric default for drift thresholds, replacement velocity, epoch length, sample-size minimums, evidence-density cutoffs, or replication counts. These are governed parameters and are not invented here.
- The construction of M_d itself. That remains an open problem tracked in [NORMALIZATION.md](./NORMALIZATION.md) and gaps 19 to 24 in [GAPS.md](./GAPS.md).
- The exchange coefficient X_d. Calibration of M_d and the cross-domain coefficient X_d are separate concerns. This document governs the operator's own calibration; [EMERGENT_EXCHANGE_RATES.md](./EMERGENT_EXCHANGE_RATES.md) governs the between-tier conversion. The two share the evidence-independence and halt/revert discipline but are not the same object.
- Reputation, which stays outside mint math by construction and is never admissible as calibration evidence.

This is a specification of protocol accounting and lifecycle control. It is not a claim that any M_d has been calibrated against real evidence, and it is not a claim that drift detection has been empirically validated. See §10 and §11.

## 2. Symbols

| Symbol | Meaning |
| ------ | ------- |
| M_d | Domain measurement operator for domain d. Defined per domain in [NORMALIZATION.md](./NORMALIZATION.md). |
| calibration | The versioned configuration (reference sets, fitted parameters, instrument settings, mapping to bₑ) that makes a given M_d executable. |
| CalibrationRecord | The unit of provenance for one calibration. The mint pipeline reads M_d only through a valid, active CalibrationRecord. See §3. |
| drift signal | An observable, computed from evidence independent of the calibration's own accepted outputs, that indicates the calibration has stopped tracking the quantity it claims to measure. See §5. |
| shadow calibration | A proposed replacement calibration that runs beside the active one, producing shadow measurements that are recorded but never enter mint. See §6. |
| corroboration | Confirmation of a calibration against independent replication or persistent-outcome evidence, per §5 and the anti-circularity rule in §8. |
| epoch | The accounting interval over which a calibration is held fixed and at whose boundary a bounded transition may occur. Length is governed and provisional. |

## 3. CalibrationRecord schema

Every calibration is stored as a CalibrationRecord. A CalibrationRecord is the unit of provenance for a domain's measurement. The mint pipeline resolves M_d only through a CalibrationRecord whose status is `active`.

A CalibrationRecord MUST carry all of the following fields. A record missing any field is invalid, and a mint that would depend on it MUST fail closed.

| Field | Meaning |
| ----- | ------- |
| `domain` | The canonical domain this calibration applies to. |
| `operator` | The M_d operator identity and its operator version. Distinguishes the operator from the calibration fitted on top of it. |
| `calibration_version` | The version of this calibration under the domain's calibration numbering. Monotonic within a domain. |
| `training_evidence` | References to the training or reference evidence IDs the calibration was fitted or defined against. |
| `replication_evidence` | References to independent replication evidence IDs that corroborated the calibration, produced by a party disjoint from the one that fitted it. Empty is permitted only in the `proposed` and `shadow` states. |
| `uncertainty` | A confidence interval or explicit uncertainty representation for the calibration's measurements. A point calibration with no uncertainty is invalid. |
| `valid_from_epoch` | The epoch from which this calibration is authoritative if it reaches `active`. |
| `last_corroborated_epoch` | A reference to the most recent independent corroboration event for this calibration, including when and against what replication evidence. |
| `status` | One of the states enumerated in §4. |
| `supersedes` | The `calibration_version` this record replaces, if any. Null for a domain's first calibration. |
| `rollback_target` | The `calibration_version` to revert to if this calibration is frozen or reverted. For an active calibration this is the last independently corroborated predecessor. |
| `provenance` | The evidence, method, fitter identity, and reference trail that justify this calibration, sufficient for an independent party to reproduce the fit and the mapping to bₑ. |

**Fail-closed provenance rule.** If provenance is missing, incomplete, or unparseable, minting for that domain fails closed. The pipeline does not fall back to a prior calibration silently, does not interpolate between calibrations, and does not carry an active calibration past its declared corroboration horizon. Fail closed means no mint, not a best-effort mint. This mirrors the fail-closed provenance rule for rate records in [EMERGENT_EXCHANGE_RATES.md](./EMERGENT_EXCHANGE_RATES.md) §5.

## 4. Calibration state machine

A CalibrationRecord occupies exactly one state. States and their meanings:

- **proposed.** A candidate calibration has been fitted or defined and its provenance recorded. It does not measure anything that enters mint. It carries no replication evidence yet.
- **shadow.** The proposed calibration runs beside the active calibration, producing shadow measurements that are recorded for comparison but never enter mint. See §6.
- **corroborated.** The calibration has met the domain's independent replication requirement under §5 and the anti-circularity rule in §8. Corroborated is a precondition for `active`, not a synonym for it.
- **active.** The calibration is the one the mint pipeline reads for this domain and epoch. Exactly one calibration per domain may be `active` at a time.
- **frozen.** Minting through this calibration is halted pending review. The calibration is neither trusted for new mints nor discarded. Entered when drift is detected without adequate replication. See §7.
- **superseded.** A previously active calibration that a successor has replaced through the full lifecycle. Retained, not deleted, so history is auditable and rollback is possible.
- **reverted.** A calibration that was active or corroborated but whose successor failed, so control returned to its `rollback_target`. Records that a replacement was attempted and rolled back.
- **rejected.** A proposed or shadow calibration that failed corroboration or review and will not be promoted.

Permitted transitions:

```
proposed  -> shadow          (begin side-by-side evaluation)
proposed  -> rejected        (fails review before shadow)
shadow    -> corroborated    (meets independent replication, per §5, §8)
shadow    -> rejected        (fails corroboration or review)
corroborated -> active        (promoted at an epoch boundary, bounded per §6)
active    -> superseded       (a successor became active)
active    -> frozen           (drift detected without adequate replication, §7)
frozen    -> active           (fresh independent corroboration restores it)
frozen    -> reverted         (rolled back to rollback_target)
active    -> reverted         (an active replacement failed; return to rollback_target)
```

State labels reuse repository conventions where they exist. `shadow` matches the shadow-mode language of [EMERGENT_EXCHANGE_RATES.md](./EMERGENT_EXCHANGE_RATES.md). `frozen` and `reverted` match the halt and revert behavior of that document's §8 and of [PROTOCOL.md](./PROTOCOL.md) §11. `superseded` matches the retain-not-overwrite discipline of the repricing loop.

## 5. Drift detection

Drift is the observable divergence between what a calibration claims to measure and what independent evidence shows. Drift detection MUST use evidence independent of the calibration's own accepted outputs. A calibration cannot detect its own drift by reading the mints it produced; that is circular, and it is forbidden by §8.

Candidate independent drift signals include, and are not limited to:

- **Blind replication residuals.** The residual between the active calibration's measurement and a blind re-measurement of the same evidence by a disjoint validator set that did not see the active calibration's output.
- **Persistent-outcome error.** Divergence between what the calibration predicted would persist and what independently held after time passed.
- **Independent reference sets.** Error of the active calibration against reference evidence held out from, and disjoint from, its training and prior corroboration evidence.
- **Downstream reversal and burn rates.** The rate at which mints measured under this calibration were later burned or reversed through retroactive validation ([PROTOCOL.md](./PROTOCOL.md) §9), read as a lagging signal of miscalibration. Burn and reversal counts are outcomes of the retroactive process, not of the calibration's own accepted measurements, so they are admissible.
- **Cross-implementation disagreement.** Dispersion between two independent implementations of the same operator and calibration applied to the same evidence.

The thresholds, sample-size minimums, and evidence-density cutoffs that decide when a drift signal is strong enough to act on are governed and provisional. No numeric default is set here. Where independent evidence density falls below the governed minimum for a domain, drift cannot be reliably assessed, and the calibration is frozen rather than replaced. See §7.

## 6. Shadow evaluation and bounded replacement

A proposed replacement calibration MUST run in shadow mode beside the active calibration before it can affect mint. In shadow mode:

- The shadow calibration produces measurements on live evidence, recorded for comparison, that never enter mint arithmetic.
- The shadow calibration accrues its own `replication_evidence` from independent parties, disjoint from the evidence used to corroborate the active calibration where the anti-circularity rule in §8 requires disjointness.
- A shadow calibration cannot influence mint, cannot alter the active calibration's outputs, and cannot be cited as evidence for or against any mint while it is in shadow.

A shadow calibration may transition to `corroborated` only when the domain's independent replication requirement is met. It may transition to `active` only at an epoch boundary and only under a bounded transition:

- **Bounded discontinuity.** The permitted difference between the outgoing active calibration and the incoming one, per transition and per epoch, is bounded. The bound is governed and provisional; no numeric default is set here.
- **Large discontinuities require wider review.** A proposed replacement whose measurements diverge from the active calibration by more than the governed bound is not auto-promoted. It requires a wider review loop, drawing a broader validator neighborhood, before it can become active. Silent auto-replacement across a large discontinuity is forbidden.
- **Reversibility.** Every promotion records the outgoing calibration as `rollback_target` and retains it as `superseded`, so the domain can revert to the last independently corroborated calibration at any time.

Replacement is therefore automatic only within the governed bound and only after independent corroboration. Outside the bound, or without corroboration, replacement is gated on review, not performed silently.

## 7. Freeze and rollback behavior

Minting in a domain MUST freeze, and the active calibration MUST NOT continue minting, whenever any of the following holds:

- **Drift without adequate replication.** A drift signal under §5 crosses the governed action threshold, but the independent replication needed to corroborate a corrected calibration is not available. The active calibration is frozen. Raw measurement evidence continues to be collected and retained so that a corrected calibration can be fitted later, but no mint is produced through the frozen calibration.
- **Evidence density below the declared minimum.** The density of admissible independent evidence per epoch falls below the governed minimum for that domain, so drift cannot be reliably assessed. The calibration is frozen rather than trusted or replaced on noise.
- **A promoted replacement fails.** An active calibration that replaced a predecessor is shown, against independent evidence, to be worse than the predecessor it replaced. Control reverts: the failed calibration moves to `reverted` and the `rollback_target`, which is the last independently corroborated calibration, is restored to `active`.

Freeze means the domain stops minting new XP through the affected calibration and retains raw measurement evidence for later analysis. Revert means the domain returns to the CalibrationRecord named by `rollback_target`, whose provenance was independently corroborated. Freeze and revert are automatic protocol behaviors, not discretionary governance actions, although governance sets the thresholds that trigger them. Recovery from freeze requires fresh independent corroboration before minting resumes; it is itself a governed loop.

## 8. Anti-circularity rule

Outputs accepted by the active M_d calibration cannot be the sole evidence used to validate its successor.

Concretely:

- A successor calibration MUST be corroborated by evidence independent of the mints and accepted measurements the active calibration produced. Replication by a disjoint party, persistent-outcome checks, independent reference sets, and downstream reversal and burn rates are admissible. The active calibration's own accepted outputs, on their own, are not.
- Drift of the active calibration MUST NOT be assessed only against that same calibration's accepted outputs. A calibration that grades its own homework cannot detect its own drift.
- Reputation is never admissible as calibration evidence; it is outside mint math ([NON_EXTRACTION.md](./NON_EXTRACTION.md), [PROTOCOL.md](./PROTOCOL.md)).

This is the calibration-lifecycle form of the evidence-independence rule in [EMERGENT_EXCHANGE_RATES.md](./EMERGENT_EXCHANGE_RATES.md) §6. The failure it prevents is a calibration that certifies its replacement using only the measurements it already accepted, so that a drifting operator quietly re-anoints itself across versions.

## 9. Interaction with existing invariants

- **Reputation stays outside mint math.** Calibration records, drift signals, and corroboration never read reputation as an input, and reputation is never admissible as corroboration.
- **XP stays non-transferable and non-extractive.** Calibration control changes how a domain measures ΔS into bₑ for internal ledger arithmetic only. It never denominates XP in anything transferable and never creates a cash-out path. See [NON_EXTRACTION.md](./NON_EXTRACTION.md).
- **Canonical domains are unchanged.** The canonical domains remain exactly cognitive, code, social, economic, thermodynamic, informational, governance, and temporal. This document governs their operators' calibrations; it does not add or remove domains.
- **Formula version is unchanged.** No coefficient in `@extropy/xp-formula` changes here. The mint precondition that the formula-version stamp must match the executed math still holds; see [PROTOCOL.md](./PROTOCOL.md) §7.
- **M_d invariants still bind.** A calibration that fails any NORMALIZATION.md §4 invariant cannot be `active`, regardless of its lifecycle state.
- **Separate from X_d.** Calibration lifecycle governs the operator; the exchange coefficient X_d governs cross-tier conversion. A domain can freeze its calibration without repricing X_d, and can reprice X_d without recalibrating its operator.

## 10. Threat model

- **Self-certifying drift.** A drifting calibration certifies its own successor using only its own accepted outputs. Mitigated by the anti-circularity rule in §8.
- **Silent large replacement.** A replacement that moves measurement by a large amount is promoted quietly, rewriting the ledger's measurement basis without review. Mitigated by the bounded-discontinuity and wider-review requirements in §6.
- **Drift laundering.** Many small in-bound replacements accumulate into a large uncorroborated shift in the measurement basis. Mitigated by tracking cumulative divergence since the last independent corroboration, not per-transition divergence alone, and freezing when cumulative drift outruns corroboration under §7.
- **Provenance forgery or omission.** A calibration is used without a real evidence trail. Mitigated by the fail-closed provenance rule in §3.
- **Replication capture.** The party supplying independent replication is not actually independent of the party fitting the calibration. Mitigated by requiring disjoint parties in §5 and §8, and remains an open risk in §11 because independence is hard to verify.
- **Stale corroboration.** A calibration keeps minting on corroboration that has gone stale. Mitigated by `last_corroborated_epoch` in the schema and by the evidence-density freeze in §7.

## 11. Falsifiers

This architecture is falsified for an affected domain, and calibration auto-replacement MUST be withdrawn for that domain, if any of the following is empirically confirmed and remains open across two consecutive governance cycles:

- **CF1. No independent drift signal exists.** For a domain, no drift signal can be constructed from evidence independent of the calibration's own accepted outputs. Every candidate signal is circular. Drift is then undetectable and auto-replacement is unfalsifiable, so it MUST NOT run.
- **CF2. Replication is unobtainable.** No party disjoint from the fitter can supply the independent replication that §5 and §8 require, at feasible cost. Corroboration is then impossible and no successor can legitimately become active.
- **CF3. Freeze never triggers under known-bad conditions.** A constructed scenario in which drift demonstrably outruns corroboration fails to trigger the §7 freeze. The safety mechanism is then decorative.
- **CF4. Bounded replacement is defeated.** In-bound replacements reliably accumulate into a large uncorroborated basis shift that the cumulative-drift freeze fails to catch. The bound is then insufficient and the calibration basis is not trustworthy.

These falsifiers are additive to F1 through F4 in [NORMALIZATION.md](./NORMALIZATION.md) §5 and XF1 through XF4 in [EMERGENT_EXCHANGE_RATES.md](./EMERGENT_EXCHANGE_RATES.md) §11.

## 12. Implementation status

- **Specification:** adopted in this document.
- **Code:** none. There is no CalibrationRecord store, no drift-detection implementation, no shadow-mode runner, and no freeze or revert enforcement in the mint pipeline. `@extropy/xp-formula` is unchanged. The validator-weight prototype in `packages/validator-weight-lab/` is a separate, non-normative offline analysis harness for gap 14 and is not a calibration-lifecycle implementation.
- **Parameters:** none set. Drift thresholds, replacement bounds, epoch length, sample-size minimums, evidence-density minimums, and replication counts are all governed and remain unset.
- **Empirical validation:** none. No calibration has been fitted against real evidence, no drift signal has been computed from real data, and independent replication of any calibration has not been demonstrated.

## 13. Decision status

- **Adopted architecture:** the CalibrationRecord schema, the calibration state machine, independent-evidence drift detection, shadow evaluation with bounded replacement, freeze and rollback behavior, and the anti-circularity rule are adopted as the protocol's stated architecture for calibration lifecycle.
- **Implementation open:** no code, no store, no parameters. See §12.
- **External replication open:** the independent replication and cross-implementation evidence this architecture depends on has not been demonstrated to exist at feasible cost. See CF2 and the replication-capture threat.
- **Codex update deferred:** the Codex documents remain unchanged. These corrections are being accumulated for a later major Codex revision and are not folded into the Codex now.
