// OutageHub discovery agent.
//
// OutageHub collects public outage updates from Canadian utilities and exposes
// their reported area and timing through a map/API. An optional SMS/email layer
// turns a matched public record into an operator workflow. This agent mirrors GnK's
// problem→companies→first-touch-email pipeline for that one product. Two stages,
// both driven by the Codex CLI (the user's ChatGPT login — not the billed API):
//
//   1) SCOUT — broad ideation plus company-admission, workforce-bottleneck and
//      active-buying agents search for specific problems that OutageHub can
//      honestly affect.
//   2) ENRICH + DRAFT — for each problem, research 3–6 REAL named Canadian
//      companies that have it, a buyer contact at each (name if findable, else a
//      role), score the problem /100, AND draft a first-touch email per contact
//      in Andrew's established OutageHub voice (playbooks/outagehub.md).
//
// Results are upserted into outagehub_problems + outagehub_targets (crm.db) and
// mirrored to data/outagehub-problems.json.
//
//   node scripts/outagehub-discover.js --count 8
//   node scripts/outagehub-discover.js --dry-run
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCodex } from '../src/codex.js';
import {
  existingSlugs, slugify, upsertProblem, upsertTarget, listOutagehubProblems,
} from '../src/outagehub.js';
import {
  ADVERTISED_SIGNAL_SCHEMA,
  acceptScoutCandidate,
  allocateScoutCounts,
  summarizeScoutAllocations,
} from '../src/problem-scouts.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const MIRROR = join(root, 'data', 'outagehub-problems.json');
const COMPANY_SIGNALS_CONFIG = join(root, 'config', 'company-pain-sources.json');
const MODEL = process.env.OUTAGEHUB_MODEL || process.env.CODEX_MODEL || 'gpt-5.6-sol';
const REASONING = process.env.OUTAGEHUB_REASONING || 'medium';
const CALL_TIMEOUT_MS = Number(process.env.OUTAGEHUB_TIMEOUT_MS) || 480_000;

const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def;
};
const COUNT = Number(flag('count', 8));
const CONCURRENCY = Number(flag('concurrency', 2));
const SCOUT_CONCURRENCY = Number(flag('scout-concurrency', 2));
const APPROVE_AT = Number(flag('min-score', 65));
const DRY_RUN = args.includes('--dry-run');
const RUN_ID = flag('run-id', `run-${new Date().toISOString().replace(/[:.]/g, '-')}`);

const log = (msg) => console.log(`[outagehub] ${msg}`);

// House voice for the drafted emails.
const sharedRules = readFileSync(join(root, 'playbooks', '_shared.md'), 'utf8');
const playbook = readFileSync(join(root, 'playbooks', 'outagehub.md'), 'utf8');
const companySignalsConfig = JSON.parse(readFileSync(COMPANY_SIGNALS_CONFIG, 'utf8'));
const scoutAllocations = allocateScoutCounts(COUNT);

const PRODUCT = `OutageHub collects public outage updates from Canadian electricity utilities and records which area was reported out and when. A person can watch the record on a map, a customer's software can read it through an API, and an SMS/email layer can notify an operator when a tracked area or address is included in a public utility report. This is early: no guaranteed national coverage, instant detection, lead-time advantage, production alerting or customer outcomes — the honest offer is one real public utility record for an area they serve.`;

// ---- Schemas (all properties required for strict structured output) ------

const str = { type: 'string' };
const nstr = { type: ['string', 'null'] };
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
          'title', 'sector', 'region', 'one_liner', 'who_has_it', 'workflow_today',
          'why_expensive', 'outagehub_solution', 'data_signal', 'demo_idea',
          'measurable', 'advertised_signals',
        ],
        properties: {
          title: str, sector: str, region: str, one_liner: str, who_has_it: str,
          workflow_today: str, why_expensive: str, outagehub_solution: str,
          data_signal: str, demo_idea: str, measurable: str,
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
  required: ['buyer_roles', 'score', 'score_breakdown', 'confidence', 'sources', 'targets'],
  properties: {
    buyer_roles: { type: 'array', items: str },
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
    targets: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: [
          'company', 'domain', 'hq', 'segment', 'why_them',
          'contact_name', 'contact_title', 'contact_email', 'email_subject', 'email_body',
        ],
        properties: {
          company: str, domain: str, hq: str, segment: str, why_them: str,
          contact_name: str, contact_title: str, contact_email: nstr,
          email_subject: str, email_body: str,
        },
      },
    },
  },
};

// ---- Prompts ------------------------------------------------------------

function generatePrompt(known, scout, scoutCount) {
  return `You are OutageHub's ${scout.label}, one member of a multi-agent Canadian opportunity-research team.

YOUR RESEARCH LANE
${scout.directive}

COMPANY-SIGNAL EVIDENCE POLICY
Source priority:
${companySignalsConfig.source_priority.map((item) => `- ${item}`).join('\n')}

Rules:
${companySignalsConfig.evidence_rules.map((item) => `- ${item}`).join('\n')}
${scout.searchPatternKey ? `
Useful query shapes (adapt them to outage-exposed operators; the query text is not evidence):
${companySignalsConfig.search_patterns[scout.searchPatternKey].map((item) => `- ${item}`).join('\n')}` : ''}

WHAT OUTAGEHUB IS
${PRODUCT}

We are hunting for problems that fit ALL of these:
- A specific kind of Canadian organisation loses money, time, or SLA credits because it finds out too late (or never in a structured way) that grid power dropped at a location it cares about.
- The organisation operates or serves MANY locations, sites, customers, or field routes — so watching every utility website by hand does not scale.
- Live outage data and/or an SMS/email "this address just went out" alert would measurably change a real decision they make: dispatch a crew, stage a generator, move refrigerated stock, escalate to a customer, start an SLA clock, roll a truck.
- There is a real buyer who owns both the outage-response decision and a budget.

Avoid:
- Selling to the electricity utilities themselves (they already own the outage data).
- Vague "situational awareness" with no specific decision attached.
- Consumer apps, or anything needing data OutageHub cannot get from public utility feeds.
- Claims that require guaranteed coverage, instant detection, or proven lead-time.

Geography: Canada (name the province/region most affected, or "National").

Use web search to ground yourself in real, current Canadian specifics (real company types, real outage-exposed operations, real regulations like food-safety disposal rules, real SLA norms). Then propose ${scoutCount} DISTINCT problems for your assigned lane, spread across different sectors where possible (e.g. cold chain / grocery, telecom & ISPs, data centres & colo, generator & emergency fuel, senior care & health, property & facilities, security & alarm monitoring, EV charging, agriculture, municipal / emergency management, insurance, logistics).

Each problem must be a SPECIFIC decision a specific kind of operator makes today and loses money on — not a category. For each:
- title: short, specific name for the problem.
- sector: the industry.
- region: Canadian region most affected (or "National").
- one_liner: one sentence stating the expensive blind spot.
- who_has_it: the profile of organisations that have it.
- workflow_today: concretely how they find out about outages now (utility website refreshes, customer calls, a control room, nothing) and where the money leaks.
- why_expensive: what specifically costs money when they learn late (spoiled stock, SLA credits, truck rolls, missed emergency rentals, safety, churn).
- outagehub_solution: exactly how OutageHub's live outage API and/or SMS/email alert on the locations they track changes that decision.
- data_signal: which outage signal drives the value (an alert the instant an address/area is reported out; which utility; estimated restoration; cluster forming nearby; historical timing for later review).
- demo_idea: what showing them ONE real recent outage record from an area they serve would prove in a first call.
- measurable: the one metric it moves.
- advertised_signals: direct, dated, named-company disclosures that led to the candidate. ${scout.requiresAdvertisedSignal ? 'At least one valid signal is mandatory for this lane.' : 'Use an empty array when no named company advertised the problem.'}

The advertised problem must connect to a decision OutageHub's present public
utility record, API, or tracked-area notification can change. Do not bend a
generic hiring or modernization signal into an outage-data opportunity. A
single job posting is demand, not proof of a staffing shortage.

Do NOT propose anything substantially the same as these already on the board:
${known.length ? known.map((k) => `- ${k.title} (${k.slug})`).join('\n') : '- (none yet)'}

Return only the structured object. Be concrete and honest; a weak candidate is worse than fewer candidates.`;
}

function enrichPrompt(p) {
  return `You are scoring ONE OutageHub problem and finding the real Canadian companies + buyers who would pay for it, then writing each of them a first cold email.

WHAT OUTAGEHUB IS
${PRODUCT}

THE PROBLEM
title: ${p.title}
sector: ${p.sector}
region: ${p.region}
problem_origin: ${p.problem_origin}
advertised_signals: ${JSON.stringify(p.advertised_signals || [], null, 2)}
one_liner: ${p.one_liner}
who_has_it: ${p.who_has_it}
workflow_today: ${p.workflow_today}
why_expensive: ${p.why_expensive}
outagehub_solution: ${p.outagehub_solution}
data_signal: ${p.data_signal}
demo_idea: ${p.demo_idea}
measurable: ${p.measurable}

Use web search to verify the supplied company disclosures and ground every
company and claim in reality. Preserve each valid advertised-signal URL in
sources. Never turn a market-validation source into a claim that a target
company admitted the problem. Produce:

- buyer_roles: the job titles that own BOTH the outage-response decision and the budget for this problem.
- targets: 3–6 REAL, NAMED Canadian organisations that plausibly have THIS problem. For each:
  - company, domain (best-known public domain), hq (city, province), segment (one line on what they do).
  - why_them: the specific, verifiable reason this company has this outage blind spot (their footprint, SLA, cold chain, service area, past storm exposure). Ground it; do not invent facts. Say whether the company disclosed the problem or is only a plausible peer.
  - contact_name: a real named person in a fitting role if you can find one via web search, otherwise the best-fit role title as a placeholder (e.g. "Director of Network Operations").
  - contact_title: their title.
  - contact_email: a real or clearly-patterned work email if you can determine it, otherwise null. Never fabricate a specific address you are not confident about.
  - email_subject + email_body: the first-touch cold email to that contact (see rules below).
- score (0–100) and score_breakdown using EXACTLY these seven factors and maximums:
  1. "Financial size of the outage blind spot" — of 25
  2. "Outages recur and the pain is measurable" — of 15
  3. "Underserved today (utility sites / calls / manual)" — of 15
  4. "OutageHub's data + alert layer genuinely covers it" — of 15
  5. "Identifiable buyer who owns the decision and budget" — of 10
  6. "One real outage record proves value fast" — of 10
  7. "Repeatable across many Canadian operators" — of 5
  The score must equal the sum of points. A 65+ means we would genuinely run this outreach.
- confidence: low / medium / high, honest about grounding.
- sources: real URLs you actually used, each with a short note on what it supports.

EMAIL RULES — follow the OutageHub playbook exactly:
${playbook}

SHARED HOUSE RULES:
${sharedRules}

For every email: open on the recipient's specific outage-exposed workflow (grounded in why_them), explain OutageHub in one plain sentence, offer the real public utility record for ONE area they serve, and — where it fits the role — mention that OutageHub can also send an SMS/email the instant an area they track is reported out. Ask for ~20 minutes to compare a real record with how their team sees the same event today. 90–160 words, plain prose, greeting "Hi <First>,", then the signature:

Best,
Andrew Gordienko
OutageHub

Never promise guaranteed coverage, instant detection, a lead-time advantage, or customer results. Never blame the recipient for a past outage. Never say "AI". Return only the structured object.`;
}

// ---- Run ----------------------------------------------------------------

async function pool(items, size, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) { const i = next++; results[i] = await worker(items[i], i); }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, run));
  return results;
}

function mirror() {
  const all = listOutagehubProblems();
  writeFileSync(MIRROR, JSON.stringify(all, null, 2));
  return all.length;
}

function normalizeEmail(subject, body) {
  let out = String(body || '').trim();
  if (!/outagehub\s*$/i.test(out)) out += '\n\nBest,\nAndrew Gordienko\nOutageHub';
  return { subject: String(subject || '').trim(), body: out };
}

async function main() {
  const known = existingSlugs();
  log(`model ${MODEL} · target ${COUNT} problems · approve gate ${APPROVE_AT} · ${known.length} on board · run ${RUN_ID}`);
  log(`scouts · ${summarizeScoutAllocations(scoutAllocations)}`);

  if (DRY_RUN) {
    log('dry run: four research roles would scout their allocated problems, then find real companies + buyers, score, and draft first-touch emails.');
    return;
  }

  log(`stage 1/2 — ${scoutAllocations.length} OutageHub scouts searching current web evidence…`);
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
  if (!fresh.length) { log('nothing new to enrich.'); mirror(); return; }

  log(`stage 2/2 — companies + buyers + first-touch emails for ${fresh.length} problems (concurrency ${CONCURRENCY})…`);
  let done = 0, savedProblems = 0, savedTargets = 0, savedEmails = 0;
  await pool(fresh, CONCURRENCY, async (c) => {
    try {
      const e = await runCodex({
        prompt: enrichPrompt(c), schema: enrichSchema, model: MODEL,
        reasoning: REASONING, webSearch: true, timeoutMs: CALL_TIMEOUT_MS, cwd: root,
      });
      const status = (e.score ?? 0) >= APPROVE_AT ? 'approved' : 'discovered';
      const problem = upsertProblem({
        ...c, buyer_roles: e.buyer_roles, score: e.score, score_breakdown: e.score_breakdown,
        confidence: e.confidence, sources: e.sources, status, run_id: RUN_ID,
      });
      savedProblems++;
      for (const t of e.targets || []) {
        const em = normalizeEmail(t.email_subject, t.email_body);
        upsertTarget({
          problem_id: problem.id, company: t.company, domain: t.domain, hq: t.hq,
          segment: t.segment, why_them: t.why_them, contact_name: t.contact_name,
          contact_title: t.contact_title, contact_email: t.contact_email || null,
          email_subject: em.subject, email_body: em.body, status: 'drafted',
        });
        savedTargets++;
        if (em.body) savedEmails++;
      }
      log(`  [${++done}/${fresh.length}] ${c.title} → ${e.score}/100 (${status}) · ${(e.targets || []).length} companies`);
    } catch (err) {
      log(`  ! [${++done}/${fresh.length}] ${c.title}: ${err.message.split('\n')[0]}`);
    }
  });

  const total = mirror();
  log(`done. ${savedProblems} problems, ${savedTargets} companies, ${savedEmails} first-touch emails. board now ${total} problems.`);
}

main().catch((err) => {
  log(`fatal: ${err.message}`);
  process.exitCode = 1;
});
