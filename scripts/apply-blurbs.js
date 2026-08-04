// Reads the agents' output files and writes each unique "why they'd reply" into
// the database (people.relevance_reason), then you can regenerate the CSV.
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../src/db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'data', 'blurb', 'out');

const files = readdirSync(outDir).filter((f) => f.endsWith('.json'));
const upd = db.prepare('UPDATE people SET relevance_reason = ? WHERE id = ?');
let updated = 0, skipped = 0;
const seen = new Set();

for (const f of files) {
  let arr;
  try { arr = JSON.parse(readFileSync(join(outDir, f), 'utf8')); }
  catch (e) { console.log(`  bad JSON in ${f}: ${e.message}`); continue; }
  for (const row of arr) {
    const id = Number(row.id);
    const why = (row.why || '').toString().trim();
    if (!id || !why) { skipped++; continue; }
    upd.run(why, id);
    seen.add(id);
    updated++;
  }
}
console.log(`Applied ${updated} unique blurbs (${seen.size} distinct contacts). ${skipped} skipped.`);
