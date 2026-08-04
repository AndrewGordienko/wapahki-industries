// Apollo email unlock for OutageHub buyer targets.
//
// Each outagehub_targets row carries a buyer (a real named exec, or a role
// placeholder) at a real company with a domain. This script spends Apollo
// credits to turn those into sendable contacts:
//
//   NAMED PERSON (e.g. "Mark McDonald" @ bell.ca) — enrich THAT person by
//     name+domain so the already-drafted "Hi Mark," email stays valid. Never
//     swaps the person; if Apollo can't find their email we leave it blank.
//   ROLE PLACEHOLDER (empty name, "Director, Emergency Management" @ toronto.ca)
//     — search the domain for that title, keep an emailable person still at the
//     company, enrich them, fill the name/title/email AND patch the draft
//     greeting from "Hello," to "Hi <First>,".
//
//   node scripts/outagehub-enrich.js --dry-run     # classify only, no credits
//   node scripts/outagehub-enrich.js               # live (spends Apollo credits)
//   node scripts/outagehub-enrich.js --limit 10
import { listOutagehubProblems, updateTarget } from '../src/outagehub.js';
import * as apollo from '../src/apollo.js';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const LIMIT = (() => { const i = args.indexOf('--limit'); return i >= 0 ? Number(args[i + 1]) : Infinity; })();
const log = (m) => console.log(`[enrich] ${m}`);

const ROLE_RE = /\b(director|manager|vp|vice president|head|chief|officer|president|lead|coordinator|owner|superintendent|executive|administrator|supervisor|principal|founder|ceo|coo|cto|cfo|ciso)\b/i;
const isPersonName = (n) => {
  n = (n || '').trim();
  if (!n || ROLE_RE.test(n)) return false;
  const w = n.split(/\s+/);
  return w.length >= 2 && w.length <= 4 && w.every((x) => /^[A-Z][a-zA-Z.'-]+$/.test(x));
};
const domainRoot = (d) => String(d || '').toLowerCase().replace(/^www\./, '').split('.')[0];
const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || '';

// Swap a generic "Hello," / "Hi there," opener for "Hi <First>," once we have a name.
function patchGreeting(body, name) {
  const first = firstName(name);
  if (!first) return body;
  return String(body || '').replace(/^(hi there|hello|hi|dear)[,\s].*$/im, `Hi ${first},`);
}

function allTargets() {
  const out = [];
  for (const p of listOutagehubProblems()) {
    for (const t of (p.targets || [])) out.push({ ...t, problem: p.title });
  }
  return out;
}

async function enrichNamedBatch(batch) {
  // One bulk_match call for up to ~10 named people; matches align with details order.
  const people = batch.map((t) => {
    const { first_name, last_name } = apollo.splitName(t.contact_name);
    return { first_name, last_name, name: t.contact_name, domain: t.domain, company_name: t.company };
  });
  let matches = [];
  try { matches = await apollo.bulkEnrich({ people }); } catch (e) { log(`  bulk_match failed: ${e.message.split('\n')[0]}`); return 0; }
  let filled = 0;
  for (let i = 0; i < batch.length; i++) {
    const t = batch[i];
    const m = matches[i];
    if (!m || !apollo.isUsableEmail(m.email)) { log(`  – ${t.company}: no email for ${t.contact_name}`); continue; }
    updateTarget(t.id, {
      contact_email: m.email,
      // upgrade the title only if Apollo has one and ours was blank
      contact_title: t.contact_title || m.title || null,
    });
    filled++;
    log(`  ✓ ${t.company}: ${t.contact_name} → ${m.email}`);
  }
  return filled;
}

async function enrichRole(t) {
  // Search the company domain for the role, keep an emailable person still there.
  let candidates = [];
  try {
    candidates = await apollo.searchPeople({
      titles: t.contact_title ? [t.contact_title] : [],
      domains: [t.domain], locations: ['Canada'], perPage: 10,
    });
  } catch (e) {
    log(`  – ${t.company}: search failed (${e.code || e.message.split('\n')[0]})`);
    return 0;
  }
  const pick = candidates.find((c) => c.id && c.has_email
    && (!c.organization?.primary_domain || domainRoot(c.organization.primary_domain) === domainRoot(t.domain)));
  if (!pick) { log(`  – ${t.company}: no emailable ${t.contact_title || 'contact'}`); return 0; }
  let m;
  try { m = (await apollo.enrichByIds([pick.id]))[0]; } catch (e) { log(`  – ${t.company}: enrich failed (${e.message.split('\n')[0]})`); return 0; }
  if (!m || !apollo.isUsableEmail(m.email)) { log(`  – ${t.company}: ${t.contact_title} not unlockable`); return 0; }
  updateTarget(t.id, {
    contact_name: m.name || t.contact_name,
    contact_title: m.title || t.contact_title,
    contact_email: m.email,
    email_body: patchGreeting(t.email_body, m.name),
  });
  log(`  ✓ ${t.company}: ${m.name} (${m.title || t.contact_title}) → ${m.email}`);
  return 1;
}

async function main() {
  const targets = allTargets().filter((t) => t.domain && !apollo.isUsableEmail(t.contact_email));
  const named = targets.filter((t) => isPersonName(t.contact_name)).slice(0, LIMIT);
  const roles = targets.filter((t) => !isPersonName(t.contact_name)).slice(0, Math.max(0, LIMIT - named.length));

  log(`${targets.length} targets need an email · ${named.length} named people · ${roles.length} role placeholders`);
  if (DRY_RUN) {
    log('dry run — would spend ~1 Apollo credit per target. No calls made.');
    for (const t of [...named, ...roles]) log(`  · ${t.company} — ${t.contact_name || '(' + t.contact_title + ')'} @ ${t.domain}`);
    return;
  }

  let filled = 0;
  // Named people: batch by 10 to minimise requests.
  for (let i = 0; i < named.length; i += 10) {
    const batch = named.slice(i, i + 10);
    log(`named batch ${i / 10 + 1} (${batch.length})…`);
    filled += await enrichNamedBatch(batch);
  }
  // Role placeholders: one search + enrich each.
  for (const t of roles) {
    log(`role · ${t.company} (${t.contact_title})…`);
    filled += await enrichRole(t);
  }

  log(`done. unlocked ${filled} emails across ${named.length + roles.length} targets.`);
}

main().catch((e) => { log(`fatal: ${e.message}`); process.exitCode = 1; });
