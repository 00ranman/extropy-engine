---
# Extropy Engine
## The protocol on one page

The mission: put entropy on a leash. Local pockets of sanity play a game on a ledger that gets less stupid over time.

This page describes the protocol only. Apps built on it and the movement around it are listed at the bottom, where they belong. Engineering spec is SPEC_v3.5.md. If this page and the spec disagree, the spec wins.

## The mechanism

You do a verifiable thing. The protocol scores the work, scores how it landed, and the till converts it into spending power. Five ledger objects, not tokens: XP, CT, EP, CAT, IT.

**XP** is the work score. XP = R x F x ΔS x (w·E) x log(1/Ts). R is how rare the action class is, never your reputation. Reputation never enters this product. F makes repeats pay less. ΔS is the bits-equivalent proxy of disorder actually reduced, proposed by the loop, never typed in by hand. w·E weights it across eight domains. Ts is the slam window: close a loop instantly and it mints zero.

**CT** is the reception score. Community standing on your local web. It feeds the till and the tally. It never touches XP. It leaks slowly when idle and it does not travel between webs.

**L** is local coupling, clipped between zero and one. **EP** = XP · L + λ · L, with λ at 0.15. EP dies in the sale: it buys the discount and then it is gone. There is no EP pile to hoard.

**IT** is influence in the tally. It burns when used. It is not a pile and it is not bought with XP.

**CAT** is the capability record: who you are, what lane, what level, who issued it. It feeds the weighting. It stays off the mint.

## The hard rules

No validator class. LOOK is a vertex: one neighbor saying "I saw it" is evidence, not a verdict. Nobody gets a gavel.

You do not score yourself. SignalFlow proposes the entropy delta. You do not type the mint.

Identity is did:key on your own node. No Google, no KYC, no registrar. Your log lives on your disk; the mesh gets receipts, not the diary.

The user-facing game is deliberately a different metric from the scoring function. Farm the visible one all day; it pays in fun, not in EP. That is how the measure survives becoming a target.

Fail closed. If verification fails, XP is zero.

## What would kill it

The design names its own falsifiers. If the cost of corrupting a witness can be driven below the maximum local benefit that witness can vouch for, the coupling fails. If stranger onboarding cannot be priced without recreating a club with a stamp, the stranger criterion fails. If adversarial testing shows fabricated identities earning room attention below the published cost, the design is wrong. If the ledger does not get less stupid over time, it is a costume.

## The layers, kept separate

The protocol is the index card above. Everything else is not the protocol.

App layer, four faces, equal: LocalFlow for people and errands, HomeFlow for houses and neighborhoods, the quest market for two to five minute work, the merchant till where cash still rings and EP dies in the sale.

Movement layer: the book, the papers, the music, the speaking. The movement carries the protocol into rooms. It is not the protocol.

A folder is not a face. A face is not the engine.
---
