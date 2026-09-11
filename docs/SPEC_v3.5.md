# Extropy Engine v3.5 — Technical Specification

**Version:** 3.5
**Status:** Canonical engineering spec. Sandbox implementation in progress.
**Date:** 2026-09-11
**Maintainer:** 00ranman (Randall Gossett)
**Companion work:** *Unfuck the World for a Dollar*
**Signed Codex:** v2.1 remains signed. This document is **not** Codex 3.0. **v4.0 is reserved until Codex 3 ships.**
**Mint stamp in code:** `FORMULA_VERSION = 'canonical-v3.1.2'` in `packages/xp-mint`.
**License:** MIT

Public copies: https://extropyengine.com/docs/SPEC_v3.5.md · https://extropyengine.com/docs/extropy-engine-technical-docs-v3.5.pdf
Letter key: https://extropyengine.com/key
Defaults: https://extropyengine.com/docs/DEFAULTS.md
Gaps: https://extropyengine.com/open-problems

---

## Authority (read this first)

If two documents disagree, this is the order:

1. **[`docs/LETTERS.md`](./LETTERS.md)** / the public [letter key](https://extropyengine.com/key) — names. Do not remap.
2. **[`packages/xp-formula/src/index.ts`](../packages/xp-formula/src/index.ts)** — math. `computeXP`, `computeL`, `computeEP`, `computeIT`, `hCapFromCash`, `leakXP`, `leakCT`. No reimplementations.
3. **[`docs/DEFAULTS.md`](./DEFAULTS.md)** — knobs and who may change them.
4. **This spec** — engineering parent. Identity, PSLL, substrate, loop, packages, lookers, SignalFlow.
5. Codex v2.1 — signed civilizational document. Frozen. Do not silently rewrite it from this file.
6. [`docs/CODEX_3_NOTES.md`](./CODEX_3_NOTES.md) — capture for a later edition. Not a newer Codex.

---

## Abstract

Extropy Engine v3.5 is a contribution ledger for measuring verified entropy reduction across eight domains. It is a protocol for **Digital Autarky**: intelligence, identity, and local context stay at the edge. The network is a handshake, a claim schema, and a DAG — not a supermind.

Value is minted only when measurable disorder decreases under a declared boundary, with both edges agreeing, a versioned mapper, mint at close, late burn, and leak. Standing does not transfer. Standing does not cash out. A spark can die in a sale. Votes are not a wallet.

The `epistemology-engine` package is the mesh's emergent peer-review witness layer. Decomposition stays at the edge. There is no validator class. Looking is a vertex.

---

## 0. The machine as coded

The machine as coded. Not Codex 3.

- **Five ledger objects.** XP, CT, EP, CAT, IT. L is this-ticket math, not a sixth bag.
- **R = rarity of the action class.** Not reputation.
- **F = Frequency of Decay.** Repeats pay less. Falsifiability is script-ℱ.
- **ΔS is a bits-equivalent proxy.** Not XP. Unknown leakage stays unknown. You do not type a score.
- **Tₛ is a slam window.** Instant close mints 0.
- **CT_W is community-web standing.** Same readout at every compatible till. The door does not own CT.
- **H_cap is Auto from this till's signed cash.** No slider. No Off on the register. Training remainder 0 until 10 days of signed tickets (two 5-day weeks). Real Off = unplug.
- **L = clip(H_cap · S · κ · CT_W · β, 0, 1).** This ticket.
- **EP = XP · L + λ · L.** Spark. Born and burned in the sale. λ default 0.15. Clip to the list.
- **IT = clip(H_gov · S_gov · κ · CT_W · β_gov, 0, 1).** This proposal. Burns in the tally. Not a pile. Not `XP · G`.
- **Two clocks.** Leak ticks every **10 days** (`POCKET_KEEP = 0.99`, n = idle 10-day counts). Auto H and training read **10 days** of this till's signed cash. Same number, different job. Half-life of a mint ≈ 1.9 years.
- **Close mints.** Leak starts. Looking is a vertex. Late burn has no expiry.
- **Lookers.** No validator class. Self-close is valid. Late mint / late burn = NOW delta on a cited vertex.
- **SignalFlow is the protocol mouth. LocalFlow is the errand face.**
- **Public language:** record / meter / till spark. Domain (eight instruments) vs lane (skill). CAT is a record, off the mint.
- **Public gaps: 16 live** (12 open, 4 narrowed) as of 2026-09-07.

Digital Autarky, eight domains, personal-AI handshake, PSLL, native substrate, hybrid identity, micro-quest grain, and the mint product itself are unchanged.

---

## 1. What v3.5 is

A protocol and reference architecture for tracking **who does what**, not who has what. The ownership economy tracks assets, balances, and transfers. Extropy adds a contribution ledger that tracks verified entropy reduction by person, by context, by domain, and by time.

Five commitments:

1. Value is measurable as entropy reduction (bits-equivalent proxy, not SI social heat).
2. Entropy manifests across eight domains and their intersectionalities.
3. Intelligence belongs to participants at the edge, not to a central network brain.
4. Verification must be adversarially robust, privacy-preserving, and incentive-aligned. Looking leaves a vertex.
5. Governance stays fractal, composable, and bounded against permanent concentration. World standing does not buy extra gavels.

The companion novel makes the civilizational case. Codex 2.1 is the signed edition. This document specifies the machine as coded.

### 1.1 What v3.5 is not

- Not Codex 3.0. Capture notes live in `docs/CODEX_3_NOTES.md`. Leave 2.1 alone.
- Not spec 4.0. 4.0 is reserved for after Codex 3.
- Not a cryptocurrency, a church, or a theory of everything.
- Not hosted on extropyengine.com. That is a website. The Engine is the git you clone onto a laptop.
- Not six tokens. Not a till slider. Not a PTO bag. Not a cash-out.

---

## 2. Implementation status and honesty clause

This specification is canonical. The current codebase and any VPS instance running it are **not yet a production-hardened final realization**.

The Git repository and VPS deployment are a **sandbox** of the v3.5 architecture. Live engineering testbed. Not a hardened adversarial-internet node image. Not a recommendation to run the stack as-is on arbitrary public infrastructure.

The spec defines the protocol, service boundaries, trust model, meter loop, and validation logic. The repository is a kernel plus an evolving service mesh used to exercise the loop, test assumptions, expose failure modes, and close remaining gaps.

See [`docs/VPS_NODE.md`](./VPS_NODE.md) for the current sandbox-node posture.

P0 remains: first live till / one hostile door.

---

## 3. Digital Autarky

Every participant remains sovereign over their own intelligence stack, identity material, decision context, and local event history. The network does not become a supermind. The network becomes a coordination and accounting layer.

- Every user runs a personal AI or local multi-model consensus on their own hardware or node.
- That personal AI interprets real-world signals and private context locally.
- The network never needs raw personal context to coordinate shared work.
- Shared infrastructure is the minimum common substrate: claim exchange, routing, validation, rewards, receipts.

The protocol rejects:

- A central AI deciding what reality means.
- A central epistemology engine decomposing the world for everyone.
- A platform-owned private reasoning layer that becomes a hidden control point.
- A requirement that users expose raw identity material or full local logs to the network.

Full vision: [`architecture/AUTARKY.md`](../architecture/AUTARKY.md).

---

## 4. This is not a metaphor

Entropy reduction is the unit of all value, and this is not a metaphor. It is also not SI social heat.

ΔS is a **bits-equivalent proxy** so eight domain-native measurements can sit on one graph. Landauer is a conversion floor for erased information, not a license to add a lawn to a heat bath. You do not need a frozen joule for “mowed.” You need a stand-in that can drift when new measurements land.

House rule: we do not play their markets. No offset registry. No transferable tonne. No cash-out.

The domains differ. The instruments differ. The lose-conditions differ. **The underlying structure does not.** That is why the system can compare contributions across domains without collapsing into price worship.

> **Epistemic note.** Equivocation is on the table: Shannon bits, J/K, and English “order” are not the same object. Constants are what you worship. Proxies move. Each domain defines its own measurement protocol for what constitutes measurable disorder reduction. Unknown leakage stays unknown — it does not default to 0 so the mint can fire.

---

## 5. The eight domains

Every valid contribution claim must reduce entropy in one or more of these domains. They are a **protocol enum**, not user-minted coins. Skill specialization is a **lane**, not a domain. Do not use “domain” for both.

### 5.1 Cognitive
Disorder in knowledge, understanding, mental models, skill formation, conceptual coherence.
Examples: teaching, correcting a misconception, a curriculum, documentation that actually improves comprehension.
Instruments: assessment delta, retention, competency demonstration, knowledge-graph coherence.

### 5.2 Code
Disorder in software systems, architecture, maintainability, correctness, operational clarity.
Examples: a bug fix, a refactor of a brittle module, test coverage, complexity reduction.
Instruments: cyclomatic complexity, failing vs passing tests, error frequency, coverage, static analysis.

### 5.3 Social
Disorder in trust networks, cooperation, conflict dynamics, community coherence.
Examples: mediation, trust restoration, organizing a fractured group, reducing communication breakdown.
Instruments: conflict-incident reduction, participation quality, trust-survey changes, network-cohesion proxies.

### 5.4 Economic
Disorder in allocation, throughput, matching, waste, bottlenecks, coordination of scarce resources.
Examples: matching supply to need, removing a useless middle step, workflow efficiency, idle-capacity reduction.
Instruments: utilization, throughput, waste reduction, fulfillment times.

### 5.5 Thermodynamic
Physical disorder: waste heat, physical inefficiency, environmental degradation, energy loss.
Examples: insulation, recycling systems, waste reduction in production, restoration.
Instruments: energy-use delta, heat-loss reduction, material recovery, emissions changes.

### 5.6 Informational
Disorder in records, data quality, accessibility, signal-to-noise, archival coherence.
Examples: cleaning a dataset, organizing records, fact-checking, discoverability.
Instruments: error-rate reduction, completeness, retrieval latency, consistency scores.

### 5.7 Governance
Disorder in decision systems, accountability, legitimacy, responsiveness, rule coherence.
Examples: fixing a broken decision process, making accountability enforceable, reducing policy contradiction.
Instruments: decision latency, reversal frequency, participation quality, auditability.

### 5.8 Temporal
Disorder in time allocation, sequencing, synchronization, bottlenecking, operational cadence.
Examples: better scheduling, queue reduction, workflow sync, eliminating dead time.
Instruments: cycle time, wait time, scheduling-conflict reduction, throughput per unit time.

### 5.9 Intersectionality

The eight are not silos. A teacher may reduce cognitive, social, and temporal entropy in one act. The engine measures a domain vector and weights it contextually. `w · E` is that product. It is not a fifth letter and not a ninth domain called Emergence.

---

## 6. Canonical XP formula

```
XP = R × F × ΔS × (w · E) × log(1/Tₛ)
```

Lives in one place: [`packages/xp-formula/src/index.ts`](../packages/xp-formula/src/index.ts). Every service that mints XP imports from there.

| Letter | Range | Job |
|---|---|---|
| **R** | [0.1, 10.0] | **Rarity** of the action class. Property of the loop, not the person. |
| **F** | (0, 1] | **Frequency of Decay.** 1.0 the first time in class. Repeats pay less. |
| **ΔS** | (0, ∞) | Bits-equivalent proxy. Must be > 0 to mint. Not XP. |
| **w · E** | dot product | Eight-domain weights · this loop's effort / domain vector. |
| **Tₛ** | (0, 1] | Slam window. Instant close → log = 0 → XP = 0. |

`log(1/Tₛ)` zeros a slam-shut script. F eats repeats. Standing leak is a different clock: `0.99ⁿ`.

**Why R is rarity, not reputation.** Every mint multiplier describes the loop. Actor history in R is reputation laundering: past actions inflate new mints and compound forever. Reputation governs vote weight on *whether* a loop closes, and ρ in older CT sketches. It does **not** enter XP.

### 6.1 Tₛ — slam window, not recency

```
Tₛ = exp(−λ min(Δt, Δt_cap))
log(1/Tₛ) = λ · clip(Δt, 0, Δt_cap)
```

Δt → 0 ⇒ Tₛ = 1 ⇒ log = 0 ⇒ XP = 0. On purpose. Do **not** rewrite as `log(1 + 1/Tₛ)`. That pays slam-bots.

Δt_cap default: `DEFAULT_DELTA_T_CAP_SECONDS = 300` (quest grain 2–5 min unless the action class says otherwise). Unbounded λΔt is a stall-farm. Cap it.

Rarity-splitting 400 fake classes is a **DAG** job. The formula will not catch it.

### 6.2 Three clocks (do not mash)

| Clock | Job |
|---|---|
| **Tₛ** | This loop's elapsed time. Slam-shut at 0. Capped. |
| **F** | Repeating the action class. |
| **0.99ⁿ** | Standing after close. ~1% of remaining every 10 idle days. |

IT is this-proposal standing, not a leak clock. H_cap's 10-day window is the till's cash books (two 5-day weeks). None of those is Tₛ.

### 6.3 ΔS — proxy, mapper, unknown stays unknown

You do not type a score. SignalFlow + the model you trust + the PSLL propose a ΔS from the task, the duration, and evidence. Evidence (before/after photos and anything else) lives on the DAG as referencable payload. The other side has to agree (if-then).

```
domain-native signal  --M_v-->  ΔS_claimed   with uncertainty U on the vertex
```

M_v is mapper version v. Signed. Inspectable. Testable on known cases. Forkable. A new mapper does not silently rewrite old vertices. It writes a recalculation edge.

Accounting check, not extra Codex letters:

```
ΔS = ΔS_claimed − ΔS_leakage − ΔS_displacement − ΔS_unaccounted harm
```

If a term is unknown, the vertex says unknown. Unknown does not default to 0 so the mint can fire.

Open to a constant for “mowing a lawn.” Do not expect one. Words drift. Freezing a number and calling it physics is often an ontological sleight of hand. Start crude. Fine-tune as data arrives. `w · E` is where those terms live.

**Ordinary close:** target XP on the order of **0.01–1** for a MICRO loop (lawn, ride, ticket line). Planetary starting band. Rarity can lift it. A 100-XP lawn is a mapper bug.

### 6.4 Irreducible form

```
XP ≥ ΔS / cₗ²
```

`cₗ` is a domain-specific causal-closure speed — the empirical maximum rate at which validated information propagates within a given domain's measurement infrastructure. **Structural analogy to E=mc², not a physical law.** Pedagogical compression of the mint, not a second theory. Scoring the slogan as if it were the Engine is a category error.

### 6.5 Gates before the product lands

- ΔS > 0 after the mapper and the leakage check.
- Both edges agreed.
- Rights / consent fail ⇒ ineligible. Not “big ΔS minus an ethics haircut.”
- IT ignores XP. A mint does not buy a gavel.

---

## 7. Five ledger objects (not six bags)

Public copy uses **record / meter / till spark**. The crowd hears “token” and reaches for Ethereum. Drop it in public. Internals can keep `TokenType` until the wallet schema matches.

| Object | Kind | Job |
|---|---|---|
| **XP** | Meter | Global standing from verified ΔS. Non-transferable. Leaks `0.99ⁿ`. No cash-out. |
| **CT_W** | Meter | Community standing on web W. Same readout at compatible tills. Idle leak `0.99ⁿ`. |
| **EP** | Till spark | `EP = XP · L + λ · L`. Born and burned in the sale. |
| **CAT** | Record | Skill credential in a **lane**. Unique. `(DID, lane, level, issuer)`. Off the mint. Feeds β. |
| **IT** | This proposal | `clip(H_gov · S_gov · κ · CT_W · β_gov, 0, 1)`. Burns in the tally. No pile. |

**L, H_cap, S, κ, β, R, F, ΔS, w · E, Tₛ, λ** are **math**. They are not a sixth or seventh bag. Counting L as a sixth token is the accretion bug. L is first-class this-ticket standing; it is still not a transferable object.

**Dead letters:** GT, RT, DT as bags. Old copy said Domain Token or Decay Token. Expertise is CAT-per-lane. The leak is already on XP. `TokenType.DT` in the wallet is leftover — remove the balance; do not salvage the letter with a new pile. Mentorship `+0.1 CAT` is bag-shape. Kill it. Credentials do not steer XP mint.

**Six was never physics.** Six was accretion from an earlier wallet sketch (XP, CT, EP, IT, GT, RT). Do not grow a sixth bag because someone counted L.

The split exists so standing cannot buy votes and a skill stamp cannot print XP.

---

## 8. The till: H_cap, S, κ, β, L, EP

No till slider. No Off on the register. The real Off is: don't run the node.

```
L  = clip(H_cap · S · κ · CT_W · β, 0, 1)
EP = XP · L + λ · L
```

Then clip EP to the list price. Burns in that sale. Official skins show **cash collected and the remainder**, not raw XP on a forehead.

| Letter | Job |
|---|---|
| **H_cap** | This till, this pocket. Auto from signed cash. Training remainder 0. |
| **S** | This person at this house. 1.0 until this door has history. Spite/fake-proof cut on a short clock (default 5 days, one week). |
| **κ** | 1 on the language. 0 if they left it. |
| **CT_W** | Community meter. Same at every compatible till. |
| **β** | CAT / on-duty / signed if-then this ticket. Not a CT wrap. Default 1 if the door asked for nothing. Off the clock, drop. |
| **λ** | Small floor. Thin XP cannot erase a real L. Default 0.15. One number for the web. 10-day notice. |

Code: `computeL`, `computeEP`, `sparkTill`, `hCapFromCash`.

### 8.1 H_cap Auto (no slider)

```
trainedDays < 10  →  H_cap = 0     (training. Remainder sleeps. Feature.)
after that        →  H_cap = clip(0.5 × cash_in / cash_out, 0, 1)
```

- `cash_in` = drawer + overlay-touch.
- `cash_out` = inbound invoices + rent + payroll due in the window.
- Healthy books sit at 0.5.
- Empty window does not puff discounts.

H_cap is not a cashier control. A house that wants the layer off unplugs the node.

### 8.2 β — what counts, who attests

Counts:

1. CAT: `(DID subject, lane, level, issuer)`. On-duty bit attested for this interval.
2. Domain band the door asked for, as a ZKP (yes/no or band ≥ n). If the door asked for no bands, β = 1.
3. Signed if-then between two DFAOs on this language (fleet ↔ diner).

Does not count: a selfie, a punch card, a listed coin, “trust me I'm the manager” with no vertex.

Attest: issuer DID signs the interval. Subject DID holds the record. Issuer can revoke; spite revoke is a vertex on the issuer. Other rooms may ignore that issuer.

House may only **narrow** the β allow-list. Web W publishes the max. 10 days notice.

### 8.3 EP this sale

```
EP = min(XP · L + λ · L,  line × H_cap)
```

Spark cannot exceed the house cap on **this ticket**. XP is not dollars. Cash still rings the rest. Cash cannot mint XP. Fridge does not lock.

Early mesh: pennies off a fiat ticket. Dense mesh: more of what you owe. Not a currency. Not Epistemic Proof (letter collision; proof-layer records do not buy milk).

Buying is coupling, not a mint. Patronage can move CT_W on the web. The till only chooses H_cap (and H_cap is Auto).

### 8.4 Who may change what

| Knob | Who |
|---|---|
| XP mint shape, leak tick, cash-out forbid, ordinary-close band | Planetary. Fork to change. Cash-out is a lose-condition. If they vote it in, they forked. |
| λ, β allow-list max, H_gov, S_gov | Web W (MESO / city parent). Vertex. Notice as in [`DEFAULTS.md`](./DEFAULTS.md). |
| H_cap Auto, S, β this ticket | This house (MICRO). No slider. Training is a feature. |

This is not Randall's engine. He wrote the loop. Rooms run rooms.

---

## 9. CT_W — community web

CT_W is community standing on web W. **Same readout at grocery and laundry if they still speak base CT.** The door does not own CT.

- Idle leak `0.99ⁿ`, same keep as XP. n = idle 10-day counts on web W.
- A close / till spark / posted task on W resets the clock.
- CT does not travel to the next town. Compatibility is κ.
- Not purchased with XP. Not mopping floors. Regular demand here vs a random spike is S and the house's own history, not a second CT.

Do not write “grocery does not pay laundry” unless they forked.

Older sketches had a door-local `CT_d = clip(C_d · P_d · (1 − F_d^local), 0, 1)`. Coupling density and predictability still matter as **inputs this house may use for S** and for its own books. They do not mint a second community meter the door owns. The public letter is CT_W.

**Scratched:** CT lockup. CT is not a lockup bag. Limited-transferability language in older `GOVERNANCE_DEFAULTS.md` is dead.

---

## 10. IT — this proposal, then it burns

Full note: [`docs/IT.md`](./IT.md). Public: https://extropyengine.com/tokenomics/it

```
IT = clip(H_gov · S_gov · κ · CT_W · β_gov, 0, 1)
```

Not `XP · G`. That is an XP oligarchy. World standing does not buy extra gavels.

IT is not a pile. Born when a case is open. Burned in the tally. The receipt is the vertex.

A 5%/month leak on a balance still leaves a year-one holder at half voice after twelve quiet months. That is a gavel you sit on. **That line is dead.**

Clip to 1 means two years here and twenty years here can both sit at full voice. Extra years do not mint extra votes. New people climb by coupling (CT), not by buying IT.

Governance work still mints XP and can move CT, like any other closed loop. It does not mint a second meter.

| Letter | Job |
|---|---|
| **H_gov** | How hard standing counts this vote. Default 1. 0 = one DID, one nullifier. |
| **S_gov** | You in this room. 0 if you are not in it. Party to the dispute: 0. |
| **κ** | 1 on the language. |
| **CT_W** | Town coupling. Already idle-leaks at 1% per 10 idle days. |
| **β_gov** | Lane / CAT this case asked for. 1 if the room asked for nothing. |

Fractal:

- MICRO (this shop): S_gov is membership here. H_gov is the house.
- MESO / city: CT_W is the web. Tourists have S_gov = 0 unless a signed case says otherwise.
- PLANETARY grammar and cash-out are not IT votes.

Named cases still run without a meeting. Smart contracts. IT is only the unnamed case.

Code: `computeIT`, `sparkVote`.

Possible axiom, **not written:** some XP and some IT always burn. Floor, not a vibe. Capture for Codex 3. Do not implement a floor because a thought experiment sounded like a hole.

---

## 11. Leak, late mint, late burn

### 11.1 Two clocks (published)

| Clock | Default | Job |
|---|---|---|
| Leak tick | **10 days** | n in `0.99ⁿ`. Idle 10-day counts. XP and CT_W. Two 5-day weeks. |
| H window | **10 days** | Auto H_cap and training. This till's signed cash. Two 5-day weeks of books. Not the leak tick. |

Same *number* because 5 and 10 are the units. Different job.

```
XP(n)  = XP · 0.99ⁿ
CT(n)  = CT · 0.99ⁿ
```

`POCKET_KEEP = 0.99`. `LEAK_DAYS = 10`. `H_WINDOW_DAYS = 10`.

Half-life ≈ 69 ten-day ticks ≈ **1.9 years**. ~1 year ≈ 69%. ~5 years ≈ 16%. ~8 years ≈ 5%. A decade is dust. Never zero in the reals.

A week is **5 days**. 73 weeks. Seasons are orbit marks. Close mints. Leak starts. Looking is a vertex. Late burn has no expiry. If a room wants fresh XP out of EP, that is a haircut on XP→EP (too new, or no LOOK yet). One filter. Not a second XP.

### 11.2 Late mint

Citation-gated. A new vertex has to exist that names causal parents and hangs evidence. No citation, no edge, no XP.

You get the **delta of the proxy**, not a second full paycheck. Infinite downstream is cosmology, not a query. The protocol does not walk the light cone. A teacher whose student becomes president does not explode the graph.

Hop-weight is not frozen in Codex v2.1. Do not invent a fraction.

Decades later still has weight when a later huge, cited ΔS writes a delta into the original vertex. That is the long-horizon machine.

### 11.3 Late burn

XP can still be destroyed. No expiry. Five days later or a decade later.

You do not collect what decay already ate. You mark the vertex BURNED and slash remaining dust plus any new cited delta. Ordinary XP a decade on is already dust. Clawing a lawn from 1996 is bookkeeping. The DAG does not forget. The wallet does not get a 1996-shaped hole.

Late mint and late burn are the same machine, both directions.

### 11.4 Access economy

You do not spend XP. It gets eaten. You keep working (including your own lawn, rest, care) or the pile shrinks. There is no PTO token. Sick is not a clawback. Care is a loop for the person who shows up. Recovery can be biological ΔS if the loop closes.

---

## 12. Lookers — there is no validator class

Full note: [`docs/VALIDATION_IS_EMERGENT.md`](./VALIDATION_IS_EMERGENT.md). Looking: [`docs/CODEX_3_NOTES_LOOK.md`](./CODEX_3_NOTES_LOOK.md).

**There are no independent validators.** There are contributors performing entropy-reducing tasks. Some of those tasks happen to validate other tasks, and the person doing them often does not know it.

When you see “validator” in this repo, read it as **a contributor while they are performing a validating task**, not a person who holds a validator role.

Mint at close. Looking is a vertex. Parts of a claim, more than once, later. One neighbor is evidence, not a gavel. Self-close is valid.

Most validation is blind or implicit:

1. **Blind slicing.** A claim is split into 1/10th slices and routed to contributors who only see their slice. Aggregation produces the signal. The performer often does not know whose work they scored.
2. **Downstream overlap.** Task B building on A is partial confirmation of A if B succeeds for reasons traceable to A.

The `epistemology-engine` reads validation out of the task graph. It does not appoint validators. That removes the review chokepoint and ends the watcher regress.

**LOOK vertex (specified; not in Codex 2.1).** Reading more than the public predicate (band yes/no, “this loop closed”) requires emitting LOOK. No silent fetch. The looker can stay a nullifier until a governance threshold (same shape as identity reveal: cause shown). Curiosity is allowed. Invisible curiosity is not. Curator LOOKs can mint if the look is the work. Stalking-shaped bursts can slash. Pattern, not the verb.

A panopticon is one tower that can see every diary. This has neither. The PSLL is a file on your disk. The network sees a proof — yes or no — not the file. Anyone who later wants WHO writes a look vertex.

---

## 13. SignalFlow, LocalFlow, and the claim path

Stop attributing SignalFlow's job to LocalFlow.

**LocalFlow** replaces the pile: Uber, Lyft, DoorDash, Grubhub, plus the errand you cannot run because you do not have a car and someone else uses theirs. Post it. Someone nearby does it. You confirm. Confirmation is a receipt. Users never have to say XP. Density in a zone is still the remaining bootstrap problem.

**HomeFlow** is the household. Own lawn, meals, kids, the hinge. Same mint. You-mow-yours is one house taking care of itself. Neighbor-mows-yours is two households. Same physical ΔS. F still applies if it is every Saturday.

**SignalFlow** is the protocol UI. You talk to SignalFlow. It talks to:

- whatever assistant you trust (ChatGPT, Claude, Gemini, or a model on your own hardware / node),
- your personal log (PSLL),
- your previous numbers,
- the network.

Login-with-favorite-model is up to those companies. Until they allow it, you plug in what you can. Company login means company tether. If you want unknown + independent, you run your own hardware. A network-hosted decentralized model you can log into without owning the rack is a later idea, not a product today.

The assistant you trust *is* the UI. Character-sheet-ish is a sketch, not a spec. Do not freeze a skin in this document. Freeze the split: SignalFlow is the mouth. LocalFlow is a face.

### 13.1 Claim path (this is the lawn — including yours)

1. You mow the lawn. Your own counts. You do not put yourself in for “this much XP.”
2. SignalFlow talks to your LLM and the network: what is this task, how long did it take.
3. Supporting documentation attaches — before/after photos, etc. DAG stores them so they can be referenced later.
4. SignalFlow + LLM propose an approximate ΔS (if-then / smart-contract shaped).
5. Other side agrees → XP mints. Leak starts.
6. Lookers attach later, in parts. Late burn has no expiry. There is no promotion clock.

Work-for-a-boss is one input. Living was never inside that box. Anything verifiable: self-report, sensor, claim, assistant — then the other side agrees.

### 13.2 MICRO overselling → MACRO drift

The honest critique is: MACROs have to coordinate off MICROs; MICROs are subjective; people oversell; the numbers drift upward.

Do not deny that. Do not call it low-hanging fruit and walk away. The answer on the table is not “people are honest.” It is the claim path above: you do not type a score; evidence lives on the DAG; the other side agrees; looking is a vertex; late burn has no expiry; decay eats idle XP; a MICRO vote cannot rewrite a MACRO; only PLANETARY hits the mesh.

Unsolved (keep it unsolved): whether nesting actually stops a popular MICRO from laundering a story upward.

---

## 14. Personal AI handshake

Decomposition is a personal-AI responsibility. The engine itself is a witness (see §20.4).

### 14.1 Personal AI responsibilities

- Interpreting real-world requests, complaints, observations, and opportunities locally.
- Translating those into micro-claims.
- Decomposing them into short actionable quests, with **2–5 minutes** as the default task grain.
- Maintaining a local signed event history (PSLL).
- Producing claim packages suitable for network submission.
- Managing local identity and consent surfaces.

### 14.2 Network responsibilities

- Standardizing claim and quest schema.
- Routing via SignalFlow.
- Matching lookers (volunteer micro-slices by default; no validator class).
- Recording receipts to the DAG.
- Running mint, burn, and leak.
- Enforcing shared protocol rules.

The network does not get to decide what you meant. It does not get to own your local context. It does not get to accumulate hidden world models over everyone's lives. It only receives the minimum interoperable outputs necessary for shared action.

---

## 15. Identity and accountability

Hybrid identity: usability, privacy, Sybil resistance. Full spec: [`docs/IDENTITY.md`](./IDENTITY.md).

### 15.1 Constraints

1. Easy onboarding for normal humans.
2. Strong resistance to one-person-many-identity abuse.
3. No raw PII exposure to the network DAG.
4. Selective reveal under governance conditions.
5. Compatibility with local edge intelligence.

### 15.2 Canonical flow

1. User signs in locally using familiar credentials via OAuth or OpenID.
2. User performs a one-time on-device KYC binding (ID scan, biometric bind, or trusted issuer handoff).
3. Personal AI generates a DID and corresponding Verifiable Credential. Day-one node path: `did:key` on first boot, no registrar.
4. Credential is wrapped in zero-knowledge proofs (BBS+ default; zk-SNARKs supported) **when circuits exist**.
5. Network receives only proof material and per-context nullifier outputs required to establish uniqueness and permissions.

**Today the handshake is signatures.** ZKP circuits are not in Codex v2.1. 2.1 is the current Codex. Do not write “chip versus photocopy.” Handing the bartender the license is showing him the information. He needs 21 or not. The till gets yes or no. Anyone who later wants WHO writes a look vertex.

| Network sees | Network does not see |
|---|---|
| Proof of uniqueness | Raw identity documents |
| Proof of valid onboarding | Full biometric material |
| Contextual nullifier material | Private local onboarding state |
| Governance-relevant accountability hooks | Real-world identity tied to DID by default |

This is not optional anonymity. It is **selective privacy under enforceable accountability**. If governance thresholds are met under valid process, specific reveal or neutralization actions may be triggered against a DID. Default: **7-of-12 ecosystem-validator threshold-keyed escrow**, governance-tunable. “Validator” here means contributors performing that governance task, not a priesthood.

Sybil: identity is cheap, standing is not. Unique-in-DFAO stops fifty votes from one person. One captured node can lie about itself; it cannot silently rewrite a neighbor's DAG.

---

## 16. Personal Signed Local Log (PSLL)

Full spec: [`docs/PSLL.md`](./PSLL.md). Implementation skeleton: [`packages/psll-sync/`](../packages/psll-sync/).

The local append-only provenance log maintained by each participant's edge intelligence. Pattern borrowed (with credit) from Holochain's source-chain concept and reimplemented natively.

Must be: append-only, hash-chained, cryptographically signed, locally controlled, selectively disclosable.

The network does **not** ingest raw PSLL payloads. Periodic Merkle-root (or equivalent) commitment receipts are anchored into the DAG. Under dispute, subsets of the PSLL can be revealed with inclusion proofs or ZKP-based selective disclosure.

Without a local signed log, edge intelligence is hand-wavy. With PSLL, the system gains provenance without surrendering sovereignty. SignalFlow reads it. The mesh gets receipts, not the diary.

---

## 17. Micro-quests and the marketplace

Full spec: [`docs/QUEST_MARKET.md`](./QUEST_MARKET.md).

Real-world requests become structured micro-claims through personal AI / SignalFlow mediation. Default grain: **2–5 minutes**. Larger work composes from micro-quests.

Quests are published into a marketplace where SignalFlow routes them based on skill profile, location, current demand, availability, DFAO policy. (Older copy said “reputation.” Reputation is not a mint input. It may still inform routing weight for looker slices.)

**Dynamic reward escalation:** neglected work automatically gets higher potential XP until someone accepts. Linear 1.0× → 3.0× over 5 days (one week), then logarithmic to a cap of 10.0×. Governance-tunable. Per-DFAO override allowed.

Volunteer lookers can score **1/10th blind slices** of a claim without seeing the full context. Aggregation produces the signal. This dilutes single-looker influence and supports privacy. It does not create a validator class.

---

## 18. Substrate (final decision)

Extropy is a **native substrate end-to-end**. It is not a hApp on Holochain or any other existing framework.

Full Digital Autarky requires owning the lowest shared layer (handshake + DAG). Dependency on another project's plumbing would create a supply-chain control point we do not control.

Borrowed patterns, reimplemented natively, credit given:

| Holochain pattern | Extropy name | Purpose |
|---|---|---|
| Source chain | **Personal Signed Local Log (PSLL)** | Per-node append-only provenance |
| Neighborhood DHT | **Validation Neighborhoods** | Sharded looker load + task discovery |
| Zomes / DNA modules | **Rule Modules** | Composable, fractal DFAO inheritance |

Full spec: [`architecture/SUBSTRATE.md`](../architecture/SUBSTRATE.md).

**Web3 as promised** lives in [`packages/mesh`](../packages/mesh). Two boxes, signed loops, no bag. The atom is a loop, not a swap. TCP and QUIC already move packets. Don't invent ExtropyTCP. LAN first: next door talks node to node. Internet is for people who aren't next door. Writeup: [`docs/WEB3.md`](./WEB3.md).

---

## 19. Loop lifecycle

OPEN → VALIDATING → CONSENSUS → CLOSED. FAILED or ISOLATED if it does not close (integrity quarantine).

- **OPEN** — Task posted. Vertex on the DAG with causal parents. Evidence can hang off it.
- **CLOSED** — Agreement. XP mints. Leak starts. Burnable immediately.
- **BURNED** — A later verdict on that vertex. Same machine as late mint, the other way.
- **FAILED / ISOLATED** — Did not close, or integrity quarantine.

Anti-prisoner's-dilemma mechanics strengthen at ~10+ person rings (dynamic quorums, conviction voting). Goodhart pressure is treated as diagnostic fuel for instrument refinement, not a fatal flaw.

Smart contracts: named cases after both edges signed. No bag in the “then.”

---

## 20. Service architecture

Scaffolds in TypeScript, PostgreSQL, Redis, Docker Compose. The public story is the meters and the loop, not a 12-service org chart. Skeletons stay skeletons until a door ships.

### 20.1 Core protocol services

| Package | Status | Purpose |
|---|---|---|
| `contracts/` | Active | Shared types, schemas, single source of truth |
| `xp-formula/` | Active | Canonical meter math. Pure functions. |
| `loop-ledger/` | Active | Loop lifecycle state machine |
| `signalflow/` | Active | Claim routing and dispatch. The protocol mouth. |
| `xp-mint/` | Active | Mint at close. Burn anytime. Stamp `canonical-v3.1.2`. |
| `reputation/` | Active | Per-domain accuracy history. Does not enter XP. |
| `dag-substrate/` | Active | Causal DAG ledger, vertex/edge primitives |
| `dfao-registry/` | Active | Fractal organization registry |
| `governance/` | Active | Proposals, conviction voting, threshold execution |
| `temporal/` | Active | Seasons, decay scheduling, loop timeouts |
| `token-economy/` | Active | Meters and sparks (XP, CT, L, EP, CAT, IT). DT wallet slot is leftover — kill it. |
| `credentials/` | Active | Verifiable credential issuance/verification helpers |

### 20.2 Edge / identity / marketplace

| Package | Status | Purpose |
|---|---|---|
| `identity/` | Skeleton | OAuth + on-device KYC + DID + ZKP wrapper |
| `psll-sync/` | Skeleton | PSLL anchoring service (Merkle commitments to DAG) |
| `quest-market/` | Skeleton | Micro-quest marketplace + dynamic reward escalation |
| `validation-neighborhoods/` | Skeleton | Sharded micro-slice routing |
| `node-handshake/` | Skeleton | VPS↔local laptop proof-of-concept handshake |
| `localflow/` | Dev | Errand face |
| `homeflow/` | Pilot | Household loops |
| `mesh/` | Demo | Two boxes, signed loops, no bag |

### 20.3 Faces that are not the kernel

GrantFlow (discovery + proposer), neighborhood-app, character-sheet sketch. Collapsing the Engine into LocalFlow + SignalFlow is a reading error. Those are two packages. The book is xp-formula / xp-mint / loop-ledger / dag-substrate.

`packages/levelup-academy` is held, not a school product. CAT + issuer is the overlay. See [`docs/ARCHIVED.md`](./ARCHIVED.md) and [`docs/CAT-LANES.md`](./CAT-LANES.md).

### 20.4 Epistemology engine — still a witness

**What it is:** a peer-review mesh observability layer. The real epistemology engine is the network itself — every personal AI submitting claims, every looker scoring a slice, every retroactive burn. Truth-finding is what *emerges* from those primitives running on incentives at scale. The package is the formal witness, aggregator, and queryable surface.

**What it does:**

- Aggregates looker outcomes and surfaces consensus drift, dissent clusters, contested-claim patterns.
- Computes mesh-wide ℱ statistics (falsifiability distributions per domain, per DFAO). Not the letter F.
- Tracks accuracy-graph evolution and exposes Sybil-suspicious clusters.
- Surfaces emergent ontologies — recurring claim patterns, naming convergence, instrument standardization.
- Provides queryable hooks for governance proposals.
- **Does not** decide what is true. Does not perform claim decomposition. Does not arbitrate disputes. Does not own a private world model. Does not appoint validators.

Architectural posture: read-mostly; indexes the DAG; stateless under restart; multiple instances; no canonical engine instance.

---

## 21. DFAO — votes stay in the room

DFAO = Decentralized Fractal Autonomous Organization. NANO → MICRO → MESO → MACRO → PLANETARY are **labels for suggested rule-sets**, not headcount fences. Seven is not a law.

A vote rewrites the DFAO it is cast in (decay rates, quorum, notice). It does not rewrite the mesh. **PLANETARY** is the only room that hits everyone, and getting a vote through there is supposed to be hard — you are voting against everybody.

A neighborhood can run this as a MESO wrapper, not a deed eraser. HOA jobs become LocalFlow loops. Liens and architectural control stay on the recorded paper until that paper changes.

---

## 22. Overlay, not a new civilization

You convert one that exists. Shops, licenses, neighborhoods, the handshake already on the wire. Both-edges, contest, leak, DAG go on top of infrastructure people already use. Greenfield is a fantasy of a clean page.

An off-system credential is **opening evidence** for a CAT record: issuer = the old board, lane = the practice. Not XP. Not IT. Not a throne.

Once they are in, this graph is what continues. Retired weight that can issue new CATs and argue rarity in that lane is DAG history in here, not the framed diploma. If the paper was a lie, contest and late burn still apply. License is the door. It is not the house.

Do not invent a bootstrap bag to hold this. Doctor is one example. Same for electricians, teachers, welders.

Import path (lanes): finish the thing on their site → packager on *your* box pulls *your* export → hash the file → vertex (DID, lane, time, evidence hash) → raw stays on the box. The mesh sees the hash. Looking at it writes another vertex. No OAuth “connect Extropy.” Two-way sync is a forehead.

Kids: DID allowed. A closed loop they actually did can mint. No public forehead. They also do not carry adult bills. Care is not the mint's job. A DFAO, a church, a desk can be the room that tracks volunteer loops and pays the care in cash and time.

---

## 23. Carbon as a door, not a credit

Same meters. Different domain-native input. Still not their game.

What they sell: a bag labelled 1 tCO₂e that you transfer and retire for a claim.

What this overlay does:

1. A carbon / kWh / leakage loop is posted with a declared boundary.
2. Mapper M_v turns the domain-native signal into ΔS. Unknown leakage stays unknown.
3. Signed mint if ΔS > 0.
4. That standing leaks. It does not list on a registry.
5. At a till that asked for this instrument, a ZKP band can sit in β and move L.
6. EP still burns in that sale. The spark is the better version of the “credit.” It dies when the ticket dies.

No secondary market in tonnes. No net-zero sticker bought off someone else's forest. Theater gets a late-burn edge. F still hits plant/unplant farms. A DFAO may vote a carbon band into its door. Room modifier. Not Article 6.

---

## 24. Published defaults

Published before the first live till. Humans will ask. “The MACRO publishes it” is an answer only if the numbers exist. Full table: [`docs/DEFAULTS.md`](./DEFAULTS.md). Companion: [`docs/GOVERNANCE_DEFAULTS.md`](./GOVERNANCE_DEFAULTS.md).

### Planetary (fork to change)

| Knob | Default |
|---|---|
| XP mint shape | R × F × ΔS × (w · E) × log(1/Tₛ) |
| Leak tick | 10 days |
| XP leak | 0.99 per 10 days (~1% of remaining). n = idle 10-day counts. |
| CT leak | Same keep. Idle on web W. A close / till spark / posted task on W resets n. |
| H window | 10 days (two 5-day weeks of signed cash) |
| IT | clip(H_gov · S_gov · κ · CT_W · β_gov, 0, 1). No pile. |
| Cash-out of standing | Forbidden. Lose-condition. |
| Ordinary close | 0.01–1 XP for a MICRO loop |
| Lookers | Mint at close. Looking is a vertex. No validator class. |
| EP this sale | min(XP · L + λ · L, line × H_cap) |
| ZKP scheme | BBS+ (when circuits exist; signatures today) |
| Reveal threshold | 7-of-12 + cause-shown |
| Late burn | No expiry |
| Domain weights w | 1.0 default per domain (per-DFAO override) |
| Default task grain | 2–5 minutes |
| Validation slice | 1/10th blind |
| Reward escalation | linear 1.0× → 3.0× over 5d, log to cap 10.0× |
| Δt_cap | 300 seconds unless the class says otherwise |

### Web W

| Knob | Default |
|---|---|
| λ | 0.15. 10-day notice. One number for the web. |
| β allow-list (max) | CAT on-duty, asked domain band, signed if-then. 10 days notice. House may only narrow. |
| H_gov | 1. 0 = one DID one nullifier. |
| S_gov | 1 if in the room, else 0. Party to the dispute: 0. |

### This house (MICRO)

| Knob | Default |
|---|---|
| H_cap | Auto from this door's signed cash. Not a control. |
| Training | Remainder 0 until 10 days of signed tickets. |
| H_cap auto (after training) | clip(0.5 × cash_in / cash_out, 0, 1) |
| S | 1.0 until this door has history. Fake-proof / spite cut default 5 days. |
| β this ticket | 1 if no proof asked; else the live proof. Off the clock, drop. |

Process: proposed number + reason on a vertex → delay (above) → effective time on the vertex. Old tickets keep the old knobs. Unplug is how overlay stops. That is not a cashier button.

Every knob has a default so the system has shape now. Every knob is votable at the tier named. Nothing is locked except the lose-conditions (cash-out, silent rewrite of a neighbor's DAG, mapper that silently mutates history). Those are ℱ, not knobs.

---

## 25. Falsification (ℱ, not F)

Each domain's measurement protocol is falsifiable. If domain XP scores show no correlation with independently measured outcome metrics over a defined window with a defined N, that domain's measurement protocol is invalid and must be revised.

Lose-conditions (script-ℱ):

- Cash-out of XP.
- Silent rewrite of a neighbor's DAG.
- Mapper that silently mutates history.
- Rights / consent used as a haircut instead of a gate.
- Display of a mesh-wide forehead average of a person.
- Playing their carbon market: issuing a transferable tCO₂e, selling it, or calling EP an offset.

A DFAO can fork. It does not get to call the fork Codex v2.1. It does not get to call the fork spec 3.5.

---

## 26. Attacks and honest gaps

This is the section you should actually read before forming an opinion.

**Sybil.** Cost of attack scales with number of loops that must be honestly completed per fake identity. Trivial loops produce near-zero XP (the slam window). Residual risk: domains with subjective measurement (social, governance) have lower Sybil cost than domains with objective measurement (thermodynamic, code). Empirical Sybil cost curve is unverified.

**Collusion.** Close mints. Late burn makes sustained collusion risky but does not prevent it. There is no validator class to buy. Residual: a well-funded adversary can employ real members whose live CT and S_gov are directed. That is expensive labor, not a token sale.

**Economic capture.** XP is non-transferable. IT is not a pile. External capital cannot buy a gavel. L-extraction (a captured house juicing H_cap) is the remaining economic attack. H_cap is Auto from signed cash, which removes the slider. Unsolved experimentally: whether a captured house can still extract. That's a test, not a vibe.

**Measurement gaming.** Each of the eight domains has explicit ℱ conditions. If a domain's ΔS does not predict the real-world outcomes it claims to measure, the instrument is declared miscalibrated and must be replaced.

**MICRO → MACRO drift.** Acknowledged. Mechanism: no self-score, evidence on the DAG, if-then, late burn, leak, votes stay in the room. Nesting as a solvent is unsolved.

**Public gaps (2026-09-07):** **16 live** on https://extropyengine.com/open-problems — 12 open, 4 specified but untested.

Most significant still-open engineering questions:

- Gödel Boundary Watchdog: paradox-safe self-referential claim handling remains incomplete.
- `cₗ` calibration bootstrap: per-domain propagation constants need operational data we do not yet have.
- Network density threshold: voluntary adoption may not reach minimum density without institutional backing. LocalFlow density in a zone is the remaining bootstrap problem.
- First live till / one hostile door (P0).
- Whether nesting stops a popular MICRO from laundering a story upward.

These are features of an honest engineering specification, not buried caveats.

---

## 27. What 3.5 does not decide (leave for Codex 3 / spec 4.0)

Do not invent a letter to fill these.

1. Whether a burn-floor axiom exists (some XP and some IT always burn).
2. Hop-weight on late mint. Not frozen in 2.1. Do not invent a fraction here.
3. Character-sheet skin. Freeze the SignalFlow / LocalFlow split, not a UI.
4. The box as a for-profit product (compute, PSLL, optional sensor). Intended later. Not shipping. Clone-the-repo is not the product. Act as a non-profit while being a for-profit: salary + lights, surplus into R&D and nodes. Not a 501(c).
5. Network-hosted decentralized model you can log into without owning the rack.
6. ρ (fiat residual index) as a published till aggregate. Working note in public meter-math. Not a ninth letter. Not in this kernel pass.
7. Wallet DT / CAT amount-mints still in `token-economy`. Specified dead. Kernel cleanup is follow-on, not a spec bump to 4.0.
8. Codex 3.0 itself. Capture notes are not a newer Codex.

---

## 28. Code map

| Want | Where |
|---|---|
| Mint, L, EP, IT, leak, H_cap | `packages/xp-formula/src/index.ts` |
| Mint stamp `canonical-v3.1.2` | `packages/xp-mint` |
| Letter names | `docs/LETTERS.md` |
| Knobs | `docs/DEFAULTS.md` |
| IT | `docs/IT.md` |
| Lookers | `docs/VALIDATION_IS_EMERGENT.md`, `docs/CODEX_3_NOTES_LOOK.md` |
| Identity | `docs/IDENTITY.md` |
| PSLL | `docs/PSLL.md` |
| Quests | `docs/QUEST_MARKET.md` |
| Autarky | `architecture/AUTARKY.md` |
| Substrate | `architecture/SUBSTRATE.md` |
| Web3 as promised | `docs/WEB3.md`, `packages/mesh` |
| Gaps | `docs/GAPS.md` |
| Codex 3 capture (unsigned) | `docs/CODEX_3_NOTES.md` |
| Signed Codex | v2.1 PDF on extropyengine.com |

---

## 29. References

- Gossett, R. *Unfuck the World for a Dollar.* 2026.
- Gossett, R. *Extropy Codex v2.1 Comprehensive Edition.* Signed. August 2026.
- Gossett, R. *XP Timekeeping System / Universal Times v4.2.* 2026.
- Shannon, C. E. (1948). A mathematical theory of communication.
- Landauer, R. (1961). Irreversibility and heat generation in the computing process.
- Bennett, C. H. (2003). Notes on Landauer's principle, reversible computation, and Maxwell's Demon.

---

*Co-written and curated by Randall Gossett. The system is designed to be falsifiable, not infallible. Every domain defines what would prove it wrong. That is the difference between engineering and ideology. Codex 2.1 stays signed. This is the machine as of 3.5.*
