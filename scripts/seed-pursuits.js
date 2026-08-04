// Create a non-approved pursuit shell for every live account. Existing company
// hypotheses are preserved as starting context, never treated as verified truth.
import { db } from '../src/db.js';
import { ensurePursuit } from '../src/pursuits.js';

const rows = db.prepare(`
  SELECT id FROM companies
  WHERE archived_at IS NULL
  ORDER BY id
`).all();

let created = 0;
let existing = 0;
for (const row of rows) {
  const before = db.prepare('SELECT 1 FROM pursuits WHERE company_id=?').get(row.id);
  ensurePursuit(row.id);
  if (before) existing++; else created++;
}

console.log(`Pursuit shells ready: ${created} created, ${existing} already existed.`);
console.log('Every new pursuit is human_only and needs_review; no outreach was authorized.');
