// Merge the researched market signals (data/market-signals.json) into each company's
// notes JSON as notes.market_signal = { hook, source_url, date, peer, confidence }.
// The writer reads notes.market_signal.hook as the real FOMO/context opener.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { db } from '../src/db.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { signals } = JSON.parse(readFileSync(join(root, 'data', 'market-signals.json'), 'utf8'));

const find = db.prepare('SELECT id, notes FROM companies WHERE campaign = ? AND name = ?');
const upd = db.prepare('UPDATE companies SET notes = ? WHERE id = ?');

let applied = 0, missing = [];
for (const s of signals) {
  const row = find.get(s.campaign, s.company);
  if (!row) { missing.push(`${s.campaign}: ${s.company}`); continue; }
  let notes = {};
  try { notes = JSON.parse(row.notes || '{}'); } catch { notes = {}; }
  notes.market_signal = { hook: s.hook, source_url: s.source_url, date: s.date, peer: s.peer, confidence: s.confidence };
  upd.run(JSON.stringify(notes), row.id);
  applied++;
}
console.log(`applied ${applied} signals`);
if (missing.length) console.log('NOT FOUND (name mismatch):\n  ' + missing.join('\n  '));
