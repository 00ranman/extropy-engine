# Two-till demo

Not a VM. Two shops in one process so you can see the receipts.

```bash
node packages/two-till-demo/till.mjs
```

Prints:

1. Oak Grocery + Spin Laundromat on **base CT** (same standing).
2. Laundry **wraps** — grocery does not inherit.
3. Grocery **joins** the wrap (cooperative).
4. Laundry **cash-wraps** — κ = 0, overlay dies, XP still exists.
5. Grocery **parks H** — vertex on the house, cash-only ticket.
6. Control cart with no overlay.

Formula used:

```
CT_W = clip(U · ρ_W · C · P · (1 − F), 0, 1)
L     = clip(H · κ · CT_W · β, 0, 1)
EP    = XP × L
```

Demo maps `$` touch as `min(list, EP)` so the numbers move on a receipt. Real mesh starts at pennies; do not treat this as a FX table.

No wallet. EP burned on every ticket. Not payroll.
