// Write follow-up touches (2, 3, 4) for every GnK contact that already has a
// touch-1, following the Problem Found outreach progression. Codex per-company
// batch; stored as sequence touches 2/3/4 so the full sequence shows in the CRM.
//   node scripts/write-gnk-followups.js [--limit N]
import { db, replaceTouch } from '../src/db.js';
import { runCodex } from '../src/codex.js';

const args = process.argv.slice(2);
const LIMIT = (() => { const i = args.indexOf('--limit'); return i >= 0 ? Number(args[i + 1]) : Infinity; })();
const MODEL = process.env.CODEX_MODEL || 'gpt-5.6-sol';

const schema = {
  type: 'object', additionalProperties: false, required: ['followups'],
  properties: {
    followups: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['contact_id', 'touches'],
        properties: {
          contact_id: { type: 'integer' },
          touches: {
            type: 'array',
            items: { type: 'object', additionalProperties: false, required: ['touch', 'subject', 'body'], properties: { touch: { type: 'integer' }, subject: { type: 'string' }, body: { type: 'string' } } },
          },
        },
      },
    },
  },
};

const rows = db.prepare(`
  SELECT p.id, p.name, p.title, p.company_id, c.name AS company, c.notes,
    (SELECT body FROM sequences WHERE person_id=p.id AND touch=1) AS t1body,
    (SELECT subject FROM sequences WHERE person_id=p.id AND touch=1) AS t1subj
  FROM people p JOIN companies c ON c.id=p.company_id
  WHERE c.campaign='gnk' AND p.email LIKE '%@%'
    AND EXISTS(SELECT 1 FROM sequences WHERE person_id=p.id AND touch=1)
    AND NOT EXISTS(SELECT 1 FROM sequences WHERE person_id=p.id AND touch=4)
`).all();

const byCompany = new Map();
for (const r of rows) { if (!byCompany.has(r.company_id)) byCompany.set(r.company_id, []); byCompany.get(r.company_id).push(r); }
const companies = [...byCompany.values()].slice(0, LIMIT);
console.log(`Follow-ups for ${rows.length} contacts across ${companies.length} companies…`);

function prompt(list) {
  const notes = list[0].notes || '';
  const people = list.map((p) => `--- contact_id ${p.id}: ${p.name}, ${p.title}\nTHEIR TOUCH-1 (subject: ${p.t1subj}):\n${p.t1body}`).join('\n\n');
  return `You write follow-up emails (touches 2, 3, 4) for GnK, a Canadian applied product studio. Each contact already received the touch-1 email shown below. Write the next three follow-ups per the progression:
- touch 2 (first follow-up): first try an assumption-led cost model when touch 1 provides a credible unit of work. Show rounded inputs and arithmetic in plain English, say "if" so the inputs cannot be mistaken for company facts, and ask whether the order of magnitude is right or whether most of the cost sits elsewhere. If the math would be forced, add one useful new observation, artifact idea, or lower-bar question instead. Do not repeat touch 1 or ask for a call. Reuse the exact touch-1 subject.
- touch 3 (second follow-up): briefly describe the proposed workflow / what we'd build, and ask whether it resembles their reality.
- touch 4 (final follow-up): ask to be pointed to the right person if they're not the owner, or gracefully close the thread. Keep it short.

COMPANY PRODUCT / PROBLEM CONTEXT:
${notes}

CONTACTS + their touch-1:
${people}

RULES: each 60-140 words; one person writing to another; workflow-first; NEVER say "AI" or name the technology; admit the hypothesis may be wrong; no bullet lists, no buzzwords; never "quick call", "revolutionize", "synergy", "circle back", "touch base"; subject short and in natural sentence case, preserving genuine proper nouns and acronyms. A modeled cost is a calibration device, never a claim or promised saving. Return {followups:[{contact_id, touches:[{touch:2,subject,body},{touch:3,...},{touch:4,...}]}]}.`;
}

const DAY = { 2: 4, 3: 9, 4: 16 };
let wrote = 0, failed = 0, done = 0;
for (const list of companies) {
  done++;
  try {
    const out = await runCodex({ prompt: prompt(list), schema, model: MODEL, reasoning: 'low', webSearch: false, timeoutMs: 180000, cwd: process.cwd() });
    const ids = new Set(list.map((p) => p.id));
    for (const f of out.followups || []) {
      if (!ids.has(f.contact_id)) continue;
      for (const t of f.touches || []) {
        if (![2, 3, 4].includes(t.touch)) continue;
        replaceTouch(f.contact_id, 'gnk', { touch: t.touch, day: DAY[t.touch], channel: 'email', subject: t.subject, body: t.body });
        wrote++;
      }
    }
    console.log(`  [${done}/${companies.length}] ${list[0].company} → +${(out.followups || []).reduce((n, f) => n + (f.touches || []).length, 0)} touches`);
  } catch (e) { failed++; console.log(`  ! ${list[0].company}: ${String(e.message).split('\n')[0]}`); }
}
console.log(`\nDone. Wrote ${wrote} follow-up touches, ${failed} companies failed.`);
