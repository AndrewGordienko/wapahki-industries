// Backfill OutageHub to 50 companies x 5/5, tier-balanced toward 20/20/10.
//   zsh -ic 'node scripts/backfill-outagehub.js'
// Drops the un-fillable stragglers, tops up near-misses, then Apollo-discovers bigger
// operators in the ICP segments and keeps only those that reach 5/5.
import { getCampaign } from '../src/campaigns.js';
import { discoverCompanies } from '../src/discovery.js';
import { getCompanyByName, listCompanies, listPeopleByCompany, deleteCompany, updateCompany } from '../src/db.js';
import { buildCompanyContacts } from '../src/pipeline.js';

const usable = (p) => p.email && p.email.includes('@');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const campaign = getCampaign('outagehub');
const TARGET = 50;
const TIER_TARGET = { easy: 20, medium: 20, hard: 10 };
const TIERLBL = { easy: '30-day', medium: '60-day', hard: '90-day' };

const tierOf = (co) => ({ '30-day': 'easy', '60-day': 'medium', '90-day': 'hard' }[(co.industry || '').slice(0, 6)] || 'easy');
const full5 = () => listCompanies('outagehub').filter((c) => listPeopleByCompany(c.id).filter(usable).length >= 5);
function counts() { const t = { easy: 0, medium: 0, hard: 0 }; for (const c of full5()) t[tierOf(c)]++; return t; }
function mostUnderTier() {
  const c = counts();
  return ['easy', 'medium', 'hard'].filter((t) => c[t] < TIER_TARGET[t]).sort((a, b) => (TIER_TARGET[b] - c[b]) - (TIER_TARGET[a] - c[a]))[0] || 'easy';
}

// 1) drop the un-fillable stragglers
for (const name of ['Core Data Centres', 'Le Circuit électrique / The Electric Circuit (Hydro-Québec)', 'Farm Boy']) {
  const co = getCompanyByName(name);
  if (co) { deleteCompany(co.id); console.log(`- dropped (Apollo un-fillable): ${name}`); }
}
// 2) top up any remaining near-miss (e.g. Comtech 4/5)
for (const co of listCompanies('outagehub')) {
  if (listPeopleByCompany(co.id).filter(usable).length < 5) {
    try { const r = await buildCompanyContacts(co.id, { limit: 5 }); console.log(`  topup ${co.name}: ${r.people.filter(usable).length}/5`); } catch { /* keep */ }
    await sleep(300);
  }
}
console.log(`After drop/topup: ${full5().length} at 5/5, tiers=${JSON.stringify(counts())}`);

// 3) discover + build until 50 at 5/5
console.log('\n=== Backfilling via Apollo discovery ===');
let guard = 0;
while (full5().length < TARGET && guard < 5) {
  guard++;
  const need = TARGET - full5().length;
  const added = await discoverCompanies(campaign, { limit: need + 8 });
  console.log(`round ${guard}: discovered ${added.length} candidate orgs`);
  if (!added.length) break;
  for (const co of added) {
    if (full5().length >= TARGET) { deleteCompany(co.id); continue; }
    let n = 0;
    try { const r = await buildCompanyContacts(co.id, { limit: 5 }); n = r.people.filter(usable).length; } catch { n = 0; }
    if (n >= 5) {
      const tier = mostUnderTier();
      const seg = (co.industry || '').replace(/^\d\d?-day · /, '') || 'Outage-exposed operations';
      updateCompany(co.id, { industry: `${TIERLBL[tier]} · ${seg}` });
      console.log(`  + kept [${TIERLBL[tier]}] ${co.name} (${n}/5)`);
    } else {
      deleteCompany(co.id);
    }
    await sleep(300);
  }
}
console.log(`\nBackfill done: ${full5().length}/50 at 5/5. tiers=${JSON.stringify(counts())}`);
