# The Contribution Graph

**Status:** Architectural invariant. Hard rule.
**Owner:** Randall Gossett
**Version:** v3.1.2 (canonical)
**Last updated:** 2026-05-08

---

## TL;DR

There is one primitive in the system: a **contribution**. Cleaning a roadside is a contribution. Witnessing a fragment of someone else's claim is a contribution. Reviewing a paper is a contribution. Filling a delivery is a contribution. They all live in the same graph. They are all surfaced, routed, completed, and rewarded by the same engine.

Validation is not a separate concept. It is a contribution class with specific routing rules. There is no validator role and no validation app. Witnessing happens because the right person, with the right coverage, was already doing the right kind of activity.

The substrate is theme-neutral. UIs can apply any theme overlay they want. The math, the routing, and the credentialing thresholds do not change.

---

## Naming Conventions (Hard Rule)

This document and every document written for this project uses canonical variable names with exactly one meaning each. No reuse. No ambiguity. If a future contributor needs a new symbol, they pick a fresh letter or coin a new term. They do not overload an existing one.

| Symbol | Meaning | Lives in |
|---|---|---|
| **R** | Rarity. Action-class scarcity per domain. Property of the contribution, not the actor. | XP formula |
| **F** | Frequency Decay. | XP formula, CT formula |
| **ΔS** | Entropy delta. Positive magnitude, disorder reduced. | XP formula, CT formula |
| **w·E** | Eight-domain effort weighting vector. | XP formula |
| **Tₛ** | Time-to-settle. | XP formula |
| **C** | Capability. | CT formula only |
| **ρ** | Reputation density. | CT formula only |
| **Δ** | Entropy delta in CT context. | CT formula only |
| **E** | Eight-domain weighting in CT context. | CT formula only |
| **L** | Local loyalty multiplier. | EP formula only |

**Tokens:** XP, CT, CAT, IT, DT, EP. Exactly six. No others. No legacy names (no GT, no RT).

**Reputation note:** ρ (reputation density) lives only in CT. Reputation never enters XP. R is Rarity, not reputation. This was the v3.1.2 fix and it is non-negotiable.

If a doc, a comment, a UI label, or a code variable reuses one of these symbols for a different concept, stop and flag. Do not silently introduce an ambiguous name.

---

## What a contribution is

A contribution is a unit of work in the graph. It has:

- A **type** (cleanup, witness, review, delivery, instruction, repair, sourcing-confirmation, and so on; open-ended).
- A **stakes class** (one of five, see below).
- A **domain signature** (which of the eight domains it touches, weighted).
- A **decay schedule** governed by F.
- An **R value** drawn from the per-domain rarity table.
- A **Tₛ** (deadline or expected settlement time).
- A **set of prerequisites** (CAT level, domain coverage, location, faction standing, or none).
- A **completion criterion** (what counts as done).
- A **reward** computed by the canonical math when completion is witnessed.

A contribution is not a ticket, a task, a chore, a job, or a quest. It is a contribution. The word is deliberate.

---

## The five stakes classes

The graph is one substrate. Inside it, contributions are routed through one of five lanes. The lanes have different rules because they have different stakes.

### High-stakes / credentialed
Surgeries, medical decisions, nuclear safety, structural engineering, irreversibly dangerous work. Hard CAT thresholds. Hard deadlines. Explicit assignment, never ambient routing. A user does not silently witness a heart surgery decision because they were buying groceries. Period.

### Civic / coordination
Roadside cleanup, neighborhood signal, mutual aid, lost dogs, school issues, infrastructure complaints surfaced from existing channels. Soft deadlines. Lower coverage thresholds than high-stakes. Higher routing volume.

### Everyday / habitual
Cooking, household, budgeting, exercise, learning loops. Wide eligibility. Most of the network's volume. Decay schedules are short and regenerative; these contributions refresh.

### Time-sensitive / event
Emergencies, evacuations, weather response, flash mobilizations. Latency tolerance is minutes, not days. Routing rules prioritize proximity and availability over coverage depth.

### Speculative / exploratory
Open research questions, experimental claims, science with no hard deadline but real epistemic weight. Long Tₛ. Higher CAT requirements for witness contributions. Lower volume, higher per-contribution significance.

The five classes are not apps and not interfaces. They are routing classes inside one graph.

---

## How contributions are surfaced

Five sources, each well-understood from existing systems. None of them require new vocabulary.

### 1. The open list
A browseable list of available contributions filtered by the user's coverage, location, stakes tolerance, and current CAT levels. The user opts in by browsing. They can claim what fits.

### 2. Direct request
Someone with standing offers a contribution to a specific user or a small filtered group. A merchant requesting sourcing confirmation from regular customers. A neighbor requesting help with a move from people in the area. A researcher requesting witness from peers with relevant CAT.

### 3. Threshold-triggered
A contribution becomes available because the user has crossed a threshold. Closed enough cooking loops to unlock community-meal contributions. Reached a CAT level that qualifies them for a civic role. The triggering is automatic; the user can ignore the unlock or take it.

### 4. Self-issued
A user files their own contribution. "I need this paper reviewed by three people with quantum coverage." "Help me move a couch this weekend." "My grandmother needs groceries Thursday." The system prices, classifies, and routes it the same way as any other contribution.

### 5. Signal-flow extracted
The signal flow layer reads existing channels (public neighborhood groups, civic complaint feeds, public emergency channels, opt-in private feeds) and structures latent demand into contributions. Nobody had to file a ticket. The neighborhood Facebook group venting becomes a structured contribution the network can route. This source is governed by explicit consent and source-filtering rules and is itself audited by the system.

---

## How contributions are routed

Routing is a function of:

- **Domain coverage match.** The user has earned XP in the domains the contribution touches.
- **CAT level.** The user meets or exceeds the contribution's prerequisite.
- **Decay-aware coverage.** The user's coverage is recent enough that decay has not eroded it below threshold.
- **Stakes class match.** High-stakes never routes ambiently. Everyday routes wide.
- **Geographic / contextual proximity.** Where physical presence matters, presence is a factor.
- **Availability signal.** What the user is currently doing, if surfaced through their interface.
- **Randomization within the eligible pool.** To prevent collusion and to spread load.

Routing never asks the user being witnessed to choose their witnesses. That rule is preserved from the canonical spec. Witnesses are environmentally assigned by the routing function from the eligible pool.

---

## Witnessing

Witnessing is a contribution class. There is no separate validator system. The witness rules:

- **A witness cannot be chosen by the user being witnessed.** Routed by the system.
- **A witness is often unaware they are witnessing.** Many witness contributions are tiny fragments completed as a side effect of the user's own primary activity. The user scans groceries; the scan also witnesses a sourcing claim. Aggregation happens behind the routing layer.
- **Some witness contributions are explicit.** High-stakes witnessing is always explicit, deliberate, credentialed, and acknowledged by the witness. Nobody silently witnesses a surgery review.
- **Witness contributions decay like all contributions.** A stale witness fragment expires and gets re-routed.
- **The witness pool is network-wide, filtered by domain coverage.** This is the cross-app implication: a user with high CAT in *informational* can be routed witness fragments from any app on the network where informational coverage is required, subject to all other routing rules.

CAT is the portable carrier of standing. CAT level X in domain Y is recognized everywhere on the network without further negotiation. CAT progresses on a log scale at 10 / 30 / 90 / 270 confirmed contributions per domain, as established in the canonical spec.

---

## Decomposition

Complex contributions are broken into smaller contributions before routing. A claim like "this household reduced food waste by 12% this quarter" decomposes into many fragment contributions: was the grocery list shrunk, were disposal events fewer, did the meal plan track. Each fragment is routed independently. Each fragment witness is aggregated. Verdict on the original claim is computed by the engine from the fragment results.

Decomposition is the engine's responsibility, not the user's. The user files the claim. The decomposer breaks it. The router dispatches. The aggregator reduces. The user sees a verdict.

---

## Hard invariants

1. **One primitive.** Everything is a contribution. There is no separate task, job, validation, or quest type at the architectural level.
2. **Stakes-aware routing.** High-stakes never routes ambiently. Everyday routes wide. The five classes have distinct rules and do not bleed into each other.
3. **No witness selection by the witnessed.** Witnesses are environmentally assigned. This rule survives every refactor.
4. **Decay applies to every contribution.** F is a property of the contribution itself, not just XP.
5. **Decomposition is the engine's job.** Users do not pre-decompose their own claims. They file. The engine breaks.
6. **Self-issued contributions get priced and classified by the system.** A user does not set their own R, F, ΔS, w·E, or Tₛ. They describe what they need. The engine assigns the parameters.
7. **The signal flow layer is consent-bound and source-filtered.** It surfaces latent demand from public or opt-in channels only. It is audited. It cannot exfiltrate private data into the contribution graph.
8. **Naming conventions are non-negotiable.** See the table above. Do not overload symbols.

---

## Optional theme overlays

The substrate is theme-neutral. UIs built on top of the contribution graph may apply any theme overlay the host app or the user prefers. Fantasy themes ("quests," "guilds," "ranks"), sci-fi themes ("missions," "factions," "tiers"), professional themes ("tasks," "teams," "levels"), minimalist no-theme, or anything else. The choice is fully open.

Theme overlays are cosmetic. They do not change:

- The math (R, F, ΔS, w·E, Tₛ, C, ρ, Δ, E, L all keep their canonical meanings).
- The routing rules.
- The credentialing thresholds.
- The five stakes classes.
- The witness rules.
- The decay schedules.
- The token set (XP, CT, CAT, IT, DT, EP).

Any theme that quietly mutates one of those is not a theme. It is a fork, and forks are out of scope for this document.

The default reference UI provided by the protocol is theme-neutral, plain-language, and serious in tone. Themed front-ends are downstream choices made by the host app or, where the protocol exposes user preferences, by the user.

---

## Cross-references

- **`THREE_LAYER_SEPARATION.md`** — establishes the user-facing / merchant-facing / engine separation. The contribution graph is how Layer 3 actually does its routing in practice.
- **Canonical math** — Appendix A and Chapter 8. R, F, ΔS, w·E, Tₛ are settled and are not redefined here. This document references them but never overloads them.
- **CHANGELOG** — v3.1.2 entry covers the R = Rarity fix that motivated the naming-convention guard above.

---

## Closing

One graph. One primitive. Five lanes. Five surfacing modes. Routing by coverage and stakes. Witnessing as a contribution class. Decomposition as engine work. Decay as universal property. Themes as cosmetic.

The system is a coordination layer for real work. It is described in plain language because the work is real. Themes are welcome. The substrate is invariant.
