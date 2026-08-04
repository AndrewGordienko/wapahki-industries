# OutageHub operational incident context

**Sender:** Andrew Gordienko  
**Signature company:** OutageHub

## Core position

Sell one operational decision inside the customer’s existing incident process,
not an outage map or a catalogue of API fields.

Use this product sentence once in touch 1:

> I run OutageHub. We turn public outage data from supported Canadian utilities
> into a normalized, location-matched feed for multi-site operators.

The value is that an existing incident can receive external grid information
without an operator checking separate utility sites or manually correlating
alarms and location reports. OutageHub adds utility-reported power context to an
existing incident. It does not replace site telemetry or prove that service, a
store, equipment, or a customer was affected.

Never claim complete or real-time Canadian coverage, instant detection, a
guaranteed lead-time advantage, production alerts, or customer outcomes. Say
`public outage data from supported Canadian utilities`. Never invent coverage,
latency, refresh frequency, an ETR, a location match, a source response, or a
historical replay result.

## What the cold sequence sells

The unanswered sequence sells a 20-minute discovery call. It does not sell or
price a pilot. Do not mention CAD $40k–$75k, a paid API pilot, a first-year
deployment, ROI, or an annual contract in cold copy.

After discovery, the commercial path can be a bounded historical validation or
limited production deployment measured by supported-utility coverage, delivery
latency, useful site matches, reduction in manual utility checks, and the
customer’s chosen decision outcome. A CAD $40k–$75k engagement is credible only
as a first-year deployment that includes substantial historical validation,
the agreed incident-system integration, production coverage, webhooks, support,
an SLA, and a 12-month licence. It is not the price of one event and a few
locations.

## Four-touch sequence

Use four email touches. Each touch must add new value and stay on the same
operational trigger and decision.

1. **Day 1 — current decision.** Explain why this person’s role gives them a
   useful view. Name one concrete trigger, ask how the decision is handled now,
   state the product in one sentence, and ask for a 20-minute call. Position
   OutageHub against the current alternative: checking utility reports
   separately, waiting for individual locations, or manually correlating
   alarms. For a direct owner, ask whether the external utility record changes
   the action. For an adjacent person, ask only for the likely owner. Do not lead
   with API fields, timestamps, outage polygons, coverage, or outage-area size.
2. **Day 6 — send the replay.** Open a new thread and put the historical replay
   or supported sample incident record in the email. Never ask whether the
   recipient wants Andrew to send it. Show the operational chain in plain
   language: trigger, returned utility context, and the decision it supports.
   If verified evidence supplies an actual event and location result, identify
   it accurately. Otherwise label the record a sample and do not invent event
   values. Ask whether it would have changed one action.
3. **Day 13 — measurable consequence.** Connect that same decision to one
   measurable consequence the role can recognize, such as manual utility checks,
   incident-classification time, calls and handoffs, an escalation, or a dispatch.
   Do not invent a cost, incident count, time saving, or outcome. Ask one easy
   calibration question, not another technical questionnaire or meeting ask.
4. **Day 21 — owner or close.** Close the loop. Name the trigger and decision,
   then ask whether this person or a specific likely team owns outage
   intelligence or incident-system integrations. Do not repeat the product,
   replay, meeting ask, proof disclaimer, or a technical diagnostic question.

Every email uses a short 2-to-5-word subject. Touch 2 opens a distinct replay
thread. Touch 3 may continue the replay thread by repeating touch 2’s subject.
Touch 4 uses a distinct ownership subject.

## Role and account routing

Start with why the individual has unique insight, based on what the role can
credibly see. A title is a route hypothesis, not proof of ownership.

- **Telecom/network operations:** site alarm occurs; the existing system queries
  OutageHub; the ticket receives utility status, ETR when the source provides
  one, source, observation time, and confidence; the operator decides whether
  to investigate, escalate, or wait. Existing telemetry remains authoritative.
  Beanfield is a strong API prospect because the likely destination is an
  existing monitoring or incident system.
- **Multi-site retail, grocery, senior living, property, health, and laboratory
  operations:** a store or facility becomes unreachable; central operations
  sees whether a supported utility reports an outage near that location; calls,
  checks, continuity steps, and dispatches can be prioritized. First learn
  whether the customer needs external utility context at all. The first useful
  product may be a central operations view rather than an API.
- **Field service, generators, facilities, and fuel:** an alarm or service call
  enters the existing queue; the public utility match helps the dispatcher
  decide whether to group, verify, or prioritize it. Do not claim prediction,
  pre-staging, earlier detection, or avoided dispatch.
- **Insurers:** use a portfolio or catastrophe-response decision, never
  individual claim priority. Do not imply that a utility report proves loss.
- **Technical/product/data leaders:** focus on the system destination, three-state
  semantics, source provenance, and how an incident is enriched. Do not turn the
  email into a field-validation exercise.
- **Adjacent or weak routes:** explain the perspective the role plausibly sees,
  then ask for the owner of central operations, incident response, service
  assurance, facilities, business continuity, or incident-system integrations.
  Do not pretend finance, people, sales, marketing, legal, or unrelated leaders
  operate the incident process.

## Product evidence and differentiation

Do not claim a competitor advantage without evidence. The useful discovery
question is why a buyer would choose OutageHub over direct utility data,
PowerOutage.com, Gisual, or its current monitoring stack.

Only use a wedge when the product can demonstrate it. Candidate proof points are
supported-utility coverage and freshness, source provenance and confidence,
historical replay, Canadian hosting or procurement, simpler Canadian mid-market
pricing, easier location matching, explicit `coverage_unknown` handling, and
custom integration for smaller Canadian operators.

Operational buyers should eventually be able to evaluate:

- supported utilities and regions
- source-specific refresh frequency and observation time
- API uptime and ingestion health
- historical retention
- a documented sample response
- the location-matching method
- source URL and provenance
- `outage_reported`, `no_outage_reported`, and `coverage_unknown`
- webhooks for outage changes and restoration estimates

These are product-evidence requirements, not claims to insert into cold emails.

## Language and proof rules

Be precise without weakening every sentence. Prefer:

> OutageHub adds utility-reported power context to an existing incident. It does
> not replace site telemetry.

Avoid repeated `could`, `may`, and `cannot show` hedges. State the supported
mechanism directly, then state the single proof boundary once.

Never write or imply:

- `real-time Canadian coverage`
- an invented “13 hours” or sequential-store-check calculation
- `detection before tickets arrive`
- `N+1 diesels`, `colocation risk`, or another unsupported infrastructure claim
- that a public outage report proves site or service impact
- that silence validated the problem
- `Would you like me to send the example?`
- repeated questions about fields, timestamps, outage-area size, or refresh rate
- a pilot, price, or annual contract in an unanswered sequence

Never shift a sequence among live triage, customer communications, and
post-incident review. Choose one trigger, one incident-system destination, and
one decision.

## Approved opening patterns

For a direct telecom owner:

> When a site-down alarm arrives, does the incident already show whether the
> local utility is reporting an outage and its estimated restoration time, or
> does someone check that separately?

For central multi-site operations:

> When a location becomes unreachable during a storm, can central operations
> see whether the utility is reporting an outage nearby, or does that information
> arrive location by location?

For an adjacent role:

> Your role sees [specific side of the incident], so you would know which team
> owns [trigger-to-decision step].

Use the pattern, not the exact wording, and ground it in verified company and
role context.
