// Normalize paragraph and punctuation spacing for all OutageHub touch-1 emails.
import { db } from '../src/db.js';

const rows = db.prepare(`
  SELECT s.id AS sequence_id, s.subject, s.body, p.first_name, p.name
  FROM sequences s
  JOIN people p ON p.id=s.person_id
  JOIN companies c ON c.id=p.company_id
  WHERE c.campaign='outagehub' AND s.touch=1
`).all();
const update = db.prepare('UPDATE sequences SET subject=?, body=? WHERE id=?');

let changed = 0;
db.exec('BEGIN IMMEDIATE');
try {
  for (const row of rows) {
    if (!row.body) continue;
    const first = row.first_name || String(row.name || '').split(/\s+/)[0];
    let content = String(row.body)
      .replace(/\r/g, '')
      .replace(/\s*(?:Best|Thanks),\s*\nAndrew Gordienko\s*\nOutageHub\s*$/i, '')
      .replace(/^Hi [^,\n]+,\s*/i, '')
      .trim();
    content = content
      .split(/\n+/)
      .map((line) => line.trim()
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/[ \t]+([,.?])/g, '$1')
        .replace(/([.?])(?=[A-Z])/g, '$1 '))
      .filter(Boolean)
      .join('\n\n');
    const body = `Hi ${first},\n\n${content}\n\nThanks,\nAndrew Gordienko\nOutageHub`;
    const subject = String(row.subject || '')
      .toLowerCase()
      .replace(/[:!?]+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (body !== row.body || subject !== row.subject) {
      update.run(subject, body, row.sequence_id);
      changed++;
    }
  }
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
}
console.log(`Normalized ${changed} of ${rows.length} OutageHub touch-1 drafts.`);
