// Seed the Opposition Workbench (football) pipeline from researched, source-backed
// Championship / smaller-PL club accounts in data/football-accounts.json.
// Idempotent: existing accounts are refreshed, not duplicated. Accounts are left
// at stage "Researched" and UNSCORED — Andrew scores each against the rubric, and
// the outreach gate stays closed until he does. Every signal is source-cited in notes.
//   node scripts/seed-football.js [--dry-run]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { getCompanyByName, insertCompany, updateCompany } from '../src/db.js';
import { getProduct } from '../src/products.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DRY = process.argv.includes('--dry-run');
const clubs = JSON.parse(readFileSync(join(__dirname, '..', 'data', 'football-accounts.json'), 'utf8'));
const targetTitles = getProduct('football').target_titles;

const domainOf = (url) => (url || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '') || null;

let added = 0, updated = 0;
for (const c of clubs) {
  const signals = [c.one_signal, ...(c.extra_signals || []).map((s) => s.text)].filter(Boolean);
  const sources = [c.signal_url, ...(c.extra_signals || []).map((s) => s.url)].filter(Boolean);
  const notes = [
    c.fit_notes,
    `Confidence: ${c.confidence}.`,
    'Sources:',
    ...sources.map((u) => `- ${u}`),
  ].join('\n');

  let company = getCompanyByName(c.name);
  if (DRY) { console.log(`${company ? 'update' : 'add'}: ${c.name} — ${signals.length} signals, conf ${c.confidence}`); continue; }

  if (!company) {
    company = insertCompany({
      name: c.name, city: c.city || null, location: 'United Kingdom',
      website: c.website || null, domain: domainOf(c.website),
      industry: 'Professional football club', source: 'research',
      campaign: 'football', notes, target_titles: targetTitles,
    });
    added++;
  } else { updated++; }

  updateCompany(company.id, {
    product: 'football', hypothesis: c.hypothesis, signals, stage: 'Researched', notes,
  });
}

console.log(`${DRY ? '[dry-run] ' : ''}Football pipeline: +${added} added, ${updated} refreshed (${clubs.length} clubs, all left Researched + unscored).`);
