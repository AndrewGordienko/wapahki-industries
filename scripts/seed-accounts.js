// Generic account seeder for any Problem Found product.
//   node scripts/seed-accounts.js <product> [--dry-run]
// Reads data/<product>-accounts.json (an array of researched, source-cited orgs)
// and loads them as accounts under that product. Idempotent (refresh, don't
// duplicate). Accounts land at stage "Researched" and UNSCORED so the outreach
// gate stays closed until Andrew scores them. Every signal is source-cited in notes.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { getCompanyByName, insertCompany, updateCompany } from '../src/db.js';
import { getProduct } from '../src/products.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const product = process.argv[2];
const DRY = process.argv.includes('--dry-run');
if (!product || product.startsWith('--')) {
  console.error('Usage: node scripts/seed-accounts.js <product> [--dry-run]');
  process.exit(1);
}

const file = join(__dirname, '..', 'data', `${product}-accounts.json`);
if (!existsSync(file)) { console.error(`No seed file: data/${product}-accounts.json`); process.exit(1); }
const rows = JSON.parse(readFileSync(file, 'utf8'));
const p = getProduct(product); // throws on unknown product
const targetTitles = p.target_titles || [];

// Rough per-product default "industry" + org_type → readable label.
const ORG_TYPE_LABEL = {
  developer: 'Real estate developer', contractor: 'General contractor / EPC',
  infrastructure_owner: 'Infrastructure owner', claims_consultancy: 'Construction claims consultancy',
  surety_insurer: 'Surety / lender / insurer',
};
const DEFAULT_INDUSTRY = { football: 'Professional football club', delay: 'Construction', row: 'Real estate development', outage: 'Field service / operations' };
const DEFAULT_LOCATION = { football: 'United Kingdom', delay: 'North America', row: 'Toronto, Canada', outage: 'North America' };

const domainOf = (url) => (url || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '') || null;

let added = 0, updated = 0;
for (const c of rows) {
  const signals = [c.one_signal, ...(c.extra_signals || []).map((s) => s.text)].filter(Boolean);
  const sources = [c.signal_url, ...(c.extra_signals || []).map((s) => s.url)].filter(Boolean);
  const industry = c.org_type ? ORG_TYPE_LABEL[c.org_type] || DEFAULT_INDUSTRY[product] : DEFAULT_INDUSTRY[product];
  const notes = [
    c.fit_notes,
    c.org_type ? `Type: ${ORG_TYPE_LABEL[c.org_type] || c.org_type}.` : null,
    `Confidence: ${c.confidence}.`,
    'Sources:',
    ...sources.map((u) => `- ${u}`),
  ].filter(Boolean).join('\n');

  if (DRY) { console.log(`${getCompanyByName(c.name) ? 'update' : 'add'}: ${c.name} — ${signals.length} signals, ${c.confidence}${c.org_type ? ', ' + c.org_type : ''}`); continue; }

  let company = getCompanyByName(c.name);
  if (!company) {
    company = insertCompany({
      name: c.name, city: c.city || null, location: DEFAULT_LOCATION[product] || null,
      website: c.website || null, domain: domainOf(c.website), industry,
      source: 'research', campaign: product, notes, target_titles: targetTitles,
    });
    added++;
  } else { updated++; }
  updateCompany(company.id, { product, hypothesis: c.hypothesis, signals, stage: 'Researched', notes });
}

console.log(`${DRY ? '[dry-run] ' : ''}${product} pipeline: +${added} added, ${updated} refreshed (${rows.length} orgs, Researched + unscored).`);
