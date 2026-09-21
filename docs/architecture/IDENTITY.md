# Identity — node DID only

**Status:** Canonical product rule
**Scope:** Protocol identity for Extropy Engine

## Rule

1. Identity is the **DID minted by your own node** when you download, install, and set that node up.
2. **No Google Auth.** No Apple / social login as protocol identity.
3. **No KYC** and **no central customer registry.** The protocol is not a hosted account system.
4. **No central hub** that owns users or can be the single operator of the system. Nodes hold keys; loops close across both edges; meters move standing.
5. **Backup is your job.** Lose the DID without a backup → start over. That is intentional, not a bug.

## What this is not

| Thing | Status |
|-------|--------|
| Google OAuth in HomeFlow scaffold / changelog | **Debt.** Edge leftover. Strip it. Not architecture. |
| KYC / government ID gate | **Out.** Not required to use the ledger. |
| Central user database | **Out.** |
| CAT `(DID, lane, level, issuer)` | **In** — skill record that feeds β. Not a login. Not KYC. |

## Why

Extropy Engine is a **distributed meter ledger**. Standing comes from closed loops with verification, not from an account at a company. A login wall or KYC gate re-centers the system on a hub and recreates the thing the meters are supposed to escape.

Design intent: there is no single operator who is Extropy Engine. That does not mean magic legal immunity; it means the architecture must not invent a central account holder.

## Diagram instruction

Any architecture diagram that shows Google Auth, OAuth, KYC, or a customer registry as how you exist on Extropy Engine is **wrong**. Regenerate from this file and [`ARCHITECTURE.md`](../../ARCHITECTURE.md).
