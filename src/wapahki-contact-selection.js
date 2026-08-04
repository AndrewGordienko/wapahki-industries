const COMPANY_OVERRIDES = new Map([
  ['aurora importing & distributing', ['Renato Pasquale', 'Jasmeet Singh', 'Krystal Ordonez']],
  ['biowell laboratories', ['Sunil Patel', 'Dhrumil Patel', 'Purvi Adhvaryu']],
]);

function cleanTitle(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/&amp;/g, 'and')
    .replace(/qa\s*\/\s*qc/g, 'quality')
    .replace(/qfs/g, 'quality food safety')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// This key is intentionally about likely message similarity, not seniority.
// Two people with the same key should be alternates, not parallel recipients.
export function wapahkiRoleKey(title) {
  const value = cleanTitle(title);
  if (!value) return 'unknown';
  if (/\bplant (?:manager|superintendent|director)\b/.test(value)) return 'plant_leadership';
  if (/\bfinance\b|\bcontroller\b|\baccounting\b|\bbookkeeper\b/.test(value)) return 'finance';
  // A warehouse operations title sees a narrower physical-handling process than
  // a company-wide operations title, so classify that lens before the broad
  // "operations manager" pattern.
  if (/\bwarehouse\b/.test(value)) return 'warehouse';
  if (/\b(?:general manager|director of operations|operations director|operations manager|operations leader|manufacturing (?:and )?operations leader|manufacturing leader|director of manufacturing)\b/.test(value)) return 'operations_leadership';
  if (/\bcontinuous improvement|operational excellence|process improvement\b/.test(value)) return 'continuous_improvement';
  if (/\bautomation\b|\brobotics\b/.test(value)) return 'automation_engineering';
  if (/\bengineering\b/.test(value) && /\bmaintenance\b/.test(value)) return 'engineering_maintenance';
  if (/\bengineering\b|\bmechanical engineer\b|\bprocess engineer/.test(value)) return 'engineering';
  if (/\bmaintenance\b|\bmro\b|\bfacilities\b/.test(value)) return 'maintenance';
  if (/\blogistics?\b|\bshipping\b|\breceiving\b|\bfulfillment\b|\bfulfilment\b/.test(value)) return 'logistics';
  if (/\bsupply chain\b|\bprocurement\b|\bbuyer\b/.test(value)) return 'supply_chain';
  if (/\bproduction manager\b/.test(value)) return 'production_manager';
  if (/\bproduction supervisor\b|\bshift operations manager\b|\bline leader\b|\bteam leader\b/.test(value)) return 'production_supervision';
  if (/\bproduction planner\b|\bproduction planning\b|\bscheduling\b|\binventory\b/.test(value)) return 'planning';
  if (/\bpackaging\b|\bco packing\b/.test(value)) return 'packaging';
  if (/\bsanitation\b/.test(value)) return 'sanitation';
  if (/\bregulatory\b/.test(value)) return 'regulatory';
  if (/\bquality\b|\bfood safety\b|\bmicrobiology\b/.test(value)) return 'quality';
  if (/\bproject manager\b/.test(value)) return 'project';
  if (/\bsales\b|\bmarketing\b|\bbusiness development\b|\baccount coordinator\b|\bcustomer service\b/.test(value)) return 'commercial_customer';
  if (/\bdriver\b|\bfleet\b|\btransport/.test(value)) return 'transport';
  if (/\boperator\b|\btechnician\b|\blead hand\b|\bemployee associate\b/.test(value)) return 'floor_user';
  return value
    .replace(/\b(?:senior|assistant|associate|junior|lead|team|regional|vice president|vp)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// A contact's outreach track decides both the framing and the sequence length.
// Only people who could realistically evaluate or champion the problem earn the
// full discovery sequence. Operational roles get concrete floor questions;
// finance/business roles get an equipment-economics conversation; everyone whose
// remit is clearly elsewhere (design, sales, admin, logistics dispatch) gets a
// single honest routing request rather than a seven-touch campaign.
const ECONOMIC_ROLES = new Set(['finance']);
const OPERATIONAL_ROLES = new Set([
  'plant_leadership', 'operations_leadership', 'warehouse', 'continuous_improvement',
  'automation_engineering', 'engineering_maintenance', 'engineering', 'maintenance',
  'supply_chain', 'production_manager', 'production_supervision', 'planning',
  'packaging', 'sanitation', 'regulatory', 'quality', 'floor_user',
]);

export function wapahkiTrack(title) {
  // A missing or empty title is not evidence of an out-of-remit role. Default to
  // the full operational sequence so we never downgrade someone to a one-touch
  // routing email just because their title was not recorded.
  if (!cleanTitle(title)) return 'operational';
  const key = wapahkiRoleKey(title);
  if (ECONOMIC_ROLES.has(key)) return 'economic';
  if (OPERATIONAL_ROLES.has(key)) return 'operational';
  // commercial_customer, project, transport, and any recognized-but-non-operational
  // title (graphic designer, HR, junior designer, inside sales) are routing-only.
  return 'routing';
}

function ranked(people) {
  return [...people].sort((left, right) => (
    Number(right.relevance_score || 0) - Number(left.relevance_score || 0)
    || Number(left.id || 0) - Number(right.id || 0)
  ));
}

export function selectWapahkiContacts(company, people, limit = 3) {
  const available = ranked(people);
  const selected = [];
  const usedIds = new Set();
  const usedRoles = new Set();
  const add = (person) => {
    if (!person || usedIds.has(Number(person.id))) return;
    const role = wapahkiRoleKey(person.title);
    if (usedRoles.has(role)) return;
    selected.push(person);
    usedIds.add(Number(person.id));
    usedRoles.add(role);
  };

  const preferredNames = COMPANY_OVERRIDES.get(String(company?.name || '').toLowerCase()) || [];
  for (const name of preferredNames) add(available.find((person) => person.name === name));
  for (const person of available) {
    if (selected.length >= limit) break;
    add(person);
  }

  return {
    selected: selected.slice(0, limit),
    alternates: available.filter((person) => !usedIds.has(Number(person.id))),
    missing: Math.max(0, limit - selected.length),
  };
}
