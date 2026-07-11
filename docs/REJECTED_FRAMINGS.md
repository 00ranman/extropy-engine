# Rejected Framings

This document collects framings that were adopted in prior versions of the Extropy Engine spec and have been formally retired. Each entry states what the framing claimed, why it was retired, and where the replacement lives.

Keeping these framings on paper is deliberate: the project has to be able to point at what it used to say and does not say anymore, so that a reader who arrives with an older version of the Codex can find the correction.

## R1. XP = ΔS / c_L² (retired in canonical-v3.1.3)

### What it claimed

The Codex previously included an "irreducible XP" floor of the form:

```
XP_irreducible = ΔS / c_L²
```

where c_L is the per-domain causal closure speed. The claim was that this represented the physics-minimum XP that must be minted for a given entropy reduction, regardless of the outcome of the full formula.

The `xp-mint` service implemented this by taking `Math.max(fullXP, irreducibleXP)` at mint time. `packages/contracts` exposed `IrreducibleXPInputs` as a canonical type.

### Why it was retired

The framing failed on three grounds.

**G1. Wrong physics analogy.** Dividing an entropy delta by the square of a substrate speed borrows the form of E = mc² without borrowing any of the derivation. There is no bookkeeping in which "1 / c_L²" is the right conversion factor between a domain-native entropy delta and a substrate-agnostic XP quantity. It looks like a physics constant, but the derivation was never given because there is none.

**G2. Wrong invariant.** The stated purpose of the term was to guarantee that legitimate loops always mint something positive. The actual failure mode this was patching around is different: it was patching around the raw-seconds bug in the settlement-time factor, which was silently zeroing legitimate loops (see §7 of this doc's mirror in CHANGELOG). Once that bug is fixed at the settlement-time layer, the "irreducible" branch is unnecessary. Fixing the wrong layer to compensate for a bug in another layer is not a physics guarantee, it is a workaround.

**G3. Subtractive credibility.** Publishing "XP = ΔS / c_L²" invites competent readers to search for a derivation, find none, and conclude that the rest of the spec is at the same level of rigor. That is a credibility cost with no compensating benefit; the actual invariants worth publishing are elsewhere and are stronger.

### Replacement

The v3.1.3 formula lives in `@extropy/xp-formula`:

```
XP = R × F × ΔS × (w · E) × min(log(1/Tₛ), log(1/T_floor))
Tₛ = exp(-λ · Δt)   Δt in seconds, λ per-domain
```

Where:

- `Tₛ ∈ (T_floor, 1]` is guaranteed by construction.
- `log-decay ∈ [0, log(1/T_floor)]`, closing both the divergence at Tₛ → 0 and the silent-zero at Tₛ > 1.
- No "irreducible" branch. Legitimate loops mint positive XP because the formula is bounded and non-negative by construction.

The `IrreducibleXPInputs` type is retained in `packages/contracts/src/types.ts` for one release with a `@deprecated` marker and is scheduled for removal in the next breaking change.

### Attribution

The retirement was decided during the v3.1.3 audit and shipped in the same PR that fixed the T_s floor bug.

## R2. "Cryptographic loop closure" as a security guarantee

*Reserved. Placeholder for a future rejection entry covering language in Codex v1.0 §7 that implied loops close under a cryptographic invariant. In practice they close under a validator-neighborhood invariant plus an audit trail. This is a subtractive rewrite pending in a follow-up docs PR.*

## R3. "Trilemma theorem" as proved

*Reserved. Placeholder for the v_min / V4-6 "trilemma" phrasing in Codex Appendix J, which is presented as a theorem but is currently a conjecture. Retirement path: rewrite as an open conjecture with the current partial results stated as lemmas, or produce a full proof. Pending a longer discussion; not part of v3.1.3.*
