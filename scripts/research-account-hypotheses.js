// Research and fill source-backed account problem hypotheses.
//
// Every saved row has four explicit parts:
//   Observed public fact -> falsifiable problem -> bounded help -> why reply.
// Official company sources are preferred and the supporting claims/URLs are
// stored on the pursuit as evidence. The job is resume-safe: by default it only
// selects accounts whose company hypothesis and pursuit problem are both blank.
//
// Usage:
//   node scripts/research-account-hypotheses.js
//   node scripts/research-account-hypotheses.js --campaign wapahki --limit 10
//   node scripts/research-account-hypotheses.js --ids 1,2,3 --rewrite
//   node scripts/research-account-hypotheses.js --dry-run
import { db } from '../src/db.js';
import { runCodex } from '../src/codex.js';

const args = process.argv.slice(2);
const flagValue = (flag, fallback = '') => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : fallback;
};
const campaign = flagValue('--campaign');
const ids = new Set(
  flagValue('--ids')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map(Number)
    .filter(Number.isInteger),
);
const limit = Math.max(0, Number(flagValue('--limit', '0')) || 0);
const batchSize = Math.max(1, Number(flagValue('--batch', '5')) || 5);
const concurrency = Math.max(1, Number(flagValue('--concurrency', '3')) || 3);
const rewrite = args.includes('--rewrite');
const dryRun = args.includes('--dry-run');
const model = process.env.HYPOTHESIS_MODEL || process.env.CODEX_MODEL || 'gpt-5.6-terra';
const reasoning = process.env.HYPOTHESIS_REASONING || 'medium';

const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['results'],
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'company_id',
          'observed_fact',
          'problem_to_validate',
          'bounded_help',
          'why_reply',
          'evidence',
          'confidence',
        ],
        properties: {
          company_id: { type: 'integer' },
          observed_fact: { type: 'string' },
          problem_to_validate: { type: 'string' },
          bounded_help: { type: 'string' },
          why_reply: { type: 'string' },
          evidence: {
            type: 'array',
            minItems: 1,
            maxItems: 3,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['claim', 'url', 'observed_at'],
              properties: {
                claim: { type: 'string' },
                url: { type: 'string' },
                observed_at: { type: ['string', 'null'] },
              },
            },
          },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
      },
    },
  },
};

const offerBoundaries = {
  wapahki: [
    'Wapahki is early-market. It explores one bounded repetitive packing, palletizing, transfer, or material-handling task in a high-mix operation.',
    'The proposed first step is a 20-minute workflow discussion and a rough task sketch. A later pilot keeps exceptions and quality or safety judgment with people.',
    'Do not claim installations, customers, savings, a current automation project, or that a task is automatable before seeing it.',
  ].join(' '),
  gnk: [
    'GnK turns a recurring decision currently assembled from messy operational data, documents, spreadsheets, and handoffs into a reviewable decision system in a bounded 30–90 day engagement.',
    'Name the actor, repeated decision, changing inputs, and concrete output. It may be an internal tool or a bounded product capability, but never a generic AI transformation.',
    'Do not claim access to internal data, existing customers, results, or savings. The first conversation validates the workflow and one useful sample output.',
  ].join(' '),
  outagehub: [
    'OutageHub turns public outage data from supported Canadian utilities into a normalized, location-matched feed for a company’s locations or field-service territory.',
    'Its narrow value is adding utility-reported power context to an existing incident. It does not prove site impact, predict outages, replace telemetry or another source of truth, rank individual claims, or guarantee national or real-time coverage.',
    'The first conversation validates how one current investigation, prioritization, escalation, dispatch or wait decision is handled and whether external utility information changes it.',
  ].join(' '),
};
offerBoundaries.outage = offerBoundaries.outagehub;

function safeJson(value, fallback = {}) {
  try {
    const parsed = value ? JSON.parse(value) : fallback;
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch { return fallback; }
}

const where = ['c.archived_at IS NULL'];
const params = [];
if (!rewrite) {
  where.push("COALESCE(NULLIF(TRIM(pu.problem),''), NULLIF(TRIM(c.hypothesis),'')) IS NULL");
}
if (campaign) {
  where.push('c.campaign=?');
  params.push(campaign);
}
let accounts = db.prepare(`
  SELECT c.id company_id, c.name company, c.campaign, c.product, c.website,
         c.domain, c.industry, c.city, c.location, c.notes, c.hypothesis,
         pu.id pursuit_id, pu.problem, pu.evidence
  FROM companies c
  LEFT JOIN pursuits pu ON pu.company_id=c.id
  WHERE ${where.join(' AND ')}
  ORDER BY CASE c.campaign
    WHEN 'wapahki' THEN 0 WHEN 'gnk' THEN 1
    WHEN 'outagehub' THEN 2 WHEN 'outage' THEN 3 ELSE 4 END,
    CASE lower(c.tier) WHEN 'easy' THEN 0 WHEN 'medium' THEN 1 WHEN 'hard' THEN 2 ELSE 3 END,
    c.name COLLATE NOCASE
`).all(...params);
if (ids.size) accounts = accounts.filter((account) => ids.has(account.company_id));
if (limit) accounts = accounts.slice(0, limit);

const contactsForCompany = db.prepare(`
  SELECT id, name, title, role_type, relevance_score, relevance_reason, sales_brief
  FROM people
  WHERE company_id=? AND COALESCE(lifecycle_status,'active')!='archived'
  ORDER BY (relevance_score IS NULL), relevance_score DESC, id
  LIMIT 3
`);
const outageContextForCompany = db.prepare(`
  SELECT t.segment, t.why_them, t.contact_title,
         p.one_liner, p.workflow_today, p.why_expensive, p.outagehub_solution,
         p.data_signal, p.measurable, p.sources
  FROM outagehub_targets t
  JOIN outagehub_problems p ON p.id=t.problem_id
  WHERE lower(trim(t.company))=lower(trim(?))
  ORDER BY p.score DESC, t.id
  LIMIT 3
`);

function compact(value, max = 5000) {
  return String(value || '').replace(/\u0000/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function accountContext(account) {
  const notes = safeJson(account.notes, {});
  const contacts = contactsForCompany.all(account.company_id).map((person) => {
    const brief = safeJson(person.sales_brief, {});
    return {
      person_id: person.id,
      name: person.name,
      title: person.title,
      existing_role_reason_not_evidence: compact(person.relevance_reason, 1200),
      previous_private_rehearsal_not_evidence: {
        role_route: brief.role_route || null,
        skeptical_question: brief.skeptical_question || null,
        proof_boundary: brief.proof_boundary || null,
        next_step: brief.next_step || null,
      },
    };
  });
  const outageContext = outageContextForCompany.all(account.company).map((item) => ({
    ...item,
    sources: safeJson(item.sources, []),
  }));
  return {
    company_id: account.company_id,
    company: account.company,
    campaign: account.campaign,
    website: account.website || (account.domain ? `https://${account.domain}` : null),
    industry_or_segment: account.industry || null,
    location: account.city || account.location || null,
    offer_boundary: offerBoundaries[account.campaign] || offerBoundaries.gnk,
    existing_research_to_verify: {
      what_they_do: notes.what_they_do || null,
      theme: notes.theme || null,
      defensible_problem: notes.defensible_problem || null,
      proposed_project: notes.ai_project || null,
      why_meaningful: notes.why_meaningful || null,
      evidence_source: notes.evidence_source || null,
      market_signal: notes.market_signal || null,
      outage_problem_records: outageContext,
    },
    strongest_available_contacts: contacts,
  };
}

function prompt(rows) {
  return [
    'Research account problem hypotheses for Andrew Gordienko’s CRM.',
    'Browse the web for EVERY supplied company before answering. Prefer the company’s own website, annual report, investor page, official newsroom, product documentation, job page, or a regulator/government source. Use a reputable direct source only when no official source covers the needed fact.',
    'For every company return exactly one result. The output is private CRM strategy, not buyer-facing copy.',
    '',
    'EVIDENCE LAW',
    '- observed_fact must be a conservative paraphrase of the cited page and must not claim an internal pain, budget, manual process, priority, or project unless the page says so.',
    '- evidence must contain 1–3 direct HTTP(S) URLs and exact conservative claims. Do not cite a search-results page, database profile, social-network profile, or generic industry article when an official page is available.',
    '- existing_research_to_verify, old role reasons, contact titles, and private briefs are leads, not evidence. Open the supplied evidence URL before relying on it.',
    '',
    'HYPOTHESIS LAW',
    '- problem_to_validate must be a falsifiable, role-owned workflow hypothesis derived from the observed business context. State uncertainty plainly with “may”, “could”, or “the question is whether”. Do not repeat the observed fact.',
    '- bounded_help must say exactly what actor would use what concrete output to make what repeated decision. Stay inside the supplied offer_boundary. No generic transformation, platform, AI, visibility, optimization, or efficiency language without naming the workflow and output.',
    '- why_reply must name the strongest supplied role (or an honest role to seek if no contacts exist), what that role knows or owns, and why correcting the hypothesis is worth a short reply. Do not claim that seniority alone makes someone likely to reply.',
    '- Keep each of observed_fact, problem_to_validate, bounded_help, and why_reply to 12–35 words. Use plain English and no sales CTA.',
    '- confidence reflects the evidence-to-hypothesis fit, not enthusiasm. Low confidence is acceptable and should produce a narrower routing or discovery hypothesis.',
    '',
    'ACCOUNT CONTEXT',
    JSON.stringify(rows.map(accountContext), null, 2),
    '',
    'Return one result for every company_id and no other company IDs.',
  ].join('\n');
}

function validate(result, account) {
  const errors = [];
  if (!result || Number(result.company_id) !== account.company_id) errors.push('wrong company_id');
  for (const key of ['observed_fact', 'problem_to_validate', 'bounded_help', 'why_reply']) {
    const words = compact(result?.[key]).split(/\s+/).filter(Boolean).length;
    if (words < 8 || words > 55) errors.push(`${key} has ${words} words`);
  }
  if (!/\b(?:may|might|could|question is whether|hypothesis|to validate)\b/i.test(result?.problem_to_validate || '')) {
    errors.push('problem is not calibrated as a hypothesis');
  }
  if (!Array.isArray(result?.evidence) || !result.evidence.length) errors.push('missing evidence');
  for (const item of result?.evidence || []) {
    if (!/^https?:\/\//i.test(item.url || '')) errors.push('evidence has no direct URL');
    if (compact(item.claim).split(/\s+/).length < 5) errors.push('evidence claim is too thin');
  }
  return [...new Set(errors)];
}

function combinedHypothesis(result) {
  return [
    `Observed: ${compact(result.observed_fact, 600)}`,
    `Hypothesis to validate: ${compact(result.problem_to_validate, 700)}`,
    `Help: ${compact(result.bounded_help, 700)}`,
    `Why reply: ${compact(result.why_reply, 700)}`,
  ].join(' ');
}

function save(account, result) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const hypothesis = combinedHypothesis(result);
    db.prepare('UPDATE companies SET hypothesis=? WHERE id=?').run(hypothesis, account.company_id);
    const previousEvidence = safeJson(account.evidence, []);
    const byUrl = new Map();
    for (const item of [...previousEvidence, ...result.evidence]) {
      const url = item.url || item.source_url;
      if (!url) continue;
      byUrl.set(url, {
        claim: item.claim || item.fact || item.statement || result.observed_fact,
        url,
        observed_at: item.observed_at || item.source_date || null,
      });
    }
    db.prepare(`
      UPDATE pursuits
      SET problem=?, evidence=?,
          offer=CASE WHEN offer IS NULL OR trim(offer)='' THEN ? ELSE offer END,
          value_to_partner=CASE WHEN value_to_partner IS NULL OR trim(value_to_partner)='' THEN ? ELSE value_to_partner END,
          approval_status='needs_review', status='draft', updated_at=datetime('now')
      WHERE company_id=?
    `).run(
      hypothesis,
      JSON.stringify([...byUrl.values()]),
      compact(result.bounded_help, 700),
      compact(result.why_reply, 700),
      account.company_id,
    );
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

const units = [];
for (let index = 0; index < accounts.length; index += batchSize) {
  units.push(accounts.slice(index, index + batchSize));
}

console.log(
  `account hypothesis research: ${accounts.length} accounts in ${units.length} units `
  + `| ${model}/${reasoning} | batch=${batchSize} | concurrency=${concurrency} | dry_run=${dryRun}`,
);

let cursor = 0;
let completed = 0;
let written = 0;
let failed = 0;

async function researchUnit(unit) {
  let pending = [...unit];
  const accepted = new Map();
  for (let attempt = 1; attempt <= 2 && pending.length; attempt += 1) {
    const output = await runCodex({
      prompt: prompt(pending),
      schema,
      model,
      reasoning,
      webSearch: true,
      timeoutMs: Number(process.env.CODEX_TIMEOUT_MS) || 720_000,
    });
    for (const result of output.results || []) {
      const account = unit.find((item) => item.company_id === Number(result.company_id));
      if (!account) continue;
      const errors = validate(result, account);
      if (!errors.length) accepted.set(account.company_id, result);
      else console.log(`    retry ${account.company}: ${errors.join('; ')}`);
    }
    pending = pending.filter((account) => !accepted.has(account.company_id));
  }
  return { accepted, failed: unit.filter((account) => !accepted.has(account.company_id)) };
}

async function worker() {
  while (true) {
    const index = cursor;
    cursor += 1;
    if (index >= units.length) return;
    const unit = units[index];
    try {
      const researched = await researchUnit(unit);
      for (const account of unit) {
        const result = researched.accepted.get(account.company_id);
        if (!result) continue;
        if (dryRun) {
          console.log(`  [dry] ${account.company}: ${combinedHypothesis(result)}`);
        } else {
          save(account, result);
        }
        written += 1;
      }
      failed += researched.failed.length;
      for (const account of researched.failed) console.log(`  failed ${account.company}: no valid sourced result`);
    } catch (error) {
      failed += unit.length;
      console.log(`  failed unit [${unit.map((item) => item.company_id).join(',')}]: ${String(error.message).split('\n')[0]}`);
    }
    completed += 1;
    console.log(`${completed}/${units.length} units | wrote ${written} | failed ${failed}`);
  }
}

await Promise.all(
  Array.from({ length: Math.min(concurrency, units.length || 1) }, () => worker()),
);
console.log(`Done. Wrote ${written} source-backed hypotheses; ${failed} failed.`);
if (failed) process.exitCode = 1;
