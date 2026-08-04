# GnK opportunity engine

This is the internal operating system behind the public project studio.
`GnK` is the public studio name; the research and build
infrastructure remains deliberately independent from the brand.

## Outcome

The loop is designed to make one useful thing happen:

1. Overnight research finds expensive, recurring Canadian workflows.
2. Every claim is tied to public evidence and separated from inference.
3. An underwriting pass estimates the value pool, buyer, data, timing,
   reachability, repeatability, and smallest credible software wedge.
4. Andrew approves a small number of opportunities in the local dashboard.
5. Approval creates a build packet for Claude and Codex.
6. Build agents create a narrow, synthetic-data MVP and a two-minute demo.
7. A human reviews the demo and claims before it is added to the public site.
8. The next sales session starts with a specific problem hypothesis, named
   operational owners, evidence, and something concrete to show.

The system does not auto-contact anyone, auto-publish a prototype, or represent
research hypotheses as customer results.

## Operating thesis

We are not looking for companies that “need AI.” We are looking for workflows
where:

- the current process is expensive, recurring, and measurable;
- the cost appears in labour, delay, downtime, working capital, penalties,
  avoidable service events, or material risk;
- the buyer controls a budget that can support a CAD $40k+ pilot;
- usable data already exists or can be assembled in a 30-day evidence sprint;
- a small senior team can prove a decision-system wedge in 30, 60, or 90 days;
- the problem repeats across multiple Canadian organizations;
- solving it makes work safer, faster, less wasteful, or less frustrating for
  the people inside or affected by the workflow.

Value-based pricing is a commercial hypothesis, not a promise. A proposal can
target a share of defensible, attributable savings, but the evidence sprint must
establish the baseline, measurement method, and counterfactual first.

## Succession and tacit-knowledge lane

One explicit research lane is business continuity where experienced owners,
operators, estimators, dispatchers, technicians, adjusters or administrators
expect to retire and essential judgment is still carried in their heads.

The opportunity is not “replace older people with AI.” It is:

- preserve hard-won institutional knowledge before a handover;
- learn the exceptions, heuristics and decision evidence from experienced staff;
- automate repetitive preparation, retrieval, reconciliation and follow-up;
- give the next operator an inspectable playbook and an agent that proposes work
  for human approval;
- reduce succession risk while making the remaining job easier to teach and run.

Research must use aggregate workforce-demographic data, trade-association or
government succession studies, job-vacancy pressure, public business-transition
signals and voluntary public statements. Do not infer an individual’s age,
retirement plans, health, or personal circumstances from a name, photograph,
graduation date or social profile. Outreach should lead with workflow continuity
and knowledge transfer, never someone’s presumed age.

Aggregate industry age bands—including evidence about workers or owners in the
50–70 range—are valid research inputs when the source and sample are clear. They
are market signals, not a contact-selection rule.

Strong fits tend to have high-value exception handling, repeatable decisions,
limited process documentation, fragmented records, a reachable owner or
operations leader and a 12–60 month transition window. Examples may include
specialty construction, equipment and building service, insurance adjusting,
freight and dispatch, environmental compliance, industrial distribution,
maintenance, permitting and other owner-operated or expertise-heavy services.

The first offer is:

- **30 days:** decision inventory, workflow shadowing, exception library and
  quantified continuity risk;
- **60 days:** a shadow agent that prepares work and cites the source or rule an
  experienced operator would inspect;
- **90 days:** approved automations, permissions, audit history, training and
  a measured handover workflow.

## Agent chain

### 1. Problem Radar

Searches current Canadian public evidence:

- Auditor General reports and public-agency performance audits
- federal, provincial, and municipal open data
- procurement notices, capital plans, board minutes, and budget documents
- regulator decisions, compliance orders, and service standards
- company job postings, status pages, launches, incidents, and expansion
- trade publications, conference talks, professional forums, and credible news

It returns recurring workflows and named account signals, not generic sectors
or unsupported product ideas.

### 2. Opportunity Underwriter

Tests each candidate against the commercial scorecard:

| Factor | Weight |
| --- | ---: |
| Financial or operational pain | 20 |
| Ability to fund a CAD $40k+ pilot | 20 |
| Relevant data availability | 15 |
| Clear project timing | 15 |
| Lack of sufficient internal engineering | 15 |
| Access to a buyer or champion | 10 |
| Repeatability across similar customers | 5 |

Only opportunities at 65 or above may be shortlisted. A high technical fit
cannot compensate for an unreachable buyer or a procurement cycle that makes a
90-day pilot implausible.

### 3. Evidence Auditor

Challenges the short list:

- Does every account-specific claim have a URL and observed date?
- Is the pain observed, or merely inferred from a category?
- Does the proposed software wedge follow from the evidence?
- Is the value calculation inspectable and conservative?
- Is a real operational owner named or at least directly findable?
- Are legal, safety, privacy, procurement, or professional-review boundaries
  explicit?

Failed candidates return to research. The auditor cannot improve a score by
inventing missing facts.

### 4. MVP Architect

Turns an approved opportunity into a bounded build packet:

- target user and decision moment;
- current workflow and evidence;
- one “golden path” for the two-minute demo;
- synthetic demonstration data;
- required screens and interactions;
- acceptance criteria;
- explicit non-goals and claim boundaries;
- delivery roles for Claude and Codex;
- public-project-page copy labelled as a pilot hypothesis.

## Human gates

There are three deliberate pauses:

1. **Research → shortlist:** score of 65+, sufficient evidence, credible buyer.
2. **Shortlist → build:** Andrew approves the problem and the MVP wedge.
3. **Demo → publish:** human review confirms quality, truthfulness, privacy,
   accessibility, and commercial usefulness.

Outreach requires one credible public account signal and a role-specific reason
for contacting the person. GnK is not promised as delivery partner until it has
provided a written estimate and agreed to the scope.

## Local commands

```bash
# Uses the existing Codex login and live web search by default.
npm run research:scout -- --count 6

# Optional: register and use the OpenClaw workspaces.
npm run agents:setup
RESEARCH_RUNNER=openclaw npm run research:scout -- --count 6

# Create the Claude/Codex handoff only after human approval.
npm run mvp:prepare -- --id opportunity-id --approve
```

The dashboard lives at `http://localhost:3000/lab`. The research runner is
local-only unless `ENABLE_LOCAL_AGENT_RUNNER=1` is deliberately set.

## Shipping contract

A generated MVP is not automatically a new business. To enter active outbound
it must have:

- a defensible problem and measurable target outcome;
- at least one plausible design-partner account;
- a named economic-buyer role and operational-champion role;
- an evidence-linked demo;
- a 30/60/90-day commercial path;
- a two-minute walkthrough;
- explicit risks and limitations;
- a written feasibility and pricing review from the delivery team.

Only one or two opportunities should run active outbound at a time, even when
the public site shows a broader project portfolio.
