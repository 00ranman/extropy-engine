# Node security, DID, bad actors

Hostinger is not the network. Each laptop is a node.

A phone is not a node. You do not clone the repo onto a phone, and the phone does not run the Engine. That is not secure, and it is not the goal. A phone can run an app that connects to the box you already plugged in. The box holds the key and the log. The phone is a screen.

A phone app that only works because a server somewhere else does the work is the ordinary way. It is the way this refuses. If you do not hold the box, you do not hold the node.

## How you get a DID

You do not apply. First boot writes a keypair on disk.

```
did:key:<multibase-public-key>
```

W3C DID. No registrar. No Microsoft. No Google.

Backup the file. Lose it and you are a new node. Standing does not teleport.

`did:web` is optional if you want a domain on the DID document. Not required.

**Today:** `packages/neighborhood-app` writes `did:key` on first boot (`data/keys/node.pem`, public `data/did.json`). Handshake (`packages/node-handshake`) is HTTPS + signatures, not production P2P. ZKP circuits are Codex 3.

## ZKP

The DID is the name. A ZKP is what you show.

Prove a predicate, not a dossier:

- this DID
- access band ≥ n
- confirmed this loop
- not slashed in this DFAO
- unique in this room (one person, fifty votes: no)

The till gets yes or no. Not the PSLL. Not the XP pile.

That yes/no is a circuit. Not a model. Not an LLM reading the question. Personal AI is not in this loop.

Circuits are Codex 3. Today: signatures. Same job, thinner proof.

See also: [CODEX_3_NOTES_ZKP_REPUTATION.md](./CODEX_3_NOTES_ZKP_REPUTATION.md), [CODEX_3_NOTES_LOOK.md](./CODEX_3_NOTES_LOOK.md).

## Independent node

- Keys, PSLL, postgres if you run the full stack: stay on the box.
- Do not punch the database at the WAN.
- You pull git. Nobody remote-admins you unless you handed them the key.
- LAN: node to node, no internet required.
- WAN: TLS. Handshake is a signed hello plus capabilities.
- One captured node can lie about its own claims. It cannot silently rewrite a neighbor's DAG. Other nodes check signatures and causal parents.

## Bad actors

| Move | Answer |
| --- | --- |
| Sybil (cheap `did:key`s) | Identity is cheap on purpose. KYC is not the defense. Standing costs work. New DID has no XP, no IT, no vote weight. Unique-in-DFAO ZKP. F punishes farmed loops. |
| Fake work | Both edges agree. Evidence on the vertex. Late burn. |
| Key theft | That's the operator. Passphrase the key file. Hardware key later. |
| Poison DAG / eclipse | Verify parents and signatures. Don't trust a single peer's dump. |
| Silent stalking | A look is a vertex. Stalking-shaped bursts can slash. |

Site copy: https://extropyengine.com/#node
