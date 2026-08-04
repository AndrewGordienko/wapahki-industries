// Thin, defensive client for the Apollo.io REST API.
// Docs: https://docs.apollo.io/reference  (endpoints are stable; we handle both
// locked "email_not_unlocked@domain.com" responses and real unlocked emails.)

import { APOLLO_API_KEY } from './config.js';

const BASE = 'https://api.apollo.io/api/v1';

function headers() {
  return {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache',
    // Apollo requires the key in this exact header (not a query param).
    'X-Api-Key': APOLLO_API_KEY,
  };
}

async function apolloPost(path, body, { retries = 2 } = {}) {
  if (!APOLLO_API_KEY) {
    const e = new Error('APOLLO_API_KEY is not set. Add it to .env or `export APOLLO_API_KEY=...`.');
    e.code = 'NO_KEY';
    throw e;
  }
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(BASE + path, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(body || {}),
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    if (res.ok) return data;

    // 429 = rate limited. Back off and retry.
    if (res.status === 429 && attempt < retries) {
      const waitMs = 1500 * (attempt + 1);
      await new Promise((r) => setTimeout(r, waitMs));
      lastErr = new Error(`Apollo rate limited on ${path}`);
      continue;
    }

    const msg = data?.error || data?.message || data?.raw || res.statusText;
    const err = new Error(`Apollo ${path} failed (${res.status}): ${msg}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  throw lastErr;
}

// Validate the key with a cheap, real call (company search — no email credits).
export async function testConnection() {
  const data = await apolloPost('/mixed_companies/search', { per_page: 1, q_organization_name: 'apollo' });
  return {
    ok: true,
    endpoint: 'mixed_companies/search',
    reachable_records: data.pagination?.total_entries ?? null,
  };
}

// Find the Apollo organization record for a company (to get its domain + org id).
export async function searchOrganizations({ name, locations = [], perPage = 5 }) {
  const body = { page: 1, per_page: perPage };
  if (name) body.q_organization_name = name;
  if (locations.length) body.organization_locations = locations;
  const data = await apolloPost('/mixed_companies/search', body);
  return data.organizations || data.accounts || [];
}

// Discover companies by location + industry keywords + size (no Google needed).
// This is the "search around" engine — Apollo indexes the companies for us.
export async function discoverOrganizations({
  keywords = [], locations = [], employeeRanges = [], perPage = 25, page = 1,
}) {
  const body = { page, per_page: perPage };
  if (keywords.length) body.q_organization_keyword_tags = keywords;
  if (locations.length) body.organization_locations = locations;
  if (employeeRanges.length) body.organization_num_employees_ranges = employeeRanges;
  const data = await apolloPost('/mixed_companies/search', body);
  return data.organizations || data.accounts || [];
}

// Search people by job title, scoped to a company (by domain and/or org id).
export async function searchPeople({
  titles = [], domains = [], organizationIds = [], locations = [], page = 1, perPage = 10,
}) {
  const body = { page, per_page: perPage };
  if (titles.length) body.person_titles = titles;
  if (domains.length) body.q_organization_domains_list = domains;
  if (organizationIds.length) body.organization_ids = organizationIds;
  if (locations.length) body.person_locations = locations;
  try {
    // Newer endpoint name; the old /mixed_people/search is deprecated for API callers.
    const data = await apolloPost('/mixed_people/api_search', body);
    return data.people || data.contacts || [];
  } catch (err) {
    if (/not allowed/i.test(err.message)) {
      const e = new Error('People search by title is not enabled on your Apollo plan. Add contact names manually, then use "Unlock emails" (enrichment works on your plan).');
      e.code = 'PEOPLE_SEARCH_DISABLED';
      throw e;
    }
    throw err;
  }
}

// Unlock emails for a batch of people. Costs Apollo credits.
// `people` items may carry: apollo_person_id, first_name, last_name, name, domain,
// company_name, linkedin_url. Returns Apollo "matches".
export async function bulkEnrich({ people, revealPersonalEmails = false }) {
  const details = people.map((p) => {
    const d = {};
    if (p.apollo_person_id) d.id = p.apollo_person_id;
    if (p.first_name) d.first_name = p.first_name;
    if (p.last_name) d.last_name = p.last_name;
    if (!p.first_name && !p.last_name && p.name) d.name = p.name;
    // Send both signals when we have them — improves Apollo's match rate.
    if (p.domain) d.domain = p.domain;
    if (p.company_name) d.organization_name = p.company_name;
    if (p.linkedin_url) d.linkedin_url = p.linkedin_url;
    return d;
  });
  const data = await apolloPost('/people/bulk_match', {
    reveal_personal_emails: revealPersonalEmails,
    details,
  });
  return data.matches || [];
}

// Enrich a batch of people by their Apollo person ids (from api_search results).
// Returns full records: name, email, linkedin_url, title, organization. Costs 1 credit each.
export async function enrichByIds(ids, { revealPersonalEmails = false } = {}) {
  if (!ids.length) return [];
  const data = await apolloPost('/people/bulk_match', {
    reveal_personal_emails: revealPersonalEmails,
    details: ids.map((id) => ({ id })),
  });
  return data.matches || [];
}

// True when Apollo returned a usable email (not the locked placeholder).
export function isUsableEmail(email) {
  return !!email && email.includes('@') && !/email_not_unlocked|not_unlocked/i.test(email);
}

// Split a full name into first / last for Apollo enrichment.
export function splitName(full) {
  const parts = (full || '').trim().split(/\s+/);
  if (parts.length === 0) return { first_name: '', last_name: '' };
  if (parts.length === 1) return { first_name: parts[0], last_name: '' };
  return { first_name: parts[0], last_name: parts.slice(1).join(' ') };
}
