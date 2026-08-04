// Make the saved commercial card explicit that the proposed decision output is
// delivered by the OutageHub API. This is a wording normalization only.
import { db } from '../src/db.js';

const rows = db.prepare(`
  SELECT pu.id, pu.offer
  FROM pursuits pu JOIN companies c ON c.id=pu.company_id
  WHERE c.campaign='outagehub' AND c.archived_at IS NULL
    AND COALESCE(pu.offer, '') NOT LIKE '%API%'
`).all();
const update = db.prepare("UPDATE pursuits SET offer=?, updated_at=datetime('now') WHERE id=?");
db.exec('BEGIN IMMEDIATE');
try {
  for (const row of rows) {
    let offer = String(row.offer || '').trim();
    if (/^OutageHub would\b/i.test(offer)) {
      offer = offer.replace(/^OutageHub would\b/i, 'OutageHub’s API would');
    } else if (/^OutageHub returns\b/i.test(offer)) {
      offer = offer.replace(/^OutageHub returns\b/i, 'OutageHub’s API returns');
    } else {
      offer = `Through the OutageHub API, ${offer.charAt(0).toLowerCase()}${offer.slice(1)}`;
    }
    update.run(offer, row.id);
  }
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
}
console.log(`Normalized ${rows.length} OutageHub commercial offers to name the API explicitly.`);
