// Generate the four-email OutageHub sequence for the top three active,
// emailable contacts at each of the 50 curated accounts. Ranking is existing
// relevance score descending, then stable person id. Sent/approved history is
// preserved byte-for-byte; obsolete drafts outside the selected 150 are removed
// only after the requested coverage is complete.
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../src/db.js';
import { validateSequence, validateSpokenBrief } from '../src/outreach-quality.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const chunkSize = Math.min(30, Math.max(3, Number(process.env.OHUB_TOP3_CHUNK || 12)));
const maxAttempts = Math.min(3, Math.max(1, Number(process.env.OHUB_SEQUENCE_ATTEMPTS || 2)));
const requestedCompanyLimit = Math.max(0, Number(process.env.OHUB_COMPANY_LIMIT || 0));
let child = null;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    if (child && !child.killed) child.kill(signal);
  });
}

let companies = db.prepare(`
  SELECT c.id, c.name, c.lead_score
  FROM companies c
  WHERE c.campaign='outagehub' AND c.archived_at IS NULL
  ORDER BY (c.lead_score IS NULL), c.lead_score DESC,
           c.name COLLATE NOCASE, c.id
`).all();
if (companies.length !== 50) {
  throw new Error(`Expected 50 curated OutageHub accounts, found ${companies.length}.`);
}
if (requestedCompanyLimit) companies = companies.slice(0, requestedCompanyLimit);

const peopleForCompany = db.prepare(`
  SELECT p.id, p.company_id, p.name, p.first_name, p.title, p.sales_brief,
         p.relevance_score,
         EXISTS (
           SELECT 1 FROM sequences s
           WHERE s.person_id=p.id AND s.status<>'draft'
         ) protected
  FROM people p
  WHERE p.company_id=?
    AND p.email LIKE '%@%'
    AND COALESCE(p.lifecycle_status, 'active')!='archived'
  ORDER BY (p.relevance_score IS NULL), p.relevance_score DESC, p.id
  LIMIT 3
`);

const selected = [];
for (const company of companies) {
  const people = peopleForCompany.all(company.id);
  if (people.length !== 3) {
    throw new Error(`${company.name} has ${people.length} active emailable contacts; expected at least 3.`);
  }
  selected.push(...people.map((person, index) => ({
    ...person,
    company: company.name,
    company_rank: companies.indexOf(company) + 1,
    person_rank: index + 1,
  })));
}

function validIds(ids) {
  if (!ids.length) return new Set();
  const allowed = new Set(ids.map(Number));
  const rows = db.prepare(`
    SELECT p.id person_id, p.first_name, p.name, p.title, p.sales_brief,
           s.touch, s.day, s.channel, s.subject, s.body, s.status
    FROM people p
    JOIN sequences s ON s.person_id=p.id
    WHERE p.id IN (${ids.map(() => '?').join(',')})
    ORDER BY p.id, s.touch
  `).all(...ids);
  const grouped = new Map();
  for (const row of rows) {
    if (!allowed.has(Number(row.person_id))) continue;
    if (!grouped.has(row.person_id)) grouped.set(row.person_id, { row, touches: [] });
    grouped.get(row.person_id).touches.push(row);
  }
  const valid = new Set();
  for (const { row, touches } of grouped.values()) {
    let brief = null;
    try { brief = row.sales_brief ? JSON.parse(row.sales_brief) : null; } catch { /* validation reports it */ }
    const errors = [
      ...validateSequence({
        contact: {
          first_name: row.first_name || String(row.name || '').split(/\s+/)[0],
          title: row.title || '',
        },
        campaign: 'outagehub',
        touches,
      }),
      ...validateSpokenBrief(brief, 'outagehub'),
    ];
    if (!errors.length) valid.add(Number(row.person_id));
  }
  return valid;
}

async function runWriter(personIds, preserveProtected) {
  child = spawn(process.execPath, [join(root, 'scripts', 'write-sequences.js'), 'outagehub'], {
    cwd: root,
    env: {
      ...process.env,
      ALLOW_LEGACY_SEQUENCE_WRITE: '1',
      LEGACY_SEQUENCE_WRITE_CAMPAIGN: 'outagehub',
      WRITER_IDS: personIds.join(','),
      WRITER_REWRITE: '1',
      WRITER_FORCE_COVERAGE: '1',
      WRITER_PRESERVE_PROTECTED: preserveProtected ? '1' : '0',
      WRITER_BATCH: process.env.WRITER_BATCH || '6',
      WRITER_CONCURRENCY: process.env.WRITER_CONCURRENCY || '2',
      WRITER_REVIEW: process.env.WRITER_REVIEW || '1',
      SKIP_SUBJECT_AGENTS: process.env.SKIP_SUBJECT_AGENTS || '0',
    },
    stdio: 'inherit',
  });
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
}

async function fillGroup(group, preserveProtected) {
  for (let offset = 0; offset < group.length; offset += chunkSize) {
    const chunk = group.slice(offset, offset + chunkSize);
    let pending = chunk.map((person) => person.id)
      .filter((id) => !validIds([id]).has(id));
    for (let attempt = 1; attempt <= maxAttempts && pending.length; attempt++) {
      console.log(`${preserveProtected ? 'Protected' : 'Draft'} chunk ${Math.floor(offset / chunkSize) + 1}/${Math.ceil(group.length / chunkSize)}, attempt ${attempt}/${maxAttempts}: ${pending.length} contacts.`);
      await runWriter(pending, preserveProtected);
      const valid = validIds(pending);
      pending = pending.filter((id) => !valid.has(id));
    }
    if (pending.length) console.log(`Chunk remains incomplete: ${pending.join(',')}`);
  }
}

{
  const unprotected = selected.filter((person) => !person.protected);
  const protectedPeople = selected.filter((person) => person.protected);
  console.log(`OutageHub top-three fill: ${companies.length} accounts, ${selected.length} contacts, ${protectedPeople.length} with immutable history.`);
  await fillGroup(unprotected, false);
  await fillGroup(protectedPeople, true);

  const allIds = selected.map((person) => person.id);
  const valid = validIds(allIds);
  const missing = selected.filter((person) => !valid.has(person.id));
  if (!missing.length && companies.length === 50) {
    const selectedSet = new Set(allIds);
    const outside = db.prepare(`
      SELECT p.id
      FROM people p JOIN companies c ON c.id=p.company_id
      WHERE c.campaign='outagehub' AND c.archived_at IS NULL
    `).all().map((row) => Number(row.id)).filter((id) => !selectedSet.has(id));
    let removed = 0;
    if (outside.length) {
      removed = db.prepare(`
        DELETE FROM sequences
        WHERE status='draft' AND person_id IN (${outside.map(() => '?').join(',')})
      `).run(...outside).changes;
    }
    console.log(`Coverage: ${valid.size}/${selected.length} validated four-email sequences; removed ${removed} obsolete draft touches outside the selected top three.`);
  } else {
    console.log(`Coverage: ${valid.size}/${selected.length} validated four-email sequences.`);
  }
  if (missing.length) {
    console.log(`Still missing: ${missing.map((person) => `${person.id} ${person.company} / ${person.name}`).join(' | ')}`);
    process.exitCode = 1;
  }
}
