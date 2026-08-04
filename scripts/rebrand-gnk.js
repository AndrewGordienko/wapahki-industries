// One-time, idempotent local-data rebrand:
//   - merge the legacy `forth` campaign into `gnk`;
//   - update saved sender/brand text in drafts and research notes;
//   - src/db.js separately renames forth_projects -> gnk_projects on import.
import { db } from '../src/db.js';

const brandSql = (column) => `
  ${column} = replace(replace(
    replace(
      replace(${column}, 'Forth Solutions', 'GnK'),
      'ForthSolutions', 'GnK'
    ),
    'Forth', 'GnK'
  ), 'GNK', 'GnK')
`;

db.exec('BEGIN IMMEDIATE');
try {
  const companies = db.prepare(`
    UPDATE companies
    SET campaign = 'gnk',
        source = replace(source, 'forth', 'gnk'),
        ${brandSql('notes')},
        ${brandSql('hypothesis')},
        ${brandSql('gnk_notes')}
    WHERE campaign IN ('forth', 'gnk')
  `).run();

  const sequences = db.prepare(`
    UPDATE sequences
    SET campaign = CASE WHEN campaign = 'forth' THEN 'gnk' ELSE campaign END,
        ${brandSql('subject')},
        ${brandSql('body')}
    WHERE campaign IN ('forth', 'gnk')
       OR subject LIKE '%Forth%'
       OR body LIKE '%Forth%'
  `).run();

  const people = db.prepare(`
    UPDATE people
    SET ${brandSql('relevance_reason')},
        ${brandSql('notes')}
    WHERE relevance_reason LIKE '%Forth%'
       OR notes LIKE '%Forth%'
       OR relevance_reason LIKE '%GNK%'
       OR notes LIKE '%GNK%'
  `).run();

  db.exec('COMMIT');
  console.log(
    `GnK rebrand complete: ${companies.changes} companies, ${sequences.changes} sequences, ${people.changes} people updated.`,
  );
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
}
