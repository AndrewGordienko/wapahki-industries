// Problem-discovery research agent.
//
// Hunts for expensive, recurring, measurable Canadian operational problems that
// are poorly served by software, have usable data, and where Problem Found can
// build an MVP fast and get paid a cut of the savings. Two stages, both driven
// by the Codex CLI (the user's ChatGPT login — not the billed API):
//
//   1) SCOUT — four web-research roles split the requested batch: broad
//      ideation, company pain admissions, workforce/knowledge bottlenecks, and
//      active buying/change signals.
//   2) DEEP-DIVE + SCORE — for each candidate, research the real Canadian
//      specifics: what it costs, what we'd save, our cut, who buys, named
//      target companies, sources, and a /100 score with a factor breakdown.
//
// Results are upserted into the `problems` table (crm.db) and mirrored to
// data/problems.json. Anything scoring >= the approval gate is set to
// `approved` so the autonomous MVP factory can pick it up.
//
//   node scripts/discover-problems.js --count 6
//   node scripts/discover-problems.js --dry-run          # just plan the run
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCodex } from '../src/codex.js';
import { existingSlugs, slugify, upsertProblem, listProblems } from '../src/problems.js';
import {
  ADVERTISED_SIGNAL_SCHEMA,
  acceptScoutCandidate,
  allocateScoutCounts,
  summarizeScoutAllocations,
} from '../src/problem-scouts.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const CONFIG = join(root, 'config', 'problem-sources.json');
const COMPANY_SIGNALS_CONFIG = join(root, 'config', 'company-pain-sources.json');
const MIRROR = join(root, 'data', 'problems.json');
const MODEL = process.env.PROBLEM_DISCOVER_MODEL || process.env.CODEX_MODEL || 'gpt-5.6-sol';
// Web search + high reasoning together blow past the CLI timeout; medium keeps
// each grounded call in the ~1–2 min range. Override with PROBLEM_DISCOVER_REASONING.
const REASONING = process.env.PROBLEM_DISCOVER_REASONING || 'medium';
const CALL_TIMEOUT_MS = Number(process.env.PROBLEM_DISCOVER_TIMEOUT_MS) || 420_000;

const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def;
};
const COUNT = Number(flag('count', 6));
const CONCURRENCY = Number(flag('concurrency', 2));
const SCOUT_CONCURRENCY = Number(flag('scout-concurrency', 2));
const APPROVE_AT = Number(flag('min-score', 65));       // matches the SPEC qualification gate
const DRY_RUN = args.includes('--dry-run');
const RUN_ID = flag('run-id', `run-${new Date().toISOString().replace(/[:.]/g, '-')}`);

const log = (msg) => console.log(`[discover] ${msg}`);

const config = JSON.parse(readFileSync(CONFIG, 'utf8'));
const companySignalsConfig = JSON.parse(readFileSync(COMPANY_SIGNALS_CONFIG, 'utf8'));
const scoutAllocations = allocateScoutCounts(COUNT);

// ---- Codex output schemas ----------------------------------------------
// All object properties are listed as required (strict structured output).

const str = { type: 'string' };
const int = { type: 'integer' };

const candidateSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['problems'],
  properties: {
    problems: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'title', 'sector', 'region', 'one_liner', 'who_has_it',
          'workflow_today', 'why_expensive', 'why_unsolved',
          'proposed_solution', 'demo_idea', 'advertised_signals',
        ],
        properties: {
          title: str, sector: str, region: str, one_liner: str, who_has_it: str,
          workflow_today: str, why_expensive: str, why_unsolved: str,
          proposed_solution: str, demo_idea: str,
          advertised_signals: {
            type: 'array',
            items: ADVERTISED_SIGNAL_SCHEMA,
          },
        },
      },
    },
  },
};

const enrichSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'annual_cost_low', 'annual_cost_high', 'cost_basis', 'recurrence',
    'measurable', 'data_availability', 'savings_low', 'savings_high',
    'our_cut_low', 'our_cut_high', 'pricing_basis', 'buyer_roles',
    'target_companies', 'score', 'score_breakdown', 'confidence', 'sources',
  ],
  properties: {
    annual_cost_low: int, annual_cost_high: int, cost_basis: str,
    recurrence: str, measurable: str, data_availability: str,
    savings_low: int, savings_high: int, our_cut_low: int, our_cut_high: int,
    pricing_basis: str,
    buyer_roles: { type: 'array', items: str },
    target_companies: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['name', 'region', 'why'],
        properties: { name: str, region: str, why: str },
      },
    },
    score: { type: 'integer', minimum: 0, maximum: 100 },
    score_breakdown: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['factor', 'points', 'of', 'note'],
        properties: { factor: str, points: int, of: int, note: str },
      },
    },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    sources: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['title', 'url', 'note'],
        properties: { title: str, url: str, note: str },
      },
    },
  },
};

// ---- Prompts ------------------------------------------------------------

function generatePrompt(known, scout, scoutCount) {
  return `You are Problem Found's ${scout.label}, one member of a multi-agent Canadian opportunity-research team.

YOUR RESEARCH LANE
${scout.directive}

COMPANY-SIGNAL EVIDENCE POLICY
Source priority:
${companySignalsConfig.source_priority.map((item) => `- ${item}`).join('\n')}

Rules:
${companySignalsConfig.evidence_rules.map((item) => `- ${item}`).join('\n')}
${scout.searchPatternKey ? `
Useful query shapes (adapt company names and domains; do not treat the query text as evidence):
${companySignalsConfig.search_patterns[scout.searchPatternKey].map((item) => `- ${item}`).join('\n')}` : ''}

BUSINESS MODEL
${config.business_model}

We are hunting for problems that fit ALL of these:
${config.must_have.map((m) => `- ${m}`).join('\n')}

Avoid:
${config.avoid.map((m) => `- ${m}`).join('\n')}

Geography: ${config.geography}

Sectors worth mining (do not limit yourself to these, but stay concrete):
${config.sectors.map((s) => `- ${s}`).join('\n')}

Useful angles:
${config.angles.map((s) => `- ${s}`).join('\n')}

Use web search to ground yourself in real, current Canadian specifics (real programs, real cost figures, real regulations, real company types). Then propose ${scoutCount} DISTINCT candidate problems for your assigned lane.

Each candidate must be a SPECIFIC workflow that a specific kind of organisation does today and loses money on — not a vague category like "logistics is inefficient". For each:
- title: a short, specific name for the problem.
- sector: the industry.
- region: the Canadian region most affected (or "National").
- one_liner: one sentence stating the expensive problem.
- who_has_it: the profile of organisations that have it.
- workflow_today: concretely how the work is done now, and where the money leaks.
- why_expensive: what specifically costs money (time, penalties, waste, downtime, errors).
- why_unsolved: why existing software has not fixed this for this segment.
- proposed_solution: the specific software system Problem Found would build.
- demo_idea: what a 2-minute MVP demo — built from public or synthetic data — would show a buyer.
- advertised_signals: direct, dated, named-company disclosures that led to the candidate. Each must identify whether it is a target admission, wider market validation, or buying intent. ${scout.requiresAdvertisedSignal ? 'At least one valid signal is mandatory for this lane.' : 'Use an empty array when no named company advertised the problem.'}

For talent signals, do not equate one job opening with a shortage. For a vendor
such as IBM discussing a customer or market skills gap, set relationship to
"market-validation" unless the source explicitly describes the vendor's own
operational constraint.

Do NOT propose anything substantially the same as these already-known problems:
${known.length ? known.map((k) => `- ${k.title} (${k.slug})`).join('\n') : '- (none yet)'}

Return only the structured object. Be concrete and honest; a weak candidate is worse than fewer candidates.`;
}

function enrichPrompt(p) {
  return `You are scoring one candidate problem for Problem Found, a Canadian applied product studio that gets paid a cut of the savings it creates.

CANDIDATE
title: ${p.title}
sector: ${p.sector}
region: ${p.region}
problem_origin: ${p.problem_origin}
advertised_signals: ${JSON.stringify(p.advertised_signals || [], null, 2)}
one_liner: ${p.one_liner}
who_has_it: ${p.who_has_it}
workflow_today: ${p.workflow_today}
why_expensive: ${p.why_expensive}
why_unsolved: ${p.why_unsolved}
proposed_solution: ${p.proposed_solution}
demo_idea: ${p.demo_idea}

Use web search to verify every supplied company signal and ground every number
and name in reality. Preserve every valid advertised-signal URL in sources and
clearly distinguish the company's disclosure from our inference. Then produce:
- annual_cost_low / annual_cost_high: CAD this problem plausibly costs ONE typical organisation per year. Be conservative and explain the arithmetic in cost_basis.
- recurrence: how often the pain repeats.
- measurable: the concrete metric we could move and show a buyer.
- data_availability: what data an MVP needs and whether it is public, purchasable, or already in the customer's systems.
- savings_low / savings_high: CAD/year we could realistically save that organisation (a fraction of the cost, not the whole thing).
- our_cut_low / our_cut_high: our fee — a credible cut of year-one savings, typically 20–40% of savings, in the ~$50k–$300k range.
- pricing_basis: one sentence on how our fee maps to the savings.
- buyer_roles: the job titles that own BOTH the budget and the pain.
- target_companies: 3–6 REAL, NAMED Canadian organisations (or clearly-typed named examples) that likely have this problem, each with region and why. State whether a company admitted the pain directly or is merely a plausible peer.
- sources: real URLs you actually used, each with a short note on what it supports. If you could not verify a claim, say so in the note and lower confidence.
- confidence: low / medium / high, honest about how grounded your numbers are.
- score (0–100) and score_breakdown, using EXACTLY these seven factors and maximums:
  1. "Financial size / savings potential" — of 25
  2. "Recurring and measurable" — of 15
  3. "Underserved by existing software" — of 15
  4. "Usable data available for an MVP" — of 15
  5. "Identifiable buyer who owns budget and pain" — of 10
  6. "We can build a convincing MVP fast" — of 10
  7. "Repeatable across many Canadian organisations" — of 5
  The score must equal the sum of the points. Do not inflate; a 65+ means we would genuinely stake a build on it.

Return only the structured object.`;
}

// ---- Run ----------------------------------------------------------------

async function pool(items, size, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, run));
  return results;
}

function mirror() {
  const all = listProblems();
  writeFileSync(MIRROR, JSON.stringify(all, null, 2));
  return all.length;
}

async function main() {
  const known = existingSlugs();
  log(`model ${MODEL} · target ${COUNT} candidates · approve gate ${APPROVE_AT} · ${known.length} known problems · run ${RUN_ID}`);
  log(`scouts · ${summarizeScoutAllocations(scoutAllocations)}`);

  if (DRY_RUN) {
    log('dry run: four research roles would scout their allocated candidates, then deep-dive + score each and upsert to crm.db/data/problems.json.');
    return;
  }

  log(`stage 1/2 — ${scoutAllocations.length} problem scouts searching current web evidence…`);
  let candidates = [];
  let successfulScouts = 0;
  const batches = await pool(scoutAllocations, SCOUT_CONCURRENCY, async ({ scout, count }) => {
    log(`  ${scout.label} searching for ${count}…`);
    try {
      const out = await runCodex({
        prompt: generatePrompt(known, scout, count),
        schema: candidateSchema,
        model: MODEL,
        reasoning: REASONING,
        webSearch: true,
        timeoutMs: CALL_TIMEOUT_MS,
        cwd: root,
      });
      successfulScouts += 1;
      const proposed = Array.isArray(out.problems) ? out.problems : [];
      const accepted = proposed.filter((candidate) => acceptScoutCandidate(candidate, scout));
      const rejected = proposed.length - accepted.length;
      log(`  ${scout.label} returned ${accepted.length}${rejected ? ` (${rejected} rejected: no direct dated signal)` : ''}.`);
      return accepted.map((candidate) => ({
        ...candidate,
        problem_origin: scout.id,
      }));
    } catch (err) {
      log(`  ${scout.label} failed: ${err.message.split('\n')[0]}`);
      return [];
    }
  });
  candidates = batches.flat();
  if (!successfulScouts) {
    log('generation failed: every scout failed.');
    process.exitCode = 1;
    return;
  }

  const knownSlugs = new Set(known.map((k) => k.slug));
  const fresh = [];
  for (const c of candidates) {
    const slug = slugify(c.title);
    if (knownSlugs.has(slug) || fresh.some((f) => f.slug === slug)) continue;
    fresh.push({ ...c, slug });
  }
  log(`generated ${candidates.length} candidates, ${fresh.length} new after de-dupe.`);
  if (!fresh.length) { log('nothing new to score.'); mirror(); return; }

  log(`stage 2/2 — deep-diving + scoring ${fresh.length} candidates (concurrency ${CONCURRENCY})…`);
  let done = 0, saved = 0, approved = 0;
  await pool(fresh, CONCURRENCY, async (c) => {
    try {
      const e = await runCodex({
        prompt: enrichPrompt(c),
        schema: enrichSchema,
        model: MODEL,
        reasoning: REASONING,
        webSearch: true,
        timeoutMs: CALL_TIMEOUT_MS,
        cwd: root,
      });
      const status = (e.score ?? 0) >= APPROVE_AT ? 'approved' : 'discovered';
      upsertProblem({ ...c, ...e, status, run_id: RUN_ID });
      saved++;
      if (status === 'approved') approved++;
      log(`  scored ${++done}/${fresh.length} · ${c.title} → ${e.score}/100 (${status})`);
    } catch (err) {
      log(`  failed ${++done}/${fresh.length} · ${c.title}: ${err.message.split('\n')[0]}`);
    }
  });

  const total = mirror();
  log(`done. saved ${saved} problems (${approved} auto-approved for MVP build). backlog now ${total}.`);
}

main().catch((err) => {
  log(`fatal: ${err.message}`);
  process.exitCode = 1;
});
