// Reconcile the OutageHub list toward 50 x 5/5.
//   zsh -ic 'node scripts/reconcile-outagehub.js'
// A) Retry big orgs that Apollo mis-matched by NAME, forcing a DOMAIN-only people search.
// B) Drop the FCL near-duplicate + genuinely-small operators (per the 5-emailable rule).
import { getCampaign } from '../src/campaigns.js';
import * as apollo from '../src/apollo.js';
import {
  getCompanyByName, listPeopleByCompany, upsertPerson, deleteCompany, updateCompany, listCompanies,
} from '../src/db.js';

const usable = (p) => p.email && p.email.includes('@');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const titles = getCampaign('outagehub').target_titles || [];

// seniority score (mirrors pipeline.scoreCandidate for non-wapahki campaigns)
function score(title) {
  const t = (title || '').toLowerCase();
  if (/\b(chief|cto|cio|ciso|founder|co-?founder|vp|vice president|head of)\b/.test(t)) return 10;
  if (/\b(director|principal|staff|architect)\b/.test(t)) return 9;
  if (/\b(lead|manager|senior|sr\.?)\b/.test(t)) return 7;
  return 5;
}

const RETRY = [
  ['Farm Boy', 'farmboy.ca'],
  ['Core Data Centres', 'coredatacenters.ca'],
  ['FirstService Residential (Canada)', 'fsresidential.com'],
  ['Le Circuit électrique / The Electric Circuit (Hydro-Québec)', 'lecircuitelectrique.com'],
  ['Comtech Solacom Technologies Inc.', 'solacom.com'],
];
const DROP = [
  'Co-op Connect (Federated Co-operatives Limited)', // near-duplicate of FCL (already 5/5)
  'LM Power Generating Co. Ltd.',
  'Maritime Cold Storage',
  'CenterPort Cold Storage',
  'SureCharge (SureTek Electric & Technologies Ltd.)',
  'ICEsoft Technologies Canada Corp. — Voyent Alert!',
];

async function retryByDomain(name, domain) {
  const co = getCompanyByName(name);
  if (!co) { console.log(`  ? not found: ${name}`); return; }
  updateCompany(co.id, { domain, apollo_org_id: null }); // key on domain, not the stale name-match
  const have = listPeopleByCompany(co.id).filter(usable).length;
  const need = 5 - have;
  if (need <= 0) { console.log(`  = ${name}: already ${have}/5`); return; }

  let cands = await apollo.searchPeople({ titles, domains: [domain], locations: ['Canada'], perPage: 25 }).catch(() => []);
  if (cands.filter((c) => c.has_email).length < need) {
    const wide = await apollo.searchPeople({ domains: [domain], perPage: 25 }).catch(() => []);
    const seen = new Set(cands.map((c) => c.id));
    cands = cands.concat(wide.filter((c) => !seen.has(c.id)));
  }
  const existing = new Set(listPeopleByCompany(co.id).map((p) => p.apollo_person_id).filter(Boolean));
  const pick = cands.filter((c) => c.id && c.has_email && !existing.has(c.id))
    .sort((a, b) => score(b.title) - score(a.title)).slice(0, need + 2);
  const matches = pick.length ? await apollo.enrichByIds(pick.map((c) => c.id)) : [];

  let added = 0;
  for (const m of matches) {
    if (added >= need) break;
    if (!m || !apollo.isUsableEmail(m.email)) continue;
    upsertPerson({
      company_id: co.id, name: m.name, first_name: m.first_name, last_name: m.last_name,
      title: m.title, email: m.email, email_status: m.email_status || 'verified',
      linkedin_url: m.linkedin_url, apollo_person_id: m.id, relevance_score: score(m.title), relevance_reason: '',
    });
    added++;
  }
  const now = listPeopleByCompany(co.id).filter(usable).length;
  console.log(`  ${name}: ${now}/5  (+${added})`);
}

console.log('=== A) Retry big orgs by DOMAIN ===');
for (const [name, domain] of RETRY) { await retryByDomain(name, domain); await sleep(350); }

console.log('\n=== B) Drop duplicate + genuinely-small ===');
for (const name of DROP) {
  const co = getCompanyByName(name);
  if (co) { deleteCompany(co.id); console.log(`  - dropped: ${name}`); }
  else console.log(`  ? not found: ${name}`);
}

const cos = listCompanies('outagehub');
const full = cos.filter((c) => listPeopleByCompany(c.id).filter(usable).length >= 5).length;
console.log(`\nAfter reconcile: ${cos.length} companies, ${full} at 5/5. Need ${50 - cos.length} replacements to restore 50.`);
