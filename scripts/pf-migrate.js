// Problem Found migration (idempotent).
//   outagehub campaign  -> product = "outage" (Outage Response OS)
//   gnk campaign        -> product = NULL, archived (funnel retired; GNK is now a
//                          per-opportunity delivery partner, not a target funnel)
//   wapahki campaign     -> left untouched (non-destructive legacy robotics funnel)
//
// Also best-effort assigns each migrated contact a contact-map role so the
// account view has a populated buyer / champion / technical / referral map.
// Run:  node scripts/pf-migrate.js  [--dry-run]
import { db } from '../src/db.js';
import { classifyRole } from '../src/personas.js';

const DRY = process.argv.includes('--dry-run');
const run = (sql, ...a) => (DRY ? null : db.prepare(sql).run(...a));

// 1) Map campaigns -> products.
const CAMPAIGN_TO_PRODUCT = { outagehub: 'outage' };

let mapped = 0;
for (const [campaign, product] of Object.entries(CAMPAIGN_TO_PRODUCT)) {
  const rows = db.prepare('SELECT id FROM companies WHERE campaign = ?').all(campaign);
  for (const { id } of rows) {
    run("UPDATE companies SET product = ?, stage = COALESCE(NULLIF(stage,''),'Researched') WHERE id = ?", product, id);
    mapped++;
  }
  console.log(`${campaign} -> ${product}: ${rows.length} accounts`);
}

// 2) Retire gnk: clear product, tag notes so it drops out of every product tab.
const gnk = db.prepare("SELECT id FROM companies WHERE campaign = 'gnk'").all();
for (const { id } of gnk) {
  run("UPDATE companies SET product = NULL WHERE id = ?", id);
}
console.log(`gnk retired (product cleared): ${gnk.length} accounts`);

// 3) Assign contact-map roles for accounts that now have a product.
let roled = 0;
const withProduct = db.prepare('SELECT id, product FROM companies WHERE product IS NOT NULL').all();
for (const c of withProduct) {
  const people = db.prepare('SELECT id, title, role_type FROM people WHERE company_id = ?').all(c.id);
  for (const p of people) {
    if (p.role_type) continue; // don't clobber manual assignments
    const { role } = classifyRole(p.title, c.product);
    if (role) { run('UPDATE people SET role_type = ? WHERE id = ?', role, p.id); roled++; }
  }
}

// 4) Report product distribution.
const dist = db.prepare("SELECT product, COUNT(*) n FROM companies WHERE product IS NOT NULL GROUP BY product").all();
console.log(`\n${DRY ? '[dry-run] would map' : 'Mapped'}: ${mapped} accounts, ${roled} contact roles assigned.`);
console.log('Product distribution:', dist.map((d) => `${d.product}=${d.n}`).join(', ') || '(none)');
if (DRY) console.log('\n(dry run — no changes written)');
