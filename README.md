> **v3.1 (2026-05-01) is the canonical spec.** See [`docs/SPEC_v3.1.md`](docs/SPEC_v3.1.md), [`docs/CHANGELOG.md`](docs/CHANGELOG.md), and [`docs/GAPS.md`](docs/GAPS.md) (63 open engineering gaps across 13 categories).
>
> **What's new in v3.1:** Digital Autarky vision, personal-AI + handshake model, mandatory hybrid identity (OAuth + on-device KYC + ZKP DID), Personal Signed Local Log, micro-quest marketplace with dynamic reward escalation, native substrate decision, three borrowed Holochain patterns renamed (PSLL, Validation Neighborhoods, Rule Modules). The `epistemology-engine` is **redefined, not removed** — v3.0 read it as a central decomposition service; v3.1 recognizes it as the mesh's emergent peer-review witness layer. Decomposition itself moves to personal AI at the edge.
>
> **Sandbox testing:** [`packages/node-handshake/`](packages/node-handshake/) implements the proof-of-concept VPS↔local-laptop handshake. See [`docs/VPS_NODE.md`](docs/VPS_NODE.md).

# Extropy Engine

A physics-grounded value accounting protocol. The unit of value is entropy reduction.

This is not a metaphor.

---

## The Claim

All genuine value creation is physically real disorder reduction. Landauer's principle establishes that information processing is thermodynamic — every bit stored, transmitted, or erased has a minimum energy cost. This means cognitive work, code quality, social coordination, governance decisions, and thermodynamic efficiency are all entropy reduction at different scales with different measurement instruments.

The Extropy Engine operationalizes that claim into a working protocol: a contribution loop that closes when validators reach weighted consensus on a measured ΔS, mints XP proportional to that reduction, and settles or burns that XP retroactively based on whether the measurement held up.

The Nash equilibrium is flipped. Honest contribution is the individually rational strategy, not the altruistic one.

---

## Core Formula

```
XP = R × F × ΔS × (w · E) × log(1/Tₛ)
```

| Variable | Range | Description |
|---|---|---|
| R | [0.1, 10.0] | Rarity/difficulty multiplier |
| F | (0, 1] | Frequency decay (diminishing returns on repeated actions) |
| ΔS | (0, ∞) | Verified entropy reduction. Must be > 0 to mint. |
| w · E | dot product | Weight vector × effort vector across energy dimensions |
| Tₛ | (0, 1] | Timestamp decay: `exp(-λΔt)`. Recency factor. |

`log(1/Tₛ)` enforces diminishing returns as closure time approaches the domain's causal closure speed. XP cannot be farmed by closing loops arbitrarily fast — the log curve kills that incentive.

The formula lives in one place: [`packages/xp-formula/src/index.ts`](packages/xp-formula/src/index.ts). Every service that mints XP imports from there. No reimplementations.

---

## Architecture

12 microservices, TypeScript strict mode, PostgreSQL (8+ schemas), Redis event bus, Docker Compose.

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
├── token-economy/      # 6 token types: XP, CT, EP, IT, GT, RT
├── temporal/           # Seasons, decay scheduling, loop timeouts
├── identity/           # v3.1: OAuth + on-device KYC + DID + ZKP (BBS+ default)
├── psll-sync/          # v3.1: Personal Signed Local Log maintenance + DAG anchoring
├── quest-market/       # v3.1: Micro-quest marketplace + dynamic reward escalation
├── validation-neighborhoods/ # v3.1: Sharded 1/10th blind-slice validation routing
└── node-handshake/     # v3.1 sandbox: VPS↔local-laptop proof-of-concept handshake
```

**v3.1 packages are skeletons.** Interface contracts are the source of truth; implementation is incremental. See each package's README for status.

The 6-token economy exists specifically to prevent the failure mode that killed most Web3 governance: token conflation. XP (reputation) is non-transferable. IT (governance weight) is non-transferable and decays at 5%/month. You cannot buy influence. You have to earn it, and if you stop contributing it bleeds out.

---

## Loop Lifecycle

Every contribution passes through the same lifecycle:

```
OPEN → VALIDATING → CONSENSUS → CLOSED → SETTLED
                                       ↘ FAILED
                              ↘ ISOLATED (integrity quarantine)
```

XP minted at CLOSED is provisional. After 30 days, retroactive validation either confirms or burns it. Validators whose consensus is contradicted by later evidence take reputation penalties. This is the primary defense against collusion: you have to hold your position while exposed.

---

## Known Attack Vectors and Honest Gaps

This is the section you should actually read before forming an opinion.

**Sybil resistance:** Cost of attack scales with number of loops that must be honestly completed per fake identity. Trivial loops produce near-zero XP (the `log` curve). Residual risk: domains with subjective measurement (social, governance) have lower Sybil cost than domains with objective measurement (thermodynamic, code). The empirical Sybil cost curve is unverified — that requires simulation against real claim distributions.

**Collusion:** Two-phase minting creates a 30-day exposure window. Retroactive slashing makes sustained collusion risky but does not prevent it. A cartel controlling >50% of domain reputation can self-validate indefinitely. Partial mitigation: the XP oracle layer ingests external platform data as independent verification. The oracle is currently specified, not built.

**Economic capture:** XP is non-transferable. IT decays. External capital cannot be directly converted into governance power. Residual risk: "corporate capture" — a well-funded adversary can employ real validators whose governance votes are externally directed. This is expensive but not theoretically prevented.

**Measurement gaming:** Each of the 8 entropy domains has explicit falsification conditions — observable outcomes that would invalidate the measurement instrument. If a domain's ΔS does not predict the real-world outcomes it claims to measure over a defined observation window, the instrument is declared miscalibrated and must be replaced.

**63 open engineering gaps** across 13 categories are catalogued in the full technical spec. Gaps are not hidden.

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
