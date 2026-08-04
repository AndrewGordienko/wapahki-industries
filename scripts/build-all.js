// Builds up to 5 emailable, currently-employed contacts for EVERY company via Apollo
// (search + enrich). Spends Apollo credits. Run with the key in the environment:
//   zsh -ic 'node scripts/build-all.js'
import { listCompanies } from '../src/db.js';
import { buildCompanyContacts } from '../src/pipeline.js';

const companies = listCompanies();
console.log(`Building contacts for ${companies.length} companies…\n`);

let totalEmails = 0;
let done = 0;
const shortfalls = [];

for (const c of companies) {
  done++;
  const tag = `[${String(done).padStart(2)}/${companies.length}] ${c.name}`;
  try {
    const r = await buildCompanyContacts(c.id, { limit: 5 });
    const emails = r.people.filter((p) => p.email && p.email.includes('@')).length;
    totalEmails += emails;
    console.log(`${tag} → ${emails}/5 emailable${r.note ? '  (' + r.note + ')' : ''}`);
    if (emails < 5) shortfalls.push(`${c.name}: ${emails}/5`);
  } catch (e) {
    console.log(`${tag} → ERROR: ${e.message}`);
    shortfalls.push(`${c.name}: error`);
  }
  await new Promise((r) => setTimeout(r, 350)); // be gentle on rate limits
}

console.log(`\n──────────────────────────────`);
console.log(`Done. ${totalEmails} emailable contacts across ${companies.length} companies.`);
if (shortfalls.length) {
  console.log(`\nCompanies with fewer than 5 (thin Apollo coverage):`);
  shortfalls.forEach((s) => console.log(`  - ${s}`));
}
