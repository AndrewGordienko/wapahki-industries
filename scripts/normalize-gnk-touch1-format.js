// Normalize paragraph and punctuation spacing for the first contact-ready GnK
// companies in the same tier/name order used by the outreach UI.
//
//   node scripts/normalize-gnk-touch1-format.js [--limit 50] [--people 5]
import { db } from '../src/db.js';

const args = process.argv.slice(2);
const numberArg = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 ? Number(args[index + 1]) : fallback;
};
const LIMIT = numberArg('--limit', 50);
const PEOPLE = numberArg('--people', 5);
const tierRank = (tier) => ({ easy: 0, medium: 1, hard: 2 }[String(tier || '').toLowerCase()] ?? 3);

const rows = db.prepare(`
  SELECT p.id AS person_id, p.first_name, p.name AS person_name, p.relevance_score,
         p.company_id, c.name AS company, c.tier, s.id AS sequence_id, s.subject, s.body
  FROM people p
  JOIN companies c ON c.id = p.company_id
  LEFT JOIN sequences s ON s.person_id = p.id AND s.touch = 1
  WHERE c.campaign = 'gnk' AND p.email LIKE '%@%'
  ORDER BY p.company_id, p.relevance_score DESC
`).all();

const byCompany = new Map();
for (const row of rows) {
  if (!byCompany.has(row.company_id)) byCompany.set(row.company_id, []);
  byCompany.get(row.company_id).push(row);
}
const selected = [...byCompany.values()]
  .filter((companyRows) => companyRows.length >= PEOPLE)
  .sort((a, b) => tierRank(a[0].tier) - tierRank(b[0].tier)
    || String(a[0].company).localeCompare(String(b[0].company), undefined, { sensitivity: 'base' }))
  .slice(0, LIMIT)
  .flatMap((companyRows) => companyRows.slice(0, PEOPLE));

const update = db.prepare('UPDATE sequences SET subject = ?, body = ? WHERE id = ?');
let changed = 0;
db.exec('BEGIN IMMEDIATE');
try {
  for (const row of selected) {
    if (!row.sequence_id || !row.body) continue;
    const first = row.first_name || String(row.person_name || '').split(/\s+/)[0];
    let body = String(row.body).replace(/\r/g, '').trim();
    body = body
      .replace(/\s*(?:Best|Thanks),\s*\nAndrew Gordienko\s*\nGnK\s*$/i, '')
      .replace(/^Hi [^,\n]+,\s*/i, '')
      .trim();
    body = body
      .split(/\n+/)
      .map((line) => line.trim()
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/[ \t]+([,.?])/g, '$1')
        .replace(/([.?])(?=[A-Z])/g, '$1 '))
      .filter(Boolean)
      .join('\n\n');
    const normalized = `Hi ${first},\n\n${body}\n\nThanks,\nAndrew Gordienko\nGnK`;
    const subject = String(row.subject || '')
      .toLowerCase()
      .replace(/[:!?]+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (normalized !== row.body || subject !== row.subject) {
      update.run(subject, normalized, row.sequence_id);
      changed++;
    }
  }
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
}

console.log(`Normalized ${changed} of ${selected.length} GnK touch-1 drafts in UI order.`);
