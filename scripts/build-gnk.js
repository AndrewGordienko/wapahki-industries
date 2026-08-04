// Apollo pass for the GnK funnel: find emailable contacts at the companies tied
// to the top-N highest-scored ideas (user chose the "top ~25 ideas" scope).
// Uses the same pipeline as the wapahki CRM. SPENDS APOLLO CREDITS.
//   node scripts/build-gnk.js [--top 25] [--limit 5]
import { listProblems } from '../src/problems.js';
import { db } from '../src/db.js';
import * as pipeline from '../src/pipeline.js';

const args = process.argv.slice(2);
const num = (flag, def) => { const i = args.indexOf(flag); return i >= 0 ? Number(args[i + 1]) : def; };
const TOPN = num('--top', 25);
const LIMIT = num('--limit', 5);

const top = new Set(listProblems().slice(0, TOPN).map((p) => p.title));
const companies = db.prepare("SELECT * FROM companies WHERE campaign='gnk'").all()
  .filter((c) => { const m = (c.notes || '').match(/^Idea:\s*(.+)$/m); return m && top.has(m[1].trim()); });

console.log(`Apollo build: ${companies.length} companies across the top ${TOPN} ideas (limit ${LIMIT}/company).`);
const emailCount = (id) => db.prepare("SELECT COUNT(*) n FROM people WHERE company_id=? AND email LIKE '%@%'").get(id).n;

const REDO = args.includes('--rewrite');
let done = 0, withContacts = 0, totalContacts = 0, failed = 0, skipped = 0;
for (const c of companies) {
  done++;
  if (!REDO && emailCount(c.id) >= 1) { skipped++; continue; } // already has contacts
  try {
    await pipeline.buildCompanyContacts(c.id, { limit: LIMIT });
    const n = emailCount(c.id);
    if (n) { withContacts++; totalContacts += n; }
    console.log(`  [${done}/${companies.length}] ${c.name} → ${n} emailable`);
  } catch (e) {
    failed++;
    console.log(`  ! [${done}/${companies.length}] ${c.name}: ${String(e.message).split('\n')[0]}`);
  }
}
console.log(`\nDone. ${withContacts}/${companies.length} companies got contacts, ${totalContacts} emailable contacts total, ${failed} failed.`);
