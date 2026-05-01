# Cartel Threshold & Adversarial Validator Analysis

> Source: synthesis of an adversarial-loop simulation conversation. Documents the game-theoretic basis for why the Extropy Engine validator design resists collusion, plus an open vulnerability for follow-up.

## 1. Summary

Under the current XP / R / validator parameters, collusive validator cartels are **not** a stable Nash equilibrium once cartel size `N >= 10`. Defection (whistleblowing) dominates collusion because the retroactive-burn + whistleblower-reward mechanism makes the one-time defection payoff strictly larger than the ongoing per-person collusion share.

## 2. Model

Let:

- `N` = cartel size
- `X` = total XP produced by a collusive loop
- `P_b` = probability the loop is later burned (increases with `N`)
- `R_defect` = expected R gain from defecting (future loops won as an honest validator)

**Per-person share if collude:**

```
(X / N) * (1 - P_b)
```

**Defection payoff:**

```
0.50 * X  +  R_defect
```

Defection dominates when:

```
0.50 * X + R_defect  >  (X / N) * (1 - P_b)
```

With default parameters this holds for all `N >= 10`, even without the explicit 50% whistleblower payout (the `R_defect` term alone is sufficient to flip the equilibrium).

## 3. Payoff Matrix (default params)

| Strategy | Expected payoff |
|---|---|
| Collude | +83 XP / loop |
| Defect  | +500 XP one-time + R_defect (future loops won) |

Dominant strategy for `N >= 10`: **defect**.

## 4. Simulation Results (Adversarial Validator Loop)

Archetype mix at start: honest 50%, opportunistic 30%, cartel 20%.

- Cartel win-rate peaks at ~61% around loop 2,500.
- Honest validators accumulate enough R to outvote the cartel after that.
- By loop 4,000, cartel membership drops 20% -> 3%.
- Sybil infiltration (10 fakes) triggers mass defection and collapses the cartel.
- ~78% of loops settle to honest validation.
- End-state R: honest avg `R = 7.2`; cartel remnants `R = 3.1`.

## 5. Validator Parameters Referenced

- Routing: SignalFlow 4-factor weighting (domain match, reputation, load, accuracy)
- Weighted consensus threshold: `W_confirm >= 0.60`
- Min validators per loop: 3–7
- Retroactive validation window: 30 days
  - Burn loop XP
  - Slash R by 20%
  - Clawback 50% of issued XP
- Whistleblower reward: 50% of burned XP

## 6. XP Formula (canonical + relativistic cap)

Primary (code impl., emphasizes recency):

```
XP = R * F * ΔS * (w · E) * log(1 / T_s)
```

Irreducible / relativistic cap:

```
XP_max = R_max * ΔS * (1 - v² / C²)
```

Where `C` is the domain causal-closure speed (empirical constant per domain).

Variable ranges:

- `R` ∈ [0.1, 10]
- `F` ∈ [0, 1]
- `ΔS` ∈ [0, ∞)
- `w` ∈ [0, 5] (default 1.0)
- `E` ∈ [0, 1] (default 0.8)
- `t_s` ∈ (0, 1] normalized time

## 7. Multi-token Decay

- **XP** — non-transferable, 1% decay / 30 loops
- **CT** — 2% friction + 14-day lockup
- **IT** — non-transferable, 5% / month decay

## 8. Domains (8)

Cognitive, Code, Social, Economic, Thermodynamic, Informational, Governance, Temporal — each with its own ΔS instruments and falsification criteria.

## 9. Open Vulnerability

The relativistic cap on `XP_max` is robust, but `t_s` is **speed-farmable**: an attacker can shrink `t_s` to inflate `log(1 / T_s)` and game XP issuance. This is tracked as a separate issue (see Issues tab: “t_s speed-farming vulnerability in XP formula”).

## 10. Conclusion

The combination of retroactive burn, R slashing, whistleblower reward, and reputation decay shifts the validator Nash equilibrium from *collude* to *defect* to *honest* once cartels reach meaningful size. Empirically, ~78% of simulated loops settle to honest validation. The remaining attack surface is concentrated in `t_s` manipulation, not in collusion.
