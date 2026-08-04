// Re-builds only the companies that currently have fewer than 5 emailable contacts.
// Already-found contacts are kept for free (no re-enrichment). Run with the key:
//   zsh -ic 'node scripts/fill-shortfalls.js'
import { listCompanies, listPeopleByCompany } from '../src/db.js';
import { buildCompanyContacts } from '../src/pipeline.js';

const usable = (p) => p.email && p.email.includes('@');
const TARGET = 5;

const short = listCompanies().filter((c) => listPeopleByCompany(c.id).filter(usable).length < TARGET);
console.log(`Re-filling ${short.length} companies under ${TARGET}…\n`);

let reached5 = 0;
const stillShort = [];
for (const c of short) {
  const before = listPeopleByCompany(c.id).filter(usable).length;
  try {
    const r = await buildCompanyContacts(c.id, { limit: TARGET });
    const after = r.people.filter(usable).length;
    console.log(`${c.name}: ${before} → ${after}/5${r.note ? '  (' + r.note + ')' : ''}`);
    if (after >= TARGET) reached5++; else stillShort.push(`${c.name} (${after}/5)`);
  } catch (e) {
    console.log(`${c.name}: ERROR ${e.message}`);
    stillShort.push(`${c.name} (error)`);
  }
  await new Promise((r) => setTimeout(r, 350));
}

console.log(`\n${reached5} companies reached 5/5.`);
console.log(`${stillShort.length} still short (candidates to replace):`);
stillShort.forEach((s) => console.log(`  - ${s}`));
