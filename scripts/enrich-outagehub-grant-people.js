// Apollo email unlock for the OHUB grant *named humans* (the reach_out people
// seeded by seed-outagehub-grant-people.js). It never touches the do_not_contact
// suppressed rows and never invents a person — it enriches the exact name we
// researched, by name + domain + LinkedIn, and only upgrades the email when
// Apollo returns a real (unlocked) address.
//
// Behaviour per person:
//   - Apollo returns a usable email  -> set email, email_status='verified',
//        apollo_person_id, lifecycle_status='active', record whether Apollo
//        CONFIRMED our address or CORRECTED an inferred one.
//   - Apollo returns nothing usable  -> leave the researched email untouched
//        (government contacts are thinly covered by Apollo; that's expected).
//
//   node scripts/enrich-outagehub-grant-people.js --dry-run   # classify, no credits
//   node scripts/enrich-outagehub-grant-people.js             # live (spends credits)
//   node scripts/enrich-outagehub-grant-people.js --force     # re-enrich already-matched
import { db, updatePerson, getPerson } from '../src/db.js';
import * as apollo from '../src/apollo.js';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const FORCE = args.includes('--force');
const log = (m) => console.log(`[grant-enrich] ${m}`);

// domain -> the real organization name (person rows live under "OHUB Grant Route | ..."
// accounts, so we supply the true org to sharpen Apollo's match).
const ORG_BY_DOMAIN = {
  'nrc-cnrc.gc.ca': 'National Research Council Canada',
  'ictc-ctic.ca': 'Information and Communications Technology Council',
  'toronto.ca': 'City of Toronto',
  'nrcan-rncan.gc.ca': 'Natural Resources Canada',
  'ieso.ca': 'Independent Electricity System Operator',
};

const domainOf = (email) => String(email || '').split('@')[1] || null;
const stripApolloNote = (notes) =>
  String(notes || '').split('\n').filter((l) => !l.startsWith('APOLLO:')).join('\n').trimEnd();

// Pull the seeded reach_out humans (never the suppressed do_not_contact rows).
function reachOutPeople() {
  return db.prepare(`
    SELECT p.id, p.name, p.first_name, p.title, p.email, p.email_status,
           p.linkedin_url, p.apollo_person_id, p.lifecycle_status, p.notes
    FROM people p
    JOIN companies c ON c.id = p.company_id
    WHERE c.campaign = 'outagehub-grants'
      AND p.notes LIKE 'OHUB_GRANT_PERSON%'
      AND COALESCE(p.lifecycle_status,'active') <> 'suppressed'
    ORDER BY p.relevance_score DESC
  `).all();
}

async function main() {
  const all = reachOutPeople();
  const todo = all.filter((p) => domainOf(p.email) && (FORCE || !p.apollo_person_id));
  const skipped = all.length - todo.length;
  log(`${all.length} named reach-out people · ${todo.length} to enrich${skipped ? ` · ${skipped} already Apollo-matched (use --force)` : ''}`);

  if (DRY_RUN) {
    log('dry run — would spend ~1 Apollo credit per person. No calls made.');
    for (const p of todo) log(`  · ${p.name} @ ${domainOf(p.email)} (current: ${p.email} / ${p.email_status})`);
    return;
  }

  let confirmed = 0, corrected = 0, nomatch = 0;
  for (let i = 0; i < todo.length; i += 10) {
    const batch = todo.slice(i, i + 10);
    const people = batch.map((p) => {
      const { first_name, last_name } = apollo.splitName(p.name);
      const domain = domainOf(p.email);
      return {
        first_name, last_name, name: p.name, domain,
        company_name: ORG_BY_DOMAIN[domain] || undefined,
        linkedin_url: p.linkedin_url || undefined,
      };
    });
    let matches = [];
    try { matches = await apollo.bulkEnrich({ people }); }
    catch (e) { log(`  bulk_match failed: ${e.message.split('\n')[0]}`); continue; }

    for (let j = 0; j < batch.length; j++) {
      const p = batch[j];
      const m = matches[j];
      if (!m || !apollo.isUsableEmail(m.email)) { nomatch++; log(`  – no Apollo email for ${p.name} (kept researched ${p.email_status}: ${p.email})`); continue; }

      const same = String(m.email).toLowerCase() === String(p.email).toLowerCase();
      const tag = same
        ? `APOLLO: confirmed ${m.email} on 2026-08-02 (id ${m.id}).`
        : `APOLLO: corrected ${p.email_status} ${p.email} -> ${m.email} (id ${m.id}).`;
      const base = getPerson(p.id);
      updatePerson(p.id, {
        email: m.email,
        email_status: 'verified',
        apollo_person_id: m.id,
        linkedin_url: m.linkedin_url || p.linkedin_url || null,
        title: p.title || m.title || null,
        lifecycle_status: 'active',
        last_verified_at: '2026-08-02',
        notes: `${stripApolloNote(base.notes)}\n${tag}`,
      });
      if (same) { confirmed++; log(`  ✓ ${p.name}: Apollo CONFIRMED ${m.email}`); }
      else { corrected++; log(`  ✓ ${p.name}: Apollo CORRECTED ${p.email} -> ${m.email}`); }
    }
  }

  log(`done. confirmed ${confirmed}, corrected ${corrected}, no-match ${nomatch} (no-match keeps the researched email).`);
}

main().catch((e) => { log(`fatal: ${e.message}`); process.exitCode = 1; });
