// Safely add a small role-balanced Wapahki contact map. Existing contacts and
// sequences are preserved; nothing is wiped during a sourcing refresh.
import { db } from '../src/db.js';
import { buildCompanyContacts } from '../src/pipeline.js';

const TARGET_TITLES = [
  'Plant Manager', 'Operations Manager', 'Production Manager', 'Director of Operations',
  'Director of Manufacturing', 'General Manager', 'Continuous Improvement Manager',
  'Engineering Manager', 'Maintenance Manager', 'Manufacturing Manager', 'Operations Director',
  'Plant Superintendent', 'Production Director', 'Site Manager', 'Warehouse Manager',
  'Production Supervisor', 'Maintenance Supervisor', 'Packaging Engineer', 'Process Engineer',
  'Manufacturing Engineer', 'MRO Buyer', 'Quality Supervisor', 'Continuous Improvement Lead',
];
const MIN_SCORE = 7;
const CONTACT_LIMIT = 3;

const companies = db.prepare("SELECT id, name FROM companies WHERE campaign = 'wapahki' ORDER BY id").all();

// 1) set role-balanced target titles on every Wapahki company
const setTitles = db.prepare('UPDATE companies SET target_titles = ? WHERE id = ?');
for (const c of companies) setTitles.run(JSON.stringify(TARGET_TITLES), c.id);
console.log(`set role-balanced titles on ${companies.length} companies`);

// 2) retain or source up to three strong routes per company.
let full = 0; let total = 0; let done = 0; const short = [];
for (const c of companies) {
  try {
    const r = await buildCompanyContacts(c.id, { limit: CONTACT_LIMIT, minScore: MIN_SCORE });
    total += r.kept;
    if (r.kept >= CONTACT_LIMIT) full++; else short.push(`${c.name} (${r.kept})`);
    console.log(`  [${++done}/${companies.length}] ${c.name}: ${r.kept}/${CONTACT_LIMIT}${r.note ? ` — ${r.note}` : ''}`);
  } catch (e) {
    short.push(`${c.name} (ERR)`);
    console.log(`  [${++done}/${companies.length}] ${c.name}: ERROR ${e.message.split('\n')[0]}`);
  }
}
console.log(`\nDone. ${full}/${companies.length} companies have ${CONTACT_LIMIT} strong routes. ${total} contacts retained or sourced.`);
if (short.length) console.log(`Short of ${CONTACT_LIMIT}: ${short.join(', ')}`);
