# Cross-Domain ΔS Normalization

Status: **open problem, whole-project falsifier.**

Version: aligns with `canonical-v3.1.3` formula.

Related: [SPEC_v3.1.md §6, §20](./SPEC_v3.1.md), [GAPS.md P1 item 19](./GAPS.md), [AUTARKY.md](../packages/xp-mint/docs/AUTARKY.md), [REJECTED_FRAMINGS.md](./REJECTED_FRAMINGS.md).

## 1. Why this document exists

The Codex claims XP is minted from **verified ΔS**, where ΔS is a disorder-reduction score in bits. That single word, "bits", is doing an enormous amount of work across eight domains:

| Domain          | What "1 bit of ΔS" nominally means |
| --------------- | ---------------------------------- |
| thermodynamic   | 1 bit of thermodynamic entropy reduction (Landauer floor: k_B T ln 2 joules of dissipation avoided) |
| informational   | 1 bit of Shannon entropy removed from a channel or knowledge base |
| social          | 1 bit of coordination uncertainty reduced across N agents |
| economic        | 1 bit of price / allocation uncertainty reduced in a market or matching |
| ecological      | 1 bit of ecosystem state uncertainty reduced (species presence, flow, stock) |
| governance      | 1 bit of decision uncertainty reduced under a codified rule set |
| cognitive       | 1 bit of belief-state uncertainty reduced in an epistemic agent |
| spiritual       | ??? (see §6 below) |

The formula treats these as directly additive on the mint side: **XP is a scalar and does not remember which domain minted it.** That is the point of a single ledger, but it is also the largest live falsifier of the whole project. If we cannot show that "1 governance bit" and "1 thermodynamic bit" are comparable in any principled way, then the XP ledger is a category-error stack: an arithmetic on incommensurable units, dressed as a physics.

This document defines the normalization pipeline that has to exist for the ledger to be honest, and states in advance the conditions under which the whole architecture is falsified.

## 2. The bits-equivalent common unit

We define a single common unit: **bits-equivalent (bₑ).** All domain-native ΔS measurements MUST be converted to bₑ before being fed into the XP formula.

The conversion is a domain-specific measurement operator M_d:

```
ΔS_bₑ = M_d(raw evidence, domain state)
```

Each domain owns its own M_d. The invariants any M_d must satisfy are listed in §4.

The XP formula then reads bits-equivalent, not raw bits:

```
XP = R × F × ΔS_bₑ × (w · E) × log(1/Tₛ_effective)
```

where Tₛ_effective is the clamped, unit-less settlement-time factor (`@extropy/xp-formula` v3.1.3).

## 3. Domain measurement operators (v0)

These are seed operators. Each domain is expected to grow its own calibration table and validator neighborhood.

### 3.1 Thermodynamic

`M_thermo(before, after)` = Shannon entropy of the phase-space distribution, before minus after, expressed in bits.

Anchor: Landauer's principle. 1 bₑ_thermo ≡ 1 bit of thermodynamic entropy erased ≡ k_B T ln 2 joules of minimum dissipation avoided.

### 3.2 Informational

`M_info(before, after)` = Shannon entropy of the document / channel / dataset representation, before minus after.

Anchor: raw Shannon bits with H₀ = 1.

Special case: prediction-loop domains where the mint is contingent on a specific claim being verified (proofs, patches merged). In those cases M_info is the log-likelihood-ratio of the claim under the pre-verification distribution.

### 3.3 Social

`M_social(before, after)` = Shannon entropy of the assignment distribution over N agents, before minus after.

Anchor: 1 bₑ_social ≡ removing one round of "who does what" ambiguity in a coordination game.

### 3.4 Economic

`M_econ(before, after)` = Shannon entropy of the allocation / price-discovery distribution, before minus after.

Anchor: 1 bₑ_econ ≡ resolving one bit of allocation-outcome uncertainty in a market or matching. Never denominated in fiat. See [NON_EXTRACTION.md](./NON_EXTRACTION.md).

### 3.5 Ecological

`M_eco(before, after)` = Shannon entropy of the ecosystem-state distribution over species / stocks / flows in a bounded region, before minus after.

Anchor: 1 bₑ_eco ≡ resolving one bit of ecosystem-state uncertainty by measurement or restoration.

### 3.6 Governance

`M_gov(before, after)` = Shannon entropy of the decision distribution under the codified rule set, before minus after.

Anchor: 1 bₑ_gov ≡ removing one bit of decision uncertainty in a formal governance procedure.

### 3.7 Cognitive

`M_cog(before, after)` = Shannon entropy of the agent's belief-state, before minus after.

Anchor: 1 bₑ_cog ≡ removing one bit of belief-state uncertainty in a verifiable epistemic agent (test scored, model calibration improved, misconception corrected in a way validators can inspect).

### 3.8 Spiritual

Not adopted. Retained as a domain label in `EntropyDomain` for schema stability, but there is no accepted measurement operator M_spiritual, so it MUST NOT mint XP under the canonical formula until such an operator is defined, tested, and adopted through governance. Treat as a reserved slot.

## 4. Invariants any M_d must satisfy

1. **Non-negativity.** M_d(x, y) ≥ 0 for all (x, y). ΔS ≤ 0 does not mint.
2. **Boundedness per event.** M_d has a documented per-event cap that scales with the size of the underlying state space, not with wall-clock time. Time-based scaling belongs in the settlement-time factor, not in ΔS.
3. **Verifiability.** M_d is computable from evidence a validator neighborhood can independently reproduce. If the evidence cannot be independently reproduced, the mint MUST fail preconditions.
4. **Deterministic given evidence.** Two validators applying M_d to the same evidence must produce values within a documented tolerance ε_d.
5. **Composability.** M_d is additive over disjoint sub-events. If a single logical loop is split into k sub-events, sum of ΔS_bₑ over the k sub-events equals ΔS_bₑ of the whole, up to ε_d.

## 5. The whole-project falsifier

The Extropy Engine is **falsified as a coordination protocol** if any of the following holds, project-wide:

**F1. Non-comparability.** No principled M_d family can be constructed such that the invariants in §4 hold across every adopted domain simultaneously.

**F2. Runaway cross-domain arbitrage.** Given constructed M_d, there exists a strategy that repeatedly converts low-cost bₑ in domain A into high-value XP redeemable against domain B's access thresholds, at a rate that cannot be closed by governance parameters (rarity R, frequency-of-decay F, settlement-time floor Tfloor).

**F3. Validator disagreement dominates signal.** For at least one adopted domain, validator-to-validator variance on M_d applied to the same evidence exceeds the mean ΔS_bₑ per loop. In that case, the mint is dominated by validator noise, and the ledger is measuring reviewer opinion, not entropy reduction.

**F4. Tₛ-floor arbitrage after clamp.** Even with the v3.1.3 Tₛ floor in place, there exists a domain in which the achievable log-decay term at settlement-floor speed is a k× multiple of the domain's honest median log-decay, where k is large enough that the resulting mint dominates the (R × F × ΔS × wE) factor for legitimate loops in the same domain.

If any of F1–F4 is empirically confirmed and remains open for two consecutive governance cycles, the project MUST publish that fact, mark the affected domain(s) inactive at the mint layer, and stop claiming a physics-grounded XP invariant across those domains.

This is intentional. A framework that cannot be falsified is not a framework; it is a brand.

## 5a. Two-tier invariant and the X_d conversion stage

The single-scalar ledger described above hid an assumption: that a bit measured in one domain is automatically the same quantity as a bit measured in another. That assumption was static, unversioned, and unfalsifiable. The two-tier invariant replaces it with an explicit, bounded, reversible conversion. The full specification lives in [EMERGENT_EXCHANGE_RATES.md](./EMERGENT_EXCHANGE_RATES.md); this section summarizes it without overstating what is implemented.

**Grounded tier.** Domains whose M_d output is tied to a directly measured physical or informational quantity, with a stated instrument, a stated error model, and a reproducible mapping to bₑ. Scientific precision is required: a Shannon bit is a property of a probability distribution and is not automatically thermodynamic energy, and Landauer's principle supplies only a lower bound of k_B T ln 2 joules for the logically irreversible erasure of one bit in a physical medium at temperature T, under the idealized conditions of the principle. It is not a general conversion factor.

**Convention tier.** Cognitive, code, social, economic, governance, and temporal domains, plus any informational claim that lacks a direct operational information or physical mapping. Convention-tier values are real and mintable but are not directly commensurable with grounded-tier bₑ.

**The X_d conversion stage.** Each convention-tier comparison to the grounded tier passes through an explicit emergent exchange coefficient X_d, so that the ledger reads `ΔS_bₑ(d) = X_d · M_d(evidence, domain state)`. X_d is a protocol accounting conversion, not a physical constant and not a proof that unlike domains are ontologically identical. It is a velocity-bounded managed float: held fixed within an epoch, repriced only through a high-rarity, broad-neighborhood, quorum-gated, reversible loop, and required to carry full provenance. A missing or unprovenanced X_d does not mint; provenance failure fails closed. If drift outruns independent corroboration, minting in that domain halts and X_d reverts to its last corroborated value.

**Status.** This is specification architecture only. No X_d value, velocity bound, epoch length, or threshold is set, no code path reads X_d, and empirical cross-domain comparability remains an open problem. See [EMERGENT_EXCHANGE_RATES.md](./EMERGENT_EXCHANGE_RATES.md) §12 and [GAPS.md](./GAPS.md).

## 6. What v3.1.3 actually delivers

v3.1.3 does not solve the normalization problem. What it does deliver:

- **A single common unit (bₑ)** with a canonical name and precise per-domain semantics, so future violations of §4 can be pointed at unambiguously.
- **A settlement-time floor Tfloor and log-decay cap** in `@extropy/xp-formula`, closing the raw-seconds pathology that had made F4 trivially satisfiable in code (see [REJECTED_FRAMINGS.md](./REJECTED_FRAMINGS.md)).
- **Removal of the XP = ΔS / c_L² framing**, which pretended to define an "irreducible XP" using a domain constant c_L but did not respect §4 (it collapsed all domains to their causal-closure speeds, which is a property of the substrate, not of the entropy delta).
- **An explicit falsification contract** in §5.

Every future domain adoption MUST include a proposed M_d and a validator-neighborhood recipe. No M_d, no mint.

## 7. Related work

- Landauer, "Irreversibility and Heat Generation in the Computing Process," IBM J. Res. Dev. 5 (1961) 183.
- Bennett, "The Thermodynamics of Computation," Int. J. Theor. Phys. 21 (1982) 905.
- Codex v1.0 §6 (Ontological Layers) and §20 (Formula Semantics) — the source claims this document is trying to make honest.
