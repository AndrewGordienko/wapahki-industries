// Refill under-5 OutageHub companies to 5 emailable ops contacts using a
// DOMAIN-ONLY Apollo people-search (the org-id + location constraints in
// buildCompanyContacts return 0 for big orgs with a stale apollo_org_id).
// Ranks by seniority, skips weak (sales/finance/marketing/HR) titles, enriches
// by id. Stops at --target companies at 5/5 or --cap revealed emails.
//   node scripts/refill-outagehub.js [--target 50] [--cap 110]
import { db, listPeopleByCompany, upsertPerson } from '../src/db.js';
import { searchPeople, enrichByIds, isUsableEmail } from '../src/apollo.js';

const args = process.argv.slice(2);
const numArg = (f, d) => { const i = args.indexOf(f); return i >= 0 ? Number(args[i + 1]) : d; };
const TARGET = numArg('--target', 50);
const CAP = numArg('--cap', 110);

// Known-wrong domains -> a domain Apollo actually indexes people under.
const DOMAIN_FIX = { 'Walmart Canada': 'walmart.com', 'City of Toronto / Toronto Emergency Management': 'toronto.ca' };
const WEAK = /sales|marketing|finance|business development|human resources|\btalent\b|communications|\bbrand\b|treasur|controller|accounting|\blegal\b|counsel|chief financial|chief marketing|customer experience|recruit/i;

function seniority(title) {
  const t = (title || '').toLowerCase();
  if (/\b(chief|coo|cto|cio|ciso|founder|president|vp|vice president|head of)\b/.test(t)) return 10;
  if (/\b(director|general manager|gm)\b/.test(t)) return 9;
  if (/\b(manager|lead|superintendent|coordinator|principal)\b/.test(t)) return 7;
  return 4;
}
const emailableCount = (id) => listPeopleByCompany(id).filter((p) => p.email && p.email.includes('@')).length;

const under5 = db.prepare(`
  SELECT c.id, c.name, c.domain, COUNT(CASE WHEN p.email LIKE '%@%' THEN 1 END) emailable
  FROM companies c LEFT JOIN people p ON p.company_id=c.id
  WHERE c.campaign='outagehub' GROUP BY c.id HAVING emailable<5 ORDER BY emailable DESC`).all();
let atFive = db.prepare("SELECT COUNT(*) n FROM (SELECT c.id FROM companies c JOIN people p ON p.company_id=c.id AND p.email LIKE '%@%' WHERE c.campaign='outagehub' GROUP BY c.id HAVING COUNT(*)>=5)").get().n;
const globallyUsedIds = new Set(
  db.prepare("SELECT apollo_person_id FROM people WHERE apollo_person_id IS NOT NULL AND apollo_person_id != ''")
    .all()
    .map((p) => p.apollo_person_id),
);

console.log(`refill-outagehub: ${under5.length} under-5 companies | already ${atFive} at 5/5 | target ${TARGET} | cap ${CAP}`);
let revealed = 0;

for (const c of under5) {
  if (atFive >= TARGET) { console.log(`\nReached ${TARGET} at 5/5 — stopping.`); break; }
  if (revealed >= CAP) { console.log(`\nHit cap (~${revealed} revealed) — stopping.`); break; }
  const domain = DOMAIN_FIX[c.name] || c.domain;
  if (!domain) { console.log(`  - ${c.name}: no domain`); continue; }

  const existing = listPeopleByCompany(c.id);
  const usedIds = new Set(existing.map((p) => p.apollo_person_id).filter(Boolean));
  const usedNames = new Set(existing.map((p) => (p.name || '').toLowerCase()));
  let have = emailableCount(c.id);
  const need = 5 - have;
  if (need <= 0) continue;

  let people = [];
  try { people = await searchPeople({ domains: [domain], perPage: 50 }); }
  catch (e) { console.log(`  ! ${c.name}: search ${e.message.split('\n')[0]}`); continue; }

  const candidates = people
    // upsertPerson de-dupes Apollo ids globally and intentionally keeps the
    // existing company_id. Do not spend a reveal on a person already attached
    // to another CRM company, then pretend they were added here.
    .filter((p) => p.id && p.has_email && !usedIds.has(p.id) && !globallyUsedIds.has(p.id) && !WEAK.test(p.title || ''))
    .map((p) => ({ p, s: seniority(p.title) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, need + 3);

  if (!candidates.length) { console.log(`  - ${c.name}: 0 ops candidates at ${domain} (have ${have})`); continue; }

  let matches = [];
  try { matches = await enrichByIds(candidates.map((x) => x.p.id)); }
  catch (e) {
    if (/insufficient|credit|422/i.test(e.message)) { console.log(`  ! ${c.name}: ${e.message.split('\n')[0]} — OUT OF CREDITS, stopping.`); break; }
    console.log(`  ! ${c.name}: enrich ${e.message.split('\n')[0]}`); continue;
  }

  let added = 0;
  for (const x of candidates) {
    if (have >= 5) break;
    const m = matches.find((mm) => mm && mm.id === x.p.id);
    if (!m || !isUsableEmail(m.email) || usedNames.has((m.name || '').toLowerCase())) continue;
    const saved = upsertPerson({
      company_id: c.id, name: m.name, first_name: m.first_name, last_name: m.last_name,
      title: m.title || x.p.title, email: m.email, email_status: m.email_status || 'verified',
      linkedin_url: m.linkedin_url, apollo_person_id: m.id, relevance_score: x.s, relevance_reason: 'refill domain-search',
    });
    globallyUsedIds.add(m.id);
    // Count only a contact that actually lives under this company.
    if (saved.company_id !== c.id || !saved.email || !saved.email.includes('@')) continue;
    usedNames.add((m.name || '').toLowerCase());
    const actual = emailableCount(c.id);
    if (actual <= have) continue;
    have = actual;
    added++;
    revealed++;
  }
  have = emailableCount(c.id);
  if (have >= 5) atFive++;
  console.log(`  ${c.name}: ${have}/5 (+${added}) | at5/5: ${atFive} | ~revealed ${revealed}`);
  await new Promise((r) => setTimeout(r, 350));
}

const finalAtFive = db.prepare("SELECT COUNT(*) n FROM (SELECT c.id FROM companies c JOIN people p ON p.company_id=c.id AND p.email LIKE '%@%' WHERE c.campaign='outagehub' GROUP BY c.id HAVING COUNT(*)>=5)").get().n;
const totalEmailable = db.prepare("SELECT COUNT(*) n FROM people p JOIN companies c ON c.id=p.company_id WHERE c.campaign='outagehub' AND p.email LIKE '%@%'").get().n;
console.log(`\nDone. ~${revealed} emails revealed. OutageHub now: ${finalAtFive} at 5/5 | ${totalEmailable} emailable total.`);
