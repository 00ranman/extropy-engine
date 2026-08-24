# Codex 3.0 — looking is a verb on the DAG

**Status:** Codex v2.1 stays frozen.
**Date:** 2026-08-23
**Companions:** `IDENTITY.md` (threshold reveal), `CODEX_3_NOTES_ZKP_REPUTATION.md` (predicates)

Do not warp this into a woods-privacy sermon. Google already has a file on people who sleep outside. Hermit anonymity is not the product. **Accountable looking** is.

---

## The actual question

Can a common person use the DAG to track someone if they try?

Yes. That is what a ledger *is*. The eight-domain graph, settled loops, evidence payloads, access-band proofs — if none of that can be walked, you have a church. If it can be walked in silence, you have Google with extra steps.

The requirement is: **a look is a vertex.**

Someone went in, pulled the threads, reconstructed a life from loops. That act is itself a loop-shaped event. It is not invisible. If the pattern is stalking, the system already has a dispute path, a slash accumulator, and a 7-of-12 reveal to current authorities. Governance votes whether that path is on, how loud it is, and what density of looks trips it. Not a founder key.

---

## Mechanics (under the floor)

`LOOK` is a vertex type (add next to `GENERIC` / credential issue — not in 2.1).

```
LOOK {
  looker:     nullifier(sk, dfao, epoch, "look")
  target:     commitment or public loop-id set they actually touched
  scope:      which predicates / vertices were opened
  purpose:    declared (dispute, curator, till, curiosity, …)
  timestamp:  epoch
  parents:    the vertices they read
}
```

Rules:

1. Reading more than the public predicate (band yes/no, “this loop settled”) **requires** emitting `LOOK`. The node that serves the payload will not return the body without a signed look vertex as parent. No silent fetch.
2. The looker can stay a nullifier *until* a governance threshold. Same shape as identity reveal: cause shown, DFAO-tunable. Curiosity is allowed. Invisible curiosity is not.
3. Target notification is a **knob**. MICRO might ping. MACRO might only flag after N looks in a window. PLANETARY default: log always, notify on density, unmask on vote.
4. A curator doing their job emits LOOKs too. Those mint XP if the look is the work (organizing, dispute). Stalking-shaped bursts do not. Pattern, not the verb, is the slash.
5. Integration with current society: a court / cop with a lawful ask still goes through the existing 7-of-12 (or whatever the DFAO voted). The new piece is **evidence that looking happened**, so “we had no idea someone was building a dossier” is not available as a lie.

ZKP here is not “you cannot be seen.” It is “the till gets a yes/no without a dossier, and the dossier-builder cannot pretend they didn't build it.”

---

## What this is not

- Not a promise that Google goes away.
- Not a dark forest where common people cannot check whether someone actually closed a loop.
- Not reputation-as-a-secret. Standing is reconstructable from the graph *if you are willing to leave footprints.* That cost is the deterrent, not cryptography-as-invisibility.
- Not automatic police. Reveal still wants cause + vote. The LOOK log is what they vote *on*.

---

## Relation to the other ZKP note

`CODEX_3_NOTES_ZKP_REPUTATION.md` still holds for **default** surfaces: tills, routing predicates, vote eligibility. Those stay coarse so everyday use isn't a dossier. The correction is the threat model: we are not defending a hermit. We are making **investigation expensive to hide.** If those two files conflict, this one wins on threat model; that one wins on till/routing predicates.

---

## What 3.0 should write

1. `LOOK` vertex. No silent body-fetch past public predicates.
2. Nullifier looker; unmask via the same reveal path as identity, cause shown.
3. Notify-density and unmask thresholds as DFAO knobs. PLANETARY for anything that talks to outside authorities.
4. Curator LOOKs can mint. Stalking-shaped LOOK bursts can slash.
5. Say the quiet part: privacy is already broken in the host society. This stack's job is a ledger of looking, not a cabin in the woods.
6. Leave 2.1 frozen.
