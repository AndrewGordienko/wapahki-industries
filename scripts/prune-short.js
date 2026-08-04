// Deletes every company that has fewer than 5 emailable contacts ("too small").
import { listCompanies, listPeopleByCompany, deleteCompany } from '../src/db.js';

const usable = (p) => p.email && p.email.includes('@');
const short = listCompanies().filter((c) => listPeopleByCompany(c.id).filter(usable).length < 5);

console.log(`Deleting ${short.length} companies under 5:`);
for (const c of short) {
  const n = listPeopleByCompany(c.id).filter(usable).length;
  console.log(`  - ${c.name} (${n}/5)`);
  deleteCompany(c.id);
}

const remaining = listCompanies();
const at5 = remaining.filter((c) => listPeopleByCompany(c.id).filter(usable).length >= 5).length;
console.log(`\nRemaining: ${remaining.length} companies (${at5} at 5/5).`);
