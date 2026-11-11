# Identity Layer — IDENTITY.md

**Package:** [`packages/identity`](../packages/identity)
**Spec parent:** [`docs/SPEC_v3.5.md`](./SPEC_v3.5.md) §15
**Status:** Canon for v3.5. The Express routes in `packages/identity` still implement the retired OAuth + KYC session machine and a `did:extropy` string. That is a logic change. This file is the rule.

Product rule, same content, shorter: [`docs/architecture/IDENTITY.md`](./architecture/IDENTITY.md).

## Purpose

Name a participant without a company account. Standing comes from closed loops. The network does not hold a customer registry.

## Design constraints (non-negotiable)

1. Easy onboarding for normal humans: install a node, boot it, the DID exists.
2. Resistance to one-person-many-identity abuse comes from standing, not from a document check. A new DID has no XP, no IT, and no vote weight.
3. No dossier on the network DAG. The protocol does not collect identity documents or biometrics.
4. Selective disclosure is a look vertex and, when circuits exist, a proof of a predicate. It is not a reveal of a government ID.
5. Keys stay on the box. A personal AI is not required to mint a DID.
6. CAT is a skill record: a count of settled loops in a lane. It is not a login and not KYC.

## Canonical flow

```
1. First boot on the participant's own node
        │
        ▼
2. The node generates a W3C did:key from a keypair that stays on that disk
        │   No OAuth. No OpenID. No Google Auth.
        │   No KYC, on-device or otherwise.
        │   No central registrar. No customer registry.
        ▼
3. Backup is the participant's job
        │   Lose the DID without a backup → start over.
        │   Standing does not move to a new key.
        ▼
4. When circuits exist, predicates wrap in ZKP (BBS+ default; zk-SNARKs supported)
        │   Today the handshake is signatures.
        │   Prover and verifier are cryptography. Not a model. Not an LLM.
        ▼
5. Network receives:
        - the public did:key
        - signatures today
        - a per-context nullifier, when circuits exist, so one DID
          cannot cast fifty votes in one room
   Network does NOT receive:
        - a customer record
        - identity documents
        - biometrics
        - a registrar binding of legal name to DID
```

## Components

- **Node keygen.** W3C `did:key` at first boot. No registrar.
- **Local key store.** The private key stays on the participant's node. The network never custodies it.
- **ZKP wrapper (when circuits exist).** Default scheme: BBS+. Alternate: zk-SNARK circuits for a stated predicate (unique in this room, confirmed this loop). Not a personhood office.
- **Nullifier.** Per-context derivation so the same DID cannot be counted twice in one room. Unlinkable across rooms unless a later look vertex says otherwise.

## What this prevents

- A hosted account system. There is no Google login and no customer registry to seize.
- Cheap vote farming inside one room, once the unique-in-DFAO nullifier is live. Signatures do that job until circuits exist.
- Moving standing onto a fresh key. Standing does not transfer. A new DID starts at zero.

## What this preserves

- The participant holds the only copy of the key, plus whatever backup they made.
- The mesh sees a public key and receipts, not a diary.
- Per-context unlinkability across rooms.
- Exit. Delete or lose the key and the node is a new participant. There is no registrar to call.

## Open questions

- How loud a look vertex is, and what density of looks is a dispute. Not a founder key. Not a KYC escrow.
- ZKP circuits are Codex 3. Today: signatures.

Tracked in [`docs/GAPS.md`](./GAPS.md).

[`docs/IDENTITY_IMPL.md`](./IDENTITY_IMPL.md) still catalogs OAuth, on-device KYC, and `did:extropy`. Those routes are leftover. Do not treat that file as the identity rule.
