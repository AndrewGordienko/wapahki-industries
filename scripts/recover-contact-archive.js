// Recover contacts removed by the 2026-07-28 Wapahki refresh into a quarantined
// archive. This never adds a person to the sendable contact map.
import { resolve } from 'node:path';
import { db } from '../src/db.js';

const sourceArg = process.argv.find((arg) => arg.startsWith('--source='));
const sourcePath = resolve(
  sourceArg?.slice('--source='.length)
    || 'data/crm.before-email-overhaul-2026-07-28.db',
);
const sourceLabel = sourcePath.split('/').pop();

db.prepare('ATTACH DATABASE ? AS recovered').run(sourcePath);

const candidates = db.prepare(`
  WITH ranked AS (
    SELECT
      p.*,
      c.name AS company_name,
      ROW_NUMBER() OVER (
        PARTITION BY lower(trim(p.email))
        ORDER BY COALESCE(p.relevance_score,0) DESC, p.id
      ) AS email_rank
    FROM recovered.people p
    JOIN recovered.companies c ON c.id=p.company_id
    WHERE c.campaign='wapahki'
      AND p.email LIKE '%@%'
  )
  SELECT ranked.*,
         (
           SELECT c.id FROM companies c
           WHERE lower(trim(c.name))=lower(trim(ranked.company_name))
             AND c.archived_at IS NULL
           LIMIT 1
         ) AS matched_company_id
  FROM ranked
  WHERE email_rank=1
    AND NOT EXISTS (
      SELECT 1
      FROM people current_person
      JOIN companies current_company ON current_company.id=current_person.company_id
      WHERE current_company.campaign='wapahki'
        AND lower(trim(current_person.email))=lower(trim(ranked.email))
    )
  ORDER BY company_name, name
`).all();

const insert = db.prepare(`
  INSERT OR IGNORE INTO contact_archive (
    source_db, source_person_id, company_name, matched_company_id,
    name, first_name, last_name, title, email, email_status, linkedin_url,
    apollo_person_id, relevance_score, relevance_reason, prior_status, notes
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

db.exec('BEGIN IMMEDIATE');
let inserted = 0;
try {
  for (const person of candidates) {
    const result = insert.run(
      sourceLabel,
      person.id,
      person.company_name,
      person.matched_company_id || null,
      person.name,
      person.first_name,
      person.last_name,
      person.title,
      person.email,
      person.email_status,
      person.linkedin_url,
      person.apollo_person_id,
      person.relevance_score,
      person.relevance_reason,
      person.status,
      person.notes,
    );
    inserted += Number(result.changes || 0);
  }
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
} finally {
  db.exec('DETACH DATABASE recovered');
}

const total = db.prepare("SELECT COUNT(*) n FROM contact_archive WHERE source_db=?").get(sourceLabel).n;
const matched = db.prepare(`
  SELECT COUNT(*) n FROM contact_archive
  WHERE source_db=? AND matched_company_id IS NOT NULL
`).get(sourceLabel).n;

console.log(`Recovered ${inserted} new archived contacts from ${sourceLabel}.`);
console.log(`${total} total in this recovery set; ${matched} matched to a live account.`);
console.log('All remain needs_verification and cannot be used for outreach until explicitly restored.');
