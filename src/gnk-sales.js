// Pure GnK account/contact policy used by the first-50 runner and tests.
// Selection is role-led: people close to the work outrank routers and generic
// executives, even when the latter were inserted earlier in the CRM.

const ROUTER_TITLE = /\b(?:human resources|people and culture|talent|recruit|business development|sales|marketing|communications?|public affairs|account executive|support specialist)\b/i;
const ROUTER_REASON = /\b(?:routing only|router only|routing contact|referral path|does not own|do not run a sequence|off[- ]function)\b/i;
const TECHNICAL_TITLE = /\b(?:chief technology|chief information|chief security|cto|cio|ciso|information technology|\bit\b|technology|security|data|software|systems?|engineering|architect)\b/i;
const OPERATOR_TITLE = /\b(?:operations?|operational|process|procurement|supply chain|project controls?|quality|compliance|regulatory|finance operations|controller|analyst|planner|scheduler|supervisor|maintenance|service|dispatch|implementation|delivery|customer success|program|product)\b/i;
const ECONOMIC_TITLE = /\b(?:chief executive|chief operating|chief financial|ceo|coo|cfo|president|owner|founder|vice president|\bvp\b|executive director|general manager|managing director)\b/i;

export function classifyGnkContact(person = {}) {
  const title = String(person.title || '');
  const reason = String(person.relevance_reason || '');
  if (ROUTER_REASON.test(reason) || ROUTER_TITLE.test(title)) return 'router';
  if (TECHNICAL_TITLE.test(title)) return 'technical_security_owner';
  if (ECONOMIC_TITLE.test(title)) return 'economic_buyer';
  if (OPERATOR_TITLE.test(title)) return 'operator_or_process_owner';
  if (/\b(?:director|head|manager|partner|principal|lead)\b/i.test(title)) return 'process_owner_candidate';
  return 'unclear';
}

const ROUTE_PRIORITY = Object.freeze({
  operator_or_process_owner: 0,
  process_owner_candidate: 1,
  technical_security_owner: 2,
  economic_buyer: 3,
  unclear: 7,
  router: 9,
});

export function rankGnkContacts(people = []) {
  return people.map((person) => ({ ...person, gnk_route: classifyGnkContact(person) }))
    .sort((left, right) => (
      ROUTE_PRIORITY[left.gnk_route] - ROUTE_PRIORITY[right.gnk_route]
      || Number(right.relevance_score || 0) - Number(left.relevance_score || 0)
      || Number(left.id || 0) - Number(right.id || 0)
    ));
}

export function selectGnkBuyingGroup(people = [], limit = 3) {
  const ranked = rankGnkContacts(people);
  const direct = ranked.filter((person) => person.gnk_route !== 'router');
  if (limit < 1) return [];
  const selected = direct.slice(0, Math.min(limit, 2));
  if (limit >= 3) {
    const controlRoute = direct.find((person) => (
      !selected.some((chosen) => chosen.id === person.id)
      && ['technical_security_owner', 'economic_buyer'].includes(person.gnk_route)
    ));
    if (controlRoute) selected.push(controlRoute);
  }
  for (const person of direct) {
    if (selected.length >= limit) break;
    if (!selected.some((chosen) => chosen.id === person.id)) selected.push(person);
  }
  return selected;
}
