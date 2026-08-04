// Write ONLY touch 1 (the first email) for every emailable contact in a campaign,
// in the endorsed playbook style, using the user's codex login (no billed API).
//   node scripts/write-touch1.mjs wapahki            # fills missing touch-1s
//   WRITER_REWRITE=1 node scripts/write-touch1.mjs wapahki   # rewrite all
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCodex } from '../src/codex.js';
import { db, replaceTouch, updatePerson } from '../src/db.js';
import { personalizeWrittenSubjects } from '../src/run-subject-agents.js';
import { normalizeSubject } from '../src/subject-lines.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const CAMPAIGN = (process.argv[2] || 'wapahki').replace(/^--/, '');
const BATCH = Number(process.env.WRITER_BATCH || 4);
const CONCURRENCY = Number(process.env.WRITER_CONCURRENCY || 3);
const REWRITE = process.env.WRITER_REWRITE === '1';
const EXISTING_ONLY = process.env.WRITER_EXISTING_ONLY === '1';
const IDS = new Set(
  (process.env.WRITER_IDS || '')
    .split(',')
    .map((value) => Number(value.trim()))
    .filter(Number.isInteger),
);
const MODEL = process.env.DRAFT_MODEL || 'gpt-5.6-sol';
const REASONING = process.env.DRAFT_REASONING || 'high';

const shared = readFileSync(join(root, 'playbooks', '_shared.md'), 'utf8');
const playbook = readFileSync(join(root, 'playbooks', `${CAMPAIGN}.md`), 'utf8');
const SIGNATURE = CAMPAIGN === 'wapahki' ? 'Founder, Wapahki Industries' : CAMPAIGN === 'gnk' ? 'GnK' : 'OutageHub';

const schema = {
  type: 'object', additionalProperties: false, required: ['results'],
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['contact_id', 'verdict', 'message_brief', 'subject', 'body'],
        properties: {
          contact_id: { type: 'integer' },
          verdict: { type: 'string', enum: ['write', 'do_not_contact'] },
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
          subject: { type: ['string', 'null'] },
          body: { type: 'string' },
        },
      },
    },
  },
};

const safeJson = (v) => { try { return v ? JSON.parse(v) : {}; } catch { return {}; } };
function ctx(row) {
  const n = safeJson(row.company_notes);
  const sig = n.market_signal || {};
  return {
    contact_id: row.id,
    first_name: row.first_name || String(row.name || '').split(/\s+/)[0],
    full_name: row.name,
    title: row.title,
    // technical | economic_buyer | champion | referral | null — tune angle + CTA to this.
    role_type: row.role_type || null,
    company: row.company,
    company_location: row.city || null,
    industry: row.industry || null,
    // Public, source-backed context about THIS company's operation. Ground the
    // diagnostic question in what they actually make or run, never a generic pain.
    public_company_context: {
      what_they_do: n.what_they_do || null,
      theme: n.theme || null,
      // wapahki notes carry a researched market_signal rather than what_they_do/theme
      observed_signal: sig.hook || null,
      peer_example: sig.peer || null,
    },
    // A per-account hypothesis about where the pain likely sits (may be null).
    account_hypothesis: row.hypothesis || null,
  };
}

const wordCount = (s) => (s || '').trim().split(/\s+/).filter(Boolean).length;
function validate(first, subject, body) {
  const e = [];
  if (!subject) e.push('no subject');
  else {
    if (subject !== normalizeSubject(subject)) e.push('subject not in natural sentence case');
    if (wordCount(subject) < 2 || wordCount(subject) > 5) e.push('subject not 2-5 words');
    if (/[:!?]/.test(subject)) e.push('subject punctuation');
  }
  if (!body.startsWith(`Hi ${first},`)) e.push('greeting wrong');
  const sigRe = new RegExp(`Thanks,\\s*\\nAndrew Gordienko\\s*\\n${SIGNATURE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`);
  if (!sigRe.test(body)) e.push('signature wrong');
  const content = body.replace(/^Hi [^\n]*\n/, '').replace(sigRe, '').trim();
  const wc = wordCount(content);
  if (wc < 90 || wc > 145) e.push(`content ${wc} words (want 90-145)`);
  return e;
}

let rows = db.prepare(`
  SELECT p.id, p.first_name, p.name, p.title, p.role_type, p.relevance_reason,
         c.name AS company, c.city, c.industry, c.hypothesis, c.notes AS company_notes,
         (SELECT COUNT(*) FROM sequences s WHERE s.person_id = p.id AND s.touch = 1) AS has1
  FROM people p JOIN companies c ON c.id = p.company_id
  WHERE c.campaign = ? AND p.email LIKE '%@%'
  ORDER BY c.id, p.id
`).all(CAMPAIGN);
if (IDS.size) rows = rows.filter((row) => IDS.has(row.id));
if (EXISTING_ONLY) rows = rows.filter((row) => row.has1);
if (!REWRITE) rows = rows.filter((r) => !r.has1);

const units = [];
for (let i = 0; i < rows.length; i += BATCH) units.push(rows.slice(i, i + BATCH));

function prompt(batch) {
  return [
    "You are Andrew Gordienko's cold-outreach writer. Write ONLY touch 1, the first email, for each contact below.",
    'ROLE FIT IS ALREADY DECIDED. Every contact below has already been qualified as an operations, production, plant, manufacturing, maintenance, warehouse, or engineering MANAGER or DIRECTOR. They all have a strong, honest route to a bounded discovery call about factory automation. DEFAULT TO "write" for every single one. The do_not_contact and evidence-thinness gates in the shared rules are about role fit and about NOT ASSERTING a problem; they are NOT a reason to skip a qualified manager. Apply those gates only to HOW you write (facts only, no asserted problem, plain English), never to WHETHER to contact these managers.',
    'The public company description IS sufficient grounding. The endorsed touch-1 shape states that public fact and then asks a diagnostic question rather than asserting any company-specific problem, so the evidence requirement is satisfied for every contact. Use "do_not_contact" ONLY for a clearly unrelated role such as pure sales, HR, finance, IT, or marketing with no operations connection. An operations, production, plant, manufacturing, or maintenance manager or director is ALWAYS "write". Never skip one for thin evidence.',
    'Follow the campaign\'s evidence-led touch-1 standard. Start with one concrete public company fact or the role-relevant situation, ask one answerable diagnostic question, explain Wapahki in plain English, use one two-sentence CTA when asking for a 20-minute call, and include the full signature (Andrew Gordienko / ' + SIGNATURE + '). Do not use "I found you because" and do not force every contact into identical wording.',
    'GROUND THE OPENER IN THIS COMPANY. Each contact carries public_company_context. Use observed_signal (a real, source-backed note about how this operation runs) and industry to name what THIS company actually makes or runs in the "where [public fact]" clause and in the diagnostic choices. A bakery running many SKUs, a personal-care line switching pack formats, a meat plant handling different cuts. Never write a generic "your products" opener when the context names a real one. Treat observed_signal and account_hypothesis as private research that shapes the question, never as a claim about the recipient; do not quote the peer_example as FOMO.',
    'TUNE THE ANGLE AND CTA TO role_type (and the title if role_type is null). A floor, production, or maintenance person (champion / technical / null) is asked what they SEE FIRSTHAND on the line and gets the plain "an email reply would also be really helpful" close. A director, VP, head, or plant manager (economic_buyer) is asked which of these slows the operation most and gets a referral escape as the second CTA sentence: "If another team owns this more directly, an introduction would be incredibly helpful." Never send the same body shape to two different roles.',
    'Ground only on the public company context, which is fact, and ask which difficulty applies. Never assert a problem the contact has.',
    'Before writing, complete message_brief. Name the role route, rehearse the hardest credible question this person may ask about fit, proof, implementation, risk, or ownership, state what the supplied evidence supports and does not support, and choose one concrete next step if they confirm relevance. Use the brief to improve the email, but do not paste the private rehearsal into the copy.',
    'Vary the wording per contact. Do not reuse the example sentences verbatim.',
    '', '=== SHARED RULES ===', shared,
    '', '=== CAMPAIGN RULES ===', playbook,
    '', '=== CONTACTS ===', JSON.stringify(batch.map(ctx), null, 2),
    '', 'For each contact return contact_id, verdict, message_brief, subject (a specific 2-to-5-word topic in natural sentence case, preserving proper nouns and acronyms), and body (greeting, blank lines, and the full signature). Body content excluding greeting and signature should be 90 to 145 words. Return only the JSON the schema requires.',
  ].join('\n');
}

let cursor = 0; let wrote = 0; let skipped = 0; let rejected = 0; let failed = 0; let done = 0;
const writtenPersonIds = [];
const byId = new Map(rows.map((r) => [r.id, r]));

async function worker() {
  while (cursor < units.length) {
    const batch = units[cursor++];
    try {
      const res = await runCodex({ prompt: prompt(batch), schema, model: MODEL, reasoning: REASONING, cwd: root });
      for (const r of (res.results || [])) {
        const row = byId.get(Number(r.contact_id));
        if (!row) continue;
        if (r.verdict === 'do_not_contact') { skipped++; continue; }
        const first = row.first_name || String(row.name || '').split(/\s+/)[0];
        const errs = validate(first, r.subject, r.body || '');
        if (errs.length) { rejected++; console.log(`  rejected ${row.name}: ${errs.join('; ')}`); continue; }
        replaceTouch(row.id, CAMPAIGN, { touch: 1, day: 1, channel: 'email', subject: r.subject, body: r.body });
        updatePerson(row.id, { sales_brief: JSON.stringify(r.message_brief) });
        writtenPersonIds.push(row.id);
        wrote++;
      }
    } catch (e) {
      failed++;
      console.log(`  failed batch [${batch.map((b) => b.id).join(',')}]: ${e.message.split('\n')[0]}`);
    }
    done++;
    console.log(`  ${done}/${units.length} batches | wrote ${wrote} | skipped ${skipped} | rejected ${rejected} | failed ${failed}`);
  }
}

console.log(`touch-1 writer: ${CAMPAIGN} | ${rows.length} contacts | ${units.length} batches | model ${MODEL}/${REASONING} | concurrency ${CONCURRENCY}`);
await Promise.all(Array.from({ length: Math.max(1, CONCURRENCY) }, () => worker()));
console.log(`\nDone. Wrote ${wrote} touch-1 emails. Skipped ${skipped}; rejected ${rejected}; failed ${failed}.`);
if (writtenPersonIds.length) {
  console.log(`Running subject strategist + editor for ${writtenPersonIds.length} new ${CAMPAIGN} drafts.`);
  try {
    await personalizeWrittenSubjects({ root, campaign: CAMPAIGN, personIds: writtenPersonIds });
  } catch (error) {
    failed++;
    console.log(`Subject agents failed closed: ${error.message}`);
  }
}
if (failed) process.exitCode = 1;
