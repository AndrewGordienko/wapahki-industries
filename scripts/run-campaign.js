// Source companies + build 5 emailable contacts each for a campaign.
//   zsh -ic 'node scripts/run-campaign.js gnk 30'
//   zsh -ic 'node scripts/run-campaign.js outagehub 25'
// Safe to re-run: companies already at 5/5 are skipped; under-5 are refilled.
import { getCampaign } from '../src/campaigns.js';
import { discoverCompanies } from '../src/discovery.js';
import { listCompanies, listPeopleByCompany } from '../src/db.js';
import { buildCompanyContacts } from '../src/pipeline.js';

const [, , name, limitArg] = process.argv;
if (!name) {
  console.log('usage: node scripts/run-campaign.js <campaign> [companyLimit]');
  process.exit(1);
}
const campaign = getCampaign(name); // throws on unknown campaign
const limit = Number(limitArg || 30);
const usable = (p) => p.email && p.email.includes('@');

console.log(`Campaign "${name}" — sourcing up to ${limit} companies…`);
const added = await discoverCompanies(campaign, { limit });
console.log(`Discovered ${added.length} new companies. Building 5 contacts each via Apollo…\n`);

let total = 0, full = 0;
for (const c of listCompanies(name)) {
  if (listPeopleByCompany(c.id).filter(usable).length >= 5) { full++; continue; }
  try {
    const r = await buildCompanyContacts(c.id, { limit: 5 });
    const n = r.people.filter(usable).length;
    total += n;
    if (n >= 5) full++;
    console.log(`  ${c.name}: ${n}/5${r.note ? '  (' + r.note + ')' : ''}`);
  } catch (e) {
    console.log(`  ${c.name}: ERROR ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 350));
}
console.log(`\nDone. Campaign "${name}": ${full} companies at 5/5.`);
