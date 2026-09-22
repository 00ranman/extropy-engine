# Diagram rules (for humans and diagram generators)

**Source:** repo-root [`DIAGRAM.md`](../../DIAGRAM.md) and [`diagram.mmd`](../../diagram.mmd). Ingest those. Do not inventory `packages/`.

When drawing Extropy Engine architecture:

1. **Spine:** **SignalFlow** packages every claim and routes validation. Assistant + PSLL + class-strip priors. Proposes ΔS. You do not type the mint.
2. **Faces (only these four, equal):** LocalFlow, HomeFlow, quest market, merchant till. Same loop: post → do → confirm. Neighborhood-app is HomeFlow’s MESO skin.
3. **Vertex:** three envelopes — public class strip · ZKP identity (circuit, not a model) · sealed bytes. LOOK to read sealed. No silent fetch.
4. **LOOK:** volunteer slices, not a class. No Consensus Engine package. Fail closed → XP = 0.
5. **Mint:** `XP = R × F × ΔS × (w·E) × log(1/Tₛ)`. R = rarity of the action class, **not reputation**. Tₛ slam: instant = 0.
6. **Meters:** CT_W feeds L and IT, never the XP product. `L = clip(H_cap · S · κ · CT_W · β)`. `EP = XP · L + λ · L` dies in the sale. IT burns in the tally. CAT feeds β, off the mint.
7. **Clocks, separate:** Tₛ slam · leak 0.99ⁿ idle 10-day ticks · H window 10-day cash · late burn no expiry.
8. **Identity:** node-minted did:key. PSLL is a file on disk.
9. **Rooms:** DFAO NANO→PLANETARY. Votes stay in the room.
10. **Do not draw:** GrantFlow as a face · Token Economy bag · validator class · Google Auth · `[index.ts]` boxes · EP/IT piles · DT bag · contributor hub bypassing SignalFlow.

If a generated diagram is missing SignalFlow, LocalFlow, HomeFlow, the till, CT→L, LOOK, or the XP formula, or if it has a Consensus Engine or grants at the top, it is wrong. Regenerate from `DIAGRAM.md`.
