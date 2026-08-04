// Build seven-stage early-discovery sequences for three distinct contact
// perspectives at each of the first 50 active Wapahki companies.
//
//   node scripts/run-wapahki-seven-touch.js --dry-run
//   node scripts/run-wapahki-seven-touch.js
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DB_PATH, db, upsertPerson, updatePerson } from '../src/db.js';
import { scoreContact } from '../src/relevance.js';
import {
  sequencePlanForCampaign,
  validateSequence,
  validateSpokenBrief,
} from '../src/outreach-quality.js';
import { selectWapahkiContacts, wapahkiRoleKey } from '../src/wapahki-contact-selection.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DRY_RUN = process.argv.includes('--dry-run');
const TARGET_COMPANIES = 50;
const CONTACTS_PER_COMPANY = 3;

const companies = db.prepare(`
  SELECT * FROM companies
  WHERE campaign='wapahki' AND archived_at IS NULL
  ORDER BY id
  LIMIT ?
`).all(TARGET_COMPANIES);
if (companies.length !== TARGET_COMPANIES) {
  throw new Error(`Expected ${TARGET_COMPANIES} active Wapahki companies, found ${companies.length}.`);
}

const activePeople = (companyId) => db.prepare(`
  SELECT * FROM people
  WHERE company_id=?
    AND COALESCE(lifecycle_status, 'active')!='archived'
    AND email LIKE '%@%'
  ORDER BY (relevance_score IS NULL), relevance_score DESC, id
`).all(companyId);

function restoreDistinctContacts(company) {
  let selection = selectWapahkiContacts(company, activePeople(company.id), CONTACTS_PER_COMPANY);
  if (!selection.missing || DRY_RUN) return selection;

  const usedEmails = new Set(activePeople(company.id).map((person) => String(person.email || '').toLowerCase()));
  const archive = db.prepare(`
    SELECT * FROM contact_archive
    WHERE matched_company_id=? AND email_status='verified' AND email LIKE '%@%'
    ORDER BY relevance_score DESC, id
  `).all(company.id);

  for (const candidate of archive) {
    if (!selection.missing) break;
    const email = String(candidate.email || '').toLowerCase();
    if (!email || usedEmails.has(email)) continue;
    const selectedRoles = new Set(selection.selected.map((person) => wapahkiRoleKey(person.title)));
    if (selectedRoles.has(wapahkiRoleKey(candidate.title))) continue;
    const globallyActive = db.prepare(`
      SELECT id FROM people
      WHERE lower(email)=lower(?) AND COALESCE(lifecycle_status, 'active')!='archived'
    `).get(candidate.email);
    if (globallyActive) continue;

    const scored = scoreContact(candidate.title, company.name);
    const saved = upsertPerson({
      company_id: company.id,
      name: candidate.name,
      first_name: candidate.first_name,
      last_name: candidate.last_name,
      title: candidate.title,
      email: candidate.email,
      email_status: candidate.email_status,
      linkedin_url: candidate.linkedin_url,
      apollo_person_id: candidate.apollo_person_id,
      relevance_score: Math.max(Number(candidate.relevance_score || 0), scored.score),
      relevance_reason: scored.reason,
      status: 'new',
      notes: 'Restored from the verified Apollo archive to add a distinct Wapahki discovery perspective.',
    });
    updatePerson(saved.id, {
      lifecycle_status: 'active',
      last_verified_at: candidate.created_at || '2026-07-30',
      role_type: scored.score >= 9 ? 'primary' : 'technical',
      suppression_reason: null,
    });
    db.prepare(`
      UPDATE contact_archive
      SET review_status='restored', restored_person_id=?, reviewed_at=datetime('now')
      WHERE id=?
    `).run(saved.id, candidate.id);
    usedEmails.add(email);
    selection = selectWapahkiContacts(company, activePeople(company.id), CONTACTS_PER_COMPANY);
  }
  return selection;
}

const backupPath = join(dirname(DB_PATH), 'backups', 'crm-before-wapahki-early-discovery-3x50-2026-08-02.db');
if (!DRY_RUN) {
  mkdirSync(dirname(backupPath), { recursive: true });
  if (!existsSync(backupPath)) {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    copyFileSync(DB_PATH, backupPath);
  }
}

const selections = [];
for (const company of companies) {
  const selection = restoreDistinctContacts(company);
  selections.push({ company, ...selection });
}
const shortfalls = selections.filter((item) => item.selected.length !== CONTACTS_PER_COMPANY);
if (shortfalls.length) {
  for (const item of shortfalls) {
    console.log(`SHORT ${item.company.id} ${item.company.name}: ${item.selected.length}/${CONTACTS_PER_COMPANY}`);
  }
  if (!DRY_RUN) throw new Error('Could not assemble three distinct contact perspectives for every company.');
}

for (const item of selections) {
  console.log(`${item.company.id}\t${item.company.name}\t${item.selected.map((person) => `${person.id}:${person.name} [${person.title}]`).join(' | ')}`);
}
if (DRY_RUN) {
  console.log(`Dry run: ${selections.reduce((sum, item) => sum + item.selected.length, 0)} contacts selected; no database changes or generation.`);
  process.exit(shortfalls.length ? 2 : 0);
}

const selected = selections.flatMap((item) => item.selected);
if (selected.length !== TARGET_COMPANIES * CONTACTS_PER_COMPANY) {
  throw new Error(`Expected 150 selected contacts, found ${selected.length}.`);
}
const selectedIds = new Set(selected.map((person) => Number(person.id)));

// Label only genuinely overlapping roles as alternates. Other unselected
// perspectives remain ordinary contacts but receive no new parallel sequence.
for (const item of selections) {
  const selectedRoles = new Map(item.selected.map((person) => [wapahkiRoleKey(person.title), person]));
  for (const alternate of item.alternates) {
    const primary = selectedRoles.get(wapahkiRoleKey(alternate.title));
    if (!primary || Number(alternate.id) === Number(primary.id)) continue;
    updatePerson(alternate.id, {
      role_type: 'alternate',
      suppression_reason: `Same-role alternate to ${primary.name}; use only after the primary route does not respond.`,
    });
  }
}

const protectedIds = new Set(db.prepare(`
  SELECT DISTINCT person_id FROM sequences WHERE status!='draft'
`).all().map((row) => Number(row.person_id)));
const canonical = new Map(sequencePlanForCampaign('wapahki').map((item) => [Number(item.touch), item]));

function storedSequenceErrors(person) {
  const stored = db.prepare(`
    SELECT touch,day,channel,subject,body,status FROM sequences
    WHERE person_id=? ORDER BY touch
  `).all(person.id);
  const validationTouches = stored.map((touch) => {
    if (touch.status === 'draft') return touch;
    const expected = canonical.get(Number(touch.touch));
    return expected ? { ...touch, day: expected.day, channel: expected.channel } : touch;
  });
  let brief = null;
  try { brief = JSON.parse(db.prepare('SELECT sales_brief FROM people WHERE id=?').get(person.id)?.sales_brief || 'null'); } catch { brief = null; }
  const contact = { first_name: person.first_name || String(person.name || '').split(/\s+/)[0], title: person.title };
  return [
    ...validateSpokenBrief(brief, 'wapahki', contact),
    ...validateSequence({
      contact,
      campaign: 'wapahki',
      touches: validationTouches,
    }),
  ];
}

// A retry only regenerates contacts that still fail the complete seven-stage
// gate. This makes interrupted or partially rejected bulk runs safely resumable.
const alreadyValidIds = new Set(selected
  .filter((person) => storedSequenceErrors(person).length === 0)
  .map((person) => Number(person.id)));
const freshIds = selected
  .filter((person) => !protectedIds.has(Number(person.id)) && !alreadyValidIds.has(Number(person.id)))
  .map((person) => Number(person.id));
const continuationIds = selected
  .filter((person) => protectedIds.has(Number(person.id)) && !alreadyValidIds.has(Number(person.id)))
  .map((person) => Number(person.id));
console.log(`Resume state: ${alreadyValidIds.size} already valid; ${freshIds.length} fresh drafts and ${continuationIds.length} protected continuations still need work.`);

async function runWriter(ids, preserveProtected) {
  if (!ids.length) return;
  const child = spawn(process.execPath, [join(root, 'scripts', 'write-sequences.js'), 'wapahki'], {
    cwd: root,
    env: {
      ...process.env,
      ALLOW_LEGACY_SEQUENCE_WRITE: '1',
      LEGACY_SEQUENCE_WRITE_CAMPAIGN: 'wapahki',
      WRITER_IDS: ids.join(','),
      WRITER_REWRITE: '1',
      WRITER_FORCE_COVERAGE: '1',
      WRITER_ONE_PER_COMPANY: '0',
      WRITER_BATCH: process.env.WRITER_BATCH || '3',
      WRITER_CONCURRENCY: process.env.WRITER_CONCURRENCY || '10',
      WRITER_REVIEW: process.env.WRITER_REVIEW ?? '1',
      WRITER_PRESERVE_PROTECTED: preserveProtected ? '1' : '0',
      SUBJECTS_PER_UNIT: process.env.SUBJECTS_PER_UNIT ?? '1',
      SUBJECT_REASONING: process.env.SUBJECT_REASONING || 'high',
    },
    stdio: 'inherit',
  });
  const result = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  if (result.code !== 0) {
    // The writer fails closed per contact. Keep progressing through the other
    // route type, then let the final 150-contact audit report the exact IDs that
    // still need an individual retry.
    console.log(`Writer left rejected ${preserveProtected ? 'continuations' : 'fresh drafts'} (${result.code ?? result.signal}); continuing to the complete audit.`);
  }
}

await runWriter(freshIds, false);
await runWriter(continuationIds, true);

const failures = [];
for (const person of selected) {
  const errors = storedSequenceErrors(person);
  if (errors.length) failures.push({ person, errors });
}
if (failures.length) {
  for (const item of failures) console.log(`INVALID ${item.person.id} ${item.person.name}: ${item.errors.join('; ')}`);
  throw new Error(`${failures.length} selected contacts failed the seven-touch quality gate; obsolete drafts were not removed.`);
}

// Only after all 150 selected paths validate, remove obsolete unsent copy from
// other contacts. Sent and approved history remains immutable.
const companyIds = companies.map((company) => company.id);
const unselectedDrafts = db.prepare(`
  SELECT s.id
  FROM sequences s JOIN people p ON p.id=s.person_id
  WHERE p.company_id IN (${companyIds.map(() => '?').join(',')})
    AND s.status='draft'
    AND p.id NOT IN (${[...selectedIds].map(() => '?').join(',')})
`).all(...companyIds, ...selectedIds);
db.exec('BEGIN IMMEDIATE');
try {
  const removeReview = db.prepare('DELETE FROM subject_line_reviews WHERE sequence_id=?');
  const removeDraft = db.prepare("DELETE FROM sequences WHERE id=? AND status='draft'");
  for (const row of unselectedDrafts) {
    removeReview.run(row.id);
    removeDraft.run(row.id);
  }
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
}

console.log(`Complete: 150 validated Wapahki contacts across 50 companies, seven stages each; removed ${unselectedDrafts.length} obsolete draft touches.`);
console.log(`Backup: ${backupPath}`);
