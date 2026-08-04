// Loads seed data into the database.
//   data/seed-companies.json       -> 10 vetted companies WITH 5 named people each
//   data/discovered-companies.json -> ~40 researched GTA companies (no people yet;
//                                     Apollo's "Find people" fills those in)
// Safe to run repeatedly — existing companies/people are updated, not duplicated.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { getCompanyByName, insertCompany, upsertPerson } from '../src/db.js';
import { scoreContact } from '../src/relevance.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, '..', 'data');
const read = (f) => JSON.parse(readFileSync(join(dataDir, f), 'utf8'));

// Default title lists to search in Apollo, keyed by industry tag.
const TITLES_BY_INDUSTRY = {
  'Contract packaging / co-packing': ['Production Supervisor', 'Packaging Supervisor', 'Project Manager', 'Operations Manager', 'Warehouse Supervisor', 'Continuous Improvement Specialist'],
  'Food manufacturing': ['Production Supervisor', 'Process Engineer', 'Maintenance Supervisor', 'Continuous Improvement Specialist', 'Sanitation Supervisor', 'Operations Manager'],
  'Cosmetics manufacturing / contract packaging': ['Process Engineer', 'Packaging Engineer', 'Production Supervisor', 'Quality Supervisor', 'Filling Line Supervisor', 'Project Manager'],
  'Contract manufacturing / CPG': ['Process Engineer', 'Production Supervisor', 'Quality Supervisor', 'Manufacturing Supervisor', 'Packaging Supervisor', 'Maintenance Supervisor'],
  'Logistics / fulfillment / 3PL': ['Warehouse Operations Supervisor', 'Fulfillment Supervisor', 'Inventory Coordinator', 'Logistics Coordinator', 'Operations Manager', 'Warehouse Manager'],
};
const FALLBACK_TITLES = ['Production Supervisor', 'Process Engineer', 'Operations Manager', 'Maintenance Manager', 'Warehouse Supervisor'];

let companiesAdded = 0;
let peopleAdded = 0;

// 1) Vetted companies (with named people)
for (const c of read('seed-companies.json')) {
  let company = getCompanyByName(c.name);
  if (!company) {
    company = insertCompany({
      name: c.name,
      city: c.city || null,
      location: c.location || 'Ontario, Canada',
      industry: c.industry || null,
      target_titles: c.target_titles || [],
      source: 'seed',
    });
    companiesAdded++;
  }
  for (const p of c.people || []) {
    const { score, reason } = scoreContact(p.title, c.name);
    upsertPerson({
      company_id: company.id, name: p.name, title: p.title,
      email_status: 'seed', relevance_score: score, relevance_reason: reason, status: 'new',
    });
    peopleAdded++;
  }
}

// 2) Discovered companies (no people yet)
for (const c of read('discovered-companies.json')) {
  if (getCompanyByName(c.name)) continue;
  insertCompany({
    name: c.name,
    city: c.city || null,
    location: 'Ontario, Canada',
    domain: c.domain || null,
    website: c.domain ? `https://${c.domain}` : null,
    industry: c.industry || null,
    target_titles: TITLES_BY_INDUSTRY[c.industry] || FALLBACK_TITLES,
    source: 'research',
  });
  companiesAdded++;
}

console.log(`Seeded: +${companiesAdded} companies, ${peopleAdded} people processed.`);
console.log('Start the app with:  npm start');
