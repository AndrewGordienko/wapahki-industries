// Replace the obsolete small-pilot framing in saved OutageHub pursuits. The
// range remains private planning context and is explicitly a substantial
// first-year deployment after discovery, never cold-sequence copy.
import { db } from '../src/db.js';

const rows = db.prepare(`
  SELECT pu.id
  FROM pursuits pu JOIN companies c ON c.id=pu.company_id
  WHERE c.campaign='outagehub' AND c.archived_at IS NULL
`).all();

const update = db.prepare(`
  UPDATE pursuits
  SET desired_commitment=?, commercial_path=?, next_goal=?, updated_at=datetime('now')
  WHERE id=?
`);

db.exec('BEGIN IMMEDIATE');
try {
  for (const row of rows) {
    update.run(
      'CAD $40k–$75k first-year deployment planning range after discovery, including historical validation, the agreed incident-system integration or central operations view, supported-utility coverage, production support, SLA, and a 12-month licence.',
      '20-minute decision validation → bounded historical validation or limited production test → first-year deployment if the evidence and operating measures are strong.',
      'Validate the current decision, source of truth, supported-utility requirements, location and event volume, system destination, owner, useful site-match rate, manual-check baseline, delivery-latency need, and the evidence required for a deployment proposal.',
      row.id,
    );
  }
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
}

console.log(`Normalized ${rows.length} OutageHub pursuits to the post-discovery first-year deployment motion.`);
