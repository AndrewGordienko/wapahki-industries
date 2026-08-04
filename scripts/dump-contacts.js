// Dumps all emailable contacts grouped by company into batch files for the
// blurb-writing agents. Each batch = 5 companies (~25 people).
import { listCompanies, listPeopleByCompany } from '../src/db.js';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const base = join(__dirname, '..', 'data', 'blurb');
rmSync(base, { recursive: true, force: true });
mkdirSync(join(base, 'batches'), { recursive: true });
mkdirSync(join(base, 'out'), { recursive: true });

const usable = (p) => p.email && p.email.includes('@');
const companies = listCompanies().map((c) => ({
  company: c.name,
  industry: c.industry,
  domain: c.domain,
  city: c.city,
  people: listPeopleByCompany(c.id).filter(usable).map((p) => ({
    id: p.id, name: p.name, title: p.title, linkedin: p.linkedin_url,
  })),
})).filter((c) => c.people.length);

const PER_BATCH = 5;
let n = 0;
for (let i = 0; i < companies.length; i += PER_BATCH) {
  n++;
  writeFileSync(join(base, 'batches', `batch-${n}.json`), JSON.stringify(companies.slice(i, i + PER_BATCH), null, 2));
}
const total = companies.reduce((a, c) => a + c.people.length, 0);
console.log(`Wrote ${n} batches covering ${total} contacts across ${companies.length} companies.`);
