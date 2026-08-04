// Load the OutageHub board (outagehub_problems → outagehub_targets) into the
// standard CRM tables so it appears in the outreach spreadsheet as its own
// campaign tab, exactly like GnK: company → people → touch-1 email.
//
//   outagehub_targets ──► companies (campaign='outagehub', product='outage')
//                         people    (the buyer contact + Apollo email)
//                         sequences (touch 1 = the drafted first-touch email)
//
// The old 50-company OutageHub set (campaign='outagehub', already the 'outage'
// product) is moved to campaign='outage' first, so the fresh tab shows only this
// research-driven set. Nothing is deleted — those rows stay as 'outage' product
// accounts and can be moved back. Idempotent: re-running refreshes in place.
//
//   node scripts/outagehub-to-crm.js
//   node scripts/outagehub-to-crm.js --dry-run
import { listOutagehubProblems } from '../src/outagehub.js';
import {
  db, getCompanyByName, insertCompany, updateCompany, upsertPerson, updatePerson, replaceTouch,
} from '../src/db.js';
import { scoreContact } from '../src/relevance.js';
import { classifyRole } from '../src/personas.js';

const DRY_RUN = process.argv.includes('--dry-run');
const log = (m) => console.log(`[to-crm] ${m}`);

const tierForScore = (s) => (s >= 90 ? 'easy' : s >= 75 ? 'medium' : 'hard');
const splitName = (full) => {
  const parts = String(full || '').trim().split(/\s+/);
  return { first_name: parts[0] || '', last_name: parts.slice(1).join(' ') || '' };
};

// Group all targets by company name; keep the best problem score + gather contacts.
function groupByCompany() {
  const map = new Map();
  for (const p of listOutagehubProblems()) {
    for (const t of (p.targets || [])) {
      const key = t.company.trim();
      if (!map.has(key)) map.set(key, { company: key, domain: t.domain, hq: t.hq, segment: t.segment, why: t.why_them, score: p.score || 0, problems: new Set(), contacts: [] });
      const g = map.get(key);
      g.problems.add(p.title);
      g.score = Math.max(g.score, p.score || 0);
      if (!g.domain && t.domain) g.domain = t.domain;
      g.contacts.push(t);
    }
  }
  return [...map.values()];
}

// Resolve where this company row should live. Reuse the row if it's already ours
// (outage/outagehub); if the name is taken by another venture (gnk/wapahki),
// use a distinct "<name> — OutageHub" row so we never disturb theirs.
function resolveCompanyRow(name) {
  const existing = getCompanyByName(name);
  if (!existing) return { mode: 'create', name };
  if (existing.campaign === 'outagehub' || existing.campaign === 'outage' || existing.product === 'outage') {
    return { mode: 'reuse', id: existing.id, name };
  }
  const altName = `${name} — OutageHub`;
  const alt = getCompanyByName(altName);
  return alt ? { mode: 'reuse', id: alt.id, name: altName } : { mode: 'create', name: altName };
}

function main() {
  const groups = groupByCompany();
  const totalContacts = groups.reduce((n, g) => n + g.contacts.length, 0);
  const oldCount = db.prepare("SELECT COUNT(*) n FROM companies WHERE campaign='outagehub'").get().n;
  log(`${groups.length} companies · ${totalContacts} contacts from the OutageHub board`);
  log(`old outagehub tab holds ${oldCount} companies → will move to campaign='outage' (kept as 'outage' product accounts)`);

  if (DRY_RUN) {
    const collisions = groups.filter((g) => resolveCompanyRow(g.company).name !== g.company);
    log(`dry run — ${collisions.length} names collide with another venture → distinct "— OutageHub" rows:`);
    for (const g of collisions) log(`  · ${g.company}`);
    return;
  }

  // 1) Clear the fresh tab: move the legacy set off the outagehub campaign key.
  //    Guarded by source so re-runs never sweep the rows we load below.
  const moved = db.prepare("UPDATE companies SET campaign='outage' WHERE campaign='outagehub' AND (source IS NULL OR source != 'outagehub-board')").run().changes;
  log(`moved ${moved} legacy companies to campaign='outage'.`);

  // 2) Load the board.
  let companies = 0, people = 0, emails = 0;
  db.exec('BEGIN');
  try {
    for (const g of groups) {
      const res = resolveCompanyRow(g.company);
      const titles = [...new Set(g.contacts.map((c) => c.contact_title).filter(Boolean))];
      const notes = `OutageHub problem${g.problems.size > 1 ? 's' : ''}: ${[...g.problems].join(' · ')}\nWhy this company: ${g.why || ''}`;
      // Sheet-campaign companies carry no `product` (like GnK); the 5 that
      // reuse an existing 'outage' account keep whatever product they already had.
      const fields = {
        campaign: 'outagehub', tier: tierForScore(g.score),
        domain: g.domain || null, city: g.hq || null, location: 'Canada',
        industry: g.segment || null, target_titles: titles, notes,
      };
      let companyId;
      if (res.mode === 'reuse') {
        companyId = res.id;
        updateCompany(companyId, fields);
      } else {
        const co = insertCompany({ name: res.name, campaign: 'outagehub', tier: fields.tier, domain: fields.domain, city: fields.city, location: 'Canada', industry: fields.industry, target_titles: titles, notes, source: 'outagehub-board' });
        companyId = co.id;
      }
      companies++;

      for (const t of g.contacts) {
        const displayName = (t.contact_name || '').trim() || t.contact_title || 'Contact';
        const { first_name, last_name } = splitName(t.contact_name);
        const hasEmail = t.contact_email && t.contact_email.includes('@');
        const rel = scoreContact(t.contact_title || '', res.name);
        const person = upsertPerson({
          company_id: companyId, name: displayName, first_name, last_name,
          title: t.contact_title || null,
          email: hasEmail ? t.contact_email : null,
          email_status: hasEmail ? 'verified' : null,
          relevance_score: rel.score, relevance_reason: rel.reason, status: 'new',
        });
        updatePerson(person.id, { role_type: classifyRole(t.contact_title || '', 'outage').role || 'economic_buyer' });
        people++;
        if (t.email_body) {
          replaceTouch(person.id, 'outagehub', { touch: 1, day: 1, channel: 'email', subject: t.email_subject || '', body: t.email_body });
          emails++;
        }
      }
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  log(`done. loaded ${companies} companies · ${people} contacts · ${emails} first-touch emails into campaign='outagehub'.`);
}

main();
