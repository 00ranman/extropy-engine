#!/usr/bin/env node
/**
 * Two tills. Same customer. Base CT web unless you wrap.
 * Not the Codex. Not payroll. EP dies on the ticket.
 *
 *   node till.mjs
 */

const clip01 = (n) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

function ctW({ U, rhoW, C, P, F }) {
  return clip01(U * rhoW * C * P * (1 - F));
}

function ticket({ listPrice, xp, H_cap, S, kappa, CT, beta = 1, lambda = 0.15 }) {
  const clip01 = (n) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
  const L = clip01(H_cap * S * kappa * CT * beta);
  const EP = L > 0 ? xp * L + lambda * L : 0;
  const touch = Math.min(listPrice, EP);
  const cash = Math.max(0, listPrice - touch);
  return {
    listPrice,
    H_cap,
    S,
    kappa,
    CT: Number(CT.toFixed(4)),
    L: Number(L.toFixed(4)),
    EP: Number(EP.toFixed(4)),
    overlayTouch: Number(touch.toFixed(2)),
    cash: Number(cash.toFixed(2)),
    epBurned: true,
  };
}

const customer = {
  name: "Maya",
  xp: 4.2, // settled standing after leak — demo number
  web: "brentwood-base",
};

const grocery = {
  id: "grocery",
  name: "Oak Grocery",
  H_cap: 0.5,
  S: 0.8,
  kappa: 1,
  wrap: null,
};

const laundry = {
  id: "laundry",
  name: "Spin Laundromat",
  H_cap: 0.5,
  S: 0.8,
  kappa: 1,
  wrap: null,
};

// Same web, posted-task + reputation + coupling + predictability
const standing = ctW({ U: 0.8, rhoW: 0.7, C: 0.75, P: 0.8, F: 0.05 });

function sale(shop, item, price) {
  const r = ticket({
    listPrice: price,
    xp: customer.xp,
    H_cap: shop.H_cap,
    S: shop.S,
    kappa: shop.kappa,
    CT: standing,
  });
  return {
    shop: shop.name,
    web: customer.web,
    customer: customer.name,
    item,
    ...r,
    note:
      shop.kappa === 1
        ? "base CT — same standing as the other unforked door"
        : "wrap — other door does not inherit this unless they join",
  };
}

function banner(title) {
  console.log("\n══ " + title + " ══");
}

banner("TWO TILLS  ·  same customer  ·  base CT web");
console.log("CT_W", standing.toFixed(4), "  XP", customer.xp, "  H default", 0.5);

const g1 = sale(grocery, "milk + eggs", 8);
const l1 = sale(laundry, "wash + dry", 6);
console.log("\nOak Grocery receipt");
console.log(g1);
console.log("\nSpin Laundromat receipt");
console.log(l1);

banner("LAUNDRY WRAPS (no money rail)  ·  grocery stays base");
laundry.wrap = "spin-points-v1";
laundry.kappa = 0.4;
const g2 = sale(grocery, "milk + eggs", 8);
const l2 = sale(laundry, "wash + dry", 6);
console.log("grocery κ=1", { cash: g2.cash, touch: g2.overlayTouch, L: g2.L });
console.log("laundry κ=0.4 wrap", { cash: l2.cash, touch: l2.overlayTouch, L: l2.L });

banner("GROCERY JOINS THE WRAP  ·  published cooperative");
grocery.kappa = 0.4;
grocery.wrap = "spin-points-v1";
const g3 = sale(grocery, "milk + eggs", 8);
console.log("both on wrap κ=0.4", { groceryCash: g3.cash, laundryCash: l2.cash });

banner("CASH-WRAP  ·  κ = 0  ·  left the web");
laundry.kappa = 0;
const l3 = sale(laundry, "wash + dry", 6);
console.log("laundry cash-wrap", l3);
console.log("XP network still exists. CT no longer compatible. Overlay touch:", l3.overlayTouch);

banner("PARK H  ·  hard times / overlay off");
grocery.kappa = 1;
grocery.H_cap = 0;
const g4 = sale(grocery, "milk + eggs", 8);
console.log("H=0 vertex on the house", g4);

banner("CASH-ONLY CONTROL (same cart, no overlay)");
console.log({ item: "milk + eggs", list: 8, cash: 8, overlay: 0 });
