# There Is Only Work, and Then There's How It Finds You

## Or: Why the System Doesn't Have Validators, Tasks, Jobs, or Quests, and Why That's a Feature

I want to try an experiment. Forget every word you've ever read about "the gig economy." Forget Uber. Forget Mechanical Turk. Forget TaskRabbit, Fiverr, Upwork, Craigslist, the volunteer sign-up sheet at your kid's school, the work order system at your job. Forget the part of your brain that hears "task" and immediately thinks of a Trello card or a Jira ticket or a thing your boss assigned you that you don't want to do.

All of that is going to actively get in the way of understanding this chapter.

Here's what I want you to hold in your head instead: there is a giant, invisible, networked **graph** of things that need doing in the world. Some of them are large and consequential. Some of them are tiny. Some of them are urgent. Some of them are slow-burning. Some of them are physical, like cleaning trash off a roadside, and some of them are cognitive, like reviewing whether someone's claim about food waste reduction is actually true. Some of them you'd be glad to do. Some of them you'd ignore. Some of them you wouldn't even recognize as "doing something" because they're so small.

Now imagine that this graph is **always on**, always full of work, and that the world's complaints, requests, needs, and unspoken demands are constantly being added to it from every direction. The neighborhood Facebook group bitching about a pothole. The mom who needs a ride to chemo. The researcher who needs three peers with quantum coverage to review a paper. The merchant who needs to verify a sourcing claim. The household trying to confirm they actually reduced food waste this month. All of it lands in the graph. All of it.

And the engine's job is to figure out **who, doing what, in the course of their normal day, can satisfy each piece of it.**

That's the system. That's the whole system. Everything else is implementation detail.

---

## Why I'm not calling it tasks, jobs, quests, or anything else

Because every one of those words drags a corpse with it.

"Tasks" makes you think of a checklist app and the slow grinding feeling of being a project manager.

"Jobs" makes you think of a job board and the slow grinding feeling of being unemployed.

"Quests" makes you think of a video game, which is the *closest* metaphor and also the most dangerous one, because the second you frame this as a game, half your audience decides you're not serious. Real-world coordination of real-world work that affects real-world people in real-world stakes is not a thing you want to package as fantasy roleplay, even if the structural similarity is real.

So I'm calling it what it is. Each thing-that-needs-doing in the graph is a **contribution**. The word is deliberate. It carries the weight of the project. The system rewards contributions, and contributions are what the system needs more of, and the math measures whether something was actually a contribution or whether somebody was just performing one.

When I say contribution, I mean any of these:

- Picking up trash on a stretch of highway.
- Confirming, while scanning groceries, that a particular food was sourced where the merchant said it was.
- Reviewing a paper.
- Driving someone to an appointment.
- Witnessing a fragment of someone else's claim about something you have legitimate standing to assess.
- Performing surgery.
- Fixing a fence.
- Watching the kids next door for an hour.
- Filling a delivery.
- Cooking a meal that aligns with a household's stated nutrition target.
- Reporting a power line down.
- A thousand other things across every domain of human activity.

Different in scale. Different in stakes. Different in who can do them. Different in how long they take. All the same primitive: a unit of work in the graph.

---

## Five lanes for five very different things

If you treat surgery and trash cleanup the same way, you've already failed.

The graph has five **stakes classes**, and they are very different from each other in how they get routed and who is allowed to participate:

**High-stakes.** Surgeries. Nuclear stuff. Structural engineering. Anything where a wrong answer kills someone or causes irreversible harm. Hard credential gates. Hard deadlines. The system never silently routes one of these to anyone. They are explicit, deliberate, acknowledged, and only available to contributors with the standing to handle them. A grocery shopper does not get a heart surgery contribution dispatched to their phone because they happened to be in the right zip code. Period. End of story.

**Civic.** The pothole, the trash on the side of the road, the missing dog, the broken streetlight, the school issue, the mutual-aid request. Lower stakes than surgery. Higher volume. Soft deadlines. Anyone with reasonable coverage in the relevant domain can pick these up.

**Everyday.** Cooking, household stuff, budgeting, exercise, learning, the daily-loop work that produces most of the network's signal. Fast decay (you can't brag forever about cooking dinner once in 2024). Wide eligibility. Most of the graph's volume lives here.

**Time-sensitive.** Emergencies. Evacuations. Weather events. Things where the latency between "this needs doing" and "someone has to be doing it" is measured in minutes, not days. Routing here prioritizes proximity and availability over coverage depth, because someone competent and present beats someone perfect and distant.

**Speculative.** Open research questions. Scientific claims under review. Long-Tₛ work where there's no hard deadline but the epistemic weight is real. Higher CAT requirements for participation. Lower volume. Higher per-contribution significance.

The five lanes are not different apps. They're not different interfaces. They're the same graph with different routing rules. A user might encounter contributions from any of them in the same week, depending on what they're doing and what coverage they've accumulated. The high-stakes lane is the only one with truly hard partitions; the other four blend into each other along their boundaries.

---

## How the work finds you

This is the part that, when I explained it the first time, I way overcomplicated. Let me try again, simply.

There are five ways a contribution gets in front of a person who might do it.

**One: a list.** Like any list of available work in any system ever. You log into the interface you happen to be using, you see what's available, you filter by your interests or your area or your coverage, you pick something, you go do it. This is the boring obvious way and there's nothing wrong with boring obvious ways. People will use this because people use lists.

**Two: a direct request.** Someone with the right standing reaches out to you specifically, or to a small filtered group you're in. A merchant you regularly shop at asks if you'd confirm a sourcing detail. A neighbor asks if you can help move a couch. A researcher you've reviewed for before asks for a second pass on a paper. Direct requests are personal, low-friction, and high-context. They work because the relationship is already there.

**Three: a threshold unlock.** You crossed a line. You've closed enough loops in a domain that a new class of contribution has become available to you. You hit a CAT level that makes you eligible for a civic role. You've accumulated enough coverage in a field that the system now trusts you to participate in something it didn't trust you with before. The unlock just appears. You can ignore it or take it.

**Four: you filed it yourself.** You needed something done and you put it in. "I need three reviewers with quantum coverage to look at this paper." "Help me move a couch this Saturday." "My grandmother needs groceries Thursday." The system takes your description, prices it, classifies it, and routes it. You don't pick the parameters. You describe the need. The engine assigns the math.

**Five: signal flow extracted it from the existing world.** This is the one that's different from anything else and worth dwelling on for a paragraph. The neighborhood Facebook group has been complaining for two weeks about trash on the side of the road. Nobody filed a contribution. Nobody opened the app. The complaints just exist, in the channels people already use, in the shape of human venting. The signal flow layer reads those channels (the public ones, with consent rules and source-filtering, audited, governed), notices that there's a coherent latent demand sitting unaddressed, and structures it into a contribution. Now there's a "clean up the trash on the corner of Elm and 4th" contribution sitting on the open list. Whoever wants to pick it up can. Nobody had to be told to file it. The demand surfaced itself.

That's a real architectural move and I haven't seen anyone else doing it. Most platforms wait for users to come to them and submit work. This one meets users where they're already expressing demand, and turns the expression into structure.

---

## Witnessing is just a thing you sometimes do

Half the architecture problems in coordination systems come from treating "validators" as a separate role. There's a validator app, validators get paid, validators have a special interface, validators are recruited, validators are managed, validators are the bottleneck, validators get gamed.

This system doesn't have validators. It has contributors. Some contributions involve witnessing. That's it. That's the whole thing.

Sometimes the witness contribution is explicit and deliberate. A high-stakes review of a medical claim, where the witness knows exactly what they're being asked to assess and acknowledges the responsibility. Same way a doctor signs off on a chart.

Sometimes the witness contribution is small and incidental. You scanned your groceries because you wanted groceries. The scan also happened to satisfy a fragment of someone's sourcing claim. You didn't know about the claim. You don't need to know. The fragment was tiny, the routing was background, and your action produced a signal that aggregated, with hundreds of others, into a verdict on the larger claim. You contributed without contributing-with-a-capital-C, and that's fine.

The reason this works without falling apart is that **you can't choose your witnesses.** The system routes them based on domain coverage and recency and stakes class and randomization. That rule has been in the spec since v3.1 and it's still there. The whole reason this is structurally hard to game is that nobody on either side of a witness fragment can pre-coordinate. The person being witnessed doesn't know who's going to show up. The witness often doesn't know they showed up. Collusion attacks fail on first contact.

A claim that's bigger than a single witness can handle gets **decomposed** by the engine into smaller contributions that get routed independently. The user who filed the claim doesn't decompose it. They just describe what they need verified. The engine breaks it. The router dispatches the fragments. The aggregator reduces the witness signals into a verdict. The user files, the user gets a verdict, the user never sees the wiring.

This is map-reduce, but for human attestation. And it works for the same reason map-reduce works in any other context: distribute the load, parallelize the assessment, aggregate statistically, no single node has to know the whole picture.

---

## Skin it however you want

Here's the part that matters for product, even though it doesn't matter for architecture.

Some people, especially people who are new to the system or are coming in from a gaming background or just have that kind of brain, are going to want a UI that calls a contribution a "quest." They'll want their CAT levels to look like ranks. They'll want their faction standing to look like guild membership. They'll want the whole experience themed like an RPG.

That's fine. That's a UI choice. The protocol is theme-neutral and any host app, or any user inside an app that exposes the preference, can apply whatever theme they want. Fantasy, sci-fi, professional, sport, minimalist, whatever. The math doesn't change. The routing doesn't change. The credentialing thresholds don't change. The substrate is invariant. The skin is decoration.

The reason this matters is twofold. One: people who like the gamified theme will find the system way more engaging when they can opt into it, and engagement on the user side (without engagement *being the metric*, see the previous chapter on the three-layer trick) drives real-world participation, which drives real-world entropy reduction, which is the whole point.

Two: people who don't like the gamified theme, and that's a lot of people including most of the ones who'd be doing the high-stakes contributions, can opt into a serious, plain-language UI and never see a "quest" or a "rank" anywhere. The protocol respects them too.

A surgeon doing a credentialed review does not need to be told their participation rate just leveled them up to "Master Surgeon Tier IV." That'd be insulting. They get a clean professional interface and the same XP underneath. The gamer doing trash cleanup on a Saturday does not need their experience presented as a ledger of capability multipliers. They get a quest log with cool art and the same XP underneath. Both people are using the same protocol. Both contributions are valued the same way.

This is the answer to the entire "is it a game or is it serious infrastructure" question. **It's serious infrastructure that some people will skin as a game.** The skin is at the user's discretion. The infrastructure is at the protocol's.

---

## Why this is structurally better than the alternatives

Let me list them out, because the comparison is the pitch.

Compared to traditional volunteer coordination: this system can route work to people who don't even know they're a volunteer, because the contribution is small enough to be a side effect of their normal activity. Volunteer pools collapse the second the volunteers get tired. This pool can't get tired because most of it doesn't know it's a pool.

Compared to a gig-economy app: nobody is being squeezed into a piecework wage by a venture-backed extractor. The contributions pay out in EP, which is a savings layer at participating merchants, not a paycheck. Contributors keep their day jobs, their lives, their dignity. The system supplements; it doesn't replace.

Compared to traditional civic engagement: the demand surfaces itself, from where people already complain. Nobody has to go to a special civic engagement website to file a pothole report. The complaint about the pothole on Facebook becomes the contribution to fix the pothole. The friction is removed from the demand side. The supply side opts in by living their life.

Compared to social credit systems: nobody scores anyone. The math scores entropy reduction. Reputation density (ρ) lives in one place (CT), and reputation never enters XP. R is rarity, a property of the contribution, not the actor. The system can't be weaponized to downgrade dissidents because there's no central authority that writes to anyone's record. Validators witness, they don't author. The character sheet is yours.

Compared to traditional reputation systems: standing is non-transitive across domains. A high-coverage contributor in cooking has zero standing in physics. The classic "charismatic forum poster validates medical claims they have no business assessing" failure mode is structurally impossible.

Compared to a job board: this is way more than a job board. A job board is one of five surfacing modes. A traditional job board would correspond to mode one, the open list. The other four modes (direct requests, threshold unlocks, self-issued, signal-flow extracted) are not standard job-board features at all. The system is a job board *plus* a routing layer *plus* a witness aggregator *plus* an ambient demand-surfacing layer, all running on one substrate.

---

## The closing line

The system is a coordination layer for real work. It is described in plain language because the work is real. It is stakes-aware because the world is stakes-aware. It routes by coverage and timing and proximity and randomization because that's what makes it hard to game. It decomposes complexity because complexity is reducible. It surfaces demand from where demand already exists because that's where it already is.

You can theme the interface however you want. You can call the contributions whatever you want in your own UI. You can make it look like a video game or a project management tool or a clean grown-up dashboard. The protocol does not care.

What the protocol cares about is whether the work got done. Whether the entropy actually got reduced. Whether the witness was honest. Whether the math was honored.

If those things are true, you get paid. If they're not, you don't. That's the whole rule. Everything else is paint.
