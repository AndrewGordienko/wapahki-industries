// Adds replacement companies until we reach TARGET_TOTAL companies at 5/5.
// For each candidate: insert -> build -> keep if 5/5, else delete. Run with the key:
//   zsh -ic 'node scripts/add-candidates.js'
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { listCompanies, listPeopleByCompany, getCompanyByName, insertCompany, deleteCompany } from '../src/db.js';
import { buildCompanyContacts } from '../src/pipeline.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const candidates = JSON.parse(readFileSync(join(__dirname, '..', 'data', 'replacement-candidates.json'), 'utf8'));

const TARGET_TOTAL = 50;
const usable = (p) => p.email && p.email.includes('@');
const at5 = () => listCompanies().filter((c) => listPeopleByCompany(c.id).filter(usable).length >= 5).length;

const TITLES = {
  'Contract packaging / co-packing': ['Production Supervisor', 'Packaging Supervisor', 'Project Manager', 'Operations Manager', 'Warehouse Supervisor', 'Continuous Improvement Specialist'],
  'Food manufacturing': ['Production Supervisor', 'Process Engineer', 'Maintenance Supervisor', 'Continuous Improvement Specialist', 'Sanitation Supervisor', 'Operations Manager'],
  'Cosmetics manufacturing / contract packaging': ['Process Engineer', 'Packaging Engineer', 'Production Supervisor', 'Quality Supervisor', 'Filling Line Supervisor', 'Project Manager'],
  'Contract manufacturing / CPG': ['Process Engineer', 'Production Supervisor', 'Quality Supervisor', 'Manufacturing Supervisor', 'Packaging Supervisor', 'Maintenance Supervisor'],
  'Logistics / fulfillment / 3PL': ['Warehouse Operations Supervisor', 'Fulfillment Supervisor', 'Inventory Coordinator', 'Logistics Coordinator', 'Operations Manager', 'Warehouse Manager'],
};
const FALLBACK = ['Production Supervisor', 'Process Engineer', 'Operations Manager', 'Maintenance Supervisor', 'Warehouse Supervisor'];

console.log(`Starting at ${at5()} companies at 5/5. Target ${TARGET_TOTAL}.\n`);
let kept = 0;
for (const cand of candidates) {
  if (at5() >= TARGET_TOTAL) { console.log('\nTarget reached — stopping.'); break; }
  if (getCompanyByName(cand.name)) { console.log(`skip  ${cand.name} (already present)`); continue; }

  const company = insertCompany({
    name: cand.name, city: cand.city, location: 'Ontario, Canada',
    domain: cand.domain || null, website: cand.domain ? `https://${cand.domain}` : null,
    industry: cand.industry, source: 'replacement',
    target_titles: TITLES[cand.industry] || FALLBACK,
  });
  try {
    const r = await buildCompanyContacts(company.id, { limit: 5 });
    const n = r.people.filter(usable).length;
    if (n >= 5) { kept++; console.log(`KEEP  ${cand.name} → ${n}/5   [total 5/5: ${at5()}]`); }
    else { deleteCompany(company.id); console.log(`drop  ${cand.name} → ${n}/5 (too small, deleted)`); }
  } catch (e) {
    deleteCompany(company.id);
    console.log(`drop  ${cand.name} → ERROR ${e.message} (deleted)`);
  }
  await new Promise((r) => setTimeout(r, 350));
}

console.log(`\nAdded ${kept} companies. Now ${at5()} companies at 5/5 (${listCompanies().length} total in DB).`);
