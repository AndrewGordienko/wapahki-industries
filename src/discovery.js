// Campaign-aware company discovery via Apollo (no Google needed).
// Uses a campaign's ICP (keywords + locations + employee ranges + target titles)
// so any funnel — wapahki, gnk, outagehub — sources with the same code.
import * as apollo from './apollo.js';
import { insertCompany, getCompanyByName } from './db.js';

export async function discoverCompanies(campaign, { limit = 40 } = {}) {
  const d = campaign.discovery || {};
  const keywords = d.keywords || [];
  const locations = d.locations || [];
  const employeeRanges = d.employee_ranges || [];
  const targetTitles = campaign.target_titles || [];

  const added = [];
  const seen = new Set();

  for (const kw of keywords) {
    if (added.length >= limit) break;
    let orgs = [];
    try {
      orgs = await apollo.discoverOrganizations({ keywords: [kw], locations, employeeRanges, perPage: 25 });
    } catch (err) {
      if (err.code === 'NO_KEY') throw err;
      continue; // skip a failing keyword rather than aborting
    }
    for (const org of orgs) {
      if (added.length >= limit) break;
      const name = (org.name || '').trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      if (getCompanyByName(name)) continue; // already in the CRM (any campaign)

      added.push(insertCompany({
        name,
        domain: org.primary_domain || null,
        website: org.website_url || null,
        city: [org.city, org.state].filter(Boolean).join(', ') || null,
        location: locations[0] || null,
        industry: org.industry || kw,
        apollo_org_id: org.id || null,
        source: 'apollo',
        campaign: campaign.id,
        target_titles: targetTitles,
      }));
    }
  }
  return added;
}
