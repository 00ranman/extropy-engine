# @extropy/validation-neighborhoods

Sharded validation routing for Extropy v3.1. Splits claims into blind slices (default 1/10th) and routes slices to volunteer validators within neighborhoods.

**Status:** Skeleton.

## Responsibilities

- Slice generation (default 1/10th blind slicing of claims)
- Neighborhood membership (DHT-like routing without full DHT semantics)
- Slice dispatch to volunteer validators
- Aggregation of slice scores into F (falsifiability score) for the parent claim
- Anti-correlation surveillance hooks (cross-validator scoring correlation)

## Borrowed pattern

Holochain's neighborhood DHT inspired this, with credit. Our implementation is native, scoped to validation routing rather than general DHT storage.

## API surface (target)

| Endpoint | Purpose |
|---|---|
| `POST /slices` | Generate slices for a claim |
| `GET /slices/available` | Query available slices for a validator (skill, neighborhood, load) |
| `POST /slices/:id/accept` | Accept a slice |
| `POST /slices/:id/score` | Submit slice score |
| `POST /aggregate/:claimId` | Aggregate slice scores into F |
