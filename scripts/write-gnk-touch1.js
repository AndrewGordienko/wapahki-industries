// Write the first-touch email for every GnK problem-led contact, the same way the
// wapahki sequences are written: tapping the developed handbook (playbooks/_shared.md
// + playbooks/gnk.md) AND the full per-company problem research (problem, stakes/
// why-it's-expensive, what we'd build, measurable outcome, fee, sources). Codex per
// company (all its contacts at once). Stored as sequence touch 1.
//   node scripts/write-gnk-touch1.js [--rewrite] [--ui-order] [--company-ids 83,85] [--person-ids 423,428] [--offset N] [--limit N] [--people N] [--concurrency N]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { db, replaceTouch, updatePerson } from '../src/db.js';
import { listProblems } from '../src/problems.js';
import { runCodex } from '../src/codex.js';
import { personalizeWrittenSubjects } from '../src/run-subject-agents.js';
import { normalizeSubject } from '../src/subject-lines.js';
import {
  looksLikeIllustrativeCostAnalysis,
  validateIllustrativeCostAnalysis,
} from '../src/cost-analysis.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const REWRITE = args.includes('--rewrite') || process.env.WRITER_REWRITE === '1';
// --ui-order: select contact-ready companies in the same tier/name order shown
// by /outreach instead of ranking by Problem Radar score.
const UI_ORDER = args.includes('--ui-order');
// --existing-only: restrict to people who already have a touch-1 draft
// (regenerate the in-use outreach set without expanding it).
const EXISTING_ONLY = args.includes('--existing-only');
const COMPANY_IDS = (() => {
  const i = args.indexOf('--company-ids');
  return i >= 0 ? new Set(String(args[i + 1]).split(',').map(Number).filter(Number.isInteger)) : null;
})();
const PERSON_IDS = (() => {
  const i = args.indexOf('--person-ids');
  return i >= 0 ? new Set(String(args[i + 1]).split(',').map(Number).filter(Number.isInteger)) : null;
})();
const OFFSET = (() => { const i = args.indexOf('--offset'); return i >= 0 ? Number(args[i + 1]) : 0; })();
const LIMIT = (() => { const i = args.indexOf('--limit'); return i >= 0 ? Number(args[i + 1]) : Infinity; })();
const PEOPLE = (() => { const i = args.indexOf('--people'); return i >= 0 ? Number(args[i + 1]) : Infinity; })();
const CONCURRENCY = (() => {
  const i = args.indexOf('--concurrency');
  return Math.max(1, i >= 0 ? Number(args[i + 1]) : 1);
})();
const MODEL = process.env.CODEX_MODEL || 'gpt-5.6-sol';
const REASONING = process.env.DRAFT_REASONING || 'high';

const shared = readFileSync(join(root, 'playbooks', '_shared.md'), 'utf8');
const playbook = readFileSync(join(root, 'playbooks', 'gnk.md'), 'utf8');
const ideaByTitle = new Map(listProblems().map((p) => [p.title, p]));
const money = (n) => (n == null ? '?' : n >= 1e6 ? `$${(n / 1e6).toFixed(n % 1e6 ? 1 : 0)}M` : `$${Math.round(n / 1000)}k`);
const field = (notes, key) => (String(notes || '').match(new RegExp('^' + key + ':\\s*(.+)$', 'm')) || [])[1] || '';
const jsonNotes = (notes) => {
  try {
    const value = JSON.parse(notes || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
};

const emailsSchema = {
  type: 'object', additionalProperties: false, required: ['emails'],
  properties: {
    emails: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['contact_id', 'message_brief', 'subject', 'body'],
        properties: {
          contact_id: { type: 'integer' },
          message_brief: {
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
          subject: { type: 'string' },
          body: { type: 'string' },
        },
      },
    },
  },
};

let rows = db.prepare(`
  SELECT p.id, p.first_name, p.name, p.title, p.company_id, c.name AS company,
         c.industry, c.city, c.tier, c.notes
  FROM people p JOIN companies c ON c.id = p.company_id
  WHERE c.campaign = 'gnk' AND p.email LIKE '%@%'
  ORDER BY p.company_id, p.relevance_score DESC
`).all();
if (PERSON_IDS) rows = rows.filter((row) => PERSON_IDS.has(row.id));
if (EXISTING_ONLY) {
  const withT1 = new Set(db.prepare(
    "SELECT DISTINCT s.person_id FROM sequences s JOIN people p ON p.id=s.person_id JOIN companies c ON c.id=p.company_id WHERE s.touch=1 AND c.campaign='gnk'"
  ).all().map((r) => r.person_id));
  rows = rows.filter((r) => withT1.has(r.id));
}

const byCompany = new Map();
for (const r of rows) { if (!byCompany.has(r.company_id)) byCompany.set(r.company_id, []); byCompany.get(r.company_id).push(r); }
// Default to strongest Problem Radar ideas. --ui-order mirrors listCompanies():
// easy → medium → hard → untiered, then name.
const scoreOf = (list) => (ideaByTitle.get(field(list[0].notes, 'Idea'))?.score || 0);
const tierRank = (tier) => ({ easy: 0, medium: 1, hard: 2 }[String(tier || '').toLowerCase()] ?? 3);
let candidates = [...byCompany.values()];
if (COMPANY_IDS) candidates = candidates.filter((list) => COMPANY_IDS.has(list[0].company_id));
if (Number.isFinite(PEOPLE)) candidates = candidates.filter((list) => list.length >= PEOPLE);
const selected = candidates
  .sort(UI_ORDER
    ? (a, b) => tierRank(a[0].tier) - tierRank(b[0].tier)
      || String(a[0].company).localeCompare(String(b[0].company), undefined, { sensitivity: 'base' })
    : (a, b) => scoreOf(b) - scoreOf(a) || a[0].company_id - b[0].company_id)
  .slice(OFFSET, Number.isFinite(LIMIT) ? OFFSET + LIMIT : undefined)
  .map((list) => list.slice(0, PEOPLE));
const companies = selected
  .map((list) => REWRITE
    ? list
    : list.filter((r) => !db.prepare('SELECT 1 FROM sequences WHERE person_id=? AND touch=1').get(r.id)))
  .filter((list) => list.length);
const selectedContacts = selected.reduce((n, list) => n + list.length, 0);
const pendingContacts = companies.reduce((n, list) => n + list.length, 0);
console.log(`touch-1 writer (gnk): selected ${selectedContacts} contacts across ${selected.length} companies; ${pendingContacts} drafts pending across ${companies.length} companies | order=${UI_ORDER ? 'ui' : 'score'} | offset=${OFFSET} | model ${MODEL}/${REASONING} | rewrite=${REWRITE}`);

function contextBlock(list) {
  const first = list[0];
  const ideaTitle = field(first.notes, 'Idea');
  const idea = ideaByTitle.get(ideaTitle) || {};
  const research = jsonNotes(first.notes);
  const whyCo = field(first.notes, 'Why this company');
  const srcs = Array.isArray(idea.sources) ? idea.sources.map((s) => s.title || s.url).filter(Boolean).slice(0, 3).join('; ') : '';
  if (Object.keys(research).length) {
    return [
      `PRODUCT / PROBLEM RESEARCH FOR THIS COMPANY — ${first.company}${first.industry ? ` (${first.industry}${first.city ? ', ' + first.city : ''})` : ''}:`,
      `What the company does: ${research.what_they_do || ''}`,
      research.defensible_problem ? `SOURCE-BACKED PUBLIC PROBLEM CONTEXT: ${research.defensible_problem}` : '',
      research.evidence_source ? `Evidence source: ${research.evidence_source}` : '',
      research.ai_project ? `PROPOSED BUILD HYPOTHESIS — translate this into plain workflow language and never say AI or agent: ${research.ai_project}` : '',
      research.role_hypotheses ? `ROLE-SPECIFIC BUILD BOUNDARIES — choose only the one matching this recipient: ${JSON.stringify(research.role_hypotheses)}` : '',
      research.decision_model ? `DECISION MODEL — use this to keep the email decision-first: ${JSON.stringify(research.decision_model)}` : '',
      research.why_meaningful ? `Possible value mechanism (a hypothesis, not a verified fact): ${research.why_meaningful}` : '',
      research.market_signal?.hook ? `Optional current peer signal (context only, not proof this company has the same need): ${research.market_signal.hook}` : '',
      research.market_signal?.source_url ? `Peer-signal source: ${research.market_signal.source_url}` : '',
      'Do not invent a dollar estimate. If the research gives no defensible annual cost, describe the specific time, rework, delay, quality, capacity, or risk mechanism instead.',
    ].filter(Boolean).join('\n');
  }
  return [
    `PRODUCT / PROBLEM RESEARCH FOR THIS COMPANY — ${first.company}${first.industry ? ` (${first.industry}${first.city ? ', ' + first.city : ''})` : ''}:`,
    `Product idea: ${ideaTitle || '(unspecified)'}`,
    `The problem: ${idea.one_liner || field(first.notes, 'Problem')}`,
    `How the work is done today: ${idea.workflow_today || ''}`,
    `Why it's expensive (the stakes): ${idea.why_expensive || ''}`,
    `Why software hasn't fixed it: ${idea.why_unsolved || ''}`,
    `What we'd build (complete first version): ${idea.proposed_solution || field(first.notes, "What we'd build")}`,
    `The two-minute demo: ${idea.demo_idea || ''}`,
    `The measurable outcome: ${idea.measurable || ''}`,
    idea.annual_cost_low ? `ESTIMATED annual cost of this workflow for a typical org: ${money(idea.annual_cost_low)}-${money(idea.annual_cost_high)}/yr — ${idea.cost_basis || 'estimate'}` : '',
    idea.savings_low ? `Estimated recoverable per year: ${money(idea.savings_low)}-${money(idea.savings_high)}` : '',
    `Typical fee: ${money(idea.our_cut_low)}-${money(idea.our_cut_high)}`,
    whyCo ? `Why THIS company specifically: ${whyCo}` : '',
    srcs ? `Grounding sources: ${srcs}` : '',
  ].filter(Boolean).join('\n');
}

function prompt(list) {
  const people = list.map((p) => `- contact_id ${p.id}: ${p.first_name || String(p.name || '').split(/\s+/)[0]} (${p.name}) — ${p.title}`).join('\n');
  return [
    "You are Andrew Gordienko's cold-outreach writer for GnK. Write ONLY touch 1, the first email, for each contact below.",
    'Ground every email in the SPECIFIC company problem research provided — the workflow, the stakes (why it is expensive), and what we would build. This is not a generic template; it must read like we studied THEIR operation. Follow the campaign playbook\'s "Touch 1 preferred shape" exactly, including the signature (Andrew Gordienko / GnK). Vary wording per contact and tune to each role.',
    'PASS THE DECISION-FIRST GATE BEFORE DRAFTING EACH CONTACT. Privately complete: "This person currently decides ___"; "They must repeat that decision because ___ changes"; "The proposed tool places ___ in front of them so they can decide ___." If any blank is abstract, rewrite the idea or use an honest routing email. The buyer-facing email must make the decision, repeated trigger, concrete output, and role fit obvious.',
    'Complete message_brief before writing. Name the honest role route, rehearse the hardest credible question this person may ask about fit, proof, implementation, risk, or ownership, state exactly what the supplied evidence supports and does not support, and choose one concrete next step if the hypothesis survives. Keep this preparation private. Do not paste the whole rehearsal or its internal labels into the email.',
    'State whether the proposed build is an internal tool for this company or a customer-facing capability in its product. Do not assume access to customer notes, usage telemetry, scientific evidence, plant records, or any other data that the public context does not establish. Name only the two or three inputs necessary to explain the decision, and say exactly what the tool would put in front of the person for review.',
    'Do not use undefined failure labels such as "weak experiment", "weak prior attempt", or "likely repeat". Name what made the prior work relevant. Prefer an open bottleneck question for founders and technical leaders. Use multiple-choice only when the supplied evidence establishes the choices and they genuinely make the question easier to answer.',
    'Define the cost; do not merely decorate the email with an annual range. If the supplied estimate has visible arithmetic and the recipient owns the economics, you may use one concise assumption-led equation with rounded inputs and an explicit hedge. Never scale a typical-org estimate to this company by intuition. If the model would make T1 crowded, name the specific cost mechanism and leave the transparent equation for T2. If no usable model is supplied, do not invent one.',
    'Never say "AI" or name the technology. Never claim we have customers or results. Admit the hypothesis may be wrong.',
    'Return exactly one email for every listed contact. If a role is a stretch, write an honest routing email that asks who owns the problem rather than omitting the contact.',
    '', '=== SHARED HOUSE RULES ===', shared,
    '', '=== CAMPAIGN PLAYBOOK (GnK) ===', playbook,
    '', '=== THIS COMPANY ===', contextBlock(list),
    '', '=== CONTACTS (one email each, by first name, tuned to role) ===', people,
    '',
    'FINAL MECHANICAL REQUIREMENTS:',
    '- Return exactly one draft with message_brief for every listed contact.',
    '- Subject must be 2-5 words in natural sentence case, preserving genuine proper nouns and acronyms, with no colon, question mark, or exclamation point.',
    '- Body must contain 105-135 words after excluding the greeting and signature.',
    '- Start exactly with "Hi <First>," and end exactly with "Thanks,\\nAndrew Gordienko\\nGnK".',
    '- Do not use em dashes, en dashes, colons, exclamation points, URLs, bullets, or numbered lists.',
    '- Keep one operational problem, one role-appropriate CTA, and 4-6 natural sentences across short paragraphs.',
    'Return only the JSON the schema requires.',
  ].join('\n');
}

const words = (text) => (String(text || '').match(/\b[\p{L}\p{N}][\p{L}\p{N}'’-]*\b/gu) || []).length;
const contentOnly = (body) => String(body || '')
  .replace(/^Hi [^,\n]+,\s*/i, '')
  .replace(/\s*(?:Best|Thanks),\s*\nAndrew Gordienko\s*\nGnK\s*$/i, '')
  .trim();
const banned = [
  ['AI', /\bAI\b/i],
  ['machine learning', /\bmachine learning\b/i],
  ['automation platform', /\bautomation platform\b/i],
  ['revolutionize', /\brevolutioni[sz]e\b/i],
  ['synergy', /\bsynerg(?:y|ies)\b/i],
  ['quick call', /\bquick call\b/i],
  ['circle back', /\bcircle back\b/i],
  ['touch base', /\btouch base\b/i],
  ['cutting-edge', /\bcutting-edge\b/i],
  ['leverage', /\bleverag(?:e|ing)\b/i],
  ['seamless', /\bseamless\b/i],
  ['weak experiment', /\bweak (?:prior )?(?:experiment|attempt)\b/i],
  ['identifies likely repeats', /\bidentif(?:y|ies|ied|ying) likely repeats?\b/i],
];

function normalizeEmail(email, person) {
  const first = person.first_name || String(person.name || '').split(/\s+/)[0];
  const subject = String(email.subject || '')
    .toLowerCase()
    .replace(/[:!?]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  let body = String(email.body || '').replace(/\r/g, '').trim();
  body = body.replace(/\s*(?:Best|Thanks),\s*\nAndrew Gordienko\s*\nGnK\s*$/i, '').trim();
  if (/^Hi [^,\n]+,/i.test(body)) body = body.replace(/^Hi [^,\n]+,/i, `Hi ${first},`);
  else body = `Hi ${first},\n\n${body}`;
  body = body
    .replace(/[—–]/g, ',')
    .replace(/!/g, '.')
    .replace(/:/g, ',')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([,.?])/g, '$1')
    .replace(/([.?])(?=[A-Z])/g, '$1 ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  body = body.replace(/^Hi [^,\n]+,\n*/i, `Hi ${first},\n\n`);
  body += '\n\nThanks,\nAndrew Gordienko\nGnK';
  return { contact_id: person.id, message_brief: email.message_brief, subject, body };
}

function validateEmail(email, person) {
  const errors = [];
  const first = person.first_name || String(person.name || '').split(/\s+/)[0];
  const subjectWords = words(email.subject);
  const contentWords = words(contentOnly(email.body));
  if (!email.subject) errors.push('missing subject');
  if (email.subject !== normalizeSubject(email.subject)) errors.push('subject is not in natural sentence case');
  if (subjectWords < 2 || subjectWords > 5) errors.push(`subject has ${subjectWords} words`);
  if (/[:!?]/.test(email.subject)) errors.push('subject contains punctuation');
  if (!email.body.startsWith(`Hi ${first},`)) errors.push('greeting does not match');
  if (!email.body.startsWith(`Hi ${first},\n\n`)) errors.push('greeting spacing is wrong');
  if (!/Thanks,\s*\nAndrew Gordienko\s*\nGnK\s*$/.test(email.body)) errors.push('signature is wrong');
  if (!/\n\nThanks,\nAndrew Gordienko\nGnK\s*$/.test(email.body)) errors.push('signature spacing is wrong');
  if (contentWords < 90 || contentWords > 145) errors.push(`body has ${contentWords} content words`);
  if (/[—–]/.test(email.body)) errors.push('body contains a long dash');
  if (/[:!]/.test(email.body)) errors.push('body contains a colon or exclamation point');
  if (/https?:\/\//i.test(email.body)) errors.push('body contains a URL');
  if (/^\s*[-*]\s+/m.test(contentOnly(email.body))) errors.push('body contains a bullet');
  if (/[ \t]{2,}/.test(email.body)) errors.push('body contains repeated spaces');
  if (/[ \t]+[,.?]/.test(email.body)) errors.push('body contains a space before punctuation');
  if (/[.?](?=[A-Z])/.test(contentOnly(email.body))) errors.push('body is missing a space after punctuation');
  if (/\b(?:uses|combines|connects|reviews|brings together)\b[^.!?\n]*(?:,\s*[^,.!?\n]+){3,}/i.test(email.body)) {
    errors.push('body catalogs inputs instead of explaining the output and decision');
  }
  if (looksLikeIllustrativeCostAnalysis(contentOnly(email.body))) {
    errors.push(...validateIllustrativeCostAnalysis(email.body, {
      requireCalibration: false,
    }));
  }
  for (const [label, pattern] of banned) {
    if (pattern.test(email.body)) errors.push(`body uses ${label}`);
  }
  return errors;
}

async function generateValidEmails(list) {
  const byId = new Map(list.map((person) => [person.id, person]));
  const drafts = new Map();
  let pending = [...list];
  let lastErrors = new Map();

  for (let attempt = 1; attempt <= 3 && pending.length; attempt++) {
    const repair = attempt === 1 ? '' : [
      '',
      '=== REPAIR THE PREVIOUS INVALID DRAFTS ===',
      'Rewrite every listed contact. Fix every stated error while preserving the company-specific problem and role fit.',
      ...pending.map((person) => {
        const previous = drafts.get(person.id);
        return [
          `contact_id ${person.id} errors: ${(lastErrors.get(person.id) || ['missing draft']).join('; ')}`,
          previous ? `previous subject: ${previous.subject}\nprevious body:\n${previous.body}` : 'No draft was returned.',
        ].join('\n');
      }),
    ].join('\n');
    const out = await runCodex({
      prompt: prompt(pending) + repair,
      schema: emailsSchema,
      model: MODEL,
      reasoning: REASONING,
      webSearch: false,
      timeoutMs: 300000,
      cwd: root,
    });
    for (const email of out.emails || []) {
      const person = byId.get(email.contact_id);
      if (!person || !pending.some((candidate) => candidate.id === person.id)) continue;
      drafts.set(person.id, normalizeEmail(email, person));
    }
    lastErrors = new Map();
    pending = list.filter((person) => {
      const draft = drafts.get(person.id);
      const errors = draft ? validateEmail(draft, person) : ['missing draft'];
      if (errors.length) lastErrors.set(person.id, errors);
      return errors.length;
    });
    if (pending.length) {
      console.log(`    ${list[0].company}: retry ${attempt}/3 for ${pending.length} invalid or missing draft(s)`);
    }
  }

  if (pending.length) {
    const detail = pending
      .map((person) => `${person.id}: ${(lastErrors.get(person.id) || ['missing draft']).join(', ')}`)
      .join(' | ');
    throw new Error(`quality gate failed after 3 attempts (${detail})`);
  }
  return list.map((person) => drafts.get(person.id));
}

let wrote = 0, failed = 0, done = 0, cursor = 0;
const writtenPersonIds = [];
async function worker() {
  while (true) {
    const index = cursor++;
    if (index >= companies.length) return;
    const list = companies[index];
    try {
      const emails = await generateValidEmails(list);
      for (const email of emails) {
        replaceTouch(email.contact_id, 'gnk', {
          touch: 1,
          day: 1,
          channel: 'email',
          subject: email.subject,
          body: email.body,
        });
        updatePerson(email.contact_id, { sales_brief: JSON.stringify(email.message_brief) });
        writtenPersonIds.push(email.contact_id);
      }
      wrote += emails.length;
      done++;
      console.log(`  [${done}/${companies.length}] ${list[0].company} → ${emails.length} emails | total ${wrote}`);
    } catch (error) {
      failed++;
      done++;
      console.log(`  ! [${done}/${companies.length}] ${list[0].company}: ${String(error.message).split('\n')[0]}`);
    }
  }
}

await Promise.all(Array.from({ length: Math.min(CONCURRENCY, companies.length || 1) }, () => worker()));
console.log(`\nDone. Wrote ${wrote} first-touch emails, ${failed} companies failed.`);
if (writtenPersonIds.length) {
  console.log(`Running subject strategist + editor for ${writtenPersonIds.length} new GnK drafts.`);
  try {
    await personalizeWrittenSubjects({ root, campaign: 'gnk', personIds: writtenPersonIds });
  } catch (error) {
    failed++;
    console.log(`Subject agents failed closed: ${error.message}`);
  }
}
if (failed) process.exitCode = 1;
