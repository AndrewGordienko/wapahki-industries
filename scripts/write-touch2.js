// Write the personalized second touch (the first follow-up email) for every
// emailable contact that already has T1. T2 stays in T1's thread, adds one new
// useful job, and never invents a completed artifact.
//
//   node scripts/write-touch2.js --dry-run
//   node scripts/write-touch2.js --campaign wapahki,gnk,outagehub
//   node scripts/write-touch2.js --rewrite --batch 6 --concurrency 3
//   node scripts/write-touch2.js --rewrite --existing-only
//   node scripts/write-touch2.js --ids 335,339
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCodex } from '../src/codex.js';
import { db, replaceTouch } from '../src/db.js';
import {
  contentOnly,
  normalizeTouch2Body,
  signatureFor,
  validateTouch2,
  wordCount,
} from '../src/touch2-quality.js';
import { validateIllustrativeCostAnalysis } from '../src/cost-analysis.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const valueAfter = (flag, fallback = null) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : fallback;
};
const campaigns = (valueAfter('--campaign', 'wapahki,gnk,outagehub') || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const allowedCampaigns = new Set(['wapahki', 'gnk', 'outagehub']);
for (const campaign of campaigns) {
  if (!allowedCampaigns.has(campaign)) throw new Error(`Unsupported campaign: ${campaign}`);
}
const ids = new Set(
  (valueAfter('--ids', '') || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map(Number)
    .filter(Number.isInteger),
);
const rewrite = args.includes('--rewrite');
const existingOnly = args.includes('--existing-only');
const dryRun = args.includes('--dry-run');
const limit = Math.max(0, Number(valueAfter('--limit', '0')) || 0);
const offset = Math.max(0, Number(valueAfter('--offset', '0')) || 0);
const batchSize = Math.max(1, Number(valueAfter('--batch', '6')) || 6);
const concurrency = Math.max(1, Number(valueAfter('--concurrency', '3')) || 3);
const model = process.env.TOUCH2_MODEL || process.env.CODEX_MODEL || 'gpt-5.6-sol';
const reasoning = process.env.TOUCH2_REASONING || 'high';

const shared = readFileSync(join(root, 'playbooks', '_shared.md'), 'utf8');
const followUpRules = shared.match(
  /## Endorsed follow-up pattern \(T2–T4 — match this\)([\s\S]*?)<!-- TOUCH2-WISDOM:END -->/,
)?.[0];
if (!followUpRules) {
  throw new Error('The active T2 follow-up doctrine is missing from playbooks/_shared.md');
}
const playbooks = Object.fromEntries(
  campaigns.map((campaign) => [
    campaign,
    readFileSync(join(root, 'playbooks', `${campaign}.md`), 'utf8'),
  ]),
);

const resultSchema = {
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
          'job',
          'grounding_source',
          'grounding_phrase',
          'body',
        ],
        properties: {
          contact_id: { type: 'integer' },
          job: {
            type: 'string',
            enum: ['process_clarification', 'operational_hypothesis', 'cost_model', 'micro_artifact', 'new_observation', 'lower_bar_question', 'routing_question'],
          },
          grounding_source: {
            type: 'string',
            enum: ['t1', 'account_context', 'recipient_role'],
          },
          grounding_phrase: { type: 'string' },
          body: { type: 'string' },
        },
      },
    },
  },
};

const duplicateTouches = db.prepare(`
  SELECT s.person_id, s.touch, COUNT(*) AS n
  FROM sequences s
  JOIN people p ON p.id = s.person_id
  JOIN companies c ON c.id = p.company_id
  WHERE c.campaign IN (${campaigns.map(() => '?').join(',')}) AND s.touch IN (1, 2)
  GROUP BY s.person_id, s.touch
  HAVING COUNT(*) > 1
`).all(...campaigns);
if (duplicateTouches.length) {
  throw new Error(`Duplicate T1/T2 rows must be resolved first: ${JSON.stringify(duplicateTouches)}`);
}

let rows = db.prepare(`
  SELECT p.id, p.name, p.first_name, p.title, p.role_type, p.relevance_reason,
         p.sales_brief,
         c.id AS company_id, c.name AS company, c.campaign, c.industry, c.city,
         c.notes AS company_notes, c.hypothesis,
         pu.cost_model AS pursuit_cost_model, pu.cost_confidence AS pursuit_cost_confidence,
         t1.id AS t1_id, t1.subject AS t1_subject, t1.body AS t1_body,
         t2.id AS t2_id, t2.subject AS t2_subject, t2.body AS t2_body,
         t2.status AS t2_status
  FROM people p
  JOIN companies c ON c.id = p.company_id
  LEFT JOIN pursuits pu ON pu.company_id = c.id
  JOIN sequences t1 ON t1.person_id = p.id AND t1.touch = 1
  LEFT JOIN sequences t2 ON t2.person_id = p.id AND t2.touch = 2
  WHERE c.campaign IN (${campaigns.map(() => '?').join(',')})
    AND p.email LIKE '%@%'
  ORDER BY c.campaign, c.id, p.relevance_score DESC, p.id
`).all(...campaigns);

if (ids.size) rows = rows.filter((row) => ids.has(row.id));
if (existingOnly) rows = rows.filter((row) => row.t2_id);
rows = rows.filter((row) => {
  if (!row.t2_id) return true;
  if (row.t2_status !== 'draft') return false;
  return rewrite;
});
rows = rows.slice(offset, limit ? offset + limit : undefined);

const byCampaign = new Map(campaigns.map((campaign) => [campaign, []]));
for (const row of rows) byCampaign.get(row.campaign).push(row);
const units = [];
for (const campaign of campaigns) {
  const campaignRows = byCampaign.get(campaign);
  for (let index = 0; index < campaignRows.length; index += batchSize) {
    units.push({ campaign, rows: campaignRows.slice(index, index + batchSize) });
  }
}

function compact(value, max = 7000) {
  return String(value || '').replace(/\u0000/g, '').slice(0, max);
}

function contactContext(row) {
  return {
    contact_id: row.id,
    recipient: row.name,
    first_name: row.first_name || String(row.name || '').split(/\s+/)[0],
    title: row.title,
    role_type: row.role_type || null,
    why_this_person_may_reply: row.relevance_reason || null,
    company: row.company,
    industry: row.industry || null,
    location: row.city || null,
    t1_subject: row.t1_subject,
    t1_email: row.t1_body,
    account_context: compact(row.company_notes),
    account_hypothesis_not_fact: compact(row.hypothesis, 2500),
    private_sales_brief_not_evidence: (() => {
      try { return row.sales_brief ? JSON.parse(row.sales_brief) : null; } catch { return null; }
    })(),
    prepared_cost_model_not_company_fact: compact(row.pursuit_cost_model, 1800),
    prepared_cost_confidence: row.pursuit_cost_confidence || null,
    required_signature: `Thanks,\nAndrew Gordienko\n${signatureFor(row.campaign)}`,
  };
}

function prompt(unit, pending, previous = new Map(), failures = new Map()) {
  return [
    `You are writing ONLY touch 2 for Andrew Gordienko's ${unit.campaign} cold-outreach campaign.`,
    'This is the first follow-up after an unanswered T1. Write one genuinely personalized email for every supplied contact.',
    `T2 is sent on day ${unit.campaign === 'gnk' ? 4 : 5} as a reply in T1’s existing thread. Do not return or propose a subject. Storage will copy the exact T1 subject.`,
    ...(unit.campaign === 'wapahki' ? [
      'Choose process_clarification as the job. Advance T1 by distinguishing two concrete steps an outsider might conflate, such as order picking versus a downstream transfer, final packaging versus shipping-case handling, or a routine package change versus a new controlled quality process. Ask one easy question.',
      'Ground the distinction in an exact phrase from T1 or account_context. Do not retell Wapahki, qualify an opportunity, list disqualifying criteria, mention a technical screen or deployment, promise an artifact, or ask for another call.',
    ] : [
      'Choose exactly one new job per recipient. First test whether a concise cost_model can be built from a role-owned unit in T1 plus supplied account scale. If it can, prefer that. Otherwise prefer a useful micro-artifact, then a verified new observation, then one lower-bar role-specific question, then an honest routing question.',
      'A cost_model is transparent assumption math, not a claim about the recipient. Show the operating equation in prose, such as people x hours x weeks x loaded rate or locations x checking time. Use rounded inputs, label them with “if” or equally explicit assumption language, calculate one base burden, and optionally name one distinct larger consequence without treating risk exposure as an expected loss. End by asking whether the order of magnitude is right or whether most of the cost sits elsewhere.',
      'Ground a cost_model in an exact T1 or account_context phrase naming the operating unit or public scale. The grounding phrase supports the situation, not invented numeric inputs. Never use recipient_role or campaign_playbook to justify a number.',
      'prepared_cost_model_not_company_fact may supply arithmetic. If its confidence is illustrative, every unpublished number remains an explicit assumption. A public_model or verified label still does not turn a number into a company fact unless account_context directly supports it.',
    ]),
    'A micro-artifact is a concrete proposed screen, record, comparison, checklist, or worked example described in the email. Never claim Andrew already pulled, made, created, prepared, or attached it. No file or link exists unless the supplied context explicitly proves otherwise.',
    'A new observation must be grounded in account_context, not in the account hypothesis or an inference. If you cannot point to an exact supplied public-fact phrase, choose another job.',
    'Never invent or retell a conversation, call, customer, peer, testimonial, result, or event. Do not use anonymous anecdote framing such as “on a recent call”, “a manager described”, or “a customer said”. Do not say Andrew spoke with someone, heard something, learned something, or did new research. Campaign playbook material may guide strategy but is never evidence for an email. Do not open with “since I wrote” or “after my note”.',
    'The message must advance the same single operational situation as T1 without restating T1, its product paragraph, or its call request. Make the new material fit this exact recipient’s title and decision.',
    'When private_sales_brief_not_evidence is present, use its role route, skeptical question, proof boundary, and next step to keep T2 consistent with the prepared deal logic. It is private planning, not a public fact or a phrase to copy. Never strengthen a claim beyond its proof boundary.',
    'Ask exactly one easy question. Do not request a call in T2. Do not combine an artifact offer, a meeting ask, and a referral request.',
    unit.campaign === 'wapahki'
      ? 'Write 25-70 words excluding greeting and signature, in 2-3 short paragraphs. Use natural, concrete English. No URLs, bullets, long dashes, colons, exclamation points, fake urgency, guilt, or mention of silence.'
      : 'Write 70-110 words excluding greeting and signature, in 2-3 short paragraphs. Use natural, concrete English. No URLs, bullets, long dashes, colons, exclamation points, fake urgency, guilt, or mention of silence.',
    'Never use “following up”, “checking in”, “circling back”, “bumping”, “touch base”, “in case you missed it”, “quick question”, “I wanted to”, or “your thoughts”.',
    'Start exactly with "Hi <First>," and end with the exact supplied signature.',
    'grounding_phrase must be an exact phrase copied from the selected grounding_source. Use at least three meaningful words. It is an audit field, not text that must be copied verbatim into the email.',
    '',
    '=== ACTIVE T2 DOCTRINE ===',
    followUpRules,
    '',
    '=== CAMPAIGN PLAYBOOK ===',
    playbooks[unit.campaign],
    '',
    '=== CONTACTS ===',
    JSON.stringify(pending.map(contactContext), null, 2),
    ...(previous.size ? [
      '',
      '=== INVALID DRAFTS TO REPAIR ===',
      ...pending.map((row) => [
        `contact_id ${row.id}`,
        `errors: ${(failures.get(row.id) || ['missing draft']).join('; ')}`,
        previous.has(row.id) ? `previous result: ${JSON.stringify(previous.get(row.id))}` : 'previous result: missing',
      ].join('\n')).join('\n\n'),
    ] : []),
    '',
    'Return exactly one structured result for every contact and no extra contacts.',
  ].join('\n');
}

function normalized(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function groundingText(row, source) {
  if (source === 't1') return row.t1_body;
  if (source === 'recipient_role') return [row.title, row.role_type, row.relevance_reason].filter(Boolean).join('\n');
  return row.company_notes;
}

function validateResult(result, row) {
  const firstName = row.first_name || String(row.name || '').split(/\s+/)[0];
  const body = normalizeTouch2Body(result?.body, { campaign: row.campaign, firstName });
  const errors = validateTouch2({
    campaign: row.campaign,
    firstName,
    t1Subject: row.t1_subject,
    t1Body: row.t1_body,
    t2Subject: row.t1_subject,
    t2Body: body,
  });
  const phrase = String(result?.grounding_phrase || '').trim();
  const source = result?.grounding_source;
  if (wordCount(phrase) < 3) errors.push('grounding phrase has fewer than three words');
  if (!normalized(groundingText(row, source)).includes(normalized(phrase))) {
    errors.push('grounding phrase is not an exact phrase from its named source');
  }
  if (result?.job === 'new_observation' && source !== 'account_context') {
    errors.push('new observation is not grounded in account context');
  }
  if (result?.job === 'cost_model') {
    errors.push(...validateIllustrativeCostAnalysis(body));
    if (!['t1', 'account_context'].includes(source)) {
      errors.push('cost model is not grounded in T1 or account context');
    }
  }
  if (row.campaign === 'wapahki' && !['t1', 'account_context'].includes(source)) {
    errors.push('Wapahki T2 process clarification must be grounded in T1 or verified account context');
  }
  if (row.campaign === 'wapahki' && result?.job !== 'process_clarification') {
    errors.push('Wapahki T2 must use the process_clarification job');
  }
  return { errors: [...new Set(errors)], body };
}

async function generateUnit(unit) {
  const byId = new Map(unit.rows.map((row) => [row.id, row]));
  const results = new Map();
  let pending = [...unit.rows];
  let failures = new Map();

  for (let attempt = 1; attempt <= 3 && pending.length; attempt++) {
    const output = await runCodex({
      prompt: prompt(unit, pending, results, failures),
      schema: resultSchema,
      model,
      reasoning,
      webSearch: false,
      timeoutMs: 300000,
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
      const { errors } = result ? validateResult(result, row) : { errors: ['missing result'] };
      if (errors.length) failures.set(row.id, errors);
      return errors.length;
    });
    if (pending.length) {
      console.log(
        `    ${unit.campaign} batch retry ${attempt}/3 for ${pending.length} invalid or missing draft(s)`,
      );
    }
  }
  if (pending.length) {
    throw new Error(
      pending.map((row) => `${row.id}: ${(failures.get(row.id) || ['missing result']).join(', ')}`).join(' | '),
    );
  }

  const normalizedBodies = new Set();
  const emails = unit.rows.map((row) => {
    const result = results.get(row.id);
    const { body } = validateResult(result, row);
    const fingerprint = normalized(contentOnly(body, row.campaign));
    if (normalizedBodies.has(fingerprint)) {
      throw new Error(`duplicate T2 body in batch for contact ${row.id}`);
    }
    normalizedBodies.add(fingerprint);
    return { row, result, body };
  });
  return emails;
}

const selectedByCampaign = Object.fromEntries(
  campaigns.map((campaign) => [
    campaign,
    rows.filter((row) => row.campaign === campaign).length,
  ]),
);
console.log(
  `T2 writer: ${rows.length} contacts across ${units.length} batches `
  + `(${Object.entries(selectedByCampaign).map(([key, value]) => `${key}:${value}`).join('  ')}) `
  + `| ${model}/${reasoning} | rewrite=${rewrite} | concurrency=${concurrency}`,
);

if (dryRun) {
  console.log(JSON.stringify(rows.slice(0, 12).map(contactContext), null, 2));
  process.exit(0);
}

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
      const emails = await generateUnit(unit);
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const email of emails) {
          const currentT1 = db.prepare(
            'SELECT subject, body FROM sequences WHERE person_id = ? AND touch = 1',
          ).get(email.row.id);
          const currentT2 = db.prepare(
            'SELECT status FROM sequences WHERE person_id = ? AND touch = 2',
          ).get(email.row.id);
          if (!currentT1 || currentT1.body !== email.row.t1_body) {
            throw new Error(`T1 changed while drafting contact ${email.row.id}; rerun this batch`);
          }
          if (currentT2 && currentT2.status !== 'draft') {
            throw new Error(`T2 became protected while drafting contact ${email.row.id}`);
          }
          replaceTouch(email.row.id, email.row.campaign, {
            touch: 2,
            day: 4,
            channel: 'email',
            subject: currentT1.subject,
            body: email.body,
          });
        }
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      wrote += emails.length;
    } catch (error) {
      failed++;
      console.log(
        `  failed ${unit.campaign} [${unit.rows.map((row) => row.id).join(',')}]: `
        + String(error.message).split('\n')[0],
      );
    }
    completed++;
    console.log(`${completed}/${units.length} batches | wrote ${wrote} | failed ${failed}`);
  }
}

await Promise.all(
  Array.from({ length: Math.min(concurrency, units.length || 1) }, () => worker()),
);
console.log(`Done. Wrote ${wrote} personalized T2 emails; ${failed} batches failed.`);
if (failed) process.exitCode = 1;
