// Build one source-backed commercial hypothesis for every selected OutageHub
// account before sequence writing. The saved model mirrors the GnK CRM card:
// costly problem, economic case, cost basis, potential upside, API change,
// commercial entry, and evidence / fit.
//
//   node scripts/research-outagehub-commercial-hypotheses.js --dry-run
//   node scripts/research-outagehub-commercial-hypotheses.js --limit 3
//   node scripts/research-outagehub-commercial-hypotheses.js --ids 132,143 --rewrite
import { db } from '../src/db.js';
import { runCodex } from '../src/codex.js';
import { validateIllustrativeCostAnalysis } from '../src/cost-analysis.js';
import { getProduct } from '../src/products.js';

const args = process.argv.slice(2);
const valueAfter = (flag, fallback = '') => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : fallback;
};
const ids = new Set(
  valueAfter('--ids')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map(Number)
    .filter(Number.isInteger),
);
const limit = Math.max(0, Number(valueAfter('--limit', '0')) || 0);
const batchSize = Math.min(4, Math.max(1, Number(valueAfter('--batch', '3')) || 3));
const concurrency = Math.min(3, Math.max(1, Number(valueAfter('--concurrency', '2')) || 2));
const rewrite = args.includes('--rewrite');
const dryRun = args.includes('--dry-run');
const model = process.env.OHUB_HYPOTHESIS_MODEL || process.env.CODEX_MODEL || 'gpt-5.6-sol';
const reasoning = process.env.OHUB_HYPOTHESIS_REASONING || 'high';
const product = getProduct('outage');

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
          'company_id', 'title', 'costly_problem', 'economic_case', 'cost_basis',
          'potential_upside', 'api_change', 'commercial_entry', 'evidence_fit', 'evidence',
        ],
        properties: {
          company_id: { type: 'integer' },
          title: { type: 'string' },
          costly_problem: { type: 'string' },
          economic_case: { type: 'string' },
          cost_basis: { type: 'string' },
          potential_upside: { type: 'string' },
          api_change: { type: 'string' },
          commercial_entry: { type: 'string' },
          evidence_fit: { type: 'string' },
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
        },
      },
    },
  },
};

const accounts = db.prepare(`
  SELECT c.id company_id, c.name company, c.website, c.domain, c.industry,
         c.city, c.location, c.tier, c.lead_score, c.notes, c.hypothesis,
         pu.problem, pu.evidence, pu.consequence, pu.cost_model, pu.offer,
         pu.desired_commitment, pu.commercial_path,
         (SELECT json_group_array(json_object(
            'person_id', p.id, 'name', p.name, 'title', p.title,
            'role_type', p.role_type, 'relevance_score', p.relevance_score,
            'relevance_reason', p.relevance_reason
          ))
          FROM people p
          WHERE p.company_id=c.id AND p.email LIKE '%@%'
            AND COALESCE(p.lifecycle_status, 'active')!='archived') contacts
  FROM companies c
  JOIN pursuits pu ON pu.company_id=c.id
  WHERE c.campaign='outagehub' AND c.archived_at IS NULL
  ORDER BY CASE lower(c.tier)
    WHEN 'easy' THEN 0 WHEN 'medium' THEN 1 WHEN 'hard' THEN 2 ELSE 3 END,
    (c.lead_score IS NULL), c.lead_score DESC, c.id
`).all().filter((account) => {
  if (ids.size && !ids.has(account.company_id)) return false;
  if (rewrite) return true;
  return !String(account.cost_model || '').includes('Economic case:')
    || !String(account.desired_commitment || '').trim();
}).slice(0, limit || undefined);

function safeJson(value, fallback = null) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

function compact(value, max = 5000) {
  return String(value || '').replace(/\u0000/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function accountContext(account) {
  return {
    company_id: account.company_id,
    company: account.company,
    website: account.website || (account.domain ? `https://${account.domain}` : null),
    industry: account.industry || null,
    location: account.city || account.location || null,
    segment_and_existing_evidence_leads_to_verify: compact(account.notes, 5000),
    existing_hypothesis_not_evidence: compact(account.hypothesis, 2500),
    existing_private_model_not_evidence: {
      problem: compact(account.problem, 1800),
      consequence: compact(account.consequence, 1200),
      cost_model: compact(account.cost_model, 1800),
      offer: compact(account.offer, 1200),
    },
    candidate_contacts: (safeJson(account.contacts, []) || [])
      .sort((left, right) => Number(right.relevance_score || 0) - Number(left.relevance_score || 0)),
  };
}

function prompt(batch, feedback = null) {
  return [
    'Research a private commercial hypothesis for every supplied OutageHub account.',
    'Browse the web for every company. Prefer the company website, filings, regulator or government sources, and direct official incident or service pages. Return exactly one result per company_id.',
    '',
    'COMMERCIAL MODEL',
    '- title is a plain 3-9 word name for one costly operational decision, not a product name.',
    '- costly_problem is one falsifiable, role-owned hypothesis. Name the existing decision, why separate public utility information may create handling effort or leave classification incomplete, and the measurable consequence. Use may, could, or “the question is whether”; never present a private workflow as fact.',
    '- economic_case is a CAD annual range derived from the cost basis. It MUST say “illustrative category model, not a verified cost at [Company]”.',
    '- cost_basis shows a visible equation with rounded assumed inputs and an output. Use “Assume” or “If”, include x or ×, distinguish recurring burden from contingent exposure, and never treat all exposure as recoverable savings.',
    '- potential_upside is a conservative CAD annual range smaller than the modeled burden and explicitly says it is a potential measured upside to validate. Its upper bound must exceed CAD $75k before a substantial first-year deployment is commercially coherent. If a defensible assumption model cannot clear that bar, narrow the account hypothesis rather than inventing value.',
    '- api_change names the public utility event, location match or shared-cause classification returned by OutageHub, the existing actor and system or central view that receives it, and the one decision it may change. Do not force an API when the likely first product is a central operations view.',
    `- commercial_entry must use the configured ${product.pilot_range} range as CAD $40k–$75k and call it a first-year deployment planning range, not a small pilot. Include historical validation, the agreed incident-system integration or central view, supported-utility coverage, support, SLA, 12-month licence, and agreed measurements. State that final scope follows discovery.`,
    '- evidence_fit conservatively summarizes why the public footprint makes the hypothesis testable. It must not claim the private cost, workflow, budget, or need is verified.',
    '',
    'OFFER AND EVIDENCE BOUNDARY',
    '- OutageHub turns public outage data from supported Canadian utilities into normalized, location-matched context. It does not prove that a site was affected or replace telemetry.',
    '- Choose one use case per account. Never mix live triage, customer communications and post-incident review in one model.',
    '- The strongest network hypothesis is whether a public utility event changes how several coincident alarms are classified, not early detection.',
    '- Never claim N+1 diesels, colocation risk, detection before tickets/calls/alarms, buyer surprise, guaranteed coverage, or a lead-time advantage unless a direct source proves the exact account-specific fact. Even with a source, do not use those claims as the default value proposition.',
    '- Public portfolio size may support scale. It does not prove how many incidents occur, how long staff spend, what downtime costs, or that the proposed savings are achievable; those remain explicit assumptions.',
    '- Every evidence item needs a direct HTTP(S) URL, a conservative factual claim, and a date/year when available.',
    '',
    'OUTAGEHUB PRODUCT',
    `Outcome: ${product.outcome}`,
    `Positioning to refine, not copy blindly: ${product.positioning}`,
    '',
    'ACCOUNTS',
    JSON.stringify(batch.map(accountContext), null, 2),
    ...(feedback ? [
      '',
      'PREVIOUS ATTEMPT TO REPAIR',
      'Rewrite every result in this batch. Resolve every deterministic error without dropping a company or weakening evidence boundaries.',
      JSON.stringify(feedback, null, 2),
    ] : []),
    '',
    'Return only the structured JSON requested by the schema.',
  ].join('\n');
}

function validate(result, account) {
  const errors = [];
  if (Number(result?.company_id) !== account.company_id) errors.push('wrong company_id');
  for (const field of [
    'title', 'costly_problem', 'economic_case', 'cost_basis', 'potential_upside',
    'api_change', 'commercial_entry', 'evidence_fit',
  ]) {
    if (!compact(result?.[field])) errors.push(`${field} is empty`);
  }
  if (!/\b(?:may|might|could|question is whether|hypothesis)\b/i.test(result?.costly_problem || '')) {
    errors.push('costly_problem is not stated as a hypothesis');
  }
  const recognizableCompany = account.company.split(/[(/—]/)[0].trim().split(/\s+/).slice(0, 2).join(' ');
  if (!/\bCAD\s*\$/i.test(result?.economic_case || '')
    || !/illustrative category model/i.test(result?.economic_case || '')
    || !new RegExp(`not a verified cost (?:at|for) [^.\\n]*${recognizableCompany.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(result?.economic_case || '')) {
    errors.push('economic_case must be a CAD range explicitly marked illustrative and unverified for this company');
  }
  for (const error of validateIllustrativeCostAnalysis(
    `${result?.cost_basis || ''} ${result?.economic_case || ''}`,
    { requireCalibration: false },
  )) errors.push(error);
  if (!/\bpotential\b[^.\n]{0,45}\b(?:upside|savings?)\b/i.test(result?.potential_upside || '')) {
    errors.push('potential_upside is not visibly framed as potential');
  }
  const scale = (suffix) => String(suffix || '').toLowerCase() === 'm'
    ? 1_000_000
    : String(suffix || '').toLowerCase() === 'k' ? 1_000 : 1;
  const rangeValues = (value) => {
    const match = String(value || '').match(/CAD\s*\$\s*([\d,.]+)\s*([km])?\s*[–-]\s*\$?\s*([\d,.]+)\s*([km])?/i);
    if (!match) return null;
    return [
      Number(match[1].replace(/,/g, '')) * scale(match[2]),
      Number(match[3].replace(/,/g, '')) * scale(match[4] || match[2]),
    ];
  };
  const economicRange = rangeValues(result?.economic_case);
  const upsideRange = rangeValues(result?.potential_upside);
  if (!upsideRange || upsideRange[1] < 75_000) {
    errors.push('potential_upside does not make a CAD $40k–$75k first-year deployment commercially coherent');
  }
  if (economicRange && upsideRange && upsideRange[1] >= economicRange[1]) {
    errors.push('potential_upside must remain below the modeled annual burden');
  }
  if (!/\bCAD\s*\$40k[^\n]{0,30}\$75k\b/i.test(result?.commercial_entry || '')
    || !/first[- ]year deployment/i.test(result?.commercial_entry || '')
    || !/12[- ]month licen[cs]e/i.test(result?.commercial_entry || '')) {
    errors.push('commercial_entry must use the CAD $40k–$75k first-year deployment range and include a 12-month licence');
  }
  if (!/\b(?:API|feed|central (?:operations )?view)\b/i.test(result?.api_change || '')) {
    errors.push('api_change must identify the OutageHub delivery path or central view');
  }
  const forbidden = /\b(?:N\s*\+\s*1 diesels?|colocation risk|before (?:tickets?|calls?|alarms?) arrive|detect(?:s|ed|ing)? (?:the )?outage first|guaranteed coverage|lead[- ]time advantage)\b/i;
  if (forbidden.test(Object.values(result || {}).filter((value) => typeof value === 'string').join('\n'))) {
    errors.push('commercial hypothesis uses a forbidden unsupported claim');
  }
  if (!Array.isArray(result?.evidence) || !result.evidence.length) errors.push('missing evidence');
  for (const item of result?.evidence || []) {
    if (!/^https?:\/\/\S+$/i.test(item.url || '')) errors.push('evidence has no direct URL');
    if (compact(item.claim).split(/\s+/).length < 6) errors.push('evidence claim is too thin');
  }
  return [...new Set(errors)];
}

function saveBatch(batch, results) {
  const byId = new Map(results.map((result) => [Number(result.company_id), result]));
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const account of batch) {
      const result = byId.get(account.company_id);
      const evidence = JSON.stringify(result.evidence.map((item) => ({
        claim: compact(item.claim, 1200),
        url: item.url,
        observed_at: item.observed_at || null,
      })));
      const hypothesis = [
        `Observed: ${compact(result.evidence_fit, 900)}`,
        `Hypothesis to validate: ${compact(result.costly_problem, 1200)}`,
        `Help: ${compact(result.api_change, 1000)}`,
        `Why reply: The selected operational owner can confirm whether this external information changes the named decision or whether the existing system is already enough.`,
      ].join(' ');
      db.prepare('UPDATE companies SET hypothesis=? WHERE id=?').run(hypothesis, account.company_id);
      db.prepare(`
        UPDATE pursuits
        SET problem=?, evidence=?, consequence=?, cost_model=?, cost_confidence='illustrative',
            offer=?, narrative=?, desired_commitment=?, commercial_path=?, next_goal=?,
            approval_status='needs_review', status='draft', updated_at=datetime('now')
        WHERE company_id=?
      `).run(
        compact(result.costly_problem, 2000),
        evidence,
        compact(result.potential_upside, 1200),
        `Economic case: ${compact(result.economic_case, 1200)}\nCost basis: ${compact(result.cost_basis, 1800)}`,
        compact(result.api_change, 1600),
        `${compact(result.title, 240)}. ${compact(result.evidence_fit, 1800)}`,
        compact(result.commercial_entry, 1200),
        '20-minute decision validation → bounded historical validation or limited production test → first-year deployment with integration, support, SLA and a 12-month licence if the evidence is strong.',
        'Validate the named decision, current source of truth, supported-utility requirements, event and location volume, integration owner, success measure, and whether a historical validation or limited production test is warranted.',
        account.company_id,
      );
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

const batches = [];
for (let index = 0; index < accounts.length; index += batchSize) {
  batches.push(accounts.slice(index, index + batchSize));
}
console.log(`OutageHub commercial hypotheses: ${accounts.length} accounts | ${batches.length} batches | ${model}/${reasoning} | rewrite=${rewrite}`);
if (dryRun) {
  if (batches.length) console.log(prompt(batches[0]));
  else console.log('No eligible accounts.');
  process.exit(0);
}

let cursor = 0;
let completed = 0;
let written = 0;
let failed = 0;
async function worker() {
  while (cursor < batches.length) {
    const batch = batches[cursor++];
    try {
      let output = null;
      let validationFailures = null;
      for (let attempt = 1; attempt <= 2; attempt++) {
        output = await runCodex({
          prompt: prompt(batch, validationFailures ? {
            errors: validationFailures,
            prior_results: output.results,
          } : null),
          schema,
          model,
          reasoning,
          webSearch: true,
          timeoutMs: Number(process.env.OHUB_HYPOTHESIS_TIMEOUT_MS) || 420_000,
        });
        const expected = batch.map((account) => account.company_id).sort((a, b) => a - b);
        const actual = (output.results || []).map((result) => Number(result.company_id)).sort((a, b) => a - b);
        validationFailures = [];
        if (expected.join(',') !== actual.join(',') || new Set(actual).size !== actual.length) {
          validationFailures.push({
            errors: [`result company set must be exactly ${expected.join(',')} (received ${actual.join(',')})`],
          });
        } else {
          validationFailures.push(...batch.flatMap((account) => {
            const result = output.results.find((item) => Number(item.company_id) === account.company_id);
            const errors = validate(result, account);
            return errors.length ? [{ company_id: account.company_id, errors }] : [];
          }));
        }
        if (!validationFailures.length) break;
      }
      if (validationFailures.length) {
        throw new Error(`${JSON.stringify(validationFailures)} output=${JSON.stringify(output.results)}`);
      }
      saveBatch(batch, output.results);
      written += batch.length;
    } catch (error) {
      failed += batch.length;
      console.log(`  failed [${batch.map((account) => account.company_id).join(',')}]: ${String(error.message).split('\n')[0]}`);
    }
    completed++;
    console.log(`  ${completed}/${batches.length} batches | wrote ${written} | failed ${failed}`);
  }
}
await Promise.all(Array.from({ length: concurrency }, () => worker()));
console.log(`Done. Stored ${written} OutageHub commercial hypotheses; ${failed} accounts failed closed.`);
if (failed) process.exitCode = 1;
