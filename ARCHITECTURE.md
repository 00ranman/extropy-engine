# Extropy Engine Architecture

> **Spine:** SignalFlow packages every claim and routes validation.
> **Center:** meters CT · EP · L · CAT · IT (+ XP mint).
> **Identity:** DID minted by **your own node** at install. No Google Auth. No KYC. No central customer registry.
> **Faces (same loop):** LocalFlow (person / errands) · HomeFlow (house / neighborhood) · quest market · merchant till (strip mall / EP). Same product everywhere: post → do → confirm.
> **Not the product:** grantflow-* is a personal grants.gov door — one footnote, never center, never multiple boxes.

Canon: Codex v2.1 · formula canonical-v3.12 · [extropyengine.com](https://extropyengine.com) · `packages/xp-formula` · `@extropy/meters`.

Identity: [`docs/architecture/IDENTITY.md`](docs/architecture/IDENTITY.md)  
Meters: [`docs/architecture/METER_CORE.md`](docs/architecture/METER_CORE.md)  
Diagram source: [`DIAGRAM.md`](DIAGRAM.md) · rules: [`docs/architecture/DIAGRAM_RULES.md`](docs/architecture/DIAGRAM_RULES.md)

## What the product is

You post a need. Someone nearby does it. You tap done. Confirmation is the receipt. That loop is the whole app ([extropyengine.com](https://extropyengine.com)).

SignalFlow is how the claim enters the protocol and how validation is routed. The kernel mints only after the loop closes both-edges-sign. Fail closed: no quorum / reject / missing signature → **no mint**.

## System map (draw this)

```mermaid
%%{init: {"theme": "neutral"}}%%
flowchart TB
  NODE["Your node\nmints DID"] --> FACE

  subgraph FACES["FACES — same loop: post → do → confirm"]
    HF["HomeFlow — house / neighborhood"]
    LF["LocalFlow — person / errands"]
    QM["Quest market — 2–5 min"]
    TILL["Merchant till — strip mall / EP"]
  end
  FACE["Any face"] --- HF
  FACE --- LF
  FACE --- QM
  FACE --- TILL

  HF --> SF
  LF --> SF
  QM --> SF
  TILL --> SF

  subgraph SPINE["SPINE"]
    SF["SignalFlow\npackages claim · routes validation"]
  end

  SF --> OPEN["Loop open"]
  OPEN --> DO["Someone does it"]
  DO --> CONFIRM["Both edges confirm"]
  CONFIRM -->|quorum| CLOSE["loop.closed"]
  CONFIRM -->|fail closed| NOMINT["No mint"]

  CLOSE --> XP

  subgraph METERS["METER CORE"]
    XP["XP mint\nR × F × ΔS × (w · E) × log(1/Ts)"]
    CT["CT_W\ncommunity meter"]
    L["L this ticket\nclip(H_cap · S · κ · CT · β)"]
    EP["EP till spark\nburns in the sale"]
    CAT["CAT record\nlane skill → β"]
    IT["IT this proposal\nburns in the tally"]
  end

  XP --> CT
  CT --> L
  CAT --> L
  L --> EP
  CT --> IT
  CAT --> IT
  EP --> TEMP["Temporal leak / re-verify"]
  IT --> TEMP
  TEMP --> OPEN

  subgraph SUBSTRATE["SUBSTRATE"]
    DAG["DAG / loop ledger"]
    VN["Validation neighborhood"]
    PSLL["Personal signed local log"]
  end
  SF -.-> VN
  CLOSE -.-> DAG
  NODE -.-> PSLL
```

## Layers

| Layer | What lives here | What does not |
|---|---|---|
| **Faces** | LocalFlow, HomeFlow, quest market, merchant till — UX for the same loop | Separate “apps” that invent their own mint |
| **Spine** | SignalFlow — claim package + validator routing | Grant proposers as protocol core |
| **Meters** | CT, EP, L, CAT, IT, XP | Bags / cash-out / DT mint |
| **Substrate** | DAG ledger, validation neighborhoods, PSLL, temporal leak | Central customer DB |
| **Identity** | Node-minted DID | Google / Apple / KYC / registry |

## LocalFlow (person)

LocalFlow is the errand face: a ride, groceries, the car you don’t have. Post it. Someone nearby does it. You tap done. Silent DAG emission. Not the till.

## Merchant till (strip)

The till is the neighborhood business face: cash still clears; the overlay runs beside the register as a check while the DAG learns. Absorption is ρ climbing, not a launch date. Settlement uses EP (till spark) — born and burned in the sale. Code: `sparkTill` in `xp-formula`, demo in `two-till-demo`. There is no `MerchantFlow` package.

## HomeFlow (household)

HomeFlow is the household / neighborhood chore and favor face. Same loop: post, do, confirm. Same SignalFlow package. Same meters.

## SignalFlow (spine)

SignalFlow packages the claim and routes validation (domain × standing × load × accuracy → neighborhood). It is not “another app beside HomeFlow.” It is how every face talks to the kernel.

## Identity (non-negotiable)

1. Protocol identity = DID created when you stand up **your own node**.
2. No Google Auth, Apple login, KYC vendor, or central user registry.
3. No central hub that runs Extropy for everyone. Nodes verify closed loops. Standing lives on meters.
4. Lose the DID without backup → start over.
5. **CAT** is a skill record (lane credential), not login and not KYC.

## Rules for any generated diagram

1. Draw **SignalFlow** as the only router between faces and meters.
2. Label **CT, EP, L, CAT, IT, XP** on the main path.
3. Show **LocalFlow**, **HomeFlow**, **quest market**, and **merchant till** as faces — equal weight, thin edges into SignalFlow.
4. Show **node → DID** as identity.
5. Fail-closed path must be visible.
6. **Grantflow:** one optional door on the same pipeline, or omit. Never two boxes. Never the top of the chart.
7. **Do not** mint DT. Do not draw EP/IT as wallet piles.
