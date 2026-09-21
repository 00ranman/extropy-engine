# Extropy Engine Architecture (meter-first)

> **Center:** CT · EP · L · CAT · IT (+ XP mint).
> **Edges only:** HomeFlow, GrantFlow, academia-bridge. Do not lead diagrams with grants or papers.

Canonical math: `packages/xp-formula`. Facade: `packages/meters` (`@extropy/meters`).

Full write-up: [`docs/architecture/METER_CORE.md`](docs/architecture/METER_CORE.md)

```mermaid
%%{init: {"theme": "neutral"}}%%
flowchart TB
  subgraph CORE["METER CORE — start here"]
    XP["XP meter\ncomputeXP"]
    CT["CT_W meter\nleakCT / creditCT"]
    L["L this ticket\ncomputeL"]
    EP["EP till spark\nsparkTill · burns"]
    CAT["CAT record\nfeeds β"]
    IT["IT this proposal\nsparkVote · burns"]
  end

  CLAIM[Claim / loop open] --> ROUTE[Signal route]
  ROUTE --> VERIFY[Both-edges neighborhood]
  VERIFY -->|quorum| CLOSE[loop.closed]
  VERIFY -->|fail closed| NOMINT[No mint]
  CLOSE --> XP
  XP --> CT
  CT --> L
  CAT --> L
  L --> EP
  CT --> IT
  CAT --> IT
  EP --> TEMP[Temporal leak / re-verify]
  IT --> TEMP
  TEMP --> CLAIM

  subgraph EDGES["Product edges — fingernail only"]
    HF[HomeFlow]
    EDGE["Optional claim sources\n(grants / papers / household)"]
  end
  HF --> CLAIM
  EDGE --> CLAIM
```

## Rules for any generated diagram

1. Meters first: label **CT, EP, L, CAT, IT, XP** on the main path.
2. Fail-closed: no quorum / reject / missing both-edges-sign → **no mint**.
3. Never draw GrantFlow / academia as the center or as half the chart.
4. DT is not a bag — do not mint DT.
