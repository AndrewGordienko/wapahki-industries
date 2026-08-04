// Apollo has no remaining reveal credits, but the CRM retains a quarantined
// 2026-07-30 Apollo export with verified emails. Restore only enough unique
// contacts to give each of the first 50 Wapahki accounts five reachable people,
// preferring operations and technical roles before bounded routing roles.
//
//   node scripts/restore-wapahki-archive-to-five.js --dry-run
//   node scripts/restore-wapahki-archive-to-five.js
import { db, listPeopleByCompany, upsertPerson, updatePerson } from '../src/db.js';
import { isUsableEmail } from '../src/apollo.js';
import { scoreContact } from '../src/relevance.js';

const DRY_RUN = process.argv.includes('--dry-run');
const TARGET = 5;
const companies = db.prepare(`
  SELECT id, name FROM companies
  WHERE campaign = 'wapahki' AND archived_at IS NULL
  ORDER BY id
  LIMIT 50
`).all();

function routingReason(title, company) {
  const value = String(title || '').toLowerCase();
  if (/controller|finance|accounting/.test(value)) {
    return `Can explain how ${company} screens capital requests, reuse across customer programs, and the economic evidence an operations sponsor would need; use as an economics and routing contact, not a task-design expert.`;
  }
  if (/sales|business development|account/.test(value)) {
    return `Can explain how customer-program and package requirements vary at ${company} and route the task-fit question to operations; do not ask this person to evaluate guarding, integration, or a pilot design.`;
  }
  if (/design|artwork|graphic/.test(value)) {
    return `Can explain how customer artwork, package formats, and specification changes enter ${company}'s work and route the physical handling question to packaging or operations.`;
  }
  if (/driver|transport|shipping|logistics/.test(value)) {
    return `Can discuss finished-load handoffs, pallet or case exceptions, and the warehouse route at ${company}; keep the question within that remit and route technical evaluation to operations or engineering.`;
  }
  return `A reachable ${company} contact whose exact remit needs confirmation. Use a bounded work-observation or routing question and do not imply purchasing or technical authority.`;
}

function roleType(score, title) {
  if (score >= 9) return 'primary';
  if (score >= 7) return 'technical';
  if (score >= 6 || /operator|packer|assembler/i.test(title || '')) return 'research';
  return 'referral';
}

let restored = 0;
const actions = [];
if (!DRY_RUN) db.exec('BEGIN IMMEDIATE');
try {
  for (const company of companies) {
    const live = listPeopleByCompany(company.id).filter((person) => isUsableEmail(person.email));
    const usedEmails = new Set(live.map((person) => person.email.trim().toLowerCase()));
    let need = Math.max(0, TARGET - live.length);
    if (!need) continue;

    const candidates = db.prepare(`
      SELECT * FROM contact_archive
      WHERE matched_company_id = ? AND email_status = 'verified'
      ORDER BY relevance_score DESC, id
    `).all(company.id)
      .filter((person) => isUsableEmail(person.email))
      .filter((person) => !usedEmails.has(person.email.trim().toLowerCase()))
      .map((person) => ({ person, role: scoreContact(person.title, company.name) }))
      .sort((left, right) => right.role.score - left.role.score
        || Number(right.person.relevance_score || 0) - Number(left.person.relevance_score || 0)
        || Number(left.person.id) - Number(right.person.id));

    for (const candidate of candidates) {
      if (!need) break;
      const { person: archived, role } = candidate;
      const effectiveScore = role.score >= 6 ? role.score : 5;
      const reason = role.score >= 6 ? role.reason : routingReason(archived.title, company.name);
      actions.push(`${company.id}\t${company.name}\t${archived.name}\t${archived.title}\t${archived.email}\t${effectiveScore}`);
      usedEmails.add(archived.email.trim().toLowerCase());
      need--;
      if (DRY_RUN) continue;

      const saved = upsertPerson({
        company_id: company.id,
        name: archived.name,
        first_name: archived.first_name,
        last_name: archived.last_name,
        title: archived.title,
        email: archived.email,
        email_status: archived.email_status,
        linkedin_url: archived.linkedin_url,
        apollo_person_id: archived.apollo_person_id,
        relevance_score: effectiveScore,
        relevance_reason: reason,
        status: 'new',
        notes: `Restored from the ${archived.created_at?.slice(0, 10) || '2026-07-30'} verified Apollo archive after the live Apollo account ran out of reveal credits.`,
      });
      updatePerson(saved.id, {
        lifecycle_status: 'active',
        last_verified_at: archived.created_at || '2026-07-30',
        role_type: roleType(effectiveScore, archived.title),
      });
      db.prepare(`
        UPDATE contact_archive
        SET review_status = 'restored', restored_person_id = ?, reviewed_at = datetime('now')
        WHERE id = ?
      `).run(saved.id, archived.id);
      restored++;
    }
  }
  if (!DRY_RUN) db.exec('COMMIT');
} catch (error) {
  if (!DRY_RUN) db.exec('ROLLBACK');
  throw error;
}

console.log(`${DRY_RUN ? 'Would restore' : 'Restored'} ${DRY_RUN ? actions.length : restored} archived contacts.`);
for (const action of actions) console.log(`  ${action}`);
const counts = companies.map((company) => ({
  ...company,
  count: listPeopleByCompany(company.id).filter((person) => isUsableEmail(person.email)).length,
}));
const shortfalls = counts.filter((company) => company.count < TARGET);
if (DRY_RUN) {
  const projected = counts.filter((company) => (
    company.count + actions.filter((action) => action.startsWith(`${company.id}\t`)).length
  ) >= TARGET).length;
  console.log(`Projected coverage: ${projected}/${companies.length} companies at ${TARGET}/${TARGET}.`);
} else {
  console.log(`Coverage: ${counts.filter((company) => company.count >= TARGET).length}/${companies.length} companies at ${TARGET}/${TARGET}.`);
}
if (shortfalls.length && !DRY_RUN) {
  for (const company of shortfalls) console.log(`  SHORT ${company.id} ${company.name}: ${company.count}/${TARGET}`);
  process.exitCode = 2;
}
