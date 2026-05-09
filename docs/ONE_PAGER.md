# Extropy Engine
### A two-sided market disguised as a loyalty program disguised as a discount engine.

---

## The pitch in one paragraph

Most reward systems are scams. They give you 2.2% back so you spend more, and they sell your data on the back end. Extropy Engine flips it: customers save real money by participating in habits that reduce waste, and merchants get a free point-of-sale, a customer pipeline, and operational signal better than legacy KPIs. Underneath both sides, a thermodynamically grounded coordination layer measures actual entropy reduction and pays out accordingly. Customers don't see the math. Merchants don't see the math. Both sides just feel the effects.

---

## The architecture (three layers)

**Layer 1 — User-facing.** Discounts, savings, gamified feedback. The user holds the keys to their own character sheet. Validators prevent forgery. The user holds the pen and the eraser. Reality holds the dice.

**Layer 2 — Merchant-facing.** Free POS, customer pipeline, deeper operational signal than KPIs. Merchants pay no SaaS. Revenue captured through standard merchant-services fees, undercutting incumbents.

**Layer 3 — The engine.** Six canonical tokens (XP, CT, CAT, IT, DT, EP) running on a decentralized ledger with validator consensus. The math is invariant under actor swap: same entropy reduction = same XP, regardless of who's reporting it. No reputation laundering. No Goodhart trap. Users can't farm a number they can't see.

---

## Why it works (the flywheel)

1. User self-reports a habit through an app or browser extension. Voluntary. Validators witness.
2. The engine mints XP from honest entropy reduction. EP = XP × L converts to merchant loyalty value.
3. User saves real dollars at participating merchants. Word spreads.
4. Customers walk into shops asking which businesses are on the network.
5. Merchants opt in. Free POS, standard rails, better signal, more customers.
6. Merchants begin self-reporting inventory and supply chain. Their data legibility improves.
7. Larger merchants register as DFAO nodes for deeper benefits. They become network infrastructure.
8. Multinationals join as nodes. Network effect compounds.

Each side gets more valuable as the other side grows. Classic two-sided market, except the network effect is **entropy-reduction efficiency**, not engagement.

---

## What this is not

- Not a credit score. Reputation never enters the XP formula. R is Rarity, an action-class property of the loop, not the actor.
- Not a social credit system. Users hold their own keys. The state cannot write to a user's record.
- Not surveillance capitalism. Self-disclosure is voluntary, and over-sharing does not earn more reward. Privacy is not a tax.
- Not a typical loyalty program. The reward isn't engagement, it's actual money saved. A user who participates once a month for a year gets paid for that. A grinder doesn't get more.
- Not a SaaS company. We don't charge merchants. We don't paywall users. We capture merchant-services fees instead.

---

## What it is

A coordination layer for honest behavior.

A way to make "doing the right thing" cheaper than the alternative, at scale, without surveillance, without coercion, and without an engagement-farming hellscape.

A protocol that pays people to be the kind of people they already wanted to be.

---

## The math (canonical v3.1.2)

```
XP = R × F × ΔS × (w·E) × log(1/Tₛ)
CT = C × F × ρ × Δ × E
EP = XP × L
```

- **R** = Rarity (action-class scarcity per domain). Property of the loop, never the actor.
- **F** = Frequency-of-decay. Rare actions decay slower; common actions decay fast.
- **ΔS** = Entropy delta of the loop. The actual measurable disorder reduced.
- **w·E** = Eight-domain weighting (thermodynamic, informational, social, economic, ecological, governance, cognitive, spiritual).
- **Tₛ** = Time-to-settle. Slower, harder, more durable contributions weight higher.
- **C** = Capability. **ρ** = Reputation density. **Δ** = Entropy delta. (CT-only.)
- **L** = Local merchant loyalty multiplier.

Multiplication is commutative. The math is invariant under actor swap. Verified.

---

## The business model

| Source | What we capture | What we don't charge for |
|---|---|---|
| Merchant-services fee | ~1.8% (vs 2.5–3% incumbents) | The POS itself |
| DFAO node registration | Tiered fees for deeper integration | The customer-facing app |
| Premium merchant analytics | Deeper signal beyond standard dashboards | Basic operational data |
| Treasury yield on EP float | Standard mechanism | User accounts |
| Multinational integrations | Specialized contracts | Network participation |

Two flywheel rules: **don't charge SaaS, don't paywall users**. Everything else is negotiable.

---

## What we need

- A first 100 customers (organic, through one merchant in one town).
- A first 5 merchants (free POS swap, no risk to them).
- One full loop of: customer reports → validator confirms → EP mints → discount redeems → merchant retains customer.
- Once that loop closes once, in production, at one location, the rest is replication.

---

## Why now

Existing loyalty infrastructure is decades behind what's possible. Existing point-of-sale software is overpriced and underbuilt. Existing reward systems are extractive. Decentralized identity, validator networks, and lightweight ledgers are mature enough to deploy. The gap between what exists and what's possible has never been wider, and the cost of building it has never been lower.

A solo developer with the right architecture can ship the first version. Network effects do the rest.

---

## Who's building it

Randall Gossett. Solo. Maxwell, Texas. Background: full-stack web, systems architecture, music production, publishing. Operating from first principles with a working understanding of quantum mechanics, information theory, and decentralized systems.

Looking for: collaborators, early merchants, technical contributors, advisors who get protocol-shaped projects.

---

## Contact

GitHub: [github.com/00ranman](https://github.com/00ranman)
Repo: [github.com/00ranman/extropy-engine](https://github.com/00ranman/extropy-engine)

---

*"The system isn't broken. It's working exactly as designed. We're building a different one."*
