// Orchestration: build a small, role-balanced contact map without deleting
// previously known people. Three strong routes are better than a five-person
// quota that forces executives and routing contacts into outreach.
import * as apollo from './apollo.js';
import { scoreContact } from './relevance.js';
import { getCampaign } from './campaigns.js';
import {
  getCompany, updateCompany, listPeopleByCompany, upsertPerson, updatePerson, getPerson, deletePerson,
} from './db.js';

// Person-location bias for a company's campaign (fallback to Canada).
function campaignPersonLocations(company) {
  try { return getCampaign(company.campaign)?.discovery?.locations || ['Canada']; }
  catch { return ['Canada']; }
}

function targetTitleAffinity(company, title) {
  const normalized = String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (!normalized) return 0;
  const targets = safeTitles(company.target_titles).map((item) => (
    String(item || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  ));
  if (targets.some((target) => target && (normalized.includes(target) || target.includes(normalized)))) return 2;
  const words = new Set(normalized.split(' ').filter((word) => word.length > 4));
  return targets.some((target) => target.split(' ').filter((word) => word.length > 4).some((word) => words.has(word))) ? 1 : 0;
}

// Rank candidates by access to the work first, then buying influence. A C-suite
// title is not evidence of role fit and should not outrank a relevant operator.
function scoreCandidate(company, title) {
  if (company.campaign === 'wapahki') return scoreContact(title, company.name);
  const t = (title || '').toLowerCase();
  const affinity = targetTitleAffinity(company, title);
  const unrelated = /\b(talent|recruit|human resources|people and culture|marketing|communications|legal|counsel|finance|controller|sales|account executive)\b/.test(t);
  const executive = /\b(chief|ceo|cto|cio|ciso|coo|cfo|founder|co-?founder|president)\b/.test(t);
  const seniorExecutive = /\b(vp|vice president|head of)\b/.test(t);
  const workClose = /\b(manager|lead|supervisor|engineer|analyst|buyer|planner|scheduler|product|implementation|delivery|customer success|quality|reliability|dispatch|facilities|operations|process|service|network|sdet|architect)\b/.test(t);
  const director = /\b(director|principal|staff)\b/.test(t);

  let score = 4 + affinity;
  let category = 'unclear';
  if (unrelated && affinity === 0) {
    score = 2;
    category = 'routing_only';
  } else if (workClose) {
    score = Math.min(10, 8 + affinity);
    category = 'work_close';
  } else if (director) {
    score = Math.min(9, 7 + affinity);
    category = 'decision_influencer';
  } else if (seniorExecutive) {
    score = Math.min(8, 5 + affinity);
    category = 'executive_sponsor';
  } else if (executive) {
    score = Math.min(6, 3 + affinity);
    category = 'too_senior';
  }
  const reason = category === 'work_close'
    ? `Close to the operating decision and likely able to explain the current process; use as a primary discovery route before escalating.`
    : category === 'decision_influencer'
      ? `Can influence a decision and appears relevant, but verify direct access to the work before selecting as the primary contact.`
      : category === 'executive_sponsor'
        ? `Potential sponsor, but usually a later consensus route after an operator confirms the problem.`
        : category === 'routing_only'
          ? `Function is not an honest owner of the suspected problem; keep only as a referral path and do not force a cold pitch.`
          : `Role fit is unclear; verify the person's actual remit before outreach.`;
  return { score, reason, category };
}

// Make sure we know the company's Apollo org id + domain (resolve once, cache in DB).
export async function resolveCompany(companyId) {
  const company = getCompany(companyId);
  if (!company) throw new Error(`Company ${companyId} not found`);
  if (company.domain && company.apollo_org_id) return company;

  const orgs = await apollo.searchOrganizations({
    name: company.name,
    locations: company.location ? [company.location] : [],
  });
  if (!orgs.length) return company; // leave as-is; caller can still search by name/title

  const best = orgs[0];
  return updateCompany(companyId, {
    domain: company.domain || best.primary_domain || best.website_url || null,
    website: company.website || best.website_url || null,
    apollo_org_id: company.apollo_org_id || best.id || null,
  });
}

// Find up to `limit` relevant people for a company and store them (emails still locked).
export async function findPeopleForCompany(companyId, { limit = 3 } = {}) {
  let company = await resolveCompany(companyId);
  const titles = safeTitles(company.target_titles);

  const domains = company.domain ? [company.domain] : [];
  const organizationIds = company.apollo_org_id ? [company.apollo_org_id] : [];

  const found = await apollo.searchPeople({
    titles,
    domains,
    organizationIds,
    perPage: Math.max(limit * 2, 10), // over-fetch, then keep the most relevant
  });

  const scored = found.map((p) => {
    const title = p.title || '';
    const { score, reason } = scoreCandidate(company, title);
    return { raw: p, score, reason };
  });
  scored.sort((a, b) => b.score - a.score);

  const saved = [];
  for (const { raw, score, reason } of scored.slice(0, limit)) {
    const org = raw.organization || {};
    const person = upsertPerson({
      company_id: companyId,
      name: raw.name || [raw.first_name, raw.last_name].filter(Boolean).join(' '),
      first_name: raw.first_name || null,
      last_name: raw.last_name || null,
      title: raw.title || null,
      email: apollo.isUsableEmail(raw.email) ? raw.email : null,
      email_status: apollo.isUsableEmail(raw.email) ? (raw.email_status || 'verified') : 'locked',
      linkedin_url: raw.linkedin_url || null,
      apollo_person_id: raw.id || null,
      relevance_score: score,
      relevance_reason: reason,
    });
    saved.push(person);
  }

  // Backfill the company domain from a returned person if we still don't have one.
  if (!company.domain && found[0]?.organization?.primary_domain) {
    company = updateCompany(companyId, { domain: found[0].organization.primary_domain });
  }

  return { company, added: saved.length, people: listPeopleByCompany(companyId) };
}

// Unlock emails for a company's existing people via Apollo enrichment. Costs credits.
export async function enrichCompanyEmails(companyId, { revealPersonalEmails = false } = {}) {
  // Resolve the company's domain first (improves match rate); fall back if it fails.
  let company;
  try { company = await resolveCompany(companyId); }
  catch { company = getCompany(companyId); }
  const people = listPeopleByCompany(companyId);
  const need = people.filter((p) => !apollo.isUsableEmail(p.email));
  if (!need.length) return { enriched: 0, people };

  const matches = await apollo.bulkEnrich({
    revealPersonalEmails,
    people: need.map((p) => {
      const { first_name, last_name } = p.first_name
        ? { first_name: p.first_name, last_name: p.last_name }
        : apollo.splitName(p.name);
      return {
        apollo_person_id: p.apollo_person_id,
        first_name,
        last_name,
        name: p.name,
        domain: company.domain || null,
        company_name: company.name,
        linkedin_url: p.linkedin_url,
      };
    }),
  });

  // Match results back to our rows by apollo id, then by name.
  let enriched = 0;
  for (let i = 0; i < need.length; i++) {
    const row = need[i];
    const m =
      matches.find((x) => x && x.id && x.id === row.apollo_person_id) ||
      matches.find((x) => x && sameName(x.name, row.name)) ||
      matches[i];
    if (!m) { updatePerson(row.id, { email_status: 'unavailable' }); continue; }

    const email = apollo.isUsableEmail(m.email)
      ? m.email
      : (Array.isArray(m.personal_emails) && m.personal_emails.find(apollo.isUsableEmail)) || null;

    if (email) {
      updatePerson(row.id, {
        email,
        email_status: m.email_status || 'verified',
        linkedin_url: row.linkedin_url || m.linkedin_url || null,
      });
      enriched++;
    } else {
      updatePerson(row.id, { email_status: 'unavailable' });
    }
  }

  return { enriched, people: listPeopleByCompany(companyId) };
}

// Enrich a single person (used by the per-row "unlock email" button).
export async function enrichPerson(personId, { revealPersonalEmails = false } = {}) {
  const person = getPerson(personId);
  if (!person) throw new Error(`Person ${personId} not found`);
  const company = getCompany(person.company_id);
  const { first_name, last_name } = person.first_name
    ? { first_name: person.first_name, last_name: person.last_name }
    : apollo.splitName(person.name);

  const matches = await apollo.bulkEnrich({
    revealPersonalEmails,
    people: [{
      apollo_person_id: person.apollo_person_id,
      first_name, last_name, name: person.name,
      domain: company?.domain || null,
      company_name: company?.name,
      linkedin_url: person.linkedin_url,
    }],
  });
  const m = matches[0];
  if (m && apollo.isUsableEmail(m.email)) {
    return updatePerson(personId, { email: m.email, email_status: m.email_status || 'verified' });
  }
  return updatePerson(personId, { email_status: 'unavailable' });
}

function safeTitles(str) {
  try { const a = JSON.parse(str || '[]'); return Array.isArray(a) ? a : []; } catch { return []; }
}
function sameName(a, b) {
  return a && b && a.trim().toLowerCase() === b.trim().toLowerCase();
}

// Does an enriched Apollo record still belong to this company? (the "not retired / still there" check)
function stillAtCompany(match, company) {
  if (!match) return false;
  const org = match.organization || {};
  const cd = (company.domain || '').toLowerCase();
  const emailDomain = (match.email || '').split('@')[1]?.toLowerCase() || '';
  if (cd && (org.primary_domain || '').toLowerCase() === cd) return true;
  if (cd && emailDomain && emailDomain === cd) return true;
  const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const cn = norm(company.name), on = norm(org.name);
  if (cn && on) {
    const t = cn.split(' ')[0];
    if (t.length > 2 && (on.includes(t) || cn.includes(on.split(' ')[0]))) return true;
  }
  // If we have no domain to compare and org name is blank, don't reject outright.
  return !cd && !org.name;
}

/**
 * Build up to `limit` emailable, currently-employed contacts for a company:
 *   1. resolve the company domain
 *   2. enrich any existing named people; keep the ones with a real email who are still there
 *   3. fill remaining slots from Apollo people-search (has_email + relevant title), enriched by id
 *   4. drop leftover un-emailable placeholder rows so the company shows a clean set
 * Returns { company, people, kept, note }.
 */
export async function buildCompanyContacts(companyId, { limit = 3, minScore = 7 } = {}) {
  let company = await resolveCompany(companyId);
  const titles = safeTitles(company.target_titles);
  const usedIds = new Set();
  const usedNames = new Set();
  const keptIds = new Set();
  let kept = 0;

  const keep = (personId, apolloId, name) => {
    keptIds.add(personId);
    if (apolloId) usedIds.add(apolloId);
    if (name) usedNames.add(name.toLowerCase());
    kept++;
  };

  // ---- 2) enrich existing named people (vetted lists) ----
  for (const p of listPeopleByCompany(companyId)) {
    if (kept >= limit) break;
    // Already enriched in a prior run — keep for free (no credit) and learn the domain from it.
    if (apollo.isUsableEmail(p.email)) {
      if (!company.domain && p.email.includes('@')) company = updateCompany(companyId, { domain: p.email.split('@')[1] });
      keep(p.id, p.apollo_person_id, p.name);
      continue;
    }
    const { first_name, last_name } = p.first_name
      ? { first_name: p.first_name, last_name: p.last_name }
      : apollo.splitName(p.name);
    let m;
    try {
      const matches = await apollo.bulkEnrich({
        people: [{ apollo_person_id: p.apollo_person_id, first_name, last_name, name: p.name, domain: company.domain, company_name: company.name, linkedin_url: p.linkedin_url }],
      });
      m = matches[0];
    } catch { m = null; }

    if (m && apollo.isUsableEmail(m.email)) {
      // Backfill company domain from a verified email BEFORE the "still there" check,
      // so companies with no resolved domain (e.g. Co-Pak) can still be matched + searched.
      if (!company.domain && m.email.includes('@')) {
        company = updateCompany(companyId, { domain: m.email.split('@')[1] });
      }
      if (stillAtCompany(m, company)) {
        updatePerson(p.id, {
          name: m.name || p.name, email: m.email, email_status: m.email_status || 'verified',
          linkedin_url: m.linkedin_url || p.linkedin_url, title: m.title || p.title,
        });
        keep(p.id, m.id, m.name || p.name);
      }
    }
    // people who have no email or have left are handled by the cleanup step below
  }

  // ---- 3) fill remaining slots via people-search + enrich-by-id ----
  const canSearch = !!(company.domain || company.apollo_org_id);
  let note = '';
  if (kept < limit && canSearch) {
    const domains = company.domain ? [company.domain] : [];
    const orgIds = company.apollo_org_id ? [company.apollo_org_id] : [];

    // Bias to the campaign's geography first (e.g. Canada for Wapahki, US+Canada for GNK).
    let candidates = await safeSearch({ titles, domains, organizationIds: orgIds, locations: campaignPersonLocations(company) });
    // If thin, widen without weakening the relevance score gate.
    if (candidates.filter((c) => c.has_email).length < (limit - kept)) {
      const wide = await safeSearch({ titles: [], domains, organizationIds: orgIds });
      const seen = new Set(candidates.map((c) => c.id));
      candidates = candidates.concat(wide.filter((c) => !seen.has(c.id)));
    }

    const scored = candidates
      .filter((c) => c.id && c.has_email && !usedIds.has(c.id))
      .map((c) => ({ c, ...scoreCandidate(company, c.title) }))
      .filter((x) => x.score >= minScore)
      .sort((a, b) => b.score - a.score);

    const pick = scored.slice(0, (limit - kept) + 1); // has_email guarantees an email exists; +1 safety only
    const matches = pick.length ? await apollo.enrichByIds(pick.map((x) => x.c.id)) : [];

    for (const x of pick) {
      if (kept >= limit) break;
      const m = matches.find((mm) => mm && mm.id === x.c.id);
      if (!m || !apollo.isUsableEmail(m.email)) continue;
      if (usedNames.has((m.name || '').toLowerCase())) continue;
      if (!company.domain && m.email.includes('@')) company = updateCompany(companyId, { domain: m.email.split('@')[1] });
      const { score, reason } = scoreCandidate(company, m.title || x.c.title);
      const person = upsertPerson({
        company_id: companyId, name: m.name, first_name: m.first_name, last_name: m.last_name,
        title: m.title || x.c.title, email: m.email, email_status: m.email_status || 'verified',
        linkedin_url: m.linkedin_url, apollo_person_id: m.id, relevance_score: score, relevance_reason: reason,
      });
      keep(person.id, m.id, m.name);
    }
  } else if (!canSearch) {
    note = 'no company domain found in Apollo — could not search for contacts';
  }

  if (kept < limit) note = note || `only ${kept} emailable current contact(s) available in Apollo`;

  // ---- 4) cleanup: archive unusable placeholders; never destroy history ----
  for (const p of listPeopleByCompany(companyId)) {
    if (!keptIds.has(p.id) && !apollo.isUsableEmail(p.email)) deletePerson(p.id);
  }

  return { company: getCompany(companyId), people: listPeopleByCompany(companyId), kept, note };
}

async function safeSearch(opts) {
  try { return await apollo.searchPeople({ ...opts, perPage: 25 }); }
  catch (err) { if (err.code === 'PEOPLE_SEARCH_DISABLED') return []; throw err; }
}
