// Attach REAL, named humans (from public-source research) to the existing OHUB
// Grant Route accounts. This complements seed-outagehub-grant-crm.js: that script
// seeds the ordered official ROUTES; this one seeds the actual PEOPLE behind them.
//
// It never sends anything. reach_out people become live contacts (active when the
// email is verified, needs_verification when it is only inferred). do_not_cold_contact
// people are stored as SUPPRESSED records so the name is visible but flagged, and no
// one emails a retired/moved/wrong-role/senior-executive contact by mistake.
//
// Idempotent: re-running updates the same rows (matched by company + name). It does
// not touch the OHUB_GRANT_ROUTE placeholder rows.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCompanyByName, upsertPerson, updatePerson } from '../src/db.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(readFileSync(join(root, 'data', 'outagehub-grant-people.json'), 'utf8'));
const DRY_RUN = process.argv.includes('--dry-run');

const SCORE = { primary: 9, secondary: 7, escalation: 5 };

function clean(value) {
  return String(value || '').replace(/[ \t]+/g, ' ').trim();
}

function firstNameOf(name) {
  return clean(name).split(' ')[0] || null;
}

function accountName(programName) {
  return `OHUB Grant Route | ${programName}`;
}

function draftLine(email) {
  if (!email) return '';
  const label = email.channel === 'linkedin' ? 'SUGGESTED LINKEDIN NOTE' : 'SUGGESTED FIRST EMAIL';
  const subject = email.subject ? ` — Subject: ${email.subject}` : '';
  return `${label}${subject}:\n${email.body}`;
}

function reachOutNotes(person) {
  return [
    'OHUB_GRANT_PERSON',
    `Priority: ${person.priority} | confidence: ${person.confidence} | email_status: ${person.email_status}`,
    person.phone ? `Phone: ${person.phone}` : '',
    person.linkedin ? `LinkedIn: ${person.linkedin}` : '',
    `Why: ${person.why}`,
    draftLine(person.first_email),
    `Sources: ${(person.sources || []).join(' | ')}`,
  ].filter(Boolean).join('\n');
}

function suppressedNotes(person) {
  return [
    'OHUB_GRANT_DONOTCONTACT',
    `DO NOT COLD-CONTACT: ${person.reason}`,
    `Sources: ${(person.sources || []).join(' | ')}`,
  ].join('\n');
}

function centralIntakeNote(program) {
  const lines = (program.central_intake || []).map((c) => {
    const reach = [c.email, c.phone].filter(Boolean).join(' / ');
    return `- ${c.label}${reach ? ` (${reach})` : ''}: ${c.note}`;
  });
  return [`OHUB grant central-intake reality: ${program.intake_reality}`, ...lines].join('\n');
}

function main() {
  if (config.campaign !== 'outagehub-grants') {
    throw new Error(`Expected campaign outagehub-grants, found ${config.campaign}.`);
  }

  const summary = {
    reach_out_active: 0,
    reach_out_needs_verification: 0,
    do_not_contact_suppressed: 0,
    programs_matched: 0,
    programs_missing: [],
  };

  for (const program of config.programs) {
    const company = getCompanyByName(accountName(program.program_name));
    if (!company) {
      summary.programs_missing.push(program.program_name);
      continue;
    }
    summary.programs_matched += 1;
    if (DRY_RUN) {
      for (const p of program.reach_out || []) {
        if (p.email_status === 'verified') summary.reach_out_active += 1;
        else summary.reach_out_needs_verification += 1;
      }
      summary.do_not_contact_suppressed += (program.do_not_cold_contact || []).length;
      continue;
    }

    // Keep the account's intake reality visible on the record.
    // (Stored on the company notes tail so it survives route re-seeds.)
    const intakeTag = centralIntakeNote(program);

    for (const person of program.reach_out || []) {
      const email = clean(person.email) || null;
      const active = person.email_status === 'verified' && email;
      const base = upsertPerson({
        company_id: company.id,
        name: person.name,
        first_name: firstNameOf(person.name),
        title: person.title,
        email,
        email_status: person.email_status || (email ? 'guessed' : 'unavailable'),
        linkedin_url: clean(person.linkedin) || null,
        relevance_score: SCORE[person.priority] ?? 6,
        relevance_reason: clean(person.why),
        status: 'new',
        notes: reachOutNotes(person),
      });
      updatePerson(base.id, {
        title: person.title,
        email,
        email_status: person.email_status || (email ? 'guessed' : 'unavailable'),
        linkedin_url: clean(person.linkedin) || null,
        relevance_score: SCORE[person.priority] ?? 6,
        relevance_reason: clean(person.why),
        role_type: person.priority === 'primary' ? 'champion' : 'referral',
        persona: 'funding_named_contact',
        lifecycle_status: active ? 'active' : 'needs_verification',
        last_verified_at: config.verified_at,
        suppression_reason: null,
        notes: `${reachOutNotes(person)}\n\n${intakeTag}`,
      });
      if (active) summary.reach_out_active += 1;
      else summary.reach_out_needs_verification += 1;
    }

    for (const person of program.do_not_cold_contact || []) {
      const base = upsertPerson({
        company_id: company.id,
        name: person.name,
        first_name: firstNameOf(person.name),
        title: person.title,
        email: null,
        email_status: 'unavailable',
        relevance_score: 1,
        relevance_reason: `Do not cold-contact. ${clean(person.reason)}`,
        status: 'new',
        notes: suppressedNotes(person),
      });
      updatePerson(base.id, {
        title: person.title,
        relevance_score: 1,
        relevance_reason: `Do not cold-contact. ${clean(person.reason)}`,
        role_type: 'do_not_contact',
        persona: 'funding_named_contact',
        lifecycle_status: 'suppressed',
        suppression_reason: clean(person.reason),
        last_verified_at: config.verified_at,
        notes: suppressedNotes(person),
      });
      summary.do_not_contact_suppressed += 1;
    }
  }

  console.log(JSON.stringify({ campaign: config.campaign, written: DRY_RUN ? 0 : undefined, ...summary }, null, 2));
  if (summary.programs_missing.length) {
    console.error(`\nWARNING: no CRM account for:\n  ${summary.programs_missing.join('\n  ')}\nRun "npm run grants:crm:outagehub" first.`);
    process.exitCode = 1;
  }
}

main();
