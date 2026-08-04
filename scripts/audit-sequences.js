// Deterministic audit for every stored outreach sequence. No model calls.
//
//   node scripts/audit-sequences.js
//   node scripts/audit-sequences.js --json
import { db } from '../src/db.js';
import { auditStoredSequences } from '../src/outreach-quality.js';

const rows = db.prepare(`
  SELECT s.*, p.id AS person_id, p.name, p.first_name, p.title, p.sales_brief, c.campaign
  FROM sequences s
  JOIN people p ON p.id = s.person_id
  JOIN companies c ON c.id = p.company_id
  ORDER BY p.id, s.touch
`).all();

const results = auditStoredSequences(rows);
const failed = results.filter((r) => r.errors.length);

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ sequences: results.length, failed: failed.length, results }, null, 2));
} else {
  console.log(`${results.length} stored sequences audited; ${failed.length} failed.`);
  for (const result of failed) {
    console.log(`\nPerson ${result.person_id}`);
    for (const error of result.errors) console.log(`  - ${error}`);
  }
}

if (failed.length) process.exitCode = 1;
