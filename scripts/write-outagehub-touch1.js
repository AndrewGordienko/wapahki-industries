// Regenerate the first-touch email for every OutageHub contact using the
// OutageHub playbook, grounded in each account's operational problem. Codex per
// company; manager-first order (relevance_score). Stored as sequence touch 1.
//   node scripts/write-outagehub-touch1.js [--rewrite] [--person-ids 555,2603,2611] [--offset N] [--limit N] [--only 9,14,18] [--concurrency N]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { db, replaceTouch, updatePerson } from '../src/db.js';
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
const OFFSET = (() => { const i = args.indexOf('--offset'); return i >= 0 ? Number(args[i + 1]) : 0; })();
const LIMIT = (() => { const i = args.indexOf('--limit'); return i >= 0 ? Number(args[i + 1]) : Infinity; })();
const ONLY = (() => {
  const i = args.indexOf('--only');
  return i >= 0 ? String(args[i + 1]).split(',').map(Number).filter(Number.isInteger) : null;
})();
const PERSON_IDS = (() => {
  const i = args.indexOf('--person-ids');
  return i >= 0 ? new Set(String(args[i + 1]).split(',').map(Number).filter(Number.isInteger)) : null;
})();
const CONCURRENCY = (() => {
  const i = args.indexOf('--concurrency');
  return Math.max(1, i >= 0 ? Number(args[i + 1]) : 1);
})();
const MODEL = process.env.CODEX_MODEL || 'gpt-5.6-sol';
const REASONING = process.env.DRAFT_REASONING || 'high';

const playbook = readFileSync(join(root, 'playbooks', 'outagehub.md'), 'utf8');
const field = (notes, key) => (String(notes || '').match(new RegExp(key + ':\\s*([^\\n]+)', 'i')) || [])[1] || '';
const isRoutingContact = (person) => /\b(?:marketing|communications?|sales|finance|financial|business development|legal|general counsel|human resources|procurement)\b/i
  .test(String(person.title || ''));

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
  SELECT p.id, p.first_name, p.name, p.title, p.company_id, c.name AS company, c.industry, c.city, c.notes
  FROM people p JOIN companies c ON c.id = p.company_id
  WHERE c.campaign = 'outagehub' AND p.email LIKE '%@%'
  ORDER BY p.company_id, p.relevance_score DESC
`).all();
if (PERSON_IDS) rows = rows.filter((row) => PERSON_IDS.has(row.id));
if (!REWRITE) rows = rows.filter((r) => !db.prepare('SELECT 1 FROM sequences WHERE person_id=? AND touch=1').get(r.id));

const byCompany = new Map();
for (const r of rows) { if (!byCompany.has(r.company_id)) byCompany.set(r.company_id, []); byCompany.get(r.company_id).push(r); }
const allCompanies = [...byCompany.values()];
const companies = ONLY
  ? ONLY.map((index) => allCompanies[index]).filter(Boolean)
  : allCompanies.slice(OFFSET, Number.isFinite(LIMIT) ? OFFSET + LIMIT : undefined);
const selection = PERSON_IDS
  ? `person-ids=${[...PERSON_IDS].join(',')}`
  : ONLY ? `only=${ONLY.join(',')}` : `offset=${OFFSET}`;
console.log(`outagehub touch-1 writer: ${companies.reduce((n, list) => n + list.length, 0)} contacts across ${companies.length} companies | ${selection} | ${MODEL}/${REASONING} | rewrite=${REWRITE}`);

function prompt(list) {
  const first = list[0];
  const prob = field(first.notes, 'OutageHub problems?') || 'turning outage data into a prioritized operational response';
  const why = field(first.notes, 'Why this company');
  const people = list.map((p) => {
    const route = isRoutingContact(p)
      ? 'ROUTING CONTACT: the referral is the only ask; do not ask for a call'
      : 'DIRECT-FIT CONTACT: ask for a 20-minute conversation, then offer one referral escape';
    return `- contact_id ${p.id}: ${p.first_name || String(p.name || '').split(/\s+/)[0]} (${p.name}) — ${p.title} — ${route}`;
  }).join('\n');
  return [
    "You are Andrew Gordienko's cold-outreach writer for OutageHub. Write ONLY touch 1, the first email, for each contact below.",
    'The OutageHub campaign playbook overrides any older example in the shared rules. Start with why this exact role has useful insight, name one operational trigger, and ask how the decision is handled today. Position the current alternative concretely: utility sites checked separately, alarms correlated manually, or information arriving location by location. Do not lead on fields, timestamps, coverage, speed, early detection, surprise, or a presumed blind spot.',
    'Complete message_brief before writing. Name the honest role route, rehearse the hardest credible question this person may ask about fit, proof, implementation, risk, or ownership, state exactly what the supplied evidence and the current OutageHub product support and do not support, and choose one concrete next step if the hypothesis survives. Keep this preparation private. Do not paste the whole rehearsal or its internal labels into the email.',
    'Present OutageHub as an existing product in the present tense. Introduce yourself once with "I run OutageHub", then describe in your own plain words, tuned to this specific buyer, that it takes public outage data from the Canadian utilities it supports and matches it to that company\'s own locations or territory. Do not paste a canned slogan, and never label it a feed "for multi-site operators" to a buyer who is not one. State the boundary once: it adds utility-reported power context to an existing incident and does not replace site telemetry or prove impact. Tune the next sentence to the bounded decision in this person\'s remit.',
    'LEAD WITH THE DECISION, NOT THE DATA. Choose ONE per-role use case and keep the entire email on it: multi-site operator = whether a public grid event changes which existing site-status checks are grouped; insurer/claims = whether a confirmed external event changes catastrophe-capacity review, never individual claim ranking; telecom/NOC = whether utility information changes how coincident site alarms are classified, or existing telemetry is already enough; generator/field-service dispatch = whether a matched regional event changes how the existing response queue is grouped or reviewed. Never switch among triage, customer communications and post-incident review.',
    'Never claim N+1 diesel exposure, colocation risk, knowledge before a ticket, call or alarm, early detection, surprise, guaranteed or real-time Canadian coverage, or a lead-time advantage. Never mention a pilot, price, first-year deployment, or annual contract in cold copy.',
    'Andrea Prashad is the strongest direct use case. Write directly to her multi-site operations responsibility and residence continuity. John Lally is a plausible claims use case that still needs validation. Ask about early catastrophe response and capacity, and say outage data would not set the priority of any one claim. Alexandra Denning sees the customer-communications side of Beanfield incidents. Recognize that perspective and treat her primarily as a route into network operations. Do not ask Alexandra to explain NOC alarms, telemetry, or incident classification.',
    'Return exactly one usable email for EVERY listed contact. NEVER output the literal "do_not_contact" or an empty body. A DIRECT-FIT CONTACT gets one primary ask for a 20-minute conversation, followed by one referral option pointed at the likely owner. Do not also offer an email response. A ROUTING CONTACT gets one ask only: a pointer or referral to whoever owns emergency response, operations, dispatch, facilities, network operations, or catastrophe response. Do not ask a routing contact for a call. Do not pitch a finance, legal, sales, communications, or marketing person as the operational owner.',
    'Sign every email:\n\nThanks,\nAndrew Gordienko\nOutageHub',
    '', '=== CAMPAIGN RULES (OutageHub) ===', playbook,
    '', '=== THIS COMPANY ===',
    `Company: ${first.company}${first.industry ? ` — ${first.industry}` : ''}${first.city ? ` (${first.city})` : ''}`,
    `OutageHub problem for this company: ${prob}`,
    why ? `Public evidence / why this company: ${why}` : '',
    '', '=== CONTACTS (one email each, by first name, tuned to role) ===', people,
    '', 'For each contact return contact_id, message_brief, subject (2-5 words in natural sentence case about their specific outage problem, preserving genuine proper nouns and acronyms), and body (greeting "Hi <First>,", 90-145 body words, then the signature). Do not use em dashes, en dashes, colons, exclamation points, URLs, bullets, or numbered lists. Return only the JSON the schema requires.',
  ].join('\n');
}

const words = (text) => (String(text || '').match(/\b[\p{L}\p{N}][\p{L}\p{N}'’-]*\b/gu) || []).length;
const contentOnly = (body) => String(body || '')
  .replace(/^Hi [^,\n]+,\s*/i, '')
  .replace(/\s*(?:Best|Thanks),\s*\nAndrew Gordienko\s*\nOutageHub\s*$/i, '')
  .trim();
const banned = [
  ['do_not_contact', /\bdo_not_contact\b/i],
  ['I found you because', /\bI found you because\b/i],
  ['my guess is', /\bmy guess is\b/i],
  ['process breaks', /\b(?:the|your|this) process breaks\b/i],
  ["I'm building", /\bI['’]m building\b/i],
  ["I'm the founder", /\bI['’]m the founder\b/i],
  ["we're exploring", /\bwe['’]re exploring\b/i],
  ['we are exploring', /\bwe are exploring\b/i],
  ['email response alternative', /\b(?:email (?:reply|response)|reply by email|respond by email|write back instead)\b/i],
  ['just following up', /\bjust follow(?:ing)? up\b/i],
  ['just checking in', /\bjust checking in\b/i],
  ['quick call', /\bquick call\b/i],
  ['leverage', /\bleverag(?:e|ing)\b/i],
  ['unlock', /\bunlock(?:s|ed|ing)?\b/i],
  ['seamless', /\bseamless\b/i],
  ['streamline', /\bstreamlin(?:e|es|ed|ing)\b/i],
  ['workflow', /\bworkflows?\b/i],
  ['outage context', /\boutage context\b/i],
  ['messy reconciliation problem', /\bmessy reconciliation problem\b/i],
  ['where service impact may be coming from', /\bwhere service impact may be coming from\b/i],
  ['tell me if that is not a problem', /\btell me if (?:that|this|it)(?: is|['’]s) not (?:a )?problem\b/i],
  ['no need to continue', /\bno need to continue\b/i],
  ['N+1 diesels', /\bN\s*\+\s*1\b[^.!?\n]{0,45}\bdiesels?\b|\bdiesels?\b[^.!?\n]{0,45}\bN\s*\+\s*1\b/i],
  ['colocation risk', /\bcolocation risk\b/i],
  ['detection before tickets', /\b(?:detect|identify|know|see|spot)(?:s|ed|ing)?\b[^.!?\n]{0,80}\bbefore\b[^.!?\n]{0,45}\b(?:tickets?|calls?|alarms?)\b/i],
  ['early detection', /\bearl(?:y|ier)\b[^.!?\n]{0,55}\b(?:detect|signal|know|learn|see|identify)\w*\b|\b(?:detect|know|learn|see|identify)\w*\b[^.!?\n]{0,55}\bearl(?:y|ier)\b/i],
  ['real-time Canadian coverage', /\breal[- ]?time Canadian coverage\b/i],
  ['pilot or price', /\b(?:paid )?(?:API )?pilot\b|\b(?:CAD|USD)\s*\$?\s*\d|\$\s*(?:40|75)k|\bfirst[- ]year deployment\b/i],
];

function normalizeEmail(email, person) {
  const first = person.first_name || String(person.name || '').split(/\s+/)[0];
  const subject = normalizeSubject(String(email.subject || '')
    .replace(/[:!?]+/g, '')
    .replace(/\s+/g, ' ')
    .trim());
  let body = String(email.body || '').replace(/\r/g, '').trim();
  body = body.replace(/\s*(?:Best|Thanks),\s*\nAndrew Gordienko\s*\nOutageHub\s*$/i, '').trim();
  if (/^Hi [^,\n]+,/i.test(body)) body = body.replace(/^Hi [^,\n]+,/i, `Hi ${first},`);
  else body = `Hi ${first},\n\n${body}`;
  body = body
    .replace(/[—–]/g, ',')
    .replace(/!/g, '.')
    .replace(/:/g, ',')
    .replace(/\b20 minute\b/gi, '20-minute')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([,.?])/g, '$1')
    .replace(/([.?])(?=[A-Z])/g, '$1 ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  body = body.replace(/^Hi [^,\n]+,\n*/i, `Hi ${first},\n\n`);
  body += '\n\nThanks,\nAndrew Gordienko\nOutageHub';
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
  if (!/Thanks,\s*\nAndrew Gordienko\s*\nOutageHub\s*$/.test(email.body)) errors.push('signature is wrong');
  if (!/\n\nThanks,\nAndrew Gordienko\nOutageHub\s*$/.test(email.body)) errors.push('signature spacing is wrong');
  if (contentWords < 90 || contentWords > 155) errors.push(`body has ${contentWords} content words`);
  if (/[—–]/.test(email.body)) errors.push('body contains a long dash');
  if (/[:!]/.test(email.body)) errors.push('body contains a colon or exclamation point');
  if (/https?:\/\//i.test(email.body)) errors.push('body contains a URL');
  if (/^\s*[-*]\s+/m.test(contentOnly(email.body))) errors.push('body contains a bullet');
  if (/[ \t]{2,}/.test(email.body)) errors.push('body contains repeated spaces');
  if (/[ \t]+[,.?]/.test(email.body)) errors.push('body contains a space before punctuation');
  if (/[.?](?=[A-Z])/.test(contentOnly(email.body))) errors.push('body is missing a space after punctuation');
  if (!/\bI run OutageHub\b/i.test(email.body)) errors.push('missing approved identity line');
  if (!(
    /\bpublic\b[^.!?\n]{0,40}\b(?:outage|utilit)/i.test(email.body)
    || /\butilit(?:y|ies)\b[^.!?\n]{0,45}\breport/i.test(email.body)
  )) errors.push('missing public-utility-data mechanism');
  if (!(
    /\blocation[- ]matched\b/i.test(email.body)
    || /\b(?:match\w*|map\w*)\b[^.!?\n]{0,45}\b(?:location|site|store|facilit|propert|address|residence|network|territor|portfolio|area|branch)\w*/i.test(email.body)
    || /\b(?:location|site|store|facilit|propert|address|residence|network|territor|portfolio|area|branch)\w*\b[^.!?\n]{0,45}\b(?:match\w*|map\w*)\b/i.test(email.body)
  )) errors.push('missing location-matching value');
  if (!/\b(?:you would know|you see|puts you close|gives you (?:a|the) (?:view|perspective)|your role|as [^,.\n]{2,80}, you)\b/i.test(email.body)) errors.push('missing unique role insight');
  if (!/\b(?:does|do|can|when|how)\b[^?]{0,220}\b(?:today|already|currently|separately|store by store|site by site|location by location|utility (?:site|report)|correlat)\b[^?]*\?/i.test(email.body)) errors.push('missing current-process question');
  const identityIndex = email.body.search(/\bI run OutageHub\b/i);
  const firstQuestionIndex = email.body.indexOf('?');
  if (identityIndex >= 0 && identityIndex < 45) errors.push('opens with the product instead of the problem');
  if (!isRoutingContact(person) && (firstQuestionIndex < 0 || (identityIndex >= 0 && firstQuestionIndex > identityIndex))) {
    errors.push('missing a role-relevant problem question before the product');
  }
  if (!isRoutingContact(person) && !/\bI suspect\b/i.test(email.body) && firstQuestionIndex < 0) {
    errors.push('missing a calibrated hypothesis or question');
  }
  const hasTwentyMinuteCta = /\b(?:20|twenty)[ -]?minutes?\b[^.!?\n]{0,60}\b(?:call|conversation)\b|\b(?:call|conversation)\b[^.!?\n]{0,60}\b(?:20|twenty)[ -]?minutes?\b/i.test(email.body);
  const hasReferral = /\b(?:referral|introduction|pointer|(?:point|direct|connect|introduce) (?:me|us)|who(?:ever)?\b[^.!?\n]{0,35}\b(?:owns|handles|leads)|(?:someone|somebody|another (?:team|person|leader)|a different team|a colleague)\b[^.!?\n]{0,50}\b(?:owns|handles|leads)|(?:right|appropriate) (?:person|team|owner|leader|contact))\b/i.test(email.body);
  if (isRoutingContact(person)) {
    if (hasTwentyMinuteCta) errors.push('routing contact is asked for a call');
    if (!hasReferral) errors.push('routing contact is missing the referral ask');
  } else {
    if (!hasTwentyMinuteCta) errors.push('missing primary 20-minute CTA');
    if (!hasReferral) errors.push('missing referral option');
  }
  if (person.id === 2603) {
    if (!/\b(?:residences?|residents?)\b/i.test(email.body)) errors.push('Andrea draft is missing the residence use case');
    if (!/\b(?:continuity|backup power|resident support)\b/i.test(email.body)) errors.push('Andrea draft is missing the continuity decision');
  }
  if (person.id === 2611) {
    if (!/\b(?:catastrophe|cat response|widespread event|severe weather)\b/i.test(email.body)) errors.push('John draft is missing the catastrophe-response frame');
    if (!/\b(?:capacity|where disruption|disruption is concentrating|concentration of disruption)\b/i.test(email.body)) errors.push('John draft is missing the capacity or concentration hypothesis');
    if (!/\b(?:would not|wouldn['’]t|is not|isn['’]t|not meant to)\b[^.!?\n]{0,80}\b(?:priority|prioritize|ranking?)\b[^.!?\n]{0,50}\bclaims?\b|\bclaims?\b[^.!?\n]{0,50}\b(?:priority|prioritize|ranking?)\b/i.test(email.body)) {
      errors.push('John draft is missing the individual-claim-priority boundary');
    }
  }
  if (person.id === 555) {
    if (!/\bcustomer\b[^.!?\n]{0,60}\bcommunicat/i.test(email.body)) errors.push('Alexandra draft is missing her customer-communications perspective');
    if (!/\bnetwork operations\b/i.test(email.body)) errors.push('Alexandra draft is missing the network-operations route');
    if (/\b(?:how|whether|could you explain)\b[^?]{0,100}\b(?:alarms?|telemetry|classif(?:y|ies|ication)|NOC)\b[^?]*\?/i.test(email.body)) {
      errors.push('Alexandra draft asks a NOC-level question');
    }
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
      'Rewrite every listed contact. Fix every stated error while preserving the company-specific outage problem and honest role fit.',
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
      timeoutMs: Number(process.env.CODEX_TIMEOUT_MS) || 600000,
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
        replaceTouch(email.contact_id, 'outagehub', {
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
console.log(`\nDone. Wrote ${wrote} OutageHub first-touch emails, ${failed} companies failed.`);
if (writtenPersonIds.length) {
  console.log(`Running subject strategist + editor for ${writtenPersonIds.length} new OutageHub drafts.`);
  try {
    await personalizeWrittenSubjects({ root, campaign: 'outagehub', personIds: writtenPersonIds });
  } catch (error) {
    failed++;
    console.log(`Subject agents failed closed: ${error.message}`);
  }
}
if (failed) process.exitCode = 1;
