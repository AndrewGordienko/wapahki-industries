// Deterministic T2 coverage and quality audit. Contacts without T1 are reported
// separately because a same-thread second touch cannot truthfully exist yet.
//
//   node scripts/audit-touch2.js
//   node scripts/audit-touch2.js --json
import { db } from '../src/db.js';
import { validateTouch2 } from '../src/touch2-quality.js';

const campaigns = ['wapahki', 'gnk', 'outagehub'];
const rows = db.prepare(`
  SELECT p.id, p.name, p.first_name, c.campaign,
         t1.subject AS t1_subject, t1.body AS t1_body,
         t2.id AS t2_id, t2.day AS t2_day, t2.channel AS t2_channel,
         t2.subject AS t2_subject, t2.body AS t2_body
  FROM people p
  JOIN companies c ON c.id = p.company_id
  LEFT JOIN sequences t1 ON t1.person_id = p.id AND t1.touch = 1
  LEFT JOIN sequences t2 ON t2.person_id = p.id AND t2.touch = 2
  WHERE c.campaign IN ('wapahki', 'gnk', 'outagehub')
    AND p.email LIKE '%@%'
  ORDER BY c.campaign, p.id
`).all();

const duplicateRows = db.prepare(`
  SELECT c.campaign, s.person_id, s.touch, COUNT(*) AS n
  FROM sequences s
  JOIN people p ON p.id = s.person_id
  JOIN companies c ON c.id = p.company_id
  WHERE c.campaign IN ('wapahki', 'gnk', 'outagehub') AND s.touch IN (1, 2)
  GROUP BY c.campaign, s.person_id, s.touch
  HAVING COUNT(*) > 1
`).all();

const results = [];
const summary = {};
for (const campaign of campaigns) {
  const campaignRows = rows.filter((row) => row.campaign === campaign);
  const eligible = campaignRows.filter((row) => row.t1_body);
  const withT2 = eligible.filter((row) => row.t2_id);
  const invalid = [];
  for (const row of withT2) {
    const errors = [];
    if (row.t2_day !== 4) errors.push(`day is ${row.t2_day}, expected 4`);
    if (row.t2_channel !== 'email') errors.push(`channel is ${row.t2_channel}, expected email`);
    errors.push(...validateTouch2({
      campaign,
      firstName: row.first_name || String(row.name || '').split(/\s+/)[0],
      t1Subject: row.t1_subject,
      t1Body: row.t1_body,
      t2Subject: row.t2_subject,
      t2Body: row.t2_body,
    }));
    if (errors.length) invalid.push({ person_id: row.id, errors });
  }
  summary[campaign] = {
    contacts: campaignRows.length,
    eligible_with_t1: eligible.length,
    blocked_without_t1: campaignRows.length - eligible.length,
    with_t2: withT2.length,
    missing_t2: eligible.length - withT2.length,
    invalid_t2: invalid.length,
  };
  results.push(...invalid.map((item) => ({ campaign, ...item })));
}

const failed = duplicateRows.length
  || Object.values(summary).some((item) => item.missing_t2 || item.invalid_t2);
if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ summary, duplicates: duplicateRows, invalid: results }, null, 2));
} else {
  for (const campaign of campaigns) {
    const item = summary[campaign];
    console.log(
      `${campaign}: ${item.with_t2}/${item.eligible_with_t1} T1-ready contacts have T2; `
      + `${item.blocked_without_t1} await T1; ${item.invalid_t2} invalid`,
    );
  }
  for (const duplicate of duplicateRows) {
    console.log(
      `duplicate ${duplicate.campaign} person ${duplicate.person_id} touch ${duplicate.touch}: ${duplicate.n} rows`,
    );
  }
  for (const item of results) {
    console.log(`${item.campaign} person ${item.person_id}: ${item.errors.join('; ')}`);
  }
}
if (failed) process.exitCode = 1;

