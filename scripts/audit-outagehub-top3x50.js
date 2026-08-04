// Read-only release gate for the first three active, emailable contacts at the
// 50 curated OutageHub accounts.
import { db } from '../src/db.js';
import { validateSequence, validateSpokenBrief } from '../src/outreach-quality.js';

const companies = db.prepare(`
  SELECT id, name
  FROM companies
  WHERE campaign='outagehub' AND archived_at IS NULL
  ORDER BY (lead_score IS NULL), lead_score DESC, name COLLATE NOCASE, id
`).all();

if (companies.length !== 50) {
  throw new Error(`Expected 50 curated OutageHub accounts, found ${companies.length}.`);
}

const topPeople = db.prepare(`
  SELECT id, name, first_name, title, sales_brief
  FROM people
  WHERE company_id=?
    AND email LIKE '%@%'
    AND COALESCE(lifecycle_status, 'active')!='archived'
  ORDER BY (relevance_score IS NULL), relevance_score DESC, id
  LIMIT 3
`);

const sequenceRows = db.prepare(`
  SELECT touch, day, channel, subject, body, status
  FROM sequences
  WHERE person_id=?
  ORDER BY touch
`);

const selected = [];
const failures = [];
let touchCount = 0;
let draftCount = 0;
let protectedCount = 0;

for (const company of companies) {
  const people = topPeople.all(company.id);
  if (people.length !== 3) {
    failures.push(`${company.name}: expected 3 active emailable contacts, found ${people.length}`);
    continue;
  }
  for (const person of people) {
    selected.push(person.id);
    const touches = sequenceRows.all(person.id);
    touchCount += touches.length;
    draftCount += touches.filter((touch) => touch.status === 'draft').length;
    protectedCount += touches.filter((touch) => touch.status !== 'draft').length;
    let brief = null;
    try { brief = person.sales_brief ? JSON.parse(person.sales_brief) : null; } catch { /* validator reports it */ }
    const errors = [
      ...validateSequence({
        contact: {
          first_name: person.first_name || String(person.name || '').split(/\s+/)[0],
          title: person.title || '',
        },
        campaign: 'outagehub',
        touches,
      }),
      ...validateSpokenBrief(brief, 'outagehub'),
    ];
    if (errors.length) failures.push(`${company.name} / ${person.name}: ${errors.join('; ')}`);
  }
}

let outsideDrafts = 0;
if (selected.length) {
  outsideDrafts = db.prepare(`
    SELECT COUNT(*) count
    FROM sequences s
    JOIN people p ON p.id=s.person_id
    JOIN companies c ON c.id=p.company_id
    WHERE c.campaign='outagehub'
      AND c.archived_at IS NULL
      AND s.status='draft'
      AND p.id NOT IN (${selected.map(() => '?').join(',')})
  `).get(...selected).count;
}

console.log(`Accounts: ${companies.length}`);
console.log(`Selected contacts: ${selected.length}`);
console.log(`Validated contacts: ${selected.length - failures.length}`);
console.log(`Stored touches: ${touchCount} (${draftCount} draft, ${protectedCount} immutable)`);
console.log(`Draft touches outside selected contacts: ${outsideDrafts}`);

if (failures.length) {
  console.log('\nFailures:');
  for (const failure of failures) console.log(`- ${failure}`);
  process.exitCode = 1;
}
