// Generate one reviewed four-email OutageHub sequence for one contact at each
// of the curated 50 companies. Missing companies are retried without rewriting
// successful ones. Obsolete draft-only sequences on non-selected contacts are
// removed only after a valid winner exists for that company; revision triggers
// preserve the deleted drafts in sequence_revisions.
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../src/db.js';
import { validateSequence, validateSpokenBrief } from '../src/outreach-quality.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const maxAttempts = Math.min(3, Math.max(1, Number(process.env.OHUB_SEQUENCE_ATTEMPTS || 2)));
const setting = db.prepare(
  "SELECT value FROM system_settings WHERE key='legacy_writers_enabled'",
).get();
const priorValue = setting?.value || 'false';
let restored = false;
let child = null;

function setLegacyWriterSetting(value) {
  db.prepare(`
    INSERT INTO system_settings (key, value, updated_at)
    VALUES ('legacy_writers_enabled', ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')
  `).run(value);
}

function restore() {
  if (restored) return;
  restored = true;
  setLegacyWriterSetting(priorValue);
  console.log(`Restored legacy_writers_enabled=${priorValue}.`);
}

process.once('exit', restore);
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    if (child && !child.killed) child.kill(signal);
  });
}

const companies = db.prepare(`
  SELECT c.id, c.name, pu.cost_model, pu.desired_commitment
  FROM companies c
  LEFT JOIN pursuits pu ON pu.company_id=c.id
  WHERE c.campaign='outagehub' AND c.archived_at IS NULL
  ORDER BY CASE lower(c.tier)
    WHEN 'easy' THEN 0 WHEN 'medium' THEN 1 WHEN 'hard' THEN 2 ELSE 3 END,
    (c.lead_score IS NULL), c.lead_score DESC, c.id
`).all();
if (companies.length !== 50) {
  throw new Error(`Expected the curated OutageHub list to contain 50 companies, found ${companies.length}.`);
}
const missingCommercial = companies.filter((company) => (
  !String(company.cost_model || '').includes('Economic case:')
  || !String(company.desired_commitment || '').trim()
));
if (missingCommercial.length) {
  throw new Error(`Commercial hypothesis is missing for ${missingCommercial.length} companies: ${missingCommercial.map((company) => company.name).join(', ')}`);
}

const companyIds = new Set(companies.map((company) => company.id));
function validWinners() {
  const rows = db.prepare(`
    SELECT c.id company_id, p.id person_id, p.first_name, p.name, p.title,
           p.sales_brief, s.touch, s.day, s.channel, s.subject, s.body, s.status
    FROM companies c
    JOIN people p ON p.company_id=c.id
    JOIN sequences s ON s.person_id=p.id
    WHERE c.campaign='outagehub' AND c.archived_at IS NULL
    ORDER BY c.id, p.id, s.touch
  `).all();
  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.person_id)) grouped.set(row.person_id, { row, touches: [] });
    grouped.get(row.person_id).touches.push(row);
  }
  const winners = new Map();
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
    if (!errors.length && !winners.has(row.company_id)) winners.set(row.company_id, row.person_id);
  }
  return winners;
}

function emailablePeople(companyIdList) {
  if (!companyIdList.length) return [];
  return db.prepare(`
    SELECT p.id
    FROM people p
    WHERE p.company_id IN (${companyIdList.map(() => '?').join(',')})
      AND p.email LIKE '%@%'
      AND COALESCE(p.lifecycle_status, 'active')!='archived'
    ORDER BY p.company_id, (p.relevance_score IS NULL), p.relevance_score DESC, p.id
  `).all(...companyIdList).map((row) => row.id);
}

async function runWriter(personIds) {
  child = spawn(process.execPath, [join(root, 'scripts', 'write-sequences.js'), 'outagehub'], {
    cwd: root,
    env: {
      ...process.env,
      ALLOW_LEGACY_SEQUENCE_WRITE: '1',
      WRITER_IDS: personIds.join(','),
      WRITER_REWRITE: '1',
      WRITER_ONE_PER_COMPANY: '1',
      WRITER_CONCURRENCY: process.env.WRITER_CONCURRENCY || '2',
      WRITER_REVIEW: '1',
    },
    stdio: 'inherit',
  });
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
}

try {
  setLegacyWriterSetting('true');
  console.log('Temporarily enabled the quarantined sequence store for the 50 OutageHub companies.');
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const winners = validWinners();
    const missing = companies.filter((company) => !winners.has(company.id)).map((company) => company.id);
    if (!missing.length) break;
    const personIds = emailablePeople(missing);
    console.log(`Attempt ${attempt}/${maxAttempts}: ${missing.length} companies, ${personIds.length} candidate contacts.`);
    await runWriter(personIds);
  }

  const winners = validWinners();
  const missing = companies.filter((company) => !winners.has(company.id));
  const deleteDrafts = db.prepare(`
    DELETE FROM sequences
    WHERE status='draft' AND person_id IN (
      SELECT p.id FROM people p WHERE p.company_id=? AND p.id<>?
    )
  `);
  let removed = 0;
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const [companyId, winnerId] of winners) {
      if (!companyIds.has(companyId)) continue;
      removed += deleteDrafts.run(companyId, winnerId).changes;
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  console.log(`Coverage: ${winners.size}/50 companies with one validated four-email sequence; removed ${removed} obsolete draft touches from non-selected contacts.`);
  if (missing.length) {
    console.log(`Still missing: ${missing.map((company) => `${company.id} ${company.name}`).join(' | ')}`);
    process.exitCode = 1;
  }
} finally {
  restore();
}
