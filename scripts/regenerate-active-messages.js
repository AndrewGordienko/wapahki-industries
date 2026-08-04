// Regenerate the in-use T1/T2 pair and persist the private sales rehearsal.
//
// This is the compact bulk path for contacts who already have both draft
// messages. It does not expand the outreach set and never touches approved or
// sent copy.
//
//   node scripts/regenerate-active-messages.js --campaign wapahki --limit 4
//   node scripts/regenerate-active-messages.js --campaign wapahki,gnk,outagehub --batch 4
//   node scripts/regenerate-active-messages.js --ids 906,907
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCodex } from '../src/codex.js';
import { db, replaceTouch, updatePerson } from '../src/db.js';
import {
  contentOnly,
  signatureFor,
  validateTouch2,
  wordCount,
} from '../src/touch2-quality.js';
import {
  looksLikeIllustrativeCostAnalysis,
  validateIllustrativeCostAnalysis,
} from '../src/cost-analysis.js';
import { normalizeSubject } from '../src/subject-lines.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const valueAfter = (flag, fallback = null) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : fallback;
};
const campaigns = String(valueAfter('--campaign', 'wapahki,gnk,outagehub'))
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const allowedCampaigns = new Set(['wapahki', 'gnk', 'outagehub']);
for (const campaign of campaigns) {
  if (!allowedCampaigns.has(campaign)) throw new Error(`Unsupported campaign: ${campaign}`);
}
const ids = new Set(
  String(valueAfter('--ids', ''))
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map(Number)
    .filter(Number.isInteger),
);
const offset = Math.max(0, Number(valueAfter('--offset', '0')) || 0);
const limit = Math.max(0, Number(valueAfter('--limit', '0')) || 0);
const batchSize = Math.max(1, Number(valueAfter('--batch', '4')) || 4);
const concurrency = Math.max(1, Number(valueAfter('--concurrency', '1')) || 1);
const model = process.env.REGEN_MODEL || process.env.CODEX_MODEL || 'gpt-5.6-sol';
const reasoning = process.env.REGEN_REASONING || 'xhigh';

const playbooks = Object.fromEntries(
  campaigns.map((campaign) => [
    campaign,
    readFileSync(join(root, 'playbooks', `${campaign}.md`), 'utf8'),
  ]),
);
const shared = readFileSync(join(root, 'playbooks', '_shared.md'), 'utf8');
const rehearsalRules = shared.match(
  /## Deal-specific rehearsal before writing([\s\S]*?)## Sequence-level review/,
)?.[0] || '';

const outputSchema = {
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
          'contact_id',
          'sales_brief',
          't1_subject',
          't1_body',
          't2_job',
          't2_body',
        ],
        properties: {
          contact_id: { type: 'integer' },
          sales_brief: {
            type: 'object',
            additionalProperties: false,
            required: ['role_route', 'skeptical_question', 'proof_boundary', 'next_step'],
            properties: {
              role_route: { type: 'string' },
              skeptical_question: { type: 'string' },
              proof_boundary: { type: 'string' },
              next_step: { type: 'string' },
            },
          },
          t1_subject: { type: 'string' },
          t1_body: { type: 'string' },
          t2_job: {
            type: 'string',
            enum: ['cost_model', 'micro_artifact', 'new_observation', 'lower_bar_question', 'routing_question', 'process_clarification'],
          },
          t2_body: { type: 'string' },
        },
      },
    },
  },
};

const duplicateRows = db.prepare(`
  SELECT s.person_id, s.touch, COUNT(*) AS n
  FROM sequences s
  JOIN people p ON p.id = s.person_id
  JOIN companies c ON c.id = p.company_id
  WHERE c.campaign IN (${campaigns.map(() => '?').join(',')})
    AND s.touch IN (1, 2)
  GROUP BY s.person_id, s.touch
  HAVING COUNT(*) > 1
`).all(...campaigns);
if (duplicateRows.length) {
  throw new Error(`Duplicate T1/T2 rows must be resolved first: ${JSON.stringify(duplicateRows)}`);
}

let rows = db.prepare(`
  SELECT p.id, p.name, p.first_name, p.title, p.role_type, p.relevance_reason,
         p.sales_brief,
         c.id AS company_id, c.name AS company, c.campaign, c.industry, c.city,
         c.notes AS company_notes, c.hypothesis,
         pu.pursuit_type, pu.problem AS pursuit_problem, pu.evidence AS pursuit_evidence,
         pu.consequence AS pursuit_consequence, pu.narrative AS pursuit_narrative,
         pu.cost_model AS pursuit_cost_model, pu.cost_confidence AS pursuit_cost_confidence,
         pu.desired_commitment, pu.value_to_partner, pu.decision_process,
         pu.next_goal, pc.role AS pursuit_contact_role,
         t1.subject AS t1_subject, t1.body AS t1_body, t1.status AS t1_status,
         t2.body AS t2_body, t2.status AS t2_status
  FROM people p
  JOIN companies c ON c.id = p.company_id
  LEFT JOIN pursuits pu ON pu.company_id = c.id
  LEFT JOIN pursuit_contacts pc ON pc.pursuit_id = pu.id AND pc.person_id = p.id
  LEFT JOIN sequences t1 ON t1.person_id = p.id AND t1.touch = 1
  LEFT JOIN sequences t2 ON t2.person_id = p.id AND t2.touch = 2
  WHERE c.campaign IN (${campaigns.map(() => '?').join(',')})
    AND p.email LIKE '%@%'
  ORDER BY c.campaign, c.id, p.relevance_score DESC, p.id
`).all(...campaigns);
if (ids.size) rows = rows.filter((row) => ids.has(row.id));
rows = rows.filter((row) => (
  (!row.t1_status || row.t1_status === 'draft')
  && (!row.t2_status || row.t2_status === 'draft')
));
rows = rows.slice(offset, limit ? offset + limit : undefined);

const compact = (value, max = 5000) => String(value || '')
  .replace(/\u0000/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, max);

function context(row) {
  let oldBrief = null;
  try { oldBrief = row.sales_brief ? JSON.parse(row.sales_brief) : null; } catch {}
  let evidence = [];
  try { evidence = row.pursuit_evidence ? JSON.parse(row.pursuit_evidence) : []; } catch {}
  return {
    contact_id: row.id,
    recipient: row.name,
    first_name: row.first_name || String(row.name || '').split(/\s+/)[0],
    title: row.title,
    role_type: row.role_type || null,
    company: row.company,
    industry: row.industry || null,
    location: row.city || null,
    verified_or_public_account_context: compact(row.company_notes),
    hypothesis_not_fact: compact(row.hypothesis, 2000),
    why_this_person_may_reply_not_evidence: compact(row.relevance_reason, 1500),
    previous_private_brief: oldBrief,
    deal_context: {
      motion: row.pursuit_type || null,
      contact_role: row.pursuit_contact_role || row.role_type || null,
      problem_to_validate: compact(row.pursuit_problem, 2000),
      public_evidence: Array.isArray(evidence) ? evidence.slice(0, 8) : [],
      consequence_to_test: compact(row.pursuit_consequence, 1500),
      cost_model_not_company_fact: compact(row.pursuit_cost_model, 1500),
      cost_confidence: row.pursuit_cost_confidence || null,
      deal_narrative: compact(row.pursuit_narrative, 2000),
      desired_commitment: compact(row.desired_commitment, 1500),
      value_to_recipient_company: compact(row.value_to_partner, 1500),
      known_decision_process: compact(row.decision_process, 1500),
      next_deal_goal: compact(row.next_goal, 1200),
    },
    current_t1_subject: row.t1_subject,
    current_t1_body: row.t1_body,
    current_t2_body: row.t2_body,
    required_signature: `Thanks,\nAndrew Gordienko\n${signatureFor(row.campaign)}`,
  };
}

function prompt(unit, pending, previous = new Map(), failures = new Map()) {
  return [
    `Regenerate the existing T1 and T2 cold emails for Andrew Gordienko's ${unit.campaign} campaign.`,
    'This is editing, not greenfield prospecting. Preserve accurate, useful parts of the current drafts, but rewrite anything that does not survive the preparation and evidence checks below.',
    'Before writing, create sales_brief. Name the honest role route, the hardest credible buyer question about fit, proof, implementation, risk, or ownership, the exact proof boundary, and one concrete next step if relevance is confirmed.',
    'The private brief must be richer than the copy. Do not paste its labels or every caveat into the emails.',
    'Use only the supplied public/account context for company facts. relevance_reason, hypothesis, and the previous private brief are planning inputs, not evidence. Never invent a customer, result, case study, internal process, capability, metric, access to data, or commitment.',
    'Use deal_context to make the message advance the real commercial question and next commitment. Keep that strategy in the private sales_brief; do not dump deal-stage language into a cold email. Only deal_context.public_evidence may be stated as company fact.',
    'T1 must contain one truthful reason for writing, one role-answerable question, a plain explanation of the offer, and one CTA. Keep one operational thread. Use 90-145 words excluding greeting and signature.',
    'T2 is a day-4 reply in the T1 thread. It must do exactly one new job and must not request a call or mention silence. Return that choice as t2_job. Use 70-110 words excluding greeting and signature.',
    ...(unit.campaign === 'wapahki' ? [
      'Wapahki T2 must set t2_job to process_clarification. Distinguish two concrete steps an outsider might conflate and ask one easy question. Do not retell Wapahki, cite an anecdote, list disqualifying criteria, mention a technical screen or deployment, promise an artifact, or ask for another call.',
    ] : [
      'For this campaign, do not invent or retell a recent conversation, manager anecdote, customer quote, or newly completed research. Do not open T2 with "since I wrote".',
      'For T2, test cost_model first when T1 or verified account context supplies a role-owned unit of work or public scale. Show a compact equation in prose with rounded inputs, explicit “if” or assumption language, and one calculated burden. Treat the inputs as illustrative, not company facts. Ask whether the order of magnitude is right or whether the cost sits elsewhere. If that model would be forced or insensitive, choose a micro_artifact, verified new_observation, lower_bar_question, or routing_question instead.',
      'deal_context.cost_model_not_company_fact may supply prepared arithmetic. Its confidence label governs how it can be used. “illustrative” means every unpublished number must stay an explicit assumption. “public_model” or “verified” still permits a factual number only when deal_context.public_evidence directly supports it. Otherwise hedge it.',
    ]),
    'Do not repeat the same cost case in T1 and T2. A quantified T1 is allowed only when the number is a verified public fact or the transparent model is essential to the opening. Otherwise keep T1 on the concrete cost mechanism and use the equation as T2’s new value.',
    'T1 and T2 must start with the exact first-name greeting and end with the exact supplied signature. Return one 2-5-word T1 subject in natural sentence case, preserving genuine proper nouns and acronyms. T2 will reuse it.',
    'Never write "I found you because" or narrate how Andrew selected the recipient.',
    'No URLs, bullets, long dashes, colons, exclamation points, fake urgency, guilt, or generic reminder language. Any call request must be for 20 minutes.',
    '',
    '=== DEAL-SPECIFIC REHEARSAL RULES ===',
    rehearsalRules,
    '',
    '=== CAMPAIGN PLAYBOOK ===',
    playbooks[unit.campaign],
    '',
    '=== CONTACTS ===',
    JSON.stringify(pending.map(context), null, 2),
    ...(previous.size ? [
      '',
      '=== INVALID RESULTS TO REPAIR ===',
      ...pending.map((row) => [
        `contact_id ${row.id}`,
        `errors: ${(failures.get(row.id) || ['missing result']).join('; ')}`,
        previous.has(row.id)
          ? `previous result: ${JSON.stringify(previous.get(row.id))}`
          : 'previous result: missing',
      ].join('\n')).join('\n\n'),
    ] : []),
    '',
    'Return exactly one result for every supplied contact and no other contacts.',
  ].join('\n');
}

function normalizeBody(value) {
  return String(value || '')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function validateT1(result, row) {
  const errors = [];
  const firstName = row.first_name || String(row.name || '').split(/\s+/)[0];
  const signature = signatureFor(row.campaign);
  const subject = normalizeSubject(result?.t1_subject);
  const body = normalizeBody(result?.t1_body);
  const contentWords = wordCount(contentOnly(body, row.campaign));
  const subjectWords = wordCount(subject);
  if (subjectWords < 2 || subjectWords > 5) errors.push(`T1 subject has ${subjectWords} words`);
  if (subject !== String(result?.t1_subject || '').trim()) errors.push('T1 subject is not in natural sentence case');
  if (!body.startsWith(`Hi ${firstName},\n\n`)) errors.push('T1 greeting or spacing is wrong');
  if (!new RegExp(`Thanks,\\s*\\nAndrew Gordienko\\s*\\n${signature.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`).test(body)) {
    errors.push('T1 signature is wrong');
  }
  if (contentWords < 90 || contentWords > 145) errors.push(`T1 has ${contentWords} content words`);
  if (/[—–]/.test(body)) errors.push('T1 contains a long dash');
  if (/[:!]/.test(body)) errors.push('T1 contains a colon or exclamation point');
  if (/https?:\/\//i.test(body)) errors.push('T1 contains a URL');
  if (/^\s*(?:[-*]|\d+[.)])\s+/m.test(contentOnly(body, row.campaign))) errors.push('T1 contains a list');
  if (/\b(?:10|15|ten|fifteen)[ -]?minute/i.test(body)) errors.push('T1 asks for less than 20 minutes');
  if (/\bI found you because\b/i.test(body)) errors.push('T1 narrates the prospecting process');
  if (looksLikeIllustrativeCostAnalysis(contentOnly(body, row.campaign))) {
    errors.push(...validateIllustrativeCostAnalysis(body, {
      requireCalibration: false,
    }).map((error) => `T1 ${error}`));
  }
  for (const field of ['role_route', 'skeptical_question', 'proof_boundary', 'next_step']) {
    if (!String(result?.sales_brief?.[field] || '').trim()) errors.push(`sales brief is missing ${field}`);
  }
  return { errors, subject, body };
}

function validateResult(result, row) {
  const t1 = validateT1(result, row);
  const firstName = row.first_name || String(row.name || '').split(/\s+/)[0];
  const t2Body = normalizeBody(result?.t2_body);
  const errors = [
    ...t1.errors,
    ...validateTouch2({
      campaign: row.campaign,
      firstName,
      t1Subject: t1.subject,
      t1Body: t1.body,
      t2Subject: t1.subject,
      t2Body,
    }).map((error) => `T2 ${error}`),
  ];
  if (result?.t2_job === 'cost_model') {
    errors.push(...validateIllustrativeCostAnalysis(t2Body).map((error) => `T2 ${error}`));
    if (row.campaign === 'wapahki') errors.push('T2 Wapahki cannot use a cost model');
  } else if (looksLikeIllustrativeCostAnalysis(contentOnly(t2Body, row.campaign))) {
    errors.push('T2 quantified economics must be labeled as the cost_model job');
  }
  if (row.campaign === 'wapahki' && result?.t2_job !== 'process_clarification') {
    errors.push('T2 Wapahki must use the process_clarification job');
  }
  return { errors: [...new Set(errors)], subject: t1.subject, t1Body: t1.body, t2Body };
}

async function generateUnit(unit) {
  const byId = new Map(unit.rows.map((row) => [row.id, row]));
  const results = new Map();
  let pending = [...unit.rows];
  let failures = new Map();

  for (let attempt = 1; attempt <= 3 && pending.length; attempt++) {
    const output = await runCodex({
      prompt: prompt(unit, pending, results, failures),
      schema: outputSchema,
      model,
      reasoning,
      timeoutMs: Number(process.env.CODEX_TIMEOUT_MS) || 300_000,
      cwd: root,
    });
    for (const result of output.results || []) {
      const row = byId.get(Number(result.contact_id));
      if (row && pending.some((candidate) => candidate.id === row.id)) {
        results.set(row.id, result);
      }
    }
    failures = new Map();
    pending = unit.rows.filter((row) => {
      const result = results.get(row.id);
      const errors = result ? validateResult(result, row).errors : ['missing result'];
      if (errors.length) failures.set(row.id, errors);
      return errors.length;
    });
    if (pending.length) {
      console.log(`    ${unit.campaign}: retry ${attempt}/3 for ${pending.length} invalid result(s)`);
    }
  }

  const valid = [];
  for (const row of unit.rows) {
    const result = results.get(row.id);
    if (!result) continue;
    const checked = validateResult(result, row);
    if (!checked.errors.length) valid.push({ row, result, ...checked });
  }
  return {
    valid,
    failed: pending.map((row) => ({
      id: row.id,
      errors: failures.get(row.id) || ['missing result'],
    })),
  };
}

const byCampaign = new Map(campaigns.map((campaign) => [campaign, []]));
for (const row of rows) byCampaign.get(row.campaign).push(row);
const units = [];
for (const campaign of campaigns) {
  const campaignRows = byCampaign.get(campaign);
  for (let index = 0; index < campaignRows.length; index += batchSize) {
    units.push({ campaign, rows: campaignRows.slice(index, index + batchSize) });
  }
}

console.log(
  `compact regeneration: ${rows.length} contacts across ${units.length} units `
  + `| ${model}/${reasoning} | batch=${batchSize} | concurrency=${concurrency}`,
);

let cursor = 0;
let completed = 0;
let wrote = 0;
let failed = 0;

async function worker() {
  while (true) {
    const index = cursor++;
    if (index >= units.length) return;
    const unit = units[index];
    try {
      const generated = await generateUnit(unit);
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const email of generated.valid) {
          const current = db.prepare(`
            SELECT t1.body AS t1_body, t1.status AS t1_status,
                   t2.body AS t2_body, t2.status AS t2_status
            FROM people p
            LEFT JOIN sequences t1 ON t1.person_id=p.id AND t1.touch=1
            LEFT JOIN sequences t2 ON t2.person_id=p.id AND t2.touch=2
            WHERE p.id=?
          `).get(email.row.id);
          if (!current
            || current.t1_body !== email.row.t1_body
            || current.t2_body !== email.row.t2_body) {
            throw new Error(`messages changed while drafting contact ${email.row.id}`);
          }
          if ((current.t1_status && current.t1_status !== 'draft')
            || (current.t2_status && current.t2_status !== 'draft')) {
            throw new Error(`contact ${email.row.id} became protected while drafting`);
          }
          replaceTouch(email.row.id, email.row.campaign, {
            touch: 1,
            day: 1,
            channel: 'email',
            subject: email.subject,
            body: email.t1Body,
          });
          replaceTouch(email.row.id, email.row.campaign, {
            touch: 2,
            day: 4,
            channel: 'email',
            subject: email.subject,
            body: email.t2Body,
          });
          updatePerson(email.row.id, {
            sales_brief: JSON.stringify(email.result.sales_brief),
          });
        }
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      wrote += generated.valid.length;
      failed += generated.failed.length;
      for (const item of generated.failed) {
        console.log(`  failed contact ${item.id}: ${item.errors.join('; ')}`);
      }
    } catch (error) {
      failed += unit.rows.length;
      console.log(
        `  failed ${unit.campaign} [${unit.rows.map((row) => row.id).join(',')}]: `
        + String(error.message).split('\n')[0],
      );
    }
    completed++;
    console.log(`${completed}/${units.length} units | wrote ${wrote} | failed ${failed}`);
  }
}

await Promise.all(
  Array.from({ length: Math.min(concurrency, units.length || 1) }, () => worker()),
);
console.log(`Done. Regenerated ${wrote} T1/T2 pairs; ${failed} contacts failed.`);
if (failed) process.exitCode = 1;
