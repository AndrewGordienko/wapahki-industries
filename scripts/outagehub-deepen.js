// Deepen thin OutageHub problems.
//
// The discovery agent generates problems and 3–6 buyers each, but some problems
// come back thin (1 company). This pass tops those up: for each problem below a
// company floor, it runs one Codex web-search call to find MORE real named
// Canadian companies + a buyer contact each + a drafted first-touch email in the
// OutageHub voice, EXCLUDING companies already on the problem. Upserts into
// outagehub_targets (dedup by company) and re-mirrors data/outagehub-problems.json.
//
//   node scripts/outagehub-deepen.js               # top up every problem with < 4 companies
//   node scripts/outagehub-deepen.js --floor 5 --add 4
//   node scripts/outagehub-deepen.js --dry-run
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCodex } from '../src/codex.js';
import { listOutagehubProblems, upsertTarget } from '../src/outagehub.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const MIRROR = join(root, 'data', 'outagehub-problems.json');
const MODEL = process.env.OUTAGEHUB_MODEL || process.env.CODEX_MODEL || 'gpt-5.6-sol';
const REASONING = process.env.OUTAGEHUB_REASONING || 'medium';
const CALL_TIMEOUT_MS = Number(process.env.OUTAGEHUB_TIMEOUT_MS) || 480_000;

const args = process.argv.slice(2);
const flag = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def; };
const FLOOR = Number(flag('floor', 4));      // top up problems with fewer than this many companies
const ADD = Number(flag('add', 4));          // how many new companies to request per thin problem
const CONCURRENCY = Number(flag('concurrency', 2));
const DRY_RUN = args.includes('--dry-run');
const log = (m) => console.log(`[deepen] ${m}`);

const sharedRules = readFileSync(join(root, 'playbooks', '_shared.md'), 'utf8');
const playbook = readFileSync(join(root, 'playbooks', 'outagehub.md'), 'utf8');
const PRODUCT = `OutageHub collects public outage updates from Canadian electricity utilities and records which area was reported out and when. A person can watch the record on a map, a customer's software can read it through an API, and an SMS/email layer can notify an operator when a tracked area or address is included in a public utility report. This is early: no guaranteed national coverage, instant detection, lead-time advantage or customer outcomes — the honest offer is one real public utility record for an area they serve.`;

const str = { type: 'string' };
const nstr = { type: ['string', 'null'] };
const targetsSchema = {
  type: 'object', additionalProperties: false, required: ['targets'],
  properties: {
    targets: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['company', 'domain', 'hq', 'segment', 'why_them', 'contact_name', 'contact_title', 'contact_email', 'email_subject', 'email_body'],
        properties: {
          company: str, domain: str, hq: str, segment: str, why_them: str,
          contact_name: str, contact_title: str, contact_email: nstr, email_subject: str, email_body: str,
        },
      },
    },
  },
};

function prompt(p, exclude) {
  return `You are finding MORE real Canadian companies + buyers for ONE existing OutageHub problem, and writing each a first cold email.

WHAT OUTAGEHUB IS
${PRODUCT}

THE PROBLEM (already researched — do not restate it, just find more buyers who have it)
title: ${p.title}
sector: ${p.sector} · region: ${p.region}
one_liner: ${p.one_liner}
who_has_it: ${p.who_has_it}
workflow_today: ${p.workflow_today}
why_expensive: ${p.why_expensive}
outagehub_solution: ${p.outagehub_solution}
data_signal: ${p.data_signal}
buyer_roles: ${(p.buyer_roles || []).join(', ') || '(use your judgement)'}

ALREADY ON THIS PROBLEM — do NOT return any of these companies again:
${exclude.length ? exclude.map((c) => `- ${c}`).join('\n') : '- (none)'}

Use web search to ground every company in reality. Return ${ADD} NEW, DISTINCT, real named Canadian organisations that plausibly have THIS problem. For each:
- company, domain (best public domain), hq (city, province), segment (one line).
- why_them: the specific, verifiable reason this company has this outage blind spot (footprint, SLA, cold chain, service area, exposure). Ground it; do not invent facts.
- contact_name: a real named person in a fitting buyer role if web search finds one, else the best-fit role title.
- contact_title: their title. contact_email: a real/clearly-patterned work email only if confident, else null.
- email_subject + email_body: the first-touch cold email (rules below).

EMAIL RULES — follow the OutageHub playbook exactly:
${playbook}

SHARED HOUSE RULES:
${sharedRules}

Each email: open on the recipient's specific outage-exposed workflow (from why_them), explain OutageHub in one plain sentence, offer the real public utility record for ONE area they serve, and where it fits the role mention OutageHub can also send an SMS/email when a tracked area is reported out. Ask for ~20 minutes to compare a real record with how their team sees the same event today. 90–160 words, greeting "Hi <First>," (or "Hello," if only a role), then:

Best,
Andrew Gordienko
OutageHub

Never promise guaranteed coverage, instant detection, a lead-time advantage, or customer results. Never blame the recipient for a past outage. Never say "AI". Return only the structured object.`;
}

async function pool(items, size, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() { while (next < items.length) { const i = next++; results[i] = await worker(items[i], i); } }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, run));
  return results;
}

function normalizeEmail(subject, body) {
  let out = String(body || '').trim();
  if (!/outagehub\s*$/i.test(out)) out += '\n\nBest,\nAndrew Gordienko\nOutageHub';
  return { subject: String(subject || '').trim(), body: out };
}

async function main() {
  const thin = listOutagehubProblems().filter((p) => (p.targets || []).length < FLOOR);
  log(`${thin.length} problems below ${FLOOR} companies · requesting ${ADD} more each · model ${MODEL}/${REASONING}`);
  for (const p of thin) log(`  · ${p.title} (${(p.targets || []).length} now)`);
  if (DRY_RUN) { log('dry run — no research calls made.'); return; }
  if (!thin.length) { log('nothing to deepen.'); return; }

  let added = 0;
  await pool(thin, CONCURRENCY, async (p) => {
    const exclude = (p.targets || []).map((t) => t.company);
    try {
      const out = await runCodex({ prompt: prompt(p, exclude), schema: targetsSchema, model: MODEL, reasoning: REASONING, webSearch: true, timeoutMs: CALL_TIMEOUT_MS, cwd: root });
      let n = 0;
      for (const t of out.targets || []) {
        if (exclude.some((c) => c.toLowerCase() === String(t.company).toLowerCase())) continue;
        const em = normalizeEmail(t.email_subject, t.email_body);
        upsertTarget({
          problem_id: p.id, company: t.company, domain: t.domain, hq: t.hq, segment: t.segment,
          why_them: t.why_them, contact_name: t.contact_name, contact_title: t.contact_title,
          contact_email: t.contact_email || null, email_subject: em.subject, email_body: em.body, status: 'drafted',
        });
        n++; added++;
      }
      log(`  ✓ ${p.title} → +${n} companies`);
    } catch (e) {
      log(`  ! ${p.title}: ${e.message.split('\n')[0]}`);
    }
  });

  const all = listOutagehubProblems();
  writeFileSync(MIRROR, JSON.stringify(all, null, 2));
  log(`done. added ${added} companies. board now ${all.length} problems / ${all.reduce((n, p) => n + (p.targets || []).length, 0)} companies.`);
}

main().catch((e) => { log(`fatal: ${e.message}`); process.exitCode = 1; });
