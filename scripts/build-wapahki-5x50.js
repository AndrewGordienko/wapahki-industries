// Fill the first 50 active Wapahki accounts to five current, emailable,
// operations-relevant contacts using Apollo. Search is free; revealing an
// email consumes Apollo credits, so the live run has an explicit safety cap.
//
//   node scripts/build-wapahki-5x50.js --dry-run
//   node scripts/build-wapahki-5x50.js --cap 140
import { db, listPeopleByCompany, upsertPerson } from '../src/db.js';
import { buildCompanyContacts } from '../src/pipeline.js';
import { enrichByIds, isUsableEmail, searchPeople } from '../src/apollo.js';
import { scoreContact } from '../src/relevance.js';

const args = process.argv.slice(2);
const numberAfter = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 ? Number(args[index + 1]) : fallback;
};
const TARGET_COMPANIES = numberAfter('--companies', 50);
const PER_COMPANY = numberAfter('--people', 5);
const CREDIT_CAP = numberAfter('--cap', 140);
const DRY_RUN = args.includes('--dry-run');
const WEAK = /sales|marketing|finance|accounting|controller|human resources|recruit|talent|communications|brand|legal|counsel|business development/i;

const companies = db.prepare(`
  SELECT * FROM companies
  WHERE campaign = 'wapahki' AND archived_at IS NULL
  ORDER BY id
  LIMIT ?
`).all(TARGET_COMPANIES);

const usablePeople = (companyId) => listPeopleByCompany(companyId)
  .filter((person) => isUsableEmail(person.email));
const globallyUsedApolloIds = new Set(db.prepare(`
  SELECT apollo_person_id FROM people
  WHERE apollo_person_id IS NOT NULL AND apollo_person_id != ''
`).all().map((row) => row.apollo_person_id));

async function domainTopUp(company, remaining) {
  if (!company.domain || remaining <= 0) return 0;
  const existing = listPeopleByCompany(company.id);
  const usedNames = new Set(existing.map((person) => String(person.name || '').trim().toLowerCase()));
  const usedCompanyIds = new Set(existing.map((person) => person.apollo_person_id).filter(Boolean));
  const found = await searchPeople({ domains: [company.domain], perPage: 50 });
  const candidates = found
    .filter((person) => person.id && person.has_email)
    .filter((person) => !usedCompanyIds.has(person.id) && !globallyUsedApolloIds.has(person.id))
    .filter((person) => !WEAK.test(person.title || ''))
    .map((person) => ({ person, ...scoreContact(person.title, company.name) }))
    .filter((candidate) => candidate.score >= 7)
    .sort((left, right) => right.score - left.score)
    .slice(0, remaining + 5);
  if (!candidates.length) return 0;

  const matches = await enrichByIds(candidates.map((candidate) => candidate.person.id));
  let added = 0;
  for (const candidate of candidates) {
    if (added >= remaining) break;
    const match = matches.find((person) => person?.id === candidate.person.id);
    const normalizedName = String(match?.name || '').trim().toLowerCase();
    if (!match || !isUsableEmail(match.email) || !normalizedName || usedNames.has(normalizedName)) continue;
    const role = scoreContact(match.title || candidate.person.title, company.name);
    if (role.score < 7) continue;
    const saved = upsertPerson({
      company_id: company.id,
      name: match.name,
      first_name: match.first_name,
      last_name: match.last_name,
      title: match.title || candidate.person.title,
      email: match.email,
      email_status: match.email_status || 'verified',
      linkedin_url: match.linkedin_url,
      apollo_person_id: match.id,
      relevance_score: role.score,
      relevance_reason: role.reason,
      status: 'new',
      notes: 'Sourced from Apollo for the Wapahki five-contact account map.',
    });
    if (saved.company_id !== company.id || !isUsableEmail(saved.email)) continue;
    usedNames.add(normalizedName);
    globallyUsedApolloIds.add(match.id);
    added++;
  }
  return added;
}

const initialTotal = companies.reduce((sum, company) => sum + usablePeople(company.id).length, 0);
const initialFull = companies.filter((company) => usablePeople(company.id).length >= PER_COMPANY).length;
console.log([
  `Wapahki contact fill: ${companies.length} companies`,
  `${initialFull} already at ${PER_COMPANY}/${PER_COMPANY}`,
  `${initialTotal} emailable contacts`,
  `need ${Math.max(0, (companies.length * PER_COMPANY) - initialTotal)}`,
  `credit cap ${CREDIT_CAP}`,
  DRY_RUN ? 'DRY RUN' : 'LIVE',
].join(' | '));

let revealed = 0;
let processed = 0;
for (const company of companies) {
  const before = usablePeople(company.id).length;
  if (before >= PER_COMPANY) continue;
  processed++;
  if (DRY_RUN) {
    console.log(`  [dry] ${company.id} ${company.name}: ${before}/${PER_COMPANY}, needs ${PER_COMPANY - before}`);
    continue;
  }
  if (revealed >= CREDIT_CAP) {
    console.log(`  Credit cap reached before ${company.name}; stopping.`);
    break;
  }

  try {
    await buildCompanyContacts(company.id, { limit: PER_COMPANY, minScore: 7 });
    let after = usablePeople(company.id).length;
    revealed += Math.max(0, after - before);

    if (after < PER_COMPANY && revealed < CREDIT_CAP) {
      const remaining = Math.min(PER_COMPANY - after, CREDIT_CAP - revealed);
      const currentCompany = db.prepare('SELECT * FROM companies WHERE id = ?').get(company.id);
      const added = await domainTopUp(currentCompany, remaining);
      revealed += added;
      after = usablePeople(company.id).length;
    }
    console.log(`  ${company.id} ${company.name}: ${after}/${PER_COMPANY}${after > before ? ` (+${after - before})` : ''} | ~${revealed} revealed`);
  } catch (error) {
    console.log(`  ${company.id} ${company.name}: ERROR ${String(error.message || error).split('\n')[0]}`);
    if (/insufficient|credit/i.test(String(error.message || error))) break;
  }
  await new Promise((resolve) => setTimeout(resolve, 350));
}

const finalRows = companies.map((company) => ({
  id: company.id,
  name: company.name,
  count: usablePeople(company.id).length,
}));
const full = finalRows.filter((company) => company.count >= PER_COMPANY).length;
const total = finalRows.reduce((sum, company) => sum + company.count, 0);
const shortfalls = finalRows.filter((company) => company.count < PER_COMPANY);
console.log(`Done. Processed ${processed}; ~${revealed} emails revealed; ${full}/${companies.length} companies at ${PER_COMPANY}/${PER_COMPANY}; ${total} emailable contacts.`);
if (shortfalls.length) {
  console.log('Shortfalls:');
  for (const company of shortfalls) console.log(`  ${company.id} ${company.name}: ${company.count}/${PER_COMPANY}`);
  process.exitCode = 2;
}
