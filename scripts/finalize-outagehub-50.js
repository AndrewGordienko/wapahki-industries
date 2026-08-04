// Finalize the research-driven OutageHub CRM tab at exactly 50 companies x
// exactly 5 verified/emailable contacts without spending more Apollo credits.
//
// The fresh board produced 38 full companies. Ten of those have especially weak
// contact maps, so this keeps the stronger 28 and promotes 22 already-enriched
// legacy OutageHub accounts from campaign="outage". All underfilled fresh-board
// rows and the ten weak full rows are removed. The legacy rows remain the same
// companies/people; only their campaign and OutageHub grounding are refreshed.
//
//   node scripts/finalize-outagehub-50.js          # dry run
//   node scripts/finalize-outagehub-50.js --apply  # mutate in one transaction
import { db, updateCompany } from '../src/db.js';

const APPLY = process.argv.includes('--apply');

// These accounts reached 5/5 numerically, but their contact maps are dominated
// by unrelated sales/HR/finance/IT/general corporate roles. Stronger, already
// verified legacy accounts replace them.
const DROP_FULL = new Set([
  'Canco Petroleum Ltd.',
  'ChargePoint Canada — OutageHub',
  'City of Edmonton — OutageHub',
  'Co-operators',
  'Dollarama',
  'Halifax Regional Municipality',
  'Lactanet Canada',
  'Medigas',
  'Rogers Communications',
  'Suncor Energy Inc. / Petro-Canada',
]);

// Legacy OutageHub accounts selected for clear outage exposure, useful public
// grounding, and the strongest available five-person contact maps.
const PROMOTE = new Map([
  ['Beanfield Metroconnect', 'Telecom backup-power orchestration'],
  ['Calgary Co-op (Calgary Co-operative Association Limited)', 'Distributed branch operations · Fuel-station availability · Cold-chain protection'],
  ['ColdStar Solutions Inc.', 'Cold-chain protection'],
  ['Genrep Ltd/Ltee', 'Generator and field-service dispatch'],
  ['Ledcor Technical Services (LTS)', 'Telecom backup-power orchestration'],
  ["MacEwen Petroleum Inc. (Quickie Convenience Stores)", 'Fuel-station availability'],
  ['Simson-Maxwell Ltd.', 'Generator and field-service dispatch'],
  ['Superior Propane', 'Generator and field-service dispatch'],
  ['Black & McDonald Limited', 'Property and resident response'],
  ['Eastlink (Bragg Communications Inc.)', 'Telecom backup-power orchestration'],
  ['FLO (AddÉnergie Technologies Inc.)', 'EV charging and fleet rerouting'],
  ['FirstService Residential (Canada)', 'Property and resident response'],
  ['M&M Food Market', 'Cold-chain protection'],
  ["Nature's Touch Frozen Foods", 'Cold-chain protection'],
  ['On The Run Charging (Parkland Corporation)', 'EV charging and fleet rerouting · Fuel-station availability'],
  ['Tbaytel', 'Telecom backup-power orchestration'],
  ['The North West Company', 'Distributed branch operations · Cold-chain protection'],
  ['Xplore Inc.', 'Telecom backup-power orchestration'],
  ['eStruxture Data Centers', 'Telecom backup-power orchestration'],
  ['Federated Co-operatives Limited (FCL) / Co-op Food Stores', 'Distributed branch operations · Fuel-station availability · Cold-chain protection'],
  ['Northwestel', 'Telecom backup-power orchestration'],
  ['Pelmorex Corp. — Alert Ready / NAAD System', 'Municipal and Indigenous mass notification'],
]);

const counts = () => db.prepare(`
  SELECT c.id, c.name, c.campaign, c.notes, c.target_titles,
         COUNT(CASE WHEN p.email LIKE '%@%' THEN 1 END) AS emailable
  FROM companies c LEFT JOIN people p ON p.company_id=c.id
  WHERE c.campaign IN ('outagehub', 'outage')
  GROUP BY c.id
`).all();

function decodeTitles(raw) {
  let value = raw;
  for (let i = 0; i < 3 && typeof value === 'string'; i++) {
    try { value = JSON.parse(value); } catch { return []; }
  }
  return Array.isArray(value) ? value : [];
}

function evidence(notes) {
  const raw = String(notes || '').trim();
  if (!raw) return '';
  const existingWhy = raw.match(/^Why this company:\s*(.+)$/m);
  if (existingWhy) return existingWhy[1].trim();
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.market_signal?.hook) return parsed.market_signal.hook;
  } catch { /* ordinary prose */ }
  return raw.replace(/^\[[^\]]+\]\s*/, '').replace(/\s+/g, ' ').trim();
}

const before = counts();
const fresh = before.filter((c) => c.campaign === 'outagehub');
const legacy = before.filter((c) => c.campaign === 'outage');
const remove = fresh.filter((c) => c.emailable < 5 || DROP_FULL.has(c.name));
const promote = [...PROMOTE].map(([name, problem]) => {
  const company = legacy.find((c) => c.name === name) || fresh.find((c) => c.name === name);
  if (!company) throw new Error(`Promotion candidate missing: ${name}`);
  if (company.emailable !== 5) throw new Error(`Promotion candidate is ${company.emailable}/5, expected 5/5: ${name}`);
  return { ...company, problem };
});
const retainedFresh = fresh.filter((c) => !remove.some((r) => r.id === c.id));
const projectedIds = new Set([...retainedFresh, ...promote].map((c) => c.id));

console.log(`OutageHub finalize ${APPLY ? 'APPLY' : 'DRY RUN'}`);
console.log(`  fresh board now: ${fresh.length} companies (${fresh.filter((c) => c.emailable === 5).length} at 5/5)`);
console.log(`  retain fresh: ${retainedFresh.length}`);
console.log(`  remove fresh: ${remove.length} (${remove.filter((c) => c.emailable < 5).length} underfilled + ${remove.filter((c) => DROP_FULL.has(c.name)).length} weak full)`);
console.log(`  promote verified legacy: ${promote.length}`);
console.log(`  projected final: ${projectedIds.size} companies`);

if (projectedIds.size !== 50) throw new Error(`Projected ${projectedIds.size} final companies, expected 50`);
if (!APPLY) {
  console.log('\nWeak full rows to remove:');
  for (const c of remove.filter((c) => DROP_FULL.has(c.name))) console.log(`  - ${c.name}`);
  console.log('\nLegacy rows to promote:');
  for (const c of promote) console.log(`  + ${c.name}`);
  process.exit(0);
}

db.exec('BEGIN IMMEDIATE');
try {
  const del = db.prepare('DELETE FROM companies WHERE id = ?');
  for (const c of remove) del.run(c.id);

  for (const c of promote) {
    const boardWhy = c.domain
      ? db.prepare('SELECT why_them FROM outagehub_targets WHERE lower(domain)=lower(?) ORDER BY id LIMIT 1').get(c.domain)?.why_them
      : '';
    const why = evidence(c.notes)
      || boardWhy
      || (c.name === 'Superior Propane' ? 'Superior Propane delivers propane across Canada through field operations teams.' : '');
    updateCompany(c.id, {
      campaign: 'outagehub',
      product: 'outage',
      notes: `OutageHub problem: ${c.problem}\nWhy this company: ${why}`,
      target_titles: decodeTitles(c.target_titles),
    });
  }

  // Normalize any target_titles values that the failed build double-encoded.
  for (const c of db.prepare("SELECT id,target_titles FROM companies WHERE campaign='outagehub'").all()) {
    updateCompany(c.id, { target_titles: decodeTitles(c.target_titles) });
  }

  // Keep sequence metadata aligned with the company tab. Touch 1 is rewritten
  // after finalization; any retained later touches still belong to OutageHub.
  db.prepare(`
    UPDATE sequences SET campaign='outagehub'
    WHERE person_id IN (
      SELECT p.id FROM people p JOIN companies c ON c.id=p.company_id
      WHERE c.campaign='outagehub'
    )
  `).run();

  const final = db.prepare(`
    SELECT COUNT(*) AS companies,
           SUM(CASE WHEN emailable=5 THEN 1 ELSE 0 END) AS exact_five,
           SUM(emailable) AS contacts
    FROM (
      SELECT c.id, COUNT(CASE WHEN p.email LIKE '%@%' THEN 1 END) AS emailable
      FROM companies c LEFT JOIN people p ON p.company_id=c.id
      WHERE c.campaign='outagehub'
      GROUP BY c.id
    )
  `).get();
  if (final.companies !== 50 || final.exact_five !== 50 || final.contacts !== 250) {
    throw new Error(`Final invariant failed: ${JSON.stringify(final)}`);
  }

  db.exec('COMMIT');
  console.log(`\nDone. OutageHub is ${final.companies} companies x 5/5 = ${final.contacts} verified contacts.`);
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
}
