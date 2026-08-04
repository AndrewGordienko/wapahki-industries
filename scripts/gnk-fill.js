// Parallel contact filler for GNK. Watches the gnk funnel and, for each company that
// has fewer than 5 emailable contacts, finds the right senior people + emails via Apollo
// and writes a per-contact blurb from that org's opportunity dossier (company.notes).
// Runs alongside the scout — contacts trickle in under companies as they're found.
//   zsh -ic 'node scripts/gnk-fill.js'
import { listCompanies, listPeopleByCompany, updatePerson, getCompany } from '../src/db.js';
import { buildCompanyContacts } from '../src/pipeline.js';

const usable = (p) => p.email && p.email.includes('@');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const safeParse = (s) => { try { return JSON.parse(s); } catch { return {}; } };
const shorten = (s, n = 130) => { s = (s || '').trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s; };

function blurbFor(d, p) {
  const org = d.org || 'the company';
  const prob = shorten(d.defensible_problem, 140);
  const proj = shorten(d.ai_project, 140);
  return `As ${p.title || 'a technical leader'} at ${org}, you're close to this: ${prob} We'd propose: ${proj} — scoped as a small paid pilot (don't pay if it doesn't work). Worth a short call?`;
}

async function fillCompany(company) {
  const dossier = safeParse(company.notes);
  await buildCompanyContacts(company.id, { limit: 5 });
  for (const p of listPeopleByCompany(company.id)) {
    if (usable(p)) updatePerson(p.id, { relevance_reason: blurbFor(dossier, p) });
  }
  return listPeopleByCompany(company.id).filter(usable).length;
}

const IDLE_LIMIT = 15;   // ~5 min of nothing-to-do before we stop (survives gaps between scout waves)
const attempted = new Set(); // attempt each company ONCE — never retry ones Apollo can't fill
let idle = 0;
let filled = 0;
console.log('gnk-fill watching the GNK funnel…');

while (idle < IDLE_LIMIT) {
  const todo = listCompanies('gnk').filter((c) => !attempted.has(c.id) && listPeopleByCompany(c.id).filter(usable).length < 5);
  if (!todo.length) {
    idle++;
    await sleep(20000);
    continue;
  }
  idle = 0;
  for (const c of todo) {
    attempted.add(c.id);
    try {
      const n = await fillCompany(getCompany(c.id));
      filled += n;
      console.log(`  ${c.name}: ${n}/5 contacts + blurbs`);
    } catch (e) {
      console.log(`  ${c.name}: ERROR ${e.message.split('\n')[0]}`);
    }
    await sleep(400);
  }
}
console.log(`\ngnk-fill done. ~${filled} contacts filled across the GNK funnel.`);
