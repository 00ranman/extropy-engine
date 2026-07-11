# Emergent Cross-Domain Exchange Rates

Status: **adopted architecture, implementation pending, empirical validation open.**

Version: aligns with formula version `canonical-v3.1.3`. No formula-code change in this document.

Related: [NORMALIZATION.md](./NORMALIZATION.md), [PROTOCOL.md](./PROTOCOL.md), [GAPS.md](./GAPS.md), [NON_EXTRACTION.md](./NON_EXTRACTION.md), [GOVERNANCE_DEFAULTS.md](./GOVERNANCE_DEFAULTS.md), [VALIDATION_IS_EMERGENT.md](./VALIDATION_IS_EMERGENT.md).

## 1. Scope

This document specifies how contributions measured in different domains are made comparable inside the XP ledger without asserting that unlike domains are ontologically identical.

It replaces the hidden assumption, present in earlier drafts, that "1 bit here" and "1 bit there" are automatically the same quantity. That assumption was a static, unversioned, unfalsifiable cross-domain equivalence buried inside the single-scalar ledger. This document makes the equivalence explicit, bounded, provenance-carrying, reversible, and fail-closed.

This is a specification of protocol accounting. It is not a claim that the exchange coefficients defined here are physical constants, and it is not a claim that cross-domain comparability has been empirically validated. See §12 and §13.

In scope:

- The two-tier separation of domains into a grounded tier and a convention tier.
- The emergent exchange coefficient X_d that converts convention-tier measurements into grounded-tier bits-equivalent for ledger arithmetic.
- The rate record schema, its provenance requirements, and the fail-closed mint precondition.
- The repricing loop that adjusts X_d over time under bounded velocity and independent evidence.
- The halt and revert behavior when corroboration cannot keep pace with drift.

Out of scope:

- Any numeric default for X_d, its adjustment velocity, epoch length, uncertainty thresholds, evidence density, or quorum. These are governed parameters and are not invented here.
- The per-domain measurement operator M_d itself. Constructing M_d remains an open problem tracked in [GAPS.md](./GAPS.md) and [NORMALIZATION.md](./NORMALIZATION.md).
- Reputation, which stays outside mint math by construction.

## 2. Symbols

| Symbol | Meaning |
| ------ | ------- |
| M_d | Domain measurement operator. Maps raw domain evidence to a domain-native disorder-reduction value. Defined per domain in [NORMALIZATION.md](./NORMALIZATION.md). |
| bₑ | Bits-equivalent. The common ledger unit into which every domain measurement is converted before the XP formula reads it. |
| X_d | Emergent exchange coefficient for convention-tier domain d. Converts a convention-tier measurement into bₑ for ledger arithmetic. A protocol accounting conversion, not a physical constant. |
| v_d | Per-epoch velocity bound on X_d. The maximum fractional change permitted to X_d in one epoch. Governed and provisional. |
| epoch | The accounting interval over which an X_d value is held fixed and at whose boundary a bounded repricing may occur. Length is governed and provisional. |
| provenance | The evidence, method, and reference trail that justifies a given X_d value. |

## 3. Two-tier invariant

Every canonical domain is assigned to exactly one of two tiers. The tier assignment is part of the protocol and is versioned.

### 3.1 Grounded tier

The grounded tier admits direct physical or informational measurements only where the evidence and the mapping to bₑ are operationally defined and independently reproducible.

Scientific precision is mandatory here, because the credibility of the whole ledger rests on it:

- Shannon information is a property of a probability distribution over messages or states. A Shannon bit is not automatically a quantity of thermodynamic energy or thermodynamic entropy.
- Landauer's principle supplies a lower bound of k_B T ln 2 joules dissipated per bit, and only for the logically irreversible erasure of one bit of information in a physical medium held at temperature T, under the idealized conditions of the principle. It is a lower bound on dissipation for irreversible erasure. It is not a conversion factor that turns arbitrary Shannon bits into recoverable energy, and it does not license treating an informational bit and a thermodynamic bit as the same physical quantity outside those conditions.
- A domain qualifies for the grounded tier only when its M_d output is tied to a directly measured physical or informational quantity with a stated instrument, a stated error model, and a reproducible mapping to bₑ. An informational claim that lacks a direct operational information or physical mapping does not qualify and belongs in the convention tier.

Grounded-tier domains are compared to each other only through their operationally defined mappings, with uncertainty carried explicitly. They do not require an X_d coefficient among themselves, because they share a defined measurement basis. Where any specific grounded mapping is not yet operationally defined, that domain instance is treated as convention tier until the mapping is defined, tested, and adopted through governance.

### 3.2 Convention tier

The convention tier admits domains whose value is real and mintable but whose measurement is a modeling convention rather than a direct physical or informational measurement.

The convention tier includes cognitive, code, social, economic, governance, and temporal domains, plus any informational claim that lacks a direct operational information or physical mapping.

Convention-tier measurements are not directly commensurable with grounded-tier bₑ. Each convention-tier comparison to the grounded tier MUST pass through an explicit emergent exchange coefficient X_d.

### 3.3 The invariant

**No convention-tier measurement enters ledger arithmetic against the grounded tier except through an explicit, provenance-carrying X_d.** There is no implicit conversion, no default rate of 1, and no silent commensurability. A missing or unprovenanced X_d does not mint. This is the two-tier invariant.

## 4. The exchange coefficient X_d

For a convention-tier domain d, the ledger reads:

```
ΔS_bₑ(d) = X_d · M_d(evidence, domain state)
```

X_d is the emergent exchange coefficient. It is a managed float: a value that is held fixed within an epoch and adjusted only at epoch boundaries, under the velocity bound v_d, through the governed repricing loop in §7.

X_d is explicitly:

- A protocol accounting conversion, chosen so that convention-tier contributions can be summed into a single ledger.
- Emergent, meaning it is corrected over time by observed evidence rather than fixed by fiat at genesis.
- Bounded, meaning it cannot move faster than v_d per epoch.
- Reversible, meaning any repricing can be rolled back to the last corroborated value.

X_d is explicitly **not**:

- A universal physical constant.
- A proof that domain d and the grounded tier are ontologically the same kind of thing.
- A price, an exchange rate against fiat, or anything redeemable. Non-Extraction still holds; see [NON_EXTRACTION.md](./NON_EXTRACTION.md).

## 5. Rate record schema

Every X_d value is stored as a rate record. A rate record is the unit of provenance. The mint pipeline reads X_d only from a valid rate record.

A rate record MUST carry all of the following fields. A record missing any field is invalid, and a mint that would depend on it MUST fail closed.

| Field | Meaning |
| ----- | ------- |
| `domain` | The canonical convention-tier domain this rate applies to. |
| `rate_value` | The current X_d value for this domain and epoch. |
| `uncertainty` | A confidence interval or an explicit uncertainty representation for `rate_value`. A point estimate with no uncertainty is invalid. |
| `evidence` | Provenance: the independent evidence and method that justify this value. See §6. |
| `epoch` | The epoch for which this value is authoritative. |
| `version` | The protocol and schema version under which this record was minted. |
| `last_corroborated` | A reference to the most recent independent corroboration event for this rate, including when and against what evidence. |

**Fail-closed provenance rule.** If provenance is missing, incomplete, or unparseable, minting for that domain fails closed. The ledger does not fall back to a default rate, does not interpolate, and does not carry forward an expired value past its declared corroboration horizon. Fail closed means no mint, not a best-effort mint.

## 6. Evidence independence rule

Repricing X_d MUST use evidence that is independent of the XP values that were themselves calculated from the same X_d. This prohibits circular self-confirmation, in which a rate is "confirmed" by the very mints it produced.

Candidate external evidence includes, and is not limited to:

- Persistent outcomes: whether the claimed disorder reduction still holds after time has passed.
- Independent replicated measurements: the same effect measured by a separate instrument or neighborhood.
- Validator disagreement: dispersion in validator verdicts as a signal about rate miscalibration.
- Reversals and failures: mints later burned, or loops later shown to have been miscounted.
- Cross-domain substitution observations: cases where actors substituted work across domains, revealing an implied relative value.
- Resource constraints: externally observable scarcity or cost that bounds plausible rates.
- Prediction error: divergence between what a rate predicted and what was later observed.

Evidence derived from XP totals, threshold crossings, or rankings that were computed using the same X_d is not admissible as corroboration for that X_d. Reputation is never admissible as corroboration; it is outside mint math.

## 7. Repricing loop

Repricing X_d is itself a contribution loop, governed by the same protocol as any other loop, with deliberately conservative parameters. It is:

- **High-rarity.** Repricing is rare relative to ordinary loops. It is not a routine per-mint operation.
- **Broad-validator-neighborhood.** Repricing draws a wide validator neighborhood, broader than an ordinary same-domain loop, so that no narrow group can move a rate.
- **Quorum-gated.** A repricing closes only when the domain's quorum function is satisfied. Quorum is governed and is not set here.
- **Reversible.** Every repricing records the prior value and its provenance so the rate can be reverted to the last corroborated value.
- **Velocity-bounded.** A single repricing may not move X_d by more than v_d in one epoch. v_d and epoch length are governed and provisional.

Lifecycle of a repricing loop:

```
rate-observed -> evidence-gathered (independent, per §6)
             -> repricing-proposed (bounded by v_d)
             -> broad-neighborhood-verdicts-collected
             -> quorum-gated-closure | rejected
             -> new-rate-record-written (with prior value retained) | halt-and-revert (per §8)
```

The new rate record supersedes the prior one at the next epoch boundary. The prior record is retained, not overwritten, so that revert is always possible and so that the rate history is auditable.

## 8. Halt and revert behavior

Minting in a convention-tier domain MUST halt, and X_d MUST revert to the last corroborated value, whenever any of the following holds:

- **Drift outruns corroboration.** The cumulative adjustment to X_d since the last independent corroboration exceeds what the available independent evidence supports.
- **Evidence density falls below the declared minimum.** The density of admissible independent evidence per epoch drops below the governed minimum for that domain. The minimum is declared and governed; it is not set here.
- **Repricing closes faster than independent confirmation.** Repricing events close at a cadence faster than independent confirmation can be produced, so that rates are moving without being checked.

Halt means the domain stops minting new XP through that rate. Revert means X_d returns to the last rate record whose provenance was independently corroborated under §6. Halt and revert are automatic protocol behaviors, not discretionary governance actions, although governance may set the thresholds that trigger them. Recovery from halt is itself a governed loop that requires fresh independent corroboration before minting resumes.

## 9. Interaction with existing invariants

- **Reputation stays outside mint math.** X_d and its repricing never read reputation as an input, and reputation is never admissible as corroboration.
- **XP stays non-transferable and non-extractive.** X_d converts measurements into bₑ for internal ledger arithmetic only. It never denominates XP in anything transferable and never creates a cash-out path. Prediction markets over loop outcomes and fiat cash-out remain rejected. See [NON_EXTRACTION.md](./NON_EXTRACTION.md).
- **Canonical domains are unchanged.** The canonical domains remain exactly cognitive, code, social, economic, thermodynamic, informational, governance, and temporal. This document assigns them to tiers; it does not add or remove domains.
- **Formula version is unchanged.** No coefficient in `@extropy/xp-formula` changes here. The mint precondition that formula-version stamp must match executed math still holds; see [PROTOCOL.md](./PROTOCOL.md) §7.

## 10. Threats

- **Circular self-confirmation.** A rate is "corroborated" by mints it produced. Mitigated by the evidence independence rule in §6, which excludes any evidence derived from the same X_d.
- **Rate capture.** A narrow group moves a rate to favor its own domain. Mitigated by broad-neighborhood, quorum-gated, high-rarity repricing in §7.
- **Drift laundering.** Many small sub-v_d moves accumulate into a large uncorroborated shift. Mitigated by the drift-outruns-corroboration halt in §8, which tracks cumulative drift since last corroboration, not per-epoch drift alone.
- **Provenance forgery or omission.** A rate is used without a real evidence trail. Mitigated by the fail-closed provenance rule in §5.
- **Cross-domain arbitrage.** An actor converts cheap convention-tier bₑ into valuable access via a mispriced X_d. This is the same family as falsifier F2 in [NORMALIZATION.md](./NORMALIZATION.md); the explicit, bounded, reversible X_d narrows but does not by itself close it, and it remains an open risk in §13.
- **Stale corroboration.** A rate keeps minting on evidence that has gone stale. Mitigated by `last_corroborated` in the schema and by the evidence-density halt in §8.

## 11. Falsifiers

This architecture is falsified, and the two-tier exchange model MUST be withdrawn for an affected domain, if any of the following is empirically confirmed and remains open across two consecutive governance cycles:

- **XF1. No independent estimator exists.** For a convention-tier domain, no estimator of X_d can be built from evidence independent of the ledger's own XP outputs. If every candidate estimator is circular, the rate is unfalsifiable and MUST NOT mint.
- **XF2. Non-identifiability.** Two materially different X_d values fit all available independent evidence equally well, and no admissible evidence can distinguish them. The rate is then not identified, and minting on a chosen value is arbitrary.
- **XF3. Halt never triggers under known-bad conditions.** A constructed scenario in which drift demonstrably outruns corroboration fails to trigger the §8 halt. The safety mechanism is then decorative.
- **XF4. Repricing cannot outrun capture.** A broad, quorum-gated repricing loop is still reliably captured by a coordinating minority at feasible cost. The governance bounds are then insufficient and the rate is not trustworthy.

These falsifiers are additive to, not replacements for, F1 through F4 in [NORMALIZATION.md](./NORMALIZATION.md) §5.

## 12. Implementation status

- **Specification:** adopted in this document.
- **Code:** none. There is no rate record store, no repricing loop implementation, no halt/revert enforcement, and no X_d input path in the mint pipeline. `@extropy/xp-formula` is unchanged.
- **Parameters:** none set. X_d, v_d, epoch length, uncertainty thresholds, evidence density minimums, and quorum are all governed and remain unset.
- **Empirical validation:** none. No X_d has been estimated from real evidence, and cross-domain comparability remains an open problem, not a solved one.

## 13. Decision status

- **Adopted architecture:** the two-tier separation, the explicit provenance-carrying X_d, the bounded reversible repricing loop, the evidence independence rule, and the fail-closed halt/revert behavior are adopted as the protocol's stated architecture for cross-domain comparison.
- **Implementation pending:** no code, no store, no parameters. See §12.
- **Empirical validation open:** per-domain M_d constructibility and empirical cross-domain comparability are not solved. See [GAPS.md](./GAPS.md).
- **Codex update deferred:** the Codex documents remain unchanged. These corrections are being accumulated for a later major Codex revision and are not folded into the Codex now.
