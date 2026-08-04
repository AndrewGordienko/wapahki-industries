# Problem Found — CRM targeting & sales specification

> Source of truth for the CRM rebuild. The CRM code (`data/products.json`,
> `src/db.js`, `src/server.js`, `public/`) implements this document. When they
> disagree, this document wins until it is deliberately updated.

## Business model

**Problem Found** is the commercial and product layer above **GNK**.

Problem Found:

- Finds expensive operational problems.
- Researches the market and designs the product.
- Builds a visual or functional prototype.
- Finds design partners and sells the initial engagement.
- Owns discovery, scoping, proposals and client management.
- Uses GNK as the initial engineering delivery partner.
- Can replace or supplement GNK with other engineers when necessary.
- Turns successful client projects into repeatable products.

**Positioning**

> Problem Found turns messy operational data and manual workflows into decision
> systems that can be proven in 30, 60 or 90 days.

Do **not** position the company as generic AI consulting. AI is an
implementation tool, not the thing being sold.

## Initial product portfolio

| Product | Initial market | Outcome being sold |
| --- | --- | --- |
| **Opposition Workbench** | Championship & smaller Premier League football clubs | Reduce opposition-report preparation and connect every finding to supporting video |
| **Delay Evidence Engine** | Developers, contractors, infrastructure owners, claims consultants | Reconstruct when a project slipped, why, who was responsible and what evidence supports it |
| **Right-of-Way Cost Optimizer** | Toronto developers and construction teams | Calculate the cost of street occupation and identify feasible changes before the plan is locked |
| **Outage Response OS** | Generator services, facility operators, telecom, EV charging, field-service companies | Turn live outage data into prioritized operational actions |

The website can show all four. **Outbound campaigns should only actively push
one or two products at a time.**

### Priority order

1. Football opposition analysis (**Opposition Workbench**)
2. Construction delay intelligence (**Delay Evidence Engine**)
3. Toronto right-of-way optimization (**Right-of-Way Cost Optimizer**)
4. OutageHub operational response (**Outage Response OS**)

Football is attractive while Andrew is in London and can reach clubs directly.
Construction has the clearest financial ROI. OutageHub already has underlying
data but needs a narrower operational buyer.

---

## Target 1 — Football clubs (Opposition Workbench)

**Ideal account**
- Championship club or smaller Premier League club
- ~3–8 analysts
- Already pays for match video and event data
- Produces weekly opposition reports
- No substantial internal ML engineering team
- Can approve a £25,000–£60,000 pilot
- Ambitious ownership, recent hiring or investment in analytics

**Economic buyers:** Sporting Director · Director of Football · Head of
Performance · Head of Recruitment · Technical Director · Director of Data or
Technology (where present)

**Internal champions:** Head of Analysis · Lead Performance Analyst · Opposition
Analyst · Recruitment Analyst · First-Team Analyst

**Exclude**
- Arsenal, Liverpool, Manchester City and other clubs with large internal AI teams
- Clubs without paid data or dedicated analysts
- Lower-league clubs unlikely to approve a £25,000+ engagement
- Injury-prediction projects as the first offer

**Signals to capture:** analytics/data-science hiring · new sporting director or
ownership · promotion or relegation · expansion of analysis staff · new
data-provider relationship · public discussion of recruitment/performance
modernization · multi-club ownership

## Target 2 — Construction delay intelligence (Delay Evidence Engine)

**Ideal account**
- Developer or contractor managing projects above $50M
- Major infrastructure owner
- Construction claims consultancy
- Surety, lender or insurer exposed to distressed projects
- Large volumes of schedules, RFIs, change orders and meeting minutes
- Active dispute, delayed project or weak project-controls process

**Economic buyers:** VP/Director of Construction · Project Executive · Commercial
Director · Claims Director · Director of Project Controls · General Counsel (claims work)

**Internal champions:** Scheduler · Project Controls Manager · Claims Consultant ·
Contract Administrator · Project Manager · Superintendent

**Signals to capture:** publicly reported delay · completion-date revision · cost
increase or change-order volume · liquidated-damages exposure · extension-of-time
request · major public infrastructure portfolio · hiring in project controls or
claims · several projects using inconsistent document systems

## Target 3 — Right-of-way cost optimization (Right-of-Way Cost Optimizer)

**Ideal project**
- Toronto development with >$500,000 expected occupation costs
- ≥12 months of right-of-way occupation
- Lot-line construction with limited internal staging space
- Beside a major arterial, TTC route or bike lane
- Multiple construction phases
- Still in preconstruction or early planning
- Developer owns several Toronto projects

**Economic buyers:** Developer's VP/Director of Construction · Project Executive ·
Director of Preconstruction · Cost-Control Director

**Internal champions:** Construction Scheduler · Logistics Manager · Site
Superintendent · Permit Coordinator · Traffic Consultant

**Channel partners:** traffic-management consultants · permit consultants ·
construction schedulers

**Exclude**
- Projects whose staging plans are already fully locked
- Contractors who simply pass all occupation fees to the developer
- Small projects with insufficient potential savings

## Target 4 — OutageHub operational response (Outage Response OS)

**Ideal account**
- Operates many customer locations or field-service teams
- Financially affected by outages lasting several hours
- Currently relies on utility websites, customer calls and manual dispatch
- Responsible for generators, fuel, facilities, telecom equipment or EV chargers
- Can measure response time, unnecessary dispatches or downtime

**Best initial segments:** generator installation/service · emergency
fuel-delivery · property/facility-service operators · EV charging networks ·
telecom network operations · logistics & cold-storage operators

**Economic buyers:** VP Operations · Director of Service · Director of Network
Operations · Head of Reliability · Director of Facilities

**Internal champions:** Dispatch Manager · Service Operations Manager · GIS
Analyst · Reliability Engineer · Emergency Response Manager

**Exclude initially**
- Utilities with lengthy procurement and extensive internal systems
- Consumers
- Organizations with no field-response workflow
- Companies for which outages create no measurable operational decision

---

## Account-based sales approach

The CRM is **account-centric**, not a large unqualified contact list.

For every account, identify:
- One **economic buyer**
- Two **operational champions**
- One **technical / data stakeholder**
- One **potential referral path**

Every account needs a written **hypothesis**:

> We believe this organization experiences **[specific workflow/problem]** because
> of **[observable evidence]**. The initial product we would offer is
> **[product]**, and the measurable outcome would be **[result]**.

**Gate:** do not allow generated outreach until the account has at least one
credible public signal **and** a role-specific reason for contacting that person.

## Outreach style

Messages should:
- Be 90–160 words.
- Sound like one person writing to another.
- Start with the relevant observation or question.
- Discuss the workflow, not "AI transformation."
- Admit when the hypothesis may be wrong.
- Ask for a 20–30 minute conversation or offer to send a two-minute demo.
- Avoid lists, buzzwords and exaggerated claims.
- Avoid "quick call," "revolutionize," "synergy" and generic compliments.

**Progression**
1. **First contact:** ask about the suspected workflow or bottleneck.
2. **First follow-up:** add one useful observation, screenshot or relevant question.
3. **Second follow-up:** show the proposed workflow and ask whether it resembles reality.
4. **Final follow-up:** ask for the appropriate person or close the thread.
5. **Discovery:** understand the current process before presenting the pilot.
6. **Proposal:** sell a defined outcome with data requirements, acceptance criteria and timeline.

## Offer structure

| Engagement | What the customer buys | Typical value |
| --- | --- | --- |
| 30-day evidence sprint | Historical audit, prototype and quantified business case | $15,000–$30,000 |
| 60-day workflow pilot | Working system using real customer data, normally in shadow mode | $40,000–$75,000 |
| 90-day operational deployment | Integrations, permissions, workflow adoption and live use | $75,000–$150,000 |
| Annual expansion | Additional modules, maintenance and portfolio deployment | $120,000–$300,000+ |

## Qualification questions (required in CRM)

1. What is the workflow today?
2. Who performs it and how frequently?
3. How much time, money or risk does it create?
4. What tools and data are already available?
5. What has prevented the organization from fixing it?
6. Who owns the budget?
7. What would have to be demonstrated for a paid pilot?
8. Is there a live project or deadline within six months?
9. Could the product be reused elsewhere in the organization?

## Lead scoring (out of 100)

| Factor | Weight |
| --- | --- |
| Financial or operational pain | 20 |
| Ability to fund a $40,000+ pilot | 20 |
| Relevant data availability | 15 |
| Clear project timing | 15 |
| Lack of sufficient internal engineering | 15 |
| Access to buyer or champion | 10 |
| Repeatability across similar customers | 5 |

**Only accounts scoring 65 or higher enter active personalized outreach.**

## CRM stages

`Researched → Ready for contact → Contacted → Replied → Discovery scheduled →
Problem confirmed → Data and budget qualified → Design partner → Proposal sent →
Contract negotiation → Contracted → Delivery → Expansion`

## CRM functionality to change or add

- Accounts, contacts, products and opportunities as separate records
- Product-specific buyer personas and outreach guidance
- Contact map: buyer, champion, technical stakeholder and referral
- Account hypothesis and supporting signals
- Lead score with explanations
- Discovery notes tied to qualification questions
- 30/60/90-day offer builder
- Proposal and statement-of-work generator
- Manual LinkedIn and email task queue
- Copy-to-clipboard messaging without requiring email integration
- Follow-up reminders
- Dashboard **by product**, not just aggregate leads
- Metrics for replies, discoveries, qualified problems, proposals and revenue
- A field identifying whether **GNK has confirmed feasibility and delivery pricing**

> **GNK should not be promised to the customer until it has provided a written
> estimate and agreed to the scope.**
