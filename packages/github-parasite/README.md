# @extropy/github-parasite

Scaffold (v0.1). GitHub App overlay that lets Extropy mint XP against real code contributions in host repositories, without asking those repositories to adopt any Extropy tooling.

## Why this exists

The Extropy Engine has a cold-start problem: no active loops, no minting, no evidence of the mechanism working. The parasite strategy is: overlay the mechanism on top of existing high-signal contribution graphs (GitHub, Notion, Linear, calendar, appliance telemetry) and let the host system provide the evidence. XP is minted from that evidence. The host system is not modified.

This package implements the GitHub side of that pattern.

## Non-extraction contract

This package MUST satisfy the three tests in [docs/NON_EXTRACTION.md](../../docs/NON_EXTRACTION.md):

- **T1 (extraction).** Nothing this package emits is redeemable, transferable, or convertible into an off-protocol value. XP moves access thresholds. Access thresholds are not payloads.
- **T2 (counterparty).** No stable "consumer" or "producer" second party is introduced. Reviewer XP and author XP both flow from ΔS-in-code, not from counterparty transfer.
- **T3 (ratio).** Draw against admitted actions in the `informational` and `cognitive` domains remains gated by the actor's own contribution/draw ratio ρ. Merging code is a production event; reading merged code is not a draw event yet under v0.1.

If any code path added here breaks any of those three tests, it does not ship.

## What it does

For each webhook event a host repo sends us:

1. **`pull_request.closed` with `merged=true`** → open a loop of class `code-contribution` in the `informational` domain. Attach evidence: PR URL, commits, review verdicts, CI status, line delta with language weights.
2. **`pull_request_review.submitted`** → attach the review as a validator verdict on any loop that references the PR head SHA. Reviewer must be at or above `τ_validator_informational` in the actor registry, else the review is recorded but does not count toward closure quorum.
3. **`check_suite.completed`** → attach CI outcome as additional tamper-evident evidence.

The loop closes once the PR is merged, validators agree on ΔS, and the substrate mints XP through `@extropy/xp-formula` with the domain's `λ` and the elapsed seconds from PR-open to PR-merge.

## Contribution ratio, not market

The XP an author receives on a merged PR is a function of:

- ΔS-in-code (lines-added weighted by language, minus tests-added credit, minus deletions with different sign per language)
- R (informational-domain rarity)
- F (this author's recent merged PRs in this repo, frequency-of-decay)
- w · E (essentiality: does this touch a hot path, does it move a public API, etc.)
- log(1/Tₛ) capped at log(1/T_floor)

It is **not** a function of stars, forks, downloads, market interest, employer, or any external price signal. That is the point.

## What v0.1 explicitly does not do

- Does not settle to any external payment surface.
- Does not expose XP balances as a public API endpoint that a third-party payment processor could read.
- Does not implement withdrawal, transfer, or redemption of any kind.
- Does not integrate with a token bridge, even a testnet one, even for demonstration.

Any of those would break Non-Extraction and are permanently out of scope for this package. Follow-on features (leaderboards, badges, threshold-gated features) are welcome as long as they route through the access-threshold interface and never expose a balance.

## Wire format

Inbound: standard GitHub webhook payloads, verified by the installation's shared secret.

Outbound: `LOOP_OPENED` and `LOOP_EVIDENCE_ADDED` events on the Extropy event bus, addressed to `@extropy/loop-ledger`. The parasite does not mint; the substrate does.

## Deployment posture

- One GitHub App per Extropy substrate deployment.
- Installations are per-repo, opt-in by the repo owner.
- All events are recorded, whether or not the involved actors are known to the substrate. Unknown-actor loops are held in a staging queue until identity resolution (see [PROTOCOL.md](../../docs/PROTOCOL.md) §10).

## Status

Scaffold only. Implementation lands in a follow-up PR.
