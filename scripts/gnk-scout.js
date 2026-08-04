// GNK opportunity scout — runs Codex with live web research against the HANDBOOK
// to find defensible, budgeted, meaningful AI-project opportunities. Saves them to a
// review queue (data/gnk-opportunities.json) for human approval before we spend Apollo.
//
//   node scripts/gnk-scout.js --count 6
//   node scripts/gnk-scout.js --count 4 --theme "professional sports teams and leagues"
//   node scripts/gnk-scout.js --count 10 --lane ownership-transition
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runCodex } from '../src/codex.js';
import { insertCompany, getCompanyByName } from '../src/db.js';
import {
  ADVERTISED_SIGNAL_SCHEMA,
  PROBLEM_SCOUTS,
  acceptScoutCandidate,
  allocateScoutCounts,
  summarizeScoutAllocations,
} from '../src/problem-scouts.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const args = process.argv.slice(2);
const argVal = (flag, dflt) => {
  const i = args.indexOf(flag);
  if (i >= 0 && args[i + 1]) return args[i + 1];
  const eq = args.find((a) => a.startsWith(`${flag}=`));
  return eq ? eq.split('=')[1] : dflt;
};
const count = Number(argVal('--count', 6));
const theme = argVal('--theme', 'a MIX across climate/ocean/conservation, professional sports, science/health/medical, humanitarian/social-impact, and education');
const tier = argVal('--tier', 'mixed');
const lane = argVal('--lane', '');
const DRY_RUN = args.includes('--dry-run');
const MODEL = process.env.GNK_SCOUT_MODEL || 'gpt-5.6-sol';
const SCOUT_CONCURRENCY = Number(argVal('--scout-concurrency', 2));

const OWNER_TRANSITION_SCOUT = Object.freeze({
  id: 'ownership-transition',
  label: 'Owner Independence & Transition Scout',
  searchPatternKey: 'ownership_transitions',
  requiresAdvertisedSignal: true,
  directive: `Start with established, privately held Canadian-first businesses
that have a current PUBLIC business-transition or operating-continuity signal:
a company-announced succession or ownership transfer, a newly appointed
President/GM/COO, an owner publicly seeking operating leadership, acquisition
integration, ERP/operations modernization, repeated hiring around a documented
dispatch/estimating/finance/service bottleneck, or an explicit knowledge-handoff
initiative.

The opportunity is to make one routine workflow less dependent on the owner or
one long-tenured expert while keeping human approval. Good wedges include
preparing estimates from emails/PDFs, assembling dispatch plans, drafting routine
customer updates from job records, matching invoices and purchase orders for
review, retrieving the right SOP/service history, or preparing a manager handoff.
Choose only one workflow per company and tie it to a measurable consequence.

Never infer or mention anyone's age, generation, retirement plan, health, family
situation, wealth or intention to sell. A founder/owner title or a person's
appearance is not a signal. An anonymous business-for-sale listing is market
context, not a named target, and must never be reverse-identified. Do not pitch
job replacement, "automate the whole business," sale valuation, or autonomous
high-stakes decisions.`,
});
const GNK_SCOUTS = Object.freeze([...PROBLEM_SCOUTS, OWNER_TRANSITION_SCOUT]);
const GNK_ROTATION = Object.freeze([
  'ownership-transition',
  'company-admissions',
  'broad-ideation',
  'talent-bottlenecks',
  'buying-signals',
  'ownership-transition',
]);

const activeScouts = lane ? GNK_SCOUTS.filter((scout) => scout.id === lane) : GNK_SCOUTS;
if (!activeScouts.length) {
  throw new Error(`Unknown --lane ${lane}; use ${GNK_SCOUTS.map((scout) => scout.id).join(', ')}`);
}
const opportunitySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['opportunities'],
  properties: {
    opportunities: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['org', 'domain', 'theme', 'what_they_do', 'ai_project', 'why_meaningful', 'defensible_problem', 'evidence_source', 'budget_signal', 'close_tier', 'days_to_close', 'reachability', 'ideal_contacts', 'advertised_signals'],
        properties: {
          org: { type: 'string' },
          domain: { type: 'string' },
          theme: { type: 'string' },
          what_they_do: { type: 'string' },
          ai_project: { type: 'string' },
          why_meaningful: { type: 'string' },
          defensible_problem: { type: 'string' },
          evidence_source: { type: 'string' },
          budget_signal: { type: 'string' },
          close_tier: { type: 'string', enum: ['easy', 'medium', 'hard'] },
          days_to_close: { type: 'integer', enum: [30, 60, 90] },
          reachability: { type: 'string' },
          ideal_contacts: { type: 'array', items: { type: 'string' } },
          advertised_signals: {
            type: 'array',
            items: ADVERTISED_SIGNAL_SCHEMA,
          },
        },
      },
    },
  },
};

const closeabilityLine = tier === 'hard'
  ? 'CLOSEABILITY FILTER (handbook §2b): find HARD-TIER targets specifically — BIGGER scale-ups and mid-market enterprises (not tiny startups) that would take ~90 days to close but STILL have a specific, REACHABLE, budget-owning decision-maker (a Director/VP/Head who could champion and sign a $10-30k pilot). They must be genuinely closeable — NOT procurement-gauntlet institutions (no big public universities, national labs, giant hospital systems, huge NGOs). For every org set "close_tier":"hard" and "days_to_close":90.'
  : 'CLOSEABILITY IS THE MAKE-OR-BREAK FILTER (handbook §2b filter 2). We are a small Toronto shop. Only include an org if you can genuinely picture a reachable decision-maker (Director/VP/CTO/founder) REPLYING to a cold note from us and SIGNING a $10-30k pilot within 90 days. Cut giant slow bureaucracies (big public universities, national labs, huge NGOs/hospitals with procurement) unless there is a specific nimble, budget-owning unit we can reach. Tier each honestly: easy = closeable in 30 days, medium = 60, hard = 90. Bias HEAVILY toward easy/reachable.';

const handbook = readFileSync(join(root, 'docs', 'HANDBOOK.md'), 'utf8');
const companySignalsConfig = JSON.parse(
  readFileSync(join(root, 'config', 'company-pain-sources.json'), 'utf8'),
);
const scoutAllocations = allocateScoutCounts(
  count,
  activeScouts,
  lane ? [lane] : GNK_ROTATION,
);
const readArr = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : []);
const outPath = join(root, argVal('--out', 'data/gnk-opportunities.json'));
const avoidPath = join(root, argVal('--avoid', 'data/gnk-opportunities.json'));
const existing = readArr(outPath);                 // append to this batch file
const avoid = readArr(avoidPath);                  // also avoid orgs already in the main queue
const seen = new Set([...existing, ...avoid].map((o) => (o.org || '').toLowerCase()));

function briefFor(scout, scoutCount) {
  const taskScope = scout.id === 'ownership-transition'
    ? 'established, privately held Canadian-first businesses in operationally dense sectors such as field services/trades, specialty manufacturing and distribution, equipment service, logistics, commercial facilities/property service, and multi-location business services'
    : theme;
  return [
    `You are GNK's ${scout.label}, one member of a multi-agent opportunity-research team. USE WEB SEARCH. Every organization, number, and URL must be REAL and verifiable — no invented orgs, figures, or links.`,
    '',
    'YOUR RESEARCH LANE',
    scout.directive,
    '',
    'COMPANY-SIGNAL EVIDENCE POLICY',
    ...companySignalsConfig.source_priority.map((item) => `- ${item}`),
    ...companySignalsConfig.evidence_rules.map((item) => `- ${item}`),
    ...(scout.searchPatternKey
      ? [
          'Useful query shapes (adapt them; query text is not evidence):',
          ...companySignalsConfig.search_patterns[scout.searchPatternKey].map((item) => `- ${item}`),
        ]
      : []),
    '',
    'Below is our strategy HANDBOOK (the source of truth). Follow section 2b (GNK) exactly — ability to fund a CAD $10k–$30k pilot with cited evidence, a reachable sponsor, a defensible project with a real source, and the interesting/meaningful bar.',
    '"""', handbook, '"""',
    '',
    `TASK: Find ${scoutCount} REAL organizations (${taskScope}) that each pass ALL GNK filters. Go deep on each org's operation and design the one bounded software/AI-assisted workflow that would genuinely move it.`,
    seen.size ? `Do NOT repeat any of these already-found orgs: ${[...seen].join('; ')}.` : '',
    '',
    closeabilityLine,
    '',
    `Return advertised_signals with direct, dated URLs. ${scout.requiresAdvertisedSignal ? 'At least one is mandatory for every result in this lane.' : 'Use an empty array when no named company advertised the problem.'}`,
    'A single job posting proves demand, not a shortage. A vendor statement about customer pain is market-validation, not proof that the vendor has the problem. If a famous but unreachable company such as IBM validates the market, keep that signal but choose org only if the target itself passes the handbook closeability gate.',
    'The proposed project should relieve the disclosed workflow, capacity or knowledge bottleneck. Do not default to a recruiting product.',
    scout.id === 'ownership-transition'
      ? 'Set theme to "owner independence / business continuity". The company must normally have 20–250 employees or equivalent established operating scale, clear evidence it can fund a paid pilot, and a reachable Owner/President/GM/COO/operations or finance leader. Explain the measurable owner/senior-expert load relieved without diagnosing private internal facts.'
      : '',
    '',
    'Return only the structured JSON requested by the schema. Put results in the opportunities array.',
  ].join('\n');
}

async function pool(items, size, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, run));
  return results;
}

const scopeLabel = lane === 'ownership-transition' ? 'owner independence / business continuity' : theme;
console.log(`Scouting ${count} GNK opportunities (${scopeLabel})… (Codex ${MODEL}, live web research — can take a few minutes)`);
console.log(`Scouts · ${summarizeScoutAllocations(scoutAllocations)}`);
if (DRY_RUN) {
  console.log(`${`Dry run: ${scoutAllocations.length} research lane${scoutAllocations.length === 1 ? '' : 's'} would search the allocated opportunities;`} no model calls, CRM writes, or queue writes were made.`);
}
const batches = DRY_RUN ? [] : await pool(scoutAllocations, SCOUT_CONCURRENCY, async ({ scout, count: scoutCount }) => {
  console.log(`  ${scout.label} searching for ${scoutCount}…`);
  try {
    const result = await runCodex({
      prompt: briefFor(scout, scoutCount),
      schema: opportunitySchema,
      model: MODEL,
      reasoning: 'high',
      webSearch: true,
      timeoutMs: 900_000,
      cwd: root,
    });
    const proposed = Array.isArray(result.opportunities) ? result.opportunities : [];
    const accepted = proposed.filter((candidate) => acceptScoutCandidate(candidate, scout));
    const rejected = proposed.length - accepted.length;
    console.log(`  ${scout.label} returned ${accepted.length}${rejected ? ` (${rejected} rejected: no direct dated signal)` : ''}.`);
    return accepted.map((candidate) => ({
      ...candidate,
      problem_origin: scout.id,
    }));
  } catch (error) {
    console.log(`  ${scout.label} failed: ${error.message.split('\n')[0]}`);
    return [];
  }
});
const dossiers = batches.flat();

let added = 0;
for (const d of dossiers) {
  if (!d || !d.org) continue;
  const k = d.org.toLowerCase();
  if (seen.has(k)) continue;
  seen.add(k);
  existing.push({ ...d, status: 'pending' });
  writeFileSync(outPath, JSON.stringify(existing, null, 2)); // write after EACH so the review queue trickles

  // Trickle into the CRM (localhost) as a gnk company right away
  if (!getCompanyByName(d.org)) {
    try {
      insertCompany({
        name: d.org,
        domain: d.domain && d.domain.includes('.') ? d.domain : null,
        location: d.theme || null,
        industry: [d.close_tier ? d.close_tier.toUpperCase() : '', d.ai_project].filter(Boolean).join(' · ').slice(0, 220),
        campaign: 'gnk',
        tier: (d.close_tier || '').toLowerCase() || null,
        source: `codex-scout:${d.problem_origin || 'unknown'}`,
        notes: JSON.stringify(d),
        target_titles: Array.isArray(d.ideal_contacts) ? d.ideal_contacts : [],
      });
    } catch { /* ignore (e.g. duplicate name) */ }
  }
  added++;
  console.log(`  • [${d.close_tier || '?'}] ${d.org} — ${(d.ai_project || '').slice(0, 70)}…`);
}
if (!DRY_RUN) {
  console.log(`\nAdded ${added} new opportunities → CRM (gnk funnel) + ${outPath}`);
}
