# Functional Specification — The Video Compiler (the generation surface)

**What this document is.** A complete, implementation-free description of what the video-generation surface does, written so a designer can produce an interface for it from scratch. It describes jobs-to-be-done, information, actions, states, relationships and constraints. It deliberately does **not** describe layout, hierarchy, components, colour, type, density, navigation patterns, or any visual arrangement — none of that is settled, and nothing here should be read as a hint.

**Status.** This surface does not exist yet. There is therefore no "current build" to reuse or contradict — unlike the Videos/clipping spec, every statement here is a requirement, not an observation. Where a requirement derives from something already in the codebase, it is cited by `file:line`.

**Written** 2026-08-30, against the founder decisions of the same date: the market is **B2B**, all pricing is in **USD**, quality is calibrated to the twenty-specialist standard in `CLAUDE.md`, and the storyboard gate is invisible above threshold, surfaced below, and **always requestable**.

**Relationship to the Videos surface.** These are two different products and must not be designed as one. Videos (`FUNCTIONAL-SPECIFICATION-GENERATE-PAGE.md`) is *extraction*: the person supplies a long video and the system finds what is worth keeping. The Video Compiler is *authorship*: the person supplies an intention and the system manufactures something that did not exist. They share a brand kit and a credit balance. They share nothing else.

---

## 1. What this surface is

A person describes a video in one line — "a 30-second ad for the new pricing plan" — and receives a finished, branded, captioned video.

Underneath, that one line becomes a script, a shot plan, a set of storyboard frames, several generated clips, a voice-over, a music bed, captions and a deterministic end card, assembled on a timeline and rendered. The person does not have to know that. **But they must be able to see it, steer it, and stop it** — because it takes minutes and costs real money.

**The central design problem, stated once, because everything else follows from it.** The product promise is *one prompt, one video*. The engineering reality is *an expensive multi-stage pipeline with four decision points*. A design that exposes all four turns the promise into a wizard, which is the single most-cited failure mode of the competitors surveyed. A design that hides all four spends the person's money on work they would have rejected. **The interface must default to invisible and become legible on demand** — and "on demand" has to be a first-class, always-present affordance, not a hidden setting.

**The job it is hired for.** "I need a video for this campaign. I know what it should say. I do not have a studio, a week, or an editor. Make me something I can put my brand's name on — and do not surprise me with the bill."

**What a successful session looks like.** The person writes one line, sees what it will cost, commits, and leaves. They come back to a finished video that looks like their brand made it. If they want one shot changed, they change that one shot and nothing else is re-made or re-charged.

**Four facts that shape everything.**

1. **This is long-running, unattended work.** Minutes, not seconds. Nothing may assume the person stays on screen. Everything must survive them closing the tab and returning on another device.
2. **It costs real money, and the cost is variable.** The person must be able to answer *"what will this cost"* before committing, *"what has it cost so far"* during, and *"what was I actually charged"* after — and the answers must agree.
3. **It is made of independently replaceable parts.** Rejecting shot 7 must cost the price of shot 7, not the price of the video. If the interface does not make this obvious, the system's main advantage is invisible.
4. **The brand is a promise, not a suggestion.** Logo, palette, typography and legal/CTA copy are rendered deterministically and are not subject to model whim. The interface should never invite the person to "hope" the brand came out right.

---

## 2. Roles and access

One role: **the signed-in account owner.** No sharing, no reviewer, no second approver in this version.

Access rules that must hold:

- Every screen requires a signed-in session.
- Every read is scoped to the owner at the database level, and again in every query. A project belonging to someone else and a project that does not exist must be **indistinguishable** to the person asking — both resolve to the same not-found outcome. This is what stops someone probing whether a given project ID is real.
- The person may not write project or shot state directly; the pipeline owns it. The writes a person may perform are: create, approve a gate, reject a shot, cancel, and delete.
- A brand kit must exist before a project can be commissioned. See §7.

---

## 3. Screens

Four screens plus two dependencies. Each is described as *job → information → actions → states → entry/exit → binding constraints*.

### 3.1 The commission screen ("make a video")

**Job.** Turn an intention into a committed, costed project — with the person confident about both what they will get and what they will pay.

**Information this screen must carry:**

1. **The brief.** One line is the minimum and must be genuinely sufficient. Everything else is optional refinement: target duration, aspect ratio(s), the campaign or product it belongs to, an offer or CTA, assets the person wants used.
2. **Which brand kit is being applied**, and an unambiguous way to see what that means — because the person is about to spend money on the assumption that "on brand" is real. If more than one brand kit exists, which one is in force must never be inferred.
3. **The cost estimate, before commitment.** Not a range so wide it is useless, and not a single number the system cannot honour. It must state what is fixed and what is variable, and what the ceiling is.
4. **The budget ceiling for this project**, which the person may adjust and which the system will not exceed. This is the contract: the project halts and asks rather than quietly spending past it.
5. **Their current balance**, and whether it covers the estimate.
6. **What "done" will include** — one master plus which aspect variants, captions, and the deliverable formats.

**Actions.**
- *Commission the video* — primary. Must be impossible to trigger accidentally, and must show the number being committed to at the moment of commitment.
- *Adjust duration / aspect / budget ceiling* — each must visibly update the estimate. A control that changes cost and does not change the displayed cost is a defect.
- *Choose or change brand kit.*
- *Attach assets* — product shots, logo variants, footage the person wants in the piece.
- *Save as draft without committing* — because a brief is sometimes written before the budget is approved.

**States.** Empty (first ever); drafting; estimating (the estimate is itself computed and may take a moment — it must never appear as a confident number while still being derived); estimate ready; insufficient balance (must offer the route to resolve, not just report the block); no brand kit yet (must offer the route to create one); submitting; submitted.

**Entry.** Main navigation; the campaign or calendar surface; an empty state elsewhere in the product.
**Exit.** The project workspace (§3.3). Never a dead end.

**Binding constraints.**
- The estimate shown here and the amount finally charged must agree within a stated tolerance. This is the most important number on the surface: *credits consumed faster than users expect* is the most common complaint recorded against every competitor surveyed.
- The person must be able to commission a video without opening any advanced control.

---

### 3.2 The project list ("my videos")

**Job.** Answer on arrival: what is running, what is finished, what needs me.

**Information, ranked by what is actually being looked for:**

1. **What needs a decision right now.** A project paused at a gate is the highest-priority item on this screen and must be distinguishable from one that is merely working.
2. **What is running, and how far along.** Progress must be truthful about stage, not a decorative bar. The stages are meaningful to the person and should be nameable in plain language.
3. Per project: the brief it came from, when it was commissioned, target duration and aspect, spend so far against ceiling, and current state.
4. **What is finished and unviewed.**
5. Whether the person has capacity to commission another — concurrency and rate limits are themselves information, and "why can't I start another" must always be answerable.
6. How long finished outputs remain available before deletion, if a retention policy applies.

**Actions.** Commission a new video (always present in some form, because whether you *can* is information); open a project; cancel a running project; delete a finished one (destructive, confirmed, and the confirmation must say the video and all its shots go with it); duplicate a project as the starting point for a new brief.

**Required at any realistic volume:** search, filter by state, sort, and pagination. A person who has used this for a month must be able to find a specific video.

**States.** Loading; loaded; empty (never commissioned anything); load failure — which must be honest that the failure is in *displaying* the list and that running work is unaffected; and stale — the list is showing information a running project has moved past.

---

### 3.3 The project workspace

**The most important screen in the product.** It is where a project is watched, steered, gated and repaired. It must work equally well for a person who wants to watch nothing and a person who wants to inspect everything.

**Job.** Let the person understand what the system is doing, intervene where it matters, and leave with a finished video — without ever being forced into a step they did not want.

**Information.**

1. **The current state of the project in one glance**, including whether it is waiting on the person.
2. **The video as it currently stands.** As soon as anything is playable — a rough assembly with placeholder shots — it should be playable. Waiting until the end to show anything is the wrong shape for a process this long.
3. **The shot list.** Every shot, in order, with: its purpose in the narrative, its duration and place in the timeline, what modality it is (generated video, still with motion, motion graphic, supplied footage, deterministic card), its current state, and what it cost. This is the object the person actually manipulates.
4. **Spend so far against the ceiling**, continuously and without being asked.
5. **The script and voice-over**, readable and — before the audio is committed — editable, because a wording change is cheap here and expensive later.
6. **The storyboard, on request, always.** Even when the system is passing it silently. See §4.
7. **Why anything failed**, in language that says what happened and what the person can do — never a raw provider error.

**Actions.**
- *Approve* / *reject* at whichever gate is currently open.
- *Show me the storyboard* — always available, never buried. This is a founder decision: the gate is invisible above threshold and surfaced below, **and the person may always ask to see it regardless**.
- *Reject and regenerate a single shot*, with the option to say why. The cost of doing so must be shown before it is incurred.
- *Replace a shot with something else* — a supplied asset, a different modality, or a still.
- *Edit the script* before the voice-over is committed; after that point, the interface must be honest that changing it re-times the piece and what that costs.
- *Raise the budget ceiling* when a project has halted against it.
- *Cancel* — must be real. It stops further spend and reconciles what was already reserved.
- *Download / deliver* once complete.

**States.** This is where the design work is. The project moves through: drafting; estimating; awaiting concept approval; planning the shots; storyboarding; awaiting storyboard approval *(only when surfaced or requested)*; generating shots; assembling; awaiting rough-cut approval; rendering the master; rendering variants; complete. Plus four terminal or interrupting states: **failed**, **cancelled**, **halted on budget** (distinct from failed — nothing is wrong, the contract held), and **completed with degradation** (see below).

**Per-shot states**, which the shot list must express: pending; storyboard generating; storyboard ready; storyboard rejected; video generating (with attempt number when past the first); QC failed; **degraded to a still** — the system tried its allowed attempts, did not get an acceptable clip, and fell back to a still with controlled motion rather than spending more; complete; failed.

That degraded state is not an error and must not be dressed as one, but it must never be silent either. The person has to be able to see which shots degraded, why, and choose whether to spend more on another attempt. **Nothing may silently no-op or quietly substitute** — this is law three in `CLAUDE.md`.

**Binding constraints.**
- Everything on this screen must survive the tab closing and reopening on another device.
- Rejecting one shot must visibly not disturb the others. If the interface re-renders the whole project as "working" when one shot changes, it has destroyed the feature's main advantage.
- The person must be able to do nothing at all and still get a video.

---

### 3.4 The delivery screen

**Job.** Hand over the finished work, in the forms the person needs, with the facts they need to publish it safely.

**Information.** The master; every aspect variant; duration and specifications per file; captions as a separate sidecar where the channel wants them; the final cost against the estimate; provenance and AI-disclosure information (see §6); and the shot lineage — what this video was made from, so it can be reproduced or amended later.

**Actions.** Play; download individually or together; push to the content library; schedule to the calendar; request an additional aspect variant (cheap — it compiles from the same shot graph); duplicate the project to make a variation; delete.

**Binding constraint.** The final cost and the original estimate must both be shown, together. If they diverged, the screen must say why. Hiding this is how competitors lost their users' trust.

---

## 4. The gates

Four decision points exist. The design task is to make three of them usually invisible.

| Gate | What it protects | Default behaviour |
|---|---|---|
| **Concept** | Spending anything on the wrong idea | Surfaced when the brief is ambiguous or the system produced materially different concepts worth choosing between; otherwise passed |
| **Storyboard** | The largest single block of spend | **Invisible when confidence is above threshold; surfaced below it; always available on request** — founder decision, 2026-08-30 |
| **Rough cut** | Pacing, continuity, whether it works | Surfaced once, briefly, when a playable assembly first exists; passable by inaction after a stated interval, or immediately by the person |
| **Final** | Legal and cosmetic correctness only | Always surfaced — this is the delivery screen |

**The design requirement that makes this work.** A gate that has been passed silently must still be *inspectable after the fact*. The person should be able to open a finished project and see the storyboard it was built from. Gates are not just interruptions; they are the record of how the video was made.

---

## 5. Cost, and the contract with the person

Cost is not a detail of this surface — it is the feature most likely to lose the customer. The requirements:

1. **An estimate before commitment**, with its variable component named.
2. **A ceiling the person sets**, which the system treats as a hard stop. When a project reaches it, the project **halts and asks**. It does not fail, it does not silently continue, and it does not quietly deliver something cheaper than promised.
3. **Live spend during the run**, without the person asking.
4. **The price of any action that costs money, shown before the action** — regenerating a shot, adding a variant, re-timing after a script edit.
5. **A final reconciliation** against the estimate.
6. **Refunds are visible.** When something fails terminally and money is returned, the person is told. The existing product has been burned by the inverse of this: an unconditional "credits refunded" message that was not always true, since removed (lock L2.7 in `audit/11-lockdown-plan.md`). Do not reintroduce the pattern in either direction.

---

## 6. Provenance and disclosure

The finished video carries machine-readable provenance, and the person is told what it says and where disclosure is required. Practically:

- The delivery screen states that the video is AI-generated and carries provenance metadata.
- Where the person schedules to a platform with its own AI-disclosure control, the interface should carry that fact forward rather than making them remember it.
- Nothing here should be framed as legal advice, and nothing should overstate coverage.

---

## 7. Dependencies

**The brand kit.** This surface cannot function without one. The kit already carries a colour palette, typography notes and visual style keywords (`supabase/functions/extractBrandKit/index.ts:60-62`). The compiler additionally needs logo assets with placement rules, approved reference imagery, banned terms and required legal/CTA copy. Completing the brand kit is lock **L5.12**, currently open — this surface is blocked on it, and the design should assume the richer kit exists.

**Credits and billing.** Balance, estimate, reservation, refund. Pricing moves to USD per the founder decision of 2026-08-30; the credit model itself is being re-derived separately and the interface should not hard-code the shape of a pack.

**The content library and calendar.** Delivery targets. A finished video that cannot be scheduled is a dead end.

---

## 8. What this surface is explicitly not

- It is not a video editor. There is no timeline scrubbing, no trimming, no layer manipulation. The unit of manipulation is **the shot**.
- It is not the clipping surface. It never ingests a long video to cut down.
- It does not offer model choice to the person. Which model renders which shot is a system decision made on quality, cost and shot type. Exposing it would be exposing an implementation detail that changes monthly.
- It does not promise the person can fix anything. Some shots will degrade to stills. The interface's job is to be honest about that, not to imply unlimited retries.

---

## 9. Open questions for the design

These are genuine, and the design should propose answers rather than assume them:

1. **Is the shot list the primary object of the workspace, or is the video?** A person who wants to watch and leave wants the video. A person who wants to fix shot 7 wants the list. Both are real.
2. **How is a degraded shot shown** so that it reads as an honest outcome rather than a failure — without making it so soft that the person misses it?
3. **What does "waiting on you" look like** when the person is not on the screen? Notification, email, both, neither?
4. **How much of the script is editable, and until when?** The cost cliff after voice-over commitment is real and needs a legible expression.
5. **Does the rough-cut gate auto-pass after an interval?** Auto-passing keeps the promise; not auto-passing protects the spend. This is a product decision with a cost attached either way.
