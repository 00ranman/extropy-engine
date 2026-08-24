# Codex 3.0 — ZKP mechanics for reputation

**Status:** Codex v2.1 stays frozen. Not implemented. This is the missing mechanics note between `IDENTITY.md` (who you are) and `CODEX_3_NOTES_ACCESS.md` (what a till may ask).
**Date:** 2026-08-23

Identity ZKPs already specified: uniqueness, onboarding, BBS+ wrapper, per-context nullifiers, 7-of-12 reveal escrow. Reputation is still treated like a public vector keyed on a DID. That re-identifies everyone the nullifiers just hid. This file is how standing gets proven without opening the diary.

---

## What must never leak

A reputation proof should not reveal:

- exact XP, exact R, exact IT
- which loops produced them
- the PSLL
- cross-DFAO linkability (unless the holder consents)
- a leaderboard position

It may reveal a **predicate**: yes/no, or a coarse band, for *this context, this epoch*.

Reputation still must not enter the XP mint. `R` in `XP = R × F × ΔS × (w · E) × log(1/Tₛ)` is rarity of the action class. Standing lives in vote weight, CAT, IT, routing, and access bands only.

---

## Commitments (held at the edge, rooted on the DAG)

The node keeps a private state; the mesh stores only commitments (Merkle / KZG / Pedersen — pick in implementation, not in 2.1).

| Commitment | Contents (private) | Public root |
| --- | --- | --- |
| `C_xp` | standing XP after decay and late-burn | epoch-stamped |
| `C_R` | per-domain reputation vector | epoch-stamped |
| `C_IT` | governance weight after 5% drip | per DFAO |
| `C_slash` | burns, penalties, open disputes | accumulator |
| `C_hist` | Merkle of settled loop IDs + domains (not payloads) | for membership proofs |

Epoch is a time bucket (need not be a diplomacy season). Proofs are invalid outside the epoch they were built for, so you cannot flash yesterday's R after a decay tick or a burn.

Decay lives **inside** the statement:

```
XP_now = XP_last × (1 - ρ)^k     ρ = 0.01 / 30 cycles
IT_now = IT_last × (1 - 0.05)^(months)
```

If the circuit does not apply decay, the proof is a lie about the present.

---

## Predicates worth proving

These are the useful ones. Range-proof / BBS+ attribute / Groth16-Halo2 — implementation choice. Semantics first.

1. **Access band** — `floor(log_b(1 + XP_now)) ≥ L`  
   Till, door, LocalFlow insurance. Coarse. Default public display off.

2. **Domain standing** — `R_d ≥ t` or `CAT_d ≥ n`  
   “I may be routed this class of task.” Not “my R is 1847.”

3. **Vote eligibility** — `IT_now ≥ q` in *this* DFAO  
   Plus a nullifier so one body cannot cast twice. Does not publish the weight unless the voting method *needs* the number (see routing).

4. **Clean in domain** — no confirmed slash in `d` during epoch  
   Membership in `C_slash` accumulator = 0 for that tag.

5. **History membership** — “this settled loop is mine”  
   Merkle path into `C_hist`. For DAG curators and disputes. Does not dump the rest of the graph.

6. **Same-person-as** — two actions share a DID without showing it  
   Per-context nullifier: `n = H(sk, dfao, epoch, purpose)`. Uniqueness inside the context. Unlinkable across contexts unless the holder opens a BBS+ link.

7. **Not a fresh Sybil** — onboarding credential still valid, KYC binding still live  
   Already in `IDENTITY.md`. Reputation proofs should *require* this as a public input so you cannot prove a fat R on a throwaway DID.

BBS+ is the right default for **attribute disclosure** (band, domain tag, not-slashed, epoch). Circuits (Halo2 / Groth16) for **arithmetic** (decay, log-band, range). Don’t force one scheme to do both on day one.

---

## The hard problem: SignalFlow routing

Access is a threshold. Routing wants an **ordering**. “Send this task to someone good at social, not overloaded.” If SignalFlow sees raw `R_d`, the privacy story dies at the scheduler.

Options, honest:

| Mode | What SignalFlow sees | Cost |
| --- | --- | --- |
| **A. Coarse public band** | `R_d` quantized to the same log bands as access | Leaks order-of-magnitude. Simple. Probably enough for MICRO. |
| **B. Edge match** | The task is broadcast with a predicate (`CAT_social ≥ 2`, load, geo proof). Nodes self-select by proving the predicate. First valid proof + VRF wins. | No central ranking. Matches Digital Autarky. Can starve if density is thin. |
| **C. Encrypted weights / MPC** | Scheduler gets comparison, not values | Heavy. Not bootstrap. |
| **D. Trusted scheduler** | Raw R | Fast. Panopticon. Forbidden as default. |

3.0 default should be **B**, with **A** as a DFAO opt-in for busy MESO/MACRO queues. Not D. C later.

Conviction voting that needs *weighted* tallies has the same leak. Per-DFAO choice: (1) 1-person-1-nullifier (threshold IT only), or (2) prove weight into an encrypted tally (ballot box). Do not publish `IT` next to a name.

---

## Sticky DID vs unlinkable reputation

`IDENTITY.md` wants a sticky DID so you cannot launder a bad R by minting a new face. `IDENTITY_IMPL.md` currently keys the reputation graph on `did:extropy:<hex>`. That is Sybil-resistant and correlatable.

The reconciliation:

- **One** long-lived secret (`sk`) bound to KYC (hard to fork).
- **Many** context nullifiers derived from `sk`.
- Reputation commitments update against `sk`, not against a global public DID string.
- A slash in domain `d` is an accumulator insertion under `sk`. A new nullifier in another DFAO still fails the “clean” predicate if the circuit reads the same accumulator.

You can look like a different person in two rooms. You cannot leave the burn in the first room. That is the point of sticky *secret*, not sticky *name*.

Threshold reveal (7-of-12) still pierces to real-world identity with cause. Reputation proofs do not change that.

---

## Failure modes (do not hand-wave)

- **Stale proofs.** Without epoch + decay-in-circuit, people prove a past peak. Invalid after `epoch_end` or after a published burn root changes.
- **Band sniping.** Linear thresholds get farmed. Log bands + 1% drip make that sticky. Don't publish the exact cut in a way that mints chase it (Goodhart). Cuts are knobs; moving them often is a feature.
- **Routing starvation.** Pure predicate match fails when density is thin — same remaining bootstrap as LocalFlow.
- **Proof = prestige.** If the UI renders band as a crown, play has eaten access. Display default off. Play boards opt-in and must not consume these predicates as power.
- **Scheme lock-in.** BBS+ is the v3.1 default because selective disclosure is the common case. Circuits for decay/range. Post-quantum swap is a PLANETARY knob, not a founder key.
- **Company tether.** Cloud-model SignalFlow that also holds `sk` is not autarky. Proofs generated on someone else's GPU are someone else's copies. Same sentence as always: own hardware if you want unknown.

---

## What 3.0 should write

1. Dual commitments: XP and per-domain R, both epoch-stamped, decay in the statement.
2. Predicate list above as the reputation API. Not “getReputation(did)”.
3. SignalFlow default = edge predicate match + VRF. Coarse bands opt-in. No raw-R scheduler.
4. Sticky secret, unlinkable names, slash accumulator that follows the secret.
5. BBS+ for attributes, circuit for arithmetic. Don't pretend one wrapper covers mint, vote, and till.
6. Leave 2.1 frozen. `packages/identity` stays skeleton until this is a spec, not a vibe.
