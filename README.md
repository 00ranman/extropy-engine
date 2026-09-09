> **Canonical mint labels.** R is rarity of the action class. F is Frequency of Decay. ΔS is a bits-equivalent proxy, not XP. Tₛ is the slam window, not the 0.99ⁿ leak. L is this ticket. EP is the till spark (`EP = XP · L + λ · L`) and burns in the sale. Public letter key: https://extropyengine.com/key — meter math: https://extropyengine.com/docs/METER-MATH.md — gaps: https://extropyengine.com/open-problems
>
> Codex v2.1 stays signed. Code mint lives here in `packages/xp-formula`. If this README and the letter key disagree on names, the key wins.

# Extropy Engine

A value-accounting protocol. Standing comes from a closed loop with a declared boundary. You cannot sell that standing.

ΔS is a bits-equivalent **proxy** so eight domain-native measurements can sit on one graph. It is not SI social heat. Landauer is a conversion floor for erased information, not a license to add a lawn to a heat bath.

House rule: we do not play their markets. No offset registry. No transferable tonne. No cash-out.

---

## The Claim

Useful work is a drop in disorder you can put evidence under and argue with later. The Engine is the audit loop for that claim: both edges, a versioned mapper, provisional mint, late burn, leak.

Honest contribution is cheaper than farming a bag because there is no bag.

---

## Canonical Formulas

### XP — minted on every closed loop with verified ΔS > 0

```
XP = R × F × ΔS × (w · E) × log(1/Tₛ)
```

| Variable | Range | Description |
|---|---|---|
| R | [0.1, 10.0] | **Rarity** multiplier. Action-class scarcity / base difficulty. Property of the loop, NOT the actor. Reputation does not enter here. |
| F | (0, 1] | **Frequency-of-decay** penalty. Diminishing returns for repeated instances of this action class. |
| ΔS | (0, ∞) | Verified entropy reduction. Must be > 0 to mint. |
| w · E | dot product | Weight vector × effort vector across energy dimensions |
| Tₛ | (0, 1] | Slam window: `exp(-λ min(Δt, Δt_cap))`. Instant close → log = 0 → XP = 0. Not recency. Not the standing leak. |

`log(1/Tₛ)` zeros a slam-shut script. F eats repeats. Standing leak is a different clock: `0.99ⁿ`.

**Why R is rarity, not reputation.** Every mint multiplier describes the loop. Actor history in R is reputation laundering. Vote weight and door-local CT are other meters.

Defaults and who may change them: [`docs/DEFAULTS.md`](docs/DEFAULTS.md).


### CT, L, EP — community meter, house cap, this person, this ticket

CT_W is community standing. Same readout at grocery and laundry if they still speak base CT. The door does not own CT.

H_cap — this till this pocket. Auto from signed cash. Training remainder 0 for 40 days. No slider.
S — this person at this house.
β — CAT / on-duty proof this ticket. Not a wrap.
κ — 1 on the language. 0 if they left it.

```
L  = clip(H_cap · S · κ · CT_W · β, 0, 1)
EP = XP · L + λ · L
```

λ is small so leaked XP cannot erase a real local L. Clip EP to the list. Burns in that sale. Official skins show cash collected and the remainder, not raw XP.


### Ledger objects (five meters, not a six-token bag)

Public copy uses **record / meter / till spark**. The crowd hears “token” and reaches for Ethereum. Drop it.

| Object | Kind | Job |
|---|---|---|
| XP | Meter | Standing from verified ΔS. Non-transferable. Leaks `0.99ⁿ`. |
| CT | Meter | Community standing on web W. Same readout at compatible tills. |
| L | Meter | Local rank in `[0, 1]`. |
| EP | Till spark | `EP = XP · L + λ · L`. Born and burned in the sale. |
| CAT | Record | Skill credential in a **lane**. Unique. `(DID, lane, level, issuer)`. |
| IT | This proposal | clip(H_gov · S_gov · κ · CT_W · β_gov, 0, 1). Burns in the tally. |
| Domain | Enum | Eight entropy instruments. Not minted. |
| Lane | Field | Skill specialization. Claim is a signed vertex, not a dropdown. |

**DT is not a bag.** Old copy said Domain Token or Decay Token. Expertise is CAT-per-lane. The leak is already on XP. If the letter survives it is a unique lane-claim record, contestable, non-transferable. `TokenType.DT` in the wallet is leftover — remove it.

Five meters. Math letters are on https://extropyengine.com/math. Six was accretion. Do not grow a sixth bag.


The split exists so standing cannot buy votes and a skill stamp cannot print XP. See [`docs/CODEX_3_NOTES.md`](docs/CODEX_3_NOTES.md).

---

## Architecture

Scaffolds in TypeScript, PostgreSQL, Redis, Docker Compose. The public story is the meters and the loop, not a 12-service org chart. Skeletons stay skeletons until a door ships.

```
packages/
├── contracts/          # Shared types, interfaces, enums (~72KB). Single source of truth.
├── xp-formula/         # Canonical formula implementation. Pure function, no side effects.
├── loop-ledger/        # Loop lifecycle: OPEN → CONSENSUS → CLOSED → SETTLED
├── epistemology-engine # MESH OBSERVABILITY: aggregates emergent peer review,
│                       # surfaces consensus drift, falsifiability stats, Sybil clusters.
│                       # Redefined in v3.1 — NOT a central decomposition service.
├── signalflow/         # Validator routing: domain match × reputation × load × accuracy
├── xp-mint/            # Two-phase minting: provisional on close, confirmed or burned on settle
├── reputation/         # Per-domain reputation, 10 levels, decay mechanics
├── dag-substrate/      # DAG ledger: every action is a vertex with causal parents
├── dfao-registry/      # Fractal org structure: MICRO(2-7) → ECOSYSTEM(1000+)
├── governance/         # Proposals, conviction voting, quorum, execution
├── token-economy/      # XP, CT, L, EP, CAT, IT. DT wallet slot is leftover — kill it.
├── temporal/           # Seasons, decay scheduling, loop timeouts
├── identity/           # v3.1: OAuth + on-device KYC + DID + ZKP (BBS+ default)
├── psll-sync/          # v3.1: Personal Signed Local Log maintenance + DAG anchoring
├── quest-market/       # v3.1: Micro-quest marketplace + dynamic reward escalation
├── validation-neighborhoods/ # v3.1: Sharded 1/10th blind-slice validation routing
└── node-handshake/     # v3.1 sandbox: VPS↔local-laptop proof-of-concept handshake
```

**v3.1 packages are skeletons.** Interface contracts are the source of truth; implementation is incremental. See each package's README for status.

Archived standalones were folded here. `packages/levelup-academy` is held, not a school product. CAT + issuer is the overlay. See [`docs/ARCHIVED.md`](docs/ARCHIVED.md) and [`docs/CAT-LANES.md`](docs/CAT-LANES.md).

**Web3 as promised** lives in [`packages/mesh`](packages/mesh). Two boxes, signed loops, no bag. `node packages/mesh/demo.mjs`. Writeup: [`docs/WEB3.md`](docs/WEB3.md).


The ledger exists specifically to prevent the failure mode that killed most Web3 governance: **conflation**. XP (standing) is non-transferable. IT is this-proposal standing, clipped to 1, burned in the tally. You cannot buy a gavel. CAT is a skill **record**, not a pile.

---

## Loop Lifecycle

Every contribution passes through the same lifecycle:

```
OPEN → VALIDATING → CONSENSUS → CLOSED → SETTLED
                                       ↘ FAILED
                              ↘ ISOLATED (integrity quarantine)
```

XP minted at CLOSED is provisional. After one pocket (40 days), retroactive validation either confirms or burns it. Validators whose consensus is contradicted by later evidence take reputation penalties. This is the primary defense against collusion: you have to hold your position while exposed.

> **There is no validator class.** "Validator" throughout this repo means *a contributor while they are performing a validating task*, not a separate tier of people. Validation is itself an entropy-reducing task, so it is a contribution done by ordinary contributors. Most validation is blind or implicit: under 1/10th slicing a contributor scores a slice without knowing whose work it is, and many tasks confirm or contradict earlier tasks as a side effect of their own dependency on them, so the performer never knows they validated anything. The `epistemology-engine` reads validation out of the task graph as an emergent property; it does not appoint validators. This is what removes the review chokepoint and ends the "who watches the watchers" regress. See [`docs/VALIDATION_IS_EMERGENT.md`](docs/VALIDATION_IS_EMERGENT.md).

---

## Known Attack Vectors and Honest Gaps

This is the section you should actually read before forming an opinion.

**Sybil resistance:** Cost of attack scales with number of loops that must be honestly completed per fake identity. Trivial loops produce near-zero XP (the `log` curve). Residual risk: domains with subjective measurement (social, governance) have lower Sybil cost than domains with objective measurement (thermodynamic, code). The empirical Sybil cost curve is unverified — that requires simulation against real claim distributions.

**Collusion:** Two-phase minting creates a 30-day exposure window. Retroactive slashing makes sustained collusion risky but does not prevent it. A cartel controlling >50% of domain reputation can self-validate indefinitely. Partial mitigation: the XP oracle layer ingests external platform data as independent verification. The oracle is currently specified, not built.

**Economic capture:** XP is non-transferable. IT is not a pile. External capital cannot buy a gavel. Residual risk: "corporate capture" — a well-funded adversary can employ real members whose live CT and S_gov are directed. That is expensive labor, not a token sale.

**Measurement gaming:** Each of the 8 entropy domains has explicit falsification conditions — observable outcomes that would invalidate the measurement instrument. If a domain's ΔS does not predict the real-world outcomes it claims to measure over a defined observation window, the instrument is declared miscalibrated and must be replaced.

**Public gaps (7 Sep 2026):** 16 live on https://extropyengine.com/open-problems — 12 open, 4 specified but untested. Three old questions scratched (CT lockup, validator priesthood, universal ESF). The v3.1 “63/65” list is a legacy engineering inventory in [`docs/GAPS.md`](docs/GAPS.md). Do not quote 65 as the current number. Gaps are not hidden.


---

## Current Implementation Status

Phase 1 (protocol kernel) is complete: type system, event architecture, core loop lifecycle, XP formula, DAG data model, service scaffolding with working handshakes.

Phase 2 (organizational layer): DFAO governance, distributed DAG, full retroactive validation pipeline — specified, implementation in progress.

The happy path loop closes and settles. The adversarial path — validators disagreeing, getting slashed, reputation adjustments propagating — is the current build priority.

---

## 8 Entropy Domains

Cognitive, Code, Social, Economic, Thermodynamic, Informational, Governance, Temporal.

Each domain has: a measurement instrument, a measurement protocol, known failure modes, and a falsification condition. Domains differ in measurement maturity, not in physical reality. The thermodynamic domain is the highest-precision reference. The social domain has the least mature instruments. Both measure real physical processes at different scales.

---

## Quick Start

```bash
git clone https://github.com/00ranman/extropy-engine
cd extropy-engine
docker compose up --build -d
sleep 15
./scripts/test-happy-path.sh
```

```bash
# Build all packages
npm install
npx lerna run build --stream

# Tests (12/12 passing)
npx lerna run test --stream
```

---

## Full Specification

The complete technical documentation (19 sections, ~36 pages) covers: XP formula derivation, causal closure speeds, all 8 domain measurement protocols with falsification conditions, type system reference, database schema, event catalog, DAG deep dive, DFAO architecture, multi-token economy, adversarial modeling, governance system, mathematical foundations (Gödel, Tarski, Landauer, Lawvere).

Available on request / linked in repo wiki.

The accessible version of the theory — written for people who want to understand the argument without the type system — is the companion book: *Unfuck the World for a Dollar* by Randall Gossett.

---

## If You Want to Break It

That's the point. File an issue describing the attack vector, the domain it targets, and what you expect the outcome to be. The architecture was built by iterative adversarial pressure. More pressure makes it better.

---

## License

MIT. Build on it.

---

*Co-authored with AI assistance. The architecture, adversarial stress-testing, and iterative refinement are human work.*
