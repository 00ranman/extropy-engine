# Open Engineering Gaps: 73 across 14 Categories

**Source:** Section 19 of v3.1 spec, plus Addendum A (2026-07).
**Total:** 73, computed as 65 core (63 original + 2 added 2026-05-06) + 8 in Addendum A (2026-07).
**Updated:** 2026-07-11
**Note:** Categories and counts are verified. Per-gap descriptions are the v3.1 enumeration draft; reconciliation against the full PDF is welcomed via PR. Addendum A uses stable IDs (X1 to X8) so the core numbering (1 to 65) is not renumbered.

---

## P1 — Critical Path (26 gaps)

### Consensus Mechanism Details (7, P1)
1. Quorum size formula for variable-domain rings
2. Validator collusion detection thresholds
3. Tie-break rules for split-quorum outcomes
4. Late-arriving validation vote handling
5. Consensus finality vs. retroactive-burn interaction
6. Cross-domain consensus weighting
7. Consensus failure recovery / re-validation protocol

### Economic Attack Resistance (6, P1)
8. Cartel threshold formal analysis (>50% domain rep)
9. Wash-loop detection across colluding identities
10. Bribery resistance under IT decay
11. Validator bid-rigging mitigation
12. Funded-validator (corporate-capture) defenses
13. CT lockup parameter optimization

### Validator Selection Optimization (5, P1)
14. 4-factor weighting tuning (domain, rep, load, accuracy). *Offline prototype added 2026-07-12 in `packages/validator-weight-lab/`; advisory analysis harness only, not adopted production behavior. Remains counted as open (not closed).*
15. Cold-start validator bootstrapping
16. Geographic / language balancing in SignalFlow
17. Adversarial-load shedding policy
18. Sybil-resistant load distribution under burst traffic

### Cross-Domain Measurement Calibration (6, P1)
19. ΔS unit harmonization across 8 domains
20. Falsification-condition spec for Cognitive domain
21. Falsification-condition spec for Social domain
22. Falsification-condition spec for Governance domain
23. Calibration drift detection + auto-replace policy. *Architecture adopted 2026-07-12 in [CALIBRATION_LIFECYCLE.md](./CALIBRATION_LIFECYCLE.md); implementation and external replication open. Remains counted as open (not closed).*
24. Inter-domain ΔS comparison weighting

### Verdict Vocabulary Standardization (2, P1) — *added 2026-05-06*
25. Canonical affirmative verdict values: `'confirmed'` and `'supported'` are both in use across validators and test scripts. A single canonical enum needs to be defined in `contracts/types.ts` and enforced at every validation boundary. The Epistemology Engine currently accepts both; that permissiveness should become explicit policy or collapse to one value.
26. API field naming consistency: `statement` vs `content` for claim text, `subclaims/by-claim/:id` vs nested route — these live in individual service codebases with no enforced contract. A shared OpenAPI validation middleware or contract test suite is needed.

## P2 — Important (23 gaps)

### DAG Distributed Consensus (5, P2)
27. Causal-edge gossip protocol spec
28. Partition tolerance + merge rules
29. DAG GC and pruning policy
30. Replay attack protection
31. PSLL-anchor receipt cadence

### Retroactive Validation Specifics (4, P2)
32. 30-day window edge cases (validator churn)
33. Burn-cascade limits when one loop's burn invalidates dependents
34. Settlement reliability under network partition
35. Retro-validation incentive structure

### DFAO Governance Edge Cases (5, P2)
36. MIGRATING-state hand-off protocol
37. Quorum loss recovery for MICRO tier
38. Conflicting proposals across nested DFAOs
39. Influence-decay edge cases on dormant members
40. Cross-tier proposal escalation rules

### Token Economy Equilibrium (4, P2)
41. IT 5%/mo decay rate validation
42. CT/EP/GT/RT decay rate finalization
43. Multi-token attack-surface analysis
44. Token-velocity equilibrium modeling

### Privacy and Access Control (5, P2)
45. ZKP scheme final selection (BBS+ vs zk-SNARK)
46. Selective-reveal threshold mechanics
47. Nullifier collision resistance proof
48. PSLL selective-disclosure protocol
49. Cross-DFAO data isolation

## P3 — Future (16 gaps)

### Skill DAG Design (3, P3)
50. Skill node progression criteria
51. Skill verification source-of-truth
52. Skill graph traversal for SignalFlow routing

### Oracle Integration Protocol (4, P3)
53. External-data ingestion trust model
54. Oracle-source diversity requirements
55. Oracle-failure fallback policy
56. XP minting from oracle-validated claims

### Performance and Scalability (5, P3)
57. Target throughput per Validation Neighborhood
58. PSLL local-storage growth bounds
59. DAG indexing strategy at planetary scale
60. SignalFlow routing latency targets
61. Cold-cache warm-up policy

### Migration and Upgrade Paths (4, P3)
62. v3.0 → v3.1 state migration spec
63. Breaking-change governance protocol
64. Rule Module hot-swap procedure
65. Deprecation lifecycle for retired services

---

## Legend

- **P1:** blockers for Phase 2 (26)
- **P2:** robustness + security (23)
- **P3:** ecosystem maturity (16)
- **Addendum A:** emergent exchange-rate architecture (8)

Grand total: 26 + 23 + 16 + 8 = 73.

Gaps are not failures. They are the engineering backlog. Acknowledging incompleteness is a prerequisite for systematic completion.

### Status annotations (2026-07-12)

Two P1 gaps received work in this cycle without being closed. The counts above are unchanged: both remain open and counted.

- **Gap 23 (Calibration drift detection + auto-replace policy).** Architecture adopted in [CALIBRATION_LIFECYCLE.md](./CALIBRATION_LIFECYCLE.md): CalibrationRecord schema, calibration state machine, independent-evidence drift detection, shadow evaluation with bounded replacement, freeze and rollback, and an anti-circularity rule. Implementation and external replication are open, so the gap is not closed. No numeric threshold, bound, or epoch length was set.
- **Gap 14 (4-factor weighting tuning).** An offline analysis prototype was added in `packages/validator-weight-lab/` as recommended by Candidate 2 in [GAP_FEEDBACK_CANDIDATES.md](./GAP_FEEDBACK_CANDIDATES.md). It is an advisory harness that evaluates a candidate weight vector against independent outcomes (retroactive burns, reversals, held-out verdict accuracy) with train and holdout separation, fails closed when no real historical dataset exists, and never writes production weights. It is not adopted production behavior, so the gap is not closed. No production weight defaults were invented.

---

## Addendum A: Emergent Cross-Domain Exchange-Rate Architecture (8, added 2026-07)

Context: [EMERGENT_EXCHANGE_RATES.md](./EMERGENT_EXCHANGE_RATES.md) adopts a two-tier normalization with an explicit, provenance-carrying, velocity-bounded, reversible exchange coefficient X_d for convention-tier domains. This addendum records honestly what that change did and did not do. It uses stable IDs so the core 1 to 65 numbering is untouched.

### What is resolved

- **Resolved architectural defect: hidden and static cross-domain equivalence.** Earlier drafts silently treated a bit in one domain as automatically equal to a bit in another, through an unversioned, unfalsifiable, implicit rate of 1. That specific defect is resolved at the architecture level: cross-domain comparison is now an explicit X_d conversion that must exist, carry provenance, and fail closed if it does not. This is an architectural resolution, not an empirical one; it removes a hidden assumption rather than proving comparability.

### What is reduced but not resolved

- **Reduced risk on gaps 19 and 24 (Cross-Domain Measurement Calibration).** Commensurability is now explicit, reversible, and fail-closed rather than hidden and static. This reduces the risk that the ledger silently performs arithmetic on incommensurable units. It does not close gaps 19 or 24: harmonizing units and weighting inter-domain comparisons still requires constructed operators and estimated rates. Gaps 19 and 24 remain open and counted in P1.

### What is still open (counted here)

- **X1. Per-domain M_d constructibility.** No convention-tier domain yet has a measurement operator M_d that satisfies the NORMALIZATION.md §4 invariants under real evidence. Priority P1. Related: gaps 19 to 24.
- **X2. X_d initialization.** There is no defined procedure for choosing an initial X_d at genesis, when no prior corroboration exists, without smuggling in an arbitrary default. Priority P1.
- **X3. Independent estimator and identifiability.** No estimator of X_d has been shown to be constructible from evidence independent of the ledger's own XP, and identifiability (that the evidence picks out one rate, not many) is unproven. Falsifiers XF1 and XF2 in EMERGENT_EXCHANGE_RATES.md §11. Priority P1.
- **X4. Evidence-density rules.** The declared minimum evidence density per epoch, below which a domain halts, is undefined. Priority P2.
- **X5. v_d and epoch-length calibration.** The velocity bound v_d and the epoch length are provisional and uncalibrated. No numeric defaults are set. Priority P2.
- **X6. Adversarial repricing resistance.** Whether a broad, quorum-gated repricing loop actually resists capture by a coordinating minority at feasible cost is unverified. Falsifier XF4. Priority P2.
- **X7. Persistent rate registry.** There is no implemented store for rate records, their provenance, prior values, and corroboration history, and no enforcement of the fail-closed provenance precondition in code. Priority P2.
- **X8. External validation of cross-domain comparability.** No empirical study has validated that any X_d reflects a real, stable relationship between domains rather than an accounting artifact. Priority P3.

Addendum A subtotal: 8 (X1 to X8). By priority within this addendum: P1 = 3 (X1, X2, X3); P2 = 4 (X4, X5, X6, X7); P3 = 1 (X8).
