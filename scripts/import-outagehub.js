// Trickle the OpenClaw-researched OutageHub 50 into the CRM, then build contacts.
//   zsh -ic 'node scripts/import-outagehub.js'
// Phase 1: insert companies ONE BY ONE (tier-tagged) so they appear live on localhost.
// Phase 2: build up to 5 emailable Apollo contacts per company (contacts trickle in).
// Safe to re-run: existing companies are skipped; companies already at 5/5 are skipped.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getCampaign } from '../src/campaigns.js';
import { insertCompany, getCompanyByName, listCompanies, listPeopleByCompany } from '../src/db.js';
import { buildCompanyContacts } from '../src/pipeline.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CAMPAIGN = 'outagehub';
const TIERLBL = { easy: '30-day', medium: '60-day', hard: '90-day' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const usable = (p) => p.email && p.email.includes('@');

const companies = JSON.parse(readFileSync(join(__dirname, '..', 'data', 'outagehub-candidates.json'), 'utf8'));
const campaign = getCampaign(CAMPAIGN);
const targetTitles = campaign.target_titles || [];

// ---- Phase 1: companies trickle in ----
console.log(`\n=== Phase 1: inserting ${companies.length} companies (watch localhost:8787 → OutageHub) ===`);
let inserted = 0;
for (const c of companies) {
  const name = (c.org || '').trim();
  if (!name || getCompanyByName(name)) { console.log(`  · skip (exists): ${name}`); continue; }
  const notes = [
    `[${TIERLBL[c.close_tier] || c.close_tier}] ${c.outage_problem || ''}`,
    c.evidence ? `Evidence: ${c.evidence}${c.source_url ? ' (' + c.source_url + ')' : ''}` : '',
    c.value_unit ? `Price: ${c.value_unit}` : '',
    c.budget_signal ? `Budget: ${c.budget_signal} [${c.budget_confidence || '?'}]` : '',
    (c.ideal_contacts && c.ideal_contacts.length) ? `Ideal: ${c.ideal_contacts.join(', ')}` : '',
  ].filter(Boolean).join('\n');

  insertCompany({
    name,
    domain: c.domain || null,
    website: c.domain ? `https://${c.domain}` : null,
    city: c.hq || null,
    location: (campaign.discovery && campaign.discovery.locations && campaign.discovery.locations[0]) || 'Canada',
    industry: `${TIERLBL[c.close_tier] || ''} · ${c.segment || ''}`.trim(),
    source: 'openclaw',
    campaign: CAMPAIGN,
    target_titles: targetTitles,
    notes,
  });
  inserted++;
  console.log(`  + [${TIERLBL[c.close_tier]}] ${name}  (${c.hq || ''})`);
  await sleep(900); // let the 5s UI poll show them arriving one by one
}
console.log(`Phase 1 done: ${inserted} new companies inserted.`);

// ---- Phase 2: contacts trickle in ----
console.log(`\n=== Phase 2: building up to 5 Apollo contacts per company ===`);
let full = 0, totalContacts = 0;
for (const co of listCompanies(CAMPAIGN)) {
  const have = listPeopleByCompany(co.id).filter(usable).length;
  if (have >= 5) { full++; continue; }
  try {
    const r = await buildCompanyContacts(co.id, { limit: 5 });
    const n = r.people.filter(usable).length;
    totalContacts += n;
    if (n >= 5) full++;
    console.log(`  ${co.name}: ${n}/5${r.note ? '  (' + r.note + ')' : ''}`);
  } catch (e) {
    console.log(`  ${co.name}: ERROR ${e.message}`);
  }
  await sleep(350);
}
console.log(`\nDone. OutageHub: ${full} companies at 5/5, ${totalContacts} contacts built this run.`);
