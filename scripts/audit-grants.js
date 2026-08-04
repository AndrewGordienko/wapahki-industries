// Deterministic integrity checks for the grant research board.
import { db } from '../src/db.js';
import { GRANT_STATUSES, CONTACT_STATUSES } from '../src/grants.js';

const grants = db.prepare('SELECT * FROM grants ORDER BY id').all();
const contacts = db.prepare('SELECT * FROM grant_contacts ORDER BY id').all();
const failures = [];
const warnings = [];
const scoreMaximums = [25, 20, 20, 10, 10, 10, 5];

function parsed(value, label) {
  try { return value ? JSON.parse(value) : []; } catch {
    failures.push(`${label} contains invalid JSON`);
    return [];
  }
}

function validUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol);
  } catch {
    return false;
  }
}

for (const grant of grants) {
  const prefix = `grant ${grant.id} "${grant.program_name}"`;
  if (!['outagehub', 'wapahki'].includes(grant.applicant)) failures.push(`${prefix} has invalid applicant`);
  if (!GRANT_STATUSES.includes(grant.status)) failures.push(`${prefix} has invalid status ${grant.status}`);
  if (!validUrl(grant.official_url)) failures.push(`${prefix} has no valid official URL`);
  if (grant.deadline && !/^\d{4}-\d{2}-\d{2}$/.test(grant.deadline)) failures.push(`${prefix} deadline is not ISO`);
  if (grant.amount_min != null && grant.amount_max != null && grant.amount_min > grant.amount_max) {
    failures.push(`${prefix} amount_min exceeds amount_max`);
  }
  const sources = parsed(grant.sources, `${prefix} sources`);
  if (!sources.some((source) => source.source_type === 'official' && validUrl(source.url))) {
    failures.push(`${prefix} has no official source`);
  }
  const breakdown = parsed(grant.score_breakdown, `${prefix} score breakdown`);
  if (breakdown.length !== 7) failures.push(`${prefix} has ${breakdown.length} score factors, expected 7`);
  const score = breakdown.reduce((sum, item, index) => {
    if (Number(item.of) !== scoreMaximums[index]) failures.push(`${prefix} factor ${index + 1} max is wrong`);
    if (Number(item.points) < 0 || Number(item.points) > scoreMaximums[index]) failures.push(`${prefix} factor ${index + 1} points out of range`);
    return sum + Number(item.points || 0);
  }, 0);
  if (score !== Number(grant.score)) failures.push(`${prefix} score ${grant.score} != breakdown ${score}`);
  if ((grant.intake_status === 'closed' || grant.eligibility_result === 'ineligible') && Number(grant.score) > 49) {
    failures.push(`${prefix} closed/ineligible intake scores above 49`);
  }
  if (!parsed(grant.next_steps, `${prefix} next steps`).length) warnings.push(`${prefix} has no next steps`);
  if (!parsed(grant.eligibility_gaps, `${prefix} gaps`).length && grant.eligibility_result === 'conditional') {
    failures.push(`${prefix} is conditional but has no eligibility gaps`);
  }
}

for (const contact of contacts) {
  const prefix = `contact ${contact.id} for grant ${contact.grant_id}`;
  if (!CONTACT_STATUSES.includes(contact.status)) failures.push(`${prefix} has invalid status ${contact.status}`);
  if (!validUrl(contact.contact_url)) failures.push(`${prefix} has no published contact route`);
  if (contact.contact_email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact.contact_email)) failures.push(`${prefix} email is malformed`);
  if (contact.contact_email && contact.email_confidence !== 'published') failures.push(`${prefix} email is not marked published`);
  const subject = String(contact.email_subject || '').trim();
  const subjectWords = subject.split(/\s+/).filter(Boolean).length;
  const body = String(contact.email_body || '').trim();
  const bodyWords = body.split(/\s+/).filter(Boolean).length;
  if (subject !== subject.toLowerCase()) failures.push(`${prefix} subject is not lowercase`);
  if (subjectWords < 2 || subjectWords > 6) failures.push(`${prefix} subject has ${subjectWords} words`);
  if (bodyWords < 80 || bodyWords > 180) warnings.push(`${prefix} body has ${bodyWords} words`);
  if (!/Andrew Gordienko/.test(body)) failures.push(`${prefix} lacks Andrew signature`);
  if (!/(OutageHub|Wapahki Industries)\s*$/.test(body)) failures.push(`${prefix} lacks applicant signature`);
}

console.log(`${grants.length} grant opportunities · ${contacts.length} contact drafts · ${failures.length} failures · ${warnings.length} warnings`);
for (const failure of failures) console.log(`  FAIL ${failure}`);
for (const warning of warnings) console.log(`  WARN ${warning}`);
if (failures.length) process.exitCode = 1;
