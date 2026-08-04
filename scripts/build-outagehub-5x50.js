// Build the OutageHub campaign to TARGET companies each with 5 emailable,
// ops-relevant contacts. For each company: set role-correct target titles from
// its OutageHub problem type, drop clearly-weak existing contacts (sales, finance,
// marketing, HR, legal), then fill to 5 via Apollo people-search + enrichment.
// Processes in priority order and STOPS once TARGET companies reach 5/5, with a
// credit-safety cap. Spends Apollo credits.
//   node scripts/build-outagehub-5x50.js [--target 50] [--cap 260] [--dry-run]
import { db, listPeopleByCompany, updateCompany, deletePerson } from '../src/db.js';
import { buildCompanyContacts } from '../src/pipeline.js';

const args = process.argv.slice(2);
const numArg = (flag, def) => { const i = args.indexOf(flag); return i >= 0 ? Number(args[i + 1]) : def; };
const TARGET = numArg('--target', 50);
const CREDIT_CAP = numArg('--cap', 260);          // stop if we reveal ~this many new emails
const DRY = args.includes('--dry-run');

// OutageHub problem type -> ops-relevant Apollo person titles (fuzzy keyword match).
const OPS = ['VP Operations', 'Vice President Operations', 'Director of Operations', 'Operations Manager'];
const TITLES = [
  [/generator|field-service dispatch/i, [...OPS, 'Director of Field Service', 'Field Service Manager', 'Service Manager', 'Dispatch Manager']],
  [/ev charging|fleet rerouting/i, [...OPS, 'Network Operations Manager', 'Director of Charging Operations', 'Fleet Manager']],
  [/pharmacy|vaccine|cold-chain alert/i, ['Director of Pharmacy Operations', 'Pharmacy Operations Manager', 'Director of Supply Chain', 'Cold Chain Manager', ...OPS]],
  [/property and resident|resident response/i, [...OPS, 'Regional Operations Manager', 'Director of Facilities', 'Emergency Preparedness Manager', 'Director of Resident Experience']],
  [/cold-chain protection/i, ['Director of Supply Chain', 'Cold Chain Manager', 'Logistics Manager', 'Warehouse Manager', ...OPS]],
  [/long-term-care|ltc continuity/i, [...OPS, 'Director of Facilities', 'Emergency Preparedness Manager', 'Regional Director', 'Director of Environmental Services']],
  [/home medical-device|medical-device safety/i, [...OPS, 'Director of Patient Services', 'Clinical Operations Manager', 'Director of Supply Chain']],
  [/insurance|cat triage|loss prevention/i, ['Chief Claims Officer', 'VP Claims', 'Director of Claims', 'Head of Catastrophe', 'Catastrophe Manager', 'Director of Claims Operations']],
  [/water and wastewater|wastewater continuity/i, [...OPS, 'Director of Water Operations', 'Plant Manager', 'Emergency Preparedness Manager']],
  [/farm and greenhouse|greenhouse continuity/i, [...OPS, 'Grower Operations Manager', 'Facilities Manager', 'Production Manager']],
  [/telecom|backup-power orchestration/i, ['Director of Network Operations', 'VP Network Operations', 'NOC Manager', 'Network Operations Manager', 'Director of Field Operations']],
  [/fuel-station/i, ['Director of Retail Operations', ...OPS, 'Fuel Operations Manager', 'Regional Operations Manager', 'Terminal Manager']],
  [/distributed branch/i, [...OPS, 'Director of Retail Operations', 'Regional Operations Manager', 'Business Continuity Manager', 'Facilities Manager']],
  [/mass notification|municipal|indigenous/i, ['Emergency Management Coordinator', 'Director of Emergency Management', 'Emergency Preparedness Manager', 'Director of Public Works', 'Chief Administrative Officer']],
  [/traffic-signal|rail-crossing/i, ['Director of Transportation', 'Traffic Operations Manager', 'Director of Public Works', 'Signals Manager', 'Maintenance Manager']],
];
const FALLBACK = [...OPS, 'Director of Facilities', 'Emergency Preparedness Manager', 'Business Continuity Manager'];
const WEAK = /sales|marketing|finance|business development|human resources|\btalent\b|communications|\bbrand\b|treasur|controller|accounting|\blegal\b|counsel|chief financial|chief marketing|customer experience/i;

function titlesFor(notes) {
  const m = String(notes || '').match(/OutageHub problems?:\s*([^\n]+)/i);
  const prob = m ? m[1] : '';
  const picked = [];
  for (const [re, list] of TITLES) if (re.test(prob)) picked.push(...list);
  const uniq = [...new Set(picked.length ? picked : FALLBACK)];
  return uniq.slice(0, 8);
}
const emailable = (id) => listPeopleByCompany(id).filter((p) => p.email && p.email.includes('@')).length;

// Priority: companies with more existing emailable first (proven findable), then
// "national"/large orgs, then id. That reaches TARGET before spending on tiny orgs.
const companies = db.prepare("SELECT id, name, notes, industry, target_titles FROM companies WHERE campaign='outagehub'").all()
  .map((c) => ({ ...c, have: emailable(c.id), big: /national|canada|provincial|network|insurer|grocery|retail/i.test(c.industry || '') ? 1 : 0 }))
  .sort((a, b) => b.have - a.have || b.big - a.big || a.id - b.id);

console.log(`build-outagehub-5x50: ${companies.length} candidates | target ${TARGET} at 5/5 | credit cap ${CREDIT_CAP}${DRY ? ' | DRY RUN' : ''}`);

let atFive = companies.filter((c) => c.have >= 5).length;
let revealed = 0, processed = 0, deleted = 0;

for (const c of companies) {
  if (atFive >= TARGET) { console.log(`\nReached ${TARGET} companies at 5/5 — stopping.`); break; }
  if (c.have >= 5) continue; // already full
  if (revealed >= CREDIT_CAP) { console.log(`\nHit credit cap (~${revealed} emails revealed) — stopping.`); break; }

  const titles = titlesFor(c.notes);
  const weakPeople = listPeopleByCompany(c.id).filter((p) => WEAK.test(p.title || ''));
  processed++;

  if (DRY) {
    console.log(`  [dry] ${c.name} (have ${c.have}) titles=${JSON.stringify(titles)} would drop ${weakPeople.length} weak`);
    continue;
  }

  // updateCompany owns JSON serialization for target_titles. Passing a JSON
  // string here double-encodes it and leaves the pipeline with no usable titles.
  updateCompany(c.id, { target_titles: titles });
  for (const p of weakPeople) { deletePerson(p.id); deleted++; }

  const before = emailable(c.id);
  try {
    await buildCompanyContacts(c.id, { limit: 5 });
  } catch (e) {
    if (/insufficient|credit|422/i.test(e.message)) { console.log(`  ! ${c.name}: ${e.message.split('\n')[0]} — stopping (out of credits).`); break; }
    console.log(`  ! ${c.name}: ${e.message.split('\n')[0]}`);
    await new Promise((r) => setTimeout(r, 400));
    continue;
  }
  const after = emailable(c.id);
  revealed += Math.max(0, after - before);
  if (after >= 5) atFive++;
  console.log(`  ${c.name}: ${after}/5${after > before ? ` (+${after - before})` : ''} | at5/5: ${atFive} | ~revealed ${revealed}`);
  await new Promise((r) => setTimeout(r, 400));
}

// Clean any sequences orphaned by weak-contact deletion.
if (!DRY) db.prepare('DELETE FROM sequences WHERE person_id NOT IN (SELECT id FROM people)').run();

const finalAtFive = db.prepare("SELECT COUNT(*) n FROM (SELECT c.id FROM companies c JOIN people p ON p.company_id=c.id AND p.email LIKE '%@%' WHERE c.campaign='outagehub' GROUP BY c.id HAVING COUNT(*)>=5)").get().n;
const totalEmailable = db.prepare("SELECT COUNT(*) n FROM people p JOIN companies c ON c.id=p.company_id WHERE c.campaign='outagehub' AND p.email LIKE '%@%'").get().n;
console.log(`\nDone. Processed ${processed} companies, deleted ${deleted} weak contacts, ~${revealed} emails revealed.`);
console.log(`OutageHub now: ${finalAtFive} companies at 5/5 | ${totalEmailable} emailable contacts total.`);
