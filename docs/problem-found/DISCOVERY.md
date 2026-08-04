# Problem Radar — research scouts + dashboard

The **Problem Radar** is the top of the Problem Found funnel. It hunts for
expensive, recurring, measurable Canadian operational problems that software can
fix, and where we can get paid **a cut of the savings**. Qualified problems flow
down into the CRM (accounts → outreach) and, next, into the autonomous MVP
factory that builds a demo for the website.

```
4 research scouts  →  Problem Radar dashboard  →  autonomous MVP build  →  website demo  →  next-day outreach
(discover-problems.js)       (/problems)              (mvp-queue.json)        (GnK)              (CRM sequences)
```

## Run the dashboard

```bash
npm start                 # serves the CRM at http://localhost:8787
```

Open **http://localhost:8787/problems** (or click **◍ Problem Radar** from the CRM).

## Find problems

- **From the dashboard:** click **⌕ Discover problems**, pick how many, and watch
  the research scouts stream progress. New problems appear when they finish.
- **From the CLI:**

  ```bash
  npm run problems:discover -- --count 6      # discover + score 6 problems
  node scripts/discover-problems.js --dry-run # just plan the run
  ```

The agent uses the **Codex CLI with your ChatGPT login** (via `src/codex.js`) —
it does **not** call the billed OpenAI API. Make sure you are logged in:

```bash
codex login status
```

Web search is on, so numbers and company names are grounded in real sources.
The requested count is divided across four roles without multiplying the number
of candidates sent to the expensive deep-dive stage:

1. **Broad Problem Ideator** — starts from costly recurring workflows.
2. **Company Pain Admissions Scout** — starts from a named company's annual
   report, earnings material, official post, executive comment, incident report
   or other public disclosure of cost, delay, failure, risk or capacity.
3. **Workforce & Knowledge Bottleneck Scout** — looks for explicit skill gaps,
   repeated hiring, training investment and scarce-expert dependencies.
4. **Active Buying & Change Scout** — looks for RFPs, remediation programs,
   modernization budgets, vendor searches and relevant hiring clusters.

Advertised-pain candidates are rejected before deep research when they do not
contain a named company, direct HTTP(S) source and observed date. One ordinary
job posting is demand—not proof of a shortage. A vendor describing a customer
problem is marked as market validation, not as the vendor admitting its own
pain.

## What each problem captures

A scored hypothesis: some set of Canadian organisations bleeds money on a
manual/underserved workflow, we can build software that fixes it, and we get
paid a fraction of the savings.

| Field | Meaning |
| --- | --- |
| annual cost (low/high) | CAD one org loses to the problem each year, with `cost_basis` |
| savings (low/high) | CAD/yr we could realistically save them |
| our cut (low/high) | our fee — a credible cut of year-one savings (`pricing_basis`) |
| target companies | real, named Canadian orgs likely to have it |
| buyer roles | titles that own both the budget and the pain |
| data availability | what an MVP needs and whether it's public/purchasable/internal |
| demo idea | what a 2-minute MVP demo would show |
| problem origin | which of the four research roles found it |
| advertised signals | named company, paraphrased disclosure, consequence, relationship, date and direct URL |
| sources | the URLs the agent actually used |

### Scoring (out of 100)

| Factor | Max |
| --- | --- |
| Financial size / savings potential | 25 |
| Recurring and measurable | 15 |
| Underserved by existing software | 15 |
| Usable data available for an MVP | 15 |
| Identifiable buyer who owns budget and pain | 10 |
| We can build a convincing MVP fast | 10 |
| Repeatable across many Canadian organisations | 5 |

Problems scoring **≥ 65** are auto-set to `approved` — the same gate the CRM uses
before active outreach — so the autonomous MVP factory can pick them up.

## Pipeline statuses

`discovered → approved → building → demo_ready → in_outreach → won | killed`

Change a problem's status from the dashboard, or click **⚙ Build MVP** to enqueue
an autonomous build (written to `data/mvp-queue.json` and marked `building`).

## Steering the hunt

Edit **`config/problem-sources.json`** for the business model, must-haves,
sectors, angles and seed queries. Edit
**`config/company-pain-sources.json`** for the advertised-problem source order,
search patterns and evidence rules. The same company-signal policy is shared by
GnK Problem Radar and OutageHub.

## Files

```
config/problem-sources.json   what the agent hunts for (edit this to steer it)
config/company-pain-sources.json  company-admission evidence and source policy
src/problem-scouts.js         the four shared scout roles and evidence gate
scripts/discover-problems.js  the two-stage research team (scout → score)
src/problems.js               the `problems` table + CRUD (shares crm.db)
public/problems.html/.js/.css the Problem Radar dashboard
data/problems.json            human-readable mirror of the backlog
data/mvp-queue.json           autonomous MVP build queue (drained by the factory)
```

## What's next (autonomous MVP factory)

`data/mvp-queue.json` is the hand-off point. The factory (next slice) drains the
queue, spins up Claude + Codex build agents to scaffold a demo into the
GnK project studio (`mvp:prepare`), sets the problem's `mvp_path` and moves
it to `demo_ready` — so the morning after a discovery run, outreach has both a
grounded problem write-up and a live demo to show.
