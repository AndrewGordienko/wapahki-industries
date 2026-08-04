# Outreach Handbook — Source of Truth

This is the master strategy document. **Everything downstream is built from here:**
research, the campaign configs (`data/campaigns.json`), and the email playbooks
(`playbooks/`). When strategy changes, change it HERE first, then propagate to the
agents/playbooks.

---

## 1. System architecture (the pipeline)

```
  HANDBOOK (this file)  ──configures──►  research passes
                                              │
     1. FIND companies  ── source-backed research, using each campaign ICP
        (with a defensible problem + budget + an interesting project)
                                              │  ► YOU review & approve  ◄── human in the loop
     2. FIND people     ── find the right roles and establish a credible route
                                              │  ► YOU review & approve  ◄──
     3. ENRICH emails   ── Apollo (LAST step only) turns approved people → verified emails
                                              │
     4. WRITE sequences ── Codex CLI, using Andrew's ChatGPT/Codex login, builds
                           the 7-touch sequence from the campaign playbook
                                              │
     5. REVIEW + GATE   ── evidence, role-fit, clarity, and reply editors review
                           it; deterministic checks reject invalid sequences
                                              │
                            CRM (this app) stores + displays everything;
                            you work the list and mark status.
```

Principles:
- **No usage-billed OpenAI API in the default workflow.** Local scripts invoke
  `codex exec`, which reuses Andrew's authenticated ChatGPT/Codex access. OpenClaw
  and direct API clients are legacy or explicit opt-ins, not writer defaults.
- Apollo is used ONLY at the end to find emails for people already chosen.
- **Human-in-the-loop:** agents surface findings; we approve before they proceed and
  before we spend Apollo credits. Agents iterate on what we approve.
- **Defensible or it's out:** every target carries evidence (with a source).
- **Fail closed:** missing research, bad role fit, failed model review, or failed
  deterministic validation means no sequence is stored.

---

## 2. Campaigns (three separate funnels — never mixed)

Each funnel has: a config block in `data/campaigns.json`, an email playbook in
`playbooks/<id>.md`, and its own set of contacts in the CRM (`campaign` column).

### 2a. Wapahki — factory robotics  `[LIVE: 50 companies / 250 contacts]`
- **Offer:** flexible robotic work cells that adapt between products/packaging
  without a long integration project.
- **ICP:** GTA/SW-Ontario factories, co-packers, warehouses with MANUAL lines.
- **Contacts:** floor-level supervisors, process/packaging engineers, maintenance,
  sanitation, continuous-improvement, warehouse ops. (CEOs won't reply.)
- **Rule applied:** every company must have 5 emailable contacts or it's dropped and
  replaced by a bigger one.
- Status: sourced + enriched + unique per-contact angles written.

#### Wapahki call-derived follow-ups (active T2–T4 design)

These two research calls are now reserved source packs for Wapahki follow-ups.
They are first-party interview notes, not independently verified market data.
Outbound copy may say that Andrew learned something on a recent call and may
attribute it to the kind of practitioner interviewed. It must not present a
speaker's estimate, example, or recollection as a measured industry fact.

The channel and source progression is fixed:

1. **T2, day 4, email in the T1 thread:** add one relevant lesson from the
   **factory automation and packaging call** below. A natural bridge is
   `Since I wrote, I spoke with...` or `On a recent call with...`. Never say
   `since we last spoke` when Andrew and the recipient have not spoken. The new
   lesson must lead to one narrower, role-relevant question; it cannot merely
   decorate a repeat of T1.
2. **T3, day 6, LinkedIn connection request:** send a short connection note,
   not a second pitch and not a post-acceptance message. Give the shared topic
   in one sentence. Do not ask for a call, include a link, repeat the email, or
   imply the person saw it.
3. **T4, day 9, email:** add one different, relevant lesson from the
   **truck-maintenance and standardization call** below. Select the detail by
   the person's job and company. Do not force truck-specific facts onto a food,
   packaging, or general manufacturing contact; use the broader lesson about
   standardization, scheduled work, inspection, or human oversight instead.
   If none fits the person's remit, use a routing question rather than a
   strained analogy.

**Source pack A — factory automation and packaging feasibility.**  
[Granola call notes](https://notes.granola.ai/t/ecf47f48-df80-4f65-b837-a4fe9b66a1d8)

- The central buying question is economic, not whether a robot can be made to
  perform the task. Compare no automation, partial automation, and full
  automation against expected volume, task variety, labour, integration cost,
  and the cost of exceptions.
- At a hollow-metal-door factory, CNC machines reportedly handled roughly 80%
  of the heavy cutting and bending while a person still operated the process.
  An Excel-to-SolidWorks automation covered about half the design cases; the
  remaining variability was not worth the additional budget.
- At a mixed-product plastics/acrylic operation, workers moved among gluing,
  polishing, cleaning, printing, and packing, with products changing every day
  or two. That variability, rather than a missing robot capability, made full
  automation unattractive at the observed volume.
- Packing varied among bubble wrap, corrugated board, shrink material, thin
  paper, and boxes, sometimes in several protective layers for brittle parts.
  This is useful for packaging roles because it identifies the exception
  handling that a practical first system would need to bound.
- Non-deterministic behaviour creates an accountability problem in regulated or
  safety-critical work. A deterministic safety layer and a clear handoff to a
  person are part of the proposed answer, not proof that the problem is solved.
- Treat the `$20–30/hour` floor wage, the `$5K` robot-arm idea, and the extreme
  `$1B` versus `$50K` shop comparison as interview estimates or thought
  experiments. Do not place them in outbound copy as facts.

Route source pack A by role:

- Plant, production, and continuous-improvement leaders: the partial-versus-full
  automation boundary, volume, product mix, and which stable slice comes first.
- Packaging and warehouse roles: material changes, brittleness, protective
  layers, and which exception still needs a person.
- Operators and maintenance: what the machine handles, what the operator resets,
  and when maintenance takes over.
- Automation, quality, and safety roles: deterministic limits, safe states, and
  accountability for exceptions.

**Source pack B — truck maintenance, standardization, and inspection.**  
[Granola call notes](https://notes.granola.ai/t/d8a82f7f-bcda-4471-8049-029f546c39b8)

- Repetition within tight tolerances is the automation advantage. Trucks remain
  difficult because engines, filter counts, filter locations, and other service
  details vary by make and configuration.
- Wheel service is a useful boundary case for fleet or heavy-equipment contacts:
  the speaker described North American highway-tractor wheels as comparatively
  standardized, yet mounting and dismounting remained manual and a wheel could
  weigh roughly 150 lb. Keep the number attributed to the call.
- Scheduled maintenance is more amenable to automation than unscheduled repair.
  The described flow ran from staging, to a service bay, inspection or repair,
  reassembly, a ready area, and notification.
- The speaker described a Honeywell voice-guided preventive-maintenance project
  that replaced a clipboard checklist, used observed failure rates to change
  inspection frequency, and reordered the technician's path around the truck.
  In outbound copy, describe this as an example shared on the call unless a
  separate primary source verifies the implementation.
- Standardizing the fleet creates repetition; optimizing technician attention
  and movement may be valuable before attempting full physical automation.
- The roughly `5%` fleet-margin and `$45/hour` technician-cost figures are
  speaker estimates. Do not state them as verified company or industry facts.

Route source pack B by role:

- Fleet, truck-service, and heavy-equipment roles: vehicle variability,
  scheduled versus unscheduled work, wheel handling, oil/filter differences,
  and the staging-to-ready service flow.
- Maintenance and reliability roles in any factory: guided inspections,
  exception frequency, handoffs, and technician walking time.
- Plant, production, automation, and continuous-improvement leaders:
  standardize a product family or scheduled task before automating it.
- Safety and ergonomics roles: keep people out of the heaviest repeatable step
  while retaining human judgment for variable or safety-critical exceptions.

### 2b. GNK — senior software & AI engineering  `[strategy set, not sourced]`
- **Offer:** small senior software & AI engineering team (Toronto). We remove a
  specific expensive bottleneck with AI agents/automation — faster & lower-risk than
  hiring. $10k–$30k projects → retainers. Near-term goal ≈ CAD $40k/mo.
- **Strategy = problem-first + interesting + budgeted.** Built from the reels in
  `docs/gnk-strategy/`:
  - Cuban: "100 things you don't have time to check — I'll automate with agents, and
    if it doesn't work you don't pay." → **risk reversal**.
  - Menezes: "you have a $1M problem; I'll automate it and charge ~20% of the value."
    → **value-based pricing on a specific problem**.
  - Cardenas: AI-consult a niche, then productize the whole workflow → land & expand.
  - Cheek: agents can run end-to-end (proof of ambition).
  - Priestley: follow the ownership transition as established business owners
    delegate, sell or move into advisory roles → **make the business less
    owner-dependent without targeting people by age**.
- **THREE hard filters + the interesting bar** (a target needs all four):
  1. **BUDGET (hard):** can plausibly fund a **CAD $10k–$30k fixed-fee pilot**
     and, if it works, an ongoing engineering relationship. Evidence of
     ability-to-pay is required (revenue, funding/endowment, sponsorship/ticket
     money, gov/enterprise contracts, established operating scale, or visible
     technology/modernization spend). GNK's own near-term target is approximately
     CAD $40k/month; that is not a claim that every prospect needs a $40k monthly
     retainer. No budget evidence → cut.
  2. **REACHABLE & CLOSEABLE (hard) — the make-or-break filter.** We are a small
     Toronto shop. The org must have a **decision-maker with budget authority we can
     actually reach** (a Director/VP/CTO/founder — not a procurement gauntlet), and be
     the kind of place that will **respond and sign inside 30–90 days**. Giant slow
     bureaucracies — big public universities, national labs (e.g. CERN), massive
     hospital systems / huge NGOs with formal procurement — are usually **too slow to
     close → HARD tier or CUT** even when the work is amazing. "It would be cool" is
     not enough; "would this VP reply to Andrew and sign a $10–30k pilot?" is the test.
     (e.g. ASU won't take our call — cut.) Favour nimble, well-funded, accessible orgs:
     scale-ups, funded startups, mid-sized companies, pro teams' analytics groups,
     smaller well-funded foundations/nonprofits, regional operators.
  3. **DEFENSIBLE PROJECT (hard):** a specific, evidence-backed AI project we can name
     on call one.
  4. **INTERESTING / MEANINGFUL (the point):** projects worth doing — that help people
     or are genuinely interesting to build. Not CRUD apps. Favoured themes:
     - Climate / ocean / conservation (e.g. **model ocean pollution for The Ocean
       Cleanup** if there's a concrete modeling need).
     - Sports analytics / AI (e.g. **draft & scouting models for a pro team**).
     - Science, health, medical research, humanitarian / social impact, education.
     - **Owner independence / business continuity:** established, privately held
       firms where a public business-transition or operating signal supports one
       concrete project that reduces how much routine work waits for the owner or
       one long-tenured expert. Preserving jobs, customer service and operating
       knowledge through a transition is meaningful work.

- **Owner-independence lane (Priestley reel → GNK offer):**
  - **ICP:** profitable Canadian-first owner-operated companies, normally about
    20–250 employees, in operationally dense sectors such as field services and
    trades, specialty manufacturing/distribution, equipment service, logistics,
    commercial property/facility services and multi-location business services.
    The company must be large enough to fund a paid pilot and small enough that a
    President/Owner/GM/COO can sponsor it without enterprise procurement.
  - **Why now must be public and business-specific:** a stated succession or
    ownership transfer, newly appointed president/GM/COO, acquisition integration,
    owner search for operating leadership, ERP/digital-modernization initiative,
    repeated hiring around a documented bottleneck, or a directly disclosed
    knowledge-continuity problem. A person's age, grey hair, tenure or founder
    title is never a signal. An anonymous business-for-sale listing is not a named
    account.
  - **Project wedge:** choose one recurring workflow whose preparatory work can
    be automated while a person retains approval—for example turning quote
    requests and PDFs into a prepared estimate, assembling the next dispatch
    plan, drafting routine customer updates from job records, matching invoices
    and purchase orders for review, retrieving the right SOP for an exception, or
    preparing a handoff from service history. Never pitch “automate your whole
    business.”
  - **Measured outcome:** owner/senior-expert interruptions per week, cycle time,
    backlog, rework/errors, time to train a manager, or percentage of cases a
    manager can complete without escalation. Do not promise a higher sale
    valuation without evidence.
  - **Delivery:** a fixed-fee owner-independence pilot on one workflow, normally
    4–6 weeks and CAD $10k–$30k. Start in shadow mode; use the company's real
    systems and permissions; keep a human approval step for money, safety,
    employment, legal, tax, credit and customer commitments.
  - **Buyers:** Owner/President for a genuinely small firm; General Manager, COO,
    VP/Director of Operations, Controller, Service Manager, Dispatch Manager,
    Estimating Manager or the named successor/operating leader when the company
    has made that role public. Accountants, succession advisors, M&A brokers,
    fractional CFOs/COOs and industry associations are referral channels, not
    evidence that a named client has the problem.
  - **Outreach frame:** `fewer routine decisions waiting for one person` and
    `preserve how the work gets done`—not job replacement, “AI transformation,”
    age, retirement or a scare story about the company failing after the owner.
    Bring one source-backed workflow hypothesis and a one-screen sketch; ask the
    recipient to correct it.
  - **Cut:** lifestyle/microbusinesses without pilot budget; a company selected
    only because its owner appears older; fully autonomous high-stakes decisions;
    vague “AI can help” discovery; businesses already in a confidential sale
    process where cold outreach would be intrusive; or work that requires
    extracting undocumented knowledge without the expert's consent.

- **Tier every opportunity by how fast we could realistically CLOSE it:**
  - `easy`  → could sign inside **30 days** (reachable decision-maker, budget on hand,
    short sales cycle, clear pilot). **Target: ~20.**
  - `medium` → **60 days** (a bit larger / one approval layer). **Target: ~20.**
  - `hard`  → **90 days** (bigger org, more process, but still genuinely closeable).
    **Target: ~10.**
  Total funnel ≈ 50, weighted toward EASY. If we can't picture them replying and
  signing within 90 days, they don't belong on the list at all.
- **Method:** go DEEP on each org — understand the mission, then design the AI project
  that would genuinely move it; that becomes the outreach hook.
- **Contacts:** senior enough to act, close to the work — VP/Dir Engineering, Head/Dir
  Product, Dir Software/Data/AI/Automation, Eng Manager/TPM, Dir Operations/Digital
  Transformation; smaller orgs: CTO / technical founder / COO. Avoid CEOs at large
  orgs, recruiters, junior devs, generic sales.
- **Opportunity dossier** (what research must output per org): `org`, `domain`,
  `theme`, `what_they_do`, `ai_project`, `why_meaningful`, `defensible_problem` +
  `evidence(source)`, `budget_signal` + confidence, `ideal_contacts`.

### 2c. OutageHub — Canadian outage data (map + API)  `[LIVE: 50 companies (20/20/10) / 250 contacts at 5/5 · blurbs + 7-touch sequences written]`
- **Offer:** Canadian power-outage data as a **live national map (the free/low wedge)** and
  an **API (the paid expand)**. The ask is a discovery call about how outages hit their operation.
- **The reframe — how you sell a data/API source (read this first):** nobody buys "an outage
  feed"; they buy a **loss avoided or a decision made faster** — protected cold-chain loads,
  generators dispatched sooner, chargers/sites kept online, SLA credits not owed, crews not
  sent blind. Pitch and price the **dollar outcome downstream of the data**, never the data
  itself. Specifically:
  - **It's a two-audience sale.** A technical person *evaluates* the API (docs, reliability,
    JSON); an ops/continuity leader *pays* for the outcome. Win both — proof AND ROI.
  - **Prove the data is real: "bring your own outage."** Ask them to name a recent outage that
    hurt them and show the map/API caught it faster than they knew. Data is trust — let them
    validate against a case they already know the answer to. This is the biggest unlock.
  - **Time-to-value in minutes.** The map is the instant, no-commitment wedge; the API is the
    land-and-expand once they trust the data.
  - **Meter on THEIR value unit,** not raw API calls: per site/asset monitored, per alert, per
    avoided truck-roll/spoilage event. Map free → API usage tiers → enterprise annual + SLA.
    Value-based (a slice of avoided loss, à la Menezes' 20%) only for marquee accounts where
    the outcome is clearly attributable.
- **ICP:** Canadian ops/tech teams whose work depends on power reliability — generator rental /
  emergency & backup power, cold-chain logistics & refrigerated distribution, EV charging
  networks, telecom / tower / field service, municipal alerting & emergency management,
  multi-location retail/grocery/QSR with continuity needs, data centers / critical facilities.
- **Contacts (Wahpaki rule — reach the person who FEELS it, not the CEO):** Dir Operations,
  Fleet/Network/Field Operations, Business Continuity, Emergency Management, Infrastructure,
  Reliability, Product, Technical Partnerships.
- **Four hard filters (a target needs ALL four — GNK discipline, adapted to a data product):**
  1. **REAL MONETARY VALUE IN THE OUTAGE (hard) — this is the "budget" filter.** An outage must
     cost this org **real, quantifiable money per hour** (spoiled loads, SLA credits, lost
     dispatch revenue, downtime, blind truck-rolls). No dollar pain from outages → cut, however
     nice the logo.
  2. **REACHABLE & CLOSEABLE (hard).** A reachable ops/continuity decision-maker (Director/VP,
     not a procurement gauntlet) who could reply to Andrew and sign a pilot inside 30–90 days.
     Giant utilities / slow municipal procurement → HARD tier or cut.
  3. **DEFENSIBLE OUTAGE PROBLEM (hard):** a specific, evidence-backed way outages hurt them,
     WITH a source (fleet size, # of facilities/sites, SLA commitments, service area, a recent
     outage impact). No evidence → out.
  4. **5 EMAILABLE CONTACTS or drop** (Wahpaki rule): if we can't reach 5 real people, it's too
     small to work — drop and replace with a bigger operator.
- **Close-tier the funnel (weighted to fast — 20 / 20 / 10 = 50):**
  - `easy`  → sign inside **30 days**: acute, quantified outage pain + small/mid ops team +
    reachable director + the map/pilot is low-commitment. **Target ~20.**
  - `medium` → **60 days**: bigger, one approval layer. **Target ~20.**
  - `hard`  → **90 days**: enterprise / municipal / more process, but genuinely closeable.
    **Target ~10.**
  If we can't picture them replying and signing within 90 days, they don't belong on the list.
- **Research output per org (the dossier):** `org`, `domain`, `hq`, `segment`, `what_they_do`,
  `outage_problem` (the monetizable pain) + `evidence`(`source_url`), `value_unit` (how we'd
  meter/price it), `budget_signal` + confidence, `ideal_contacts`, `close_tier` + rationale.

---

## 3. Outreach sequence + writing rules (all campaigns)

Grounded in the founder-sales interviews and field notes
(`docs/sales-sequence/`), the 14-transcript + Reddit corpus in
`docs/cold-email-writing/`, the founder/creator sales clips in
`docs/founder-sales-clips/`, and the four focused handbooks in
`docs/outbound-doctrine/` (built from ten practitioner talks to fix the
generator's recurring evidence, hypothesis, routing, and follow-up failures).
Full detail in `playbooks/_shared.md`.

- **EVIDENCE, NOT CONFIDENCE (the governing law).** A company-specific claim needs a
  source in the contact context. `relevance_reason`, `defensible_problem`, and
  researcher-written project ideas are hypotheses, not facts. They can become an
  open question or proposed example, never a diagnosed internal problem.
- **ROLE FIT BEFORE COPY.** The writer must be able to say why this role can answer
  or act on the question. If it cannot, it returns `do_not_contact` rather than forcing
  a generic email.
- **7 touches, alternating email ↔ LinkedIn**, days 1 / 4 / 6 / 9 / 11 / 15 / 18.
- **Complete, not artificially short.** Touch 1 usually has 80–135 body words,
  4–6 natural sentences, and three short paragraphs. It contains a verified reason
  for writing, one role-relevant question, a plain offer, and one CTA.
- **Calls are 20 minutes.** Never ask for 10 or 15 minutes. A touch-1 call is fine
  when the email earns it. Do not call 20 minutes "quick." Other touches may offer
  a useful artifact or ask one easy question instead of requesting more time.
- **Posture is per campaign.** Wapahki is informed discovery. GNK brings a specific
  build hypothesis instead of asking the buyer to invent an AI use case. OutageHub
  offers a real outage record without claiming it detected the event first.
- **Peer signals are context, not FOMO.** Never imply the recipient is behind, should
  copy a peer, or can beat a larger organization simply because it is smaller.
- **Native, plain English.** Concrete subjects and verbs, one idea per sentence,
  contractions, no abstract consultant phrasing, canned self-deprecation, or
  repeated requests for a rejection.
- **Subjects are 2–5 naturally capitalized words** and describe a real topic. No vague curiosity
  bait, fake internal threads, unsupported loss claims, or blame around bad events.
- **The makes-sense test:** the reader must understand why them, what Andrew does,
  and what the ask refers to on one read.
- Each message must be unique — no templates, no reused structure.
- Every sequence receives four editorial reviews: evidence, recipient/role,
  clarity/native English, and reply value. Review failure blocks storage.
- Per-campaign evidence limits, role routes, and offers live in
  `playbooks/<id>.md`.

> **KNOWN DATA LIMIT:** many of the 790 contacts still have no source-backed
> per-contact signal. `people.relevance_reason` often contains speculative prose
> from an older generation pass and must not be treated as evidence. Company-level
> sources can support carefully routed outreach; thin rows should remain unwritten
> until research improves them.

---

### 3a. Repeatable sales execution

The Letter AI field note in
`docs/sales-sequence/i-spent-24-hours-with-the-sales-team-behind-a-300m-startup.md`
adds an operating layer to the message rules. It is a produced company profile,
so its commercial and product claims are examples to test, not independent proof
of causation.

- **Treat product-market fit and go-to-market fit as different jobs.** A product
  getting traction does not mean the sales motion is finished. Keep founder,
  product, delivery, and customer feedback connected while the market and
  message are still changing.
- **One deal record, one dated next action.** Every active opportunity should
  show the current decision, verified evidence, open uncertainty, stakeholders,
  owner, next action, and date. A weekly pipeline review is a decision and
  obstacle review, not a recital of CRM fields.
- **Codify founder knowledge.** After a useful call, demo, objection, win, or
  loss, capture the buyer's language, the question asked, the proof used, what
  failed, and the next move. Promote repeated lessons into the handbook and
  playbooks; do not leave them in one person's memory or a call recording.
- **Rehearse the next real conversation.** Before a strategic message, demo,
  pilot review, security discussion, or commercial call, practise against the
  hardest credible buyer question for that account. Generic pitch practice is
  secondary to role-, deal-, and stage-specific preparation.
- **Prepare for fit and proof questions.** The private message brief must name
  one likely skeptical question, the exact proof boundary, and the next step if
  the hypothesis survives. If there is no relevant case study or result, offer
  a sketch, sample record, fixed-fee pilot, or bounded test instead of inventing
  proof.
- **Make founder involvement selective and explicit.** The seller owns the
  opportunity. Pull Andrew or the relevant technical lead in when the deal is
  unusually large, the product or market question is novel, the message is
  still being learned, an executive decision is blocked, or delivery risk needs
  direct technical judgment.
- **Keep customer reviews inside the sales loop.** Regular reviews should ask
  what is working, what is not, what changed, and what would make the product
  more useful. Capture adoption, friction, requested changes, expansion
  evidence, and the customer's own language for future product and message
  decisions.
- **Measure buyer progress, not activity.** Qualified replies, stakeholder
  introductions, agreed next actions, pilots, adoption, expansion, retention,
  and reasons for loss matter more than messages sent, meetings held, or fields
  updated.

The message itself should remain simple. The research and rehearsal behind it
should be richer than the copy the buyer sees.

### 3b. Sending / deliverability (operational — before any real send)
Copy is only half the game. Before any real send:

- **Hard Gmail preflight:** configure SPF or DKIM for every sending domain, valid
  forward and reverse DNS/PTR, TLS, RFC 5322-compliant formatting, and an
  accurate sender identity. For roughly 5,000+ daily recipients at personal
  Gmail addresses, Gmail requires SPF, DKIM, DMARC, and organizational-domain
  alignment.
- For promotional bulk mail, support both RFC 8058 one-click unsubscribe and a
  visible unsubscribe link, then honour requests promptly. Maintain suppression
  lists and applicable consent or legitimate-interest records.
- Monitor Postmaster and SMTP diagnostics, bounces, deferrals, reputation, and
  complaints. Google advises keeping user-reported spam below 0.1% and never
  reaching 0.3%. Reduce volume and diagnose problems before ramping again.
- Never rotate domains or infrastructure to evade rejection. Separate
  transactional and promotional streams, use consistent sender identities, and
  protect the primary/root domain when appropriate.
- Keep cold messages plain, with few or no links and no open-tracking pixel.
  Secondary domains, mailbox counts, exact daily volume, warm-up duration,
  bounce thresholds, and send time are operating hypotheses to test, not
  universal rules.
- This is a human-approved, low-volume, targeted motion, not a purchased-list
  blast. The cited basis and caveats are in
  `docs/sales-research/research-wisdom.md`.

## 4. How agents are built from this handbook

- `data/campaigns.json` — machine-readable ICP + positioning per funnel (derived from §2).
- `playbooks/_shared.md` + `playbooks/<id>.md` — the email writer's brain (derived from §2 + §3).
- The managed `REDDIT-WISDOM` block in `playbooks/_shared.md` is an active,
  required writer input distilled from the handbook's cited Reddit research. The
  writer refuses to run if that block is missing. Evidence and campaign rules
  remain authoritative when a practitioner tactic conflicts.
- The managed `SALES-RESEARCH` block in `playbooks/_shared.md` is also an active,
  required input. It contains compatible guidance distilled from the YouTube
  transcripts, MIT course material, open textbooks, book excerpt, web sources,
  and Reddit cross-check in `docs/sales-research/research-wisdom.md`. The writer
  refuses to run if this block is missing.
- The managed `OUTBOUND-DOCTRINE` block in `playbooks/_shared.md` is an active,
  additive input (not fail-closed). It carries the consolidated must-follow rules
  and pre-send checklist from the four focused handbooks in
  `docs/outbound-doctrine/`, plus the two governing hard rules (the evidence
  boundary and the follow-up value gate, both also promoted into Gate 1 and the
  follow-up section). It reaches the writer automatically because
  `write-sequences.js` passes all of `_shared.md` except the Reddit and
  sales-research blocks into the shared rules. Several of its rules are already
  enforced deterministically in `src/outreach-quality.js` (evidence sources in
  the spoken brief, unique per-touch `new_information`, repeated-question and
  repeated-sentence detection, surface-personalization ban); the doctrine adds a
  few banned phrases (a hypothetical `would you use`, `reaching out on behalf of`,
  FOMO `falling behind`).
- The managed `SALES-CLIPS-WISDOM` block in `playbooks/_shared.md` is an active,
  additive input (not fail-closed). It distills five email-craft refinements from
  the founder/creator sales clips in `docs/founder-sales-clips/clips-wisdom.md` —
  diagnose don't demo, value in the recipient's terms, say it out loud, reduce
  decision load to one clear next step, and stand out with real effort not
  templates. Because `write-sequences.js` passes all of `_shared.md` except the
  Reddit and sales-research blocks into the shared rules, this block reaches the
  writer automatically. Evidence and campaign rules stay authoritative on
  conflict; the clips' volume/automation framing and unverified numbers are out.
- `src/codex.js` — structured Codex CLI access through the existing ChatGPT login.
- `scripts/write-sequences.js` — draft → editorial panel → revision → deterministic
  validation → store. It reviews a full sequence together, not isolated cells,
  and stores the final private rehearsal in `people.sales_brief` so the role
  route, skeptical question, proof boundary, and next step are not lost after
  generation.
- `src/outreach-quality.js` — non-negotiable formatting, call-length, phrase, and
  sequence-repetition checks.
- Research tools read the relevant campaign section as their operating brief.
- To change behavior: edit this handbook, then propagate to the campaign config,
  playbook, prompts, and deterministic checks. This file wins.

---

## 5. Changelog
- 2026-08-02 — Built the OUTBOUND DOCTRINE: four focused handbooks in
  `docs/outbound-doctrine/` (A research & proof boundaries, B problem-hypothesis
  & ownership testing, C cold-email construction, D sequence progression &
  account routing), targeting seven recurring generator failures (asserting a
  hypothesized workflow, inferring ownership from a title, premature
  solution/pilot/ROI, repeating a hypothesis across follow-ups, invented
  operational language, blasting an account, and high-effort asks). Retrieved ten
  practitioner talks (Becc Holland ×3, Migicovsky/YC, Allred/Lavender, 30MPC's
  85M-email and discovery masterclasses, Allen-Knuth, Winning by Design SPICED,
  Dunford), distilled each with a parallel reader into a five-part extraction
  (rules, failure patterns, bad/good pairs, conditions, checklist), and
  synthesized them into the handbooks; cleaned transcripts and a source registry
  are saved for audit. Promoted the two governing hard rules — the evidence
  boundary (public evidence establishes the environment, never the private
  workflow/owner/difficulty/consequence) into Gate 1, and the follow-up value
  gate (reject any follow-up that adds no new evidence, concrete example, useful
  artifact, or materially different ask) into the follow-up section — plus a
  consolidated `OUTBOUND-DOCTRINE` writer block and a pre-send checklist. Added a
  few deterministic banned phrases in `src/outreach-quality.js`. Evidence and
  campaign rules still win on conflict; reported reply/conversion figures are not
  quoted as forecasts.
- 2026-08-02 — Ingested three founder/creator sales video clips to sharpen the
  emails: Cameron Zoub of Whop (build a profitable SaaS from scratch), Shelby
  Sapp ("people love to be told what to do"), and Chris Donnelly of Searchable
  ($85M AI startup playbook). Downloaded the two YouTube transcripts via yt-dlp
  captions and transcribed the Instagram reel locally with faster-whisper (no
  data left the machine, no billed API). Saved cleaned transcripts plus an
  evidence-bounded, cited synthesis with a conflict log in
  `docs/founder-sales-clips/`. Promoted five compatible, bounded email-craft
  refinements into a new managed `SALES-CLIPS-WISDOM` block in the handbook and
  `playbooks/_shared.md` (diagnose don't demo; value in the recipient's terms;
  say it out loud / voice-memo test; reduce decision load to one clear next step;
  stand out with real one-to-one effort not templates). Added "reaching out on
  behalf of" to the banned openers. Explicitly rejected the clips' volume and
  automation framing, their unverified reply/revenue numbers, and Zoub's invasive
  attention stunts. The block is additive (not fail-closed) and reaches the
  writer automatically because `write-sequences.js` feeds all of `_shared.md`
  except the Reddit and sales-research blocks into the shared rules.
- 2026-07-30 — Retrieved and reviewed the auto-generated transcript for The
  Science of Scaling's Letter AI profile. Added a time-coded, evidence-bounded
  digest and adopted its strongest operating lessons: separate go-to-market fit
  from product-market fit, centralize deal context, rehearse the next real buyer
  conversation, preflight fit and proof questions, record a dated next action,
  define founder pull-in rules, and keep customer reviews in the sales learning
  loop. Propagated the message-level rules into the live shared playbook and the
  structured writer/editor prompts.
- 2026-07-29 — Added two first-party Wapahki research calls as the live source
  packs for the next follow-up sequence: T2 is a same-thread email with one
  relevant factory-automation or packaging lesson learned since T1; T3 is a
  LinkedIn connection request; T4 is an email with a different, role-matched
  lesson from the truck-maintenance and standardization call. Added attribution,
  role-routing, and unverified-estimate safeguards and propagated the design to
  the active shared and Wapahki writer playbooks.
- 2026-07-29 — SECOND-TOUCHPOINT research pass. Pointed the same search engines
  used for touch 1 (Reddit + YouTube transcripts + web/book) at the first
  follow-up. Built a dedicated, non-invasive touch-2 pipeline
  (`config/touch2-sources.json`, `scripts/touch2-learn.js`,
  `docs/second-touchpoint/`, `npm run touch2:*`, with env-overridable corpus
  paths on the scrapers) so it reads its own corpora and writes its own outputs
  without disturbing the first-touch guides. Manually reviewed the 42-thread raw
  Reddit scrape, excluded 35 incidental/off-topic search matches, and distilled
  18 relevant sources (10 YouTube transcripts, 1 open textbook chapter, 7 Reddit
  threads) into `docs/second-touchpoint/touch2-wisdom.md` and a new managed
  `TOUCH2-WISDOM` block in this handbook + `playbooks/_shared.md`. The block
  corroborates/extends the founder-approved "Endorsed follow-up pattern (T2–T4)"
  and is now part of the shared writer brain consumed by `write-sequences.js`
  (additive, not a fail-closed required block). The learner now fails closed on a
  partial model pass or invented source ID. Google + Books API discovery is wired
  but was skipped this run (no `GEMINI_API_KEY` / `GOOGLE_BOOKS_API_KEY`);
  `npm run touch2:google && npm run touch2:books && npm run touch2:learn` folds
  them in later.
- 2026-07-28 — Added unified YouTube, Google, web, and book research ingestion
  and distilled 55 sources into a cited field guide, including an MIT course and
  eight openly licensed textbook records or chapters. Promoted compatible
  signal-verification, proof-scope, conditional-CTA, and channel rules into the
  live writer brain. Replaced practitioner deliverability folklore with current
  Gmail requirements while labelling volume, warm-up, bounce, and send-time
  numbers as heuristics.
- 2026-07-28 — Rebuilt the writer around direct Codex CLI access, eliminating the
  paid OpenAI API from the default path. Replaced the faux celebrity "persona panel"
  with evidence, recipient, clarity, and reply-value editors; review now fails closed.
  Added deterministic sequence validation, a strict evidence/hypothesis boundary,
  a role-fit `do_not_contact` gate, 20-minute call standard, complete touch-1 length,
  non-ambiguous subject rules, and campaign-specific evidence limits. Confirmed the
  stored system has 15 draft sequences / 105 messages, not 790 completed sequences.
- 2026-07-27 — WRITER DOCTRINE overhaul + root-cause found. Diagnosed why drafts read as "sus"/
  "makes no sense": the writer was inventing specific operational facts because the CRM has **0/790**
  real per-contact signals or proof points (confirmed: wapahki 0, gnk only the company's own marketing
  line repeated across all 5 contacts, outagehub 0). Wired the 14-transcript + Reddit corpus (Josh Braun,
  30MPC, mattsand9's "use only facts, never invent" rules, GameGlitcher, F500 rep) into the brain:
  added the **FACTS-ONLY law** + segment-truth-as-hypothesis fallback + makes-sense/90% tests + expanded
  banned phrases + signal-handling (no ambulance-chasing) to `_shared.md`; added **MY CONTEXT** blocks
  (real proof points, who-actually-cares-and-why incl. the real telecom/ISP power-backup link, bad-fit,
  no-invent fallback) to all three `playbooks/*.md`; enforced facts-only in `write-sequences.js` draft +
  review prompts. **Next required build: the OpenClaw research/signal pass** (real per-contact evidence)
  before regenerating — see §3 KNOWN GAP.
- 2026-07-27 — OutageHub SEQUENCES written. All 250 contacts have a full 7-touch email/LinkedIn
  sequence (days 1/2/4/7/10/14/18, 1,750 messages) from the playbook brain (`_shared.md` + `outagehub.md`)
  + each contact's blurb as the angle. Shown as the 7 touch columns on the right of the CRM (click a
  cell → full sequence). Generated via a 50-agent workflow (the OpenClaw gpt writer was contended by a
  parallel wapahki/gnk run); applied to the `sequences` table, idempotent with `write-sequences.js`.
- 2026-07-27 — OutageHub RECONCILED to a clean 50 × 5/5 (20/20/10) + per-contact blurbs written.
  Recovered FirstService Residential via domain-match; dropped Apollo-un-fillable / duplicate / too-small
  (Core Data Centres, Hydro-Québec Electric Circuit, Farm Boy, Comtech Solacom, FCL near-dup, + 5 small);
  backfilled 10 bigger operators via Apollo discovery (Genrep, GAL Power, Cullen Diesel, Superior Propane,
  TransAlta, Collicutt Energy, MCW Group, Red-D-Arc, Plan Group, Quasar). 250 "why reach out" blurbs
  (relevance_reason) written by 10 blurb agents. Scripts: `reconcile-outagehub.js`, `backfill-outagehub.js`,
  blurb batches in `data/blurb/{batches,out}/outagehub-*.json`.
- 2026-07-27 — OutageHub SOURCED. 50 companies loaded into the CRM (`outagehub` campaign),
  tiered 20 easy / 20 medium / 10 hard, from the OpenClaw research run (63 candidates → 50).
  Apollo built 203 contacts; 39 companies at 5/5. 11 short (mostly Apollo org-resolution misses
  on big orgs — Farm Boy/Empire, FirstService Residential, Hydro-Québec's Electric Circuit — plus
  an FCL near-duplicate and a few genuinely small operators): retry-by-domain then drop/replace
  per the 5-emailable rule. Dossiers: `docs/outagehub-companies.md`; data: `data/outagehub-candidates.json`.
- 2026-07-27 — OutageHub strategy finalized (data/API selling wisdom: sell the outcome not the
  feed, two-audience sale, "bring your own outage" proof, meter on their value unit; four hard
  filters incl. real-monetary-value-in-the-outage; 20/20/10 close tiers). OpenClaw agents
  sourcing 50 Canadian companies → `data/outagehub-candidates.json` + `docs/outagehub-companies.md`.
- 2026-07-27 — Handbook created. Wapahki live (50/250). GNK strategy set (problem-first
  + ≥$40k/mo budget + interesting/meaningful projects). OutageHub stubbed. Architecture:
  OpenClaw research → human approval → Apollo emails at the end.

<!-- REDDIT-WISDOM:START -->
## Practitioner signals from Reddit

### Evidence Boundaries

This corpus is useful as practitioner signal, not proof. The notes include recurring advice, one-person anecdotes, disputed tactics, self-reported benchmarks, and promotional claims; none should be treated as causal evidence or universal law. [R005] [R009] [R010] [R012] [R014] [R016] [R022] [R023]

The strongest pattern is not a magic script. It is the combination of narrow targeting, a real reason to contact the prospect now, concise problem-led messaging, respectful follow-up, and measurement that looks beyond opens and sends. [R003] [R004] [R005] [R006] [R008] [R010] [R014] [R016]

### Recurring Advice

### 1. Start With Fit And Timing

Cold outreach is framed most positively when it finds people who already have a plausible current need, not when it tries to create demand from indifferent prospects. [R003] [R004]

Good targeting starts with a narrow ICP, a concrete problem, and a visible reason the outreach might matter now. [R003] [R008] [R009] [R014] [R016]

Useful “why now” signals mentioned across the sample include competitor engagement, active vendor evaluation, company announcements, hiring, leadership changes, events, webinars, funding or budget changes, public posts, operational pain, workflow disruption, and tool-switching behavior. [R003] [R005] [R008] [R009] [R014] [R020] [R023]

A prospect’s title or industry alone is weak personalization; the message should connect a specific trigger to a likely business issue. [R008] [R014]

Bad targeting can make strong copy look ineffective, while strong timing can make imperfect copy work. [R003] [R004] [R014]

Fast disqualification is a legitimate goal: identify whether the prospect owns the problem, cares now, and has a reason to continue. [R002] [R003] [R004] [R013]

### 2. Write Around The Prospect’s Problem

The recurring copy advice is to lead with the prospect’s situation, pain, risk, or business outcome instead of the sender’s company, product, credentials, or services. [R005] [R008] [R009] [R012] [R014] [R016]

Short, plain, specific language is repeatedly preferred over long, polished, marketing-heavy copy. [R005] [R008] [R009] [R012] [R015]

Specific personalization should be tied directly to the reason for outreach; generic praise, fake familiarity, creepy personal details, or obviously templated research can reduce trust. [R005] [R008] [R014]

Proof helps when it is credible, relevant, and verifiable, but self-reported client outcomes, screenshots, revenue claims, ranking claims, and named examples from Reddit posts should be treated cautiously unless independently verified. [R009] [R022] [R023]

Avoid claiming to be the best; show relevance through the problem, verified proof, customer context, competitive trigger, or a specific finding. [R005] [R016] [R023]

### 3. Use Low-Friction CTAs

The sample repeatedly favors interest-based CTAs before meeting asks. Ask whether the issue is relevant, whether they want the finding, who owns the problem, or whether it is worth exploring. [R005] [R009] [R012] [R014] [R015]

Early aggressive meeting asks can feel invasive when the prospect has not shown interest. [R005] [R014]

A good CTA should make “no” easy, because qualification is part of the job. [R002] [R003] [R004]

When the owner is uncertain, asking for the right contact can be more credible than pretending to know the org chart. [R007] [R009] [R014] [R015]

### 4. Follow Up Without Becoming Pressure

Follow-up should add clarity, useful context, a new angle, a status check, or a response to an objection rather than simply repeating pressure. [R004] [R012] [R014] [R022] [R023]

Reliability after a conversation matters: writing down commitments and acting quickly can build trust, especially in relationship-heavy or territory sales. [R001]

Systems and reminders can support consistency, but they should not become harassment or pressure automation. [R010] [R012]

### 5. Match The Channel To The Buying Motion

Phone is repeatedly described as useful for fast qualification and for finding the right internal stakeholder. [R002] [R003] [R006] [R007]

Email remains useful in some B2B contexts, but the sample includes strong disagreement from people who see high-scale automated email as spam or ineffective. [R009] [R010] [R014] [R016]

Community participation, events, webinars, support channels, and niche forums may outperform cold email for some creator, small-business, or community-driven markets. [R008] [R016] [R022]

In-person outreach and physical mail may work in territory, industrial, or high-value contexts, but those anecdotes should not be automatically imported into SaaS or remote-first motions. [R001] [R006]

### 6. Treat Deliverability As Hygiene, Not A Loophole

Deliverability matters because copy and targeting cannot be evaluated if messages do not reach inboxes. [R014]

Operational hygiene mentioned in the sample includes SPF, DKIM, DMARC, clean lists, plain-text formatting, limited formatting, and avoiding invalid or low-quality addresses. [R005] [R010] [R014] [R015] [R012]

The sample strongly warns against spam tactics: deceptive subjects, fake personalization, irrelevant blasts, domain hopping, provider churn, and automation designed to bypass recipient preferences or spam controls. [R005] [R006] [R010]

High-volume automation is especially contested; several commenters equate it with spam when senders focus on warmups, burned domains, rotation, and scale instead of relevance and consent awareness. [R010]

### 7. Measure Buyer Progress, Not Activity Theater

Measure outcomes such as replies, qualified conversations, meetings booked, pipeline quality, clients closed, revenue, customer fit, retention, renewal quality, list quality, and negative replies. [R005] [R006] [R010] [R012] [R014] [R022]

Activity metrics can help diagnose process, but they should not become the definition of selling. [R006]

Track each funnel step separately, and avoid treating the last touch before a meeting as proof of causality. [R005] [R014]

Segment results by ICP, channel, offer, ACV, buyer maturity, and sales motion because industrial territory sales, freelancer outreach, creator markets, enterprise sales, and SaaS email may behave differently. [R001] [R005] [R006] [R016] [R022]

Tiny samples can mislead; several commenters argue that a very small send count is insufficient to validate or kill a channel, though their suggested thresholds are hypotheses rather than rules. [R016]

### Message Craft Playbook

### First Email Structure

Use this structure when you have a real trigger:

```text
Subject: {specific trigger or problem}

Hi {name},

Noticed {real trigger}. Teams in {role/company context} sometimes run into {specific business problem} when that happens.

We helped {similar customer/context} with {verified proof}. If this is on your plate, want me to send the short version of what I found?

{Name}
```

This follows the recurring pattern of concise, prospect-centered, trigger-based messaging with a soft CTA and verifiable proof. [R005] [R008] [R009] [R014] [R015]

### Diagnostic Or Audit Offer

```text
Subject: {problem} on {company/site/workflow}

Hi {name},

I found {specific observable issue}. It may be costing {business consequence}, especially if {relevant context}.

I can send the notes with {verified proof} and the 2-3 fixes I would check first. Worth sending over?
```

This fits the advice to lead with a specific finding, sell the outcome rather than the artifact, and ask permission before sending more. [R012] [R014] [R016]

### Right-Person Routing

```text
Subject: right person for {problem}?

Hi {name},

I am trying to find who owns {specific problem/process} at {company}. The reason I ask is {trigger} suggests {possible pain} may be relevant.

Is that you, or should I ask someone else?
```

This uses the sample’s routing advice without pretending to know the internal org chart. [R007] [R009] [R014] [R015]

### Call Opener

A call opener should acknowledge the interruption, ask permission briefly, and move quickly into relevance checking. [R002] [R003]

```text
Hi {name}, this is {sender}. I know I am catching you cold. Can I take 20 seconds to explain why I called, and you can tell me if it is irrelevant?
```

This reflects the permission-based and low-pressure call patterns praised by several practitioners, while preserving the caveat that timing and fit may matter more than wording. [R002] [R003] [R004]

### Outreach Operations

### List Building

Build lists from ICP fit plus observable triggers, not just titles or broad categories. [R008] [R014] [R016]

For freelancers and agencies, visibly underperforming websites, broken workflows, or missed lead-capture opportunities may create stronger outreach targets than generic business lists. [R012]

For enterprise sales, do not over-index only on seniority; a lower-level contact may route you to an unexpected champion or correct stakeholder. [R007]

Purchased or scraped lists are disputed: some warn they are low-quality and risky, while others describe tool-based prospecting as workable when data quality is managed. [R009] [R012] [R015]

### Cadence Design

Each touch should clarify relevance, timing, stakeholder ownership, or next action. [R005] [R006]

Use multiple channels when the buying motion supports it: phone for qualification, email for concise context, events for softer connection, communities for niche trust, demos for product understanding, and support channels for retention or referral loops. [R002] [R003] [R007] [R008] [R016] [R022] [R023]

Avoid treating touch count as the strategy; one source recommends many touches, but that claim was challenged and should be tested rather than adopted as doctrine. [R005]

### Deliverability Checklist

Use authenticated sending infrastructure, including SPF, DKIM, and DMARC where applicable. [R010] [R014]

Prefer concise plain text for first-touch emails, and be cautious with images, heavy formatting, attachments, and unsolicited links. [R005] [R014] [R015]

Maintain list quality and avoid invalid contacts because bad data can harm both trust and sending stability. [R012] [R015]

Do not use deliverability tactics to evade recipient preferences or spam controls. [R010]

### CRM And Automation

CRM is useful when it supports coordination, forecasting, commitments, and learning what works. [R001] [R006]

CRM becomes counterproductive when reps optimize for logs, automated sends, or activity optics instead of buyer progress. [R006]

Automation should preserve relevance, opt-outs, list quality, frequency control, and human judgment. [R010] [R012]

### Disagreements And Context Differences

### Script Quality Versus Targeting

Some advice emphasizes wording, subject lines, and CTAs, while other practitioners argue that timing and need dominate script quality. [R003] [R004] [R005]

A practical reconciliation is to treat copy as a multiplier after targeting: good copy helps the right prospects understand relevance, but it rarely rescues a weak ICP or low-urgency problem. [R003] [R004] [R014] [R016]

### Cold Email Versus Community

Some posters defend cold email as scalable, while others say unsolicited email feels scammy, intrusive, or spam-like. [R009] [R010] [R014] [R016]

The likely context difference is market trust: enterprise and B2B workflows may tolerate direct outreach when the business reason is clear, while creator and small-business communities may require relationship, visible contribution, or community-native discovery. [R007] [R008] [R016] [R022]

### Calendar Links And Meeting CTAs

Several sources warn against asking for meetings too early or dropping booking links before interest. [R005] [R014]

Other commenters report success with concrete calendar CTAs or later-sequence booking links, so timing and sequence position should be tested. [R005] [R009] [R015]

### Personalization

The sample favors personalization that is concrete and relevant, but warns that over-personalization can feel invasive or fake. [R005] [R008] [R014]

The useful distinction is business-context personalization versus personal-detail personalization: the first supports relevance, while the second can damage trust. [R008] [R014]

### Volume

Some high-volume anecdotes report meetings or revenue from large sends, while others reject the same operating style as spam. [R010] [R012]

The practical lesson is not that volume is good or bad by itself; volume without fit, consent awareness, deliverability hygiene, and downstream quality is the criticized pattern. [R006] [R010] [R012]

### One-Person Anecdotes To Treat Carefully

One freelancer reported better replies after moving from generic web-design copy to a lost-leads problem frame, shorter emails, better targeting, and a lighter CTA. [R012]

One enterprise anecdote suggests a cold call can lead to referral paths and unexpected internal champions. [R007]

One founder reported that broad influencer DMs underperformed while niche subreddit work, support interactions, Google Ads adjustments, and community building performed better. [R022]

One sender describes campaign-specific landing pages, same-thread versus fresh-thread tests, fast handling of positive replies, and infrastructure segmentation as useful operational tactics. [R014]

One relationship-sales account emphasizes gatekeepers, in-person visits, physical mail, handwritten commitments, and reliable follow-through, but this may fit territory sales better than remote SaaS. [R001]

### Promotional Claims To Discount

Claims about large email analyses, fixed word limits, eight-touch rules, CTA superiority, and specific subject formulas were challenged or self-reported, so they should be treated as inputs for tests. [R005]

Claims about a single refined email producing large lead counts should be treated as unverified promotional material. [R009]

Claims involving revenue, meetings, send volume, costs, installs, MRR, launch sales, SEO rankings, screenshots, or performance graphs should not be used as proof unless independently verified. [R010] [R012] [R022] [R023]

### Responsible AI Use

Use AI for research summaries, account notes, concise variants, prompt structuring, angle generation, and stress-testing positioning. [R005] [R006] [R013] [R018] [R019] [R020] [R021]

Keep humans responsible for relevance, truth, tone, ethical judgment, and final wording. [R005] [R006] [R013] [R018] [R019]

Ground AI-assisted personalization in real, verifiable business context, not invented events, fake referrals, false urgency, exaggerated proof, or simulated intimacy. [R002] [R003] [R005] [R008] [R014] [R015]

Do not use AI to scale irrelevant spam, mass-generate low-value content, auto-publish without review, or create outreach that markets deception as a growth tactic. [R005] [R006] [R010] [R016] [R023]

### What To Test

Test whether your ICP has a current, painful problem before testing fine copy variations. [R003] [R004] [R014] [R016]

Test trigger types separately, such as hiring, leadership change, competitor engagement, public post, event attendance, visible workflow issue, or detected problem. [R003] [R008] [R009] [R014] [R016]

Test problem-led copy against service-led copy, using the same ICP and similar trigger quality. [R008] [R012] [R016]

Test short plain-text first touches against more detailed messages, but do not assume Reddit word-count claims are proven. [R005] [R012] [R015]

Test soft CTAs, right-person CTAs, resource-permission CTAs, and meeting CTAs by sequence stage. [R005] [R009] [R012] [R014] [R015]

Test phone, email, community, event, demo, support, and paid-intent channels according to buyer motion rather than copying another market’s cadence. [R001] [R006] [R007] [R008] [R016] [R022]

Test same-thread and fresh-thread follow-ups separately, and measure replies, qualified conversations, meetings, clients, revenue, negative replies, and downstream quality. [R010] [R012] [R014]

Test deliverability changes responsibly, including authentication, plain text, link usage, list quality, and send pacing, without using evasion tactics. [R010] [R014] [R015]

Test AI-assisted drafting against human-written variants for relevance, trust, specificity, and downstream conversion, not just speed. [R008] [R010] [R013] [R018] [R019]

### What Not To Automate

Do not automate fake personalization, fabricated proof, invented referrals, false urgency, misleading subject lines, fake replies or forwards, or manipulative personal hooks. [R005] [R008] [R014] [R015] [R023]

Do not automate blasting broad lists where fit, consent awareness, list quality, and business relevance are weak. [R006] [R010] [R012] [R015]

Do not automate domain hopping, provider churn, or tactics meant to bypass spam controls or recipient preferences. [R010]

Do not automate aggressive follow-up pressure after non-response, vague interest, or opt-out signals. [R010] [R012]

Do not automate claims about customer results, revenue, rankings, screenshots, or benchmarks unless the proof is verified and context-matched. [R009] [R022] [R023]

Do not automate final judgment on ICP quality, offer urgency, ethical boundaries, sensitive personalization, or whether a human relationship needs careful handling. [R013] [R016] [R018] [R019]

Source registry: `docs/cold-email-writing/reddit-wisdom.md`.
<!-- REDDIT-WISDOM:END -->

<!-- SALES-RESEARCH:START -->
## Cross-source research synthesis

Compatible rules from this synthesis are active in `playbooks/_shared.md` and
are passed to every writer and reviewer. Bullets explicitly marked `Conflict`
remain research notes only; the fixed house standards named in the shared
playbook win.

## Research-backed operating rules and conflict notes

- Add an account-hypothesis record before drafting: observed fit, source, one plausible operational implication, uncertainty, contact’s likely role, and the next fact to validate. Prefer primary company materials and buyer conversations; treat hiring, intent, enrichment, reviews, and news as leads rather than proof of pain, budget, or authority. [S001] [S004] [S005] [S006] [S019] [S028]

- Add buying-group logic alongside individual role fit. Choose first contacts from roles that historically open viable opportunities, then map champions, evaluators, budget owners, procurement, and implementation stakeholders. A routing reply is useful qualification, not a failure. [S010] [S027] [S029] [S031] [S034] [S035]

- Add a response-state rule: when a prospect says “not now,” cites budget, an incumbent, or implementation limits, capture the reason, owner, trigger, and permission for future contact. Do not treat this as either permanent disqualification or permission to continue pressing. [S001] [S004] [S027] [S030]

- Require each account-specific message to connect one verified signal to one *plausible* role-relevant implication, then invite correction. Do not pile up signals or imply that a public event establishes a problem. [S004] [S010] [S028] [S040] [S046]

- Add an explicit early-market/research mode: when ICP, problem, or positioning is not yet validated, a carefully bounded relevance or correction question may be more honest than a product-led meeting ask. Scale automated sequencing only after manually researched outreach produces repeatable downstream relevance. [S007] [S019] [S020] [S026]

- Add a post-reply qualification guardrail: advance toward a demo or proposal only after confirming material problem/urgency, feasible adoption, economic path, buying process, and stakeholder behavior such as introductions or concrete next steps. Do not let an interested reply substitute for evidence of fit. [S019] [S020] [S024] [S031]

- Add an experiment rule for CTA choice: compare low-commitment relevance, artifact-permission, and routing CTAs with direct scheduling only within comparable segments and trigger strength. Judge results by qualified conversations and later outcomes, not replies alone. [S001] [S002] [S003] [S004] [S020] [S046]

- **Conflict: the fixed seven-touch, day-by-day cadence is stronger than the evidence supports.** Sources disagree on spacing and attempt count and recommend finite, value-bearing sequences followed by permission-based or signal-triggered nurture. Retain the sequence as an operating default only; test cadence by persona, urgency, and channel tolerance, with suppression and negative-response guardrails. [S001] [S004] [S007] [S008] [S012]

- **Conflict: making LinkedIn touches automatic for every campaign is broader than the evidence.** Coordinate email, calls, and LinkedIn chiefly for strategic accounts and only where appropriate; keep a consistent point of view across channels rather than multiplying pressure. Do not use unsolicited SMS. [S001] [S004] [S007] [S012] [S020]

- **Conflict: the doctrine’s mandatory 20-minute call and fixed 90–145-word first touch are not research-backed universal standards.** Sources support short, plain, phone-readable messages and either lower-commitment or direct scheduling CTAs depending on context, but do not establish a universal word count or meeting duration. Treat both as house-style experiments, not quality gates that force extra copy or friction. [S001] [S003] [S004] [S007] [S020] [S037] [S041] [S046]

- **Conflict: the universal ban on links in all cold-email touches is stricter than the research.** The evidence supports link-free, plain-text first messages, while allowing a genuinely useful later asset as a monitored experiment. Keep the stricter ban unless the editor explicitly authorizes a later-touch test; never use unexplained attachments, tracking language, or a link as a substitute for explaining the ask in the email. [S003] [S007] [S021] [S041] [S046]

- Add sender-level deliverability gates outside the copy review: authenticated sending, valid DNS, TLS, compliant message formatting, gradual and consistent ramping, monitoring of bounces/deferrals/complaints/reputation, and backoff when conditions worsen. Do not infer inbox placement from opens. [S021]

- Add bulk-Gmail controls where applicable: at roughly 5,000 daily messages to personal Gmail accounts, require aligned SPF/DKIM/DMARC and RFC 8058 one-click unsubscribe. Honor promotional unsubscribes within 48 hours; body-copy opt-out text alone is not sufficient. [S021] [S022]

- Add a hard recipient-expectation and suppression rule: do not use bought lists, deceptive identities or subjects, faux reply/forward formatting, hidden content, or techniques intended to bypass spam controls or recipient rejection. Suppress unsubscribes and explicit “do not contact” requests across the sequence. [S021] [S042] [S046]

- Add measurement discipline: diagnose the weakest funnel stage by segment/channel before changing targeting, offer, copy, and cadence together. Track complaints, negative replies, qualified conversations, meetings held, stakeholder expansion, proposals, wins, retention, and list quality; treat opens and raw send volume as diagnostic at most. [S002] [S007] [S020] [S021] [S032] [S046]

- Require human approval for final factual claims, proof authorization, privacy/consent handling, opt-outs, sender identity, pricing, guarantees, legal/compliance representations, and delivery commitments. AI may formulate hypotheses and constrained variants, but cannot convert inference into account fact. [S002] [S012] [S019] [S020] [S030] [S040] [S042]

Source registry: `docs/sales-research/research-wisdom.md`.
<!-- SALES-RESEARCH:END -->

<!-- TOUCH2-WISDOM:START -->
## Second touchpoint (first follow-up) — cross-source research

How to do the second touchpoint, distilled from follow-up-focused YouTube transcripts, web/course/book sources, and Reddit. This corroborates, challenges, or extends the founder-approved "Endorsed follow-up pattern (T2-T4)" in `playbooks/_shared.md`; the founder pattern and campaign rules still win on conflict.

- Choose the T2 job by the strength of the new material, not by the desire to send another message. Use an artifact only when it is genuinely specific, useful without a meeting, and relevant to the recipient’s remit. Use a new observation only when it is verified and creates a distinct reason to ask or offer something. Use the lower-bar question when the important unknown is narrow enough for an ordinary one-line reply. Brief, directly relevant proof can support the original outcome, but must not imply the same result here. [T001] [T002] [T006] [T009] [T014] [T016]

- An artifact is not a brochure recast as value. Name the concrete thing, what it shows or lets the recipient assess, and why that matters in their work. Keep it available under the project’s no-link rule; do not make the recipient navigate elsewhere to discover its value. [T009] [T014]

- A new observation must remain a fact, not a diagnosis. State the observable trigger or constraint, then make only the bounded, role-relevant implication that it supports. Do not use surface personalization as the new reason to write. [T009] [T016]

- For the lower-bar route, ask one answerable question that reduces uncertainty about ownership, workflow, or relevance. It should be easier to answer than T1’s call request, not a disguised request to evaluate the whole offer. A routing answer is useful when ownership is genuinely unclear. [T001] [T002] [T009] [T014]

- Keep the day-4 T2 timing as the active default. The cited recommendations range from roughly one to three days and do not establish a universal best interval, so do not compress the gap merely because a source proposes a faster cadence. Any approved cadence experiment should compare segments with similar seniority and inbox pressure while holding the audience and T2 job constant. [T001] [T002] [T006] [T007] [T010] [T016] [T018]

- Reply in the original thread and retain its subject at T2. Use one short context-restoring phrase about the T1 topic, then move immediately to the new material. Do not imply that the recipient should have seen, reread, or acted on the first email, and do not frame silence as a debt. [T001] [T002] [T009] [T014]

- T2 testing should compare artifact-led, observation-led, and lower-bar-question variants within the same ICP, same-thread format, and timing window. Change one variable at a time and assess inboxing, reply quality, and downstream outcomes separately. Treat claims about reply, booking, or conversion lifts as unproven tests rather than benchmarks. [T002] [T006] [T009] [T014] [T016] [T018]

Source registry: `docs/second-touchpoint/touch2-wisdom.md`.
<!-- TOUCH2-WISDOM:END -->

<!-- SALES-CLIPS-WISDOM:START -->
## Founder & creator sales-clip synthesis

Distilled from three practitioner video clips about selling and going to market:
Cameron Zoub of Whop [C1], Shelby Sapp [C2], and Chris Donnelly of Searchable
[C3]. Full transcripts and the cited synthesis live in
`docs/founder-sales-clips/`. These are self-reported founder and creator
anecdotes, several from consumer, creator-tool, or high-volume motions unlike
Andrew's evidence-led, human-approved, low-volume B2B outreach. They are
practitioner signal to test, not proof. Every reply-rate, conversion, and
revenue figure in them is promotional and unverified; it must never appear in
outbound copy or be used as a forecast. The handbook's evidence, role-fit,
clarity, single-CTA, no-link, deliverability, and suppression gates win on every
conflict.

Five refinements sharpen the emails and are promoted into the writer brain
(`playbooks/_shared.md`, `SALES-CLIPS-WISDOM`):

- **Diagnose, do not demo [C3].** Open with a specific, useful observation and
  offer to talk it through, rather than asking for a demo or call first. The
  observation stays source-grounded or a labelled hypothesis to correct, and it
  is delivered in the body because the no-link rule still forbids attaching or
  linking a document in a cold touch. This reinforces the diagnostic-offer
  pattern, GnK's build hypothesis, and OutageHub's real record.
- **Value in the recipient's terms, concretely [C1].** Lead with the specific
  thing that annoys this role, in their words, and use one honest everyday
  analogy when it makes an operational cost land faster than jargon.
- **Say it the way you would out loud [C1].** Draft as a 20-second spoken pitch
  or voice memo, then write from it. Kill anything that reads like an email and
  not like a person, starting with "reaching out on behalf of."
- **Reduce decision load; one clear next step [C2].** A stalled reader defaults
  to "I'll think about it," a soft no. The fix is more clarity and one obvious,
  easy next step, not more options. This is clarity, not pressure: the calm
  easy-out and honest routing question stay.
- **Stand out with real, one-to-one effort, never a template [C1].** Specific
  genuine relevance earns replies; automation does not. This is not a licence for
  stunts, invasive contact, false urgency, or fabricated context, all still
  banned.

Targeting and GTM notes (kept for §2 research, not the writer): join a
conversation already happening rather than manufacturing demand [C3]; treat
existing traditional-method spend as budget validation and "no competitors" as a
red flag [C3]; define who and where precisely and go where they already are [C1];
land smaller accessible accounts before the anchor account [C1]; use a
free/low-friction wedge then expand [C1][C3]. Rejected outright: Zoub's
attention stunts (Uber to a prospect's home, gifts, texting personal iCloud,
fake-urgency selfie videos) and both clips' high-volume/automation framing.

Source registry: `docs/founder-sales-clips/clips-wisdom.md`.
<!-- SALES-CLIPS-WISDOM:END -->

<!-- OUTBOUND-DOCTRINE:START -->
## Outbound doctrine — four focused handbooks

Ten practitioner talks (Becc Holland ×3, Eric Migicovsky/YC, Will Allred/Lavender,
30MPC's 85-million-email and discovery masterclasses, Jen Allen-Knuth, Winning by
Design's SPICED, April Dunford) were retrieved, distilled by ten parallel readers
into a five-part extraction each (rules, failure patterns, bad/good pairs,
conditions, checklist), and synthesized into four focused handbooks in
`docs/outbound-doctrine/`. They exist to fix seven recurring generator failures —
asserting a hypothesized workflow, inferring ownership from a title, pitching
solution/pilot/ROI before the problem is confirmed, repeating a hypothesis across
follow-ups, inventing operational language, blasting an account with no routing,
and making the recipient do too much work to answer.

The four handbooks: **A — research and proof boundaries**, **B —
problem-hypothesis and ownership testing**, **C — cold-email construction**,
**D — sequence progression and account routing**. The consolidated rules and a
pre-send checklist are promoted into the writer's brain (`playbooks/_shared.md`,
the `OUTBOUND-DOCTRINE` block), and the two governing hard rules are first-class
gates there:

1. **Evidence boundary (Gate 1).** Public evidence may establish the company's
   environment, but it cannot establish the private workflow, its owner, its
   difficulty or its financial consequence.
2. **Follow-up value gate.** Reject any follow-up that does not add new evidence,
   a more concrete example, a useful artifact or a materially different ask.

These are practitioner training talks, not controlled research; every rule is a
disciplined default to test, and no reported reply/conversion statistic is quoted
as a forecast. Evidence and campaign rules win on any conflict.

Source registry and transcripts: `docs/outbound-doctrine/`.
<!-- OUTBOUND-DOCTRINE:END -->
