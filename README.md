# Wahpaki CRM

A zero-install CRM for **Wapahki**, **GnK**, and **OutageHub** — three books of
business in one contact grid. It manages account research, contacts, public
evidence, the agent-written outreach messages, and outreach history. Full
targeting/sales spec: [`docs/problem-found/SPEC.md`](docs/problem-found/SPEC.md).

Primary views share one `crm.db`:

- **`/` — CRM** — one interface with two spreadsheet views. **Contacts** lays
  out account → people → T1–T7 and opens the real message workspace for copy,
  editing, deal-aware rewriting, and manual send logging. **Deals** puts the
  account's commercial motion, problem, primary route, commitment, next move,
  and live CRM message/reply counts in editable columns. Deal strategy is
  context for the contact messages, not a second outreach system.
  **Export sheet** downloads the visible contact set as an Excel/Google
  Sheets-compatible CSV with T1–T7 laid out across one row per person.
  The **Calendar** tab collates all three businesses into a seven-day email
  schedule, preserving each message's role/recipient-specific suggested send
  while enforcing a maximum of 30 emails per business per London sender day.
  Served by [`src/crm.js`](src/crm.js) + [`public/crm-grid.js`](public/crm-grid.js).
- **`/dealroom`** — compatibility URL that redirects to `/?view=deals`; there is
  no longer a separate Dealroom UI or message queue.
- **`/accounts.html` — Accounts** — account-based selling across the product portfolio
  (Opposition Workbench · Delay Evidence Engine · Right-of-Way Cost Optimizer ·
  Outage Response OS). Per account: a written hypothesis, a role-based contact
  map (economic buyer / champions / technical / referral), captured public
  signals, a weighted lead score out of 100 (only 65+ *and* a signal unlocks
  outreach), 13 pipeline stages, discovery answers to the qualification
  questions, a 30/60/90 offer builder + SOW generator, a GnK-feasibility field,
  and a manual LinkedIn/email task queue with copy-to-clipboard. Dashboard is
  **by product**. Config lives in [`data/products.json`](data/products.json).
- **`/problems` — Problem Radar** — the top of the funnel: a scored backlog of
  expensive Canadian problems worth productizing. Four research roles split
  each run between broad ideation, named-company pain admissions, workforce and
  knowledge bottlenecks, and active buying/change signals.
- **`/gnk` — GnK idea workspace** — source-backed problems, affected operators,
  evidence, build hypotheses and human scoping decisions. Its **Find ideas**
  control runs the Problem Radar scouts and mirrors new research into this board.
- **`/outagehub` — OutageHub workspace** — an OutageHub-specific
  problem → company → buyer pipeline. It ranks Canadian workflows where outage
  data plus an SMS/email action layer matters, keeps source links and buyer
  evidence together, runs the same company-signal scouts inside OutageHub's
  honest product boundary, and stores a first-touch draft for every researched
  target. It uses the same idea-workspace interface and research controls as
  GNK.
- **`/wahpaki/grants` and `/outagehub/grants` — venture-specific Grant Radars** —
  current Canadian funding research separated by applicant. Each page has its
  own opportunities, totals, funding sweep and CSV export, verifies programs
  against the relevant applicant profile, and keeps a sticky route back to that
  venture's workspace.

```bash
npm start          # → http://localhost:8787 (CRM Contacts + Deals sheets)
                  #   /accounts.html · /gnk · /problems · /outagehub
node scripts/pf-migrate.js   # maps outagehub→outage, retires the gnk funnel (idempotent)
npm run outagehub:seed       # refresh the reviewed OutageHub research seed
npm run outagehub:discover   # research more use cases, buyers and first touches
npm run grants:discover      # sweep current programs for both ventures
npm run grants:crm:outagehub # seed 8 programs × 5 ordered routes × 7 touches
npm run grants:crm:outagehub:people # attach named humans + emails to those routes
npm run grants:crm:outagehub:enrich # Apollo email-unlock for the named humans (needs credits)
npm run grants:audit         # validate sources, scores, contacts and drafts
npm run gnk:scout -- --count 6  # GnK ideas + company-advertised pain
npm run gnk:hypothesis-led:apply # apply the reviewed Nancy/Nicole corrections
npm run gnk:hypothesis-led:migrate-first50 # split the first 50 account theses and map buying groups
npm run gnk:first50:baseline     # write and validate the complete first-50 draft baseline
npm run gnk:first50:first3       # resumable first 50 × three role-ranked contacts
npm run problems:discover -- --count 6  # GnK Problem Radar
npm run outreach:schedule -- --start=2026-08-03        # preview the 30/day calendar
npm run outreach:schedule -- --start=2026-08-03 --apply # apply after review
```

Product tabs, personas, scoring rubric, offer tiers, stages and qualification
questions are all data-driven from `data/products.json` — edit that file, no code
change needed.

---

## Underlying contact engine (Apollo)

The account/contact plumbing below powers both views. It stores **companies →
people → email, title, relevance score, and why they'd reply**, and taps
**Apollo** to find contacts and unlock emails. No Google Maps key needed —
company discovery uses Apollo too.

Built on Node's built-in SQLite + `fetch` + `http`, so there is **nothing to
`npm install`.**

---

## Outreach messages

Each contact's messages are written by the tuned agent writers in `scripts/`
(playbook voice in `playbooks/<business>.md` + deterministic quality validation).
The CRM grid surfaces them directly and lets you copy, edit, or mark one sent
(which logs a touchpoint). The application itself never sends email or LinkedIn
messages — "sent" means you sent it by hand and recorded it.

The calendar capacity layer uses each original recipient-local suggested send
as its primary timing anchor. When a person's timing profile explicitly offers
a Monday alternative and their primary timestamp is Tuesday, the planner may
use the preceding Monday at the same recipient-local time; it never applies
that exception to ordinary Tuesday recipients. It uses Europe/London as the
sender-capacity clock, prioritizes due follow-ups, fills unused capacity with
new touch-1 emails, and applies stable non-round minute/second jitter inside
windows that overlap North American working hours. Saturday and Sunday are not
general overflow days: a weekend slot is available only when that person's
original suggested timestamp itself falls on that weekend day; a generic “test
Sunday” profile note is not enough. Wapahki, GnK, and OutageHub each receive an
independent maximum—not a target—of 30 emails per London day. A background
reconciler folds newly written sequences into the same plan; it does not send
them.

**Write or improve with the agent, in-app:** open a contact's message workspace
and click *Write full 7* (or *Rewrite full 7*). The server runs the source-backed
`scripts/write-sequences.js` pipeline for that contact in the background. The
writer cross-references current research, the account problem, desired
commitment, next deal move, contact route, current drafts, and private sales
rehearsal; it stores the full T1–T7 sequence only after the campaign's evidence,
language, review, and deterministic checks pass.
Requires the local Codex CLI + ChatGPT login
(`codex login status`). Supported today for the wapahki / gnk / outagehub
campaigns; a run that times out or fails validation writes nothing.

```bash
npm test
codex login status                 # the writer needs this
npm run outreach:write             # batch writer (all contacts, headless)
```

GnK uses a four-touch insight-led sequence over roughly three weeks: a concrete
problem question that names the specific idea GnK is exploring, a sharper
operational hypothesis that invites one correction, a short LinkedIn connection,
then a single close-or-route. Internal research only sharpens the copy; internal
uncertainty, qualification and proof-boundary notes never reach the reader. It
does not infer validation from silence, so the cold sequence cannot include an
annualized cost case, a paid-pilot pitch, or a cold meeting ask. Economics and a
$40k–$90k historical-data pilot come only after discovery confirms the recurring
work, consequence, owner, data, champion, and pilot outcome. Off-function
routers are capped at one initial email and one follow-up rather than receiving
four touches.

Other campaigns keep their own cost and pilot rules. Any illustrative model
must show rounded inputs and arithmetic, label unpublished inputs as
hypothetical, and ask the recipient to calibrate the order of magnitude.

---

## 1. Set your Apollo API key

The app reads a real environment variable first, then falls back to a `.env`
file. For this repository, a local `.env` is the simplest option and is already
excluded by `.gitignore`:

```bash
cp .env.example .env
chmod 600 .env
# Edit .env and set APOLLO_API_KEY there. Never paste a real key into chat,
# source code, a shell-history command, or a commit.
```

Get the key at **app.apollo.io → Settings → Integrations → API**. (Apollo API
access requires a paid plan.)

For a one-off shell, `export APOLLO_API_KEY="..."` still works. A real
environment variable always wins over `.env`.

## 2. Load the starter data (51 GTA companies)

```bash
npm run seed
```

This loads your 10 vetted companies (with 5 named people each) plus ~40
researched GTA co-packers, food/cosmetics manufacturers, and 3PL warehouses.

## 3. Run it

```bash
npm start
```

Open **http://localhost:8787** for the CRM. (Port 8787 is used instead of
5173 so it will not clash with the website development server.)

---

## Using the Deals sheet

- Switch to **Deals** in the CRM header; `/dealroom` opens the same view.
- For GnK, expand **Thesis and qualification** to edit the seven separate
  account-thesis fields, the seven-item pursuit screen, and the six discovery
  qualification checks. The deal stays human-only and needs review when those
  gates change.
- Edit the commercial motion, primary contact route, exact commitment to win,
  and next move directly in the row.
- Use **Work messages** to open that account's contact/message workspace. The
  strategy you wrote is visible there and is passed to the message writer.
- Copy, edit, or mark messages sent only in the CRM. The Deals sheet shows the
  resulting message, send, and reply counts rather than maintaining its own
  composer or approval queue.

## Reset

```bash
npm run reset && npm run seed
```

## Files

```
.env / .env.example      where the API key lives (env var preferred)
data/seed-companies.json vetted companies + named people
data/discovered-*.json   researched GTA companies
src/config.js            key loading (system env var > .env)
src/db.js                SQLite schema + queries
src/apollo.js            Apollo API client
src/relevance.js         title -> score + "why they'd reply"
src/pipeline.js          find people -> score -> enrich emails
src/discovery.js         find companies via Apollo (no Google needed)
src/server.js            web server + JSON API
public/                  the UI
```

## Reddit research loop

The Reddit pipeline collects public cold-outreach discussions and distills
compatible lessons into the active writer guidance. Its model steps also use
the authenticated Codex CLI. The local scraper reuses your
current Chrome Reddit cookies, but never writes cookie values or account
information to disk.

```bash
# One-time Python helper setup
python3 -m pip install -r requirements-reddit.txt

# Scrape all configured subreddits, then distill the corpus
npm run reddit:scrape
npm run reddit:learn
```

For a small test run:

```bash
python3 scripts/reddit-scraper.py sales --max-new 5 --delay 0.5
```

The scraper is read-only, rate-limited, atomically saves after every thread,
and resumes from `data/reddit/corpus.json`. For a headless machine without
Chrome, set the Reddit OAuth variables documented in
`scripts/reddit-scraper.js` and run `npm run reddit:scrape:oauth`.

## Sales research ingestion (YouTube + Google + books + articles)

The unified research pipeline expands the existing transcript/Reddit material,
keeps provenance for every item, then distills source-cited refinements into the
handbook and email-writer brain.

It intentionally has a bounded definition of "scrape":

- YouTube discovery uses the official Data API; only public captions are saved.
  Video and audio are never downloaded.
- Google web discovery uses Gemini's current Google Search grounding. The old
  Custom Search JSON API is supported only for existing customers because it is
  closed to new customers and sunsets January 1, 2027.
- Public article/course pages must be allowed by `robots.txt`; the collector
  does not cross a login, paywall, or publisher `noarchive`/`nosnippet` signal.
- Google Books stores bibliographic metadata and publisher descriptions only.
  It does not copy textbooks or paid course lessons.
- The raw resumable corpus stays under `data/research/` and is ignored by Git.
  The compact cited guide under `docs/sales-research/` is the reviewable output.

Install the helpers:

```bash
python3 -m pip install -r requirements-research.txt
```

Add only the providers you want to `.env`:

```dotenv
YOUTUBE_API_KEY=
GEMINI_API_KEY=
GOOGLE_BOOKS_API_KEY=
```

Bootstrap the 20 research transcripts already in this repository, inspect the
planned network queries, then collect and learn:

```bash
npm run research:bootstrap
python3 scripts/research-scraper.py all --dry-run --max-results 5
npm run research:scrape
npm run research:learn
```

Useful bounded runs:

```bash
# A direct public-caption URL works without a YouTube Data API key.
python3 scripts/research-scraper.py youtube \
  --youtube-url 'https://www.youtube.com/watch?v=VIDEO_ID' --max-new 1

# If YouTube rate-limits anonymous caption access, explicitly authorize the
# installed yt-dlp fallback to read Chrome's YouTube cookies. Cookies are not saved.
python3 scripts/research-scraper.py youtube \
  --youtube-url 'https://www.youtube.com/watch?v=VIDEO_ID' \
  --youtube-cookies-from-browser chrome --max-new 1

# Add a known public article/course page even without Google discovery credentials.
python3 scripts/research-scraper.py google \
  --url 'https://example.com/public-sales-guide' --max-new 1

# Keep an exploration cheap and reviewable.
python3 scripts/research-scraper.py all --max-results 3 --max-new 10
node scripts/research-learn.js --dry-run
```

Edit query breadth, seed URLs, exclusions, and limits in
`config/research-sources.json`. The learner writes
`docs/sales-research/research-wisdom.md`, updates the managed research block in
`docs/HANDBOOK.md`, and promotes only compatible rules into the managed active
block in `playbooks/_shared.md`. Fixed house standards still win when sources
disagree.
