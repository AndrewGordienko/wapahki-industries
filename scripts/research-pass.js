// Per-account evidence / research pass.
//
// Fills the gap that write-sequences.js already reads from: it produces conservative,
// source-cited evidence for a campaign+company in the EXACT shape that
// contactContext() consumes from data/outreach-research.json:
//   { summary, source_url, source_date, warning }
// (plus extra metadata fields signal_type/confidence, which the pipeline ignores).
//
// Uses the existing Codex CLI login via src/codex.js runCodex() — no OPENAI_API_KEY,
// no usage-billed API. Web search is enabled so evidence is grounded in real URLs.
//
// Fail-closed + human-in-the-loop by design:
//   - By default it writes PROPOSALS to data/outreach-research.proposed.json for review,
//     flushing after EVERY company so a long/interrupted batch is never lost.
//   - It only merges into the live data/outreach-research.json when RESEARCH_APPLY=1
//     (or RESEARCH_MERGE_ONLY=1), and it always backs the live file up first.
//   - The prompt forbids fabricated URLs and forces a conservative `warning` on every
//     item describing what the evidence does and does NOT prove.
//
// Env:
//   RESEARCH_CAMPAIGN=wapahki,gnk    restrict to campaign(s), comma-separated (default: all)
//   RESEARCH_COMPANY="ACE Bakery"    single company by exact name (overrides limit)
//   RESEARCH_LIMIT=3                 max companies this run; 0 = unlimited (default 3)
//   RESEARCH_ONLY_MISSING=1          skip companies already in the LIVE file (default 1)
//   RESEARCH_RESUME=1                skip companies already in the PROPOSALS file (default 1)
//   RESEARCH_APPLY=1                 after researching, merge results into the live file
//   RESEARCH_MERGE_ONLY=1            skip research; just merge existing proposals -> live
//   CRM_DB_PATH, CODEX_MODEL, CODEX_REASONING, CODEX_TIMEOUT_MS   passed through
//
// Run:  node scripts/research-pass.js       (or: npm run outreach:research)

import { DatabaseSync } from 'node:sqlite';
import { writeFile, copyFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runCodex } from '../src/codex.js';

const ROOT = process.cwd();
const DB_PATH = process.env.CRM_DB_PATH || join(ROOT, 'data', 'crm.db');
const LIVE = join(ROOT, 'data', 'outreach-research.json');
const PROPOSED = join(ROOT, 'data', 'outreach-research.proposed.json');

const rawLimit = process.env.RESEARCH_LIMIT;
const LIMIT = rawLimit === undefined || rawLimit === '' ? 3 : Number(rawLimit); // 0 = unlimited
const ONLY_MISSING = process.env.RESEARCH_ONLY_MISSING !== '0';
const RESUME = process.env.RESEARCH_RESUME !== '0';
const APPLY = process.env.RESEARCH_APPLY === '1';
const MERGE_ONLY = process.env.RESEARCH_MERGE_ONLY === '1';
const CAMPAIGNS = (process.env.RESEARCH_CAMPAIGN || '')
  .split(',').map((s) => s.trim()).filter(Boolean); // empty = all campaigns
const COMPANY = process.env.RESEARCH_COMPANY || null;

// Structured output schema for one company's research.
const researchSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['company', 'campaign', 'evidence'],
  properties: {
    company: { type: 'string' },
    campaign: { type: 'string' },
    evidence: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['summary', 'source_url', 'source_date', 'signal_type', 'confidence', 'warning'],
        properties: {
          summary: { type: 'string' },
          source_url: { type: 'string' },
          source_date: { type: ['string', 'null'] },
          signal_type: {
            type: 'string',
            enum: ['company_fact', 'market_signal', 'peer_example', 'role_signal', 'hiring', 'funding', 'operational', 'none'],
          },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          warning: { type: 'string' },
        },
      },
    },
  },
};

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

function buildPrompt(company) {
  return `You are a conservative B2B lead researcher. Your evidence feeds a fail-closed
outreach writer, so accuracy and honest framing matter more than volume. Overclaiming is
worse than finding nothing.

TARGET COMPANY
- name: ${company.name}
- website/domain: ${company.domain || '(unknown — find it)'}
- industry: ${company.industry || '(unknown)'}
- location: ${company.city || '(unknown)'}
- campaign: ${company.campaign}
- internal working hypothesis (NOT fact, do not cite as evidence): ${company.hypothesis || '(none)'}

TASK
Use web search to find 1–4 pieces of PUBLIC, verifiable evidence about this company that a
salesperson could reference honestly. Prefer, in order:
  1. The company's own website/pages (what they make, do, or operate).
  2. Reputable third-party sources (news, filings, trade press, job postings).
  3. Clearly-labelled peer/industry examples when nothing company-specific exists.

HARD RULES
- Only include a source_url you actually retrieved via web search this turn. Never invent,
  guess, or reconstruct a URL. If you cannot find a real source for a claim, omit the claim.
- If you find nothing solid, return a single evidence item with signal_type "none",
  confidence "low", an empty-ish summary explaining what you looked for, and source_url set
  to the company's homepage only if you confirmed it exists (else the best real URL you found).
- Every item MUST include a "warning": one or two sentences stating exactly what the evidence
  does and does NOT prove, in the style of these real examples:
    "This is a peer example, not evidence about ${company.name}. Do not imply they use the
     same equipment or claim why the peer bought it."
    "This supports product variety and a bounded question. It does not prove one line runs
     multiple products or that they use a robot. Ask rather than assume."
- "summary" must be a plain factual paraphrase of what the source says — no adjectives about
  urgency, cost, or pain, and no inference about internal processes.
- source_date: the publication date if the source shows one, else null.

Return the structured object for company "${company.name}" (campaign "${company.campaign}").`;
}

function toLiveItems(evidence) {
  // Canonical shape consumed by contactContext(); keep extra metadata too (ignored downstream).
  return evidence
    .filter((e) => e && e.summary && e.source_url && e.signal_type !== 'none')
    .map((e) => ({
      summary: e.summary,
      source_url: e.source_url,
      source_date: e.source_date ?? null,
      warning: e.warning,
      signal_type: e.signal_type,
      confidence: e.confidence,
    }));
}

function mergeDedup(existing, incoming) {
  const seen = new Set((existing || []).map((e) => e.source_url));
  const merged = [...(existing || [])];
  for (const item of incoming) {
    if (seen.has(item.source_url)) continue;
    seen.add(item.source_url);
    merged.push(item);
  }
  return merged;
}

async function mergeProposalsIntoLive(live, proposals) {
  const backup = `${LIVE}.bak-${Date.now()}`;
  if (existsSync(LIVE)) await copyFile(LIVE, backup);
  const next = { ...live };
  let n = 0;
  for (const [key, items] of Object.entries(proposals)) {
    if (!items || !items.length) continue;
    next[key] = mergeDedup(next[key], items);
    n += 1;
  }
  await writeFile(LIVE, JSON.stringify(next, null, 2) + '\n', 'utf8');
  console.log(`Merged ${n} compan${n === 1 ? 'y' : 'ies'} from proposals into ${LIVE} (backup: ${backup}).`);
}

async function main() {
  const live = readJson(LIVE, {});
  const proposals = readJson(PROPOSED, {});

  if (MERGE_ONLY) {
    await mergeProposalsIntoLive(live, proposals);
    return;
  }

  if (!existsSync(DB_PATH)) {
    console.error(`No CRM db at ${DB_PATH}. Set CRM_DB_PATH.`);
    process.exit(1);
  }
  const db = new DatabaseSync(DB_PATH, { readOnly: true });

  let rows = db.prepare(
    `SELECT name, domain, industry, city, campaign, hypothesis, lead_score
       FROM companies WHERE archived_at IS NULL`
  ).all();
  if (CAMPAIGNS.length) rows = rows.filter((r) => CAMPAIGNS.includes(r.campaign));
  if (COMPANY) rows = rows.filter((r) => r.name === COMPANY);
  rows.sort((a, b) =>
    (b.lead_score ?? -1) - (a.lead_score ?? -1) || String(a.name).localeCompare(String(b.name)));

  const targets = [];
  for (const r of rows) {
    const key = `${r.campaign}:${r.name}`;
    if (ONLY_MISSING && Array.isArray(live[key]) && live[key].length) continue;
    if (RESUME && Array.isArray(proposals[key])) continue;
    targets.push(r);
    if (!COMPANY && LIMIT > 0 && targets.length >= LIMIT) break;
  }

  if (!targets.length) {
    console.log('No target companies (all selected already have research/proposals, or none matched).');
    return;
  }

  console.log(`Researching ${targets.length} compan${targets.length === 1 ? 'y' : 'ies'} `
    + `(apply=${APPLY ? 'LIVE' : 'proposals-only'}):`);

  let ok = 0;
  let items = 0;
  for (let i = 0; i < targets.length; i += 1) {
    const company = targets[i];
    const key = `${company.campaign}:${company.name}`;
    process.stdout.write(`[${i + 1}/${targets.length}] ${key} ... `);
    try {
      const result = await runCodex({
        prompt: buildPrompt(company),
        schema: researchSchema,
        webSearch: true,
        cwd: ROOT,
      });
      const evidence = toLiveItems(result.evidence || []);
      proposals[key] = evidence;
      items += evidence.length;
      console.log(`${evidence.length} item(s)`);
      // Flush after every company so an interrupted batch is never lost.
      await writeFile(PROPOSED, JSON.stringify(proposals, null, 2) + '\n', 'utf8');
      ok += 1;
    } catch (err) {
      console.log(`FAILED: ${err.message}`);
    }
  }

  console.log(`\nDone: ${ok}/${targets.length} companies, ${items} evidence items -> ${PROPOSED}`);

  if (APPLY) {
    await mergeProposalsIntoLive(live, proposals);
  } else {
    console.log('Proposals only. Review, then merge with RESEARCH_MERGE_ONLY=1 (or re-run with RESEARCH_APPLY=1).');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
