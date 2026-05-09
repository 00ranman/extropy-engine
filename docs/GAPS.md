# Open Engineering Gaps — 65 across 13 Categories

**Source:** Section 19 of v3.1 spec
**Total:** 65 (63 original + 2 added 2026-05-06)
**Updated:** 2026-05-06
**Note:** Categories and counts are verified. Per-gap descriptions are the v3.1 enumeration draft — reconciliation against the full PDF is welcomed via PR.

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
14. 4-factor weighting tuning (domain, rep, load, accuracy)
15. Cold-start validator bootstrapping
16. Geographic / language balancing in SignalFlow
17. Adversarial-load shedding policy
18. Sybil-resistant load distribution under burst traffic

### Cross-Domain Measurement Calibration (6, P1)
19. ΔS unit harmonization across 8 domains
20. Falsification-condition spec for Cognitive domain
21. Falsification-condition spec for Social domain
22. Falsification-condition spec for Governance domain
23. Calibration drift detection + auto-replace policy
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

Gaps are not failures. They are the engineering backlog. Acknowledging incompleteness is a prerequisite for systematic completion.
