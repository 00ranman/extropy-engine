# @extropy/identity

Node-minted identity for Extropy Engine v3.5.

**Canon:** a W3C `did:key` generated on the participant's own node at first boot. No KYC (on-device or otherwise), no Google Auth, no OAuth or OpenID login, no central registrar, no customer registry. Lose the DID without a backup and you start over. CAT is a skill record (a count of settled loops in a lane), not a login and not KYC.

**Status:** The library can emit `did:key` (`encodeDidKey`, `isDidKey`). The Express process still mounts the retired v3.1 session machine (OAuth digest, KYC digest, `did:extropy`). That session machine is a logic change. Do not treat the routes as the rule.

See [`docs/IDENTITY.md`](../../docs/IDENTITY.md). The route catalog of the leftover server is [`docs/IDENTITY_IMPL.md`](../../docs/IDENTITY_IMPL.md).

## What this package is for

- W3C `did:key` from an Ed25519 public key (`encodeDidKey`)
- Local key material helpers
- Verifiable Credential helpers (self-issued; not a personhood office)
- ZKP envelope (signatures today; BBS+ when circuits exist)
- Per-context nullifier derivation
- Shamir split of an opaque payload (not a KYC escrow)

## What this package is not

- Not a registrar and not a customer database.
- Not a KYC vendor.
- Not a custodian. The private key stays on the participant's node.
- Not a validator office.

## Leftover HTTP surface

These routes are still mounted. They are not canon.

| Endpoint | What the code still does |
|---|---|
| `POST /onboard/oauth` | Accepts a provider name and a subject digest |
| `POST /onboard/kyc` | Accepts a digest labeled as an on-device KYC attestation |
| `POST /did/generate` | Mints `did:extropy:<hex>`, not `did:key` |
| `POST /zkp/prove` | Sandbox proof |
| `POST /zkp/verify` | Sandbox verify |
| `POST /nullifier/derive` | Per-context nullifier |
| `POST /reveal/initiate` | Splits an opaque payload. Not a real-world identity escrow |

## Status against gaps

Tracked in [`docs/GAPS.md`](../../docs/GAPS.md). The open identity question is circuits (Codex 3), not a KYC bootstrap and not a recovery registrar.
