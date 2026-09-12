# Codex 3.0 — capture notes

**Status:** Codex v2.1 stays frozen. Do not spin a new edition for this.
**Date:** 2026-08-23; addendum 2026-09-07

**Why this file exists:** Load-bearing mechanics keep falling out of the public story, and critiques (NotebookLM and otherwise) then attack a cartoon. They are in the type system. They are not in the Codex. Put them in 3.0.

The source rant is at the bottom. Do not “clean” it into something else.

## How to write this (do not invent a letter)

Think like the architect. The letters already do the jobs.

- R already prices the class of action. Do not flatten rarity to “fix” specialists.
- F already taxes repeats. Do not add a second farm tax.
- L / H_cap / ticket cap already stop a pile from clearing a store. Do not invent a caste page.
- CT already stays on the web. Do not write “grocery does not pay laundry” unless they forked.
- IT already ignores XP. Do not weight votes by world standing.
- CAT already gates a door. It does not multiply the mint.
- ΔS is a proxy SignalFlow proposes from prior closes. Humans talk. They do not type the mint.
- DAG appends. It does not edit.

Do not explain the machine to Randall. Do not add a knob because a thought experiment sounded like a hole. If a letter already covers it, stop.


---

## Acknowledge, do not dodge: MICRO overselling → MACRO drift

The honest critique is: MACROs have to coordinate off MICROs; MICROs are subjective; people oversell; the numbers drift upward.

Do not deny that. Do not call it low-hanging fruit and walk away. The answer on the table is not “people are honest.” It is:

- You do not type in a score.
- SignalFlow + the model you trust + the PSLL propose a provisional ΔS from the task, the duration, and evidence.
- Evidence (before/after photos and anything else) lives on the DAG as referencable payload.
- The other side has to agree (if-then).
- Settle is a knob. Late burn has no expiry. Decay eats idle XP anyway.
- A MICRO vote cannot rewrite a MACRO, and only PLANETARY hits the mesh.

Unsolved (keep it unsolved in 3.0 if it still is): whether nesting actually stops a popular MICRO from laundering a story upward.

---

## 2026-09-07 addendum — put this in Codex 3.0

Do not reprint “63 gaps” or “65 gaps.” Public count is 16 live.

Must land in 3.0, already specified in code/defaults, not in the signed 2.1 PDF:

- CT_W is community-web standing. Same readout at compatible tills. Door does not own CT. H_cap is Auto from this till.
- L = clip(H_cap · S · κ · CT_W · β, 0, 1). EP = XP · L + λ · L.
- H_cap Auto from trailing 10-day signed cash (two 5-day weeks). Training remainder 0 until that window fills. λ default 0.15; web publishes; 10-day notice.
- β is CAT / on-duty / signed case. Not a CT wrap.
- Smart contracts: named cases after both edges signed. No bag in the “then.”
- Official skins: cash collected + remainder. No raw XP on a forehead.
- CT idle leak 0.99ⁿ (~1% every 10 days), same keep as XP. Active on that web resets n. CT does not travel.
- IT is not a pile. IT = clip(H_gov · S_gov · κ · CT_W · β_gov, 0, 1). Burns in the tally. Not XP · G.



Scratched for 3.0 so they stop eating pages: CT lockup, first-validator priesthood, universal ESF.


---

## SignalFlow is the protocol. LocalFlow is the errand face.

Stop attributing SignalFlow’s job to LocalFlow.

**LocalFlow**
Replaces the pile: Uber, Lyft, DoorDash, Grubhub, plus the errand you cannot run because you do not have a car and someone else uses theirs. Post it. Someone nearby does it. You confirm. Confirmation is a receipt. Users never have to say XP. Density in a zone is still the remaining bootstrap problem.

**SignalFlow**
The actual protocol UI. You talk to SignalFlow. It talks to:
- whatever assistant you trust (ChatGPT, Claude, Gemini, or a model on your own hardware / node),
- your personal log (PSLL),
- your previous numbers,
- the network.

Login-with-favorite-model is up to those companies. Until they allow it, you plug in what you can. Company login means company tether. If you want unknown + independent, you run your own hardware. A network-hosted decentralized model you can log into without owning the rack is a later idea, not a product today.

**UI (rough, not shipped)**
The assistant you trust *is* the UI. Character-sheet-ish is a sketch, not a spec. Do not freeze a skin in 3.0. Freeze the split: SignalFlow is the mouth. LocalFlow is a face.

**Claim path (this is the lawn — including yours)**
1. You mow the lawn. Your own counts. You do not put yourself in for “this much XP.”
2. SignalFlow talks to your LLM and the network: what is this task, how long did it take.
3. Supporting documentation attaches — before/after photos, etc. DAG stores them so they can be referenced later.
4. SignalFlow + LLM propose an approximate ΔS and put it in provisionally (if-then / smart-contract shaped).
5. Other side agrees → XP mints. Leak starts.
6. Lookers attach later, in parts. Late burn has no expiry. No settle window.

---

## PSLL and Digital Autarky

- **PSLL** = Personal Signed Local Log (also said PLL / personal log ledger). Append-only, hash-chained, yours. SignalFlow reads it. The mesh gets receipts, not the diary.
- **Digital Autarky** = intelligence, identity, and local context stay at the edge. The network is a handshake, a claim schema, and a DAG — not a supermind.

---

## ZKP is a circuit, not a model

Put this in Codex 3 so the jobs stay split.

**Personal AI / SignalFlow** may propose a claim, read the PSLL, talk to whatever model the holder trusts. That is optional software on the box. It is not required for a door to open.

**A ZKP is not that.** Prover builds a proof of one predicate (21 or not, band ≥ n, unique in this room, confirmed this loop, not slashed). Verifier checks the math. The till gets yes or no. Classical cryptography. BBS+ / a SNARK / signatures today. Same job as a debit-chip approve/decline. No LLM in that loop. No model “figuring out the question.” The circuit does not read. It evaluates.

If someone says “the AI on your phone decides the ZKP,” they mixed the UI with the proof. Do not write the spec that way.

---

## Two different clocks of death

Do not mash these together. IT is not a 5%/month pile. That line is dead.

| Thing | What it does | Code default (knob) |
| --- | --- | --- |
| **Late burn** | XP can still be destroyed | No expiry on burnability. Five days later or a decade later. Ordinary remaining pile is already dust by then. The mark is the chain plus children, not a 1996-shaped hole. Close mints. There is no settle window. |
| **XP decay** | XP erodes on a schedule even with no dispute | `POCKET_KEEP` = **0.99 every 10 days** (~1% of remaining). You keep working or the pile shrinks. Access economy: you do not spend XP; it gets eaten. |
| **H window** | Auto H_cap / training | **10 days** of this till's signed cash. Two 5-day weeks of books. Not the leak tick. |
| **IT** | This-proposal standing | clip(H_gov · S_gov · κ · CT_W · β_gov, 0, 1). Burns in the tally. Not XP · G. |

Possible axiom (not written yet): some XP and some IT always burn. Floor, not a vibe. Capture for 3.0 if we mean it.

Source in code: `packages/contracts/src/types.ts` — `TemporalDecayConfig`, `XPDecayConfig`. `docs/GOVERNANCE_DEFAULTS.md` had IT and the 30-day window; it omitted XP decay. That omission is the bug.

---

## Votes stay in the room

A vote rewrites the DFAO it is cast in (decay rates, quorum, notice). It does not rewrite the mesh. **PLANETARY** is the only room that hits everyone, and getting a vote through there is supposed to be hard — you are voting against everybody.

DFAO = Decentralized Fractal Autonomous Organization. NANO → MICRO → MESO → MACRO → PLANETARY are **labels for suggested rule-sets**, not headcount fences. Seven is not a law.

---

## Node box and the company shape

Intended product, later: a box you can sell. Compute, PSLL, optional sensor. Plug in. For-profit. Not a 501(c) — that paperwork is more entropy than it saves.

Act as a non-profit while being a for-profit: salary + keep the lights on, then recycle surplus into R&D, deploying/maintaining nodes (including in homeless areas), and maybe later network-hosted compute so people can run a model without owning the rack.

Not shipping. Clone-the-repo is not the product. If you can run Docker you do not need the box.

---

## ΔS is a proxy

Open to a constant for “mowing a lawn.” Do not expect one. Words drift. Freezing a number and calling it physics is often an ontological sleight of hand.

Start crude. Fine-tune as data arrives (duration, before/after, gas vs the alternative, ozone, idle). `w · E` is where those terms live.

---

## Canonical mint (do not let glossary drift rewrite this)

```
XP = R × F × ΔS × (w · E) × log(1/Tₛ)
```

R = rarity of the action class, **not** reputation.
F = frequency-of-decay, **not** falsifiability.
Floor: `XP ≥ ΔS / cₗ²` — structural analogy, not a new physics law.
Lives in `packages/xp-formula`. No reimplementations.

---

## Records, meters, sparks — stop saying token (29 Aug 2026)

Public copy. The crowd hears “token” and reaches for a bag. That is not this ledger.

**Record** — unique signed vertex. One of one. Closed loop, CAT stamp, lane claim, complaint, EP at the till (written then burned). Same job as what people meant by non-fungible token, without the Ethereum mouth.

**Meter / standing** — a number over records. XP remaining, L, IT weight, CT standing. Not a collectible. Not transferable.

**Till spark** — EP. Born and dead in the sale. `EP = XP × L`.

Token, in this project, does not mean bag. We are still dropping the word in public so people stop minting tickers. Internals can keep `TokenType` until the wallet schema matches.

### Domain vs lane

- **Domain** = the eight entropy instruments. Protocol enum. Not user-minted.
- **Lane** = skill specialization (dentistry, folding, this till). CAT lives here.

Do not use “domain” for both.

### CAT is a record

`(DID, lane, level, settled count, issuer)`. Unique. Peers already holding CAT in that lane sign. They stake IT and local CT. Patients do not mint it. Mentorship `+0.1 CAT` in `packages/token-economy` is bag-shape. Kill it in the kernel pass. Credentials do not steer XP mint.

### DT has no job as a bag

README said Domain Token / expertise marker. Site later said Decay Token. Both jobs are already covered: CAT-per-lane is the expertise record; XP’s `0.99ⁿ` is the leak.

If the letter DT survives, it is only as a unique **lane-claim record**: minted when a loop actually closed, DID + lane + time + issuer on it, contestable. Not a Domain Coin. Not a dropdown. Not transferable.

`TokenType.DT` in the wallet JSON is leftover. Marked transferable in code today. That is a bug. Remove the balance. Do not salvage the letter with a new pile.

### Six was never physics

The load-bearing split is jobs. The count is **five meters**, not six tokens:

- XP — world standing  
- CT — community standing  
- IT — governance weight  
- EP — till spark (dies on the ticket)  
- CAT — skill record  

L, H_cap, S, κ, β, R, F, ΔS, w · E, Tₛ, λ are **math**. They are not a sixth or seventh token. Honorary mentions live on `/math`.

GT / RT / DT as bags are dead letters. Six was accretion. Do not grow a sixth bag because someone counted L.

**3.0 must say five + math, never “the six-token model.”**


### Kernel / docs follow-ups

- `packages/token-economy`: CAT as certification row only; stop minting CAT amounts; drop DT balance; mark CAT non-transferable.
- Docs still saying “exactly six tokens”: burn those phrases. Public count is five meters + math letters. `/tokenomics` and `/math`.

- Site nav: Tokens → Ledger. Glossary heading: Records and meters.

---

## Own lawn, rest, retirement (30 Aug 2026)

The extractive picture: clock in, clock out, rest is a hole, only what you sold to someone else counted, retirement is unemployment with a cake.

Kill that in 3.0.

- **Own lawn.** The ΔS is the grass. HomeFlow can close it. Neighbor-mows-yours is two households. You-mow-yours is one house taking care of itself. Same physical reduction. You do not type a score. F still applies if it is every Saturday.
- **No PTO token.** Standing already minted is what you live on while you rest. XP leak is ~1%/pocket of remaining, not a pink slip. Sick is not a clawback. Care is a loop for the person who shows up. Recovery can be biological ΔS if the loop closes.
- **Buying is coupling, not a mint.** Patronage can move CT_W on the web. Cash cannot mint XP. The till only chooses H.
- **Anything verifiable.** Self-report, sensor, claim, assistant — then the other side agrees. Work-for-a-boss is one input. Living was never inside that box.

FAQ: https://extropyengine.com/faq#own-lawn

---

## Slam window, three clocks, attacks (30 Aug 2026)

Tₛ is **not** recency decay. The old comment in `packages/xp-formula` that said “recency” was a lie. Kill it.

```
Tₛ = exp(−λ min(Δt, Δt_cap))
log(1/Tₛ) = λ · clip(Δt, 0, Δt_cap)
```

Δt → 0 ⇒ Tₛ = 1 ⇒ log = 0 ⇒ XP = 0. Slam-shut. On purpose. Do **not** change this to `log(1 + 1/Tₛ)` so Tₛ=1 pays. That pays slam-bots.

Δt_cap is a knob. Default: the action class’s expected duration (quest grain 2–5 min unless the class says otherwise). Unbounded λΔt is a stall-farm. Cap it. Code: `DEFAULT_DELTA_T_CAP_SECONDS = 300`.

Three clocks. Do not mash:

| Clock | Job |
| --- | --- |
| Tₛ | This loop’s elapsed time. Slam-shut at 0. Capped. |
| F | Repeating the action class. |
| 0.99ⁿ | Standing after close. ~1% every 10 days of remaining. n = idle 10-day counts. |

IT is this-proposal standing, not a leak clock. H window is 10 days of signed cash. Neither is Tₛ. There is no settle window.

Rarity-splitting 400 fake classes is a **DAG** job. The formula will not catch it.

### Experiments to write as tests (not vibes)

1. ΔS calibration — 100 identical tasks, error → correction → converge, or fail.
2. Farming resistance — assume everyone manufactures XP. R/F/Tₛ/confirm/evidence/late burn.
3. L as extraction machine — captured DFAO juices L. Economic attack.
4. Late mint — citation-gated delta, not a second paycheck. Simulate 20-year discovery.
5. (w · E) — does the vector improve predictions or become a vote.

You do not need ΔS perfect. You need the error to get expensive.

FAQ: https://extropyengine.com/faq#three-clocks

---

## Overlay / imported CAT (30 Aug 2026)

You do not start a new civilization. You convert one that exists.

Overlay. Shops, licenses, neighborhoods, the handshake already on the wire. Both-edges, contest, leak, DAG go on top of infrastructure people already use. Greenfield is a fantasy of a clean page.

An off-system credential is **opening evidence** for a CAT record: issuer = the old board, lane = the practice. Not XP. Not IT. Not a throne.

Once they are in, this graph is what continues. Retired weight that can issue new CATs and argue rarity in that lane is DAG history in here, not the framed diploma. If the paper was a lie, contest and late burn still apply. License is the door. It is not the house.

Do not invent a bootstrap bag to hold this.

FAQ: https://extropyengine.com/faq#overlay

---

## What 3.0 should actually decide

1. Settle window is dead. Close mints. Burn anytime. Do not put a silence timer back in Codex 3 as “verification.”
2. Put XP decay next to CT idle leak. IT is not a third leak clock. H window is 10 days of signed cash, not a month.
3. State late-burn explicitly: close ≠ immortal.
4. Keep LocalFlow / SignalFlow / PSLL / Digital Autarky as separate nouns. Highlight SignalFlow as a first-class engine piece.
5. Write the claim path: no self-score; evidence on the DAG; if-then; mint at close.
6. Acknowledge MICRO overselling / MACRO coordination as a real pressure, with the mechanism above as the current answer, not a solved vibe.
7. Decide whether a burn-floor axiom exists.
8. Say the box is a for-profit product intent, not a 501(c), surplus into R&D/nodes.
9. Leave 2.1 alone until that list is actually written.
10. Public language: record / meter / till spark. Not token. Domain vs lane. CAT is the skill record. DT is not a bag.
11. Kill wallet DT and CAT amount-mints in `token-economy`. Mentorship is a record, not `+0.1`.
12. Own lawn mints. Rest is not a hole. No PTO pile. Retirement is not extractive-economy unemployment.
13. Tₛ is a slam window with Δt cap, not recency. Three clocks. Do not “fix” Tₛ=1. Experiments: ΔS calibration, farming, L-extraction, late mint, w·E as a knob.
14. Overlay, not a new country. Imported credentials are opening CAT records. License is the door, not the house.
15. Split the jobs in public language: SignalFlow/model may propose a claim. The ZKP at the door is a circuit. Yes/no is verification, not inference. Do not write “the AI checks the proof.”

---

## Source rant (2026-08-23)

Kept so 3.0 cannot “summarize away” the distinctions.

> It's like I keep having to be more and more specific for these. Like what I've been doing is running these debates from Notebook LM. It has access to the website. And as I update it, I just have it doing another more honest debate. Not trying to actually attack low-hanging fruit though. Like I want it to be good arguments. And the most recent thing that it's trying to say now is that there's going to be a problem with the reliance on the macro DFAOs needing coordination from the micros and the smaller things. Like they're changing stuff. And the subjectivity of the micro DFAOs causing a drift because of people over-selling their stuff or whatever. But they're not like that. We just need to acknowledge is what I'm trying to say. Again, the SignalFlow aspect of all of this. SignalFlow needs to be talked about. That needs to be highlighted as a big part of the engine. LocalFlow is actually attributed to what should have been SignalFlow. LocalFlow is really just like I said, just a smaller, you know, LocalFlow is like replacing everything from Grubhub, Uber, Lyft, all that, DoorDash. It's just like all that shit in one. And then some. When it comes if it comes to you not having a vehicle and someone else using their vehicle in place to be the errand runner for you, whatever you want to call it. Yeah, that's what LocalFlow does. SignalFlow is the actual protocol of your edge AI discussing with your personal log and being able to access all of your previous information, all your numbers. So you talk to SignalFlow. You put whatever AI you trust into SignalFlow. It could be something that you could use ChatGPT. You can use Claude. Eventually I hope that they allow for login with these different whatever your favorite is. That's up to those companies to eventually allow for that. Or you could run your own local model off of your own computer or whatever, your own local node. And use that. Either way, whatever you're putting in there that you trust, that's up to you on how you log into that and what levels of security and privacy you have. Because if you're logging into any of those, Gemini or whatever, of course it's going to be tethered to something that a company is going to have at that point. So if you really want to truly be decentralized and no one knows who you are and all that stuff, and you have all the independence, you'll have to set up your own shit on your own hardware would be the best course. Unless someone offers some sort of a decentralized option. Maybe that might be something we even do eventually down the road where we have something that's like a decentralized model that we can allow for logins and stuff. Once. Because I fully intend on, that was another thing too that you kind of said wrong. Because I do intend on packaging some sort of a box that I can sell and turn into a profit for the company. But I'm not going to pretend to be a non-profit and then have to explain and prove and do all the extra stuff for a 501c and blah blah blah blah blah. All the other bullshit because it's just so much rigorous extra effort. It's more entropy inducing than reducing trying to run as a non-profit legally. When I could just act as a non-profit while being a for-profit and then just recycling any excess money beyond what I need to pay myself a salary, what the business needs into research and development and creating new things like deploying and maintaining nodes in homeless areas or something else that the network might be doing. Like I just said about hosting some sort of a decentralized server or whatever that you can access or decentralized computers that you can essentially run your own models on. Like it'll be on the network. But at the same time, it'll be something you can run your own thing and have the PoL and all the see, but what I'm getting at is like we just need to make sure that we're including in the engine part all of this stuff as well as explaining like you talk to your personal log or whatever. Your what you trust as your assistant. That's your UI essentially. You could have a character sheet or whatever. I don't know how exactly the UI side of things are going to work, but I mean I have a rough idea of course a character sheet kind of thing. And then or what would you just call it? The PLL? The personal log ledger or whatever? The digital autarky concept? Probably even throw that in there. And define those things. But what was I saying? The biggest thing is we just need to make sure we're explaining that it's not like individuals on the community level are going to be like, oh I mowed a lawn so I'm putting myself in for this much XP. No, it's like I mowed a lawn, SignalFlow talks to your local LLM and then it talks to the network and it looks at what is this task? How long did it take? Plus you want to, there's going to be supporting documentation and stuff. Like you take a picture of the before and after, shit like that. It could be more things to add. Like the DAG can be like something that all these little things are stored to and saved in that can be referenced. So like a picture before and after is more evidence. Things like that are going to be placed in. And then you'll know like so this much entropy was reduced is the approximate estimate that the SignalFlow thing will communicate with your LLM and decide to put in for provisionally. And then if everything on the other side agrees, then it's minted if everything else. In an if-then smart contract kind of way where it all goes through the process and decides, yeah, so provisionally minting this. And then if no one contests it over the 30 something days. And maybe you might even, the 30-day window, I don't even know why that got cemented in as such a pivotal piece. Because the thing is it's not just 30 days. The XP can be burned 30 years later. There's nothing stopping it from being burned eventually. The 30-day provisional thing was just a number I threw out there. I mean it could be five days. It could be 10 days. I don't know what the best day for just the provisional time before things are settled. And it goes from that provisional XP to regular XP that actually adds to your overall amount that you have. Because again, we're not spending XP. It's an access economy sort of thing. And XP also like that's something else that seems to be forgotten or something. It's not in the documents maybe. But it was supposed to also burn automatically. So much XP burns every so many days. I can't remember exactly what it was, but I think it was 30 days as well. But again like these numbers don't have to be 30 days or like all of this stuff should be provisional. Like all this stuff should be something that's again there's a smart contract that executes like how much percentage of IT will be burned. And then if enough people with IT get that amount of IT and they all vote and they all decide hey I want to lower the amount. It can lower. Maybe we might have a hard floor where some IT has to be burned and some XP like maybe there might be some sort of axiom or something that's placed in to the core of it all. But yeah I don't know. I think because a lot it should be like when you're voting, I don't even think that it should really affect the whole. It makes more sense that votes and all would affect the decentralized fractal autonomous organization that the vote is being cast within. And then the government, things change there without changing anything that would impact the system as a whole. And like, you know. So anyways. Unless they got enough votes to impact the system as a whole by having a vote that was like across the planetary DFAO. Which would be the harder rules to get voted one way or another when you're voting against everybody.
