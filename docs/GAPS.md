# Open Engineering Gaps — 63 across 13 Categories

**Source:** Section 19 of v3.1 spec
**Total:** 63
**Updated:** 2026-05-01
**Note:** Categories and counts are verified. Per-gap descriptions are the v3.1 enumeration draft — reconciliation against the full PDF is welcomed via PR.

---

## P1 — Critical Path (24 gaps)

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

## P2 — Important (23 gaps)

### DAG Distributed Consensus (5, P2)
25. Causal-edge gossip protocol spec
26. Partition tolerance + merge rules
27. DAG GC and pruning policy
28. Replay attack protection
29. PSLL-anchor receipt cadence

### Retroactive Validation Specifics (4, P2)
30. 30-day window edge cases (validator churn)
31. Burn-cascade limits when one loop's burn invalidates dependents
32. Settlement reliability under network partition
33. Retro-validation incentive structure

### DFAO Governance Edge Cases (5, P2)
34. MIGRATING-state hand-off protocol
35. Quorum loss recovery for MICRO tier
36. Conflicting proposals across nested DFAOs
37. Influence-decay edge cases on dormant members
38. Cross-tier proposal escalation rules

### Token Economy Equilibrium (4, P2)
39. IT 5%/mo decay rate validation
40. CT/EP/GT/RT decay rate finalization
41. Multi-token attack-surface analysis
42. Token-velocity equilibrium modeling

### Privacy and Access Control (5, P2)
43. ZKP scheme final selection (BBS+ vs zk-SNARK)
44. Selective-reveal threshold mechanics
45. Nullifier collision resistance proof
46. PSLL selective-disclosure protocol
47. Cross-DFAO data isolation

## P3 — Future (16 gaps)

### Skill DAG Design (3, P3)
48. Skill node progression criteria
49. Skill verification source-of-truth
50. Skill graph traversal for SignalFlow routing

### Oracle Integration Protocol (4, P3)
51. External-data ingestion trust model
52. Oracle-source diversity requirements
53. Oracle-failure fallback policy
54. XP minting from oracle-validated claims

### Performance and Scalability (5, P3)
55. Target throughput per Validation Neighborhood
56. PSLL local-storage growth bounds
57. DAG indexing strategy at planetary scale
58. SignalFlow routing latency targets
59. Cold-cache warm-up policy

### Migration and Upgrade Paths (4, P3)
60. v3.0 → v3.1 state migration spec
61. Breaking-change governance protocol
62. Rule Module hot-swap procedure
63. Deprecation lifecycle for retired services

---

## Legend

- **P1:** blockers for Phase 2 (24)
- **P2:** robustness + security (23)
- **P3:** ecosystem maturity (16)

Gaps are not failures. They are the engineering backlog. Acknowledging incompleteness is a prerequisite for systematic completion.
